/**
 * Atom indices grouped by chain and by chain+residue, built once per structure.
 * @param {Array<{ index?: number, chain_id?: string, res_id?: number }> | null | undefined} atoms
 */
export function buildSelectionGroups(atoms) {
  /** @type {Map<string, number[]>} */
  const chains = new Map()
  /** @type {Map<string, number[]>} */
  const residues = new Map()
  for (const atom of atoms || []) {
    if (typeof atom?.index !== 'number') continue
    const chain = String(atom.chain_id ?? '')
    let chainList = chains.get(chain)
    if (!chainList) {
      chainList = []
      chains.set(chain, chainList)
    }
    chainList.push(atom.index)
    const resKey = `${chain}\0${atom.res_id}`
    let resList = residues.get(resKey)
    if (!resList) {
      resList = []
      residues.set(resKey, resList)
    }
    resList.push(atom.index)
  }
  return { chains, residues }
}

/**
 * Stable id for the selection group under the pointer.
 * The same chain keeps one id while the pointer moves along it.
 * @param {{ index?: number, chain_id?: string, res_id?: number, structureId?: string } | null | undefined} atom
 * @param {string} level
 */
export function selectionGroupKey(atom, level) {
  if (!atom) return ''
  if (level === 'atom') return `a:${atom.index}`
  if (level === 'residue') return `r:${atom.chain_id}:${atom.res_id}`
  if (level === 'chain') return `c:${atom.chain_id}`
  return `m:${atom.structureId ?? ''}:${atom.index}`
}

/**
 * Indices for atom, residue, or chain. Molecule stays with the caller.
 * @param {{ chains: Map<string, number[]>, residues: Map<string, number[]> } | null | undefined} groups
 * @param {{ index?: number, chain_id?: string, res_id?: number }} atom
 * @param {string} level
 * @returns {number[] | null}
 */
export function selectionGroupIndices(groups, atom, level) {
  if (!atom || typeof atom.index !== 'number') return []
  if (level === 'atom') return [atom.index]
  if (!groups) return []
  if (level === 'chain') return groups.chains.get(String(atom.chain_id ?? '')) ?? []
  if (level === 'residue') {
    return groups.residues.get(`${String(atom.chain_id ?? '')}\0${atom.res_id}`) ?? []
  }
  return null
}
