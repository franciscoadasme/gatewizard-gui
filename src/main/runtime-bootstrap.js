/**
 * Micromamba env under userData: Python (conda-forge) + pip install backend/requirements.txt.
 *
 * Optional overrides:
 *   GATEWIZARD_PYTHON — absolute path to python (skips install)
 *   GATEWIZARD_RUNTIME_PREFIX — absolute path to existing conda env root (skips install)
 */
import { spawn, spawnSync } from 'child_process'
import crypto from 'crypto'
import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'

const PYTHON_SPEC = '3.12'
const MICROMAMBA_TAG = '2.0.8-0'

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
const OPENMM_CONDA_REV = '1'

/** Revision bumped when conda GROMACS install policy changes (existing runtimes re-sync). */
const GROMACS_CONDA_REV = '1'

/** conda-forge packages for the embedded runtime (platform-specific). */
function getCondaOpenmmGpuPackages() {
  if (process.platform === 'win32') return []
  // macOS OpenMM uses Metal, not cudatoolkit
  if (process.platform === 'darwin') return ['openmm']
  // Linux / WSL: conda openmm + cudatoolkit for CUDA platform
  return ['openmm', 'cudatoolkit']
}

/**
 * Matchspecs to try for GROMACS (first success wins).
 * One conda env can only hold one ``gromacs`` build — try CUDA on Linux, else CPU.
 * System / GMXRC installs remain selectable later via the engine version picker.
 */
function getCondaGromacsInstallAttempts() {
  if (process.platform === 'win32') return []
  if (process.platform === 'linux') {
    return [
      { label: 'GROMACS (CUDA)', matchspecs: ['gromacs=*=nompi_cuda*'] },
      { label: 'GROMACS (CPU)', matchspecs: ['gromacs'] }
    ]
  }
  // macOS: CPU builds only on conda-forge
  return [{ label: 'GROMACS (CPU)', matchspecs: ['gromacs'] }]
}

function getCondaPackages() {
  const pkgs = [`python=${PYTHON_SPEC}`, 'pip', 'openssl']
  // AmberTools is not published for win-64 on conda-forge; use WSL/Linux for tleap workflows.
  if (process.platform !== 'win32') {
    pkgs.push('ambertools', 'git')
  }
  pkgs.push(...getCondaOpenmmGpuPackages())
  return pkgs
}

function getRuntimeInstallLogPath() {
  return path.join(getGatewizardDataRoot(), 'runtime-install.log')
}

async function appendRuntimeLog(text) {
  const logPath = getRuntimeInstallLogPath()
  await fs.appendFile(logPath, text, 'utf-8')
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
  onStatus(`Ensuring OpenMM via conda (${gpuPkgs.join(', ')})...`)
  await runProcess(
    micromambaDest,
    ['install', '-p', runtimePrefix, '-c', 'conda-forge', ...gpuPkgs, '-y'],
    { env: mmEnv }
  )
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
 * Tries CUDA (Linux) then CPU; records which variant landed in runtime-state.
 */
async function installCondaGromacs(micromambaDest, runtimePrefix, mmEnv, onStatus) {
  const attempts = getCondaGromacsInstallAttempts()
  if (!attempts.length) {
    onStatus('Skipping conda GROMACS on native Windows (use WSL or a system gmx).')
    return { installed: false, variant: null }
  }

  let lastError = null
  for (const attempt of attempts) {
    onStatus(`Installing ${attempt.label} from conda-forge…`)
    try {
      await runProcess(
        micromambaDest,
        ['install', '-p', runtimePrefix, '-c', 'conda-forge', ...attempt.matchspecs, '-y'],
        { env: mmEnv }
      )
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
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, getSubprocessOptions(runtimePrefix, env))
    attachOutputLogging(child)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${path.basename(command)} exited with code ${code}`))
    })
    child.on('error', reject)
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
 * @param {{ requirementsPath: string, onStatus?: (msg: string) => void }} options
 */
export async function ensureMambaRuntime(options) {
  const onStatus = options.onStatus || (() => {})
  const requirementsPath = options.requirementsPath

  await migrateDarwinDataRootIfNeeded()
  await fixStaleCondaShebangsIfNeeded(onStatus)

  if (process.env.GATEWIZARD_PYTHON) {
    cachedLaunchPython = process.env.GATEWIZARD_PYTHON
    const inferred = inferCondaPrefixFromPython(cachedLaunchPython)
    if (inferred) {
      process.env.CONDA_PREFIX = inferred
    }
    onStatus(`Using GATEWIZARD_PYTHON: ${cachedLaunchPython}`)
    return
  }

  if (process.env.GATEWIZARD_RUNTIME_PREFIX) {
    const prefix = path.resolve(process.env.GATEWIZARD_RUNTIME_PREFIX)
    const py = await findPythonInPrefix(prefix)
    if (!py) {
      throw new Error(`GATEWIZARD_RUNTIME_PREFIX: no Python found under ${prefix}`)
    }
    cachedLaunchPython = py
    process.env.CONDA_PREFIX = prefix
    onStatus(`Using GATEWIZARD_RUNTIME_PREFIX: ${prefix}`)
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
    MAMBA_ROOT_PREFIX: mambaRoot
  }

  let pyPath = await findPythonInPrefix(runtimePrefix)
  if (pyPath) {
    const micromambaDest = await ensureMicromambaBinary(onStatus)
    const sslOk = await ensurePythonSsl(pyPath, runtimePrefix, micromambaDest, mmEnv, onStatus)
    if (!sslOk) {
      pyPath = null
      state = {}
    }
  }

  const condaOk = pyPath && state.python === PYTHON_SPEC && state.micromambaTag === MICROMAMBA_TAG

  const envReady = condaOk && state.requirementsHash === requirementsHash

  if (envReady) {
    if (process.platform !== 'win32') {
      const needsOpenmm = state.openmmCondaRev !== OPENMM_CONDA_REV
      const needsGromacs = state.gromacsCondaRev !== GROMACS_CONDA_REV
      if (needsOpenmm || needsGromacs) {
        const micromambaDest = await ensureMicromambaBinary(onStatus)
        if (needsOpenmm) {
          state = await syncCondaOpenmmGpuIfNeeded({
            micromambaDest,
            runtimePrefix,
            mmEnv,
            onStatus,
            state,
            statePath
          })
        }
        if (needsGromacs) {
          state = await syncCondaGromacsIfNeeded({
            micromambaDest,
            runtimePrefix,
            mmEnv,
            onStatus,
            state,
            statePath
          })
        }
      }
    }
    cachedLaunchPython = pyPath
    process.env.CONDA_PREFIX = runtimePrefix
    onStatus(`Runtime ready (cached): ${runtimePrefix}`)
    return
  }

  if (condaOk && state.requirementsHash !== requirementsHash) {
    onStatus('Updating pip dependencies (requirements.txt changed)...')
    await runPip(
      pyPath,
      ['install', '--upgrade', 'pip', 'setuptools', 'wheel'],
      runtimePrefix,
      { label: 'pip upgrade (tools)' }
    )
    await runPip(
      pyPath,
      ['install', '-r', requirementsPath],
      runtimePrefix,
      { label: 'pip install -r requirements.txt' }
    )
    forceReinstallVcsRequirements(pyPath, requirementsText, runtimePrefix)
    await installOptionalOrientationRequirements(pyPath, requirementsPath, runtimePrefix, onStatus)
    const micromambaDest = await ensureMicromambaBinary(onStatus)
    await restoreCondaOpenmmAfterPip(micromambaDest, runtimePrefix, mmEnv, onStatus)
    state = await syncCondaOpenmmGpuIfNeeded({
      micromambaDest,
      runtimePrefix,
      mmEnv,
      onStatus,
      state,
      statePath,
      extraState: {
        python: PYTHON_SPEC,
        micromambaTag: MICROMAMBA_TAG,
        requirementsHash,
        runtimePrefix
      }
    })
    state = await syncCondaGromacsIfNeeded({
      micromambaDest,
      runtimePrefix,
      mmEnv,
      onStatus,
      state,
      statePath
    })
    cachedLaunchPython = pyPath
    process.env.CONDA_PREFIX = runtimePrefix
    onStatus(`Runtime ready: ${runtimePrefix}`)
    return
  }

  onStatus('Installing runtime (micromamba: Python + pip). First run may take several minutes.')
  if (process.platform === 'win32') {
    onStatus(
      'Note: AmberTools (tleap, antechamber) is not installed on native Windows — use WSL for membrane building.'
    )
  } else if (getCondaOpenmmGpuPackages().includes('cudatoolkit')) {
    onStatus('Linux/WSL: installing openmm + cudatoolkit from conda-forge for OpenMM CUDA support.')
    onStatus('Will also try conda-forge GROMACS (CUDA, then CPU fallback).')
  } else if (process.platform === 'darwin') {
    onStatus('Will install conda-forge GROMACS (CPU) into the runtime.')
  }

  const micromambaDest = await ensureMicromambaBinary(onStatus)

  await fs.mkdir(mambaRoot, { recursive: true })

  const condaPkgs = getCondaPackages()

  if (!(await fileExists(runtimePrefix))) {
    onStatus(`Creating environment: ${condaPkgs.join(', ')}...`)
    await runProcess(
      micromambaDest,
      ['create', '-p', runtimePrefix, '-c', 'conda-forge', ...condaPkgs, '-y'],
      { env: mmEnv }
    )
  } else {
    onStatus('Updating Python in existing environment...')
    await runProcess(
      micromambaDest,
      ['install', '-p', runtimePrefix, '-c', 'conda-forge', ...condaPkgs, '-y'],
      { env: mmEnv }
    )
  }

  const pyResolved = await findPythonInPrefix(runtimePrefix)
  if (!pyResolved) {
    throw new Error(`Python missing after install under ${runtimePrefix}`)
  }

  onStatus('pip install -r backend/requirements.txt ...')
  await runPip(
    pyResolved,
    ['install', '--upgrade', 'pip', 'setuptools', 'wheel'],
    runtimePrefix,
    { label: 'pip upgrade (tools)' }
  )
  await runPip(
    pyResolved,
    ['install', '-r', requirementsPath],
    runtimePrefix,
    { label: 'pip install -r requirements.txt' }
  )
  forceReinstallVcsRequirements(pyResolved, requirementsText, runtimePrefix)
  await installOptionalOrientationRequirements(
    pyResolved,
    requirementsPath,
    runtimePrefix,
    onStatus
  )
  await restoreCondaOpenmmAfterPip(micromambaDest, runtimePrefix, mmEnv, onStatus)
  state = await syncCondaGromacsIfNeeded({
    micromambaDest,
    runtimePrefix,
    mmEnv,
    onStatus,
    state: {
      python: PYTHON_SPEC,
      micromambaTag: MICROMAMBA_TAG,
      requirementsHash,
      runtimePrefix,
      openmmCondaRev: OPENMM_CONDA_REV
    },
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
        gromacsCondaVariant: state.gromacsCondaVariant ?? null
      },
      null,
      2
    ),
    'utf-8'
  )

  cachedLaunchPython = pyResolved
  process.env.CONDA_PREFIX = runtimePrefix
  onStatus(`Runtime ready: ${runtimePrefix}`)
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
