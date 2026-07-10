import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import { vdwRadius, worldToScreen } from './picking.js'

export { vdwRadius, worldToScreen }

const _raycaster = new Raycaster()
const _ndc = new Vector2()
const _plane = new Plane()
const _pt = new Vector3()

const MIN_BOX_SIZE = 1.0
const AXIS_INDEX = { x: 0, y: 1, z: 2 }

/**
 * @param {Array<{ x: number, y: number, z: number, element?: string }>} atoms
 * @param {number} [padding]
 */
export function boundsFromAtomsWithVdw(atoms, padding = 0) {
  if (!atoms?.length) return null
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (const a of atoms) {
    const r = vdwRadius(a.element) + padding
    minX = Math.min(minX, a.x - r)
    minY = Math.min(minY, a.y - r)
    minZ = Math.min(minZ, a.z - r)
    maxX = Math.max(maxX, a.x + r)
    maxY = Math.max(maxY, a.y + r)
    maxZ = Math.max(maxZ, a.z + r)
  }
  if (!Number.isFinite(minX)) return null
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ]
  }
}

/** @param {number[]} min @param {number[]} max */
export function boxCenter(min, max) {
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
}

/**
 * @param {import('three').Camera} camera
 * @param {DOMRect} rect
 * @param {number} clientX
 * @param {number} clientY
 */
function pointerRay(camera, rect, clientX, clientY) {
  _ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
  _ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
  _raycaster.setFromCamera(_ndc, camera)
  return _raycaster.ray
}

/**
 * Unproject pointer onto the plane through `planePoint` facing the camera.
 * @param {import('three').Camera} camera
 * @param {DOMRect} rect
 * @param {number} clientX
 * @param {number} clientY
 * @param {number[]} planePoint
 * @returns {[number, number, number] | null}
 */
export function unprojectOnCameraPlane(camera, rect, clientX, clientY, planePoint) {
  if (!camera || !rect.width || !rect.height) return null
  const ray = pointerRay(camera, rect, clientX, clientY)
  const normal = new Vector3()
  camera.getWorldDirection(normal)
  _plane.setFromNormalAndCoplanarPoint(normal, _pt.set(planePoint[0], planePoint[1], planePoint[2]))
  if (ray.intersectPlane(_plane, _pt) === null) return null
  return [_pt.x, _pt.y, _pt.z]
}

/**
 * @param {number[]} min
 * @param {number[]} max
 * @param {'x'|'y'|'z'} axis
 * @param {'min'|'max'} side
 */
function faceCenter(min, max, axis, side) {
  const c = boxCenter(min, max)
  const i = AXIS_INDEX[axis]
  c[i] = side === 'min' ? min[i] : max[i]
  return c
}

/** @returns {number[][]} eight corners */
export function boxCorners(min, max) {
  const [x0, y0, z0] = min
  const [x1, y1, z1] = max
  return [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1]
  ]
}

const BOX_EDGES = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7]
]

/** Face quads as corner indices + metadata for picking. */
const BOX_FACES = [
  { axis: 'x', side: 'min', idx: [0, 3, 7, 4] },
  { axis: 'x', side: 'max', idx: [1, 2, 6, 5] },
  { axis: 'y', side: 'min', idx: [0, 1, 5, 4] },
  { axis: 'y', side: 'max', idx: [3, 2, 6, 7] },
  { axis: 'z', side: 'min', idx: [0, 1, 2, 3] },
  { axis: 'z', side: 'max', idx: [4, 5, 6, 7] }
]

/**
 * @param {import('three').Camera} camera
 * @param {number} width
 * @param {number} height
 * @param {number[]} min
 * @param {number[]} max
 */
export function projectHydrationBox(camera, width, height, min, max) {
  if (!camera || !width || !height) {
    return { edges: [], handles: [], faces: [], pixPerAng: 1 }
  }
  const corners = boxCorners(min, max)
  /** @param {number[]} p */
  const proj = (p) => worldToScreen({ x: p[0], y: p[1], z: p[2] }, camera, width, height)

  const edges = BOX_EDGES.map(([a, b]) => ({ a: proj(corners[a]), b: proj(corners[b]) }))
  const handles = BOX_FACES.map(({ axis, side, idx }) => {
    const pts = idx.map((i) => corners[i])
    const cx = (pts[0][0] + pts[1][0] + pts[2][0] + pts[3][0]) / 4
    const cy = (pts[0][1] + pts[1][1] + pts[2][1] + pts[3][1]) / 4
    const cz = (pts[0][2] + pts[1][2] + pts[2][2] + pts[3][2]) / 4
    return { axis, side, scr: proj([cx, cy, cz]) }
  })
  const faces = BOX_FACES.map(({ axis, side, idx }) => ({
    axis,
    side,
    pts: idx.map((i) => proj(corners[i]))
  }))

  const c0 = boxCenter(min, max)
  const c1 = [c0[0] + 4, c0[1], c0[2]]
  const p0 = proj(c0)
  const p1 = proj(c1)
  const pixPerAng = Math.max(Math.hypot(p1.x - p0.x, p1.y - p0.y) / 4, 0.5)

  return { edges, handles, faces, pixPerAng }
}

/** @param {{ x: number, y: number }} p @param {{ x: number, y: number }[]} poly */
function pointInPolygon(p, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x
    const yi = poly[i].y
    const xj = poly[j].x
    const yj = poly[j].y
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/**
 * @param {number} sx screen x (canvas-local)
 * @param {number} sy screen y
 * @param {ReturnType<typeof projectHydrationBox>} layout
 * @param {import('three').Camera} camera
 * @param {number[]} min
 * @param {number[]} max
 */
export function pickHydrationBoxScreen(sx, sy, layout, camera, min, max) {
  const p = { x: sx, y: sy }
  let bestHandle = null
  for (const h of layout.handles) {
    const d = Math.hypot(h.scr.x - sx, h.scr.y - sy)
    if (d <= 14 && (!bestHandle || d < bestHandle.dist)) {
      bestHandle = { axis: h.axis, side: h.side, dist: d, mode: 'resize' }
    }
  }
  if (bestHandle) return bestHandle

  const camDir = new Vector3()
  camera.getWorldDirection(camDir)
  /** @type {{ axis: string, side: string, score: number, mode: string } | null} */
  let bestFace = null
  for (const f of layout.faces) {
    if (!pointInPolygon(p, f.pts)) continue
    const i = AXIS_INDEX[f.axis]
    const normal = new Vector3()
    normal.setComponent(i, f.side === 'min' ? -1 : 1)
    const score = normal.dot(camDir)
    if (!bestFace || score < bestFace.score) {
      bestFace = { axis: f.axis, side: f.side, score, mode: 'translate' }
    }
  }
  return bestFace
}

/**
 * @param {object} drag
 * @param {import('three').Camera} camera
 * @param {DOMRect} rect
 * @param {number} clientX
 * @param {number} clientY
 */
export function applyHydrationBoxDrag(drag, camera, rect, clientX, clientY) {
  const hit = unprojectOnCameraPlane(camera, rect, clientX, clientY, drag.planePoint)
  if (!hit) return null

  if (drag.mode === 'translate') {
    const dx = hit[0] - drag.anchor[0]
    const dy = hit[1] - drag.anchor[1]
    const dz = hit[2] - drag.anchor[2]
    return enforceMinBoxSize(
      [drag.startMin[0] + dx, drag.startMin[1] + dy, drag.startMin[2] + dz],
      [drag.startMax[0] + dx, drag.startMax[1] + dy, drag.startMax[2] + dz],
      drag
    )
  }

  const i = AXIS_INDEX[drag.axis]
  const delta = hit[i] - drag.anchor[i]
  const newMin = [...drag.startMin]
  const newMax = [...drag.startMax]
  if (drag.side === 'min') newMin[i] = drag.startMin[i] + delta
  else newMax[i] = drag.startMax[i] + delta
  return enforceMinBoxSize(newMin, newMax, drag)
}

/** Build drag state after a successful screen pick. */
export function beginHydrationBoxDrag(pick, camera, rect, clientX, clientY, min, max) {
  const planePoint = boxCenter(min, max)
  const anchor = unprojectOnCameraPlane(camera, rect, clientX, clientY, planePoint)
  if (!anchor) return null
  return {
    mode: pick.mode,
    axis: pick.axis,
    side: pick.side,
    planePoint: [...planePoint],
    anchor,
    startMin: [...min],
    startMax: [...max]
  }
}

function enforceMinBoxSize(min, max, drag) {
  const newMin = [...min]
  const newMax = [...max]
  for (let i = 0; i < 3; i++) {
    if (newMax[i] - newMin[i] < MIN_BOX_SIZE) {
      if (drag.mode === 'resize' && AXIS_INDEX[drag.axis] === i) {
        if (drag.side === 'min') newMin[i] = newMax[i] - MIN_BOX_SIZE
        else newMax[i] = newMin[i] + MIN_BOX_SIZE
      } else {
        const mid = (newMin[i] + newMax[i]) / 2
        newMin[i] = mid - MIN_BOX_SIZE / 2
        newMax[i] = mid + MIN_BOX_SIZE / 2
      }
    }
  }
  return { min: newMin, max: newMax }
}
