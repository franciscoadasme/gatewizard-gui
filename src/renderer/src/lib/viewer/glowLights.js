/**
 * Pick atoms that spawn point lights for the Glowing material preset.
 *
 * @typedef {'all' | 'non_hydrogen' | 'highlighted'} GlowAtomFilter
 * @typedef {{ x: number, y: number, z: number, element?: string, index?: number }} GlowAtom
 */

/**
 * @param {GlowAtom[]} atoms
 * @param {GlowAtomFilter} filter
 * @returns {number}
 */
export function countGlowPool(atoms, filter) {
  if (!atoms?.length) return 0
  if (filter === 'non_hydrogen') {
    return atoms.filter((a) => String(a.element || 'C').trim().toUpperCase() !== 'H').length
  }
  if (filter === 'highlighted') {
    return 0
  }
  return atoms.length
}

/**
 * @param {GlowAtom[]} atoms
 * @param {{ filter?: GlowAtomFilter, maxLights?: number, highlightIndices?: Set<number> }} options
 * @returns {GlowAtom[]}
 */
export function selectGlowLightAtoms(atoms, options = {}) {
  const { filter = 'non_hydrogen', maxLights = 48, highlightIndices = new Set() } = options
  if (!atoms?.length) return []

  /** @type {GlowAtom[]} */
  let pool = atoms

  if (filter === 'non_hydrogen') {
    pool = pool.filter((a) => String(a.element || 'C').trim().toUpperCase() !== 'H')
  } else if (filter === 'highlighted') {
    pool = pool.filter((a) => a.index !== undefined && highlightIndices.has(a.index))
  }

  if (pool.length <= maxLights) return pool

  /** @type {GlowAtom[]} */
  const sampled = []
  const step = pool.length / maxLights
  for (let i = 0; i < maxLights; i++) {
    sampled.push(pool[Math.floor(i * step)])
  }
  return sampled
}
