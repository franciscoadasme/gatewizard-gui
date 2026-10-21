/**
 * Ball-and-stick atoms for disulfide pairs reported as (residue name, residue number).
 * The detector does not return a chain id, so each pair is the closest SG–SG match
 * on CYS or CYX with those residue numbers.
 */

/**
 * @typedef {{
 *   index: number,
 *   x: number,
 *   y: number,
 *   z: number,
 *   name?: string,
 *   res_name?: string,
 *   res_id?: number,
 *   chain_id?: string
 * }} HighlightAtom
 */

/**
 * @param {HighlightAtom} atom
 */
function isCysteineSulfur(atom) {
  const res = String(atom.res_name || '').toUpperCase()
  const name = String(atom.name || '').toUpperCase()
  return (res === 'CYS' || res === 'CYX') && name === 'SG'
}

/**
 * @param {HighlightAtom} atom
 */
function residueKey(atom) {
  return `${atom.chain_id || ''}:${atom.res_id}`
}

/**
 * @param {HighlightAtom} a
 * @param {HighlightAtom} b
 */
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

/**
 * @param {HighlightAtom[]} left
 * @param {HighlightAtom[]} right
 * @param {boolean} sameResidueNumber
 * @param {number} limit
 * @returns {[HighlightAtom, HighlightAtom] | null}
 */
function closestPair(left, right, sameResidueNumber, limit) {
  /** @type {[HighlightAtom, HighlightAtom] | null} */
  let best = null
  let bestD = Infinity
  if (sameResidueNumber) {
    for (let i = 0; i < left.length; i++) {
      for (let j = i + 1; j < left.length; j++) {
        const d = distance(left[i], left[j])
        if (d <= limit && d < bestD) {
          bestD = d
          best = [left[i], left[j]]
        }
      }
    }
    return best
  }
  for (const a of left) {
    for (const b of right) {
      if (a.index === b.index) continue
      const d = distance(a, b)
      if (d <= limit && d < bestD) {
        bestD = d
        best = [a, b]
      }
    }
  }
  return best
}

/**
 * @param {HighlightAtom[] | null | undefined} atoms
 * @param {Array<[number, number] | number[]> | null | undefined} bonds
 * @param {Array<[[string, number], [string, number]]> | null | undefined} pairs
 * @param {number} [maxDistance]
 * @returns {{ atoms: HighlightAtom[], bonds: [number, number][] }}
 */
export function disulfideHighlight(atoms, bonds, pairs, maxDistance = 2.5) {
  const empty = { atoms: /** @type {HighlightAtom[]} */ ([]), bonds: /** @type {[number, number][]} */ ([]) }
  if (!pairs?.length || !atoms?.length) return empty
  const limit = Number(maxDistance)
  const max = Number.isFinite(limit) && limit > 0 ? limit : Infinity
  const sulfurs = atoms.filter(isCysteineSulfur)
  /** @type {Set<string>} */
  const residueKeys = new Set()
  /** @type {[number, number][]} */
  const bridges = []

  for (const pair of pairs) {
    const id1 = Number(pair?.[0]?.[1])
    const id2 = Number(pair?.[1]?.[1])
    if (!Number.isFinite(id1) || !Number.isFinite(id2)) continue
    const left = sulfurs.filter((atom) => atom.res_id === id1)
    const right = sulfurs.filter((atom) => atom.res_id === id2)
    const match = closestPair(left, right, id1 === id2, max)
    if (!match) continue
    residueKeys.add(residueKey(match[0]))
    residueKeys.add(residueKey(match[1]))
    bridges.push([match[0].index, match[1].index])
  }

  if (!residueKeys.size) return empty

  const highlightAtoms = atoms.filter((atom) => residueKeys.has(residueKey(atom)))
  const present = new Set(highlightAtoms.map((atom) => atom.index))
  /** @type {Set<string>} */
  const seen = new Set()
  /** @type {[number, number][]} */
  const highlightBonds = []

  /**
   * @param {number} i
   * @param {number} j
   */
  function addBond(i, j) {
    if (!present.has(i) || !present.has(j) || i === j) return
    const key = i < j ? `${i}:${j}` : `${j}:${i}`
    if (seen.has(key)) return
    seen.add(key)
    highlightBonds.push([i, j])
  }

  for (const bond of bonds || []) {
    if (!Array.isArray(bond) || bond.length < 2) continue
    addBond(Number(bond[0]), Number(bond[1]))
  }
  for (const [i, j] of bridges) addBond(i, j)

  return { atoms: highlightAtoms, bonds: highlightBonds }
}
