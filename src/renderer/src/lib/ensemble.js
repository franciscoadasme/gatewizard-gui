/** Canonical gatewizard ensemble labels (scheme_type). */
export const ENSEMBLE_CANONICAL = {
  nvt: 'NVT',
  npt: 'NPT',
  npat: 'NPAT',
  npgt: 'NPgT'
}

/** Lowercase form select / API value (`npgt`, not `NPGT`). */
export const ENSEMBLE_FORM_VALUES = {
  NVT: 'nvt',
  NPT: 'npt',
  NPAT: 'npat',
  NPgT: 'npgt'
}

/** @param {string | null | undefined} value */
export function canonicalEnsemble(value) {
  const trimmed = String(value ?? '').trim()
  if (trimmed in ENSEMBLE_FORM_VALUES) return trimmed
  const key = trimmed.toLowerCase()
  if (key in ENSEMBLE_CANONICAL) return ENSEMBLE_CANONICAL[key]
  return trimmed || 'NPT'
}

/** @param {string | null | undefined} value */
export function formEnsembleValue(value) {
  return ENSEMBLE_FORM_VALUES[canonicalEnsemble(value)] ?? 'npt'
}
