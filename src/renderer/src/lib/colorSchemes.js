import { Color } from 'three'

/**
 * @typedef {{ x: number, y: number, z: number, element: string, name: string }} AtomLike
 */

/**
 * @returns {(atom: AtomLike) => Color}
 */
export function cpkScheme() {
  /** CPK-style colors (hex sRGB). */
  const colors = /** @type {Record<string, Color>} */ ({
    H: new Color(0xffffff),
    C: new Color(0x8f8f8f),
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
  const color = new Color(hexColor)
  return () => color
}

/** Shared resolver for the default CPK scheme (one cache for the whole app). */
export const defaultColorScheme = cpkScheme()
