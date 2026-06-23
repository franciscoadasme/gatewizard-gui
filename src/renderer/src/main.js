import { mount } from 'svelte'

import './assets/main.css'

import App from './App.svelte'
import { initTheme } from './lib/theme.svelte.js'
import { initViewerSettings } from './lib/viewerSettings.svelte.js'
import { syncIllustrativeSceneLighting } from './lib/illustrativeSceneLighting.svelte.js'

initTheme()
initViewerSettings()
syncIllustrativeSceneLighting(false)

const platform = window.electron?.process?.platform
if (platform === 'win32') {
  document.documentElement.classList.add('platform-win32')
  window.electron?.ipcRenderer?.on('window:chrome-style', (_event, mode) => {
    document.documentElement.classList.toggle('window-maximized', mode === 'maximized')
  })
}

const app = mount(App, {
  target: document.getElementById('app')
})

export default app
