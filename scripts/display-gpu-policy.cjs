'use strict'

/**
 * Display-GPU policy for Electron/WebGL (splash + Visualize).
 * No Electron import — used by the dev wrapper and the main process.
 *
 * Supported runtimes: WSL, native Linux, macOS. No native Windows path.
 */

const fsDefault = require('fs')
const os = require('os')
const path = require('path')

const WSL_LIB_DIR = '/usr/lib/wsl/lib'
const WSL_DXG_PATH = '/dev/dxg'
const WSL_D3D12_PATH = `${WSL_LIB_DIR}/libd3d12.so`

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {{ accessSync?: Function, readFileSync?: Function }} [fs]
 * @returns {boolean}
 */
function isWsl(env, fs = fsDefault) {
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true
  try {
    if (String(fs.readFileSync('/proc/version', 'utf8')).toLowerCase().includes('microsoft')) {
      return true
    }
  } catch {
    /* ignore */
  }
  try {
    fs.accessSync('/proc/sys/fs/binfmt_misc/WSLInterop')
    return true
  } catch {
    return false
  }
}

/**
 * @param {{ accessSync?: Function }} [fs]
 * @returns {boolean}
 */
function hasWslGpu(fs = fsDefault) {
  try {
    fs.accessSync(WSL_DXG_PATH)
    fs.accessSync(WSL_D3D12_PATH)
    return true
  } catch {
    return false
  }
}

/**
 * @param {{ accessSync?: Function }} [fs]
 * @returns {boolean}
 */
function hasWslLibDir(fs = fsDefault) {
  try {
    fs.accessSync(WSL_LIB_DIR)
    return true
  } catch {
    return false
  }
}

/**
 * @param {{ platform?: string, homedir?: string }} [opts]
 * @returns {string}
 */
function getGpuPolicyPath(opts = {}) {
  const platform = opts.platform || process.platform
  const home = opts.homedir || os.homedir()
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'gatewizard-gui', 'gpu-policy.json')
  }
  return path.join(home, '.config', 'gatewizard-gui', 'gpu-policy.json')
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} dir
 */
function appendLdLibraryPath(env, dir) {
  const parts = String(env.LD_LIBRARY_PATH || '')
    .split(':')
    .filter(Boolean)
  if (parts.includes(dir)) return
  env.LD_LIBRARY_PATH = parts.length ? `${parts.join(':')}:${dir}` : dir
}

/**
 * @param {string} persistPath
 * @param {{ readFileSync?: Function }} [fs]
 * @returns {{ safeMode?: boolean, reason?: string, at?: string } | null}
 */
function readPersistedPolicy(persistPath, fs = fsDefault) {
  try {
    const data = JSON.parse(String(fs.readFileSync(persistPath, 'utf8')))
    if (data && data.safeMode === true) return data
    return null
  } catch {
    return null
  }
}

/**
 * @param {string} persistPath
 * @param {{ unlinkSync?: Function }} [fs]
 */
function clearPersistedSafeMode(persistPath, fs = fsDefault) {
  try {
    fs.unlinkSync(persistPath)
  } catch {
    /* missing */
  }
}

/**
 * @param {string} reason
 * @param {{
 *   platform?: string,
 *   homedir?: string,
 *   persistPath?: string,
 *   fs?: { mkdirSync?: Function, writeFileSync?: Function },
 *   at?: string
 * }} [opts]
 * @returns {string | null}
 */
function persistGpuSafeMode(reason, opts = {}) {
  const fs = opts.fs || fsDefault
  const persistPath = opts.persistPath || getGpuPolicyPath(opts)
  const payload = {
    safeMode: true,
    reason: String(reason || ''),
    at: opts.at || new Date().toISOString()
  }
  try {
    fs.mkdirSync(path.dirname(persistPath), { recursive: true })
    fs.writeFileSync(persistPath, `${JSON.stringify(payload)}\n`, 'utf8')
    return persistPath
  } catch (err) {
    process.stderr.write(`[gpu] failed to persist safe mode: ${err.message}\n`)
    return null
  }
}

/**
 * @param {string} message
 */
function defaultLog(message) {
  process.stderr.write(`${message}\n`)
}

/**
 * Mutates `env`. Mesa must see GALLIUM_DRIVER before Chromium starts.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {{
 *   platform?: string,
 *   homedir?: string,
 *   persistPath?: string,
 *   fs?: object,
 *   log?: (line: string) => void
 * }} [opts]
 * @returns {{ policy: string, reason: string }}
 */
function applyDisplayGpuEnv(env, opts = {}) {
  const platform = opts.platform || process.platform
  const fs = opts.fs || fsDefault
  const homedir = opts.homedir || os.homedir()
  const persistPath = opts.persistPath || getGpuPolicyPath({ platform, homedir })
  const log = opts.log || defaultLog

  if (env.GATEWIZARD_GPU_RETRY === '1') {
    clearPersistedSafeMode(persistPath, fs)
  }

  const persisted =
    env.GATEWIZARD_GPU_RETRY === '1' ? null : readPersistedPolicy(persistPath, fs)
  const fromPersist = Boolean(persisted?.safeMode)
  const safeRequested = env.GATEWIZARD_GPU_SAFE_MODE === '1' || fromPersist
  if (fromPersist && env.GATEWIZARD_GPU_SAFE_MODE !== '1') {
    env.GATEWIZARD_GPU_SAFE_MODE = '1'
  }

  const wsl = platform === 'linux' && isWsl(env, fs)
  if (wsl && hasWslLibDir(fs)) {
    appendLdLibraryPath(env, WSL_LIB_DIR)
  }

  /** @type {string} */
  let policy
  /** @type {string} */
  let reason

  if (safeRequested) {
    policy = 'safe'
    reason = fromPersist ? 'persisted-safe-mode' : 'GATEWIZARD_GPU_SAFE_MODE'
  } else if (Object.prototype.hasOwnProperty.call(env, 'GATEWIZARD_GALLIUM_DRIVER')) {
    const forced = String(env.GATEWIZARD_GALLIUM_DRIVER || '')
    if (forced) env.GALLIUM_DRIVER = forced
    policy = 'honor'
    reason = forced ? 'GATEWIZARD_GALLIUM_DRIVER' : 'GATEWIZARD_GALLIUM_DRIVER-empty'
  } else if (env.GALLIUM_DRIVER) {
    policy = 'honor'
    reason = 'GALLIUM_DRIVER'
  } else if (wsl && hasWslGpu(fs)) {
    env.GALLIUM_DRIVER = 'd3d12'
    policy = 'd3d12'
    reason = 'wsl-gpu'
  } else if (platform === 'darwin') {
    policy = 'metal'
    reason = 'darwin'
  } else {
    policy = 'leave'
    reason = wsl ? 'wsl-no-gpu' : platform === 'linux' ? 'native-linux' : 'other'
  }

  log(`[gpu] policy=${policy} reason=${reason}`)
  return { policy, reason }
}

/**
 * POSIX sh for the packaged Linux launcher. Mesa and ozone-platform must be
 * configured before the Electron ELF exec's — JS in the main process is too late.
 */
function buildDisplayGpuShell() {
  return `
# Display / GPU env (generated by display-gpu-policy.cjs)
gw_config="\${XDG_CONFIG_HOME:-\$HOME/.config}/gatewizard-gui"
gw_gpu_policy="\$gw_config/gpu-policy.json"
if [ "\${GATEWIZARD_GPU_RETRY-}" = 1 ]; then
  rm -f "\$gw_gpu_policy" 2>/dev/null || true
fi
if [ -r "\$gw_gpu_policy" ] && grep -q '"safeMode"[[:space:]]*:[[:space:]]*true' "\$gw_gpu_policy" 2>/dev/null; then
  export GATEWIZARD_GPU_SAFE_MODE=1
fi
gw_wsl=0
if [ -n "\${WSL_DISTRO_NAME-}\${WSL_INTEROP-}" ]; then
  gw_wsl=1
elif [ -r /proc/version ] && grep -qi microsoft /proc/version 2>/dev/null; then
  gw_wsl=1
elif [ -e /proc/sys/fs/binfmt_misc/WSLInterop ]; then
  gw_wsl=1
fi
if [ -d ${WSL_LIB_DIR} ]; then
  case ":\${LD_LIBRARY_PATH-}:" in
    *:${WSL_LIB_DIR}:*) ;;
    *) LD_LIBRARY_PATH="${WSL_LIB_DIR}\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}"; export LD_LIBRARY_PATH ;;
  esac
fi
if [ "\$gw_wsl" -eq 1 ] && [ -z "\${GATEWIZARD_OZONE_PLATFORM-}" ] && [ -z "\${ELECTRON_OZONE_PLATFORM_HINT-}" ]; then
  export ELECTRON_OZONE_PLATFORM_HINT=x11
fi
if [ -n "\${GATEWIZARD_GALLIUM_DRIVER+x}" ]; then
  if [ -n "\$GATEWIZARD_GALLIUM_DRIVER" ]; then
    export GALLIUM_DRIVER="\$GATEWIZARD_GALLIUM_DRIVER"
  fi
elif [ -n "\${GALLIUM_DRIVER-}" ]; then
  :
elif [ "\${GATEWIZARD_GPU_SAFE_MODE-}" != 1 ] && [ "\$gw_wsl" -eq 1 ] && [ -e ${WSL_DXG_PATH} ] && [ -r ${WSL_D3D12_PATH} ]; then
  export GALLIUM_DRIVER=d3d12
fi
`
}

module.exports = {
  WSL_LIB_DIR,
  WSL_DXG_PATH,
  WSL_D3D12_PATH,
  isWsl,
  hasWslGpu,
  getGpuPolicyPath,
  readPersistedPolicy,
  clearPersistedSafeMode,
  persistGpuSafeMode,
  applyDisplayGpuEnv,
  buildDisplayGpuShell
}
