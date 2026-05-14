import { Color } from 'three'

/**
 * @typedef {{ x: number, y: number, z: number, element: string, name: string }} AtomLike
 */

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
  /** CPK-style colors (hex sRGB). */
  const colors = /** @type {Record<string, Color>} */ ({
    H: new Color(0xffffff),
    C: carbonColor ?? new Color(0x8f8f8f),
    N: new Color(0x304ff7),
    O: new Color(0xff0d0d),
    S: new Color(0xfafa33),
    P: new Color(0xff8000),
    F: new Color(0x8fe04f),
    Cl: new Color(0x1ff01f),
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

  return (atom) => colors[atom.element] ?? fallback
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
