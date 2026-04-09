import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  getBackendBaseUrl: () => ipcRenderer.invoke('backend:getBaseUrl'),
  loadPdb: (filePath) => ipcRenderer.invoke('backend:loadPdb', filePath),
  openPdbDialog: () => ipcRenderer.invoke('dialog:openPdb'),
  pingBackend: () => ipcRenderer.invoke('backend:ping')
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
