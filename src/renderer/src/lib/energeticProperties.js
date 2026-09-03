/**
 * Canonical energetic property names so mixed-engine sets share one checklist.
 * Detect/run still use native log labels; the GUI remaps on store/load.
 */

/** @typedef {{ key: string, displayName: string }} CanonicalEnergeticProperty */

/** @type {Record<string, string>} */
export const ENERGETIC_CANONICAL_DISPLAY = {
  total: 'Total Energy',
  potential: 'Potential Energy',
  kinetic: 'Kinetic Energy',
  elect: 'Electrostatic Energy',
  vdw: 'Van der Waals Energy',
  bond: 'Bond Energy',
  angle: 'Angle Energy',
  dihedral: 'Dihedral Energy',
  improper: 'Improper Energy',
  temp: 'Temperature',
  pressure: 'Pressure',
  volume: 'Volume',
  density: 'Density'
}

/** Lowercased native / display / internal aliases → canonical key. */
const ALIAS_TO_KEY = {
  'total energy': 'total',
  total: 'total',
  etot: 'total',
  energy: 'total',
  'potential energy': 'potential',
  potential: 'potential',
  eptot: 'potential',
  pot: 'potential',
  'kinetic energy': 'kinetic',
  kinetic: 'kinetic',
  'kinetic en.': 'kinetic',
  ektot: 'kinetic',
  kin: 'kinetic',
  'electrostatic energy': 'elect',
  electrostatic: 'elect',
  elect: 'elect',
  elec: 'elect',
  eelec: 'elect',
  'coulomb (sr)': 'elect',
  'coulomb (lr)': 'elect',
  'coul. recip.': 'elect',
  'van der waals energy': 'vdw',
  'van der waals': 'vdw',
  vdw: 'vdw',
  vdwaals: 'vdw',
  'lj (sr)': 'vdw',
  'lj (lr)': 'vdw',
  'bond energy': 'bond',
  bond: 'bond',
  'angle energy': 'angle',
  angle: 'angle',
  'dihedral energy': 'dihedral',
  dihedral: 'dihedral',
  dihed: 'dihedral',
  'proper dih.': 'dihedral',
  'improper energy': 'improper',
  improper: 'improper',
  imp: 'improper',
  'improper dih.': 'improper',
  temperature: 'temp',
  temp: 'temp',
  'temp(k)': 'temp',
  pressure: 'pressure',
  press: 'pressure',
  'pressure (bar)': 'pressure',
  'pres. dc (bar)': 'pressure',
  volume: 'volume',
  vol: 'volume',
  density: 'density'
}

export const ENERGETIC_ENGINES = ['namd', 'openmm', 'gromacs', 'amber']

/**
 * @param {unknown} value
 */
function normAlias(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/**
 * @param {unknown} name
 * @param {unknown} [key]
 * @returns {CanonicalEnergeticProperty}
 */
export function canonicalizeEnergeticProperty(name, key) {
  const rawName = String(name || '').trim()
  const rawKey = String(key || '').trim()
  const fromKey = ALIAS_TO_KEY[normAlias(rawKey)]
  const fromName = ALIAS_TO_KEY[normAlias(rawName)]
  const canon = fromKey || fromName
  if (canon && ENERGETIC_CANONICAL_DISPLAY[canon]) {
    return { key: canon, displayName: ENERGETIC_CANONICAL_DISPLAY[canon] }
  }
  const displayName = rawName || rawKey || 'Value'
  return { key: rawKey || displayName, displayName }
}

/**
 * @param {unknown} name
 * @param {unknown} [key]
 */
export function energeticPropertyDisplayName(name, key) {
  return canonicalizeEnergeticProperty(name, key).displayName
}

/**
 * @param {Array<{ baseName?: string, name?: string, key?: string, [k: string]: unknown }>} series
 */
export function remapEnergeticSeries(series) {
  if (!Array.isArray(series)) return []
  return series.map((s) => {
    const nativeName = String(s?.nativeName || s?.baseName || s?.name || '').trim()
    const canon = canonicalizeEnergeticProperty(nativeName || s?.key, s?.key)
    return {
      ...s,
      nativeName: nativeName || canon.displayName,
      baseName: canon.displayName,
      key: canon.key
    }
  })
}

/**
 * @param {unknown} names
 * @returns {string[]}
 */
export function remapPropertyList(names) {
  if (!Array.isArray(names)) return []
  /** @type {string[]} */
  const out = []
  const seen = new Set()
  for (const name of names) {
    const display = energeticPropertyDisplayName(name)
    if (!display || seen.has(display)) continue
    seen.add(display)
    out.push(display)
  }
  return out
}

/**
 * @param {{ baseName?: string, key?: string, nativeName?: string } | null | undefined} series
 * @param {string} prop
 */
export function seriesMatchesProperty(series, prop) {
  if (!series || !prop) return false
  const want = canonicalizeEnergeticProperty(prop)
  const have = canonicalizeEnergeticProperty(
    series.baseName || series.nativeName,
    series.key
  )
  return (
    have.displayName === want.displayName ||
    have.key === want.key ||
    String(series.baseName || '') === prop ||
    String(series.nativeName || '') === prop
  )
}

/**
 * @param {{ energeticResult?: { rawSeries?: Array<{ baseName?: string, key?: string, nativeName?: string }> } } | null | undefined} set
 * @param {string} prop
 */
export function setHasEnergeticProperty(set, prop) {
  return (set?.energeticResult?.rawSeries || []).some((s) => seriesMatchesProperty(s, prop))
}

/**
 * Union of canonical display names across sets (result series, then option lists).
 * @param {Iterable<{ energeticResult?: { rawSeries?: Array<{ baseName?: string, key?: string }> }, energeticOptions?: { availableProperties?: string[] } }>} sets
 * @returns {string[]}
 */
export function unionEnergeticProperties(sets) {
  /** @type {string[]} */
  const out = []
  const seen = new Set()
  const list = sets && typeof sets[Symbol.iterator] === 'function' ? [...sets] : []
  for (const set of list) {
    for (const s of set?.energeticResult?.rawSeries || []) {
      const display = energeticPropertyDisplayName(s.baseName, s.key)
      if (!display || seen.has(display)) continue
      seen.add(display)
      out.push(display)
    }
  }
  for (const set of list) {
    for (const name of set?.energeticOptions?.availableProperties || []) {
      const display = energeticPropertyDisplayName(name)
      if (!display || seen.has(display)) continue
      seen.add(display)
      out.push(display)
    }
  }
  return out
}

/**
 * Sniff a log prefix to guess the MD engine.
 * @param {string} text
 * @returns {'' | 'namd' | 'openmm' | 'gromacs' | 'amber'}
 */
export function inferEnergeticEngineFromLogText(text) {
  const sample = String(text || '').slice(0, 80_000)
  if (/^ETITLE:|^\s*ENERGY:/m.test(sample) || /\nETITLE:/.test(sample)) return 'namd'
  if (/Energies \(kJ\/mol\)/.test(sample) || /GROMACS/.test(sample)) return 'gromacs'
  if (/#"?(Step|Time \(ps\)|Potential Energy)/.test(sample) || /StateDataReporter/.test(sample)) {
    return 'openmm'
  }
  if (/\bNSTEP\b/.test(sample) && (/\bEPtot\b/.test(sample) || /\bEtot\b/.test(sample))) {
    return 'amber'
  }
  if (/\bEPtot\b/.test(sample) || /\bEELEC\b/.test(sample) || /\bVDWAALS\b/.test(sample)) {
    return 'amber'
  }
  return ''
}

/**
 * Engines to try: stored first, then the rest.
 * @param {unknown} preferred
 * @returns {string[]}
 */
export function energeticEnginesToTry(preferred) {
  const first = String(preferred || '').trim().toLowerCase()
  const out = []
  if (ENERGETIC_ENGINES.includes(first)) out.push(first)
  for (const eng of ENERGETIC_ENGINES) {
    if (!out.includes(eng)) out.push(eng)
  }
  return out
}
