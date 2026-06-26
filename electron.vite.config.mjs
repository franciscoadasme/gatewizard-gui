import { defineConfig } from 'electron-vite'
import tailwindcss from '@tailwindcss/vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

/** Vite dev client injects inline scripts; WASM (Threlte extras) needs wasm-unsafe-eval. */
function cspForRenderer() {
  return {
    name: 'gatewizard-renderer-csp',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const devInline = ctx.server ? " 'unsafe-inline'" : ''
        return html.replace(
          "script-src 'self' 'wasm-unsafe-eval'",
          `script-src 'self' 'wasm-unsafe-eval'${devInline}`
        )
      }
    }
  }
}

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    server: {
      watch: {
        usePolling: true
      }
    },
    plugins: [cspForRenderer(), tailwindcss(), svelte()]
  }
})
