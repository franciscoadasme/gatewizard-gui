import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  openFileDialog: (title, filters, defaultPath = undefined) =>
    ipcRenderer.invoke('dialog:openFile', title, filters, defaultPath),
  openPdbDialog: () => ipcRenderer.invoke('dialog:openPdb'),
  openDirectoryDialog: (title = 'Select Directory', defaultPath = undefined) =>
    ipcRenderer.invoke('dialog:openDirectory', title, defaultPath),
  openLigandFileDialog: (title, extensions) =>
    ipcRenderer.invoke('dialog:openLigandFile', title, extensions),
  saveFileDialog: (title, filters, defaultPath = undefined) =>
    ipcRenderer.invoke('dialog:saveFile', title, filters, defaultPath),
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
