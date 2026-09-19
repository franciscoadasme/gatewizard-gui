/**
 * Continuous licorice pipe math:
 * - degree-2: shorten sticks to torus-elbow tangents (curved external tube)
 * - degree≥3: sticks meet the atom; opaque sphere joint fills the branch
 * - degree-1: terminal caps
 * No through-penetration / VMD-style extend past the atom.
 */

/** Extra stick length into the elbow so the seam seals (× stick radius). */
export const PIPE_SEAL_FACTOR = 0.1

/** Bend major radius = PIPE_BEND_FACTOR × stick radius. */
export const PIPE_BEND_FACTOR = 1.75

/**
 * How far degree≥3 sticks extend past the atom (× stick radius), filling the
 * wedge gap the way VMD Bonds does.
 */
export const PIPE_EXTEND_FACTOR = 1.15

/** Skip elbows when bond angle is nearly straight or folded. */
const MIN_BOND_ANGLE = 0.12 // ~7°
const MAX_BOND_ANGLE = Math.PI - 0.12

/**
 * @param {Array<{ i: number, j: number }>} edges unique undirected bonds
 * @returns {Map<number, number[]>}
 */
export function buildAdjacency(edges) {
  /** @type {Map<number, Set<number>>} */
  const sets = new Map()
  for (const e of edges) {
    const i = e.i
    const j = e.j
    if (!Number.isFinite(i) || !Number.isFinite(j) || i === j) continue
    if (!sets.has(i)) sets.set(i, new Set())
    if (!sets.has(j)) sets.set(j, new Set())
    sets.get(i).add(j)
    sets.get(j).add(i)
  }
  /** @type {Map<number, number[]>} */
  const adj = new Map()
  for (const [k, s] of sets) adj.set(k, [...s])
  return adj
}

/**
 * @param {Map<number, number[]>} adjacency
 * @returns {Map<number, { degree: number, neighbors: number[] }>}
 */
export function classifyAtoms(adjacency) {
  /** @type {Map<number, { degree: number, neighbors: number[] }>} */
  const out = new Map()
  for (const [idx, neighbors] of adjacency) {
    out.set(idx, { degree: neighbors.length, neighbors })
  }
  return out
}

/**
 * Shorten distance along each arm for a degree-2 torus fillet.
 * θ = bond angle between unit directions from the atom; path turn α = π − θ;
 * L = R · tan(α/2) = R / tan(θ/2).
 *
 * @param {number} bondAngle radians in (0, π)
 * @param {number} bendRadius major radius R
 * @returns {number}
 */
export function elbowShortenLength(bondAngle, bendRadius) {
  const θ = bondAngle
  if (!(θ > MIN_BOND_ANGLE && θ < MAX_BOND_ANGLE)) return 0
  const t = Math.tan(θ * 0.5)
  if (t < 1e-6) return 0
  return bendRadius / t
}

/**
 * VMD-style extension past a branched atom so angled open cylinders overlap.
 *
 * @param {number} stickRadius
 * @returns {number}
 */
export function branchExtendLength(stickRadius) {
  return Math.max(0, stickRadius) * PIPE_EXTEND_FACTOR
}

/**
 * @param {number} stickRadius
 * @returns {number}
 */
export function pipeBendRadius(stickRadius) {
  return Math.max(1e-6, stickRadius) * PIPE_BEND_FACTOR
}

/**
 * Orthonormal frame + center for a torus sector connecting d0 and d1
 * (unit vectors from atom toward each neighbor).
 *
 * TorusGeometry(arc) lies in XY with major angle from +X toward +Y.
 * We map local +X → direction to first tangent from center, sweep toward second.
 *
 * @param {[number, number, number]} atomPos
 * @param {[number, number, number]} d0 unit
 * @param {[number, number, number]} d1 unit
 * @param {number} bendRadius
 * @returns {{
 *   center: [number, number, number],
 *   xAxis: [number, number, number],
 *   yAxis: [number, number, number],
 *   zAxis: [number, number, number],
 *   sweep: number,
 *   shorten: number,
 *   bondAngle: number
 * } | null}
 */
export function computeElbowFrame(atomPos, d0, d1, bendRadius) {
  const dot = clamp(d0[0] * d1[0] + d0[1] * d1[1] + d0[2] * d1[2], -1, 1)
  const bondAngle = Math.acos(dot)
  const shorten = elbowShortenLength(bondAngle, bendRadius)
  if (shorten <= 1e-8) return null

  const sweep = Math.PI - bondAngle
  if (sweep < MIN_BOND_ANGLE || sweep > Math.PI - 1e-4) return null

  // Plane normal
  let zx = d0[1] * d1[2] - d0[2] * d1[1]
  let zy = d0[2] * d1[0] - d0[0] * d1[2]
  let zz = d0[0] * d1[1] - d0[1] * d1[0]
  let zLen = Math.hypot(zx, zy, zz)
  if (zLen < 1e-8) return null
  zx /= zLen
  zy /= zLen
  zz /= zLen

  // Bisector of the two arms (into the bond wedge)
  let bx = d0[0] + d1[0]
  let by = d0[1] + d1[1]
  let bz = d0[2] + d1[2]
  let bLen = Math.hypot(bx, by, bz)
  if (bLen < 1e-8) return null
  bx /= bLen
  by /= bLen
  bz /= bLen

  // Path n0→P→n1 turns on the bond-wedge side; arc center sits along the bond bisector.
  const distPC = bendRadius / Math.sin(bondAngle * 0.5)
  const cx = atomPos[0] + bx * distPC
  const cy = atomPos[1] + by * distPC
  const cz = atomPos[2] + bz * distPC

  // Tangent points on each arm
  const t0x = atomPos[0] + d0[0] * shorten
  const t0y = atomPos[1] + d0[1] * shorten
  const t0z = atomPos[2] + d0[2] * shorten
  const t1x = atomPos[0] + d1[0] * shorten
  const t1y = atomPos[1] + d1[1] * shorten
  const t1z = atomPos[2] + d1[2] * shorten

  // Local +X: from center toward first tangent (start of TorusGeometry arc)
  let xx = t0x - cx
  let xy = t0y - cy
  let xz = t0z - cz
  let xLen = Math.hypot(xx, xy, xz)
  if (xLen < 1e-8) return null
  xx /= xLen
  xy /= xLen
  xz /= xLen

  // Local +Y: rotate X toward second tangent in the plane (right-handed with Z)
  // y = normalize(cross(z, x)) chosen so that +Y points toward the sweep to T1
  let yx = zy * xz - zz * xy
  let yy = zz * xx - zx * xz
  let yz = zx * xy - zy * xx
  let yLen = Math.hypot(yx, yy, yz)
  if (yLen < 1e-8) return null
  yx /= yLen
  yy /= yLen
  yz /= yLen

  // Ensure sweep goes toward T1: if T1 is on -Y side, flip Z and Y
  const to1x = t1x - cx
  const to1y = t1y - cy
  const to1z = t1z - cz
  if (to1x * yx + to1y * yy + to1z * yz < 0) {
    yx = -yx
    yy = -yy
    yz = -yz
    zx = -zx
    zy = -zy
    zz = -zz
  }

  return {
    center: [cx, cy, cz],
    xAxis: [xx, xy, xz],
    yAxis: [yx, yy, yz],
    zAxis: [zx, zy, zz],
    sweep,
    shorten,
    bondAngle
  }
}

/**
 * Per-atom end adjustment along the bond direction from the atom toward the neighbor:
 * positive = move endpoint away from atom (shorten stick), negative = past atom (extend).
 *
 * Continuous tube: degree-2 shortens to the torus-elbow tangent (minus a small seal);
 * branches and terminals leave the endpoint at the atom (sphere / cap covers the joint).
 *
 * @param {Map<number, { degree: number, neighbors: number[] }>} classified
 * @param {Map<number, [number, number, number]>} positions atomIndex → xyz
 * @param {number} stickRadius
 * @returns {Map<number, Map<number, number>>} atom → (neighbor → signed adjust along atom→neighbor)
 */
export function computeEndAdjustments(classified, positions, stickRadius) {
  const bendR = pipeBendRadius(stickRadius)
  const seal = Math.max(0, stickRadius) * PIPE_SEAL_FACTOR
  /** @type {Map<number, Map<number, number>>} */
  const adj = new Map()

  for (const [atomIdx, info] of classified) {
    const pos = positions.get(atomIdx)
    if (!pos) continue
    /** @type {Map<number, number>} */
    const perN = new Map()

    if (info.degree === 2) {
      const [n0, n1] = info.neighbors
      const p0 = positions.get(n0)
      const p1 = positions.get(n1)
      let shorten = 0
      if (p0 && p1) {
        const d0 = unitFromTo(pos, p0)
        const d1 = unitFromTo(pos, p1)
        if (d0 && d1) {
          const dot = clamp(d0[0] * d1[0] + d0[1] * d1[1] + d0[2] * d1[2], -1, 1)
          const θ = Math.acos(dot)
          shorten = Math.max(0, elbowShortenLength(θ, bendR) - seal)
        }
      }
      perN.set(n0, shorten)
      perN.set(n1, shorten)
    } else {
      // Terminals (cap) and branches (sphere): stick meets the atom.
      for (const n of info.neighbors) perN.set(n, 0)
    }
    adj.set(atomIdx, perN)
  }
  return adj
}

/**
 * Branch atoms (degree ≥ 3) that need an opaque sphere joint.
 *
 * @param {Map<number, { degree: number, neighbors: number[] }>} classified
 * @returns {number[]}
 */
export function computeBranchJoints(classified) {
  /** @type {number[]} */
  const out = []
  for (const [idx, info] of classified) {
    if (info.degree >= 3) out.push(idx)
  }
  return out
}

/**
 * Stick endpoints given atom positions and end adjustments.
 * Adjustment a at atom A toward B: endpoint = A + normalize(B-A) * a
 * (a>0 shortens before A; a<0 extends past A; a=0 at A).
 *
 * @param {[number, number, number]} posA
 * @param {[number, number, number]} posB
 * @param {number} adjustA along A→B
 * @param {number} adjustB along B→A
 * @returns {{ start: [number, number, number], end: [number, number, number], length: number, dir: [number, number, number] } | null}
 */
export function stickEndpoints(posA, posB, adjustA, adjustB) {
  const dx = posB[0] - posA[0]
  const dy = posB[1] - posA[1]
  const dz = posB[2] - posA[2]
  const len = Math.hypot(dx, dy, dz)
  if (len < 1e-8) return null
  const ux = dx / len
  const uy = dy / len
  const uz = dz / len
  const start = [posA[0] + ux * adjustA, posA[1] + uy * adjustA, posA[2] + uz * adjustA]
  const end = [posB[0] - ux * adjustB, posB[1] - uy * adjustB, posB[2] - uz * adjustB]
  const sx = end[0] - start[0]
  const sy = end[1] - start[1]
  const sz = end[2] - start[2]
  const sl = Math.hypot(sx, sy, sz)
  if (sl < 1e-5) return null
  return {
    start,
    end,
    length: sl,
    dir: [sx / sl, sy / sl, sz / sl]
  }
}

/**
 * Elbow descriptors for every degree-2 atom.
 *
 * @param {Map<number, { degree: number, neighbors: number[] }>} classified
 * @param {Map<number, [number, number, number]>} positions
 * @param {number} stickRadius
 * @returns {Array<{
 *   atomIndex: number,
 *   center: [number, number, number],
 *   xAxis: [number, number, number],
 *   yAxis: [number, number, number],
 *   zAxis: [number, number, number],
 *   sweep: number,
 *   bendRadius: number,
 *   tubeRadius: number
 * }>}
 */
export function computeElbows(classified, positions, stickRadius) {
  const bendR = pipeBendRadius(stickRadius)
  /** @type {ReturnType<typeof computeElbows>} */
  const elbows = []
  for (const [atomIdx, info] of classified) {
    if (info.degree !== 2) continue
    const pos = positions.get(atomIdx)
    if (!pos) continue
    const [n0, n1] = info.neighbors
    const p0 = positions.get(n0)
    const p1 = positions.get(n1)
    if (!p0 || !p1) continue
    const d0 = unitFromTo(pos, p0)
    const d1 = unitFromTo(pos, p1)
    if (!d0 || !d1) continue
    const frame = computeElbowFrame(pos, d0, d1, bendR)
    if (!frame) continue
    elbows.push({
      atomIndex: atomIdx,
      center: frame.center,
      xAxis: frame.xAxis,
      yAxis: frame.yAxis,
      zAxis: frame.zAxis,
      sweep: frame.sweep,
      bendRadius: bendR,
      tubeRadius: stickRadius
    })
  }
  return elbows
}

/**
 * @param {Map<number, { degree: number, neighbors: number[] }>} classified
 * @returns {number[]} degree-1 atom indices
 */
export function computeTerminals(classified) {
  /** @type {number[]} */
  const t = []
  for (const [idx, info] of classified) {
    if (info.degree === 1) t.push(idx)
  }
  return t
}

/**
 * Compose a column-major 4×4 placing a sized TorusGeometry (already at bendRadius)
 * into the elbow frame — rotation + translation only (no scale).
 *
 * @param {{ center: number[], xAxis: number[], yAxis: number[], zAxis: number[] }} elbow
 * @param {Float32Array | number[]} into length ≥ 16
 * @returns {Float32Array | number[]}
 */
export function elbowFrameMatrixElements(elbow, into) {
  const x = elbow.xAxis
  const y = elbow.yAxis
  const z = elbow.zAxis
  const c = elbow.center
  into[0] = x[0]
  into[1] = x[1]
  into[2] = x[2]
  into[3] = 0
  into[4] = y[0]
  into[5] = y[1]
  into[6] = y[2]
  into[7] = 0
  into[8] = z[0]
  into[9] = z[1]
  into[10] = z[2]
  into[11] = 0
  into[12] = c[0]
  into[13] = c[1]
  into[14] = c[2]
  into[15] = 1
  return into
}

/**
 * Compose a column-major 4×4 (Three.js Matrix4 elements) placing a unit torus
 * (major radius 1 in XY, arc from +X toward +Y) at the elbow frame, scaled by bendRadius.
 * Tube radius of the unit geom must be tubeRadius/bendRadius.
 *
 * @param {{ center: number[], xAxis: number[], yAxis: number[], zAxis: number[], bendRadius: number }} elbow
 * @param {Float32Array | number[]} into length ≥ 16
 * @returns {Float32Array | number[]}
 */
export function elbowMatrixElements(elbow, into) {
  const s = elbow.bendRadius
  const x = elbow.xAxis
  const y = elbow.yAxis
  const z = elbow.zAxis
  const c = elbow.center
  into[0] = x[0] * s
  into[1] = x[1] * s
  into[2] = x[2] * s
  into[3] = 0
  into[4] = y[0] * s
  into[5] = y[1] * s
  into[6] = y[2] * s
  into[7] = 0
  into[8] = z[0] * s
  into[9] = z[1] * s
  into[10] = z[2] * s
  into[11] = 0
  into[12] = c[0]
  into[13] = c[1]
  into[14] = c[2]
  into[15] = 1
  return into
}

/**
 * @param {number} x
 * @param {number} lo
 * @param {number} hi
 */
function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x))
}

/**
 * @param {[number, number, number]} from
 * @param {[number, number, number]} to
 * @returns {[number, number, number] | null}
 */
function unitFromTo(from, to) {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const dz = to[2] - from[2]
  const len = Math.hypot(dx, dy, dz)
  if (len < 1e-8) return null
  return [dx / len, dy / len, dz / len]
}
