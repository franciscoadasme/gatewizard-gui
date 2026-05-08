/**
 * @param {{ x: number, y: number, z: number }[]} atoms
 * @returns {{ x: number, y: number, z: number }}
 */
export function getCentroid(atoms) {
  let cx = 0
  let cy = 0
  let cz = 0
  for (const a of atoms) {
    cx += a.x
    cy += a.y
    cz += a.z
  }
  const n = atoms.length
  cx /= n
  cy /= n
  cz /= n

  return { x: cx, y: cy, z: cz }
}
