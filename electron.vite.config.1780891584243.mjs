// electron.vite.config.mjs
import { defineConfig } from "electron-vite";
import tailwindcss from "@tailwindcss/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
var electron_vite_config_default = defineConfig({
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
});
export {
  electron_vite_config_default as default
};
