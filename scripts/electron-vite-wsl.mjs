#!/usr/bin/env node
/**
 * Wrapper around electron-vite that applies display-GPU policy and forces X11
 * under WSL/WSLg before Electron starts (appendSwitch alone can be too late
 * for ozone-platform / Mesa GALLIUM_DRIVER).
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { applyDisplayGpuEnv, isWsl } = require('./display-gpu-policy.cjs')
const { clearCorruptedGpuCache, getAppConfigDir } = require('./gpu-cache.cjs')
const { attachChromiumStderrFilter, ensureSessionDbus } = require('./session-dbus.cjs')

if (process.platform === 'linux') {
  const { assertLinuxElectronLibs } = require('./linux-runtime-libs.cjs')
  let electronBin = join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron')
  try {
    const rel = readFileSync(
      join(__dirname, '..', 'node_modules', 'electron', 'path.txt'),
      'utf8'
    ).trim()
    if (rel) electronBin = join(__dirname, '..', 'node_modules', 'electron', 'dist', rel)
  } catch {
    /* path.txt missing until ensure-electron runs */
  }
  assertLinuxElectronLibs(electronBin)
}

const args = process.argv.slice(2)
const env = { ...process.env }
ensureSessionDbus(env)
applyDisplayGpuEnv(env)
if (process.platform === 'linux') {
  clearCorruptedGpuCache(getAppConfigDir({ homedir: env.HOME || undefined }))
}

if (isWsl(env) && !env.GATEWIZARD_OZONE_PLATFORM && !env.ELECTRON_OZONE_PLATFORM_HINT) {
  env.ELECTRON_OZONE_PLATFORM_HINT = 'x11'
  process.stderr.write('[display] WSL: ELECTRON_OZONE_PLATFORM_HINT=x11\n')
}

let electronViteBin
try {
  const pkgRoot = dirname(require.resolve('electron-vite/package.json'))
  electronViteBin = join(pkgRoot, 'bin', 'electron-vite.js')
} catch {
  electronViteBin = join(__dirname, '..', 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
}

const child = spawn(process.execPath, [electronViteBin, ...args], {
  stdio: ['inherit', 'inherit', 'pipe'],
  env,
  shell: false
})
if (child.stderr) {
  child.stderr.on('error', () => {})
  attachChromiumStderrFilter(child.stderr)
}

function forwardSignal(signal) {
  if (child.exitCode != null || child.signalCode) return
  try {
    child.kill(signal)
  } catch {
    /* already gone */
  }
}

process.on('SIGINT', () => forwardSignal('SIGINT'))
process.on('SIGTERM', () => forwardSignal('SIGTERM'))

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
