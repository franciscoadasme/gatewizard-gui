/**
 * Versions panel: WSL release, installed app size, and the embedded micromamba env.
 * No Electron import.
 */
import { spawn } from 'child_process'
import { readFileSync, statSync } from 'fs'

const DEB_PACKAGE = 'gatewizard-gui-linux'

/**
 * @param {number | null | undefined} bytes
 * @returns {string | null}
 */
export function formatByteSize(bytes) {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unit]}`
}

/**
 * @param {string} text
 * @returns {string | null}
 */
export function parseWslVersionOutput(text) {
  const match = String(text || '').match(/WSL version:\s*(\S+)/i)
  return match ? match[1] : null
}

/**
 * @param {string} text
 * @returns {string | null}
 */
export function parseOsReleasePretty(text) {
  const match = String(text || '').match(/^PRETTY_NAME=(?:"([^"]+)"|([^\n]+))/m)
  const name = (match?.[1] || match?.[2] || '').trim()
  return name || null
}

/**
 * @param {string} text
 * @returns {number | null}
 */
export function parseDuBytes(text) {
  const match = String(text || '').trim().match(/^(\d+)/)
  if (!match) return null
  const bytes = Number(match[1])
  return Number.isFinite(bytes) ? bytes : null
}

/**
 * dpkg Installed-Size is kibibytes.
 * @param {string} text
 * @returns {number | null}
 */
export function parseDpkgInstalledBytes(text) {
  const match = String(text || '').trim().match(/^(\d+)/)
  if (!match) return null
  const kib = Number(match[1])
  return Number.isFinite(kib) ? kib * 1024 : null
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {number} [timeoutMs]
 * @returns {Promise<string>}
 */
function runCommand(command, args, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, args, { windowsHide: true })
    } catch {
      resolve('')
      return
    }
    let out = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve(out)
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => {
      out += chunk
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve('')
    })
    child.on('close', () => {
      clearTimeout(timer)
      resolve(out)
    })
  })
}

/**
 * @param {(path: string, encoding: string) => string} readFile
 * @param {string} filePath
 * @returns {string}
 */
function readText(readFile, filePath) {
  try {
    return readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

/**
 * @param {string} execPath
 * @returns {boolean}
 */
function execDirIsInstallTree(execPath) {
  const dir = execPath.replace(/\\/g, '/')
  const parent = dir.slice(0, dir.lastIndexOf('/')) || dir
  if (parent === '/usr/bin' || parent === '/bin' || parent === '/usr/local/bin') return false
  return /gatewizard/i.test(parent)
}

/**
 * @param {{
 *   platform?: string,
 *   runtimePrefix?: string,
 *   appImage?: string | null,
 *   packaged?: boolean,
 *   execPath?: string,
 *   readFile?: (path: string, encoding: string) => string,
 *   statSize?: (path: string) => number | null,
 *   run?: (command: string, args: string[], timeoutMs?: number) => Promise<string>
 * }} [opts]
 */
export async function collectInstallFootprint(opts = {}) {
  const platform = opts.platform || process.platform
  const readFile = opts.readFile || readFileSync
  const run = opts.run || runCommand
  const statSize =
    opts.statSize ||
    ((filePath) => {
      try {
        return statSync(filePath).size
      } catch {
        return null
      }
    })

  /** @type {{ version: string | null, distro: string | null } | null} */
  let wsl = null
  if (platform === 'linux') {
    const env = opts.env || process.env
    const proc = String(readText(readFile, '/proc/version') || '').toLowerCase()
    const interop = readText(readFile, '/proc/sys/fs/binfmt_misc/WSLInterop')
    const underWsl =
      Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP) ||
      proc.includes('microsoft') ||
      interop != null
    if (underWsl) {
      const distro = parseOsReleasePretty(readText(readFile, '/etc/os-release'))
      const version = parseWslVersionOutput(await run('wsl.exe', ['--version'], 4000))
      wsl = { version, distro }
    }
  }

  let appBytes = null
  if (opts.appImage) {
    appBytes = statSize(opts.appImage)
  } else if (platform === 'linux') {
    appBytes = parseDpkgInstalledBytes(
      await run('dpkg-query', ['-W', `-f=\${Installed-Size}`, DEB_PACKAGE], 4000)
    )
  }
  if (appBytes == null && opts.packaged && opts.execPath && execDirIsInstallTree(opts.execPath)) {
    const dir = opts.execPath.replace(/[/\\][^/\\]+$/, '')
    const flag = platform === 'darwin' ? '-sk' : '-sb'
    const raw = parseDuBytes(await run('du', [flag, '--', dir], 20000))
    appBytes = raw == null ? null : platform === 'darwin' ? raw * 1024 : raw
  }

  let runtimeBytes = null
  if (opts.runtimePrefix) {
    const flag = platform === 'darwin' ? '-sk' : '-sb'
    if (platform === 'win32') {
      runtimeBytes = null
    } else {
      const raw = parseDuBytes(await run('du', [flag, '--', opts.runtimePrefix], 60000))
      runtimeBytes = raw == null ? null : platform === 'darwin' ? raw * 1024 : raw
    }
  }

  return {
    wsl,
    appBytes,
    appLabel: formatByteSize(appBytes),
    runtimeBytes,
    runtimeLabel: formatByteSize(runtimeBytes),
    runtimePath: opts.runtimePrefix || null,
    runtimeKnown: platform !== 'win32' && Boolean(opts.runtimePrefix)
  }
}
