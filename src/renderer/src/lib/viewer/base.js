import { getCentroid } from '../struc.js'

const R_SHELL = 2.3 // radius of the shell around the atoms

/**
 * @param {{ x: number, y: number, z: number }[]|undefined|null} atoms
 * @returns {{ center: { x: number, y: number, z: number }, extent: number } | null}
 */
export function getCameraForAtoms(atoms) {
  if (!atoms?.length) {
    return null
  }

  const centroid = getCentroid(atoms)
  const extent = getExtent(atoms, centroid)
  return { center: centroid, extent }
}

/**
 * @param {{ x: number, y: number, z: number }[]} atoms
 * @param {{ x: number, y: number, z: number }} centroid
 * @returns {number}
 */
function getExtent(atoms, centroid) {
  /** Max distance from centroid to any atom (+ shell); floor keeps tiny sets sane before dist clamp in CameraRig. */
  let extent = 8
  for (const a of atoms) {
    const reach = Math.hypot(a.x - centroid.x, a.y - centroid.y, a.z - centroid.z) + R_SHELL
    if (reach > extent) extent = reach
  }
  return extent
}
