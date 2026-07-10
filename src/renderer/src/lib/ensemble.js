/** Canonical gatewizard ensemble labels (scheme_type). */
export const ENSEMBLE_CANONICAL = {
  nvt: 'NVT',
  npt: 'NPT',
  npat: 'NPAT',
  npgt: 'NPgT'
}

/** @param {string | null | undefined} value */
export function canonicalEnsemble(value) {
  const key = String(value ?? '').trim().toLowerCase()
  if (key in ENSEMBLE_CANONICAL) return ENSEMBLE_CANONICAL[key]
  const trimmed = String(value ?? '').trim()
  return trimmed || 'NPT'
}
