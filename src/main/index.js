import { app, BrowserWindow, dialog, ipcMain, screen, shell } from 'electron'
import { spawn } from 'child_process'
import { watch } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import path, { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/window_icon.png?asset'
import { ensureMambaRuntime, getLaunchPythonPath, inferCondaPrefixFromPython, upgradeGatewizardPackage } from './runtime-bootstrap.js'
import { checkForUpdates, getLocalGuiVersion, getManifestUrl } from './update-check.js'
import {
  applyWorkAreaMaximize,
  clearWorkAreaMaximizeLimits
} from './window-work-area.js'
import { buildAugmentedPath } from './shell-path.js'

const BACKEND_URL = 'http://127.0.0.1:8765'
const GPU_SAFE_MODE_FLAG = '--gatewizard-gpu-safe-mode=1'
const GPU_RELAUNCHED_FLAG = '--gatewizard-gpu-relaunched=1'
const SPLASH_MIN_MS = 1500
const SPLASH_FADE_MS = 350

let backendProcess = null
/** @type {BrowserWindow | null} */
let mainWindow = null
/** @type {BrowserWindow | null} */
let splashWindow = null
let splashShownAt = 0
let splashClosing = false

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

function setSplashStatus(message, busy = true) {
  if (!splashWindow || splashWindow.isDestroyed()) return
  const safeMessage = JSON.stringify(message)
  const busyFlag = busy ? 'true' : 'false'
  splashWindow.webContents
    .executeJavaScript(`window.setSplashStatus(${safeMessage}, ${busyFlag})`)
    .catch(() => {})
}

function createSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    return splashWindow
  }

  splashWindow = new BrowserWindow({
    width: 360,
    height: 340,
    frame: false,
    transparent: true,
    center: true,
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
      sandbox: true
    }
  })

  splashWindow.loadFile(join(getResourcesDir(), 'splash.html'))
  splashWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
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

// On Linux/WSL2, Chromium's GPU blocklist often disables hardware WebGL for Intel Xe.
// These switches re-enable it when not in safe mode.
if (process.platform === 'linux' && !isGpuSafeModeEnabled()) {
  app.commandLine.appendSwitch('ignore-gpu-blocklist')
  app.commandLine.appendSwitch('enable-gpu-rasterization')
  app.commandLine.appendSwitch('enable-zero-copy')
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
  env.GATEWIZARD_USER_DATA = app.getPath('userData')
  return env
}

function startBackend() {
  const pythonBin = getLaunchPythonPath()
  const backendScript = getBackendScriptPath()

  backendProcess = spawn(pythonBin, ['-u', backendScript], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    cwd: app.getPath('userData'),
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

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus()
    return mainWindow
  }

  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
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
    ...(process.platform === 'linux' || process.platform === 'win32' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.setMinimumSize(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)

  setupWorkAreaFramelessWindow(mainWindow)
  attachWindowStateHandlers(mainWindow)

  mainWindow.on('ready-to-show', async () => {
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

  setSplashStatus('Preparing Python environment…\nFirst launch may take several minutes.')
  try {
    await ensureMambaRuntime({
      requirementsPath: getRequirementsPath(),
      onStatus: (msg) => {
        process.stdout.write(`[runtime] ${msg}\n`)
        setSplashStatus(msg)
      }
    })
  } catch (error) {
    closeSplashWindowImmediate()
    await dialog.showErrorBox('Runtime bootstrap failed', error.message)
    app.quit()
    return
  }

  setSplashStatus('Starting backend…')
  startBackend()
  try {
    await waitForBackendHealth()
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
ipcMain.handle('dialog:openPdb', async () => {
  const win = BrowserWindow.getFocusedWindow()
  const result = await dialog.showOpenDialog(win ?? undefined, {
    title: 'Open PDB',
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

ipcMain.handle(
  'dialog:openDirectory',
  async (_event, title = 'Select Directory', defaultPath = undefined) => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win ?? undefined, {
      title,
      defaultPath,
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true }
    }
    return { canceled: false, dirPath: result.filePaths[0] }
  }
)

ipcMain.handle('dialog:openLigandFile', async (_event, title, extensions) => {
  const win = BrowserWindow.getFocusedWindow()
  const result = await dialog.showOpenDialog(win ?? undefined, {
    title: title || 'Open File',
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
})

ipcMain.handle('dialog:openFile', async (_event, title, filters, defaultPath = undefined) => {
  filters = filters || []
  if (!filters.some((filter) => filter.name.toLowerCase() === 'all files')) {
    filters.push({ name: 'All files', extensions: ['*'] })
  }

  const win = BrowserWindow.getFocusedWindow()
  const result = await dialog.showOpenDialog(win ?? undefined, {
    title: title || 'Open File',
    filters,
    defaultPath,
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
    defaultPath,
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
    defaultPath: defaultPath || undefined,
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
  await writeFile(filePath, Buffer.from(base64, 'base64'))
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
  await shell.openExternal(url)
})

ipcMain.handle('runtime:upgrade-gatewizard', async (_event, installSpec) => {
  const result = await upgradeGatewizardPackage({
    requirementsPath: getRequirementsPath(),
    installSpec: typeof installSpec === 'string' ? installSpec : undefined,
    onStatus: (msg) => process.stdout.write(`[runtime] ${msg}\n`)
  })
  await restartBackend()
  return result
})
