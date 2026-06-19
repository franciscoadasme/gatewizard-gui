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
    let text
    try {
      text = await fs.readFile(full, 'utf8')
    } catch {
      continue
    }
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

/** conda-forge packages for the embedded runtime (platform-specific). */
function getCondaOpenmmGpuPackages() {
  if (process.platform === 'win32') return []
  // macOS OpenMM uses Metal, not cudatoolkit
  if (process.platform === 'darwin') return ['openmm']
  // Linux / WSL: conda openmm + cudatoolkit for CUDA platform
  return ['openmm', 'cudatoolkit']
}

function getCondaPackages() {
  const pkgs = [`python=${PYTHON_SPEC}`, 'pip']
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
  return {
    encoding: 'utf-8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CONDA_PREFIX: runtimePrefix, ...extraEnv }
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
    const message = `${label} failed.\nLog: ${logPath}${tail ? `\n\n${tail}` : ''}`
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
  if (process.platform === 'win32') return state
  if (state.openmmCondaRev === OPENMM_CONDA_REV) return state
  await installCondaOpenmmGpu(micromambaDest, runtimePrefix, mmEnv, onStatus)
  const nextState = { ...state, ...extraState, openmmCondaRev: OPENMM_CONDA_REV }
  await fs.writeFile(statePath, JSON.stringify(nextState, null, 2), 'utf-8')
  return nextState
}

async function restoreCondaOpenmmAfterPip(micromambaDest, runtimePrefix, mmEnv, onStatus) {
  // pip install gatewizard[full] may replace conda openmm with a CPU-only wheel
  if (process.platform === 'win32') return
  await installCondaOpenmmGpu(micromambaDest, runtimePrefix, mmEnv, onStatus)
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

  const pyPath = await findPythonInPrefix(runtimePrefix)

  const condaOk = pyPath && state.python === PYTHON_SPEC && state.micromambaTag === MICROMAMBA_TAG

  const envReady = condaOk && state.requirementsHash === requirementsHash

  const mambaRoot = getMambaRoot()
  const mmEnv = {
    ...process.env,
    MAMBA_ROOT_PREFIX: mambaRoot
  }

  if (envReady) {
    if (process.platform !== 'win32' && state.openmmCondaRev !== OPENMM_CONDA_REV) {
      const micromambaDest = await ensureMicromambaBinary(onStatus)
      state = await syncCondaOpenmmGpuIfNeeded({
        micromambaDest,
        runtimePrefix,
        mmEnv,
        onStatus,
        state,
        statePath
      })
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

  await fs.writeFile(
    statePath,
    JSON.stringify(
      {
        python: PYTHON_SPEC,
        micromambaTag: MICROMAMBA_TAG,
        requirementsHash,
        runtimePrefix,
        openmmCondaRev: OPENMM_CONDA_REV
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
