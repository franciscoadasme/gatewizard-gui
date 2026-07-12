import { Color } from 'three'

/**
 * @typedef {{ x: number, y: number, z: number, element: string, name: string, res_name?: string, chain_id?: string }} AtomLike
 */

// ── Chain palette (10 distinct colours, cycled) ──────────────────────────────
export const CHAIN_PALETTE_HEX = [
  '#e6194b', '#3cb44b', '#ffe119', '#0082c8',
  '#f58231', '#911eb4', '#46f0f0', '#f032e6',
  '#d2f53c', '#008080'
]

// ── Residue-nature mapping ────────────────────────────────────────────────────
export const RESIDUE_NATURE = /** @type {Record<string, string>} */ ({
  ASP: 'acidic', GLU: 'acidic',
  ARG: 'basic', LYS: 'basic', HIS: 'basic',
  SER: 'polar', THR: 'polar', ASN: 'polar', GLN: 'polar',
  ALA: 'aliphatic', VAL: 'aliphatic', LEU: 'aliphatic', ILE: 'aliphatic', MET: 'aliphatic',
  PHE: 'aromatic', TRP: 'aromatic', TYR: 'aromatic',
  CYS: 'special', GLY: 'special', PRO: 'special'
})

export const RESIDUE_NATURE_COLORS = /** @type {Record<string, string>} */ ({
  acidic:    '#dc3c3c',
  basic:     '#4664dc',
  polar:     '#3cb44b',
  aliphatic: '#e6c832',
  aromatic:  '#f09632',
  special:   '#aa50c8',
  other:     '#b4b4b4'
})

export const RESIDUE_NATURE_LABELS = /** @type {Record<string, string>} */ ({
  acidic: 'Acidic', basic: 'Basic', polar: 'Polar',
  aliphatic: 'Aliphatic', aromatic: 'Aromatic',
  special: 'Special', other: 'Other'
})

// ── Secondary structure colours ──────────────────────────────────────────────
/** Default hex colours per secondary structure code. Mutable per-view. */
export const SS_COLORS_DEFAULT = /** @type {Record<string, string>} */ ({
  H:  '#b48dda',  // alpha helix  – lavender   RGB(180,141,218)
  G:  '#7b3fb5',  // 3-10 helix   – medium violet RGB(123,63,181)
  I:  '#3d1a6e',  // pi helix     – deep indigo  RGB(61,26,110)
  PP: '#f9c74f',  // polyproline  – golden yellow
  E:  '#2196a6',  // beta sheet   – deep teal
  C:  '#e8e8e8',  // coil         – light gray
  T:  '#b5d5c8'   // turn         – soft sage green
})

export const SS_LABELS = /** @type {Record<string, string>} */ ({
  H: 'Alpha helix', G: '3-10 helix', I: 'Pi helix',
  PP: 'Polyproline', E: 'Sheet', C: 'Coil', T: 'Turn'
})

// ── Material presets ─────────────────────────────────────────────────────────
/** [metalness, roughness, emissiveIntensity] */
export const MATERIAL_PRESETS = /** @type {Record<string, [number,number,number]>} */ ({
  Default:  [0.08, 0.48, 0.0],
  Shiny:    [0.10, 0.10, 0.0],
  Matte:    [0.00, 0.90, 0.05],
  Metallic: [0.80, 0.20, 0.0],
  Plastic:  [0.05, 0.30, 0.0],
  Glowing:  [0.00, 0.15, 2.5],
  Goodsell: [0.0, 1.0, 0.0]
})

/** Per-view bulb options when preset is Glowing. */
export const GLOWING_MATERIAL_DEFAULTS = {
  /** Spawn colored point lights at atoms (illuminates the whole scene). */
  glowEmitLight: true,
  /** Point-light intensity (candela in Three.js physical units). */
  glowLightIntensity: 18,
  /** Light falloff radius in Å (same units as structure coordinates). */
  glowLightDistance: 24,
  /** Inverse-square falloff exponent (2 = physical). */
  glowLightDecay: 2,
  /** Cap lights for performance when many atoms are shown. */
  glowMaxLights: 48,
  /** Which atoms become bulbs: all, non_hydrogen, or highlighted selection only. */
  glowAtomFilter: /** @type {'all' | 'non_hydrogen' | 'highlighted'} */ ('non_hydrogen')
}

/** Glowing preset slider ranges in ViewItem (extended for extreme looks). */
export const GLOWING_UI_SLIDERS = [
  { label: 'Surface glow', key: 'emissiveIntensity', min: 0, max: 20, step: 0.25, decimals: 1 },
  { label: 'Light power', key: 'glowLightIntensity', min: 0, max: 300, step: 1, decimals: 0 },
  { label: 'Light reach', key: 'glowLightDistance', min: 1, max: 500, step: 1, decimals: 0 },
  { label: 'Max bulbs', key: 'glowMaxLights', min: 1, max: 48, step: 1, decimals: 0 }
]

/** Pastel chain palette for the Goodsell material (Mol* / David Goodsell style). */
export const GOODSELL_CHAIN_PALETTE_HEX = [
  '#f4a3a8', '#a8d4a0', '#9ec5e8', '#f7d08a',
  '#c5a3d9', '#7ec8c8', '#f5b87a', '#b8c4e8',
  '#e8a0c8', '#98d4b0'
]

/** Per-view Goodsell options (stored on view.material when preset is Goodsell). */
export const GOODSELL_MATERIAL_DEFAULTS = {
  outlinesEnabled: true,
  outlineColor: '#000000',
  outlineWidth: 0.12,
  useGoodsellLighting: true
}

/**
 * @param {{ preset?: string, metalness?: number, roughness?: number, emissiveIntensity?: number, outlinesEnabled?: boolean, outlineColor?: string, outlineWidth?: number, useGoodsellLighting?: boolean }} material
 */
export function isGoodsellMaterial(material) {
  return material?.preset === 'Goodsell'
}

/**
 * @param {Record<string, unknown> | null | undefined} material
 */
export function isGlowingMaterial(material) {
  return material?.preset === 'Glowing'
}

/**
 * Merge stored Glowing options with defaults (handles older saved views).
 * @param {Record<string, unknown> | null | undefined} material
 */
export function resolveGlowingMaterial(material) {
  if (!isGlowingMaterial(material)) return material
  return { ...GLOWING_MATERIAL_DEFAULTS, ...material }
}

/**
 * @param {string} preset
 */
export function buildMaterialFromPreset(preset) {
  const values = MATERIAL_PRESETS[preset] ?? MATERIAL_PRESETS.Default
  const [metalness, roughness, emissiveIntensity] = values
  if (preset === 'Goodsell') {
    return { preset, metalness, roughness, emissiveIntensity, ...GOODSELL_MATERIAL_DEFAULTS }
  }
  if (preset === 'Glowing') {
    return { preset, metalness, roughness, emissiveIntensity, ...GLOWING_MATERIAL_DEFAULTS }
  }
  return { preset, metalness, roughness, emissiveIntensity }
}

export const DEFAULT_VIEW_MATERIAL = buildMaterialFromPreset('Default')

export const COLOR_PALETTE = [
  // intense colors
  new Color().setRGB(1.0, 0.05, 0.05), // red
  new Color().setRGB(1.0, 1.0, 0.05), // yellow
  new Color().setRGB(1.0, 0.2, 0.8), // magenta
  new Color().setRGB(0.05, 1.0, 0.05), // green
  new Color().setRGB(0.05, 0.05, 1.0), // blue
  new Color().setRGB(0.05, 1.0, 1.0), // cyan
  new Color().setRGB(1.0, 0.5, 0.05), // orange
  new Color().setRGB(0.6, 0.6, 0.6), // light gray
  // lighter colors
  new Color().setRGB(1.0, 0.6, 0.6), // salmon
  new Color().setRGB(1.0, 0.87, 0.37), // yellow orange
  new Color().setRGB(1.0, 0.65, 0.85), // pink
  new Color().setRGB(0.75, 1.0, 0.25), // limon
  new Color().setRGB(0.75, 0.75, 1.0), // light blue
  new Color().setRGB(0.5, 1.0, 1.0), // aquamarine
  new Color().setRGB(1.0, 0.7, 0.2), // bright orange
  new Color().setRGB(0.9, 0.9, 0.9), // light gray
  // darker colors
  new Color().setRGB(0.698, 0.13, 0.13), // firebrick
  new Color().setRGB(0.65, 0.32, 0.17), // brown
  new Color().setRGB(0.55, 0.25, 0.6), // violet purple
  new Color().setRGB(0.2, 0.6, 0.2), // forest
  new Color().setRGB(0.25, 0.25, 0.65), // deep blue
  new Color().setRGB(0.1, 0.6, 0.6), // deep teal
  new Color().setRGB(1.0, 0.55, 0.15), // tv orange
  new Color().setRGB(0.3, 0.3, 0.3) // dark gray
]

/**
 * @param {{carbonColor?: string | number |Color}} options
 * @returns {(atom: AtomLike) => Color}
 */
export function cpkScheme({ carbonColor = undefined } = {}) {
  if (carbonColor) {
    carbonColor = parseColor(carbonColor)
  }
  /** CPK-style colors (hex sRGB). Keys are title-case element symbols (H, Cl, Na, …). */
  const colors = /** @type {Record<string, Color>} */ ({
    H: new Color(0xffffff),
    C: carbonColor ?? new Color(0x8f8f8f),
    N: new Color(0x304ff7),
    O: new Color(0xff0d0d),
    S: new Color(0xfafa33),
    P: new Color(0xff8000),
    F: new Color(0x8fe04f),
    Cl: new Color(0x48b85c),
    Br: new Color(0xa62929),
    I: new Color(0x940094),
    Fe: new Color(0xe06633),
    Zn: new Color(0x7d80b0),
    Cu: new Color(0xc78033),
    Mn: new Color(0x9c78c7),
    Na: new Color(0xab5cf0),
    Mg: new Color(0x8a99c7),
    Ca: new Color(0xab5cf0),
    K: new Color(0x8f40d4),
    Se: new Color(0xcc9933),
    Si: new Color(0xde7dc9),
    B: new Color(0xffb5b5),
    Li: new Color(0x8a47c7),
    He: new Color(0xd9ffff),
    Ne: new Color(0xb3e3f5),
    Ar: new Color(0x8fd1fa),
    Co: new Color(0xf08fa1),
    Mo: new Color(0x54b5b5),
    W: new Color(0x2194b0)
  })
  const fallback = new Color(0xcccccc) // gray

  return (atom) => {
    const raw = String(atom.element ?? '').trim()
    if (!raw) return fallback
    // Exact match first (H, Cl, …), then title-case so MDA's "CL"/"NA" resolve
    if (colors[raw]) return colors[raw]
    const key =
      raw.length === 1
        ? raw.toUpperCase()
        : raw[0].toUpperCase() + raw.slice(1).toLowerCase()
    return colors[key] ?? fallback
  }
}

/**
 * @param {string | number} hexColor — e.g. `'#4488ff'` or `0x4488ff`
 * @returns {(atom: AtomLike) => Color}
 */
export function constantScheme(hexColor) {
  const color = parseColor(hexColor)
  return () => color
}

/**
 * @param {Color | string | number} color
 * @returns {Color}
 */
function parseColor(color) {
  if (typeof color === 'string') {
    if (!color.startsWith('#')) {
      color = `#${color}`
    }
    return new Color(color)
  } else if (typeof color === 'number') {
    return new Color().setHex(color)
  }
  return color
}

/** Shared resolver for the default CPK scheme (one cache for the whole app). */
export const defaultColorScheme = cpkScheme()

// ── Chain colour scheme ───────────────────────────────────────────────────────
/**
 * Returns a resolver that colours atoms by chain_id, cycling through the
 * CHAIN_PALETTE_HEX.  Call once per view so each call gets its own cache.
 * @returns {(atom: AtomLike) => Color}
 */
export function chainScheme() {
  /** @type {Map<string, Color>} */
  const cache = new Map()
  let chainIndex = 0
  return (atom) => {
    const key = atom.chain_id ?? atom.chainId ?? ''
    if (!cache.has(key)) {
      const hex = CHAIN_PALETTE_HEX[chainIndex % CHAIN_PALETTE_HEX.length]
      cache.set(key, new Color(hex))
      chainIndex++
    }
    return cache.get(key)
  }
}

/**
 * Soft pastel chain colours for Goodsell / Molecule of the Month style cartoon.
 * @returns {(atom: AtomLike) => Color}
 */
export function goodsellChainScheme() {
  /** @type {Map<string, Color>} */
  const cache = new Map()
  let chainIndex = 0
  return (atom) => {
    const key = atom.chain_id ?? atom.chainId ?? ''
    if (!cache.has(key)) {
      const hex = GOODSELL_CHAIN_PALETTE_HEX[chainIndex % GOODSELL_CHAIN_PALETTE_HEX.length]
      cache.set(key, new Color(hex))
      chainIndex++
    }
    return cache.get(key)
  }
}

// ── Residue-nature colour scheme ──────────────────────────────────────────────
/**
 * Returns a resolver that colours atoms by residue chemical nature.
 * @returns {(atom: AtomLike) => Color}
 */
export function residueNatureScheme() {
  /** @type {Map<string, Color>} */
  const cache = new Map()
  return (atom) => {
    const resName = (atom.res_name ?? atom.resName ?? '').toUpperCase()
    if (!cache.has(resName)) {
      const nature = RESIDUE_NATURE[resName] ?? 'other'
      cache.set(resName, new Color(RESIDUE_NATURE_COLORS[nature]))
    }
    return cache.get(resName)
  }
}

// ── Secondary-structure colour scheme ────────────────────────────────────────
/**
 * Build a per-atom lookup from the view's residues array, then return a
 * resolver.  Pass optional `ssColorsHex` to override default colours.
 * @param {Array<{ atom_indices: number[], sec?: string }>} residues
 * @param {Record<string, string>} [ssColorsHex]  – e.g. { H: '#ff0000', ... }
 * @returns {(atom: AtomLike & { index?: number }) => Color}
 */
export function ssScheme(residues, ssColorsHex = {}) {
  const colors = { ...SS_COLORS_DEFAULT, ...ssColorsHex }
  // Build atom-index → ss code map
  /** @type {Map<number, string>} */
  const atomSs = new Map()
  for (const res of residues ?? []) {
    const code = res.sec ?? 'C'
    for (const ai of res.atom_indices ?? []) {
      atomSs.set(ai, code)
    }
  }
  /** @type {Map<string, Color>} */
  const colorCache = new Map()
  for (const [code, hex] of Object.entries(colors)) {
    colorCache.set(code, new Color(hex))
  }
  const fallback = new Color(colors.C ?? '#e8e8e8')
  return (atom) => {
    const code = atomSs.get(atom.index) ?? 'C'
    return colorCache.get(code) ?? fallback
  }
}
