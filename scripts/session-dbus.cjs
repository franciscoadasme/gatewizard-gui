'use strict'

/**
 * WSL/WSLg may advertise a session bus socket that is missing or dead. Chromium
 * then prints ERROR:dbus/bus.cc. Prefer the live default bus at
 * $XDG_RUNTIME_DIR/bus; only start gatewizard-bus when that is unavailable.
 * Never set DBUS_SESSION_BUS_ADDRESS to a socket that is not connectable.
 */

const fsDefault = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync: spawnSyncDefault } = require('child_process')

const BUS_SOCK_NAME = 'gatewizard-bus'

/**
 * @param {string} line
 * @returns {boolean}
 */
function isChromiumDbusNoise(line) {
  const s = String(line)
  if (/ERROR:dbus\/(?:bus|object_proxy)\.cc/.test(s)) return true
  if (/Failed to connect to the bus:/.test(s)) return true
  if (/Failed to connect to socket \/run\/user\/\d+\/(?:bus|gatewizard-bus)/.test(s)) return true
  if (/org\.freedesktop\.DBus\.NameHasOwner/.test(s)) return true
  // Stale GPU shader disk cache after Mesa / WSL GPU stack changes (Chromium recovers).
  if (/ERROR:net\/disk_cache\/blockfile\/block_files\.cc.*GPUCache/.test(s)) return true
  return false
}

/**
 * @param {NodeJS.ReadableStream} readable
 * @param {NodeJS.WritableStream} [writable]
 */
function attachChromiumStderrFilter(readable, writable = process.stderr) {
  let buf = ''
  readable.on('data', (chunk) => {
    buf += chunk
    let idx
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx + 1)
      buf = buf.slice(idx + 1)
      if (!isChromiumDbusNoise(line)) writable.write(line)
    }
  })
  readable.on('end', () => {
    if (buf && !isChromiumDbusNoise(buf)) writable.write(buf)
  })
}

/**
 * @param {string | undefined} address
 * @returns {string | null}
 */
function unixPathFromAddress(address) {
  if (!address) return null
  const m = String(address).match(/unix:path=([^,;]+)/)
  return m ? m[1] : null
}

/**
 * @param {string} socketPath
 * @param {{ spawnSync?: Function, execPath?: string }} [opts]
 * @returns {boolean}
 */
function unixSocketIsLive(socketPath, opts = {}) {
  if (!socketPath) return false
  const spawnSync = opts.spawnSync || spawnSyncDefault
  const execPath = opts.execPath || process.execPath
  const r = spawnSync(
    execPath,
    [
      '-e',
      `const n=require('net');const s=n.connect(${JSON.stringify(socketPath)},()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));s.setTimeout(200,()=>process.exit(1))`
    ],
    { timeout: 500, encoding: 'utf8' }
  )
  return r.status === 0
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {{ uid?: number }} [opts]
 * @returns {string}
 */
function defaultSessionBusPath(env, opts = {}) {
  const uid = opts.uid != null ? opts.uid : typeof process.getuid === 'function' ? process.getuid() : 1000
  const rt = String(env.XDG_RUNTIME_DIR || `/run/user/${uid}`).replace(/\/$/, '')
  return path.join(rt, 'bus')
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} rtDir
 * @param {string} homedir
 * @param {typeof fsDefault} fs
 * @returns {string}
 */
function resolvePrivateBusDir(env, rtDir, homedir, fs) {
  try {
    fs.mkdirSync(rtDir, { recursive: true, mode: 0o700 })
    return rtDir
  } catch {
    const fallback = path.join(homedir, '.config', 'gatewizard-gui')
    fs.mkdirSync(fallback, { recursive: true })
    return fallback
  }
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {{
 *   platform?: string,
 *   fs?: typeof fsDefault,
 *   spawnSync?: Function,
 *   execPath?: string,
 *   homedir?: string,
 *   uid?: number,
 *   dbusDaemon?: string
 * }} [opts]
 * @returns {{ action: 'skip' | 'keep' | 'reuse' | 'started' | 'none', address?: string }}
 */
function ensureSessionDbus(env, opts = {}) {
  const platform = opts.platform || process.platform
  if (platform !== 'linux') return { action: 'skip' }

  const fs = opts.fs || fsDefault
  const probeOpts = { spawnSync: opts.spawnSync, execPath: opts.execPath }
  const uid = opts.uid != null ? opts.uid : typeof process.getuid === 'function' ? process.getuid() : 1000
  const homedir = opts.homedir || os.homedir()
  const rt = String(env.XDG_RUNTIME_DIR || `/run/user/${uid}`).replace(/\/$/, '')
  const defaultBus = defaultSessionBusPath(env, { uid })

  const advertised = unixPathFromAddress(env.DBUS_SESSION_BUS_ADDRESS)
  if (advertised && !unixSocketIsLive(advertised, probeOpts)) {
    delete env.DBUS_SESSION_BUS_ADDRESS
  }

  if (unixSocketIsLive(defaultBus, probeOpts)) {
    env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${defaultBus}`
    return { action: 'keep', address: env.DBUS_SESSION_BUS_ADDRESS }
  }

  const current = unixPathFromAddress(env.DBUS_SESSION_BUS_ADDRESS)
  if (current && unixSocketIsLive(current, probeOpts)) {
    return { action: 'keep', address: env.DBUS_SESSION_BUS_ADDRESS }
  }

  let dir
  try {
    dir = resolvePrivateBusDir(env, rt, homedir, fs)
  } catch {
    delete env.DBUS_SESSION_BUS_ADDRESS
    return { action: 'none' }
  }

  const sock = path.join(dir, BUS_SOCK_NAME)
  if (unixSocketIsLive(sock, probeOpts)) {
    env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${sock}`
    return { action: 'reuse', address: env.DBUS_SESSION_BUS_ADDRESS }
  }

  try {
    fs.unlinkSync(sock)
  } catch {
    /* missing or stale */
  }

  const daemon = opts.dbusDaemon || resolveDbusDaemon(fs)
  if (!daemon) {
    delete env.DBUS_SESSION_BUS_ADDRESS
    return { action: 'none' }
  }

  const spawnSync = opts.spawnSync || spawnSyncDefault
  const started = spawnSync(
    daemon,
    ['--session', '--fork', '--nopidfile', '--nosyslog', `--address=unix:path=${sock}`],
    { timeout: 2000, encoding: 'utf8' }
  )
  if (started.error || (started.status != null && started.status !== 0)) {
    delete env.DBUS_SESSION_BUS_ADDRESS
    return { action: 'none' }
  }

  if (!unixSocketIsLive(sock, probeOpts)) {
    delete env.DBUS_SESSION_BUS_ADDRESS
    return { action: 'none' }
  }

  env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${sock}`
  return { action: 'started', address: env.DBUS_SESSION_BUS_ADDRESS }
}

/**
 * @param {{ accessSync?: Function }} fs
 * @returns {string | null}
 */
function resolveDbusDaemon(fs = fsDefault) {
  for (const candidate of ['/usr/bin/dbus-daemon', '/bin/dbus-daemon']) {
    try {
      fs.accessSync(candidate)
      return candidate
    } catch {
      /* try next */
    }
  }
  return 'dbus-daemon'
}

/**
 * POSIX fragment for the packaged Linux launcher.
 */
function buildDbusEnsureShell() {
  return `
# Prefer the live default session bus; only start gatewizard-bus when it is missing.
gw_uid=$(id -u)
gw_rt=\${XDG_RUNTIME_DIR:-/run/user/\$gw_uid}
while [ -n "\$gw_rt" ] && [ "\${gw_rt%/}" != "\$gw_rt" ]; do
  gw_rt=\${gw_rt%/}
done
gw_default_bus="\$gw_rt/bus"
if [ -S "\$gw_default_bus" ]; then
  DBUS_SESSION_BUS_ADDRESS="unix:path=\$gw_default_bus"
  export DBUS_SESSION_BUS_ADDRESS
else
  gw_sock="\$gw_rt/gatewizard-bus"
  if [ ! -d "\$gw_rt" ]; then
    mkdir -p "\$gw_rt" 2>/dev/null || gw_sock="\$HOME/.config/gatewizard-gui/gatewizard-bus"
    mkdir -p "$(dirname -- "\$gw_sock")" 2>/dev/null || true
  fi
  gw_daemon=""
  if [ -x /usr/bin/dbus-daemon ]; then
    gw_daemon=/usr/bin/dbus-daemon
  elif command -v dbus-daemon >/dev/null 2>&1; then
    gw_daemon=$(command -v dbus-daemon)
  fi
  if [ -n "\$gw_daemon" ] && [ ! -S "\$gw_sock" ]; then
    "\$gw_daemon" --session --fork --nopidfile --nosyslog --address="unix:path=\$gw_sock" >/dev/null 2>&1 || true
  fi
  if [ -S "\$gw_sock" ]; then
    DBUS_SESSION_BUS_ADDRESS="unix:path=\$gw_sock"
    export DBUS_SESSION_BUS_ADDRESS
  else
    unset DBUS_SESSION_BUS_ADDRESS
  fi
fi
`
}

module.exports = {
  BUS_SOCK_NAME,
  isChromiumDbusNoise,
  attachChromiumStderrFilter,
  unixPathFromAddress,
  unixSocketIsLive,
  defaultSessionBusPath,
  ensureSessionDbus,
  buildDbusEnsureShell
}
