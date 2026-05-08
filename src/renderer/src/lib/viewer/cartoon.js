import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three'

// ── Dimensions (match gatewizard defaults: helix_w=2, sheet_w=2.5, coil_w=0.5) ──

const SMOOTH_FACTOR = 8
const CS_SIDES = 10
const HALF_THICK = 0.15
const HELIX_HW = 1
const STRAND_HW = 0.875 // sheet_w * 0.35
const ARROW_HW = 1.375 // sheet_w * 0.55
const COIL_HW = 0.125 // coil_w * 0.25

// ── SS helpers ───────────────────────────────────────────────────────────

const HELIX_CODES = new Set(['H', 'h', 'G', 'g', 'I', 'i', 'F', 'f'])

/** @param {string} sec */
function ssCategory(sec) {
  if (!sec || sec.trim() === '') return 'coil'
  if (HELIX_CODES.has(sec)) return 'helix'
  if (sec === 'E') return 'strand'
  return 'coil'
}

/** @type {Record<string, [number,number,number]>} */
const SS_RGB = {
  H: [0.45, 0.35, 0.92],
  h: [0.45, 0.35, 0.92],
  G: [0.35, 0.75, 0.92],
  g: [0.35, 0.75, 0.92],
  I: [0.35, 0.75, 0.92],
  i: [0.35, 0.75, 0.92],
  F: [0.35, 0.75, 0.92],
  f: [0.35, 0.75, 0.92],
  E: [0.95, 0.78, 0.22],
  P: [0.35, 0.85, 0.42]
}
const COIL_RGB = /** @type {[number,number,number]} */ ([0.55, 0.55, 0.58])

/** @param {string} sec @returns {[number,number,number]} */
function ssColor(sec) {
  if (!sec || sec.trim() === '') return COIL_RGB
  return SS_RGB[sec] || COIL_RGB
}

// ── Core algorithms ─────────────────────────────────────────────────────

/**
 * Ribbon-width normals from the Cα→O direction, Gram–Schmidt-ed against the
 * backbone tangent and flipped for sequential consistency.
 *
 * @param {Vector3[]} ca
 * @param {(Vector3 | null)[]} oCoords
 * @returns {Vector3[]}
 */
function computeRibbonNormals(ca, oCoords) {
  const n = ca.length
  /** @type {Vector3[]} */
  const normals = []

  for (let i = 0; i < n; i++) {
    const t =
      i === 0
        ? new Vector3().subVectors(ca[1], ca[0])
        : i === n - 1
          ? new Vector3().subVectors(ca[n - 1], ca[n - 2])
          : new Vector3().subVectors(ca[i + 1], ca[i - 1])
    t.normalize()

    const co = oCoords[i]
      ? new Vector3().subVectors(oCoords[i], ca[i])
      : Math.abs(t.x) < 0.9
        ? new Vector3(1, 0, 0)
        : new Vector3(0, 1, 0)

    co.addScaledVector(t, -co.dot(t))

    if (co.lengthSq() < 1e-12) {
      co.copy(Math.abs(t.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0))
      co.addScaledVector(t, -co.dot(t))
    }

    normals.push(co.normalize())
  }

  for (let i = 1; i < n; i++) {
    if (normals[i].dot(normals[i - 1]) < 0) {
      normals[i].negate()
    }
  }
  return normals
}

/**
 * Catmull–Rom interpolation of a Vector3 quantity.
 * @param {Vector3} p0 @param {Vector3} p1 @param {Vector3} p2 @param {Vector3} p3
 * @param {number} t
 * @returns {Vector3}
 */
function catmullRom(p0, p1, p2, p3, t) {
  const tt = t * t,
    ttt = tt * t
  return new Vector3(
    0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * tt +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * ttt),
    0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * tt +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * ttt),
    0.5 *
      (2 * p1.z +
        (-p0.z + p2.z) * t +
        (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * tt +
        (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * ttt)
  )
}

/**
 * Catmull–Rom smooth both positions and normals, producing
 * `(n-1)*factor + 1` output samples.
 *
 * @param {Vector3[]} coords
 * @param {Vector3[]} normals
 * @param {number} factor
 * @returns {{ pts: Vector3[], nms: Vector3[] }}
 */
function smoothCoordsAndNormals(coords, normals, factor) {
  const n = coords.length
  /** @type {Vector3[]} */
  const rPts = []
  /** @type {Vector3[]} */
  const rNms = []

  if (n < 3) {
    for (let i = 0; i < n - 1; i++) {
      for (let ti = 0; ti < factor; ti++) {
        const t = ti / factor
        rPts.push(new Vector3().lerpVectors(coords[i], coords[i + 1], t))
        rNms.push(new Vector3().lerpVectors(normals[i], normals[i + 1], t).normalize())
      }
    }
    rPts.push(coords[n - 1].clone())
    rNms.push(normals[n - 1].clone())
    return { pts: rPts, nms: rNms }
  }

  for (let i = 0; i < n - 1; i++) {
    const p0 = coords[Math.max(i - 1, 0)]
    const p1 = coords[i]
    const p2 = coords[Math.min(i + 1, n - 1)]
    const p3 = coords[Math.min(i + 2, n - 1)]
    const n0 = normals[Math.max(i - 1, 0)]
    const n1 = normals[i]
    const n2 = normals[Math.min(i + 1, n - 1)]
    const n3 = normals[Math.min(i + 2, n - 1)]

    for (let ti = 0; ti < factor; ti++) {
      rPts.push(catmullRom(p0, p1, p2, p3, ti / factor))
      rNms.push(catmullRom(n0, n1, n2, n3, ti / factor).normalize())
    }
  }
  rPts.push(coords[n - 1].clone())
  rNms.push(normals[n - 1].clone())
  return { pts: rPts, nms: rNms }
}

// ── Geometry construction ────────────────────────────────────────────────

/**
 * Build a triangle-mesh ribbon from smoothed positions, normals, per-point
 * width / thickness / color.  Cross-section is an ellipse with `CS_SIDES`
 * vertices: `p + w·cos(θ)·N + th·sin(θ)·B`.
 *
 * @param {Vector3[]} pts
 * @param {Vector3[]} nms
 * @param {Float32Array} widths
 * @param {Float32Array} thicknesses
 * @param {[number,number,number][]} colors
 * @returns {BufferGeometry | null}
 */
function buildRibbonGeometry(pts, nms, widths, thicknesses, colors) {
  const n = pts.length
  if (n < 2) return null

  const S = CS_SIDES
  const cosA = new Float32Array(S)
  const sinA = new Float32Array(S)
  for (let k = 0; k < S; k++) {
    const a = (2 * Math.PI * k) / S
    cosA[k] = Math.cos(a)
    sinA[k] = Math.sin(a)
  }

  const nVerts = n * S
  const pos = new Float32Array(nVerts * 3)
  const col = new Float32Array(nVerts * 3)

  const T = new Vector3()
  const B = new Vector3()

  for (let i = 0; i < n; i++) {
    const p = pts[i]
    const N = nms[i]

    if (i === 0) T.subVectors(pts[1], p)
    else if (i === n - 1) T.subVectors(p, pts[i - 1])
    else T.subVectors(pts[i + 1], pts[i - 1])
    T.normalize()

    B.crossVectors(T, N)
    if (B.lengthSq() < 1e-24) B.set(0, 1, 0)
    else B.normalize()

    const w = widths[i]
    const th = thicknesses[i]
    const rgb = colors[i]
    const base = i * S * 3

    if (w < 0.001 && th < 0.001) {
      for (let k = 0; k < S; k++) {
        const off = base + k * 3
        pos[off] = p.x
        pos[off + 1] = p.y
        pos[off + 2] = p.z
        col[off] = rgb[0]
        col[off + 1] = rgb[1]
        col[off + 2] = rgb[2]
      }
    } else {
      for (let k = 0; k < S; k++) {
        const off = base + k * 3
        const c = cosA[k],
          s = sinA[k]
        pos[off] = p.x + w * c * N.x + th * s * B.x
        pos[off + 1] = p.y + w * c * N.y + th * s * B.y
        pos[off + 2] = p.z + w * c * N.z + th * s * B.z
        col[off] = rgb[0]
        col[off + 1] = rgb[1]
        col[off + 2] = rgb[2]
      }
    }
  }

  const idx = []
  for (let i = 0; i < n - 1; i++) {
    const base = i * S
    const nb = (i + 1) * S
    for (let k = 0; k < S; k++) {
      const k1 = (k + 1) % S
      idx.push(base + k, nb + k, nb + k1)
      idx.push(base + k, nb + k1, base + k1)
    }
  }

  const geom = new BufferGeometry()
  geom.setAttribute('position', new Float32BufferAttribute(pos, 3))
  geom.setAttribute('color', new Float32BufferAttribute(col, 3))
  geom.setIndex(idx)
  geom.computeVertexNormals()
  return geom
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Build one cartoon `BufferGeometry` per continuous backbone segment.
 *
 * @param {{ x: number, y: number, z: number, name: string }[]} atoms
 * @param {Array<{
 *   chain: string,
 *   number: number,
 *   insertion?: string,
 *   atom_indices: number[],
 *   ca_index?: number,
 *   sec?: string
 * }>} residues
 * @returns {BufferGeometry[]}
 */
export function buildCartoonGeometries(atoms, residues) {
  const segments = splitContinuousSegments(atoms, residues)
  /** @type {BufferGeometry[]} */
  const out = []
  for (const seg of segments) {
    const geom = buildSegmentCartoon(atoms, seg)
    if (geom) out.push(geom)
  }
  return out
}

/**
 * Sort CA-bearing residues by chain / number / insertion and split at chain
 * breaks or backbone discontinuities (Cα–Cα > 7.2 Å or < 1.0 Å).
 */
function splitContinuousSegments(atoms, residues) {
  const caRes = residues
    .filter((r) => typeof r.ca_index === 'number' && atoms[r.ca_index])
    .sort(
      (a, b) =>
        (a.chain || '').localeCompare(b.chain || '') ||
        (a.number ?? 0) - (b.number ?? 0) ||
        (a.insertion || '').localeCompare(b.insertion || '')
    )

  /** @type {typeof caRes[]} */
  const segments = []
  let start = 0
  for (let i = 1; i <= caRes.length; i++) {
    let split = i === caRes.length
    if (!split) {
      const prev = caRes[i - 1]
      const curr = caRes[i]
      if ((prev.chain || '') !== (curr.chain || '')) {
        split = true
      } else {
        const pa = atoms[prev.ca_index]
        const pb = atoms[curr.ca_index]
        const d = Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z)
        if (d > 7.2 || d < 1.0) split = true
      }
    }
    if (split) {
      if (i - start >= 2) segments.push(caRes.slice(start, i))
      start = i
    }
  }
  return segments
}

/**
 * Build one cartoon geometry for a continuous backbone segment.
 * @param {{ x: number, y: number, z: number, name: string }[]} atoms
 * @param {Array<{ ca_index?: number, sec?: string, atom_indices: number[] }>} segResidues
 */
function buildSegmentCartoon(atoms, segResidues) {
  const nr = segResidues.length
  if (nr < 2) return null

  /** @type {Vector3[]} */
  const caCoords = []
  /** @type {(Vector3 | null)[]} */
  const oCoords = []
  /** @type {string[]} */
  const secs = []

  for (const res of segResidues) {
    const ca = atoms[res.ca_index]
    caCoords.push(new Vector3(ca.x, ca.y, ca.z))
    secs.push(res.sec || '')

    let oCoord = null
    if (res.atom_indices) {
      for (const idx of res.atom_indices) {
        const at = atoms[idx]
        if (at && at.name === 'O') {
          oCoord = new Vector3(at.x, at.y, at.z)
          break
        }
      }
    }
    oCoords.push(oCoord)
  }

  const ribbonNormals = computeRibbonNormals(caCoords, oCoords)
  const { pts, nms } = smoothCoordsAndNormals(caCoords, ribbonNormals, SMOOTH_FACTOR)
  const nSm = pts.length

  /** @type {string[]} */
  const ssPerPt = []
  for (let ri = 0; ri < nr; ri++) {
    const count = ri < nr - 1 ? SMOOTH_FACTOR : 1
    for (let k = 0; k < count; k++) ssPerPt.push(secs[ri])
  }

  /** @type {{ s: number, e: number, ss: string }[]} */
  const segments = []
  let segStart = 0
  for (let j = 1; j < nSm; j++) {
    if (ssPerPt[j] !== ssPerPt[j - 1]) {
      segments.push({ s: segStart, e: j - 1, ss: ssPerPt[segStart] })
      segStart = j
    }
  }
  segments.push({ s: segStart, e: nSm - 1, ss: ssPerPt[segStart] })

  // Widths / thicknesses per SS type
  const widths = new Float32Array(nSm)
  const thicknesses = new Float32Array(nSm)

  for (let i = 0; i < nSm; i++) {
    const cat = ssCategory(ssPerPt[i])
    if (cat === 'helix') {
      widths[i] = HELIX_HW
      thicknesses[i] = HALF_THICK
    } else if (cat === 'strand') {
      widths[i] = STRAND_HW
      thicknesses[i] = HALF_THICK
    } else {
      widths[i] = COIL_HW
      thicknesses[i] = COIL_HW
    }
  }

  // Arrow taper for strands (last 30 %)
  for (const seg of segments) {
    if (ssCategory(seg.ss) !== 'strand') continue
    const segLen = seg.e - seg.s + 1
    const arrowStart = seg.s + Math.max(1, Math.floor(segLen * 0.7))
    for (let i = arrowStart; i <= seg.e; i++) {
      const frac = (i - arrowStart) / Math.max(1, seg.e - arrowStart)
      widths[i] = ARROW_HW * (1 - frac)
    }
  }

  // Smooth width / thickness at SS-type boundaries
  const transition = Math.max(3, SMOOTH_FACTOR)
  for (let si = 0; si < segments.length - 1; si++) {
    const bnd = segments[si].e + 1
    for (let d = 0; d < transition; d++) {
      const alpha = 0.5 * (1 - d / transition)
      const ib = bnd - 1 - d
      const ia = bnd + d
      if (ib >= 0 && ib < nSm && ia >= 0 && ia < nSm) {
        const avgW = 0.5 * (widths[ib] + widths[ia])
        widths[ib] += alpha * (avgW - widths[ib])
        widths[ia] += alpha * (avgW - widths[ia])
        const avgT = 0.5 * (thicknesses[ib] + thicknesses[ia])
        thicknesses[ib] += alpha * (avgT - thicknesses[ib])
        thicknesses[ia] += alpha * (avgT - thicknesses[ia])
      }
    }
  }

  return buildRibbonGeometry(pts, nms, widths, thicknesses, ssPerPt.map(ssColor))
}
