/**
 * App theme (light / dark). Using .svelte.js so $state runes work outside components.
 *
 * - `preferred`: startup theme from Settings (persisted in `gw_theme`)
 * - `current`: live session theme (sidebar toggle; not persisted)
 */
import { defaultAppTheme } from '../../../shared/brand.js'

/** @typedef {'dark' | 'light'} BrandTheme */

const STORAGE_KEY = 'gw_theme'

export const themeState = $state({
  /** @type {BrandTheme} Live session theme (DOM). */
  current: defaultAppTheme,
  /** @type {BrandTheme} Startup preference (Settings). */
  preferred: defaultAppTheme
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
function applyThemeToDom(theme) {
  const root = document.getElementById('app')
  if (root) {
    root.classList.toggle('dark', theme === 'dark')
  }
  window.api?.setAppTheme?.(theme)
}

/**
 * @param {BrandTheme} theme
 */
function persistPreferredTheme(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* ignore */
  }
}

/**
 * Change theme for this session only (sidebar toggle). Does not update startup preference.
 * @param {BrandTheme} theme
 */
export function setSessionTheme(theme) {
  if (theme !== 'dark' && theme !== 'light') return
  themeState.current = theme
  applyThemeToDom(theme)
}

/**
 * Set startup preference (Settings). Persists and applies to the current session.
 * @param {BrandTheme} theme
 */
export function setPreferredTheme(theme) {
  if (theme !== 'dark' && theme !== 'light') return
  themeState.preferred = theme
  persistPreferredTheme(theme)
  setSessionTheme(theme)
}

/** @deprecated Use setSessionTheme or setPreferredTheme */
export function setTheme(theme) {
  setPreferredTheme(theme)
}

export function toggleTheme() {
  setSessionTheme(themeState.current === 'dark' ? 'light' : 'dark')
}

/** Sync store with DOM from persisted startup preference (anti-flash may have already set .dark). */
export function initTheme() {
  const preferred = readStoredTheme()
  themeState.preferred = preferred
  themeState.current = preferred
  applyThemeToDom(preferred)
}
