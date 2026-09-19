/**
 * Stylized organic molecular surface: Gaussian metaball field + marching cubes.
 * Continuous skin (not discrete spheres). Inflate controls puffiness vs tight vdW.
 */

/** Approximate van der Waals radii (Å) — same set as VdwSpheres. */
export const VDW = {
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

/** Soft cap on grid samples (nx*ny*nz) to keep protein surfaces interactive. */
export const MAX_GRID_SAMPLES = 900_000

/** Grid step (Å) per quality 1–5. */
export const SURFACE_STEP_BY_QUALITY = {
  1: 1.05,
  2: 0.78,
  3: 0.58,
  4: 0.42,
  5: 0.34
}

/**
 * @param {string} el
 * @returns {number}
 */
export function vdwRadius(el) {
  const k = String(el || 'C')
    .trim()
    .toUpperCase()
    .slice(0, 2)
  if (VDW[k] !== undefined) return VDW[k]
  if (k.length >= 1 && VDW[k[0]] !== undefined) return VDW[k[0]]
  return DEFAULT_VDW
}

/**
 * Map inflate [0,1] → radius scale and field shape.
 * 0 = vdW-sized union skin; 1 = softer summed organic envelope.
 * `blend` 0→1 morphs field from max (sphere union ≈ CPK) to sum (metaballs).
 * `isoRadiusFactor` is single-atom surface radius / rEff — used for grid padding
 * so a lowered isolevel cannot clip the mesh and punch holes.
 * @param {number} inflate
 * @returns {{
 *   radiusScale: number,
 *   isolevel: number,
 *   sigmaFactor: number,
 *   isoRadiusFactor: number,
 *   blend: number
 * }}
 */
export function inflateParams(inflate) {
  const t = Math.max(0, Math.min(1, Number(inflate) || 0))
  // Exact vdW at 0; modest puff at 1 (avoid extreme scales that tear the grid).
  const radiusScale = 1.0 + t * 0.5
  const sigmaFactor = 0.45 + t * 0.2
  // Keep isolevel ≤ tight so sum-field bridges do not open into holes.
  const tightIso = Math.exp(-1 / (2 * 0.45 * 0.45))
  const isolevel = tightIso * (1 - 0.45 * t)
  const isoRadiusFactor =
    sigmaFactor * Math.sqrt(-2 * Math.log(Math.max(isolevel, 1e-12)))
  // Ease: stay near vdW through the lower half of the slider.
  const blend = t * t
  return { radiusScale, isolevel, sigmaFactor, isoRadiusFactor, blend }
}

/** Max Smooth level for organic surface (finer voxels + mesh rounding). */
export const SURFACE_SMOOTH_MAX = 8

/** One midpoint subdivision is applied at and above this Smooth level. */
export const SURFACE_SMOOTH_SUBDIV_LEVEL = 5.5

/** Skip that split on already-dense meshes so protein Smooth stays interactive. */
export const SURFACE_SMOOTH_SUBDIV_MAX_TRIS = 40_000

/**
 * @param {number} quality
 * @param {number} atomCount
 * @param {{ minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number }} bounds
 * @param {number} [smoothLevel] 0–SURFACE_SMOOTH_MAX — modestly finer voxel step
 * @returns {number} step Å
 */
export function resolveGridStep(quality, atomCount, bounds, smoothLevel = 0) {
  const q = Math.max(1, Math.min(5, Math.round(Number(quality) || 3)))
  let step = SURFACE_STEP_BY_QUALITY[q] ?? SURFACE_STEP_BY_QUALITY[3]
  // Proteins: coarsen aggressively — field cost scales with voxels × neighbors.
  if (atomCount > 6000) step = Math.max(step, 0.95)
  else if (atomCount > 3500) step = Math.max(step, 0.78)
  else if (atomCount > 1800) step = Math.max(step, 0.62)
  else if (atomCount > 900) step = Math.max(step, 0.5)

  // Smooth after protein floors so it still refines large selections (clamped by sample cap).
  const smooth = Math.max(0, Math.min(SURFACE_SMOOTH_MAX, Number(smoothLevel) || 0))
  // Modest field refine only — visual smoothness comes from welded verts,
  // field normals, and mesh rounding. Extreme voxel density is too expensive.
  if (smooth > 0) step /= 1 + 0.22 * smooth

  const sx = Math.max(1e-3, bounds.maxX - bounds.minX)
  const sy = Math.max(1e-3, bounds.maxY - bounds.minY)
  const sz = Math.max(1e-3, bounds.maxZ - bounds.minZ)
  for (let guard = 0; guard < 16; guard++) {
    const nx = Math.floor(sx / step) + 1
    const ny = Math.floor(sy / step) + 1
    const nz = Math.floor(sz / step) + 1
    if (nx * ny * nz <= MAX_GRID_SAMPLES) return step
    step *= 1.22
  }
  return step
}

/**
 * Stylized surfaces usually skip hydrogens (halves protein atom count).
 * @param {SurfaceAtom[]} atoms
 * @param {{ includeHydrogen?: boolean }} [opts]
 * @returns {SurfaceAtom[]}
 */
export function filterSurfaceAtoms(atoms, opts = {}) {
  if (!atoms?.length) return []
  if (opts.includeHydrogen === true) return atoms
  return atoms.filter((a) => {
    const el = String(a.element || '').trim().toUpperCase()
    return el !== 'H' && el !== 'D' && el !== 'T'
  })
}

// ── Marching cubes tables (standard) ───────────────────────────────────────

const EDGE_TABLE = new Int32Array([
  0x0, 0x109, 0x203, 0x30a, 0x406, 0x50f, 0x605, 0x70c, 0x80c, 0x905, 0xa0f, 0xb06, 0xc0a, 0xd03, 0xe09,
  0xf00, 0x190, 0x99, 0x393, 0x29a, 0x596, 0x49f, 0x795, 0x69c, 0x99c, 0x895, 0xb9f, 0xa96, 0xd9a,
  0xc93, 0xf99, 0xe90, 0x230, 0x339, 0x33, 0x13a, 0x636, 0x73f, 0x435, 0x53c, 0xa3c, 0xb35, 0x83f,
  0x936, 0xe3a, 0xf33, 0xc39, 0xd30, 0x3a0, 0x2a9, 0x1a3, 0xaa, 0x7a6, 0x6af, 0x5a5, 0x4ac, 0xbac,
  0xaa5, 0x9af, 0x8a6, 0xfaa, 0xea3, 0xda9, 0xca0, 0x460, 0x569, 0x663, 0x76a, 0x66, 0x16f, 0x265,
  0x36c, 0xc6c, 0xd65, 0xe6f, 0xf66, 0x86a, 0x963, 0xa69, 0xb60, 0x5f0, 0x4f9, 0x7f3, 0x6fa, 0x1f6,
  0xff, 0x3f5, 0x2fc, 0xdfc, 0xcf5, 0xfff, 0xef6, 0x9fa, 0x8f3, 0xbf9, 0xaf0, 0x650, 0x759, 0x453,
  0x55a, 0x256, 0x35f, 0x55, 0x15c, 0xe5c, 0xf55, 0xc5f, 0xd56, 0xa5a, 0xb53, 0x859, 0x950, 0x7c0,
  0x6c9, 0x5c3, 0x4ca, 0x3c6, 0x2cf, 0x1c5, 0xcc, 0xfcc, 0xec5, 0xdcf, 0xcc6, 0xbca, 0xac3, 0x9c9,
  0x8c0, 0x8c0, 0x9c9, 0xac3, 0xbca, 0xcc6, 0xdcf, 0xec5, 0xfcc, 0xcc, 0x1c5, 0x2cf, 0x3c6, 0x4ca,
  0x5c3, 0x6c9, 0x7c0, 0x950, 0x859, 0xb53, 0xa5a, 0xd56, 0xc5f, 0xf55, 0xe5c, 0x15c, 0x55, 0x35f,
  0x256, 0x55a, 0x453, 0x759, 0x650, 0xaf0, 0xbf9, 0x8f3, 0x9fa, 0xef6, 0xfff, 0xcf5, 0xdfc, 0x2fc,
  0x3f5, 0xff, 0x1f6, 0x6fa, 0x7f3, 0x4f9, 0x5f0, 0xb60, 0xa69, 0x963, 0x86a, 0xf66, 0xe6f, 0xd65,
  0xc6c, 0x36c, 0x265, 0x16f, 0x66, 0x76a, 0x663, 0x569, 0x460, 0xca0, 0xda9, 0xea3, 0xfaa, 0x8a6,
  0x9af, 0xaa5, 0xbac, 0x4ac, 0x5a5, 0x6af, 0x7a6, 0xaa, 0x1a3, 0x2a9, 0x3a0, 0xd30, 0xc39, 0xf33,
  0xe3a, 0x936, 0x83f, 0xb35, 0xa3c, 0x53c, 0x435, 0x73f, 0x636, 0x13a, 0x33, 0x339, 0x230, 0xe90,
  0xf99, 0xc93, 0xd9a, 0xa96, 0xb9f, 0x895, 0x99c, 0x69c, 0x795, 0x49f, 0x596, 0x29a, 0x393, 0x99,
  0x190, 0xf00, 0xe09, 0xd03, 0xc0a, 0xb06, 0xa0f, 0x905, 0x80c, 0x70c, 0x605, 0x50f, 0x406, 0x30a,
  0x203, 0x109, 0x0
])

/** @type {number[][]} */
const TRI_TABLE = [
  [],
  [0, 8, 3],
  [0, 1, 9],
  [1, 8, 3, 9, 8, 1],
  [1, 2, 10],
  [0, 8, 3, 1, 2, 10],
  [9, 2, 10, 0, 2, 9],
  [2, 8, 3, 2, 10, 8, 10, 9, 8],
  [3, 11, 2],
  [0, 11, 2, 8, 11, 0],
  [1, 9, 0, 2, 3, 11],
  [1, 11, 2, 1, 9, 11, 9, 8, 11],
  [3, 10, 1, 11, 10, 3],
  [0, 10, 1, 0, 8, 10, 8, 11, 10],
  [3, 9, 0, 3, 11, 9, 11, 10, 9],
  [9, 8, 10, 10, 8, 11],
  [4, 7, 8],
  [4, 3, 0, 7, 3, 4],
  [0, 1, 9, 8, 4, 7],
  [4, 1, 9, 4, 7, 1, 7, 3, 1],
  [1, 2, 10, 8, 4, 7],
  [3, 4, 7, 3, 0, 4, 1, 2, 10],
  [9, 2, 10, 9, 0, 2, 8, 4, 7],
  [2, 10, 9, 2, 9, 7, 2, 7, 3, 7, 9, 4],
  [8, 4, 7, 3, 11, 2],
  [11, 4, 7, 11, 2, 4, 2, 0, 4],
  [9, 0, 1, 8, 4, 7, 2, 3, 11],
  [4, 7, 11, 9, 4, 11, 9, 11, 2, 9, 2, 1],
  [3, 10, 1, 3, 11, 10, 7, 8, 4],
  [1, 11, 10, 1, 4, 11, 1, 0, 4, 7, 11, 4],
  [4, 7, 8, 9, 0, 11, 9, 11, 10, 11, 0, 3],
  [4, 7, 11, 4, 11, 9, 9, 11, 10],
  [9, 5, 4],
  [9, 5, 4, 0, 8, 3],
  [0, 5, 4, 1, 5, 0],
  [8, 5, 4, 8, 3, 5, 3, 1, 5],
  [1, 2, 10, 9, 5, 4],
  [3, 0, 8, 1, 2, 10, 4, 9, 5],
  [5, 2, 10, 5, 4, 2, 4, 0, 2],
  [2, 10, 5, 3, 2, 5, 3, 5, 4, 3, 4, 8],
  [9, 5, 4, 2, 3, 11],
  [0, 11, 2, 0, 8, 11, 4, 9, 5],
  [0, 5, 4, 0, 1, 5, 2, 3, 11],
  [2, 1, 5, 2, 5, 8, 2, 8, 11, 4, 8, 5],
  [10, 3, 11, 10, 1, 3, 9, 5, 4],
  [4, 9, 5, 0, 8, 1, 8, 10, 1, 8, 11, 10],
  [5, 4, 0, 5, 0, 11, 5, 11, 10, 11, 0, 3],
  [5, 4, 8, 5, 8, 10, 10, 8, 11],
  [9, 7, 8, 5, 7, 9],
  [9, 3, 0, 9, 5, 3, 5, 7, 3],
  [0, 7, 8, 0, 1, 7, 1, 5, 7],
  [1, 5, 3, 3, 5, 7],
  [9, 7, 8, 9, 5, 7, 10, 1, 2],
  [10, 1, 2, 9, 5, 0, 5, 3, 0, 5, 7, 3],
  [8, 0, 2, 8, 2, 5, 8, 5, 7, 10, 5, 2],
  [2, 10, 5, 2, 5, 3, 3, 5, 7],
  [7, 9, 5, 7, 8, 9, 3, 11, 2],
  [9, 5, 7, 9, 7, 2, 9, 2, 0, 2, 7, 11],
  [2, 3, 11, 0, 1, 8, 1, 7, 8, 1, 5, 7],
  [11, 2, 1, 11, 1, 7, 7, 1, 5],
  [9, 5, 8, 8, 5, 7, 10, 1, 3, 10, 3, 11],
  [5, 7, 0, 5, 0, 9, 7, 11, 0, 1, 0, 10, 11, 10, 0],
  [11, 10, 0, 11, 0, 3, 10, 5, 0, 8, 0, 7, 5, 7, 0],
  [11, 10, 5, 7, 11, 5],
  [10, 6, 5],
  [0, 8, 3, 5, 10, 6],
  [9, 0, 1, 5, 10, 6],
  [1, 8, 3, 1, 9, 8, 5, 10, 6],
  [1, 6, 5, 2, 6, 1],
  [1, 6, 5, 1, 2, 6, 3, 0, 8],
  [9, 6, 5, 9, 0, 6, 0, 2, 6],
  [5, 9, 8, 5, 8, 2, 5, 2, 6, 3, 2, 8],
  [2, 3, 11, 10, 6, 5],
  [11, 0, 8, 11, 2, 0, 10, 6, 5],
  [0, 1, 9, 2, 3, 11, 5, 10, 6],
  [5, 10, 6, 1, 9, 2, 9, 11, 2, 9, 8, 11],
  [6, 3, 11, 6, 5, 3, 5, 1, 3],
  [0, 8, 11, 0, 11, 5, 0, 5, 1, 5, 11, 6],
  [3, 11, 6, 0, 3, 6, 0, 6, 5, 0, 5, 9],
  [6, 5, 9, 6, 9, 11, 11, 9, 8],
  [5, 10, 6, 4, 7, 8],
  [4, 3, 0, 4, 7, 3, 6, 5, 10],
  [1, 9, 0, 5, 10, 6, 8, 4, 7],
  [10, 6, 5, 1, 9, 7, 1, 7, 3, 7, 9, 4],
  [6, 1, 2, 6, 5, 1, 4, 7, 8],
  [1, 2, 5, 5, 2, 6, 3, 0, 4, 3, 4, 7],
  [8, 4, 7, 9, 0, 5, 0, 6, 5, 0, 2, 6],
  [7, 3, 9, 7, 9, 4, 3, 2, 9, 5, 9, 6, 2, 6, 9],
  [3, 11, 2, 7, 8, 4, 10, 6, 5],
  [5, 10, 6, 4, 7, 2, 4, 2, 0, 2, 7, 11],
  [0, 1, 9, 4, 7, 8, 2, 3, 11, 5, 10, 6],
  [9, 2, 1, 9, 11, 2, 9, 4, 11, 7, 11, 4, 5, 10, 6],
  [8, 4, 7, 3, 11, 5, 3, 5, 1, 5, 11, 6],
  [5, 1, 11, 5, 11, 6, 1, 0, 11, 7, 11, 4, 0, 4, 11],
  [0, 5, 9, 0, 6, 5, 0, 3, 6, 11, 6, 3, 8, 4, 7],
  [6, 5, 9, 6, 9, 11, 4, 7, 9, 7, 11, 9],
  [10, 4, 9, 6, 4, 10],
  [4, 10, 6, 4, 9, 10, 0, 8, 3],
  [10, 0, 1, 10, 6, 0, 6, 4, 0],
  [8, 3, 1, 8, 1, 6, 8, 6, 4, 6, 1, 10],
  [1, 4, 9, 1, 2, 4, 2, 6, 4],
  [3, 0, 8, 1, 2, 9, 2, 4, 9, 2, 6, 4],
  [0, 2, 4, 4, 2, 6],
  [8, 3, 2, 8, 2, 4, 4, 2, 6],
  [10, 4, 9, 10, 6, 4, 11, 2, 3],
  [0, 8, 2, 2, 8, 11, 4, 9, 10, 4, 10, 6],
  [3, 11, 2, 0, 1, 6, 0, 6, 4, 6, 1, 10],
  [6, 4, 1, 6, 1, 10, 4, 8, 1, 2, 1, 11, 8, 11, 1],
  [9, 6, 4, 9, 3, 6, 9, 1, 3, 11, 6, 3],
  [8, 11, 1, 8, 1, 0, 11, 6, 1, 9, 1, 4, 6, 4, 1],
  [3, 11, 6, 3, 6, 0, 0, 6, 4],
  [6, 4, 8, 11, 6, 8],
  [7, 10, 6, 7, 8, 10, 8, 9, 10],
  [0, 7, 3, 0, 10, 7, 0, 9, 10, 6, 7, 10],
  [10, 6, 7, 1, 10, 7, 1, 7, 8, 1, 8, 0],
  [10, 6, 7, 10, 7, 1, 1, 7, 3],
  [1, 2, 6, 1, 6, 8, 1, 8, 9, 8, 6, 7],
  [2, 6, 9, 2, 9, 1, 6, 7, 9, 0, 9, 3, 7, 3, 9],
  [7, 8, 0, 7, 0, 6, 6, 0, 2],
  [7, 3, 2, 6, 7, 2],
  [2, 3, 11, 10, 6, 8, 10, 8, 9, 8, 6, 7],
  [2, 0, 7, 2, 7, 11, 0, 9, 7, 6, 7, 10, 9, 10, 7],
  [1, 8, 0, 1, 7, 8, 1, 10, 7, 6, 7, 10, 2, 3, 11],
  [11, 2, 1, 11, 1, 7, 10, 6, 1, 6, 7, 1],
  [8, 9, 6, 8, 6, 7, 9, 1, 6, 11, 6, 3, 1, 3, 6],
  [0, 9, 1, 11, 6, 7],
  [7, 8, 0, 7, 0, 6, 3, 11, 0, 11, 6, 0],
  [7, 11, 6],
  [7, 6, 11],
  [3, 0, 8, 11, 7, 6],
  [0, 1, 9, 11, 7, 6],
  [8, 1, 9, 8, 3, 1, 11, 7, 6],
  [10, 1, 2, 6, 11, 7],
  [1, 2, 10, 3, 0, 8, 6, 11, 7],
  [2, 9, 0, 2, 10, 9, 6, 11, 7],
  [6, 11, 7, 2, 10, 3, 10, 8, 3, 10, 9, 8],
  [7, 2, 3, 6, 2, 7],
  [7, 0, 8, 7, 6, 0, 6, 2, 0],
  [2, 7, 6, 2, 3, 7, 0, 1, 9],
  [1, 6, 2, 1, 8, 6, 1, 9, 8, 8, 7, 6],
  [10, 7, 6, 10, 1, 7, 1, 3, 7],
  [10, 7, 6, 1, 7, 10, 1, 8, 7, 1, 0, 8],
  [0, 3, 7, 0, 7, 10, 0, 10, 9, 6, 10, 7],
  [7, 6, 10, 7, 10, 8, 8, 10, 9],
  [6, 8, 4, 11, 8, 6],
  [3, 6, 11, 3, 0, 6, 0, 4, 6],
  [8, 6, 11, 8, 4, 6, 9, 0, 1],
  [9, 4, 6, 9, 6, 3, 9, 3, 1, 11, 3, 6],
  [6, 8, 4, 6, 11, 8, 2, 10, 1],
  [1, 2, 10, 3, 0, 11, 0, 6, 11, 0, 4, 6],
  [4, 11, 8, 4, 6, 11, 0, 2, 9, 2, 10, 9],
  [10, 9, 3, 10, 3, 2, 9, 4, 3, 11, 3, 6, 4, 6, 3],
  [8, 2, 3, 8, 4, 2, 4, 6, 2],
  [0, 4, 2, 4, 6, 2],
  [1, 9, 0, 2, 3, 4, 2, 4, 6, 4, 3, 8],
  [1, 9, 4, 1, 4, 2, 2, 4, 6],
  [8, 1, 3, 8, 6, 1, 8, 4, 6, 6, 10, 1],
  [10, 1, 0, 10, 0, 6, 6, 0, 4],
  [4, 6, 3, 4, 3, 8, 6, 10, 3, 0, 3, 9, 10, 9, 3],
  [10, 9, 4, 6, 10, 4],
  [4, 9, 5, 7, 6, 11],
  [0, 8, 3, 4, 9, 5, 11, 7, 6],
  [5, 0, 1, 5, 4, 0, 7, 6, 11],
  [11, 7, 6, 8, 3, 4, 3, 5, 4, 3, 1, 5],
  [9, 5, 4, 10, 1, 2, 7, 6, 11],
  [6, 11, 7, 1, 2, 10, 0, 8, 3, 4, 9, 5],
  [7, 6, 11, 5, 4, 10, 4, 2, 10, 4, 0, 2],
  [3, 4, 8, 3, 5, 4, 3, 2, 5, 10, 5, 2, 11, 7, 6],
  [7, 2, 3, 7, 6, 2, 5, 4, 9],
  [9, 5, 4, 0, 8, 6, 0, 6, 2, 6, 8, 7],
  [3, 6, 2, 3, 7, 6, 1, 5, 0, 5, 4, 0],
  [6, 2, 8, 6, 8, 7, 2, 1, 8, 4, 8, 5, 1, 5, 8],
  [9, 5, 4, 10, 1, 6, 1, 7, 6, 1, 3, 7],
  [1, 6, 10, 1, 7, 6, 1, 0, 7, 8, 7, 0, 9, 5, 4],
  [4, 0, 10, 4, 10, 5, 0, 3, 10, 6, 10, 7, 3, 7, 10],
  [7, 6, 10, 7, 10, 8, 5, 4, 10, 4, 8, 10],
  [6, 9, 5, 6, 11, 9, 11, 8, 9],
  [3, 6, 11, 0, 6, 3, 0, 5, 6, 0, 9, 5],
  [0, 11, 8, 0, 5, 11, 0, 1, 5, 5, 6, 11],
  [6, 11, 3, 6, 3, 5, 5, 3, 1],
  [1, 2, 10, 9, 5, 11, 9, 11, 8, 11, 5, 6],
  [0, 11, 3, 0, 6, 11, 0, 9, 6, 5, 6, 9, 1, 2, 10],
  [11, 8, 5, 11, 5, 6, 8, 0, 5, 10, 5, 2, 0, 2, 5],
  [6, 11, 3, 6, 3, 5, 2, 10, 3, 10, 5, 3],
  [5, 8, 9, 5, 2, 8, 5, 6, 2, 3, 8, 2],
  [9, 5, 6, 9, 6, 0, 0, 6, 2],
  [1, 5, 8, 1, 8, 0, 5, 6, 8, 3, 8, 2, 6, 2, 8],
  [1, 5, 6, 2, 1, 6],
  [1, 3, 6, 1, 6, 10, 3, 8, 6, 5, 6, 9, 8, 9, 6],
  [10, 1, 0, 10, 0, 6, 9, 5, 0, 5, 6, 0],
  [0, 3, 8, 5, 6, 10],
  [10, 5, 6],
  [11, 5, 10, 7, 5, 11],
  [11, 5, 10, 11, 7, 5, 8, 3, 0],
  [5, 11, 7, 5, 10, 11, 1, 9, 0],
  [10, 7, 5, 10, 11, 7, 9, 8, 1, 8, 3, 1],
  [11, 1, 2, 11, 7, 1, 7, 5, 1],
  [0, 8, 3, 1, 2, 7, 1, 7, 5, 7, 2, 11],
  [9, 7, 5, 9, 2, 7, 9, 0, 2, 2, 11, 7],
  [7, 5, 2, 7, 2, 11, 5, 9, 2, 3, 2, 8, 9, 8, 2],
  [2, 5, 10, 2, 3, 5, 3, 7, 5],
  [8, 2, 0, 8, 5, 2, 8, 7, 5, 10, 2, 5],
  [9, 0, 1, 5, 10, 3, 5, 3, 7, 3, 10, 2],
  [9, 8, 2, 9, 2, 1, 8, 7, 2, 10, 2, 5, 7, 5, 2],
  [1, 3, 5, 3, 7, 5],
  [0, 8, 7, 0, 7, 1, 1, 7, 5],
  [9, 0, 3, 9, 3, 5, 5, 3, 7],
  [9, 8, 7, 5, 9, 7],
  [5, 8, 4, 5, 10, 8, 10, 11, 8],
  [5, 0, 4, 5, 11, 0, 5, 10, 11, 11, 3, 0],
  [0, 1, 9, 8, 4, 10, 8, 10, 11, 10, 4, 5],
  [10, 11, 4, 10, 4, 5, 11, 3, 4, 9, 4, 1, 3, 1, 4],
  [2, 5, 1, 2, 8, 5, 2, 11, 8, 4, 5, 8],
  [0, 4, 11, 0, 11, 3, 4, 5, 11, 2, 11, 1, 5, 1, 11],
  [0, 2, 5, 0, 5, 9, 2, 11, 5, 4, 5, 8, 11, 8, 5],
  [9, 4, 5, 2, 11, 3],
  [2, 5, 10, 3, 5, 2, 3, 4, 5, 3, 8, 4],
  [5, 10, 2, 5, 2, 4, 4, 2, 0],
  [3, 10, 2, 3, 5, 10, 3, 8, 5, 4, 5, 8, 0, 1, 9],
  [5, 10, 2, 5, 2, 4, 1, 9, 2, 9, 4, 2],
  [8, 4, 5, 8, 5, 3, 3, 5, 1],
  [0, 4, 5, 1, 0, 5],
  [8, 4, 5, 8, 5, 3, 9, 0, 5, 0, 3, 5],
  [9, 4, 5],
  [4, 11, 7, 4, 9, 11, 9, 10, 11],
  [0, 8, 3, 4, 9, 7, 9, 11, 7, 9, 10, 11],
  [1, 10, 11, 1, 11, 4, 1, 4, 0, 7, 4, 11],
  [3, 1, 4, 3, 4, 8, 1, 10, 4, 7, 4, 11, 10, 11, 4],
  [4, 11, 7, 9, 11, 4, 9, 2, 11, 9, 1, 2],
  [9, 7, 4, 9, 11, 7, 9, 1, 11, 2, 11, 1, 0, 8, 3],
  [11, 7, 4, 11, 4, 2, 2, 4, 0],
  [11, 7, 4, 11, 4, 2, 8, 3, 4, 3, 2, 4],
  [2, 9, 10, 2, 7, 9, 2, 3, 7, 7, 4, 9],
  [9, 10, 7, 9, 7, 4, 10, 2, 7, 8, 7, 0, 2, 0, 7],
  [3, 7, 10, 3, 10, 2, 7, 4, 10, 1, 10, 0, 4, 0, 10],
  [1, 10, 2, 8, 7, 4],
  [4, 9, 1, 4, 1, 7, 7, 1, 3],
  [4, 9, 1, 4, 1, 7, 0, 8, 1, 8, 7, 1],
  [4, 0, 3, 7, 4, 3],
  [4, 8, 7],
  [9, 10, 8, 10, 11, 8],
  [3, 0, 9, 3, 9, 11, 11, 9, 10],
  [0, 1, 10, 0, 10, 8, 8, 10, 11],
  [3, 1, 10, 11, 3, 10],
  [1, 2, 11, 1, 11, 9, 9, 11, 8],
  [3, 0, 9, 3, 9, 11, 1, 2, 9, 2, 11, 9],
  [0, 2, 11, 8, 0, 11],
  [3, 2, 11],
  [2, 3, 8, 2, 8, 10, 10, 8, 9],
  [9, 10, 2, 0, 9, 2],
  [2, 3, 8, 2, 8, 10, 0, 1, 8, 1, 10, 8],
  [1, 10, 2],
  [1, 3, 8, 9, 1, 8],
  [0, 9, 1],
  [0, 3, 8],
  []
]

const CUBE_EDGES = [
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

/** [axis, ox, oy, oz] for welding a cube edge to its unique grid edge. */
const CUBE_EDGE_CACHE = [
  [0, 0, 0, 0],
  [1, 1, 0, 0],
  [0, 0, 1, 0],
  [1, 0, 0, 0],
  [0, 0, 0, 1],
  [1, 1, 0, 1],
  [0, 0, 1, 1],
  [1, 0, 0, 1],
  [2, 0, 0, 0],
  [2, 1, 0, 0],
  [2, 1, 1, 0],
  [2, 0, 1, 0]
]

/**
 * @typedef {{ x: number, y: number, z: number, element?: string, name?: string, index?: number, radius?: number, sec?: string }} SurfaceAtom
 * @typedef {{ r: number, g: number, b: number }} Rgb
 * @typedef {(atom: SurfaceAtom) => Rgb} ColorFn
 * @typedef {'atoms' | 'backbone'} SurfaceSource
 */

const HELIX_CODES = new Set(['H', 'h', 'G', 'g', 'I', 'i', 'F', 'f'])

/** Probe radii (Å) for SS backbone surfaces — helix/sheet thicker than coil. */
const SS_PROBE_RADIUS = {
  helix: 2.35,
  strand: 2.0,
  coil: 1.15
}

/**
 * @param {string} [sec]
 * @returns {'helix' | 'strand' | 'coil'}
 */
export function ssSurfaceCategory(sec) {
  if (!sec || !String(sec).trim()) return 'coil'
  if (HELIX_CODES.has(sec)) return 'helix'
  if (sec === 'E') return 'strand'
  return 'coil'
}

/**
 * @param {string} [sec]
 * @returns {number}
 */
export function ssProbeRadius(sec) {
  return SS_PROBE_RADIUS[ssSurfaceCategory(sec)]
}

/**
 * Base radius for a surface probe (explicit radius wins over element vdW).
 * @param {SurfaceAtom} a
 * @returns {number}
 */
export function surfaceAtomRadius(a) {
  if (typeof a.radius === 'number' && Number.isFinite(a.radius) && a.radius > 0) return a.radius
  return vdwRadius(a.element)
}

/**
 * Build probe atoms along the Cα backbone with SS-varying radii.
 * Densifies between consecutive Cα so the envelope follows the ribbon path.
 *
 * @param {SurfaceAtom[]} atoms
 * @param {Array<{ ca_index?: number, sec?: string, chain?: string, number?: number, insertion?: string, atom_indices?: number[] }>} residues
 * @param {{ pathSamples?: number }} [opts]
 * @returns {SurfaceAtom[]}
 */
export function buildBackboneSurfaceProbes(atoms, residues, opts = {}) {
  if (!atoms?.length || !residues?.length) return []
  /** @type {Map<number, SurfaceAtom>} */
  const byIndex = new Map()
  for (const a of atoms) {
    if (typeof a.index === 'number') byIndex.set(a.index, a)
  }

  const caRes = residues
    .filter((r) => typeof r.ca_index === 'number' && byIndex.has(r.ca_index))
    .sort(
      (a, b) =>
        String(a.chain || '').localeCompare(String(b.chain || '')) ||
        (a.number ?? 0) - (b.number ?? 0) ||
        String(a.insertion || '').localeCompare(String(b.insertion || ''))
    )

  /** @type {typeof caRes[]} */
  const segments = []
  let start = 0
  for (let i = 1; i <= caRes.length; i++) {
    let split = i === caRes.length
    if (!split) {
      const prev = caRes[i - 1]
      const curr = caRes[i]
      if (String(prev.chain || '') !== String(curr.chain || '')) {
        split = true
      } else {
        const pa = byIndex.get(prev.ca_index)
        const pb = byIndex.get(curr.ca_index)
        const d = Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z)
        if (d > 7.2 || d < 1.0) split = true
      }
    }
    if (split) {
      if (i - start >= 1) segments.push(caRes.slice(start, i))
      start = i
    }
  }

  const samplesPerSeg = Math.max(1, Math.min(8, Math.round(opts.pathSamples ?? 3)))
  /** @type {SurfaceAtom[]} */
  const probes = []
  let probeIndex = 0

  for (const seg of segments) {
    for (let i = 0; i < seg.length; i++) {
      const res = seg[i]
      const ca = byIndex.get(res.ca_index)
      const sec = res.sec || ''
      const radius = ssProbeRadius(sec)
      probes.push({
        x: ca.x,
        y: ca.y,
        z: ca.z,
        element: ca.element || 'C',
        name: 'CA',
        index: typeof ca.index === 'number' ? ca.index : probeIndex++,
        radius,
        sec
      })
      if (i >= seg.length - 1) continue
      const next = seg[i + 1]
      const cb = byIndex.get(next.ca_index)
      const secB = next.sec || sec
      const radiusB = ssProbeRadius(secB)
      for (let s = 1; s < samplesPerSeg; s++) {
        const t = s / samplesPerSeg
        const r = radius * (1 - t) + radiusB * t
        probes.push({
          x: ca.x + (cb.x - ca.x) * t,
          y: ca.y + (cb.y - ca.y) * t,
          z: ca.z + (cb.z - ca.z) * t,
          element: 'C',
          name: 'CA',
          index: typeof ca.index === 'number' ? ca.index : probeIndex++,
          radius: r,
          sec: t < 0.5 ? sec : secB
        })
      }
    }
  }
  return probes
}

/**
 * @param {Float32Array} positions
 * @param {Uint32Array} indices
 * @returns {Float32Array}
 */
function computeVertexNormals(positions, indices) {
  const normals = new Float32Array(positions.length)
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t] * 3
    const i1 = indices[t + 1] * 3
    const i2 = indices[t + 2] * 3
    const ax = positions[i0]
    const ay = positions[i0 + 1]
    const az = positions[i0 + 2]
    const bx = positions[i1]
    const by = positions[i1 + 1]
    const bz = positions[i1 + 2]
    const cx = positions[i2]
    const cy = positions[i2 + 1]
    const cz = positions[i2 + 2]
    const e1x = bx - ax
    const e1y = by - ay
    const e1z = bz - az
    const e2x = cx - ax
    const e2y = cy - ay
    const e2z = cz - az
    const nxn = e1y * e2z - e1z * e2y
    const nyn = e1z * e2x - e1x * e2z
    const nzn = e1x * e2y - e1y * e2x
    normals[i0] += nxn
    normals[i0 + 1] += nyn
    normals[i0 + 2] += nzn
    normals[i1] += nxn
    normals[i1 + 1] += nyn
    normals[i1 + 2] += nzn
    normals[i2] += nxn
    normals[i2 + 1] += nyn
    normals[i2 + 2] += nzn
  }
  for (let i = 0; i < normals.length; i += 3) {
    const x = normals[i]
    const y = normals[i + 1]
    const z = normals[i + 2]
    const len = Math.hypot(x, y, z) || 1
    normals[i] = x / len
    normals[i + 1] = y / len
    normals[i + 2] = z / len
  }
  return normals
}

/**
 * @param {number} [smoothLevel]
 * @param {number} [triCount]
 * @returns {{
 *   smooth: number,
 *   subdivPasses: number,
 *   taubinIters: number,
 *   lambda: number,
 *   mu: number,
 *   normalBlend: number
 * }}
 */
export function resolveSurfaceSmoothPlan(smoothLevel = 0, triCount) {
  const smooth = Math.max(0, Math.min(SURFACE_SMOOTH_MAX, Number(smoothLevel) || 0))
  const t = smooth / SURFACE_SMOOTH_MAX
  const known = triCount != null && Number.isFinite(Number(triCount))
  const tris = known ? Number(triCount) : 0
  const subdivPasses =
    smooth >= SURFACE_SMOOTH_SUBDIV_LEVEL &&
    (!known || (tris > 0 && tris <= SURFACE_SMOOTH_SUBDIV_MAX_TRIS))
      ? 1
      : 0
  const taubinIters =
    smooth <= 0 ? 0 : Math.max(1, Math.round(3 + smooth * 3.75) + subdivPasses * 2)
  const lambda = 0.34 + 0.22 * t
  const mu = -(lambda + 0.03)
  return { smooth, subdivPasses, taubinIters, lambda, mu, normalBlend: t }
}

/**
 * @param {ArrayLike<number>} indices
 * @param {number} vertexCount
 * @returns {number[][]}
 */
function uniqueMeshNeighbors(indices, vertexCount) {
  /** @type {number[][]} */
  const nbrs = new Array(vertexCount)
  for (let i = 0; i < vertexCount; i++) nbrs[i] = []
  /** @type {Set<string>} */
  const seen = new Set()
  const addE = (a, b) => {
    if (a === b) return
    const lo = a < b ? a : b
    const hi = a < b ? b : a
    const key = `${lo},${hi}`
    if (seen.has(key)) return
    seen.add(key)
    nbrs[a].push(b)
    nbrs[b].push(a)
  }
  for (let t = 0; t < indices.length; t += 3) {
    addE(indices[t], indices[t + 1])
    addE(indices[t + 1], indices[t + 2])
    addE(indices[t + 2], indices[t])
  }
  return nbrs
}

/**
 * Volume-preserving Taubin smooth. Vertices that sit on the voxel-grid
 * wall stay put so a clipped sheet does not tear open.
 * @param {Float32Array} positions
 * @param {Uint32Array | number[]} indices
 * @param {number} iterations
 * @param {number} [lambda]
 * @param {number} [mu]
 * @returns {Float32Array}
 */
export function taubinSmoothPositions(
  positions,
  indices,
  iterations,
  lambda = 0.4,
  mu = -0.43,
  clipBounds = null,
  clipMargin = 0
) {
  const iters = Math.max(0, Math.round(Number(iterations) || 0))
  if (iters <= 0 || !positions?.length || !indices?.length) return positions
  const vertexCount = (positions.length / 3) | 0
  const nbrs = uniqueMeshNeighbors(indices, vertexCount)
  const locked = new Uint8Array(vertexCount)
  if (clipBounds && clipMargin > 0) {
    const m = clipMargin
    for (let v = 0; v < vertexCount; v++) {
      const i = v * 3
      const x = positions[i]
      const y = positions[i + 1]
      const z = positions[i + 2]
      if (
        x <= clipBounds.minX + m ||
        x >= clipBounds.maxX - m ||
        y <= clipBounds.minY + m ||
        y >= clipBounds.maxY - m ||
        z <= clipBounds.minZ + m ||
        z >= clipBounds.maxZ - m
      ) {
        locked[v] = 1
      }
    }
  }
  let src = new Float32Array(positions)
  let dst = new Float32Array(positions.length)
  for (let it = 0; it < iters; it++) {
    const w = it % 2 === 0 ? lambda : mu
    for (let v = 0; v < vertexCount; v++) {
      const i = v * 3
      const ring = nbrs[v]
      const deg = ring.length
      if (locked[v] || deg === 0) {
        dst[i] = src[i]
        dst[i + 1] = src[i + 1]
        dst[i + 2] = src[i + 2]
        continue
      }
      let ax = 0
      let ay = 0
      let az = 0
      for (let k = 0; k < deg; k++) {
        const j = ring[k] * 3
        ax += src[j]
        ay += src[j + 1]
        az += src[j + 2]
      }
      const inv = 1 / deg
      dst[i] = src[i] + w * (ax * inv - src[i])
      dst[i + 1] = src[i + 1] + w * (ay * inv - src[i + 1])
      dst[i + 2] = src[i + 2] + w * (az * inv - src[i + 2])
    }
    const tmp = src
    src = dst
    dst = tmp
  }
  return src
}

/**
 * 1–4 midpoint split with welded edge vertices.
 * @param {Float32Array} positions
 * @param {Float32Array} colors
 * @param {Uint32Array | number[]} indices
 * @returns {{ positions: Float32Array, colors: Float32Array, indices: Uint32Array }}
 */
export function subdivideSurfaceMesh(positions, colors, indices) {
  const pos = Array.from(positions)
  const hasColors = colors?.length === positions.length
  const col = hasColors ? Array.from(colors) : []
  /** @type {number[]} */
  const newIdx = []
  /** @type {Map<string, number>} */
  const cache = new Map()
  const mid = (a, b) => {
    const lo = a < b ? a : b
    const hi = a < b ? b : a
    const key = `${lo},${hi}`
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    const ia = a * 3
    const ib = b * 3
    const vi = (pos.length / 3) | 0
    pos.push(
      (positions[ia] + positions[ib]) * 0.5,
      (positions[ia + 1] + positions[ib + 1]) * 0.5,
      (positions[ia + 2] + positions[ib + 2]) * 0.5
    )
    if (hasColors) {
      col.push(
        (colors[ia] + colors[ib]) * 0.5,
        (colors[ia + 1] + colors[ib + 1]) * 0.5,
        (colors[ia + 2] + colors[ib + 2]) * 0.5
      )
    }
    cache.set(key, vi)
    return vi
  }
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]
    const b = indices[t + 1]
    const c = indices[t + 2]
    const ab = mid(a, b)
    const bc = mid(b, c)
    const ca = mid(c, a)
    newIdx.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca)
  }
  return {
    positions: new Float32Array(pos),
    colors: hasColors ? new Float32Array(col) : new Float32Array(0),
    indices: new Uint32Array(newIdx)
  }
}

/**
 * Slider-scaled mesh rounding. Default (0) is a no-op so field cost stays put.
 * @param {Float32Array} positions
 * @param {Float32Array} colors
 * @param {Uint32Array | number[]} indices
 * @param {number} [smoothLevel]
 * @returns {{ positions: Float32Array, colors: Float32Array, indices: Uint32Array }}
 */
export function applySurfaceMeshSmoothing(positions, colors, indices, smoothLevel = 0, clip) {
  const plan = resolveSurfaceSmoothPlan(smoothLevel, (indices.length / 3) | 0)
  let pos = positions
  let col = colors
  let idx = indices instanceof Uint32Array ? indices : new Uint32Array(indices)
  for (let p = 0; p < plan.subdivPasses; p++) {
    const next = subdivideSurfaceMesh(pos, col, idx)
    pos = next.positions
    col = next.colors
    idx = next.indices
  }
  if (plan.taubinIters > 0) {
    pos = taubinSmoothPositions(
      pos,
      idx,
      plan.taubinIters,
      plan.lambda,
      plan.mu,
      clip?.bounds ?? null,
      clip?.margin ?? 0
    )
  }
  return { positions: pos, colors: col, indices: idx }
}

/**
 * Flip inward face-averaged normals to the exterior.
 * @param {Float32Array} face
 * @returns {Float32Array}
 */
function flipNormalsInPlace(face) {
  for (let i = 0; i < face.length; i++) face[i] = -face[i]
  return face
}

/**
 * @param {number} ax
 * @param {number} ay
 * @param {number} az
 * @param {number} bx
 * @param {number} by
 * @param {number} bz
 * @param {number} t
 * @returns {[number, number, number]}
 */
function slerpUnit(ax, ay, az, bx, by, bz, t) {
  let dot = ax * bx + ay * by + az * bz
  if (dot < 0) {
    bx = -bx
    by = -by
    bz = -bz
    dot = -dot
  }
  if (dot > 0.9995) {
    const x = ax + t * (bx - ax)
    const y = ay + t * (by - ay)
    const z = az + t * (bz - az)
    const len = Math.hypot(x, y, z) || 1
    return [x / len, y / len, z / len]
  }
  const theta = Math.acos(Math.min(1, dot))
  const sinT = Math.sin(theta) || 1
  const w0 = Math.sin((1 - t) * theta) / sinT
  const w1 = Math.sin(t * theta) / sinT
  const x = w0 * ax + w1 * bx
  const y = w0 * ay + w1 * by
  const z = w0 * az + w1 * bz
  const len = Math.hypot(x, y, z) || 1
  return [x / len, y / len, z / len]
}

/**
 * Smooth-slider lighting: 0 = welded face normals, 1 = analytic field normals.
 * @param {Float32Array} positions
 * @param {Uint32Array | number[]} indices
 * @param {{ x: number, y: number, z: number, invTwoSig2: number, cutoff2: number }[]} centers
 * @param {Map<number, number[]>} grid
 * @param {(cx: number, cy: number, cz: number) => number} hashKey
 * @param {number} invCell
 * @param {number} neighborRange
 * @param {number} inflateBlend
 * @param {number} normalBlend 0–1 from the Smooth slider
 * @returns {Float32Array}
 */
function computeSmoothSurfaceNormals(
  positions,
  indices,
  centers,
  grid,
  hashKey,
  invCell,
  neighborRange,
  inflateBlend,
  normalBlend
) {
  const face = flipNormalsInPlace(computeVertexNormals(positions, indices))
  const t = Math.max(0, Math.min(1, Number(normalBlend) || 0))
  if (t <= 1e-6 || !centers?.length) return face

  const b = Math.max(0, Math.min(1, inflateBlend))
  const nV = (positions.length / 3) | 0
  const out = t >= 0.999 ? new Float32Array(positions.length) : face
  for (let v = 0; v < nV; v++) {
    const i = v * 3
    const x = positions[i]
    const y = positions[i + 1]
    const z = positions[i + 2]
    const cx0 = Math.floor(x * invCell)
    const cy0 = Math.floor(y * invCell)
    const cz0 = Math.floor(z * invCell)
    let sumGx = 0
    let sumGy = 0
    let sumGz = 0
    let maxC = 0
    let maxGx = 0
    let maxGy = 0
    let maxGz = 0
    for (let dz = -neighborRange; dz <= neighborRange; dz++) {
      for (let dy = -neighborRange; dy <= neighborRange; dy++) {
        for (let dx = -neighborRange; dx <= neighborRange; dx++) {
          const bucket = grid.get(hashKey(cx0 + dx, cy0 + dy, cz0 + dz))
          if (!bucket) continue
          for (let bi = 0; bi < bucket.length; bi++) {
            const c = centers[bucket[bi]]
            const ddx = x - c.x
            const ddy = y - c.y
            const ddz = z - c.z
            const d2 = ddx * ddx + ddy * ddy + ddz * ddz
            if (d2 > c.cutoff2) continue
            const contrib = Math.exp(-d2 * c.invTwoSig2)
            const s = -2 * c.invTwoSig2 * contrib
            const gx = s * ddx
            const gy = s * ddy
            const gz = s * ddz
            sumGx += gx
            sumGy += gy
            sumGz += gz
            if (contrib > maxC) {
              maxC = contrib
              maxGx = gx
              maxGy = gy
              maxGz = gz
            }
          }
        }
      }
    }
    let gx
    let gy
    let gz
    if (b <= 1e-6) {
      gx = maxGx
      gy = maxGy
      gz = maxGz
    } else if (b >= 0.999) {
      gx = sumGx
      gy = sumGy
      gz = sumGz
    } else {
      gx = (1 - b) * maxGx + b * sumGx
      gy = (1 - b) * maxGy + b * sumGy
      gz = (1 - b) * maxGz + b * sumGz
    }
    const fl = Math.hypot(gx, gy, gz)
    let fx
    let fy
    let fz
    if (fl < 1e-8) {
      fx = face[i]
      fy = face[i + 1]
      fz = face[i + 2]
    } else {
      // Density increases toward atoms, so −∇field points to the exterior.
      fx = -gx / fl
      fy = -gy / fl
      fz = -gz / fl
    }
    if (t >= 0.999) {
      out[i] = fx
      out[i + 1] = fy
      out[i + 2] = fz
    } else {
      const mixed = slerpUnit(face[i], face[i + 1], face[i + 2], fx, fy, fz, t)
      out[i] = mixed[0]
      out[i + 1] = mixed[1]
      out[i + 2] = mixed[2]
    }
  }
  return out
}

/**
 * @param {SurfaceAtom[]} atoms
 * @param {number} radiusScale
 * @param {number} isoRadiusFactor single-atom isosurface radius / rEff
 * @param {number} margin extra Å beyond the predicted skin
 */
function computeBounds(atoms, radiusScale, isoRadiusFactor, margin) {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  const extentFactor = Math.max(1, isoRadiusFactor)
  for (const a of atoms) {
    const r = surfaceAtomRadius(a) * radiusScale * extentFactor + margin
    minX = Math.min(minX, a.x - r)
    minY = Math.min(minY, a.y - r)
    minZ = Math.min(minZ, a.z - r)
    maxX = Math.max(maxX, a.x + r)
    maxY = Math.max(maxY, a.y + r)
    maxZ = Math.max(maxZ, a.z + r)
  }
  return { minX, minY, minZ, maxX, maxY, maxZ }
}

/**
 * Axis-aligned bbox extent (max side length) of a mesh position buffer.
 * @param {Float32Array} positions
 * @returns {number}
 */
export function meshBboxExtent(positions) {
  if (!positions?.length) return 0
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]
    const y = positions[i + 1]
    const z = positions[i + 2]
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    maxZ = Math.max(maxZ, z)
  }
  return Math.max(maxX - minX, maxY - minY, maxZ - minZ)
}

/**
 * Build organic surface mesh buffers.
 * @param {{
 *   atoms: SurfaceAtom[],
 *   residues?: Array<{ ca_index?: number, sec?: string, chain?: string, number?: number, insertion?: string, atom_indices?: number[] }>,
 *   getColor?: ColorFn,
 *   quality?: number,
 *   surfaceInflate?: number,
 *   surfaceSource?: SurfaceSource,
 *   surfaceSubdivision?: number,
 *   includeHydrogen?: boolean
 * }} opts
 * @returns {{
 *   positions: Float32Array,
 *   normals: Float32Array,
 *   colors: Float32Array,
 *   indices: Uint32Array,
 *   step: number,
 *   isolevel: number,
 *   atomCount: number
 * } | null}
 */
export function buildOrganicSurface(opts) {
  const rawAtoms = opts.atoms
  if (!rawAtoms?.length) return null

  const source = opts.surfaceSource === 'backbone' ? 'backbone' : 'atoms'
  let atoms
  if (source === 'backbone') {
    const q = Math.max(1, Math.min(5, Math.round(Number(opts.quality) || 3)))
    const pathSamples = 1 + q
    atoms = buildBackboneSurfaceProbes(rawAtoms, opts.residues || [], { pathSamples })
    // No CA / no protein: fall back to atomic vdW surface.
    if (!atoms.length) {
      atoms = filterSurfaceAtoms(rawAtoms, { includeHydrogen: opts.includeHydrogen === true })
    }
  } else {
    atoms = filterSurfaceAtoms(rawAtoms, { includeHydrogen: opts.includeHydrogen === true })
  }
  if (!atoms.length) return null

  const { radiusScale, isolevel, sigmaFactor, isoRadiusFactor, blend } = inflateParams(
    opts.surfaceInflate ?? 0.25
  )
  // Pad to the real isosurface radius (not just rEff) — short pads clipped the
  // skin when isolevel softened and left holes at high Inflate.
  const bounds = computeBounds(atoms, radiusScale, isoRadiusFactor, 0.85)
  const smoothLevel = Math.max(
    0,
    Math.min(SURFACE_SMOOTH_MAX, Number(opts.surfaceSubdivision) || 0)
  )
  const step = resolveGridStep(opts.quality ?? 3, atoms.length, bounds, smoothLevel)

  const nx = Math.max(2, Math.floor((bounds.maxX - bounds.minX) / step) + 1)
  const ny = Math.max(2, Math.floor((bounds.maxY - bounds.minY) / step) + 1)
  const nz = Math.max(2, Math.floor((bounds.maxZ - bounds.minZ) / step) + 1)

  const getColor =
    opts.getColor ||
    (() => ({
      r: 0.75,
      g: 0.75,
      b: 0.8
    }))

  /** @type {{ x: number, y: number, z: number, rEff: number, invTwoSig2: number, cutoff2: number, cr: number, cg: number, cb: number }[]} */
  const centers = new Array(atoms.length)
  let maxCutoff = 0
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i]
    const rEff = surfaceAtomRadius(a) * radiusScale
    const sigma = Math.max(1e-4, rEff * sigmaFactor)
    // Cutoff must reach the isosurface (+ neighbor bleed for sum-field bridges).
    const cutoff = rEff * Math.max(sigmaFactor * 3.2, isoRadiusFactor * 1.2 + 0.35)
    maxCutoff = Math.max(maxCutoff, cutoff)
    const col = getColor(a)
    centers[i] = {
      x: a.x,
      y: a.y,
      z: a.z,
      rEff,
      invTwoSig2: 1 / (2 * sigma * sigma),
      cutoff2: cutoff * cutoff,
      cr: col.r,
      cg: col.g,
      cb: col.b
    }
  }

  // Spatial hash so each voxel only touches nearby atoms (critical for proteins).
  const cellSize = Math.max(step, maxCutoff * 0.85)
  const invCell = 1 / cellSize
  /** @type {Map<number, number[]>} */
  const grid = new Map()
  const hashKey = (cx, cy, cz) => ((cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791)) | 0

  for (let i = 0; i < centers.length; i++) {
    const c = centers[i]
    const cx = Math.floor(c.x * invCell)
    const cy = Math.floor(c.y * invCell)
    const cz = Math.floor(c.z * invCell)
    const k = hashKey(cx, cy, cz)
    let bucket = grid.get(k)
    if (!bucket) {
      bucket = []
      grid.set(k, bucket)
    }
    bucket.push(i)
  }

  const field = new Float32Array(nx * ny * nz)
  const nearest = new Int32Array(nx * ny * nz)
  nearest.fill(-1)

  const neighborRange = Math.max(1, Math.ceil(maxCutoff / cellSize))

  for (let iz = 0; iz < nz; iz++) {
    const z = bounds.minZ + iz * step
    const cz0 = Math.floor(z * invCell)
    for (let iy = 0; iy < ny; iy++) {
      const y = bounds.minY + iy * step
      const cy0 = Math.floor(y * invCell)
      for (let ix = 0; ix < nx; ix++) {
        const x = bounds.minX + ix * step
        const cx0 = Math.floor(x * invCell)
        const gi = ix + iy * nx + iz * nx * ny
        let sum = 0
        let maxC = 0
        let bestD2 = Infinity
        let best = -1
        for (let dz = -neighborRange; dz <= neighborRange; dz++) {
          for (let dy = -neighborRange; dy <= neighborRange; dy++) {
            for (let dx = -neighborRange; dx <= neighborRange; dx++) {
              const bucket = grid.get(hashKey(cx0 + dx, cy0 + dy, cz0 + dz))
              if (!bucket) continue
              for (let bi = 0; bi < bucket.length; bi++) {
                const ai = bucket[bi]
                const c = centers[ai]
                const ddx = x - c.x
                const ddy = y - c.y
                const ddz = z - c.z
                const d2 = ddx * ddx + ddy * ddy + ddz * ddz
                if (d2 < bestD2) {
                  bestD2 = d2
                  best = ai
                }
                if (d2 > c.cutoff2) continue
                const contrib = Math.exp(-d2 * c.invTwoSig2)
                sum += contrib
                if (contrib > maxC) maxC = contrib
              }
            }
          }
        }
        // blend 0 = vdW union (max); 1 = organic metaballs (sum)
        field[gi] =
          blend <= 1e-6 ? maxC : blend >= 0.999 ? sum : (1 - blend) * maxC + blend * sum
        nearest[gi] = best
      }
    }
  }

  /** @type {number[]} */
  const posList = []
  /** @type {number[]} */
  const colList = []
  /** @type {number[]} */
  const idxList = []

  /**
   * @param {number} ix
   * @param {number} iy
   * @param {number} iz
   */
  function gIndex(ix, iy, iz) {
    return ix + iy * nx + iz * nx * ny
  }

  /**
   * @param {number} x0
   * @param {number} y0
   * @param {number} z0
   * @param {number} x1
   * @param {number} y1
   * @param {number} z1
   * @param {number} v0
   * @param {number} v1
   * @param {number} n0
   * @param {number} n1
   */
  function lerpVertex(x0, y0, z0, x1, y1, z1, v0, v1, n0, n1) {
    const denom = v1 - v0
    const t = Math.abs(denom) < 1e-12 ? 0.5 : (isolevel - v0) / denom
    const vi = posList.length / 3
    posList.push(x0 + t * (x1 - x0), y0 + t * (y1 - y0), z0 + t * (z1 - z0))
    const ai = t < 0.5 ? n0 : n1
    if (ai >= 0) {
      const c = centers[ai]
      colList.push(c.cr, c.cg, c.cb)
    } else {
      colList.push(0.75, 0.75, 0.8)
    }
    return vi
  }

  const cornerOff = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1]
  ]

  const vals = new Float64Array(8)
  const nears = new Int32Array(8)
  const cxs = new Float64Array(8)
  const cys = new Float64Array(8)
  const czs = new Float64Array(8)
  /** @type {(number|undefined)[]} */
  const vertIds = new Array(12)
  /** @type {Map<number, number>} */
  const edgeVerts = new Map()
  const nx1 = nx + 1
  const ny1 = ny + 1

  /**
   * @param {number} e
   * @param {number} ix
   * @param {number} iy
   * @param {number} iz
   * @returns {number}
   */
  function cachedEdgeVertex(e, ix, iy, iz) {
    const spec = CUBE_EDGE_CACHE[e]
    const key = spec[0] + 3 * (ix + spec[1] + nx1 * (iy + spec[2] + ny1 * (iz + spec[3])))
    const hit = edgeVerts.get(key)
    if (hit !== undefined) return hit
    const [a, b] = CUBE_EDGES[e]
    const vi = lerpVertex(
      cxs[a],
      cys[a],
      czs[a],
      cxs[b],
      cys[b],
      czs[b],
      vals[a],
      vals[b],
      nears[a],
      nears[b]
    )
    edgeVerts.set(key, vi)
    return vi
  }

  for (let iz = 0; iz < nz - 1; iz++) {
    for (let iy = 0; iy < ny - 1; iy++) {
      for (let ix = 0; ix < nx - 1; ix++) {
        let cubeIndex = 0
        for (let c = 0; c < 8; c++) {
          const ox = cornerOff[c][0]
          const oy = cornerOff[c][1]
          const oz = cornerOff[c][2]
          const gi = gIndex(ix + ox, iy + oy, iz + oz)
          vals[c] = field[gi]
          nears[c] = nearest[gi]
          cxs[c] = bounds.minX + (ix + ox) * step
          cys[c] = bounds.minY + (iy + oy) * step
          czs[c] = bounds.minZ + (iz + oz) * step
          if (vals[c] < isolevel) cubeIndex |= 1 << c
        }
        const edges = EDGE_TABLE[cubeIndex]
        if (edges === 0) continue

        for (let e = 0; e < 12; e++) vertIds[e] = undefined
        for (let e = 0; e < 12; e++) {
          if (!(edges & (1 << e))) continue
          vertIds[e] = cachedEdgeVertex(e, ix, iy, iz)
        }

        const tri = TRI_TABLE[cubeIndex]
        for (let t = 0; t + 2 < tri.length; t += 3) {
          const ia = vertIds[tri[t]]
          const ib = vertIds[tri[t + 1]]
          const ic = vertIds[tri[t + 2]]
          if (ia == null || ib == null || ic == null) continue
          idxList.push(ia, ic, ib)
        }
      }
    }
  }

  if (!idxList.length) {
    return {
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      colors: new Float32Array(0),
      indices: new Uint32Array(0),
      step,
      isolevel,
      atomCount: atoms.length
    }
  }

  const rawPositions = new Float32Array(posList)
  const rawColors = new Float32Array(colList)
  const rawIndices = new Uint32Array(idxList)
  const smoothPlan = resolveSurfaceSmoothPlan(smoothLevel, (rawIndices.length / 3) | 0)
  const smoothed = applySurfaceMeshSmoothing(rawPositions, rawColors, rawIndices, smoothLevel, {
    bounds,
    margin: step * 0.75
  })
  const positions = smoothed.positions
  const colors = smoothed.colors
  const indices = smoothed.indices
  const normals = computeSmoothSurfaceNormals(
    positions,
    indices,
    centers,
    grid,
    hashKey,
    invCell,
    neighborRange,
    blend,
    smoothPlan.normalBlend
  )

  return { positions, normals, colors, indices, step, isolevel, atomCount: atoms.length }
}
