/**
 * Brand assets for the renderer (browser-safe — no Node.js imports).
 * Full asset map and usage notes: resources/brand/manifest.mjs
 */
import appWindowDark from '../../resources/brand/logos/app-window-dark.png'
import appWindowLight from '../../resources/brand/logos/app-window-light.png'
import wordmarkDark from '../../resources/brand/logos/wordmark-dark.png'
import wordmarkLight from '../../resources/brand/logos/wordmark-light.png'

/** @typedef {'dark' | 'light'} BrandTheme */

/** Keep in sync with brandAssets.appWindow.defaultTheme in manifest.mjs */
export const defaultAppTheme = 'dark'

/** @type {Record<BrandTheme, string>} */
const appWindowIconByTheme = {
  dark: appWindowDark,
  light: appWindowLight
}

/** @type {Record<BrandTheme, string>} */
const wordmarkByTheme = {
  dark: wordmarkDark,
  light: wordmarkLight
}

/**
 * Bundled URL for the in-app window icon (title bar).
 * @param {BrandTheme} [theme]
 */
export function getAppWindowIconUrl(theme = defaultAppTheme) {
  return appWindowIconByTheme[theme] ?? appWindowIconByTheme.dark
}

/**
 * Bundled URL for the title-bar wordmark (GATEWIZARD text logo).
 * @param {BrandTheme} [theme]
 */
export function getWordmarkUrl(theme = defaultAppTheme) {
  return wordmarkByTheme[theme] ?? wordmarkByTheme.dark
}
