import { Vector3 } from 'three'

/** Approximate van der Waals radii (Å) — matches VdwSpheres representation. */
const VDW = {
  H: 1.2, C: 1.7, N: 1.55, O: 1.52, F: 1.47, P: 1.8, S: 1.8,
  CL: 1.75, BR: 1.83, I: 1.98, FE: 1.94, ZN: 1.39, NA: 2.27,
  MG: 1.73, CA: 1.97, K: 2.75, SE: 1.9
}
const DEFAULT_VDW = 1.7

function vdwRadius(el) {
  const k = String(el || 'C').trim().toUpperCase().slice(0, 2)
  if (VDW[k] !== undefined) return VDW[k]
  if (k.length >= 1 && VDW[k[0]] !== undefined) return VDW[k[0]]
  return DEFAULT_VDW
}

/**
 * Project a world-space position to canvas-local pixel coordinates.
 * @param {{ x: number, y: number, z: number }} pos
 * @param {import('three').Camera} camera
 * @param {number} w - canvas width in pixels
 * @param {number} h - canvas height in pixels
 * @returns {{ x: number, y: number }}
 */
export function worldToScreen(pos, camera, w, h) {
  const v = new Vector3(pos.x, pos.y, pos.z).project(camera)
  return {
    x: (v.x * 0.5 + 0.5) * w,
    y: (1 - (v.y * 0.5 + 0.5)) * h
  }
}

/**
 * Find the nearest VISIBLE atom to a canvas-local pointer position.
 *
 * - Uses the atom's VdW screen-space radius as the pick radius so hovering
 *   anywhere on the rendered sphere works (not just near its centre).
 * - Among all candidate atoms within their pick radius, returns the one
 *   CLOSEST to the camera (smallest NDC z-depth) so occluded atoms are
 *   never picked over foreground atoms.
 *
 * @param {Array<{ visible: boolean, atoms: Array<{ x:number, y:number, z:number, element?:string }> | undefined }>} views
 * @param {import('three').Camera} camera
 * @param {number} w
 * @param {number} h
 * @param {number} cx - canvas-local x of pointer
 * @param {number} cy - canvas-local y of pointer
 * @param {number} [minThreshold=20] - minimum pixel pick radius (fallback for non-VdW atoms)
 * @returns {object | null}
 */
export function pickAtomFromViews(views, camera, w, h, cx, cy, minThreshold = 20) {
  let best = null
  let bestDepth = Infinity

  // Pixels per world-unit for the orthographic camera.
  const worldW = (camera.right ?? 1) - (camera.left ?? -1)
  const pxPerUnit = worldW > 0 ? w / worldW : 1

  const _v = new Vector3()

  for (const view of views) {
    if (!view.visible || !view.atoms) continue
    for (const atom of view.atoms) {
      _v.set(atom.x, atom.y, atom.z).project(camera)
      // Skip atoms behind the camera
      if (_v.z > 1) continue
      const sx = (_v.x * 0.5 + 0.5) * w
      const sy = (1 - (_v.y * 0.5 + 0.5)) * h
      const d2 = (sx - cx) ** 2 + (sy - cy) ** 2

      // Effective pick radius: at least minThreshold, or the atom's VdW screen radius
      const atomScreenR = vdwRadius(atom.element) * pxPerUnit
      const pickR = Math.max(minThreshold, atomScreenR)

      if (d2 <= pickR * pickR && _v.z < bestDepth) {
        bestDepth = _v.z
        best = atom
      }
    }
  }

  return best
}
