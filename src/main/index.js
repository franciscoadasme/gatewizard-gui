import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'child_process'
import path, { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { ensureMambaRuntime, getLaunchPythonPath } from './runtime-bootstrap.js'

const BACKEND_URL = 'http://127.0.0.1:8765'

let backendProcess = null

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
  }
  return env
}

function startBackend() {
  const pythonBin = getLaunchPythonPath()
  const backendScript = getBackendScriptPath()

  backendProcess = spawn(pythonBin, [backendScript], {
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

function createWindow() {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
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

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
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
