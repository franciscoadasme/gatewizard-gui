import { app, BrowserWindow, dialog, ipcMain, nativeImage, Notification, screen, shell } from 'electron'
import { spawn, spawnSync } from 'child_process'
import { existsSync, accessSync, readFileSync, statSync, watch, readdirSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import path, { join } from 'path'
import { buildFfmpegEncodeArgs, formatFfmpegError } from './animationEncode.js'

/** Directory from which the process was started (terminal cwd). Captured early. */
const LAUNCH_CWD = (() => {
  try {
    return process.cwd()
  } catch {
    return ''
  }
})()

/**
 * Prefer an existing directory for native file dialogs.
 * On Linux, a missing/invalid defaultPath often opens the GTK "Recent" view.
 * Order: preferred path → launch cwd → home.
 * @param {string | undefined | null} preferred
 * @returns {string | undefined}
 */
function resolveDialogDefaultPath(preferred) {
  /** @type {string[]} */
  const candidates = []
  if (typeof preferred === 'string' && preferred.trim()) {
    candidates.push(preferred.trim())
  }
  if (LAUNCH_CWD) candidates.push(LAUNCH_CWD)
  try {
    candidates.push(app.getPath('home'))
  } catch {
    /* app may not be ready in edge cases */
  }

  for (const raw of candidates) {
    if (!raw) continue
    try {
      let resolved = path.resolve(raw)
      if (!existsSync(resolved)) {
        const parent = path.dirname(resolved)
        if (parent && parent !== resolved && existsSync(parent)) {
          resolved = parent
        } else {
          continue
        }
      }
      const st = statSync(resolved)
      if (st.isDirectory()) return resolved
      if (st.isFile()) return path.dirname(resolved)
    } catch {
      /* try next */
    }
  }
  return undefined
}
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import appWindowIcon from '../../resources/brand/logos/app-window-dark.png?asset'
import { resolveAppWindowIconPath } from '../../resources/brand/manifest.mjs'
// Brand asset map: resources/brand/manifest.mjs (use getAppWindowIconUrl when theme toggle exists)
import {
  abortRuntimeInstalls,
  ensureMambaRuntime,
  getGatewizardDataRoot,
  getLaunchPythonPath,
  inferCondaPrefixFromPython,
  resolveFfmpegBinary,
  upgradeGatewizardPackage
} from './runtime-bootstrap.js'
import { checkForUpdates, getLocalGuiVersion, getManifestUrl } from './update-check.js'
import {
  applyWorkAreaMaximize,
  applyWslDisplayPlatformSwitches,
  captureLaunchAnchorEarly,
  centerWindowOnDisplay,
  clearWorkAreaMaximizeLimits,
  getPreferredLaunchDisplay
} from './window-work-area.js'
import { buildAugmentedPath } from './shell-path.js'

const BACKEND_URL = 'http://127.0.0.1:8765'
const GPU_SAFE_MODE_FLAG = '--gatewizard-gpu-safe-mode=1'
const GPU_RELAUNCHED_FLAG = '--gatewizard-gpu-relaunched=1'
const SPLASH_MIN_MS = 3200
const SPLASH_FADE_MS = 350
/** Transparent splash frame is always square so WSL/Windows chrome looks even. */
const SPLASH_SIZE = 440
const SPLASH_LINUX_SIZE = 480

/** WSL has no org.freedesktop.Notifications service — native toasts fail with libnotify. */
function isRunningUnderWsl() {
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

/**
 * Open a URL in the user's browser. Under WSLg, Electron's shell.openExternal
 * often fails (broken xdg-open); prefer the Windows host browser via cmd.exe.
 * @param {string} url
 */
async function openExternalUrl(url) {
  if (process.platform === 'linux' && isRunningUnderWsl()) {
    const tryCmd = (command, args) =>
      new Promise((resolve, reject) => {
        const child = spawn(command, args, {
          stdio: 'ignore',
          detached: true,
          windowsHide: true
        })
        child.unref()
        child.on('error', reject)
        // cmd.exe / start returns quickly; treat spawn success as enough.
        child.on('spawn', () => resolve())
        child.on('exit', (code) => {
          if (code === 0 || code === null) resolve()
          else reject(new Error(`${command} exited with code ${code}`))
        })
      })

    try {
      // Empty window title ("") is required so `start` treats the next arg as the URL.
      await tryCmd('cmd.exe', ['/c', 'start', '', url])
      return
    } catch {
      /* try wslview next */
    }
    try {
      await tryCmd('wslview', [url])
      return
    } catch {
      /* fall through to Electron */
    }
  }

  await shell.openExternal(url)
}

/**
 * @param {{ title: string, body: string }} payload
 */
function deliverJobNotificationFallback(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    mainWindow.flashFrame(true)
  } catch {
    /* ignore */
  }
  mainWindow.webContents.send('notifications:fallback', payload)
}

/**
 * @param {string} [sourcePage]
 */
function focusMainWindowAndOpenPage(sourcePage) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  if (sourcePage) {
    mainWindow.webContents.send('notifications:open-page', { sourcePage })
  }
}

function getSplashWindowSize() {
  const size = process.platform === 'linux' ? SPLASH_LINUX_SIZE : SPLASH_SIZE
  return { width: size, height: size }
}

let backendProcess = null
/** @type {BrowserWindow | null} */
let mainWindow = null
/** @type {BrowserWindow | null} */
let splashWindow = null
let splashShownAt = 0
let splashClosing = false
/** Display chosen at launch (cursor) so splash + main stay on the same monitor. */
/** @type {Electron.Display | null} */
let launchDisplay = null

/** @type {{ win: BrowserWindow, edge: string, startBounds: Electron.Rectangle, startPoint: { x: number, y: number } } | null} */
let activeResize = null

const MIN_WINDOW_WIDTH = 640
const MIN_WINDOW_HEIGHT = 480

/** @type {WeakMap<BrowserWindow, { maximized: boolean, restoreBounds?: Electron.Rectangle, applyingBounds: boolean, blockNativeMaximize: boolean }>} */
const workAreaWindowStates = new WeakMap()

function usesWorkAreaMaximize() {
  // Frameless native maximize can crash on X11/WSL and covers the Windows taskbar.
  return process.platform === 'linux' || process.platform === 'win32'
}

function getWorkAreaWindowState(win) {
  let state = workAreaWindowStates.get(win)
  if (!state) {
    state = { maximized: false, applyingBounds: false, blockNativeMaximize: false }
    workAreaWindowStates.set(win, state)
  }
  return state
}

function setupWorkAreaFramelessWindow(win) {
  if (!usesWorkAreaMaximize()) return

  win.on('will-resize', () => {
    const state = getWorkAreaWindowState(win)
    if (!state.applyingBounds) state.maximized = false
  })

  // Reroute native maximize to work-area bounds (keeps taskbar/dock visible).
  win.on('maximize', () => {
    const state = getWorkAreaWindowState(win)
    if (state.applyingBounds || state.blockNativeMaximize) return

    state.blockNativeMaximize = true
    try {
      if (!win.isDestroyed() && win.isMaximized()) win.unmaximize()
      if (!state.maximized) {
        state.restoreBounds = win.getNormalBounds()
        state.applyingBounds = true
        applyWorkAreaMaximize(win)
        state.maximized = true
        state.applyingBounds = false
        sendWindowChromeStyle(win)
      }
    } finally {
      state.blockNativeMaximize = false
    }
  })

  if (process.platform === 'win32') {
    screen.on('display-metrics-changed', () => {
      const state = getWorkAreaWindowState(win)
      if (win.isDestroyed() || !state.maximized) return
      state.applyingBounds = true
      try {
        applyWorkAreaMaximize(win)
      } finally {
        state.applyingBounds = false
      }
    })
  }
}

function toggleWorkAreaMaximize(win) {
  const state = getWorkAreaWindowState(win)

  if (state.maximized) {
    state.applyingBounds = true
    try {
      clearWorkAreaMaximizeLimits(win)
      if (state.restoreBounds) win.setBounds(state.restoreBounds)
      state.maximized = false
    } finally {
      state.applyingBounds = false
      if (!win.isDestroyed()) {
        win.webContents.send('window:bounds-changed')
        sendWindowChromeStyle(win)
      }
    }
    return
  }

  state.restoreBounds = win.getNormalBounds()
  state.applyingBounds = true
  try {
    applyWorkAreaMaximize(win)
    state.maximized = true
  } finally {
    state.applyingBounds = false
    if (!win.isDestroyed()) {
      win.webContents.send('window:bounds-changed')
      sendWindowChromeStyle(win)
    }
  }
}

function sendWindowChromeStyle(win) {
  if (process.platform !== 'win32' || win.isDestroyed()) return
  const state = getWorkAreaWindowState(win)
  const maximized = state.maximized || win.isMaximized() || win.isFullScreen()
  win.webContents.send('window:chrome-style', maximized ? 'maximized' : 'normal')
}

function attachWindowStateHandlers(win) {
  const notify = () => {
    if (!win.isDestroyed()) win.webContents.send('window:bounds-changed')
  }
  win.on('maximize', () => {
    notify()
    sendWindowChromeStyle(win)
  })
  win.on('unmaximize', () => {
    notify()
    sendWindowChromeStyle(win)
  })
  win.on('restore', () => {
    notify()
    sendWindowChromeStyle(win)
  })
  win.on('resize', notify)
  win.on('ready-to-show', () => sendWindowChromeStyle(win))
}

function registerWindowResizeIpc() {
  ipcMain.on('window:resize-start', (event, edge) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || typeof edge !== 'string') return

    if (usesWorkAreaMaximize()) {
      const state = getWorkAreaWindowState(win)
      if (state.maximized) {
        clearWorkAreaMaximizeLimits(win)
        if (state.restoreBounds) win.setBounds(state.restoreBounds)
        state.maximized = false
        sendWindowChromeStyle(win)
      }
    } else if (win.isMaximized()) {
      win.unmaximize()
    }

    activeResize = {
      win,
      edge,
      startBounds: win.getBounds(),
      startPoint: screen.getCursorScreenPoint()
    }
  })

  ipcMain.on('window:resize-move', () => {
    if (!activeResize) return
    const { win, edge, startBounds, startPoint } = activeResize
    if (win.isDestroyed()) {
      activeResize = null
      return
    }

    const point = screen.getCursorScreenPoint()
    const dx = point.x - startPoint.x
    const dy = point.y - startPoint.y

    let { x, y, width, height } = startBounds

    if (edge.includes('e')) width = Math.max(MIN_WINDOW_WIDTH, startBounds.width + dx)
    if (edge.includes('s')) height = Math.max(MIN_WINDOW_HEIGHT, startBounds.height + dy)
    if (edge.includes('w')) {
      const nextWidth = Math.max(MIN_WINDOW_WIDTH, startBounds.width - dx)
      x = startBounds.x + (startBounds.width - nextWidth)
      width = nextWidth
    }
    if (edge.includes('n')) {
      const nextHeight = Math.max(MIN_WINDOW_HEIGHT, startBounds.height - dy)
      y = startBounds.y + (startBounds.height - nextHeight)
      height = nextHeight
    }

    win.setBounds({ x, y, width, height })
  })

  ipcMain.on('window:resize-end', () => {
    activeResize = null
  })
}

function registerWindowControlsIpc() {
  ipcMain.on('win:invoke', (event, action) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    if (action === 'show') {
      win.show()
    } else if (action === 'showInactive') {
      win.showInactive()
    } else if (action === 'min') {
      win.minimize()
    } else if (action === 'max') {
      if (usesWorkAreaMaximize()) {
        toggleWorkAreaMaximize(win)
      } else if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
    } else if (action === 'close') {
      win.close()
    }
  })
}

function getResourcesDir() {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'app.asar.unpacked', 'resources')
  }
  return join(app.getAppPath(), 'resources')
}

function keepSplashOnTop() {
  if (!splashWindow || splashWindow.isDestroyed()) return
  // Avoid moveTop() on Linux/WSL — it triggers Chromium _NET_RESTACK_WINDOW noise.
  // alwaysOnTop plus delaying main-window reveal keeps the splash visible.
  if (process.platform === 'linux') {
    splashWindow.setAlwaysOnTop(true)
  } else {
    splashWindow.setAlwaysOnTop(true, 'screen-saver')
  }
}

/**
 * Console logger for runtime bootstrap: one line per step, with animated dots
 * on a TTY instead of spamming the same message from progress heartbeats.
 */
function createRuntimeConsoleLogger() {
  let current = ''
  let phase = 0
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null
  const isTty = Boolean(process.stdout.isTTY)

  function stripTrailingDots(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .replace(/[.…]+$/u, '')
      .trim()
  }

  function stopAnim({ finishLine = false } = {}) {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    if (finishLine && current && isTty) {
      process.stdout.write(`\r\x1b[K[runtime] ${current}\n`)
    }
  }

  return {
    /** @param {string} msg */
    status(msg) {
      const text = stripTrailingDots(msg)
      if (!text || text === current) return
      stopAnim({ finishLine: Boolean(current) })
      current = text
      phase = 0
      if (!isTty) {
        process.stdout.write(`[runtime] ${text}\n`)
        return
      }
      process.stdout.write(`[runtime] ${text}`)
      timer = setInterval(() => {
        phase = (phase + 1) % 4
        const dots = '.'.repeat(phase)
        const pad = '   '.slice(0, 3 - phase)
        process.stdout.write(`\r\x1b[K[runtime] ${current}${dots}${pad}`)
      }, 450)
    },
    /** @param {string} [msg] */
    done(msg) {
      stopAnim({ finishLine: false })
      if (isTty && current) process.stdout.write('\r\x1b[K')
      const finalText = stripTrailingDots(msg) || current
      if (finalText) process.stdout.write(`[runtime] ${finalText}\n`)
      current = ''
    },
    dispose() {
      stopAnim({ finishLine: Boolean(current) })
      current = ''
    }
  }
}

function setSplashStatus(message, busy = true) {
  if (!splashWindow || splashWindow.isDestroyed()) return
  const safeMessage = JSON.stringify(message)
  const busyFlag = busy ? 'true' : 'false'
  splashWindow.webContents
    .executeJavaScript(`window.setSplashStatus(${safeMessage}, ${busyFlag})`)
    .catch(() => {})
}

/** Latest install progress; coalesced so macOS does not drop mid-flight executeJavaScript calls. */
let pendingSplashProgress = null
let splashProgressFlush = null
/** @type {Promise<void>} */
let splashProgressChain = Promise.resolve()

/**
 * @param {{ message: string, percent: number, stepIndex?: number, stepCount?: number, busy?: boolean }} update
 * @param {{ mapRuntimeTo?: number, immediate?: boolean }} [options] When mapRuntimeTo is set, scale 0–100 into 0–mapRuntimeTo (reserve tail for backend).
 */
function setSplashProgressUpdate(update, options = {}) {
  if (!splashWindow || splashWindow.isDestroyed()) return
  let percent = Number(update.percent) || 0
  if (typeof options.mapRuntimeTo === 'number') {
    percent = Math.min(options.mapRuntimeTo, Math.round((percent / 100) * options.mapRuntimeTo))
  }
  pendingSplashProgress = {
    message: update.message,
    percent,
    stepIndex: update.stepIndex,
    stepCount: update.stepCount,
    busy: update.busy !== false
  }

  const flush = () => {
    splashProgressFlush = null
    const payload = pendingSplashProgress
    pendingSplashProgress = null
    if (!payload || !splashWindow || splashWindow.isDestroyed()) return
    const js = `window.setSplashInstallProgress(${JSON.stringify(payload)})`
    // Serialize IPC so status text and bar stay ordered under CPU load (esp. macOS).
    splashProgressChain = splashProgressChain
      .then(() => splashWindow.webContents.executeJavaScript(js))
      .catch(() => {})
  }

  if (splashProgressFlush) {
    clearTimeout(splashProgressFlush)
    splashProgressFlush = null
  }
  // Backend / Ready must paint promptly; coalesce heartbeats otherwise.
  if (options.immediate || percent >= 96 || update.busy === false) {
    flush()
  } else {
    splashProgressFlush = setTimeout(flush, 80)
  }
}

function createSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    return splashWindow
  }

  const { width, height } = getSplashWindowSize()
  if (!launchDisplay) launchDisplay = getPreferredLaunchDisplay()
  const bounds = centerWindowOnDisplay(width, height, launchDisplay)

  splashWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // Keep CSS/JS activity animations running while micromamba saturates the CPU.
      backgroundThrottling: false
    }
  })

  splashWindow.loadFile(join(getResourcesDir(), 'splash.html'))
  splashWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      // Re-assert placement after show (WSLg/X11 can still nudge the first map).
      splashWindow.setBounds(bounds)
      splashShownAt = Date.now()
      keepSplashOnTop()
      splashWindow.show()
    }
  })

  return splashWindow
}

function isSplashActive() {
  return splashWindow != null && !splashWindow.isDestroyed()
}

function revealMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed() || isSplashActive()) return
  if (!mainWindow.isVisible()) mainWindow.show()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}

function closeSplashWindowImmediate() {
  splashClosing = false
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close()
  }
  splashWindow = null
}

async function closeSplashWindowWhenReady() {
  if (splashClosing || !splashWindow || splashWindow.isDestroyed()) return
  splashClosing = true

  const remaining = Math.max(0, SPLASH_MIN_MS - (Date.now() - splashShownAt))
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining))
  }

  if (splashWindow && !splashWindow.isDestroyed()) {
    keepSplashOnTop()
    try {
      await splashWindow.webContents.executeJavaScript(
        "document.documentElement.classList.add('fade-out')"
      )
    } catch {
      // Splash may have been destroyed while waiting.
    }
    await new Promise((resolve) => setTimeout(resolve, SPLASH_FADE_MS))
  }

  closeSplashWindowImmediate()
}

function hasCliFlag(flag) {
  return process.argv.includes(flag)
}

function isGpuSafeModeEnabled() {
  return hasCliFlag(GPU_SAFE_MODE_FLAG) || process.env.GATEWIZARD_GPU_SAFE_MODE === '1'
}

function hasRelaunchedForGpuFallback() {
  return hasCliFlag(GPU_RELAUNCHED_FLAG)
}

function applyGpuStartupMode() {
  if (!isGpuSafeModeEnabled()) return

  // Must be called before app.ready; this forces a software path for unstable GPU stacks.
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('use-angle', 'swiftshader')
  app.commandLine.appendSwitch('enable-unsafe-swiftshader')
}

function relaunchInGpuSafeMode(reason) {
  if (isGpuSafeModeEnabled() || hasRelaunchedForGpuFallback()) {
    process.stderr.write(`[gpu] GPU fallback already attempted, not relaunching again. reason=${reason}\n`)
    return false
  }

  const nextArgs = process.argv.slice(1)
  nextArgs.push(GPU_SAFE_MODE_FLAG, GPU_RELAUNCHED_FLAG)
  process.stderr.write(`[gpu] Relaunching in software mode. reason=${reason}\n`)
  app.relaunch({ args: nextArgs })
  app.exit(0)
  return true
}

applyGpuStartupMode()

// WSL/WSLg: capture console monitor before Electron steals focus, and use X11 so
// BrowserWindow x/y is honored (Wayland ignores programmatic placement).
captureLaunchAnchorEarly()
applyWslDisplayPlatformSwitches(app)

// On Linux/WSL2, Chromium's GPU blocklist often disables hardware WebGL for Intel Xe.
// These switches re-enable it when not in safe mode.
if (process.platform === 'linux' && !isGpuSafeModeEnabled()) {
  app.commandLine.appendSwitch('ignore-gpu-blocklist')
  app.commandLine.appendSwitch('enable-gpu-rasterization')
  app.commandLine.appendSwitch('enable-zero-copy')
}

// GateWizard never plays video. On Intel iGPU boxes without a working libva stack,
// Chromium still probes VA-API at startup and prints a scary ERROR line. Skip it.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('disable-accelerated-video-decode')
  app.commandLine.appendSwitch('disable-accelerated-video-encode')
  app.commandLine.appendSwitch(
    'disable-features',
    'VaapiVideoDecoder,VaapiVideoEncoder,VaapiVideoDecodeLinuxGL'
  )
}

function getBackendScriptPath() {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'backend', 'app.py')
  }
  return join(app.getAppPath(), 'backend', 'app.py')
}

function getRequirementsPath() {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'backend', 'requirements.txt')
  }
  return join(app.getAppPath(), 'backend', 'requirements.txt')
}

async function waitForBackendHealth(timeoutMs = 120000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${BACKEND_URL}/health`)
      if (response.ok) {
        return
      }
    } catch {
      // Backend not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(
    `Python backend did not respond at ${BACKEND_URL}. Check logs or set GATEWIZARD_RUNTIME_PREFIX / GATEWIZARD_PYTHON.`
  )
}

function getBackendEnv() {
  const env = { ...process.env }
  let prefix = env.CONDA_PREFIX || process.env.CONDA_PREFIX
  if (!prefix) {
    const inferred = inferCondaPrefixFromPython(getLaunchPythonPath())
    if (inferred) {
      prefix = inferred
      env.CONDA_PREFIX = inferred
    }
  }
  let prefixDirs = ''
  if (prefix) {
    env.CONDA_PREFIX = prefix
    const binDir = process.platform === 'win32' ? join(prefix, 'Scripts') : join(prefix, 'bin')
    prefixDirs = binDir
    // packmol-memgen needs AMBERHOME to discover packmol, tleap, etc.
    if (!env.AMBERHOME) {
      env.AMBERHOME = prefix
    }
  }
  // Desktop / Explorer launches inherit a minimal PATH; merge login-shell PATH for NAMD, GROMACS, etc.
  env.PATH = buildAugmentedPath(env.PATH, prefixDirs)
  // Writable app data dir for backend file I/O (PDB downloads, etc.) when no working dir is set.
  env.GATEWIZARD_USER_DATA = getGatewizardDataRoot()
  return env
}

function startBackend() {
  const pythonBin = getLaunchPythonPath()
  const backendScript = getBackendScriptPath()

  backendProcess = spawn(pythonBin, ['-u', backendScript], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    cwd: getGatewizardDataRoot(),
    env: getBackendEnv()
  })

  backendProcess.stdout?.on('data', (chunk) => {
    process.stdout.write(`[backend] ${chunk}`)
  })
  backendProcess.stderr?.on('data', (chunk) => {
    process.stderr.write(`[backend] ${chunk}`)
  })
  backendProcess.on('error', (err) => {
    process.stderr.write(`[backend] failed to spawn ${pythonBin}: ${err.message}\n`)
  })
}

function stopBackend() {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill()
    backendProcess = null
  }
}

async function restartBackend() {
  process.stdout.write('[backend] Restarting...\n')
  stopBackend()
  startBackend()
  try {
    await waitForBackendHealth()
    process.stdout.write('[backend] Restarted successfully\n')
  } catch (error) {
    process.stderr.write(`[backend] Failed to restart: ${error.message}\n`)
  }
}

function watchBackendFiles() {
  const backendDir = join(app.getAppPath(), 'backend')
  let debounceTimer = null
  watch(backendDir, { recursive: true }, (_event, filename) => {
    if (!filename?.endsWith('.py')) return
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      process.stdout.write(`[backend] Detected change in ${filename}\n`)
      restartBackend()
    }, 500)
  })
}

function applyMainWindowTheme(theme) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.setBackgroundColor(theme === 'light' ? '#fafafa' : '#0a0a0a')
  if (process.platform === 'linux' || process.platform === 'win32') {
    const iconPath = resolveAppWindowIconPath(theme)
    const image = nativeImage.createFromPath(iconPath)
    if (!image.isEmpty()) mainWindow.setIcon(image)
  }
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus()
    return mainWindow
  }

  // Create the browser window.
  if (!launchDisplay) launchDisplay = getPreferredLaunchDisplay()
  const mainBounds = centerWindowOnDisplay(900, 670, launchDisplay)
  mainWindow = new BrowserWindow({
    ...mainBounds,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    frame: false,
    // Custom renderer resize handles (see WindowResizeHandles.svelte). Native thickFrame
    // adds external hit bands with a second cursor and pointer jump on Windows.
    thickFrame: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0a',
    ...(process.platform === 'win32' ? { roundedCorners: true } : {}),
    ...(usesWorkAreaMaximize() ? { maximizable: false } : {}),
    ...(process.platform === 'linux' || process.platform === 'win32' ? { icon: appWindowIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.setMinimumSize(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)

  setupWorkAreaFramelessWindow(mainWindow)
  attachWindowStateHandlers(mainWindow)

  mainWindow.on('ready-to-show', async () => {
    if (mainWindow && !mainWindow.isDestroyed() && launchDisplay) {
      mainWindow.setBounds(centerWindowOnDisplay(900, 670, launchDisplay))
    }
    await closeSplashWindowWhenReady()
    revealMainWindow()

    if (isGpuSafeModeEnabled()) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Running In Compatibility Mode',
        message: 'GateWizard detected GPU initialization issues and switched to software rendering.',
        detail:
          '3D visualization may be slower. Update GPU/WSL graphics drivers to restore full acceleration.'
      })
    }
  })

  mainWindow.webContents.on('did-finish-load', () => {
    revealMainWindow()
    sendWindowChromeStyle(mainWindow)
  })

  const forceShowTimer = setTimeout(() => {
    revealMainWindow()
  }, 2000)

  mainWindow.on('closed', () => {
    clearTimeout(forceShowTimer)
    mainWindow = null
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, url) => {
    process.stderr.write(
      `[renderer] failed to load ${url} (${errorCode}): ${errorDescription}\n`
    )
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    process.stderr.write(
      `[renderer] process gone: ${details.reason} (exitCode=${details.exitCode})\n`
    )
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.gatewizard.gui')

  createSplashWindow()
  await new Promise((resolve) => {
    if (!splashWindow || splashWindow.isDestroyed()) {
      resolve()
      return
    }
    if (splashWindow.webContents.isLoading()) {
      splashWindow.webContents.once('did-finish-load', () => resolve())
    } else {
      resolve()
    }
  })

  registerWindowControlsIpc()
  registerWindowResizeIpc()

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    if (window === splashWindow) return
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  const runtimeLog = createRuntimeConsoleLogger()
  setSplashProgressUpdate({
    message: 'Preparing Python environment…\nFirst launch may take several minutes.',
    percent: 1,
    stepIndex: 1,
    stepCount: 9,
    busy: true
  })
  try {
    await ensureMambaRuntime({
      requirementsPath: getRequirementsPath(),
      onStatus: (msg) => {
        runtimeLog.status(msg)
      },
      onProgress: (update) => {
        // Leave ~8% for backend startup so the bar never jumps backwards.
        setSplashProgressUpdate(update, { mapRuntimeTo: 92 })
      }
    })
    runtimeLog.done()
  } catch (error) {
    runtimeLog.dispose()
    closeSplashWindowImmediate()
    await dialog.showErrorBox('Runtime bootstrap failed', error.message)
    app.quit()
    return
  }

  setSplashProgressUpdate({
    message: 'Starting backend…',
    percent: 96,
    stepIndex: 1,
    stepCount: 1,
    busy: true
  })
  startBackend()
  try {
    await waitForBackendHealth()
    setSplashProgressUpdate({
      message: 'Ready',
      percent: 100,
      stepIndex: 1,
      stepCount: 1,
      busy: false
    })
  } catch (error) {
    closeSplashWindowImmediate()
    await dialog.showErrorBox('Backend failed to start', error.message)
  }

  if (is.dev) {
    watchBackendFiles()
  }

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('child-process-gone', (_event, details) => {
  if (details.type !== 'GPU') return
  process.stderr.write(
    `[gpu] child process gone: reason=${details.reason} exitCode=${details.exitCode}\n`
  )
  relaunchInGpuSafeMode(`child-process-gone:${details.reason}`)
})

app.on('before-quit', () => {
  abortRuntimeInstalls('app quit')
  stopBackend()
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
ipcMain.handle('dialog:openPdb', async (_event, defaultPath = undefined) => {
  const win = BrowserWindow.getFocusedWindow()
  const result = await dialog.showOpenDialog(win ?? undefined, {
    title: 'Open PDB',
    defaultPath: resolveDialogDefaultPath(defaultPath),
    filters: [
      { name: 'Structure', extensions: ['pdb', 'ent', 'cif', 'mmcif'] },
      { name: 'All files', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true }
  }
  return { canceled: false, filePath: result.filePaths[0] }
})

ipcMain.handle('dialog:openTopology', async (_event, defaultPath = undefined) => {
  const win = BrowserWindow.getFocusedWindow()
  const result = await dialog.showOpenDialog(win ?? undefined, {
    title: 'Open topology',
    defaultPath: resolveDialogDefaultPath(defaultPath),
    filters: [
      { name: 'Topology', extensions: ['prmtop', 'parm7', 'psf', 'top'] },
      { name: 'All files', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true }
  }
  return { canceled: false, filePath: result.filePaths[0] }
})

ipcMain.handle(
  'dialog:openDirectory',
  async (_event, title = 'Select Directory', defaultPath = undefined) => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win ?? undefined, {
      title,
      defaultPath: resolveDialogDefaultPath(defaultPath),
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true }
    }
    return { canceled: false, dirPath: result.filePaths[0] }
  }
)

ipcMain.handle(
  'dialog:openLigandFile',
  async (_event, title, extensions, defaultPath = undefined) => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win ?? undefined, {
      title: title || 'Open File',
      defaultPath: resolveDialogDefaultPath(defaultPath),
      filters: [
        { name: 'Ligand files', extensions: extensions || ['frcmod', 'lib', 'mol2'] },
        { name: 'All files', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true }
    }
    return { canceled: false, filePath: result.filePaths[0] }
  }
)

ipcMain.handle('dialog:openFile', async (_event, title, filters, defaultPath = undefined) => {
  filters = filters || []
  if (!filters.some((filter) => filter.name.toLowerCase() === 'all files')) {
    filters.push({ name: 'All files', extensions: ['*'] })
  }

  const win = BrowserWindow.getFocusedWindow()
  const result = await dialog.showOpenDialog(win ?? undefined, {
    title: title || 'Open File',
    filters,
    defaultPath: resolveDialogDefaultPath(defaultPath),
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true }
  }
  return { canceled: false, filePath: result.filePaths[0] }
})

ipcMain.handle('dialog:openFiles', async (_event, title, filters, defaultPath = undefined) => {
  filters = filters || []
  if (!filters.some((filter) => filter.name.toLowerCase() === 'all files')) {
    filters.push({ name: 'All files', extensions: ['*'] })
  }

  const win = BrowserWindow.getFocusedWindow()
  const result = await dialog.showOpenDialog(win ?? undefined, {
    title: title || 'Open Files',
    filters,
    defaultPath: resolveDialogDefaultPath(defaultPath),
    properties: ['openFile', 'multiSelections']
  })
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true, filePaths: [] }
  }
  return { canceled: false, filePaths: result.filePaths }
})

ipcMain.handle('fs:readJson', async (_event, filePath) => {
  const contents = await readFile(filePath, 'utf-8')
  return JSON.parse(contents)
})

ipcMain.handle('dialog:saveFile', async (_event, title, filters, defaultPath = undefined) => {
  filters = filters || []
  if (!filters.some((filter) => filter.name.toLowerCase() === 'all files')) {
    filters.push({ name: 'All files', extensions: ['*'] })
  }

  const win = BrowserWindow.getFocusedWindow()
  const result = await dialog.showSaveDialog(win ?? undefined, {
    title: title || 'Save File',
    filters: filters,
    defaultPath: resolveDialogDefaultPath(defaultPath),
    properties: ['showOverwriteConfirmation', 'createDirectory']
  })
  if (result.canceled || !result.filePath) {
    return { canceled: true }
  }
  // Auto-append extension if the chosen file path has no extension
  // and the first (non-wildcard) filter specifies one
  let filePath = result.filePath
  const primaryExt = filters[0]?.extensions?.find((e) => e !== '*')
  if (primaryExt && !filePath.toLowerCase().endsWith(`.${primaryExt.toLowerCase()}`)) {
    filePath = `${filePath}.${primaryExt}`
  }
  return { canceled: false, filePath }
})

ipcMain.handle('fs:writeJson', async (_event, filePath, data) => {
  await writeFile(filePath, JSON.stringify(data, null, 2))
})

ipcMain.handle('fs:writeText', async (_event, filePath, text) => {
  await writeFile(filePath, text, 'utf-8')
})

ipcMain.handle('fs:writeBinary', async (_event, filePath, base64) => {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, Buffer.from(base64, 'base64'))
})

ipcMain.handle('animation:ensureDir', async (_event, dirPath) => {
  if (!dirPath || typeof dirPath !== 'string') {
    throw new Error('animation:ensureDir requires a directory path')
  }
  await mkdir(dirPath, { recursive: true })
  await mkdir(join(dirPath, 'frames'), { recursive: true })
  return dirPath
})

ipcMain.handle('animation:inspectOutputDir', async (_event, dirPath) => {
  const base = String(dirPath ?? '').trim()
  if (!base) {
    return { exists: false, hasAnimationJson: false, frameCount: 0, hasVideo: false }
  }
  const exists = existsSync(base)
  const hasAnimationJson = existsSync(join(base, 'animation.json'))
  let frameCount = 0
  try {
    const framesDir = join(base, 'frames')
    if (existsSync(framesDir)) {
      frameCount = readdirSync(framesDir).filter((f) => /^frame_\d+\.png$/i.test(f)).length
    }
  } catch {
    frameCount = 0
  }
  const encodedFiles = ['animation.mp4', 'animation.webm', 'animation.mov', 'animation.gif'].filter(
    (name) => existsSync(join(base, name))
  )
  return {
    exists,
    hasAnimationJson,
    frameCount,
    hasVideo: encodedFiles.length > 0,
    encodedFiles
  }
})

ipcMain.handle('animation:checkFfmpeg', async () => {
  try {
    const bin = resolveFfmpegBinary()
    const result = spawnSync(bin, ['-version'], { encoding: 'utf8' })
    const available = result.status === 0
    const version = available ? (result.stdout || '').split('\n')[0]?.trim() ?? '' : ''
    return { available, version, path: available ? bin : '' }
  } catch {
    return { available: false, version: '', path: '' }
  }
})

ipcMain.handle('animation:encodeVideo', async (_event, payload) => {
  const framesDir = String(payload?.framesDir ?? '')
  const outputPath = String(payload?.outputPath ?? '')
  const format = String(payload?.format ?? 'mp4')
  const fps = typeof payload?.fps === 'number' && payload.fps > 0 ? payload.fps : 30
  if (!framesDir || !outputPath) {
    return { ok: false, error: 'animation:encodeVideo requires framesDir and outputPath' }
  }
  const bin = resolveFfmpegBinary()
  const args = buildFfmpegEncodeArgs({ framesDir, outputPath, fps, format })
  const result = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) {
    const msg = formatFfmpegError(
      result.stderr || result.stdout || result.error?.message || 'ffmpeg failed to encode video'
    )
    return { ok: false, error: msg }
  }
  return { ok: true, outputPath, ffmpeg: bin }
})

async function fetchGatewizardVersion() {
  try {
    const response = await fetch(`${BACKEND_URL}/ping`)
    if (!response.ok) return null
    const data = await response.json()
    return data.gatewizard_version ?? null
  } catch {
    return null
  }
}

ipcMain.handle('updates:check', async () => {
  const gatewizardVersion = await fetchGatewizardVersion()
  return checkForUpdates({
    guiVersion: getLocalGuiVersion(),
    gatewizardVersion
  })
})

ipcMain.handle('updates:get-manifest-url', async () => getManifestUrl())

ipcMain.handle('updates:open-url', async (_event, url) => {
  if (!url || typeof url !== 'string') {
    throw new Error('URL is required')
  }
  try {
    await openExternalUrl(url)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not open browser (${message}). Copy this URL: ${url}`)
  }
})

ipcMain.handle('runtime:upgrade-gatewizard', async (_event, installSpec) => {
  const runtimeLog = createRuntimeConsoleLogger()
  try {
    const result = await upgradeGatewizardPackage({
      requirementsPath: getRequirementsPath(),
      installSpec: typeof installSpec === 'string' ? installSpec : undefined,
      onStatus: (msg) => runtimeLog.status(msg)
    })
    runtimeLog.done(
      result?.gatewizardVersion
        ? `gatewizard upgraded to ${result.gatewizardVersion}`
        : 'gatewizard upgrade finished'
    )
    await restartBackend()
    return result
  } catch (error) {
    runtimeLog.dispose()
    throw error
  }
})

ipcMain.handle('theme:set', (_event, theme) => {
  if (theme !== 'light' && theme !== 'dark') return
  applyMainWindowTheme(theme)
})

ipcMain.handle('window:isFocused', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  return mainWindow.isFocused() && !mainWindow.isMinimized()
})

ipcMain.handle('notifications:showJobFinished', (_event, payload) => {
  const title = typeof payload?.title === 'string' ? payload.title : 'GateWizard'
  const body = typeof payload?.body === 'string' ? payload.body : ''
  const sourcePage = typeof payload?.sourcePage === 'string' ? payload.sourcePage : ''
  const toast = { title, body, sourcePage }

  // WSL / headless Linux: skip libnotify (no D-Bus Notifications service)
  if (process.platform === 'linux' && isRunningUnderWsl()) {
    deliverJobNotificationFallback(toast)
    return { ok: false, fallback: true, reason: 'wsl' }
  }

  if (!Notification.isSupported()) {
    deliverJobNotificationFallback(toast)
    return { ok: false, fallback: true, reason: 'unsupported' }
  }

  try {
    const notification = new Notification({ title, body })
    notification.on('click', () => focusMainWindowAndOpenPage(sourcePage))
    notification.on('failed', () => {
      deliverJobNotificationFallback(toast)
    })
    notification.show()
    return { ok: true, fallback: false }
  } catch {
    deliverJobNotificationFallback(toast)
    return { ok: false, fallback: true, reason: 'error' }
  }
})
