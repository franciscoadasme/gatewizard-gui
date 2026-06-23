/**
 * App theme (light / dark). Using .svelte.js so $state runes work outside components.
 */
import { defaultAppTheme } from '../../../shared/brand.js'

/** @typedef {'dark' | 'light'} BrandTheme */

const STORAGE_KEY = 'gw_theme'

export const themeState = $state({
  /** @type {BrandTheme} */
  current: defaultAppTheme
})

/**
 * @returns {BrandTheme}
 */
function readStoredTheme() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'light' || raw === 'dark') return raw
  } catch {
    /* ignore */
  }
  return defaultAppTheme
}

/**
 * @param {BrandTheme} theme
 */
export function applyTheme(theme) {
  const root = document.getElementById('app')
  if (root) {
    root.classList.toggle('dark', theme === 'dark')
  }
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* ignore */
  }
  window.api?.setAppTheme?.(theme)
}

/**
 * @param {BrandTheme} theme
 */
export function setTheme(theme) {
  if (theme !== 'dark' && theme !== 'light') return
  themeState.current = theme
  applyTheme(theme)
}

export function toggleTheme() {
  setTheme(themeState.current === 'dark' ? 'light' : 'dark')
}

/** Sync store with DOM (anti-flash script may have already set .dark). */
export function initTheme() {
  const theme = readStoredTheme()
  themeState.current = theme
  applyTheme(theme)
}
