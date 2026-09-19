import { Vector3 } from 'three'

const _view = new Vector3()
const _fallback = new Vector3()

/**
 * Separation axis for parallel multi-bond sticks so they stay visible from the camera:
 * perpendicular to the bond and to the view (bondDir × toCamera).
 *
 * @param {Vector3} bondDir unit bond direction
 * @param {Vector3} mid bond midpoint (world)
 * @param {Vector3 | null | undefined} cameraPos
 * @param {Vector3} into
 * @returns {Vector3}
 */
export function setMultiBondOffsetAxis(bondDir, mid, cameraPos, into) {
  if (cameraPos) {
    _view.copy(cameraPos).sub(mid)
    if (_view.lengthSq() > 1e-12) {
      _view.normalize()
      into.crossVectors(bondDir, _view)
      if (into.lengthSq() > 1e-10) {
        into.normalize()
        return into
      }
    }
  }
  // Bond pointing at / away from camera — stable world fallback
  _fallback.set(0, 1, 0)
  if (Math.abs(bondDir.dot(_fallback)) > 0.9) _fallback.set(1, 0, 0)
  into.crossVectors(bondDir, _fallback).normalize()
  return into
}
