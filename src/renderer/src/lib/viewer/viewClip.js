/**
 * Per-representation hard clipping (camera slab or world axis range).
 * Independent of global depth-cue fog.
 */
import { Plane, Vector3 } from 'three'

/** @typedef {'camera' | 'world'} ClipMode */
/** @typedef {'x' | 'y' | 'z'} ClipAxis */

/**
 * @typedef {{
 *   enabled: boolean,
 *   mode: ClipMode,
 *   axis: ClipAxis,
 *   near: number,
 *   far: number
 * }} ViewClipConfig
 */

/** @type {ViewClipConfig} */
export const DEFAULT_CLIP = {
  enabled: false,
  mode: 'camera',
  axis: 'y',
  near: -50,
  far: 50
}

/**
 * @param {unknown} raw
 * @returns {ViewClipConfig}
 */
export function normalizeClip(raw) {
  const d = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {}
  let near =
    typeof d.near === 'number' && Number.isFinite(d.near) ? d.near : DEFAULT_CLIP.near
  let far = typeof d.far === 'number' && Number.isFinite(d.far) ? d.far : DEFAULT_CLIP.far
  if (far < near + 0.01) far = near + 0.01
  const mode = d.mode === 'world' ? 'world' : 'camera'
  const axis = d.axis === 'x' || d.axis === 'z' ? d.axis : 'y'
  return {
    enabled: d.enabled === true,
    mode,
    axis,
    near,
    far
  }
}

/**
 * Project atom coordinates onto a unit axis (world) or camera look direction.
 * @param {{ x: number, y: number, z: number }} a
 * @param {ClipMode} mode
 * @param {ClipAxis} axis
 * @param {{ x: number, y: number, z: number } | null} lookDir unit view direction (camera → scene)
 */
export function atomClipCoordinate(a, mode, axis, lookDir) {
  if (mode === 'world') {
    if (axis === 'x') return a.x
    if (axis === 'z') return a.z
    return a.y
  }
  if (!lookDir) return a.z
  return a.x * lookDir.x + a.y * lookDir.y + a.z * lookDir.z
}

/**
 * Fit near/far to atom extents along the clip axis/view (±margin).
 * @param {Array<{ x: number, y: number, z: number }>} atoms
 * @param {Partial<ViewClipConfig> | null | undefined} clip
 * @param {import('three').Camera | null | undefined} camera
 * @param {number} [margin]
 * @returns {{ near: number, far: number }}
 */
export function fitClipRangeFromAtoms(atoms, clip, camera, margin = 2) {
  const mode = clip?.mode === 'world' ? 'world' : 'camera'
  const axis = clip?.axis === 'x' || clip?.axis === 'z' ? clip.axis : 'y'
  /** @type {{ x: number, y: number, z: number } | null} */
  let look = null
  if (mode === 'camera' && camera) {
    const dir = new Vector3()
    if (typeof camera.getWorldDirection === 'function') {
      camera.updateMatrixWorld?.(true)
      camera.getWorldDirection(dir)
    } else {
      dir.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize()
    }
    look = { x: dir.x, y: dir.y, z: dir.z }
  }
  if (!atoms?.length) {
    return { near: DEFAULT_CLIP.near, far: DEFAULT_CLIP.far }
  }
  let min = Infinity
  let max = -Infinity
  for (const a of atoms) {
    const t = atomClipCoordinate(a, mode, axis, look)
    if (t < min) min = t
    if (t > max) max = t
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { near: DEFAULT_CLIP.near, far: DEFAULT_CLIP.far }
  }
  const pad = Math.max(0, margin)
  return { near: min - pad, far: Math.max(min - pad + 0.01, max + pad) }
}

const _look = new Vector3()
const _nNear = new Vector3()
const _nFar = new Vector3()
const _axis = new Vector3()

/**
 * Build two clip planes that keep geometry with coordinate in [near, far].
 * Camera mode: coordinate = position · lookDir (view axis).
 * World mode: coordinate = position.x|y|z.
 *
 * Three.js keeps fragments where plane.distanceToPoint(p) >= 0
 * (n·p + constant >= 0). So for keep t in [near, far]:
 *   near plane:  look · p >= near  → n=look, c=-near
 *   far plane:  -look · p >= -far → n=-look, c=far
 *
 * @param {ViewClipConfig | null | undefined} clip
 * @param {import('three').Camera | null | undefined} camera
 * @param {Plane[]} [out]
 * @returns {Plane[]}
 */
export function planesFromClip(clip, camera, out) {
  if (!clip?.enabled) return []
  const planes =
    out && Array.isArray(out) && out.length >= 2
      ? out
      : [new Plane(), new Plane()]
  const near = clip.near
  const far = Math.max(near + 0.01, clip.far)

  if (clip.mode === 'world') {
    if (clip.axis === 'x') _axis.set(1, 0, 0)
    else if (clip.axis === 'z') _axis.set(0, 0, 1)
    else _axis.set(0, 1, 0)
    planes[0].set(_axis, -near)
    planes[1].set(_nFar.copy(_axis).negate(), far)
    if (planes.length > 2) planes.length = 2
    return planes
  }

  if (!camera) return []
  // Prefer getWorldDirection (uses matrixWorld) so orbit updates are reliable.
  if (typeof camera.getWorldDirection === 'function') {
    camera.getWorldDirection(_look)
  } else {
    _look.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize()
  }
  planes[0].set(_nNear.copy(_look), -near)
  planes[1].set(_nFar.copy(_look).negate(), far)
  // Return the same array instance so materials keep stable Plane object refs
  // while we mutate equations each frame.
  if (planes.length > 2) planes.length = 2
  return planes
}

/**
 * Apply (or clear) clippingPlanes on every mesh material under root.
 * @param {import('three').Object3D | null | undefined} root
 * @param {Plane[]} planes
 */
export function applyClipToObject3D(root, planes) {
  if (!root) return
  const list = planes?.length ? planes : null
  root.traverse((obj) => {
    const mesh = /** @type {import('three').Mesh & { isMesh?: boolean, isInstancedMesh?: boolean, isPoints?: boolean, isLine?: boolean }} */ (
      obj
    )
    if (!(mesh.isMesh || mesh.isInstancedMesh || mesh.isPoints || mesh.isLine)) return
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    for (const mat of mats) {
      if (!mat || typeof mat !== 'object') continue
      const m = /** @type {import('three').Material & { clippingPlanes?: Plane[] | null, clipIntersection?: boolean, needsUpdate?: boolean }} */ (
        mat
      )
      const prev = m.clippingPlanes
      const same =
        (!list && (!prev || prev.length === 0)) ||
        (list &&
          prev &&
          prev.length === list.length &&
          prev.every((p, i) => p === list[i]))
      if (same) continue
      m.clippingPlanes = list
      m.clipIntersection = false
      m.needsUpdate = true
    }
  })
}
