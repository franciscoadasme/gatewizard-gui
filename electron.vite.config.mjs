import { defineConfig } from 'electron-vite'
import tailwindcss from '@tailwindcss/vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    server: {
      watch: {
        usePolling: true
      }
    },
    plugins: [tailwindcss(), svelte()]
  }
})
