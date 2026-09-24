import { spawn, spawnSync } from 'child_process'
import { freemem, release, totalmem } from 'os'

const WIN_MEM_PS =
  '$c=Get-CimInstance Win32_ComputerSystem;' +
  '$o=Get-CimInstance Win32_OperatingSystem;' +
  'Write-Output ([string][uint64]$c.TotalPhysicalMemory + " " + [string][uint64]$o.FreePhysicalMemory)'

const PS_CANDIDATES = [
  '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
  'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  'powershell.exe'
]

/** @type {{ totalBytes: number } | null} */
let cachedTotal = null

/**
 * @param {string} [platform]
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [kernel]
 */
export function isWslHost(platform = process.platform, env = process.env, kernel = '') {
  if (platform !== 'linux') return false
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true
  return /microsoft|wsl/i.test(kernel || release())
}

/**
 * @param {string | undefined | null} stdout
 * @returns {{ totalBytes: number, freeBytes: number } | null}
 */
export function parseWindowsMemoryPair(stdout) {
  const parts = String(stdout || '')
    .trim()
    .split(/\s+/)
    .map((p) => Number(p.replace(/[^\d.]/g, '')))
  const totalBytes = parts[0]
  const freeKb = parts[1]
  if (!Number.isFinite(totalBytes) || totalBytes < 1e9) return null
  const freeBytes = Number.isFinite(freeKb) && freeKb > 0 ? freeKb * 1024 : 0
  return { totalBytes, freeBytes }
}

/**
 * Host physical RAM from Windows CIM. Works from native Windows and from WSL
 * via powershell.exe interop. Total is cached; free is refreshed each call.
 * @param {{
 *   spawnSync?: typeof spawnSync,
 *   platform?: string,
 *   env?: NodeJS.ProcessEnv,
 *   kernel?: string,
 *   psCandidates?: string[]
 * }} [deps]
 * @returns {{ totalBytes: number, freeBytes: number } | null}
 */
export function readWindowsMemory(deps = {}) {
  const platform = deps.platform ?? process.platform
  const env = deps.env ?? process.env
  if (platform !== 'win32' && !isWslHost(platform, env, deps.kernel)) {
    return cachedTotal ? { totalBytes: cachedTotal.totalBytes, freeBytes: 0 } : null
  }
  const run = deps.spawnSync ?? spawnSync
  const candidates = deps.psCandidates ?? PS_CANDIDATES
  for (const exe of candidates) {
    try {
      const result = run(exe, ['-NoProfile', '-NonInteractive', '-Command', WIN_MEM_PS], {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true
      })
      const parsed = parseWindowsMemoryPair(result.stdout)
      if (parsed) {
        cachedTotal = { totalBytes: parsed.totalBytes }
        return parsed
      }
    } catch {
      /* try next */
    }
  }
  return cachedTotal ? { totalBytes: cachedTotal.totalBytes, freeBytes: 0 } : null
}

/**
 * Same CIM read as ``readWindowsMemory``, but never blocks the Electron main thread.
 * @param {{
 *   spawn?: typeof spawn,
 *   platform?: string,
 *   env?: NodeJS.ProcessEnv,
 *   kernel?: string,
 *   psCandidates?: string[]
 * }} [deps]
 * @returns {Promise<{ totalBytes: number, freeBytes: number } | null>}
 */
export function readWindowsMemoryAsync(deps = {}) {
  const platform = deps.platform ?? process.platform
  const env = deps.env ?? process.env
  if (platform !== 'win32' && !isWslHost(platform, env, deps.kernel)) {
    return Promise.resolve(cachedTotal ? { totalBytes: cachedTotal.totalBytes, freeBytes: 0 } : null)
  }
  const run = deps.spawn ?? spawn
  const candidates = deps.psCandidates ?? PS_CANDIDATES

  /**
   * @param {string} exe
   * @returns {Promise<{ totalBytes: number, freeBytes: number } | null>}
   */
  function spawnOne(exe) {
    return new Promise((resolve) => {
      let settled = false
      /** @param {{ totalBytes: number, freeBytes: number } | null} value */
      const done = (value) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      try {
        const child = run(exe, ['-NoProfile', '-NonInteractive', '-Command', WIN_MEM_PS], {
          windowsHide: true
        })
        let out = ''
        const timer = setTimeout(() => {
          try {
            child.kill()
          } catch {
            /* ignore */
          }
          done(null)
        }, 5000)
        child.stdout?.on('data', (chunk) => {
          out += String(chunk)
        })
        child.on('error', () => {
          clearTimeout(timer)
          done(null)
        })
        child.on('close', () => {
          clearTimeout(timer)
          done(parseWindowsMemoryPair(out))
        })
      } catch {
        done(null)
      }
    })
  }

  return (async () => {
    for (const exe of candidates) {
      const parsed = await spawnOne(exe)
      if (parsed) {
        cachedTotal = { totalBytes: parsed.totalBytes }
        return parsed
      }
    }
    return cachedTotal ? { totalBytes: cachedTotal.totalBytes, freeBytes: 0 } : null
  })()
}

/**
 * @param {{
 *   totalmem?: () => number,
 *   freemem?: () => number,
 *   windowsMemory?: { totalBytes: number, freeBytes: number } | null,
 *   platform?: string,
 *   env?: NodeJS.ProcessEnv
 * }} [deps]
 */
export function readSystemMemoryKb(deps = {}) {
  const osTotal = Math.max(0, Number(deps.totalmem?.() ?? totalmem()) || 0)
  const osFree = Math.max(0, Number(deps.freemem?.() ?? freemem()) || 0)
  const win =
    deps.windowsMemory !== undefined
      ? deps.windowsMemory
      : readWindowsMemory({ platform: deps.platform, env: deps.env })
  const winTotal = Math.max(0, Number(win?.totalBytes) || 0)
  const winFree = Math.max(0, Number(win?.freeBytes) || 0)
  const totalBytes = Math.max(osTotal, winTotal)
  const freeBytes = win && winTotal >= osTotal && winFree > 0 ? winFree : osFree
  return {
    totalKb: Math.round(totalBytes / 1024),
    freeKb: Math.round(Math.min(freeBytes, totalBytes) / 1024)
  }
}

/** @type {Promise<{ totalKb: number, freeKb: number }> | null} */
let memoryInflight = null

/**
 * Footer RAM sample. Overlapping calls share one PowerShell child.
 * @param {{
 *   totalmem?: () => number,
 *   freemem?: () => number,
 *   windowsMemory?: { totalBytes: number, freeBytes: number } | null,
 *   platform?: string,
 *   env?: NodeJS.ProcessEnv,
 *   spawn?: typeof spawn,
 *   kernel?: string,
 *   psCandidates?: string[]
 * }} [deps]
 */
export async function readSystemMemoryKbAsync(deps = {}) {
  if (deps.windowsMemory !== undefined) {
    return readSystemMemoryKb(deps)
  }
  if (memoryInflight) return memoryInflight
  memoryInflight = readWindowsMemoryAsync(deps)
    .then((windowsMemory) => readSystemMemoryKb({ ...deps, windowsMemory }))
    .finally(() => {
      memoryInflight = null
    })
  return memoryInflight
}

/** Test helper. */
export function resetWindowsInstalledCache() {
  cachedTotal = null
}
