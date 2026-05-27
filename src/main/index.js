import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'child_process'
import { watch } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import path, { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { ensureMambaRuntime, getLaunchPythonPath } from './runtime-bootstrap.js'

const BACKEND_URL = 'http://127.0.0.1:8765'
const GPU_SAFE_MODE_FLAG = '--gatewizard-gpu-safe-mode=1'
const GPU_RELAUNCHED_FLAG = '--gatewizard-gpu-relaunched=1'

let backendProcess = null
/** @type {BrowserWindow | null} */
let mainWindow = null

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
  const prefix = env.CONDA_PREFIX
  if (prefix) {
    const binDir = process.platform === 'win32' ? join(prefix, 'Scripts') : join(prefix, 'bin')
    env.PATH = `${binDir}${path.delimiter}${env.PATH || ''}`
    // packmol-memgen needs AMBERHOME to discover packmol, tleap, etc.
    if (!env.AMBERHOME) {
      env.AMBERHOME = prefix
    }
  }
  return env
}

function startBackend() {
  const pythonBin = getLaunchPythonPath()
  const backendScript = getBackendScriptPath()

  backendProcess = spawn(pythonBin, ['-u', backendScript], {
    stdio: ['ignore', 'pipe', 'pipe'],
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
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    mainWindow.focus()

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
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible()) mainWindow.show()
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  const forceShowTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show()
    }
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
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  try {
    await ensureMambaRuntime({
      requirementsPath: getRequirementsPath(),
      onStatus: (msg) => process.stdout.write(`[runtime] ${msg}\n`)
    })
  } catch (error) {
    await dialog.showErrorBox('Runtime bootstrap failed', error.message)
    app.quit()
    return
  }

  startBackend()
  try {
    await waitForBackendHealth()
  } catch (error) {
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
