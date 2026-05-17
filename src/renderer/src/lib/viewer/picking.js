import { Vector3 } from 'three'

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
 * Find the nearest visible atom to a canvas-local click position.
 * Iterates over all visible views and returns the closest atom object.
 *
 * @param {Array<{ visible: boolean, atoms: Array<{ x:number, y:number, z:number }> | undefined }>} views
 * @param {import('three').Camera} camera
 * @param {number} w
 * @param {number} h
 * @param {number} cx - canvas-local x of click
 * @param {number} cy - canvas-local y of click
 * @param {number} [threshold=25] - pixel radius threshold
 * @returns {object | null} the atom object, or null if none found within threshold
 */
export function pickAtomFromViews(views, camera, w, h, cx, cy, threshold = 25) {
  let best = null
  let bestD2 = threshold * threshold

  for (const view of views) {
    if (!view.visible || !view.atoms) continue
    for (const atom of view.atoms) {
      const s = worldToScreen(atom, camera, w, h)
      const d2 = (s.x - cx) ** 2 + (s.y - cy) ** 2
      if (d2 < bestD2) {
        bestD2 = d2
        best = atom
      }
    }
  }

  return best
}
