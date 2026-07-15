import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  openFileDialog: (title, filters, defaultPath = undefined) =>
    ipcRenderer.invoke('dialog:openFile', title, filters, defaultPath),
  openFilesDialog: (title, filters, defaultPath = undefined) =>
    ipcRenderer.invoke('dialog:openFiles', title, filters, defaultPath),
  openPdbDialog: (defaultPath = undefined) => ipcRenderer.invoke('dialog:openPdb', defaultPath),
  openDirectoryDialog: (title = 'Select Directory', defaultPath = undefined) =>
    ipcRenderer.invoke('dialog:openDirectory', title, defaultPath),
  openLigandFileDialog: (title, extensions, defaultPath = undefined) =>
    ipcRenderer.invoke('dialog:openLigandFile', title, extensions, defaultPath),
  saveFileDialog: (title, filters, defaultPath = undefined) =>
    ipcRenderer.invoke('dialog:saveFile', title, filters, defaultPath),

  readJson: (filePath) => ipcRenderer.invoke('fs:readJson', filePath),
  writeJson: (filePath, data) => ipcRenderer.invoke('fs:writeJson', filePath, data),
  writeText: (filePath, text) => ipcRenderer.invoke('fs:writeText', filePath, text),
  writeBinary: (filePath, base64) => ipcRenderer.invoke('fs:writeBinary', filePath, base64),

  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  getUpdateManifestUrl: () => ipcRenderer.invoke('updates:get-manifest-url'),
  openExternalUrl: (url) => ipcRenderer.invoke('updates:open-url', url),
  upgradeGatewizard: (installSpec) => ipcRenderer.invoke('runtime:upgrade-gatewizard', installSpec),

  setAppTheme: (theme) => ipcRenderer.invoke('theme:set', theme),

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
      if (!(target instanceof Element) || !target.closest('.titlebar-drag-zone')) return
      event.preventDefault()
      event.stopImmediatePropagation()
      ipcRenderer.send('win:invoke', 'max')
    },
    true
  )
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', installTitlebarDoubleClickHandler)
} else {
  installTitlebarDoubleClickHandler()
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
