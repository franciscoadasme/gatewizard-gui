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
 * Frozen ribbon topology. Positions are rewritten from packed Cα / O each frame.
 * @typedef {{
 *   geometry: import('three').BufferGeometry,
 *   caIndex: Int32Array,
 *   oIndex: Int32Array,
 *   widths: Float32Array,
 *   thicknesses: Float32Array,
 *   smoothFactor: number,
 *   csSides: number,
 *   nRes: number,
 *   nSm: number,
 *   ca: Float32Array,
 *   o: Float32Array,
 *   hasO: Uint8Array,
 *   nrm: Float32Array,
 *   smP: Float32Array,
 *   smN: Float32Array
 * }} RibbonSkin
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
  return createCartoonSkin(atoms, residues, colorFn, opts).map((s) => s.geometry)
}

/**
 * Ribbon meshes plus the backbone tables needed to move them without remeshing.
 * @param {Array} atoms
 * @param {Array} residues
 * @param {(atom: any) => import('three').Color} colorFn
 * @param {CartoonOpts} [opts]
 * @returns {RibbonSkin[]}
 */
export function createCartoonSkin(atoms, residues, colorFn, opts = {}) {
  /** @type {Map<number, any>} Map from atom.index (global MDAnalysis id) → atom */
  const atomByIndex = new Map(atoms.map((a) => [a.index, a]))
  const segments = splitContinuousSegments(atomByIndex, residues)
  /** @type {RibbonSkin[]} */
  const out = []
  for (const seg of segments) {
    const skin = buildSegmentCartoon(atomByIndex, seg, colorFn, opts)
    if (skin) out.push(skin)
  }
  return out
}

/**
 * Sort CA-bearing residues by chain / number / insertion and split at chain
 * breaks or backbone discontinuities (Cα–Cα > 7.2 Å or < 1.0 Å).
 * @param {Map<number, any>} atomByIndex  Map from atom.index → atom
 */
function splitContinuousSegments(atomByIndex, residues) {
  const caRes = residues
    .filter((r) => typeof r.ca_index === 'number' && atomByIndex.get(r.ca_index))
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
        const pa = atomByIndex.get(prev.ca_index)
        const pb = atomByIndex.get(curr.ca_index)
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
 * @param {Map<number, any>} atomByIndex  Map from atom.index → atom
 * @param {Array<{ ca_index?: number, sec?: string, atom_indices: number[] }>} segResidues
 * @param {(atom: any) => import('three').Color} colorFn
 * @param {CartoonOpts} [opts]
 */
function buildSegmentCartoon(atomByIndex, segResidues, colorFn, opts = {}) {
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
    const ca = atomByIndex.get(res.ca_index)
    caCoords.push(new Vector3(ca.x, ca.y, ca.z))
    secs.push(res.sec || '')

    let oCoord = null
    if (res.atom_indices) {
      for (const idx of res.atom_indices) {
        const at = atomByIndex.get(idx)
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
    const cv = colorFn(atomByIndex.get(segResidues[ri].ca_index))
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

  const geom = buildRibbonGeometry(pts, nms, widths, thicknesses, ptColors, csSides)
  if (!geom) return null
  return allocRibbonSkin(geom, segResidues, atomByIndex, widths, thicknesses, smoothFactor, csSides)
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
  return createTubeSkin(atoms, residues, colorFn, opts).map((s) => s.geometry)
}

/**
 * @param {Array} atoms
 * @param {Array} residues
 * @param {(atom: any) => import('three').Color} colorFn
 * @param {TubeOpts} [opts]
 * @returns {RibbonSkin[]}
 */
export function createTubeSkin(atoms, residues, colorFn, opts = {}) {
  /** @type {Map<number, any>} Map from atom.index (global MDAnalysis id) → atom */
  const atomByIndex = new Map(atoms.map((a) => [a.index, a]))
  const segments = splitContinuousSegments(atomByIndex, residues)
  /** @type {RibbonSkin[]} */
  const out = []
  for (const seg of segments) {
    const skin = buildSegmentTube(atomByIndex, seg, colorFn, opts)
    if (skin) out.push(skin)
  }
  return out
}

/**
 * @param {Map<number, any>} atomByIndex  Map from atom.index → atom
 * @param {Array<{ ca_index?: number, sec?: string, atom_indices: number[] }>} segResidues
 * @param {(atom: any) => import('three').Color} colorFn
 * @param {TubeOpts} opts
 * @returns {BufferGeometry | null}
 */
function buildSegmentTube(atomByIndex, segResidues, colorFn, opts) {
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
    const ca = atomByIndex.get(res.ca_index)
    caCoords.push(new Vector3(ca.x, ca.y, ca.z))
    secs.push(res.sec || '')
    let oCoord = null
    if (res.atom_indices) {
      for (const idx of res.atom_indices) {
        const at = atomByIndex.get(idx)
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
    const c = colorFn(atomByIndex.get(segResidues[ri].ca_index))
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

  const geom = buildRibbonGeometry(pts, nms, radii, radii, smoothColors, csSides)
  if (!geom) return null
  return allocRibbonSkin(geom, segResidues, atomByIndex, radii, radii, smoothFactor, csSides)
}

// ── Play: move the ribbon without remeshing ───────────────────────────────

/** @type {Map<number, { cos: Float32Array, sin: Float32Array }>} */
const CS_TABLE = new Map()

/** @param {number} S */
function csTable(S) {
  let t = CS_TABLE.get(S)
  if (!t) {
    const cos = new Float32Array(S)
    const sin = new Float32Array(S)
    for (let k = 0; k < S; k++) {
      const a = (2 * Math.PI * k) / S
      cos[k] = Math.cos(a)
      sin[k] = Math.sin(a)
    }
    t = { cos, sin }
    CS_TABLE.set(S, t)
  }
  return t
}

/**
 * @param {import('three').BufferGeometry} geometry
 * @param {Array<{ ca_index?: number, atom_indices?: number[] }>} segResidues
 * @param {Map<number, { name?: string }>} atomByIndex
 * @param {Float32Array} widths
 * @param {Float32Array} thicknesses
 * @param {number} smoothFactor
 * @param {number} csSides
 * @returns {RibbonSkin}
 */
function allocRibbonSkin(geometry, segResidues, atomByIndex, widths, thicknesses, smoothFactor, csSides) {
  const nRes = segResidues.length
  const nSm = widths.length
  const caIndex = new Int32Array(nRes)
  const oIndex = new Int32Array(nRes)
  for (let i = 0; i < nRes; i++) {
    const res = segResidues[i]
    caIndex[i] = typeof res.ca_index === 'number' ? res.ca_index : -1
    let oi = -1
    if (res.atom_indices) {
      for (const idx of res.atom_indices) {
        const at = atomByIndex.get(idx)
        if (at && at.name === 'O') {
          oi = idx
          break
        }
      }
    }
    oIndex[i] = oi
  }
  return {
    geometry,
    caIndex,
    oIndex,
    widths,
    thicknesses,
    smoothFactor,
    csSides,
    nRes,
    nSm,
    ca: new Float32Array(nRes * 3),
    o: new Float32Array(nRes * 3),
    hasO: new Uint8Array(nRes),
    nrm: new Float32Array(nRes * 3),
    smP: new Float32Array(nSm * 3),
    smN: new Float32Array(nSm * 3)
  }
}

/**
 * @param {RibbonSkin} skin
 * @param {Float32Array | null | undefined} xyz
 * @param {Array<{ index?: number, x: number, y: number, z: number }> | null | undefined} atoms
 */
function fillBackbone(skin, xyz, atoms) {
  /** @type {Map<number, { x: number, y: number, z: number }> | null} */
  let byIndex = null
  const needAtoms = !xyz
  if (needAtoms && atoms?.length) {
    byIndex = new Map()
    for (const a of atoms) {
      if (typeof a.index === 'number') byIndex.set(a.index, a)
    }
  }
  for (let i = 0; i < skin.nRes; i++) {
    const o = i * 3
    const ci = skin.caIndex[i]
    if (xyz && ci >= 0 && ci * 3 + 2 < xyz.length) {
      skin.ca[o] = xyz[ci * 3]
      skin.ca[o + 1] = xyz[ci * 3 + 1]
      skin.ca[o + 2] = xyz[ci * 3 + 2]
    } else {
      const a = byIndex?.get(ci)
      skin.ca[o] = a?.x ?? 0
      skin.ca[o + 1] = a?.y ?? 0
      skin.ca[o + 2] = a?.z ?? 0
    }
    const oi = skin.oIndex[i]
    if (oi >= 0) {
      skin.hasO[i] = 1
      if (xyz && oi * 3 + 2 < xyz.length) {
        skin.o[o] = xyz[oi * 3]
        skin.o[o + 1] = xyz[oi * 3 + 1]
        skin.o[o + 2] = xyz[oi * 3 + 2]
      } else {
        const a = byIndex?.get(oi)
        skin.o[o] = a?.x ?? 0
        skin.o[o + 1] = a?.y ?? 0
        skin.o[o + 2] = a?.z ?? 0
      }
    } else {
      skin.hasO[i] = 0
    }
  }
}

/**
 * @param {Float32Array} ca
 * @param {Float32Array} oxy
 * @param {Uint8Array} hasO
 * @param {Float32Array} nrm
 * @param {number} n
 */
function computeRibbonNormalsPacked(ca, oxy, hasO, nrm, n) {
  for (let i = 0; i < n; i++) {
    const o = i * 3
    let tx
    let ty
    let tz
    if (i === 0) {
      tx = ca[3] - ca[0]
      ty = ca[4] - ca[1]
      tz = ca[5] - ca[2]
    } else if (i === n - 1) {
      const a = (n - 1) * 3
      const b = (n - 2) * 3
      tx = ca[a] - ca[b]
      ty = ca[a + 1] - ca[b + 1]
      tz = ca[a + 2] - ca[b + 2]
    } else {
      const p = (i - 1) * 3
      const q = (i + 1) * 3
      tx = ca[q] - ca[p]
      ty = ca[q + 1] - ca[p + 1]
      tz = ca[q + 2] - ca[p + 2]
    }
    const tlen = Math.hypot(tx, ty, tz) || 1
    tx /= tlen
    ty /= tlen
    tz /= tlen

    let cx
    let cy
    let cz
    if (hasO[i]) {
      cx = oxy[o] - ca[o]
      cy = oxy[o + 1] - ca[o + 1]
      cz = oxy[o + 2] - ca[o + 2]
    } else if (Math.abs(tx) < 0.9) {
      cx = 1
      cy = 0
      cz = 0
    } else {
      cx = 0
      cy = 1
      cz = 0
    }
    const dt = cx * tx + cy * ty + cz * tz
    cx -= dt * tx
    cy -= dt * ty
    cz -= dt * tz
    if (cx * cx + cy * cy + cz * cz < 1e-12) {
      if (Math.abs(tx) < 0.9) {
        cx = 1
        cy = 0
        cz = 0
      } else {
        cx = 0
        cy = 1
        cz = 0
      }
      const dt2 = cx * tx + cy * ty + cz * tz
      cx -= dt2 * tx
      cy -= dt2 * ty
      cz -= dt2 * tz
    }
    const nlen = Math.hypot(cx, cy, cz) || 1
    nrm[o] = cx / nlen
    nrm[o + 1] = cy / nlen
    nrm[o + 2] = cz / nlen
  }
  for (let i = 1; i < n; i++) {
    const o = i * 3
    const p = (i - 1) * 3
    if (nrm[o] * nrm[p] + nrm[o + 1] * nrm[p + 1] + nrm[o + 2] * nrm[p + 2] < 0) {
      nrm[o] = -nrm[o]
      nrm[o + 1] = -nrm[o + 1]
      nrm[o + 2] = -nrm[o + 2]
    }
  }
}

/**
 * @param {Float32Array} dest
 * @param {number} di
 * @param {Float32Array} a
 * @param {number} ai
 * @param {Float32Array} b
 * @param {number} bi
 * @param {Float32Array} c
 * @param {number} ci
 * @param {Float32Array} d
 * @param {number} ei
 * @param {number} t
 */
function catmullRomPacked(dest, di, a, ai, b, bi, c, ci, d, ei, t) {
  const tt = t * t
  const ttt = tt * t
  dest[di] =
    0.5 *
    (2 * b[bi] +
      (-a[ai] + c[ci]) * t +
      (2 * a[ai] - 5 * b[bi] + 4 * c[ci] - d[ei]) * tt +
      (-a[ai] + 3 * b[bi] - 3 * c[ci] + d[ei]) * ttt)
  dest[di + 1] =
    0.5 *
    (2 * b[bi + 1] +
      (-a[ai + 1] + c[ci + 1]) * t +
      (2 * a[ai + 1] - 5 * b[bi + 1] + 4 * c[ci + 1] - d[ei + 1]) * tt +
      (-a[ai + 1] + 3 * b[bi + 1] - 3 * c[ci + 1] + d[ei + 1]) * ttt)
  dest[di + 2] =
    0.5 *
    (2 * b[bi + 2] +
      (-a[ai + 2] + c[ci + 2]) * t +
      (2 * a[ai + 2] - 5 * b[bi + 2] + 4 * c[ci + 2] - d[ei + 2]) * tt +
      (-a[ai + 2] + 3 * b[bi + 2] - 3 * c[ci + 2] + d[ei + 2]) * ttt)
}

/**
 * @param {Float32Array} dest
 * @param {number} di
 */
function normalizePacked3(dest, di) {
  const len = Math.hypot(dest[di], dest[di + 1], dest[di + 2]) || 1
  dest[di] /= len
  dest[di + 1] /= len
  dest[di + 2] /= len
}

/**
 * @param {Float32Array} coords
 * @param {Float32Array} normals
 * @param {number} n
 * @param {Float32Array} outP
 * @param {Float32Array} outN
 * @param {number} factor
 */
function smoothCoordsAndNormalsPacked(coords, normals, n, outP, outN, factor) {
  let w = 0
  if (n < 3) {
    for (let i = 0; i < n - 1; i++) {
      const a = i * 3
      const b = (i + 1) * 3
      for (let ti = 0; ti < factor; ti++) {
        const t = ti / factor
        const o = w * 3
        outP[o] = coords[a] + (coords[b] - coords[a]) * t
        outP[o + 1] = coords[a + 1] + (coords[b + 1] - coords[a + 1]) * t
        outP[o + 2] = coords[a + 2] + (coords[b + 2] - coords[a + 2]) * t
        outN[o] = normals[a] + (normals[b] - normals[a]) * t
        outN[o + 1] = normals[a + 1] + (normals[b + 1] - normals[a + 1]) * t
        outN[o + 2] = normals[a + 2] + (normals[b + 2] - normals[a + 2]) * t
        normalizePacked3(outN, o)
        w += 1
      }
    }
    const last = (n - 1) * 3
    const o = w * 3
    outP[o] = coords[last]
    outP[o + 1] = coords[last + 1]
    outP[o + 2] = coords[last + 2]
    outN[o] = normals[last]
    outN[o + 1] = normals[last + 1]
    outN[o + 2] = normals[last + 2]
    return
  }
  for (let i = 0; i < n - 1; i++) {
    const i0 = Math.max(i - 1, 0) * 3
    const i1 = i * 3
    const i2 = Math.min(i + 1, n - 1) * 3
    const i3 = Math.min(i + 2, n - 1) * 3
    for (let ti = 0; ti < factor; ti++) {
      const t = ti / factor
      const o = w * 3
      catmullRomPacked(outP, o, coords, i0, coords, i1, coords, i2, coords, i3, t)
      catmullRomPacked(outN, o, normals, i0, normals, i1, normals, i2, normals, i3, t)
      normalizePacked3(outN, o)
      w += 1
    }
  }
  const last = (n - 1) * 3
  const o = w * 3
  outP[o] = coords[last]
  outP[o + 1] = coords[last + 1]
  outP[o + 2] = coords[last + 2]
  outN[o] = normals[last]
  outN[o + 1] = normals[last + 1]
  outN[o + 2] = normals[last + 2]
}

/**
 * @param {Float32Array} pos
 * @param {Float32Array | null} nrmOut
 * @param {Float32Array} smP
 * @param {Float32Array} smN
 * @param {Float32Array} widths
 * @param {Float32Array} thicknesses
 * @param {number} nSm
 * @param {number} S
 */
function writeRibbonPositions(pos, nrmOut, smP, smN, widths, thicknesses, nSm, S) {
  const { cos: cosA, sin: sinA } = csTable(S)
  for (let i = 0; i < nSm; i++) {
    const p = i * 3
    let tx
    let ty
    let tz
    if (i === 0) {
      tx = smP[3] - smP[0]
      ty = smP[4] - smP[1]
      tz = smP[5] - smP[2]
    } else if (i === nSm - 1) {
      const a = (nSm - 1) * 3
      const b = (nSm - 2) * 3
      tx = smP[a] - smP[b]
      ty = smP[a + 1] - smP[b + 1]
      tz = smP[a + 2] - smP[b + 2]
    } else {
      const a = (i - 1) * 3
      const b = (i + 1) * 3
      tx = smP[b] - smP[a]
      ty = smP[b + 1] - smP[a + 1]
      tz = smP[b + 2] - smP[a + 2]
    }
    const tlen = Math.hypot(tx, ty, tz) || 1
    tx /= tlen
    ty /= tlen
    tz /= tlen
    const nx = smN[p]
    const ny = smN[p + 1]
    const nz = smN[p + 2]
    let bx = ty * nz - tz * ny
    let by = tz * nx - tx * nz
    let bz = tx * ny - ty * nx
    const blenSq = bx * bx + by * by + bz * bz
    if (blenSq < 1e-24) {
      bx = 0
      by = 1
      bz = 0
    } else {
      const blen = Math.sqrt(blenSq)
      bx /= blen
      by /= blen
      bz /= blen
    }
    const w = widths[i]
    const th = thicknesses[i]
    const px = smP[p]
    const py = smP[p + 1]
    const pz = smP[p + 2]
    const base = i * S * 3
    if (w < 0.001 && th < 0.001) {
      for (let k = 0; k < S; k++) {
        const off = base + k * 3
        pos[off] = px
        pos[off + 1] = py
        pos[off + 2] = pz
        if (nrmOut) {
          nrmOut[off] = nx
          nrmOut[off + 1] = ny
          nrmOut[off + 2] = nz
        }
      }
    } else {
      for (let k = 0; k < S; k++) {
        const off = base + k * 3
        const c = cosA[k]
        const s = sinA[k]
        const rx = w * c * nx + th * s * bx
        const ry = w * c * ny + th * s * by
        const rz = w * c * nz + th * s * bz
        pos[off] = px + rx
        pos[off + 1] = py + ry
        pos[off + 2] = pz + rz
        if (nrmOut) {
          const nlen = Math.hypot(rx, ry, rz) || 1
          nrmOut[off] = rx / nlen
          nrmOut[off + 1] = ry / nlen
          nrmOut[off + 2] = rz / nlen
        }
      }
    }
  }
}

/**
 * Rewrite ribbon vertex positions from packed xyz (Cα / O only). Topology stays.
 * @param {RibbonSkin[]} skins
 * @param {Float32Array | null | undefined} xyz
 * @param {Array<{ index?: number, x: number, y: number, z: number }> | null | undefined} [atoms]
 */
export function updateRibbonSkins(skins, xyz, atoms) {
  if (!skins?.length) return
  for (const skin of skins) {
    fillBackbone(skin, xyz, atoms)
    computeRibbonNormalsPacked(skin.ca, skin.o, skin.hasO, skin.nrm, skin.nRes)
    smoothCoordsAndNormalsPacked(skin.ca, skin.nrm, skin.nRes, skin.smP, skin.smN, skin.smoothFactor)
    const posAttr = skin.geometry.getAttribute('position')
    if (!posAttr || !(posAttr.array instanceof Float32Array)) continue
    writeRibbonPositions(
      posAttr.array,
      null,
      skin.smP,
      skin.smN,
      skin.widths,
      skin.thicknesses,
      skin.nSm,
      skin.csSides
    )
    posAttr.needsUpdate = true
    // Face-averaged normals (same as create). Ellipse-offset normals draw a
    // centerline thread; leaving frame-0 normals makes helices flicker under
    // hemisphere / directional lights as the ribbon moves.
    skin.geometry.computeVertexNormals()
  }
}
