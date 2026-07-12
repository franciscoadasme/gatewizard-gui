import { mount } from 'svelte'

import './assets/main.css'

import App from './App.svelte'
import { initAppSettings } from './lib/appSettings.svelte.js'
import { initTheme } from './lib/theme.svelte.js'
import { initViewerSettings } from './lib/viewerSettings.svelte.js'
import { syncGoodsellSceneLighting } from './lib/goodsellSceneLighting.svelte.js'

initAppSettings()
initTheme()
initViewerSettings()
syncGoodsellSceneLighting(false)

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
