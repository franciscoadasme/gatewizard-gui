/**
 * Brand assets for the renderer (browser-safe — no Node.js imports).
 * Full asset map and usage notes: resources/brand/manifest.mjs
 */
import appWindowDark from '../../resources/brand/logos/app-window-dark.png'
import appWindowLight from '../../resources/brand/logos/app-window-light.png'

/** @typedef {'dark' | 'light'} BrandTheme */

/** Keep in sync with brandAssets.appWindow.defaultTheme in manifest.mjs */
export const defaultAppTheme = 'dark'

/** @type {Record<BrandTheme, string>} */
const appWindowIconByTheme = {
  dark: appWindowDark,
  light: appWindowLight
}

/**
 * Bundled URL for the in-app window icon (title bar).
 * @param {BrandTheme} [theme]
 */
export function getAppWindowIconUrl(theme = defaultAppTheme) {
  return appWindowIconByTheme[theme] ?? appWindowIconByTheme.dark
}
