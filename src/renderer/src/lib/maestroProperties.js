/**
 * Maestro CT property helpers for Visualize (Glide, MM/GBSA, IFD / Prime, …).
 * Properties live on the in-memory structure only — never in viewpoint / animation files.
 */

/** @typedef {'real' | 'integer' | 'boolean' | 'string'} MaestroPropType */

/**
 * @typedef {{ name: string, type: MaestroPropType, value: number | boolean | string }} MaestroProperty
 */

/** Auto headline order when the user has not picked a property. */
export const HEADLINE_PROPERTY_NAMES = [
  'r_psp_MMGBSA_dG_Bind',
  'r_i_docking_score',
  'r_i_glide_gscore',
  'r_psp_Prime_Energy'
]

/** Short labels for common Schrödinger score names (picker / structure rows). */
export const PROPERTY_DISPLAY_LABELS = {
  r_psp_MMGBSA_dG_Bind: 'MMGBSA ΔG bind',
  r_psp_MMGBSA_dG_Bind_Solv_GB: 'MMGBSA Solv GB',
  r_psp_MMGBSA_dG_Bind_vdW: 'MMGBSA vdW',
  r_psp_MMGBSA_dG_Bind_Coulomb: 'MMGBSA Coulomb',
  r_psp_MMGBSA_dG_Bind_Lipo: 'MMGBSA Lipo',
  r_psp_MMGBSA_dG_Bind_Hbond: 'MMGBSA H-bond',
  r_i_docking_score: 'Docking score',
  r_i_glide_gscore: 'Glide gscore',
  r_i_glide_emodel: 'Glide emodel',
  r_i_glide_energy: 'Glide energy',
  r_psp_Prime_Energy: 'Prime energy',
  r_i_ifd_score: 'IFD score',
  r_i_glide_vs_score: 'Glide VS score'
}

const HEADLINE_STORAGE_KEY = 'gatewizard.maestroProperties.headline'

/** @type {Record<string, string[]>} */
export const PROPERTY_FAMILIES = {
  mmgbsa: [
    'r_psp_MMGBSA_dG_Bind',
    'r_psp_MMGBSA_dG_Bind_Solv_GB',
    'r_psp_MMGBSA_dG_Bind_vdW',
    'r_psp_MMGBSA_dG_Bind_Coulomb',
    'r_psp_MMGBSA_dG_Bind_Lipo',
    'r_psp_MMGBSA_dG_Bind_Hbond',
    'r_psp_MMGBSA_dG_Bind_SelfCont',
    'r_psp_MMGBSA_dG_Bind_Packing',
    'r_psp_MMGBSA_dG_Bind_Solv_SA'
  ],
  glide: [
    'r_i_docking_score',
    'r_i_glide_gscore',
    'r_i_glide_emodel',
    'r_i_glide_energy',
    'r_i_glide_ligand_efficiency',
    'r_i_glide_ligand_efficiency_sa',
    'r_i_glide_ligand_efficiency_ln',
    'r_i_glide_hbond',
    'r_i_glide_evdw',
    'r_i_glide_ecoul',
    'i_i_glide_lignum',
    'i_i_glide_posenum'
  ],
  prime: [
    'r_psp_Prime_Energy',
    'r_psp_Prime_MMGBSA_dG_Bind',
    'r_i_ifd_score',
    'r_i_glide_vs_score'
  ]
}

/** @type {Record<string, string>} */
export const FAMILY_LABELS = {
  mmgbsa: 'MM/GBSA',
  glide: 'Glide',
  prime: 'Prime / IFD',
  other_real: 'Other energies',
  integer: 'Integers',
  string: 'Text',
  boolean: 'Flags'
}

/**
 * @param {unknown} raw
 * @returns {MaestroProperty[]}
 */
export function normalizeMaestroProperties(raw) {
  if (!Array.isArray(raw)) return []
  /** @type {MaestroProperty[]} */
  const out = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!name) continue
    const type = item.type
    if (type !== 'real' && type !== 'integer' && type !== 'boolean' && type !== 'string') {
      continue
    }
    let value = item.value
    if (type === 'real') {
      const n = Number(value)
      if (!Number.isFinite(n)) continue
      value = n
    } else if (type === 'integer') {
      const n = Number(value)
      if (!Number.isFinite(n)) continue
      value = Math.trunc(n)
    } else if (type === 'boolean') {
      value = Boolean(value)
    } else {
      value = String(value ?? '')
    }
    out.push({ name, type, value })
  }
  return out
}

/**
 * @param {MaestroProperty[] | null | undefined} properties
 * @param {string | null | undefined} preferredName
 *   Maestro property name chosen by the user. Empty / null uses the auto order.
 *   When set, only that property is returned (or null if this CT lacks it).
 * @returns {MaestroProperty | null}
 */
export function pickHeadlineProperty(properties, preferredName = null) {
  const list = Array.isArray(properties) ? properties : []
  const byName = new Map(list.map((p) => [p.name, p]))
  const preferred = typeof preferredName === 'string' ? preferredName.trim() : ''
  if (preferred) {
    const hit = byName.get(preferred)
    return hit && hit.type === 'real' ? hit : null
  }
  for (const name of HEADLINE_PROPERTY_NAMES) {
    const hit = byName.get(name)
    if (hit && hit.type === 'real') return hit
  }
  const firstReal = list.find((p) => p.type === 'real')
  return firstReal || null
}

/**
 * Format a real score number with kcal/mol (no property name).
 * @param {MaestroProperty | null | undefined} prop
 * @returns {string}
 */
export function formatHeadlineValue(prop) {
  if (!prop || prop.type !== 'real') return ''
  const n = Number(prop.value)
  if (!Number.isFinite(n)) return ''
  const abs = Math.abs(n)
  const digits = abs >= 100 ? 1 : abs >= 10 ? 2 : 3
  return `${n.toFixed(digits)} kcal/mol`
}

/**
 * Short display name without the Maestro type prefix.
 * @param {string} name
 */
export function shortPropertyLabel(name) {
  const s = String(name || '')
  if (/^[ribs]_/.test(s)) return s.slice(2)
  return s
}

/**
 * Human label for a property (known scores get a friendly name).
 * @param {string} name
 */
export function displayPropertyLabel(name) {
  const s = String(name || '')
  if (PROPERTY_DISPLAY_LABELS[s]) return PROPERTY_DISPLAY_LABELS[s]
  return shortPropertyLabel(s)
}

/**
 * Structure-row / picker line: ``Docking score  −8.500 kcal/mol``.
 * @param {MaestroProperty | null | undefined} prop
 * @returns {string}
 */
export function formatHeadlineLine(prop) {
  if (!prop || prop.type !== 'real') return ''
  const value = formatHeadlineValue(prop)
  if (!value) return ''
  return `${displayPropertyLabel(prop.name)}  ${value}`
}

/**
 * Compare two structures by the headline score (missing values sort last).
 * @param {{ properties?: MaestroProperty[] | null, ctIndex?: number | null, label?: string }} a
 * @param {{ properties?: MaestroProperty[] | null, ctIndex?: number | null, label?: string }} b
 * @param {string | null | undefined} preferredName
 * @param {'asc' | 'desc'} [dir]
 * @returns {number}
 */
export function compareStructuresByHeadline(a, b, preferredName = null, dir = 'asc') {
  const pa = pickHeadlineProperty(a?.properties, preferredName)
  const pb = pickHeadlineProperty(b?.properties, preferredName)
  const aMissing = !(pa && pa.type === 'real' && Number.isFinite(Number(pa.value)))
  const bMissing = !(pb && pb.type === 'real' && Number.isFinite(Number(pb.value)))
  if (aMissing && bMissing) {
    const ia = a?.ctIndex ?? 0
    const ib = b?.ctIndex ?? 0
    if (ia !== ib) return ia - ib
    return String(a?.label || '').localeCompare(String(b?.label || ''))
  }
  if (aMissing) return 1
  if (bMissing) return -1
  const cmp = Number(pa.value) - Number(pb.value)
  if (cmp !== 0) return dir === 'asc' ? cmp : -cmp
  const ia = a?.ctIndex ?? 0
  const ib = b?.ctIndex ?? 0
  return ia - ib
}

/**
 * Unique real property names across CTs, auto-headline names first.
 * @param {Array<{ properties?: MaestroProperty[] | null }>} structures
 * @returns {string[]}
 */
export function collectRealPropertyNames(structures) {
  /** @type {Set<string>} */
  const seen = new Set()
  for (const st of structures || []) {
    for (const p of st.properties || []) {
      if (p?.type === 'real' && p.name) seen.add(p.name)
    }
  }
  const names = [...seen]
  names.sort((a, b) => {
    const ia = HEADLINE_PROPERTY_NAMES.indexOf(a)
    const ib = HEADLINE_PROPERTY_NAMES.indexOf(b)
    if (ia >= 0 || ib >= 0) {
      if (ia < 0) return 1
      if (ib < 0) return -1
      return ia - ib
    }
    return a.localeCompare(b)
  })
  return names
}

/** @returns {string} empty string means auto */
export function loadSavedHeadlinePropertyName() {
  try {
    const raw = localStorage.getItem(HEADLINE_STORAGE_KEY)
    return typeof raw === 'string' ? raw : ''
  } catch {
    return ''
  }
}

/** @param {string} name empty string clears to auto */
export function saveHeadlinePropertyName(name) {
  try {
    const next = typeof name === 'string' ? name.trim() : ''
    if (!next) localStorage.removeItem(HEADLINE_STORAGE_KEY)
    else localStorage.setItem(HEADLINE_STORAGE_KEY, next)
  } catch {
    /* ignore quota */
  }
}

/**
 * @param {string} name
 * @returns {keyof typeof FAMILY_LABELS}
 */
export function propertyFamily(name) {
  if (PROPERTY_FAMILIES.mmgbsa.includes(name)) return 'mmgbsa'
  if (PROPERTY_FAMILIES.glide.includes(name)) return 'glide'
  if (PROPERTY_FAMILIES.prime.includes(name)) return 'prime'
  if (name.startsWith('r_')) return 'other_real'
  if (name.startsWith('i_')) return 'integer'
  if (name.startsWith('s_')) return 'string'
  if (name.startsWith('b_')) return 'boolean'
  return 'other_real'
}

/**
 * Ordered unique property names across many CTs, grouped by family.
 * @param {Array<{ properties?: MaestroProperty[] | null }>} structures
 * @returns {{ family: keyof typeof FAMILY_LABELS, names: string[] }[]}
 */
export function groupPropertyColumns(structures) {
  /** @type {Set<string>} */
  const seen = new Set()
  for (const st of structures || []) {
    for (const p of st.properties || []) {
      if (p?.name) seen.add(p.name)
    }
  }
  const names = [...seen]
  /** @type {Record<string, string[]>} */
  const buckets = {
    mmgbsa: [],
    glide: [],
    prime: [],
    other_real: [],
    integer: [],
    string: [],
    boolean: []
  }
  for (const name of names) {
    buckets[propertyFamily(name)].push(name)
  }
  for (const key of Object.keys(buckets)) {
    const preferred = PROPERTY_FAMILIES[key]
    buckets[key].sort((a, b) => {
      if (preferred) {
        const ia = preferred.indexOf(a)
        const ib = preferred.indexOf(b)
        if (ia >= 0 || ib >= 0) {
          if (ia < 0) return 1
          if (ib < 0) return -1
          return ia - ib
        }
      }
      return a.localeCompare(b)
    })
  }
  /** @type {(keyof typeof FAMILY_LABELS)[]} */
  const order = ['mmgbsa', 'glide', 'prime', 'other_real', 'integer', 'string', 'boolean']
  return order
    .filter((family) => buckets[family].length > 0)
    .map((family) => ({ family, names: buckets[family] }))
}

/**
 * Default visible columns: known headline/family reals, then other reals (cap).
 * @param {{ family: string, names: string[] }[]} groups
 * @param {number} [maxOther]
 * @returns {string[]}
 */
export function defaultVisibleColumns(groups, maxOther = 12) {
  /** @type {string[]} */
  const out = []
  for (const g of groups) {
    if (g.family === 'mmgbsa' || g.family === 'glide' || g.family === 'prime') {
      out.push(...g.names)
    } else if (g.family === 'other_real') {
      out.push(...g.names.slice(0, maxOther))
    }
  }
  if (!out.length) {
    for (const g of groups) {
      out.push(...g.names.slice(0, 8))
      if (out.length >= 8) break
    }
  }
  return out
}

const COLUMN_STORAGE_KEY = 'gatewizard.maestroProperties.columns'

/**
 * @returns {string[] | null}
 */
export function loadSavedVisibleColumns() {
  try {
    const raw = localStorage.getItem(COLUMN_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed.filter((n) => typeof n === 'string')
  } catch {
    return null
  }
}

/** @param {string[]} names */
export function saveVisibleColumns(names) {
  try {
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(names))
  } catch {
    /* ignore quota */
  }
}

/**
 * @param {MaestroProperty[] | null | undefined} properties
 * @param {string} name
 * @returns {MaestroProperty | null}
 */
export function findProperty(properties, name) {
  if (!Array.isArray(properties)) return null
  return properties.find((p) => p.name === name) || null
}

/**
 * @param {MaestroProperty | null | undefined} prop
 * @returns {string}
 */
export function formatPropertyCell(prop) {
  if (!prop) return ''
  if (prop.type === 'real') {
    const n = Number(prop.value)
    if (!Number.isFinite(n)) return ''
    const abs = Math.abs(n)
    const digits = abs >= 100 ? 1 : abs >= 10 ? 2 : 3
    return n.toFixed(digits)
  }
  if (prop.type === 'boolean') return prop.value ? 'yes' : 'no'
  return String(prop.value ?? '')
}
