/**
 * GateWizard brand assets — single source of truth for logo paths and usage.
 *
 * Place PNG files under resources/brand/logos/ (see filenames below).
 * After changing packaging assets, run: npm run sync:icons
 */
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @typedef {'dark' | 'light'} BrandTheme */

/** Repo-relative paths (for docs and scripts). */
export const BRAND_ROOT = 'resources/brand'
export const LOGOS_DIR = path.join(__dirname, 'logos')

/**
 * @type {Record<string, {
 *   label: string,
 *   usedIn: string[],
 *   files: Record<string, string>,
 *   defaultTheme?: BrandTheme,
 *   outputs?: Record<string, string>,
 * }>}
 */
export const brandAssets = {
  /**
   * In-app window icon — title bar and OS taskbar while the app is running.
   * Use a light/white emblem on transparent PNG for the current dark UI.
   */
  appWindow: {
    label: 'Application window icon',
    usedIn: [
      'src/main/index.js — BrowserWindow icon (Windows/Linux)',
      'src/renderer/src/App.svelte — title bar logo',
      'src/shared/brand.js — getAppWindowIconUrl(theme) (renderer-safe; paths mirror this manifest)',
    ],
    files: {
      dark: path.join(LOGOS_DIR, 'app-window-dark.png'),
      light: path.join(LOGOS_DIR, 'app-window-light.png'),
    },
    defaultTheme: 'dark',
  },

  /**
   * Installed app identity — installer wizard, uninstaller, shortcuts, .exe / .AppImage / .deb / .app.
   * Often a dark/black emblem on transparent PNG (visible on light Windows UI).
   */
  packaging: {
    label: 'Packaging & installer icon',
    usedIn: [
      'electron-builder.yml — win.icon, nsis.installerIcon, nsis.uninstallerIcon, mac/linux icon',
      'scripts/sync-build-icons.mjs — generates build/icon.png and build/icon.ico',
      'scripts/after-pack-win-icon.cjs — embeds icon in the Windows .exe',
    ],
    files: {
      source: path.join(LOGOS_DIR, 'packaging.png'),
    },
    outputs: {
      png: 'build/icon.png',
      ico: 'build/icon.ico',
    },
  },

  /**
   * Splash screen — GW emblem on the back of the 3D key card.
   * Currently inline SVG in splash.html (not loaded from a file at runtime).
   */
  splashEmblem: {
    label: 'Splash animation emblem',
    usedIn: [
      'resources/splash.html — inline <svg> on the logo face of the 3D card',
    ],
    files: {
      svg: path.join(LOGOS_DIR, 'emblem.svg'),
      referencePng: path.join(LOGOS_DIR, 'splash-reference.png'),
    },
    note:
      'The splash uses inline SVG today. Copy emblem.svg path data into splash.html when updating the animation logo.',
  },
}

/** @deprecated Use resources/brand/logos/app-window-dark.png */
export const legacyAppWindowIcon = path.join(__dirname, '..', 'window_icon.png')

/**
 * Absolute path to the PNG used for packaging (with fallbacks).
 * @returns {string}
 */
export function resolvePackagingIconSource() {
  const { source } = brandAssets.packaging.files
  return source
}

/**
 * Absolute paths for in-app window icons by theme.
 * @param {BrandTheme} [theme]
 * @returns {string}
 */
export function resolveAppWindowIconPath(theme = brandAssets.appWindow.defaultTheme) {
  const { files, defaultTheme } = brandAssets.appWindow
  return files[theme] ?? files[defaultTheme]
}

/**
 * Vite/Electron static import paths (must match files in logos/).
 * Update these when you rename files under resources/brand/logos/.
 */
export const brandImportPaths = {
  appWindowDark: `${BRAND_ROOT}/logos/app-window-dark.png`,
  appWindowLight: `${BRAND_ROOT}/logos/app-window-light.png`,
  packaging: `${BRAND_ROOT}/logos/packaging.png`,
}
