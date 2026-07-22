#!/usr/bin/env node
/**
 * Wrapper around electron-vite that forces X11 under WSL/WSLg before Electron
 * starts (appendSwitch alone can be too late for ozone-platform).
 */
import { spawn } from 'node:child_process'
import { accessSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

function isWsl() {
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true
  try {
    if (readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft')) return true
  } catch {
    /* ignore */
  }
  try {
    accessSync('/proc/sys/fs/binfmt_misc/WSLInterop')
    return true
  } catch {
    return false
  }
}

const args = process.argv.slice(2)
const env = { ...process.env }

if (isWsl() && !env.GATEWIZARD_OZONE_PLATFORM && !env.ELECTRON_OZONE_PLATFORM_HINT) {
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
  stdio: 'inherit',
  env,
  shell: false
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
