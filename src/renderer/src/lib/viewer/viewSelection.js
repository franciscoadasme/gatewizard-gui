/**
 * Named Visualize selections vs custom MDAnalysis strings.
 *
 * The panel clears `view.selection` for dropdown keywords and keeps the keyword
 * on `baseSelection`. Reloading a session must not treat that empty string as
 * "all atoms" — `/get-structure` with no selection returns the whole structure.
 */

/** Keywords the named-selection dropdown / backend aliases understand. */
export const NAMED_SELECTION_KEYWORDS = [
  'all',
  'protein',
  'peptide',
  'backbone',
  'sidechain',
  'polar',
  'water',
  'lipid',
  'ion',
  'ligand'
]

/**
 * @param {unknown} sel
 * @returns {boolean}
 */
export function isNamedSelectionKeyword(sel) {
  return NAMED_SELECTION_KEYWORDS.includes(String(sel || '').trim().toLowerCase())
}

/**
 * Selection string to send to `/get-structure` / MDAnalysis.
 * @param {{ selection?: string, baseSelection?: string } | null | undefined} view
 * @returns {string}
 */
export function effectiveViewSelection(view) {
  const sel = String(view?.selection || '').trim()
  if (sel) return sel
  const base = String(view?.baseSelection || '').trim()
  if (base) return base
  return 'all'
}

/**
 * Dropdown value for a saved / live view.
 * @param {{ selection?: string, baseSelection?: string } | null | undefined} view
 * @returns {string}
 */
export function namedSelectionFromView(view) {
  const sel = String(view?.selection || '').trim()
  if (isNamedSelectionKeyword(sel)) return sel.toLowerCase()
  const base = String(view?.baseSelection || '').trim()
  if (isNamedSelectionKeyword(base)) return base.toLowerCase()
  return 'other'
}

/**
 * Resolve the `/get-structure` selection from the panel dropdown + view fields.
 * Never returns an empty string (that means "all atoms" on the backend).
 * @param {string} namedSelection
 * @param {{ selection?: string, baseSelection?: string } | null | undefined} view
 * @returns {string}
 */
export function structureFetchSelection(namedSelection, view) {
  const named = String(namedSelection || '').trim()
  if (named && named !== 'other') return named
  return effectiveViewSelection(view)
}
