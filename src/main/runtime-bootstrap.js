/**
 * Micromamba env under userData: Python (conda-forge) + pip install backend/requirements.txt.
 *
 * Optional overrides:
 *   GATEWIZARD_PYTHON — absolute path to python (skips install)
 *   GATEWIZARD_RUNTIME_PREFIX — absolute path to existing conda env root (skips install)
 *   GATEWIZARD_FORCE_CONDA_CUDA=1 — always install conda cudatoolkit (OpenMM) on Linux
 *   GATEWIZARD_SKIP_CONDA_CUDA=1 — never install conda cudatoolkit
 *   GATEWIZARD_CONDA_GROMACS_CUDA=1 — try conda GROMACS CUDA build (slow; times out then falls back to CPU)
 */
import { spawn, spawnSync } from 'child_process'
import crypto from 'crypto'
import { app } from 'electron'
import { existsSync } from 'fs'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { createInstallProgress } from './runtime-progress.js'

const PYTHON_SPEC = '3.12'
const MICROMAMBA_TAG = '2.0.8-0'
/** Bump to reinstall / ensure ffmpeg in existing runtimes. */
const FFMPEG_CONDA_REV = '1'

/** @type {Set<import('child_process').ChildProcess>} */
const activeInstallChildren = new Set()
let installAbortRequested = false

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isPidAlive(pid) {
  if (!pid || pid === process.pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function getInstallLockPath() {
  return path.join(getGatewizardDataRoot(), 'runtime-install.lock')
}

/**
 * Kill micromamba processes targeting this env prefix (orphans from cancelled launches).
 * Does not kill PIDs currently tracked in activeInstallChildren.
 * @param {string} runtimePrefix
 * @returns {number[]} killed pids
 */
function killStaleMicromambaForPrefix(runtimePrefix) {
  const prefix = path.resolve(runtimePrefix)
  const protectedPids = new Set(
    [...activeInstallChildren].map((child) => child.pid).filter(Boolean)
  )
  protectedPids.add(process.pid)

  if (process.platform === 'win32') {
    return []
  }

  const ps = spawnSync('ps', ['-ww', '-eo', 'pid=,args='], {
    encoding: 'utf-8',
    maxBuffer: 12 * 1024 * 1024,
    windowsHide: true
  })
  if (ps.status !== 0 || !ps.stdout) return []

  /** @type {number[]} */
  const matched = []
  for (const raw of String(ps.stdout).split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const sp = line.indexOf(' ')
    if (sp < 0) continue
    const pid = Number(line.slice(0, sp))
    const args = line.slice(sp + 1)
    if (!Number.isFinite(pid) || protectedPids.has(pid)) continue
    if (!/micromamba/i.test(args)) continue
    if (!args.includes(prefix)) continue
    matched.push(pid)
  }

  /** @type {number[]} */
  const killed = []
  for (const pid of matched) {
    try {
      process.kill(pid, 'SIGTERM')
      killed.push(pid)
    } catch {
      // already gone
    }
  }
  if (killed.length === 0) return []

  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    let anyAlive = false
    for (const pid of killed) {
      if (isPidAlive(pid)) anyAlive = true
    }
    if (!anyAlive) break
    spawnSync('sleep', ['0.1'], { stdio: 'ignore' })
  }
  for (const pid of killed) {
    if (!isPidAlive(pid)) continue
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // ignore
    }
  }
  void appendRuntimeLog(
    `[runtime] killed stale micromamba pid(s): ${killed.join(', ')} (prefix=${prefix})\n`
  )
  return killed
}

/**
 * Stop in-flight conda/pip install children and orphan micromamba on the default prefix.
 * Call on app quit / user cancel so the next launch is not blocked by a leftover solver.
 * @param {string} [reason]
 */
export function abortRuntimeInstalls(reason = 'app quit') {
  installAbortRequested = true
  void appendRuntimeLog(`[runtime] aborting installs (${reason})\n`)

  for (const child of [...activeInstallChildren]) {
    const pid = child.pid
    if (!pid) continue
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true
        })
      } else {
        try {
          process.kill(pid, 'SIGTERM')
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }

  try {
    killStaleMicromambaForPrefix(getDefaultRuntimePrefix())
  } catch {
    // ignore
  }

  // Force-kill any tracked children still alive shortly after SIGTERM.
  const deadline = Date.now() + 1500
  while (Date.now() < deadline) {
    let anyAlive = false
    for (const child of activeInstallChildren) {
      if (child.pid && isPidAlive(child.pid)) anyAlive = true
    }
    if (!anyAlive) break
  }
  for (const child of [...activeInstallChildren]) {
    if (!child.pid || !isPidAlive(child.pid)) continue
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true
        })
      } else {
        process.kill(child.pid, 'SIGKILL')
      }
    } catch {
      // ignore
    }
  }
}

async function acquireInstallLock(onStatus) {
  const lockPath = getInstallLockPath()
  await fs.mkdir(path.dirname(lockPath), { recursive: true })

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, 'wx')
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2),
        'utf-8'
      )
      await handle.close()
      return
    } catch {
      let existing = null
      try {
        existing = JSON.parse(await fs.readFile(lockPath, 'utf-8'))
      } catch {
        existing = null
      }
      const holderPid = Number(existing?.pid)
      if (holderPid && holderPid !== process.pid && isPidAlive(holderPid)) {
        onStatus?.(
          attempt < 2
            ? 'Another GateWizard install is running; waiting…'
            : 'Clearing stalled install lock from a previous launch…'
        )
        // Always clear orphan micromamba; after a couple waits, steal the lock
        // (common when the UI was killed but the solver kept running).
        killStaleMicromambaForPrefix(getDefaultRuntimePrefix())
        if (attempt >= 2) {
          await fs.rm(lockPath, { force: true })
        } else {
          await sleep(1500)
        }
        continue
      }
      await fs.rm(lockPath, { force: true })
    }
  }
  throw new Error('Could not acquire runtime install lock')
}

async function releaseInstallLock() {
  const lockPath = getInstallLockPath()
  try {
    const existing = JSON.parse(await fs.readFile(lockPath, 'utf-8'))
    if (Number(existing?.pid) === process.pid) {
      await fs.rm(lockPath, { force: true })
    }
  } catch {
    await fs.rm(lockPath, { force: true }).catch(() => {})
  }
}

const MICROMAMBA_URL = {
  'linux-x64': `https://github.com/mamba-org/micromamba-releases/releases/download/${MICROMAMBA_TAG}/micromamba-linux-64`,
  'darwin-arm64': `https://github.com/mamba-org/micromamba-releases/releases/download/${MICROMAMBA_TAG}/micromamba-osx-arm64`,
  'darwin-x64': `https://github.com/mamba-org/micromamba-releases/releases/download/${MICROMAMBA_TAG}/micromamba-osx-64`,
  'win32-x64': `https://github.com/mamba-org/micromamba-releases/releases/download/${MICROMAMBA_TAG}/micromamba-win-64.exe`
}

let cachedLaunchPython = null

function getMicromambaKey() {
  const plat = process.platform
  const arch = process.arch
  if (plat === 'linux' && arch === 'x64') return 'linux-x64'
  if (plat === 'win32' && arch === 'x64') return 'win32-x64'
  if (plat === 'darwin' && arch === 'arm64') return 'darwin-arm64'
  if (plat === 'darwin' && arch === 'x64') return 'darwin-x64'
  return null
}

function getGatewizardDataRoot() {
  // macOS userData lives under "Application Support" (spaces break conda script shebangs).
  if (process.platform === 'darwin') {
    return path.join(app.getPath('home'), 'Library', 'gatewizard-gui')
  }
  return app.getPath('userData')
}

async function migrateDarwinDataRootIfNeeded() {
  if (process.platform !== 'darwin') return
  const legacy = app.getPath('userData')
  const root = getGatewizardDataRoot()
  if (path.resolve(legacy) === path.resolve(root)) return
  await fs.mkdir(root, { recursive: true })
  for (const name of ['mamba-env', 'mamba-root', 'micromamba']) {
    const from = path.join(legacy, name)
    const to = path.join(root, name)
    if (!(await fileExists(from)) || (await fileExists(to))) continue
    await fs.rename(from, to)
    if (name === 'mamba-env') {
      await rewriteCondaPrefixInTree(to, from, to)
    }
  }
}

/** Fix shebangs and metadata after moving mamba-env (scripts still point at Application Support). */
async function rewriteCondaPrefixInTree(rootDir, oldPrefix, newPrefix) {
  if (!oldPrefix || oldPrefix === newPrefix) return
  let entries
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    const full = path.join(rootDir, ent.name)
    if (ent.isDirectory()) {
      await rewriteCondaPrefixInTree(full, oldPrefix, newPrefix)
      continue
    }
    if (!ent.isFile()) continue
    let stat
    try {
      stat = await fs.stat(full)
    } catch {
      continue
    }
    if (stat.size > 5 * 1024 * 1024) continue
    let buf
    try {
      buf = await fs.readFile(full)
    } catch {
      continue
    }
    // Never rewrite binaries (.dylib, .so, etc.) — UTF-8 round-trip corrupts them.
    if (buf.includes(0)) continue
    const text = buf.toString('utf8')
    if (!text.includes(oldPrefix)) continue
    await fs.writeFile(full, text.split(oldPrefix).join(newPrefix), 'utf8')
  }
}

async function fixStaleCondaShebangsIfNeeded(onStatus) {
  if (process.platform !== 'darwin') return
  const envPrefix = getDefaultRuntimePrefix()
  if (!(await fileExists(envPrefix))) return
  const legacyPrefix = path.join(app.getPath('userData'), 'mamba-env')
  if (legacyPrefix === envPrefix) return
  const probe = path.join(envPrefix, 'bin', 'propka3')
  if (!(await fileExists(probe))) return
  let firstLine = ''
  try {
    firstLine = (await fs.readFile(probe, 'utf8')).split('\n')[0] || ''
  } catch {
    return
  }
  if (!firstLine.includes(legacyPrefix)) return
  onStatus('Updating conda environment paths after data folder move…')
  await rewriteCondaPrefixInTree(envPrefix, legacyPrefix, envPrefix)
}

function getDefaultRuntimePrefix() {
  return path.join(getGatewizardDataRoot(), 'mamba-env')
}

function getMicromambaBinPath() {
  return path.join(
    getGatewizardDataRoot(),
    'micromamba',
    MICROMAMBA_TAG,
    process.platform === 'win32' ? 'micromamba.exe' : 'micromamba'
  )
}

function getMambaRoot() {
  return path.join(getGatewizardDataRoot(), 'mamba-root')
}

/** Revision bumped when conda OpenMM GPU packages change (existing runtimes re-sync on next start). */
const OPENMM_CONDA_REV = '2'

/** Revision bumped when conda GROMACS install policy changes (existing runtimes re-sync). */
const GROMACS_CONDA_REV = '2'

/** Soft timeout for GROMACS CUDA solve — libmamba can hang for hours on CUDA conflicts. */
const GROMACS_CUDA_TIMEOUT_MS = 8 * 60 * 1000

/** True when nvidia-smi lists a GPU (Linux / WSL with NVIDIA drivers). */
function hostHasNvidiaGpu() {
  if (process.platform !== 'linux') return false
  try {
    const result = spawnSync('nvidia-smi', ['-L'], {
      encoding: 'utf-8',
      timeout: 8000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return result.status === 0 && String(result.stdout || '').trim().length > 0
  } catch {
    return false
  }
}

/**
 * conda-forge OpenMM (+ optional CUDA toolkit).
 * Full cudatoolkit is multi‑GB and often useless on WSL without an NVIDIA GPU —
 * skip it unless a GPU is visible (or GATEWIZARD_FORCE_CONDA_CUDA=1).
 */
function getCondaOpenmmGpuPackages() {
  if (process.platform === 'win32') return []
  // macOS OpenMM uses Metal, not cudatoolkit
  if (process.platform === 'darwin') return ['openmm']
  const pkgs = ['openmm']
  if (process.env.GATEWIZARD_SKIP_CONDA_CUDA === '1') return pkgs
  if (process.env.GATEWIZARD_FORCE_CONDA_CUDA === '1' || hostHasNvidiaGpu()) {
    pkgs.push('cudatoolkit')
  }
  return pkgs
}

/**
 * Matchspecs to try for GROMACS (first success wins).
 * Default: CPU build (reliable). CUDA conda builds often conflict with OpenMM's
 * cudatoolkit and hang in the solver — opt in with GATEWIZARD_CONDA_GROMACS_CUDA=1.
 * System / GMXRC installs remain selectable later via the engine version picker.
 */
function getCondaGromacsInstallAttempts() {
  if (process.platform === 'win32') return []
  if (process.platform === 'linux') {
    /** @type {{ label: string, matchspecs: string[], timeoutMs?: number, freezeInstalled?: boolean }[]} */
    const attempts = []
    // Opt-in CUDA: freeze-installed + timeout so a stuck solve cannot block first launch.
    if (
      process.env.GATEWIZARD_SKIP_CONDA_CUDA !== '1' &&
      process.env.GATEWIZARD_CONDA_GROMACS_CUDA === '1'
    ) {
      attempts.push({
        label: 'GROMACS (CUDA)',
        matchspecs: ['gromacs=*=nompi_cuda*'],
        timeoutMs: GROMACS_CUDA_TIMEOUT_MS,
        freezeInstalled: true
      })
    }
    attempts.push({
      label: 'GROMACS (CPU)',
      matchspecs: ['gromacs'],
      freezeInstalled: true
    })
    return attempts
  }
  // macOS: CPU builds only on conda-forge
  return [{ label: 'GROMACS (CPU)', matchspecs: ['gromacs'], freezeInstalled: true }]
}

/** Lightweight base env — OpenMM/CUDA install in a later step so create stays smaller. */
function getCondaBasePackages() {
  // ffmpeg: animation export (MP4/WebM/MOV/GIF). Available on conda-forge for
  // linux / macOS / win-64; Windows GUI users typically run via WSL (linux env).
  const pkgs = [`python=${PYTHON_SPEC}`, 'pip', 'openssl', 'ffmpeg']
  if (process.platform !== 'win32') {
    pkgs.push('git')
  }
  return pkgs
}

/**
 * Candidate paths for ffmpeg inside a conda/micromamba prefix.
 * @param {string} prefix
 * @returns {string[]}
 */
function ffmpegCandidatesInPrefix(prefix) {
  const root = path.resolve(prefix)
  if (process.platform === 'win32') {
    return [
      path.join(root, 'Library', 'bin', 'ffmpeg.exe'),
      path.join(root, 'Scripts', 'ffmpeg.exe'),
      path.join(root, 'bin', 'ffmpeg.exe')
    ]
  }
  return [path.join(root, 'bin', 'ffmpeg')]
}

/**
 * Resolve ffmpeg: embedded runtime first, then system PATH.
 * @returns {string} Absolute path or bare `ffmpeg` for PATH lookup
 */
export function resolveFfmpegBinary() {
  /** @type {string[]} */
  const prefixes = []
  if (process.env.CONDA_PREFIX) prefixes.push(process.env.CONDA_PREFIX)
  if (process.env.GATEWIZARD_RUNTIME_PREFIX) {
    prefixes.push(path.resolve(process.env.GATEWIZARD_RUNTIME_PREFIX))
  }
  prefixes.push(getDefaultRuntimePrefix())
  const py = cachedLaunchPython || process.env.GATEWIZARD_PYTHON
  if (py) {
    const inferred = inferCondaPrefixFromPython(py)
    if (inferred) prefixes.push(inferred)
  }
  const seen = new Set()
  for (const prefix of prefixes) {
    if (!prefix || seen.has(prefix)) continue
    seen.add(prefix)
    for (const candidate of ffmpegCandidatesInPrefix(prefix)) {
      if (existsSync(candidate)) return candidate
    }
  }
  return 'ffmpeg'
}

async function installCondaFfmpeg(micromambaDest, runtimePrefix, mmEnv, onStatus) {
  onStatus('Installing FFmpeg (animation export) from conda-forge…')
  await appendRuntimeLog(
    `[ffmpeg] starting conda install (prefix=${path.resolve(runtimePrefix)})\n`
  )
  await runProcess(
    micromambaDest,
    ['install', '-p', runtimePrefix, '-c', 'conda-forge', 'ffmpeg', '-y'],
    { env: mmEnv, lowPriority: true, label: 'ffmpeg' }
  )
  const bin = ffmpegCandidatesInPrefix(runtimePrefix).find((p) => existsSync(p))
  if (!bin) {
    throw new Error(`ffmpeg installed but binary not found under ${runtimePrefix}`)
  }
  onStatus(`FFmpeg ready (${bin})`)
  await appendRuntimeLog(`[ffmpeg] installed → ${bin}\n`)
  return bin
}

async function syncCondaFfmpegIfNeeded({
  micromambaDest,
  runtimePrefix,
  mmEnv,
  onStatus,
  state,
  statePath,
  extraState = {}
}) {
  const already =
    state.ffmpegCondaRev === FFMPEG_CONDA_REV &&
    ffmpegCandidatesInPrefix(runtimePrefix).some((p) => existsSync(p))
  if (!already) {
    await installCondaFfmpeg(micromambaDest, runtimePrefix, mmEnv, onStatus)
  }
  const nextState = {
    ...state,
    ...extraState,
    ffmpegCondaRev: FFMPEG_CONDA_REV
  }
  if (JSON.stringify(nextState) === JSON.stringify(state)) return state
  await fs.writeFile(statePath, JSON.stringify(nextState, null, 2), 'utf-8')
  return nextState
}

function getCondaAmbertoolsPackages() {
  // AmberTools is not published for win-64 on conda-forge; use WSL/Linux for tleap workflows.
  if (process.platform === 'win32') return []
  return ['ambertools']
}

/** Cap extract parallelism so WSL/desktop stay usable during huge conda installs. */
function getMicromambaPerfEnv() {
  const cpus = typeof os.cpus === 'function' ? os.cpus().length : 4
  const extractThreads = String(Math.max(1, Math.min(2, Math.max(1, cpus - 1))))
  return {
    MAMBA_EXTRACT_THREADS: extractThreads,
    OMP_NUM_THREADS: extractThreads
  }
}

function getRuntimeInstallLogPath() {
  return path.join(getGatewizardDataRoot(), 'runtime-install.log')
}

async function appendRuntimeLog(text) {
  const logPath = getRuntimeInstallLogPath()
  await fs.appendFile(logPath, text, 'utf-8')
}

/** Human-readable duration for runtime-install.log summaries. */
function formatInstallElapsed(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/** Hide console windows on Windows; pipe output to the install log. */
function getSubprocessOptions(runtimePrefix, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv }
  if (runtimePrefix) {
    env.CONDA_PREFIX = runtimePrefix
  }
  // Homebrew / user shell PYTHONPATH can inject incompatible ssl or urllib3 into pip.
  delete env.PYTHONPATH
  delete env.PYTHONHOME
  delete env.PYTHONUSERBASE
  return {
    encoding: 'utf-8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env
  }
}

function attachOutputLogging(child) {
  child.stdout?.on('data', (chunk) => {
    void appendRuntimeLog(chunk.toString())
  })
  child.stderr?.on('data', (chunk) => {
    void appendRuntimeLog(chunk.toString())
  })
}

function probePythonSsl(pyPath, runtimePrefix) {
  const result = spawnSync(
    pyPath,
    ['-c', 'import ssl; print(ssl.OPENSSL_VERSION)'],
    getSubprocessOptions(runtimePrefix)
  )
  const combined = `${result.stdout || ''}${result.stderr || ''}`
  return (
    result.status === 0 &&
    String(result.stdout || '').trim().length > 0 &&
    !combined.includes('SSL module is not available') &&
    !combined.includes('not a mach-o file')
  )
}

async function removeCorruptedRuntime(onStatus) {
  const envPath = getDefaultRuntimePrefix()
  const statePath = getStatePath()
  onStatus('Removing corrupted Python environment (will reinstall on next step)…')
  await appendRuntimeLog(`\n[repair] Removing corrupted runtime at ${envPath}\n`)
  await fs.rm(envPath, { recursive: true, force: true })
  await fs.rm(statePath, { force: true })
  cachedLaunchPython = null
}

/**
 * Verify embedded Python can use HTTPS; repair openssl or wipe env if libraries are corrupt.
 * @returns {Promise<boolean>} false when the env was removed and must be recreated
 */
async function ensurePythonSsl(pyPath, runtimePrefix, micromambaDest, mmEnv, onStatus) {
  if (probePythonSsl(pyPath, runtimePrefix)) return true

  await appendRuntimeLog('\n[ssl] Python SSL probe failed; attempting conda openssl repair\n')
  onStatus('Repairing Python SSL (OpenSSL)…')
  try {
    await runProcess(
      micromambaDest,
      ['install', '-p', runtimePrefix, '-c', 'conda-forge', 'openssl', '-y'],
      { env: mmEnv }
    )
  } catch (err) {
    await appendRuntimeLog(`[ssl] openssl conda install failed: ${err.message}\n`)
  }

  if (probePythonSsl(pyPath, runtimePrefix)) return true

  await removeCorruptedRuntime(onStatus)
  return false
}

function formatPipSslHint(output) {
  if (
    !output.includes('SSL module is not available') &&
    !output.includes('ssl support is missing')
  ) {
    return ''
  }
  const root = getGatewizardDataRoot()
  return (
    '\n\nPython SSL/OpenSSL in the embedded environment is broken (often after a bad ' +
    'migration or iCloud sync of ~/Library/gatewizard-gui).\n' +
    `Quit GateWizard, then run: rm -rf "${root}/mamba-env" and relaunch the app.\n` +
    'If it persists, exclude ~/Library/gatewizard-gui from iCloud Desktop & Documents sync.'
  )
}

/**
 * @param {string} pyPath
 * @param {string[]} pipArgs
 * @param {string} runtimePrefix
 * @param {{ label: string, required?: boolean }} options
 */
async function runPip(pyPath, pipArgs, runtimePrefix, options) {
  const { label, required = true } = options
  const stamp = new Date().toISOString()
  await appendRuntimeLog(`\n[${stamp}] ${label}\n> pip ${pipArgs.join(' ')}\n`)

  const result = spawnSync(pyPath, ['-m', 'pip', ...pipArgs], getSubprocessOptions(runtimePrefix))

  const output = `${result.stdout || ''}${result.stderr || ''}`
  if (output) {
    await appendRuntimeLog(output)
  }

  if (result.status !== 0) {
    const logPath = getRuntimeInstallLogPath()
    const tail = output.trim().slice(-3000)
    const sslHint = formatPipSslHint(output)
    const message = `${label} failed.\nLog: ${logPath}${tail ? `\n\n${tail}` : ''}${sslHint}`
    if (required) {
      throw new Error(message)
    }
    await appendRuntimeLog(`[warning] ${message}\n`)
    return false
  }
  return true
}

function getOrientationRequirementsPath(requirementsPath) {
  return path.join(path.dirname(requirementsPath), 'requirements-orientation.txt')
}

/**
 * MemPrO is optional — failure must not block the GUI from starting.
 */
async function installOptionalOrientationRequirements(pyPath, requirementsPath, runtimePrefix, onStatus) {
  if (process.platform === 'win32') {
    onStatus('Skipping MemPrO (optional; use WSL/Linux for orientation).')
    return
  }

  const orientPath = getOrientationRequirementsPath(requirementsPath)
  if (!(await fileExists(orientPath))) {
    return
  }

  onStatus('Installing optional MemPrO (orientation)...')
  const ok = await runPip(
    pyPath,
    ['install', '-r', orientPath],
    runtimePrefix,
    { label: 'pip install -r requirements-orientation.txt (optional)', required: false }
  )
  if (ok) {
    onStatus('MemPrO installed (orientation features available).')
  } else {
    onStatus('MemPrO install failed — orientation features disabled. See runtime-install.log.')
  }
}

async function ensureMicromambaBinary(onStatus) {
  const key = getMicromambaKey()
  if (!key || !MICROMAMBA_URL[key]) {
    throw new Error(
      `This platform (${process.platform} ${process.arch}) has no micromamba URL. Set GATEWIZARD_RUNTIME_PREFIX or GATEWIZARD_PYTHON.`
    )
  }
  const micromambaDest = getMicromambaBinPath()
  await fs.mkdir(path.dirname(micromambaDest), { recursive: true })
  if (!(await fileExists(micromambaDest))) {
    onStatus(`Downloading micromamba ${MICROMAMBA_TAG}...`)
    await downloadFile(MICROMAMBA_URL[key], micromambaDest)
    if (process.platform !== 'win32') {
      await fs.chmod(micromambaDest, 0o755)
    }
  }
  return micromambaDest
}

async function installCondaOpenmmGpu(micromambaDest, runtimePrefix, mmEnv, onStatus) {
  const gpuPkgs = getCondaOpenmmGpuPackages()
  if (!gpuPkgs.length) return
  await appendRuntimeLog(
    `[openmm] starting conda install (${gpuPkgs.join(', ')}; prefix=${path.resolve(runtimePrefix)})\n`
  )
  onStatus(`Ensuring OpenMM via conda (${gpuPkgs.join(', ')})...`)
  await runProcess(
    micromambaDest,
    ['install', '-p', runtimePrefix, '-c', 'conda-forge', ...gpuPkgs, '-y'],
    { env: mmEnv, lowPriority: true, label: 'openmm' }
  )
  await appendRuntimeLog(`[openmm] conda install finished\n`)
}

async function syncCondaOpenmmGpuIfNeeded({
  micromambaDest,
  runtimePrefix,
  mmEnv,
  onStatus,
  state,
  statePath,
  extraState = {}
}) {
  const nextState =
    process.platform === 'win32'
      ? { ...state, ...extraState }
      : { ...state, ...extraState, openmmCondaRev: OPENMM_CONDA_REV }
  if (process.platform !== 'win32' && state.openmmCondaRev !== OPENMM_CONDA_REV) {
    await installCondaOpenmmGpu(micromambaDest, runtimePrefix, mmEnv, onStatus)
  }
  if (JSON.stringify(nextState) === JSON.stringify(state)) return state
  await fs.writeFile(statePath, JSON.stringify(nextState, null, 2), 'utf-8')
  return nextState
}

async function restoreCondaOpenmmAfterPip(micromambaDest, runtimePrefix, mmEnv, onStatus) {
  // pip install gatewizard[full] may replace conda openmm with a CPU-only wheel
  if (process.platform === 'win32') return
  await installCondaOpenmmGpu(micromambaDest, runtimePrefix, mmEnv, onStatus)
}

/**
 * Install conda-forge GROMACS into the embedded runtime.
 * Default is CPU (reliable). CUDA is opt-in and time-bounded — not an EULA prompt
 * (installs already use -y); hangs come from the dependency solver vs OpenMM/CUDA.
 */
async function installCondaGromacs(micromambaDest, runtimePrefix, mmEnv, onStatus) {
  const attempts = getCondaGromacsInstallAttempts()
  if (!attempts.length) {
    onStatus('Skipping conda GROMACS on native Windows (use WSL or a system gmx).')
    return { installed: false, variant: null }
  }

  // Clear leftover solvers before starting (e.g. user quit mid-install last time).
  killStaleMicromambaForPrefix(runtimePrefix)

  let lastError = null
  for (const attempt of attempts) {
    if (installAbortRequested) {
      throw new Error('Runtime install aborted')
    }
    const timeoutMs = Number(attempt.timeoutMs) || 0
    const timeoutMin = timeoutMs > 0 ? Math.round(timeoutMs / 60000) : 0
    await appendRuntimeLog(
      `[gromacs] starting ${attempt.label} ` +
        `(matchspecs: ${attempt.matchspecs.join(' ')}; ` +
        `freezeInstalled=${Boolean(attempt.freezeInstalled)}; ` +
        `timeoutMs=${timeoutMs || 'none'}; ` +
        `prefix=${path.resolve(runtimePrefix)})\n`
    )
    if (attempt.label.includes('CUDA')) {
      await appendRuntimeLog(
        `[gromacs] note: CUDA conda builds often conflict with OpenMM's cudatoolkit; ` +
          `this is not an interactive EULA prompt (-y is already set). ` +
          `If the solve exceeds ${timeoutMin} min, GateWizard falls back to CPU GROMACS.\n`
      )
      onStatus(
        `Trying ${attempt.label} (up to ${timeoutMin} min, then CPU fallback)…`
      )
    } else {
      onStatus(`Installing ${attempt.label} from conda-forge…`)
    }
    try {
      /** @type {string[]} */
      const args = ['install', '-p', runtimePrefix, '-c', 'conda-forge']
      if (attempt.freezeInstalled) args.push('--freeze-installed')
      args.push(...attempt.matchspecs, '-y')
      await runProcess(micromambaDest, args, {
        env: mmEnv,
        lowPriority: true,
        label: `gromacs:${attempt.label}`,
        timeoutMs: timeoutMs || undefined
      })
      const gmxBin =
        process.platform === 'win32'
          ? path.join(runtimePrefix, 'Library', 'bin', 'gmx.exe')
          : path.join(runtimePrefix, 'bin', 'gmx')
      if (!(await fileExists(gmxBin))) {
        throw new Error(`${attempt.label} installed but gmx binary not found at ${gmxBin}`)
      }
      onStatus(`${attempt.label} ready (${gmxBin})`)
      await appendRuntimeLog(`[gromacs] installed ${attempt.label} → ${gmxBin}\n`)
      return {
        installed: true,
        variant: attempt.label.includes('CUDA') ? 'cuda' : 'cpu'
      }
    } catch (err) {
      lastError = err
      await appendRuntimeLog(
        `[gromacs] ${attempt.label} failed: ${err.message}\n`
      )
      if (installAbortRequested) throw err
      onStatus(`${attempt.label} unavailable; trying next option…`)
    }
  }

  onStatus(
    `Could not install conda GROMACS (${lastError?.message || 'unknown error'}). ` +
      'Equilibration can still use a system gmx if available on PATH.'
  )
  return { installed: false, variant: null }
}

async function syncCondaGromacsIfNeeded({
  micromambaDest,
  runtimePrefix,
  mmEnv,
  onStatus,
  state,
  statePath,
  extraState = {}
}) {
  if (process.platform === 'win32') {
    const nextState = { ...state, ...extraState }
    if (JSON.stringify(nextState) === JSON.stringify(state)) return state
    await fs.writeFile(statePath, JSON.stringify(nextState, null, 2), 'utf-8')
    return nextState
  }

  let gromacsVariant = state.gromacsCondaVariant || null
  if (state.gromacsCondaRev !== GROMACS_CONDA_REV) {
    const result = await installCondaGromacs(micromambaDest, runtimePrefix, mmEnv, onStatus)
    gromacsVariant = result.variant
  }

  const nextState = {
    ...state,
    ...extraState,
    gromacsCondaRev: GROMACS_CONDA_REV,
    gromacsCondaVariant: gromacsVariant
  }
  if (JSON.stringify(nextState) === JSON.stringify(state)) return state
  await fs.writeFile(statePath, JSON.stringify(nextState, null, 2), 'utf-8')
  return nextState
}

function getStatePath() {
  return path.join(getGatewizardDataRoot(), 'runtime-state.json')
}

function getWindowsPythonCandidates(prefix) {
  return [
    path.join(prefix, 'python.exe'),
    path.join(prefix, 'Scripts', 'python.exe'),
    path.join(prefix, 'Library', 'bin', 'python.exe')
  ]
}

async function findPythonInPrefix(prefix) {
  if (process.platform === 'win32') {
    for (const candidate of getWindowsPythonCandidates(prefix)) {
      if (await fileExists(candidate)) return candidate
    }
    return null
  }
  for (const name of ['python3', 'python']) {
    const p = path.join(prefix, 'bin', name)
    if (await fileExists(p)) return p
  }
  return null
}

export function inferCondaPrefixFromPython(pythonPath) {
  const resolved = path.resolve(pythonPath)
  const dir = path.dirname(resolved)
  const base = path.basename(dir)
  if (base === 'bin' || base === 'Scripts') {
    return path.dirname(dir)
  }
  if (process.platform === 'win32' && path.basename(resolved).toLowerCase() === 'python.exe') {
    return dir
  }
  return null
}

async function fileExists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function sha256String(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

async function downloadFile(url, destPath) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status} for ${url}`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  await fs.writeFile(destPath, buffer)
}

function runProcess(command, args, options = {}) {
  const env = { ...process.env, ...(options.env || {}) }
  const runtimePrefix = env.CONDA_PREFIX || ''
  const label = options.label || path.basename(command)
  const timeoutMs = Number(options.timeoutMs) || 0
  return new Promise((resolve, reject) => {
    if (installAbortRequested) {
      reject(new Error(`Runtime install aborted before ${label}`))
      return
    }
    const child = spawn(command, args, getSubprocessOptions(runtimePrefix, env))
    activeInstallChildren.add(child)
    attachOutputLogging(child)
    // Lower priority so splash / desktop stay responsive during multi‑GB conda extracts.
    if (options.lowPriority && process.platform !== 'win32' && child.pid) {
      try {
        spawnSync('renice', ['+15', '-p', String(child.pid)], {
          stdio: 'ignore',
          windowsHide: true
        })
      } catch {
        // ignore — renice may require privileges on some hosts
      }
    }

    let timedOut = false
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timeoutId = null
    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true
        void appendRuntimeLog(
          `[runtime] timeout after ${timeoutMs}ms — stopping ${label} (pid=${child.pid || '?'})\n`
        )
        if (!child.pid) return
        try {
          if (process.platform === 'win32') {
            spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
              stdio: 'ignore',
              windowsHide: true
            })
          } else {
            process.kill(child.pid, 'SIGTERM')
            setTimeout(() => {
              try {
                if (isPidAlive(child.pid)) process.kill(child.pid, 'SIGKILL')
              } catch {
                // ignore
              }
            }, 2000)
          }
        } catch {
          // ignore
        }
      }, timeoutMs)
    }

    const onAbortCheck = setInterval(() => {
      if (!installAbortRequested) return
      clearInterval(onAbortCheck)
      if (!child.pid) return
      try {
        if (process.platform === 'win32') {
          spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true
          })
        } else {
          process.kill(child.pid, 'SIGTERM')
        }
      } catch {
        // ignore
      }
    }, 250)

    child.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId)
      clearInterval(onAbortCheck)
      activeInstallChildren.delete(child)
      if (installAbortRequested) {
        reject(new Error(`Runtime install aborted during ${label}`))
        return
      }
      if (timedOut) {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`))
        return
      }
      if (code === 0) resolve()
      else reject(new Error(`${path.basename(command)} exited with code ${code}`))
    })
    child.on('error', (err) => {
      if (timeoutId) clearTimeout(timeoutId)
      clearInterval(onAbortCheck)
      activeInstallChildren.delete(child)
      reject(err)
    })
  })
}

function parseVcsRequirements(requirementsText) {
  return requirementsText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .filter((line) => line.includes(' @ git+'))
}

function forceReinstallVcsRequirements(pyPath, requirementsText, runtimePrefix) {
  const vcsReqs = parseVcsRequirements(requirementsText)
  if (vcsReqs.length === 0) return

  for (const req of vcsReqs) {
    const pipVcs = spawnSync(
      pyPath,
      ['-m', 'pip', 'install', '--force-reinstall', '--no-deps', req],
      getSubprocessOptions(runtimePrefix)
    )
    if (pipVcs.status !== 0) {
      throw new Error(`pip force reinstall failed for VCS requirement: ${req}`)
    }
  }
}

/**
 * @param {{
 *   requirementsPath: string,
 *   onStatus?: (msg: string) => void,
 *   onProgress?: (update: import('./runtime-progress.js').ProgressUpdate) => void
 * }} options
 */
export async function ensureMambaRuntime(options) {
  const onStatus = options.onStatus || (() => {})
  const requirementsPath = options.requirementsPath

  let lastStatusMessage = null
  const progress = createInstallProgress((update) => {
    // Heartbeat re-emits the same message for splash % creep — only notify onStatus on change.
    if (update.message !== lastStatusMessage) {
      lastStatusMessage = update.message
      onStatus(update.message)
    }
    options.onProgress?.(update)
  })

  let lockHeld = false
  installAbortRequested = false
  const installStartedAt = Date.now()

  try {
    await migrateDarwinDataRootIfNeeded()
    await fixStaleCondaShebangsIfNeeded((msg) => progress.note(msg))

    if (process.env.GATEWIZARD_PYTHON) {
      progress.begin('external')
      cachedLaunchPython = process.env.GATEWIZARD_PYTHON
      const inferred = inferCondaPrefixFromPython(cachedLaunchPython)
      if (inferred) {
        process.env.CONDA_PREFIX = inferred
      }
      progress.done(`Using GATEWIZARD_PYTHON: ${cachedLaunchPython}`)
      return
    }

    if (process.env.GATEWIZARD_RUNTIME_PREFIX) {
      progress.begin('external')
      const prefix = path.resolve(process.env.GATEWIZARD_RUNTIME_PREFIX)
      const py = await findPythonInPrefix(prefix)
      if (!py) {
        throw new Error(`GATEWIZARD_RUNTIME_PREFIX: no Python found under ${prefix}`)
      }
      cachedLaunchPython = py
      process.env.CONDA_PREFIX = prefix
      progress.done(`Using GATEWIZARD_RUNTIME_PREFIX: ${prefix}`)
      return
    }

    const requirementsText = await fs.readFile(requirementsPath, 'utf-8')
    const requirementsHash = await sha256String(requirementsText)

    const key = getMicromambaKey()
    if (!key || !MICROMAMBA_URL[key]) {
      throw new Error(
        `This platform (${process.platform} ${process.arch}) has no micromamba URL. Set GATEWIZARD_RUNTIME_PREFIX or GATEWIZARD_PYTHON.`
      )
    }

    const runtimePrefix = getDefaultRuntimePrefix()
    // Prevent two micromamba solvers on the same env (common after cancelling a long install).
    const stale = killStaleMicromambaForPrefix(runtimePrefix)
    if (stale.length) {
      progress.note(
        `Stopped ${stale.length} leftover install process(es) from a previous launch…`
      )
    }
    await acquireInstallLock((msg) => progress.note(msg))
    lockHeld = true
    await appendRuntimeLog(
      `[runtime] install lock acquired (pid=${process.pid}, prefix=${runtimePrefix})\n`
    )

    const statePath = getStatePath()
    let state = {}
    if (await fileExists(statePath)) {
      try {
        state = JSON.parse(await fs.readFile(statePath, 'utf-8'))
      } catch {
        state = {}
      }
    }

    const mambaRoot = getMambaRoot()
    const mmEnv = {
      ...process.env,
      MAMBA_ROOT_PREFIX: mambaRoot,
      ...getMicromambaPerfEnv()
    }

    let pyPath = await findPythonInPrefix(runtimePrefix)
    if (pyPath) {
      // Lightweight check before choosing cold / pipUpdate / cached mode.
      progress.begin('cached', 'Checking Python environment…')
      progress.enter('sync', 'Verifying runtime…')
      const micromambaDest = await ensureMicromambaBinary((msg) => progress.note(msg))
      const sslOk = await ensurePythonSsl(
        pyPath,
        runtimePrefix,
        micromambaDest,
        mmEnv,
        (msg) => progress.note(msg)
      )
      if (!sslOk) {
        pyPath = null
        state = {}
      }
    }

    const condaOk = pyPath && state.python === PYTHON_SPEC && state.micromambaTag === MICROMAMBA_TAG

    const envReady = condaOk && state.requirementsHash === requirementsHash

    if (envReady) {
      const needsFfmpeg =
        state.ffmpegCondaRev !== FFMPEG_CONDA_REV ||
        !ffmpegCandidatesInPrefix(runtimePrefix).some((p) => existsSync(p))
      const needsOpenmm =
        process.platform !== 'win32' && state.openmmCondaRev !== OPENMM_CONDA_REV
      const needsGromacs =
        process.platform !== 'win32' && state.gromacsCondaRev !== GROMACS_CONDA_REV
      if (needsFfmpeg || needsOpenmm || needsGromacs) {
        progress.begin('cached', 'Syncing conda packages…')
        const micromambaDest = await ensureMicromambaBinary((msg) => progress.note(msg))
        if (needsFfmpeg) {
          progress.enter('sync', 'Installing FFmpeg…')
          state = await syncCondaFfmpegIfNeeded({
            micromambaDest,
            runtimePrefix,
            mmEnv,
            onStatus: (msg) => progress.note(msg),
            state,
            statePath
          })
        }
        if (needsOpenmm) {
          progress.enter('sync', 'Refreshing OpenMM…')
          state = await syncCondaOpenmmGpuIfNeeded({
            micromambaDest,
            runtimePrefix,
            mmEnv,
            onStatus: (msg) => progress.note(msg),
            state,
            statePath
          })
        }
        if (needsGromacs) {
          progress.enter('sync', 'Refreshing GROMACS…')
          state = await syncCondaGromacsIfNeeded({
            micromambaDest,
            runtimePrefix,
            mmEnv,
            onStatus: (msg) => progress.note(msg),
            state,
            statePath
          })
        }
      }
      cachedLaunchPython = pyPath
      process.env.CONDA_PREFIX = runtimePrefix
      progress.done(`Runtime ready (cached): ${runtimePrefix}`)
      return
    }

    if (condaOk && state.requirementsHash !== requirementsHash) {
      progress.begin('pipUpdate')
      progress.enter('pip_tools', 'Updating pip dependencies (requirements.txt changed)…')
      await runPip(
        pyPath,
        ['install', '--upgrade', 'pip', 'setuptools', 'wheel'],
        runtimePrefix,
        { label: 'pip upgrade (tools)' }
      )
      progress.enter('pip_reqs', 'Installing updated Python packages…')
      await runPip(
        pyPath,
        ['install', '-r', requirementsPath],
        runtimePrefix,
        { label: 'pip install -r requirements.txt' }
      )
      forceReinstallVcsRequirements(pyPath, requirementsText, runtimePrefix)
      progress.enter('mempro')
      await installOptionalOrientationRequirements(
        pyPath,
        requirementsPath,
        runtimePrefix,
        (msg) => progress.note(msg)
      )
      const micromambaDest = await ensureMicromambaBinary((msg) => progress.note(msg))
      progress.enter('openmm')
      await restoreCondaOpenmmAfterPip(
        micromambaDest,
        runtimePrefix,
        mmEnv,
        (msg) => progress.note(msg)
      )
      state = await syncCondaOpenmmGpuIfNeeded({
        micromambaDest,
        runtimePrefix,
        mmEnv,
        onStatus: (msg) => progress.note(msg),
        state,
        statePath,
        extraState: {
          python: PYTHON_SPEC,
          micromambaTag: MICROMAMBA_TAG,
          requirementsHash,
          runtimePrefix
        }
      })
      progress.enter('gromacs')
      state = await syncCondaGromacsIfNeeded({
        micromambaDest,
        runtimePrefix,
        mmEnv,
        onStatus: (msg) => progress.note(msg),
        state,
        statePath
      })
      progress.enter('ffmpeg')
      state = await syncCondaFfmpegIfNeeded({
        micromambaDest,
        runtimePrefix,
        mmEnv,
        onStatus: (msg) => progress.note(msg),
        state,
        statePath
      })
      cachedLaunchPython = pyPath
      process.env.CONDA_PREFIX = runtimePrefix
      progress.done(`Runtime ready: ${runtimePrefix}`)
      return
    }

    progress.begin(
      'cold',
      'Installing runtime (first launch may take several minutes)…'
    )
    if (process.platform === 'win32') {
      progress.note(
        'Note: AmberTools is not installed on native Windows — use WSL for membrane building.'
      )
    } else if (getCondaOpenmmGpuPackages().includes('cudatoolkit')) {
      progress.note(
        'Will install OpenMM (CUDA) and GROMACS (CPU). Set GATEWIZARD_CONDA_GROMACS_CUDA=1 to try CUDA GROMACS.'
      )
    } else if (process.platform === 'darwin') {
      progress.note('Will install OpenMM (Metal/OpenCL) and GROMACS (CPU)…')
    } else if (process.platform === 'linux') {
      progress.note(
        'No NVIDIA GPU detected — installing OpenMM without conda cudatoolkit (set GATEWIZARD_FORCE_CONDA_CUDA=1 to force).'
      )
    }

    progress.enter('micromamba')
    const micromambaDest = await ensureMicromambaBinary((msg) => progress.note(msg))

    await fs.mkdir(mambaRoot, { recursive: true })

    const basePkgs = getCondaBasePackages()
    const amberPkgs = getCondaAmbertoolsPackages()

    if (!(await fileExists(runtimePrefix))) {
      progress.enter('env', `Creating environment: ${basePkgs.join(', ')}…`)
      await appendRuntimeLog(
        `[runtime] creating env packages=[${basePkgs.join(', ')}] prefix=${runtimePrefix}\n`
      )
      await runProcess(
        micromambaDest,
        ['create', '-p', runtimePrefix, '-c', 'conda-forge', ...basePkgs, '-y'],
        { env: mmEnv, lowPriority: true, label: 'conda-create' }
      )
      if (amberPkgs.length) {
        progress.note(
          'Installing AmberTools (large download)…'
        )
        await appendRuntimeLog(`[runtime] starting AmberTools install\n`)
        await runProcess(
          micromambaDest,
          ['install', '-p', runtimePrefix, '-c', 'conda-forge', ...amberPkgs, '-y'],
          { env: mmEnv, lowPriority: true, label: 'ambertools' }
        )
      }
    } else {
      progress.enter('env', 'Updating Python / base conda packages…')
      await runProcess(
        micromambaDest,
        ['install', '-p', runtimePrefix, '-c', 'conda-forge', ...basePkgs, ...amberPkgs, '-y'],
        { env: mmEnv, lowPriority: true, label: 'conda-update-base' }
      )
    }

    const pyResolved = await findPythonInPrefix(runtimePrefix)
    if (!pyResolved) {
      throw new Error(`Python missing after install under ${runtimePrefix}`)
    }

    progress.enter('pip_tools', 'Upgrading pip tools…')
    await runPip(
      pyResolved,
      ['install', '--upgrade', 'pip', 'setuptools', 'wheel'],
      runtimePrefix,
      { label: 'pip upgrade (tools)' }
    )
    progress.enter('pip_reqs', 'Installing Python packages (requirements.txt)…')
    await runPip(
      pyResolved,
      ['install', '-r', requirementsPath],
      runtimePrefix,
      { label: 'pip install -r requirements.txt' }
    )
    forceReinstallVcsRequirements(pyResolved, requirementsText, runtimePrefix)
    progress.enter('mempro')
    await installOptionalOrientationRequirements(
      pyResolved,
      requirementsPath,
      runtimePrefix,
      (msg) => progress.note(msg)
    )
    progress.enter('openmm')
    await restoreCondaOpenmmAfterPip(
      micromambaDest,
      runtimePrefix,
      mmEnv,
      (msg) => progress.note(msg)
    )
    progress.enter('gromacs')
    state = await syncCondaGromacsIfNeeded({
      micromambaDest,
      runtimePrefix,
      mmEnv,
      onStatus: (msg) => progress.note(msg),
      state: {
        python: PYTHON_SPEC,
        micromambaTag: MICROMAMBA_TAG,
        requirementsHash,
        runtimePrefix,
        openmmCondaRev: OPENMM_CONDA_REV
      },
      statePath
    })
    progress.enter('ffmpeg')
    state = await syncCondaFfmpegIfNeeded({
      micromambaDest,
      runtimePrefix,
      mmEnv,
      onStatus: (msg) => progress.note(msg),
      state,
      statePath
    })

    await fs.writeFile(
      statePath,
      JSON.stringify(
        {
          python: PYTHON_SPEC,
          micromambaTag: MICROMAMBA_TAG,
          requirementsHash,
          runtimePrefix,
          openmmCondaRev: OPENMM_CONDA_REV,
          gromacsCondaRev: state.gromacsCondaRev ?? GROMACS_CONDA_REV,
          gromacsCondaVariant: state.gromacsCondaVariant ?? null,
          ffmpegCondaRev: state.ffmpegCondaRev ?? FFMPEG_CONDA_REV
        },
        null,
        2
      ),
      'utf-8'
    )

    cachedLaunchPython = pyResolved
    process.env.CONDA_PREFIX = runtimePrefix
    progress.done(`Runtime ready: ${runtimePrefix}`)
  } finally {
    progress.dispose()
    if (lockHeld) {
      await releaseInstallLock()
      const elapsedMs = Date.now() - installStartedAt
      const elapsedLabel = formatInstallElapsed(elapsedMs)
      await appendRuntimeLog(
        `[runtime] install lock released (pid=${process.pid})\n` +
          `[runtime] elapsed installation time: ${elapsedLabel} (${elapsedMs} ms)\n`
      )
    }
  }
}

function readGatewizardInstallSpec(requirementsText, overrideSpec) {
  if (overrideSpec?.trim()) return overrideSpec.trim()
  const vcsReqs = parseVcsRequirements(requirementsText).filter((req) =>
    req.toLowerCase().startsWith('gatewizard')
  )
  if (vcsReqs.length > 0) return vcsReqs[0]
  const line = requirementsText
    .split(/\r?\n/)
    .map((row) => row.trim())
    .find((row) => row && !row.startsWith('#') && row.toLowerCase().startsWith('gatewizard'))
  return line ?? null
}

/**
 * Upgrade the gatewizard Python package in the embedded runtime.
 * @param {{ requirementsPath: string, installSpec?: string, onStatus?: (msg: string) => void }} options
 */
export async function upgradeGatewizardPackage(options) {
  const onStatus = options.onStatus || (() => {})
  const requirementsPath = options.requirementsPath
  const requirementsText = await fs.readFile(requirementsPath, 'utf-8')
  const installSpec = readGatewizardInstallSpec(requirementsText, options.installSpec)

  if (!installSpec) {
    throw new Error('No gatewizard install spec found in requirements or manifest')
  }

  const pyPath = cachedLaunchPython
  const runtimePrefix = process.env.CONDA_PREFIX || getDefaultRuntimePrefix()

  if (!pyPath) {
    throw new Error('Python runtime is not ready. Restart the app and try again.')
  }

  onStatus(`Upgrading gatewizard: ${installSpec}`)

  await runPip(
    pyPath,
    ['install', '--upgrade', 'pip', 'setuptools', 'wheel'],
    runtimePrefix,
    { label: 'pip upgrade (tools)' }
  )

  await runPip(
    pyPath,
    ['install', '--upgrade', '--force-reinstall', '--no-deps', installSpec],
    runtimePrefix,
    { label: `pip install ${installSpec}` }
  )

  await runPip(
    pyPath,
    ['install', '-r', requirementsPath],
    runtimePrefix,
    { label: 'pip install -r requirements.txt (after gatewizard upgrade)' }
  )

  forceReinstallVcsRequirements(pyPath, requirementsText, runtimePrefix)
  await installOptionalOrientationRequirements(pyPath, requirementsPath, runtimePrefix, onStatus)

  if (process.platform !== 'win32') {
    try {
      const onStatus = options.onStatus || (() => {})
      const micromambaDest = await ensureMicromambaBinary(onStatus)
      const mmEnv = {
        ...process.env,
        MAMBA_ROOT_PREFIX: getMambaRoot()
      }
      await restoreCondaOpenmmAfterPip(micromambaDest, runtimePrefix, mmEnv, onStatus)
    } catch (err) {
      onStatus(`Note: could not refresh conda OpenMM packages: ${err.message}`)
    }
  }

  const versionProbe = spawnSync(
    pyPath,
    ['-c', 'from importlib import metadata; print(metadata.version("gatewizard"))'],
    getSubprocessOptions(runtimePrefix)
  )
  const gatewizardVersion =
    versionProbe.status === 0 ? String(versionProbe.stdout).trim() || null : null

  onStatus(
    gatewizardVersion
      ? `gatewizard upgraded to ${gatewizardVersion}`
      : 'gatewizard upgrade finished'
  )

  return { gatewizardVersion, installSpec }
}

export function getLaunchPythonPath() {
  if (cachedLaunchPython) {
    return cachedLaunchPython
  }
  if (process.env.GATEWIZARD_PYTHON) {
    return process.env.GATEWIZARD_PYTHON
  }
  const prefix = process.env.GATEWIZARD_RUNTIME_PREFIX
  if (prefix) {
    if (process.platform === 'win32') {
      return path.join(path.resolve(prefix), 'Scripts', 'python.exe')
    }
    return path.join(path.resolve(prefix), 'bin', 'python3')
  }
  return process.platform === 'win32' ? 'python' : 'python3'
}

export { getGatewizardDataRoot }
