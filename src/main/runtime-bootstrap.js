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

function getDefaultRuntimePrefix() {
  return path.join(app.getPath('userData'), 'mamba-env')
}

function getMicromambaBinPath() {
  return path.join(
    app.getPath('userData'),
    'micromamba',
    MICROMAMBA_TAG,
    process.platform === 'win32' ? 'micromamba.exe' : 'micromamba'
  )
}

function getMambaRoot() {
  return path.join(app.getPath('userData'), 'mamba-root')
}

function getStatePath() {
  return path.join(app.getPath('userData'), 'runtime-state.json')
}

async function findPythonInPrefix(prefix) {
  if (process.platform === 'win32') {
    const py = path.join(prefix, 'Scripts', 'python.exe')
    return (await fileExists(py)) ? py : null
  }
  for (const name of ['python3', 'python']) {
    const p = path.join(prefix, 'bin', name)
    if (await fileExists(p)) return p
  }
  return null
}

function inferCondaPrefixFromPython(pythonPath) {
  const dir = path.dirname(path.resolve(pythonPath))
  const base = path.basename(dir)
  if (base === 'bin' || base === 'Scripts') {
    return path.dirname(dir)
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
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: options.env || process.env
    })
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
  const vcsReqs = parseVcsRequirements(requirementsText).filter((req) =>
    req.toLowerCase().startsWith('gatewizard @ git+')
  )
  if (vcsReqs.length === 0) return

  for (const req of vcsReqs) {
    const pipVcs = spawnSync(
      pyPath,
      ['-m', 'pip', 'install', '--force-reinstall', '--no-deps', req],
      {
        stdio: 'inherit',
        env: { ...process.env, CONDA_PREFIX: runtimePrefix }
      }
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

  if (envReady) {
    cachedLaunchPython = pyPath
    process.env.CONDA_PREFIX = runtimePrefix
    onStatus(`Runtime ready (cached): ${runtimePrefix}`)
    return
  }

  if (condaOk && state.requirementsHash !== requirementsHash) {
    onStatus('Updating pip dependencies (requirements.txt changed)...')
    const pipUpgrade = spawnSync(
      pyPath,
      ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel'],
      {
        stdio: 'inherit',
        env: { ...process.env, CONDA_PREFIX: runtimePrefix }
      }
    )
    if (pipUpgrade.status !== 0) {
      throw new Error('pip upgrade failed')
    }
    const pipReq = spawnSync(pyPath, ['-m', 'pip', 'install', '-r', requirementsPath], {
      stdio: 'inherit',
      env: { ...process.env, CONDA_PREFIX: runtimePrefix }
    })
    if (pipReq.status !== 0) {
      throw new Error('pip install -r requirements.txt failed')
    }
    forceReinstallVcsRequirements(pyPath, requirementsText, runtimePrefix)
    await fs.writeFile(
      statePath,
      JSON.stringify(
        {
          python: PYTHON_SPEC,
          micromambaTag: MICROMAMBA_TAG,
          requirementsHash,
          runtimePrefix
        },
        null,
        2
      ),
      'utf-8'
    )
    cachedLaunchPython = pyPath
    process.env.CONDA_PREFIX = runtimePrefix
    onStatus(`Runtime ready: ${runtimePrefix}`)
    return
  }

  onStatus('Installing runtime (micromamba: Python + pip). First run may take several minutes.')

  const micromambaDest = getMicromambaBinPath()
  await fs.mkdir(path.dirname(micromambaDest), { recursive: true })

  if (!(await fileExists(micromambaDest))) {
    onStatus(`Downloading micromamba ${MICROMAMBA_TAG}...`)
    await downloadFile(MICROMAMBA_URL[key], micromambaDest)
    if (process.platform !== 'win32') {
      await fs.chmod(micromambaDest, 0o755)
    }
  }

  const mambaRoot = getMambaRoot()
  await fs.mkdir(mambaRoot, { recursive: true })

  const mmEnv = {
    ...process.env,
    MAMBA_ROOT_PREFIX: mambaRoot
  }

  const condaPkgs = [`python=${PYTHON_SPEC}`, 'pip', 'ambertools']

  if (!(await fileExists(runtimePrefix))) {
    onStatus(`Creating environment: python=${PYTHON_SPEC}...`)
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
  const pipUpgrade = spawnSync(
    pyResolved,
    ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel'],
    {
      stdio: 'inherit',
      env: { ...process.env, CONDA_PREFIX: runtimePrefix }
    }
  )
  if (pipUpgrade.status !== 0) {
    throw new Error('pip upgrade failed')
  }
  const pipReq = spawnSync(pyResolved, ['-m', 'pip', 'install', '-r', requirementsPath], {
    stdio: 'inherit',
    env: { ...process.env, CONDA_PREFIX: runtimePrefix }
  })
  if (pipReq.status !== 0) {
    throw new Error('pip install -r requirements.txt failed')
  }
  forceReinstallVcsRequirements(pyResolved, requirementsText, runtimePrefix)

  await fs.writeFile(
    statePath,
    JSON.stringify(
      {
        python: PYTHON_SPEC,
        micromambaTag: MICROMAMBA_TAG,
        requirementsHash,
        runtimePrefix
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
