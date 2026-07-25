import { Vector3 } from 'three'

/** Approximate van der Waals radii (Å) — matches VdwSpheres representation. */
const VDW = {
  H: 1.2,
  C: 1.7,
  N: 1.55,
  O: 1.52,
  F: 1.47,
  P: 1.8,
  S: 1.8,
  CL: 1.75,
  BR: 1.83,
  I: 1.98,
  FE: 1.94,
  ZN: 1.39,
  NA: 2.27,
  MG: 1.73,
  CA: 1.97,
  K: 2.75,
  SE: 1.9
}
const DEFAULT_VDW = 1.7

/** Protein backbone atom names (MDAnalysis-style). */
const PROTEIN_BACKBONE_NAMES = new Set([
  'N',
  'CA',
  'C',
  'O',
  'OXT',
  'H',
  'H1',
  'H2',
  'H3',
  'HA',
  'HA2',
  'HA3'
])

/** Nucleic-acid backbone atom names. */
const NA_BACKBONE_NAMES = new Set([
  'P',
  'OP1',
  'OP2',
  "O5'",
  "C5'",
  "C4'",
  "C3'",
  "O3'",
  "O4'",
  "C1'",
  "C2'",
  "O2'",
  'O5*',
  'C5*',
  'C4*',
  'C3*',
  'O3*',
  'O4*',
  'C1*',
  'C2*',
  'O2*'
])

export function vdwRadius(el) {
  const k = String(el || 'C').trim().toUpperCase().slice(0, 2)
  if (VDW[k] !== undefined) return VDW[k]
  if (k.length >= 1 && VDW[k[0]] !== undefined) return VDW[k[0]]
  return DEFAULT_VDW
}

/**
 * @param {unknown} name
 * @returns {boolean}
 */
export function isBackboneAtomName(name) {
  const n = String(name ?? '').trim().toUpperCase()
  if (!n) return false
  return PROTEIN_BACKBONE_NAMES.has(n) || NA_BACKBONE_NAMES.has(n)
}

/**
 * @param {unknown} view
 * @returns {string}
 */
export function viewRepresentationType(view) {
  const r = view?.representation
  if (typeof r === 'string') return r
  if (r && typeof r.type === 'string') return r.type
  return 'points'
}

/**
 * Whether a view should participate in picking (drawn / interactive).
 * @param {unknown} view
 */
export function isViewPickable(view) {
  if (!view || view.visible === false) return false
  if (!Array.isArray(view.atoms) || view.atoms.length === 0) return false
  const op = typeof view.opacity === 'number' ? view.opacity : 1
  if (!(op > 0.001)) return false
  return true
}

/**
 * Whether an atom from a given view is a valid pick target for what is drawn.
 * Cartoon/tube only expose backbone (ribbon); sidechains and hetero not in the
 * ribbon must not steal hits from VDW / ball-and-stick layers.
 * @param {unknown} view
 * @param {{ name?: string }} atom
 */
export function isAtomPickableInView(view, atom) {
  if (!atom) return false
  const repr = viewRepresentationType(view)
  if (repr === 'cartoon' || repr === 'tube') {
    return isBackboneAtomName(atom.name)
  }
  return true
}

/**
 * Screen-space pick radius in pixels for an atom under a representation.
 * Atomistic reps use drawn-size-ish radii; ribbons use a modest tube halo.
 * @param {string} repr
 * @param {{ element?: string }} atom
 * @param {number} pxPerUnit
 * @param {number} minThreshold
 */
export function pickRadiusPx(repr, atom, pxPerUnit, minThreshold) {
  if (repr === 'cartoon' || repr === 'tube') {
    // Ribbon is wider than a CA sphere; keep a usable halo without claiming sidechains.
    return Math.max(minThreshold, 1.8 * pxPerUnit)
  }
  if (repr === 'ball-stick') {
    // Matches BallStick draw scale (~0.5 × covalent ≈ half VdW for C).
    return Math.max(minThreshold * 0.65, vdwRadius(atom.element) * 0.45 * pxPerUnit)
  }
  if (repr === 'points') {
    return Math.max(8, minThreshold * 0.55)
  }
  // vdw (and unknown): full sphere
  return Math.max(minThreshold, vdwRadius(atom.element) * pxPerUnit)
}

/**
 * Tie-break priority when depths are nearly equal — prefer discrete atom glyphs
 * over ribbon traces so ligands / sidechains win against nearby backbone.
 * @param {string} repr
 */
function representationPickPriority(repr) {
  if (repr === 'vdw' || repr === 'ball-stick') return 0
  if (repr === 'points') return 1
  if (repr === 'cartoon' || repr === 'tube') return 2
  return 3
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
 * Find the nearest drawn atom to a canvas-local pointer position.
 *
 * - Skips hidden / fully transparent views (e.g. toggled-off water).
 * - Cartoon / tube only hit backbone atoms (what the ribbon shows).
 * - Pick radius follows representation size (VdW / ball-stick / ribbon / points).
 * - Among hits, prefer closest-to-camera; near ties prefer atomistic reps.
 *
 * Residue / chain expansion after the pick is handled by the caller (edit mode).
 *
 * @param {Array<{
 *   visible?: boolean,
 *   opacity?: number,
 *   representation?: { type?: string } | string,
 *   atoms?: Array<{ x:number, y:number, z:number, element?:string, name?:string }>
 * }>} views
 * @param {import('three').Camera} camera
 * @param {number} w
 * @param {number} h
 * @param {number} cx - canvas-local x of pointer
 * @param {number} cy - canvas-local y of pointer
 * @param {number} [minThreshold=20] - baseline pixel pick radius
 * @returns {object | null}
 */
export function pickAtomFromViews(views, camera, w, h, cx, cy, minThreshold = 20) {
  let best = null
  let bestDepth = Infinity
  let bestPriority = Infinity

  // Pixels per world-unit for the orthographic camera.
  const worldW = (camera.right ?? 1) - (camera.left ?? -1)
  const pxPerUnit = worldW > 0 ? w / worldW : 1

  const _v = new Vector3()
  /** Depth epsilon for “same plane” vs representation priority (NDC z). */
  const DEPTH_EPS = 0.002

  for (const view of views) {
    if (!isViewPickable(view)) continue
    const repr = viewRepresentationType(view)
    const priority = representationPickPriority(repr)

    for (const atom of view.atoms) {
      if (!isAtomPickableInView(view, atom)) continue

      _v.set(atom.x, atom.y, atom.z).project(camera)
      // Skip atoms behind the camera
      if (_v.z > 1) continue
      const sx = (_v.x * 0.5 + 0.5) * w
      const sy = (1 - (_v.y * 0.5 + 0.5)) * h
      const d2 = (sx - cx) ** 2 + (sy - cy) ** 2

      const pickR = pickRadiusPx(repr, atom, pxPerUnit, minThreshold)
      if (d2 > pickR * pickR) continue

      const closer = best == null || _v.z < bestDepth - DEPTH_EPS
      const sameDepthBetter =
        best != null &&
        Math.abs(_v.z - bestDepth) <= DEPTH_EPS &&
        priority < bestPriority
      if (!closer && !sameDepthBetter) continue

      bestDepth = _v.z
      bestPriority = priority
      best = atom
    }
  }

  return best
}
