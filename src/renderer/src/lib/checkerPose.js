/**
 * Which conformation each atom belongs to when the checker draws a tick.
 *
 * A real altLoc letter on the atom wins. When the letter is missing, two
 * overlapping copies of the same atom name are A, then B, in atom-index
 * order. That is the same order the structure checker uses. A name that
 * appears once is shared and stays with every tick. Two residues that
 * occupy one site use the copy letter stored on the checker group.
 */

/**
 * @param {Array<{ index: number, name?: string, altloc?: string, chain_id?: string, res_id?: number, res_name?: string }>} atoms
 * @param {{ inferred?: boolean, mode?: string, options?: Array<{ altloc?: string, chain?: string, resid?: number, resname?: string }> } | null | undefined} group
 * @returns {Map<number, string>}
 */
export function poseLetterByAtom(atoms, group) {
  /** @type {Map<number, string>} */
  const marks = new Map()
  const listed = atoms || []
  const anyAlt = listed.some((atom) => String(atom.altloc || '').trim())
  if (anyAlt) {
    for (const atom of listed) marks.set(atom.index, String(atom.altloc || '').trim().toUpperCase())
    return marks
  }
  if (group?.mode === 'copies') {
    /** @type {Map<string, string>} */
    const byPlace = new Map()
    for (const option of group.options || []) {
      const key = `${option.chain || ''}|${option.resid}|${String(option.resname || '').toUpperCase()}`
      byPlace.set(key, String(option.altloc || '').trim().toUpperCase())
    }
    for (const atom of listed) {
      const key = `${String(atom.chain_id || '').trim()}|${atom.res_id}|${String(atom.res_name || '').trim().toUpperCase()}`
      marks.set(atom.index, byPlace.get(key) || '')
    }
    return marks
  }
  const ordered = [...listed].sort((a, b) => a.index - b.index)
  /** @type {Map<string, number>} */
  const totals = new Map()
  for (const atom of ordered) {
    const name = String(atom.name || '').trim().toUpperCase()
    totals.set(name, (totals.get(name) || 0) + 1)
  }
  /** @type {Map<string, number>} */
  const seen = new Map()
  for (const atom of ordered) {
    const name = String(atom.name || '').trim().toUpperCase()
    const count = (seen.get(name) || 0) + 1
    seen.set(name, count)
    const repeated = (totals.get(name) || 0) > 1
    marks.set(atom.index, repeated ? String.fromCharCode(64 + count) : '')
  }
  return marks
}

/**
 * Atoms whose pose is ticked. A blank letter is shared and stays visible.
 * @param {Array<{ index: number }>} atoms
 * @param {string[]} wanted
 * @param {Map<number, string>} marks
 */
export function atomsForTickedPoses(atoms, wanted, marks) {
  const letters = (wanted || []).map((letter) => String(letter || '').trim().toUpperCase()).filter(Boolean)
  if (!letters.length) return atoms || []
  return (atoms || []).filter((atom) => {
    const mark = marks.get(atom.index) || ''
    return !mark || letters.includes(mark)
  })
}

/**
 * @param {string} left
 * @param {string} right
 */
export function bondJoinsOnePose(left, right) {
  if (!left || !right) return true
  return left === right
}
