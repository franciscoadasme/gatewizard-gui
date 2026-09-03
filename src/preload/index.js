import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  openFileDialog: (title, filters, defaultPath = undefined) =>
    ipcRenderer.invoke('dialog:openFile', title, filters, defaultPath),
  openFilesDialog: (title, filters, defaultPath = undefined) =>
    ipcRenderer.invoke('dialog:openFiles', title, filters, defaultPath),
  openPdbDialog: (defaultPath = undefined) => ipcRenderer.invoke('dialog:openPdb', defaultPath),
  openTopologyDialog: (defaultPath = undefined) =>
    ipcRenderer.invoke('dialog:openTopology', defaultPath),
  openDirectoryDialog: (title = 'Select Directory', defaultPath = undefined) =>
    ipcRenderer.invoke('dialog:openDirectory', title, defaultPath),
  openLigandFileDialog: (title, extensions, defaultPath = undefined) =>
    ipcRenderer.invoke('dialog:openLigandFile', title, extensions, defaultPath),
  saveFileDialog: (title, filters, defaultPath = undefined) =>
    ipcRenderer.invoke('dialog:saveFile', title, filters, defaultPath),

  readJson: (filePath) => ipcRenderer.invoke('fs:readJson', filePath),
  readText: (filePath) => ipcRenderer.invoke('fs:readText', filePath),
  writeJson: (filePath, data) => ipcRenderer.invoke('fs:writeJson', filePath, data),
  writeText: (filePath, text) => ipcRenderer.invoke('fs:writeText', filePath, text),
  writeBinary: (filePath, base64) => ipcRenderer.invoke('fs:writeBinary', filePath, base64),

  animationEnsureDir: (dirPath) => ipcRenderer.invoke('animation:ensureDir', dirPath),
  animationInspectOutputDir: (dirPath) => ipcRenderer.invoke('animation:inspectOutputDir', dirPath),
  animationCheckFfmpeg: () => ipcRenderer.invoke('animation:checkFfmpeg'),
  animationEncodeVideo: (payload) => ipcRenderer.invoke('animation:encodeVideo', payload),
  animationCancelEncode: () => ipcRenderer.invoke('animation:cancelEncode'),

  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  getUpdateManifestUrl: () => ipcRenderer.invoke('updates:get-manifest-url'),
  openExternalUrl: (url) => ipcRenderer.invoke('updates:open-url', url),
  upgradeGatewizard: (installSpec) => ipcRenderer.invoke('runtime:upgrade-gatewizard', installSpec),

  setAppTheme: (theme) => ipcRenderer.invoke('theme:set', theme),

  getUiZoomFactor: () => ipcRenderer.invoke('zoom:getFactor'),
  setUiZoomFactor: (factor) => ipcRenderer.invoke('zoom:setFactor', factor),
  setUiZoomDefault: (factor) => ipcRenderer.invoke('zoom:setDefault', factor),

  loadClusterProfiles: () => ipcRenderer.invoke('clusters:load'),
  saveClusterProfiles: (payload) => ipcRenderer.invoke('clusters:save', payload),
  listSshIdentityFiles: () => ipcRenderer.invoke('ssh:listIdentityFiles'),

  isWindowFocused: () => ipcRenderer.invoke('window:isFocused'),
  showJobNotification: (payload) => ipcRenderer.invoke('notifications:showJobFinished', payload),
  onJobNotificationFallback: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('notifications:fallback', listener)
    return () => ipcRenderer.removeListener('notifications:fallback', listener)
  },
  onNotificationOpenPage: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('notifications:open-page', listener)
    return () => ipcRenderer.removeListener('notifications:open-page', listener)
  }
}

function installTitlebarDoubleClickHandler() {
  document.addEventListener(
    'dblclick',
    (event) => {
      const target = event.target
      if (
        !(target instanceof Element) ||
        !target.closest('.titlebar-drag-zone, .titlebar-logo-slot, .titlebar-wordmark-slot')
      )
        return
      event.preventDefault()
      event.stopImmediatePropagation()
      ipcRenderer.send('win:invoke', 'max')
    },
    true
  )
}

/**
 * When work-area-maximized, Chromium -webkit-app-region drag never restores
 * (and will-move often never fires on Linux/WSL). Handle drag ourselves:
 * move past a small threshold → restore floating size → follow the cursor.
 */
function installMaximizedTitlebarDragHandler() {
  const DRAG_THRESHOLD_PX = 4
  /** @type {{ pointerId: number, startX: number, startY: number } | null} */
  let pending = null
  let dragging = false

  function isDragHandle(target) {
    return (
      target instanceof Element &&
      Boolean(target.closest('.titlebar-drag-zone, .titlebar-logo-slot, .titlebar-wordmark-slot')) &&
      !target.closest('.titlebar-no-drag, .titlebar-controls, button, a, input, select, textarea')
    )
  }

  function isMaximizedChrome() {
    return document.documentElement.classList.contains('window-maximized')
  }

  function endDrag() {
    pending = null
    if (!dragging) return
    dragging = false
    ipcRenderer.send('win:title-drag-end')
  }

  document.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0 || !isMaximizedChrome() || !isDragHandle(event.target)) return
      pending = { pointerId: event.pointerId, startX: event.screenX, startY: event.screenY }
      dragging = false
    },
    true
  )

  document.addEventListener(
    'pointermove',
    (event) => {
      if (pending && event.pointerId === pending.pointerId && !dragging) {
        const dx = event.screenX - pending.startX
        const dy = event.screenY - pending.startY
        if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return
        const ok = ipcRenderer.sendSync('win:restore-for-drag')
        pending = null
        if (!ok) return
        dragging = true
        try {
          event.target?.setPointerCapture?.(event.pointerId)
        } catch {
          /* ignore */
        }
      }
      if (dragging) {
        ipcRenderer.send('win:title-drag-move')
      }
    },
    true
  )

  document.addEventListener('pointerup', endDrag, true)
  document.addEventListener('pointercancel', endDrag, true)
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => {
    installTitlebarDoubleClickHandler()
    installMaximizedTitlebarDragHandler()
  })
} else {
  installTitlebarDoubleClickHandler()
  installMaximizedTitlebarDragHandler()
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
