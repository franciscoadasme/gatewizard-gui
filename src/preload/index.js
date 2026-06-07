import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  openFileDialog: (title, filters, defaultPath = undefined) =>
    ipcRenderer.invoke('dialog:openFile', title, filters, defaultPath),
  openFilesDialog: (title, filters, defaultPath = undefined) =>
    ipcRenderer.invoke('dialog:openFiles', title, filters, defaultPath),
  openPdbDialog: () => ipcRenderer.invoke('dialog:openPdb'),
  openDirectoryDialog: (title = 'Select Directory', defaultPath = undefined) =>
    ipcRenderer.invoke('dialog:openDirectory', title, defaultPath),
  openLigandFileDialog: (title, extensions) =>
    ipcRenderer.invoke('dialog:openLigandFile', title, extensions),
  saveFileDialog: (title, filters, defaultPath = undefined) =>
    ipcRenderer.invoke('dialog:saveFile', title, filters, defaultPath),

  readJson: (filePath) => ipcRenderer.invoke('fs:readJson', filePath),
  writeJson: (filePath, data) => ipcRenderer.invoke('fs:writeJson', filePath, data),
  writeText: (filePath, text) => ipcRenderer.invoke('fs:writeText', filePath, text),
  writeBinary: (filePath, base64) => ipcRenderer.invoke('fs:writeBinary', filePath, base64)
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
