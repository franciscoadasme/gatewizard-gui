import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three'

// ── Dimensions (match gatewizard defaults: helix_w=2, sheet_w=2.5, coil_w=0.5) ──

const SMOOTH_FACTOR = 8
const CS_SIDES = 10
const HALF_THICK = 0.15
const HELIX_HW = 1
const STRAND_HW = 0.875 // sheet_w * 0.35
const ARROW_HW = 1.375 // sheet_w * 0.55
const COIL_HW = 0.125 // coil_w * 0.25

/** Quality presets: [smoothFactor, csSides] */
const QUALITY_PRESETS = /** @type {Record<number,[number,number]>} */ ({ 1: [4, 6], 2: [8, 10], 3: [12, 14], 4: [20, 24], 5: [32, 36] })
/** @param {number} [q] @returns {[number,number]} */
function getQualityPreset(q) { return QUALITY_PRESETS[q] ?? QUALITY_PRESETS[3] }

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
  H: [0.706, 0.553, 0.855],  // #b48dda  alpha helix
  h: [0.706, 0.553, 0.855],
  G: [0.482, 0.247, 0.710],  // #7b3fb5  3-10 helix
  g: [0.482, 0.247, 0.710],
  I: [0.239, 0.102, 0.431],  // #3d1a6e  pi helix
  i: [0.239, 0.102, 0.431],
  F: [0.482, 0.247, 0.710],
  f: [0.482, 0.247, 0.710],
  E: [0.129, 0.588, 0.651],  // #2196a6  beta sheet
  PP:[0.976, 0.780, 0.310]   // #f9c74f  polyproline
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
function buildRibbonGeometry(pts, nms, widths, thicknesses, colors, csSides = CS_SIDES) {
  const n = pts.length
  if (n < 2) return null

  const S = csSides
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
 * @typedef {{helixWidth?: number, sheetWidth?: number, coilWidth?: number, ssColors?: Record<string,string>|null, quality?: number}} CartoonOpts
 */

/**
 * @typedef {{ tubeRadius?: number, ssColors?: Record<string,string>|null, quality?: number }} TubeOpts
 */

// ── Colour helpers ────────────────────────────────────────────────────────────

/** @param {string} hex  e.g. '#7259ea'  @returns {[number,number,number]} */
function hexToRgb(hex) {
  const h = hex.replace('#', '')
  const v = parseInt(h, 16)
  return [(v >> 16 & 0xff) / 255, (v >> 8 & 0xff) / 255, (v & 0xff) / 255]
}

/** @param {Record<string,string>} map  @returns {Record<string,[number,number,number]>} */
function hexMapToRgb(map) {
  /** @type {Record<string,[number,number,number]>} */
  const out = {}
  for (const [k, v] of Object.entries(map)) {
    out[k] = hexToRgb(v)
  }
  return out
}


/**
 * @param {Array} atoms
 * @param {Array} residues
 * @param {(atom: any) => import('three').Color} colorFn
 * @param {CartoonOpts} [opts]
 * @returns {BufferGeometry[]}
 */
export function buildCartoonGeometries(atoms, residues, colorFn, opts = {}) {
  const segments = splitContinuousSegments(atoms, residues)
  /** @type {BufferGeometry[]} */
  const out = []
  for (const seg of segments) {
    const geom = buildSegmentCartoon(atoms, seg, colorFn, opts)
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
 * @param {(atom: any) => import('three').Color} colorFn
 * @param {CartoonOpts} [opts]
 */
function buildSegmentCartoon(atoms, segResidues, colorFn, opts = {}) {
  const helixHW  = opts.helixWidth  ?? HELIX_HW
  const strandHW = opts.sheetWidth  ?? STRAND_HW
  const coilHW   = opts.coilWidth   ?? COIL_HW
  const arrowHW  = strandHW * (ARROW_HW / STRAND_HW)  // preserve relative scale
  const [smoothFactor, csSides] = getQualityPreset(opts.quality)

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
  const { pts, nms } = smoothCoordsAndNormals(caCoords, ribbonNormals, smoothFactor)
  const nSm = pts.length

  /** @type {string[]} */
  const ssPerPt = []
  /** @type {[number,number,number][]} */
  const ptColors = []
  for (let ri = 0; ri < nr; ri++) {
    const count = ri < nr - 1 ? smoothFactor : 1
    const cv = colorFn(atoms[segResidues[ri].ca_index])
    const col = /** @type {[number,number,number]} */ ([cv.r, cv.g, cv.b])
    for (let k = 0; k < count; k++) { ssPerPt.push(secs[ri]); ptColors.push(col) }
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
      widths[i] = helixHW
      thicknesses[i] = HALF_THICK
    } else if (cat === 'strand') {
      widths[i] = strandHW
      thicknesses[i] = HALF_THICK
    } else {
      widths[i] = coilHW
      thicknesses[i] = coilHW
    }
  }

  // Arrow taper for strands (last 30 %)
  for (const seg of segments) {
    if (ssCategory(seg.ss) !== 'strand') continue
    const segLen = seg.e - seg.s + 1
    const arrowStart = seg.s + Math.max(1, Math.floor(segLen * 0.7))
    for (let i = arrowStart; i <= seg.e; i++) {
      const frac = (i - arrowStart) / Math.max(1, seg.e - arrowStart)
      widths[i] = arrowHW * (1 - frac)
    }
  }

  // Smooth width / thickness at SS-type boundaries
  const transition = Math.max(3, smoothFactor)
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

  return buildRibbonGeometry(pts, nms, widths, thicknesses, ptColors, csSides)
}

// ── Tube ─────────────────────────────────────────────────────────────────────

/** @param {[number,number,number]} a @param {[number,number,number]} b @param {number} t @returns {[number,number,number]} */
function lerpRgb(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/**
 * Build circular tube geometries following the Cα backbone with SS-varying
 * radius and smooth SS color transitions (matching the old gatewizard Tube SS).
 * @param {Array} atoms
 * @param {Array} residues
 * @param {(atom: any) => import('three').Color} colorFn  fallback per-atom color
 * @param {TubeOpts} [opts]
 * @returns {BufferGeometry[]}
 */
export function buildTubeGeometries(atoms, residues, colorFn, opts = {}) {
  const segments = splitContinuousSegments(atoms, residues)
  /** @type {BufferGeometry[]} */
  const out = []
  for (const seg of segments) {
    const geom = buildSegmentTube(atoms, seg, colorFn, opts)
    if (geom) out.push(geom)
  }
  return out
}

/**
 * @param {any[]} atoms
 * @param {Array<{ ca_index?: number, sec?: string, atom_indices: number[] }>} segResidues
 * @param {(atom: any) => import('three').Color} colorFn
 * @param {TubeOpts} opts
 * @returns {BufferGeometry | null}
 */
function buildSegmentTube(atoms, segResidues, colorFn, opts) {
  const nr = segResidues.length
  if (nr < 2) return null

  const baseRadius = opts.tubeRadius ?? 0.35
  // Radii: helix/sheet are full size; coils are ~28% (matches old gatewizard proportions)
  const helixR = baseRadius
  const sheetR = baseRadius
  const coilR  = baseRadius * 0.28
  const arrowR = baseRadius * 1.2
  const [smoothFactor, csSides] = getQualityPreset(opts.quality)

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
        if (at && at.name === 'O') { oCoord = new Vector3(at.x, at.y, at.z); break }
      }
    }
    oCoords.push(oCoord)
  }

  const ribbonNormals = computeRibbonNormals(caCoords, oCoords)
  const { pts, nms } = smoothCoordsAndNormals(caCoords, ribbonNormals, smoothFactor)
  const nSm = pts.length

  // Expand per-residue SS codes and colors to smoothed point count
  /** @type {string[]} */
  const ssPerPt = []
  /** @type {[number,number,number][]} */
  const baseColors = []
  for (let ri = 0; ri < nr; ri++) {
    const count = ri < nr - 1 ? smoothFactor : 1
    const sec = secs[ri]
    const c = colorFn(atoms[segResidues[ri].ca_index])
    const col = /** @type {[number,number,number]} */ ([c.r, c.g, c.b])
    for (let k = 0; k < count; k++) { ssPerPt.push(sec); baseColors.push(col) }
  }

  // SS-segment boundaries
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

  // Radii by SS type
  const radii = new Float32Array(nSm)
  for (let i = 0; i < nSm; i++) {
    const cat = ssCategory(ssPerPt[i])
    if (cat === 'helix') radii[i] = helixR
    else if (cat === 'strand') radii[i] = sheetR
    else radii[i] = coilR
  }

  // Arrow taper for strands (last 30%)
  for (const seg of segments) {
    if (ssCategory(seg.ss) !== 'strand') continue
    const segLen = seg.e - seg.s + 1
    const arrowStart = seg.s + Math.max(1, Math.floor(segLen * 0.7))
    for (let i = arrowStart; i <= seg.e; i++) {
      const frac = (i - arrowStart) / Math.max(1, seg.e - arrowStart)
      radii[i] = arrowR * (1 - frac)
    }
  }

  // Smooth radii and colors at SS-type boundaries
  const transition = Math.max(3, smoothFactor)
  const smoothColors = baseColors.slice()
  for (let si = 0; si < segments.length - 1; si++) {
    const bnd = segments[si].e + 1
    const cBefore = baseColors[bnd - 1]
    const cAfter  = baseColors[Math.min(bnd, nSm - 1)]
    for (let d = 0; d < transition; d++) {
      const alpha = 0.5 * (1 - d / transition)
      const ib = bnd - 1 - d
      const ia = bnd + d
      if (ib >= 0 && ib < nSm && ia >= 0 && ia < nSm) {
        const avgR = 0.5 * (radii[ib] + radii[ia])
        radii[ib] += alpha * (avgR - radii[ib])
        radii[ia] += alpha * (avgR - radii[ia])
      }
      const blend = (1 - d / transition) * 0.7
      if (ib >= 0 && ib < nSm) smoothColors[ib] = lerpRgb(baseColors[ib], cAfter, blend)
      if (ia >= 0 && ia < nSm) smoothColors[ia] = lerpRgb(baseColors[ia], cBefore, blend)
    }
  }

  return buildRibbonGeometry(pts, nms, radii, radii, smoothColors, csSides)
}
