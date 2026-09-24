/**
 * Lazy Visualize trajectory cache: LRU of logical-frame xyz + per-view blend.
 * Never stores the whole DCD; callers fetch one frame at a time.
 */

export const TRAJ_SMOOTH_MAX = 8
export const TRAJ_CACHE_MAX_FRAMES = 32
export const TRAJ_CACHE_MAX_BYTES = 512 * 1024 * 1024
export const TRAJ_PREFETCH_PLAY = 8
export const TRAJ_PREFETCH_WARM = 4
export const TRAJ_PLAY_FPS = 30
export const TRAJ_PLAY_MAX_LAG = 6
export const TRAJ_XYZ_HEADER_BYTES = 12
export const GWXY_HEADER_BYTES = 16
export const TRAJ_LOAD_ALL_BYTES_CAP = 4 * 1024 * 1024 * 1024
/** Used when `navigator.deviceMemory` is present and below 8 GB. */
export const TRAJ_LOAD_ALL_BYTES_CAP_LOW_RAM = 1.5 * 1024 * 1024 * 1024
/** One Electron IPC / fs.read stays well under the ~2 GiB clone and OS limit. */
export const TRAJ_SIDECAR_SLICE_MAX = 256 * 1024 * 1024

/**
 * True when Space / arrows should not drive the trajectory playhead.
 * @param {EventTarget | null | undefined} el
 */
export function isTrajHotkeyBlocked(el) {
  if (!el || typeof el !== 'object') return false
  const node = /** @type {HTMLElement} */ (el)
  const tag = node.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (node.isContentEditable) return true
  if (typeof node.closest === 'function' && node.closest('dialog[open]')) return true
  return false
}

/**
 * @param {number} atomCount
 * @param {number} frameCount
 * @param {number} [cap]
 */
export function loadAllFits(atomCount, frameCount, cap = TRAJ_LOAD_ALL_BYTES_CAP) {
  return Math.max(0, Math.trunc(atomCount)) * Math.max(0, Math.trunc(frameCount)) * 12 <= cap
}

/**
 * User Settings cap (GiB) wins when provided. Otherwise 4 GiB, or 1.5 GiB when
 * the browser reports under 8 GB of device memory. `userGib` 0 means always stream.
 * @param {number | undefined | null} deviceMemoryGb
 * @param {number | undefined | null} [userGib]
 */
export function trajLoadAllBytesCap(deviceMemoryGb, userGib) {
  if (userGib != null && Number.isFinite(Number(userGib))) {
    return Math.max(0, Number(userGib)) * 1024 * 1024 * 1024
  }
  const gb = Number(deviceMemoryGb)
  if (Number.isFinite(gb) && gb > 0 && gb < 8) return TRAJ_LOAD_ALL_BYTES_CAP_LOW_RAM
  return TRAJ_LOAD_ALL_BYTES_CAP
}

/**
 * Play needs a finished sidecar and a finished adopt (preload or streaming).
 * Streaming from `.gwxyz.part` races the extract rename.
 * @param {{ complete?: boolean, error?: string | null } | null | undefined} info
 * @param {{ adoptPending?: boolean, framesReady?: boolean } | null | undefined} [extra]
 */
export function trajPlayReady(info, extra = {}) {
  if (!info || typeof info !== 'object') return false
  if (info.error) return false
  if (!info.complete) return false
  if (extra?.adoptPending) return false
  if (extra && extra.framesReady === false) return false
  return true
}

/**
 * @param {ArrayBuffer | ArrayBufferView | null | undefined} buf
 */
function asUint8(buf) {
  if (!buf) return new Uint8Array(0)
  if (buf instanceof Uint8Array) return buf
  if (buf instanceof ArrayBuffer) return new Uint8Array(buf)
  if (ArrayBuffer.isView(buf)) {
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  }
  return new Uint8Array(0)
}

/**
 * Copy a view into a standalone ArrayBuffer (IPC buffers are often slices).
 * @param {ArrayBuffer | ArrayBufferView | null | undefined} buf
 */
function toArrayBuffer(buf) {
  const view = asUint8(buf)
  if (!view.byteLength) return new ArrayBuffer(0)
  if (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) {
    return view.buffer
  }
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
}

/**
 * Read a sidecar range as one buffer. Requests larger than `maxSlice` are
 * concatenated so a 2 GB+ movie does not go through a single IPC.
 * @param {(path: string, offset: number, length: number) => Promise<ArrayBuffer | ArrayBufferView>} readSlice
 * @param {string} path
 * @param {number} offset
 * @param {number} length
 * @param {number} [maxSlice]
 * @param {{ yieldBetween?: boolean, onProgress?: (chunk: number, total: number) => void }} [extra]
 */
export async function concatSidecarSlices(
  readSlice,
  path,
  offset,
  length,
  maxSlice = TRAJ_SIDECAR_SLICE_MAX,
  extra = {}
) {
  const start = Math.max(0, Math.trunc(Number(offset) || 0))
  const size = Math.max(0, Math.trunc(Number(length) || 0))
  if (!path || size < 1) return new ArrayBuffer(0)
  const cap = Math.max(1, Math.trunc(Number(maxSlice) || 0) || TRAJ_SIDECAR_SLICE_MAX)
  const yieldBetween = extra.yieldBetween !== false
  const onProgress = extra.onProgress
  if (size <= cap) {
    onProgress?.(1, 1)
    return toArrayBuffer(await readSlice(path, start, size))
  }
  const out = new Uint8Array(size)
  const total = Math.ceil(size / cap)
  let off = 0
  let chunk = 0
  while (off < size) {
    const n = Math.min(cap, size - off)
    const view = asUint8(await readSlice(path, start + off, n))
    const take = Math.min(n, view.byteLength)
    if (take < 1) break
    out.set(view.subarray(0, take), off)
    off += take
    chunk += 1
    onProgress?.(chunk, total)
    if (take < n) break
    if (yieldBetween && off < size) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  return off === size ? out.buffer : out.buffer.slice(0, off)
}

/**
 * Split one contiguous xyz blob into per-frame views. The views share `buffer`.
 * @param {ArrayBuffer} buffer
 * @param {number} nAtoms
 * @param {number} count
 * @returns {Float32Array[]}
 */
export function splitPackedFrames(buffer, nAtoms, count) {
  const stride = Math.max(0, Math.trunc(nAtoms)) * 3
  const n = Math.max(0, Math.trunc(count))
  if (!buffer || stride < 1 || n < 1) return []
  const available = Math.floor(buffer.byteLength / 4 / stride)
  const frames = Math.min(n, available)
  if (frames < 1) return []
  const floats = new Float32Array(buffer, 0, frames * stride)
  const out = /** @type {Float32Array[]} */ ([])
  for (let i = 0; i < frames; i++) {
    out.push(floats.subarray(i * stride, (i + 1) * stride))
  }
  return out
}

/**
 * Translation + scale instance matrix (identity rotation), column-major.
 * @param {Float32Array} dest
 * @param {number} index
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} sx
 * @param {number} [sy]
 * @param {number} [sz]
 */
export function writeInstanceTranslationScale(dest, index, x, y, z, sx, sy = sx, sz = sx) {
  const o = index * 16
  dest[o] = sx
  dest[o + 1] = 0
  dest[o + 2] = 0
  dest[o + 3] = 0
  dest[o + 4] = 0
  dest[o + 5] = sy
  dest[o + 6] = 0
  dest[o + 7] = 0
  dest[o + 8] = 0
  dest[o + 9] = 0
  dest[o + 10] = sz
  dest[o + 11] = 0
  dest[o + 12] = x
  dest[o + 13] = y
  dest[o + 14] = z
  dest[o + 15] = 1
}

/** Same atom-list object → same Int32Array, so play blends can share a cache slot. */
const atomIndexIntern = new WeakMap()

/**
 * @param {Array<{ index?: number }> | null | undefined} atoms
 * @returns {Int32Array | null}
 */
export function collectAtomIndices(atoms) {
  if (!atoms?.length) return null
  const cached = atomIndexIntern.get(atoms)
  if (cached !== undefined) return cached
  const out = []
  for (const a of atoms) {
    if (typeof a.index === 'number') out.push(a.index)
  }
  const result = out.length ? Int32Array.from(out) : null
  atomIndexIntern.set(atoms, result)
  return result
}

/**
 * @param {Array<Int32Array | number[] | null | undefined>} parts
 * @returns {Int32Array | null}
 */
export function unionAtomIndices(parts) {
  const set = new Set()
  for (const p of parts) {
    if (!p?.length) continue
    for (let i = 0; i < p.length; i++) set.add(p[i])
  }
  if (!set.size) return null
  return Int32Array.from(set)
}

export function writePointPositions(dest, atoms, xyz, indexOrder) {
  const n = atoms.length
  const need = n * 3
  if (xyz && xyz.length >= need && indexOrder) {
    dest.set(xyz.length === need ? xyz : xyz.subarray(0, need))
    return
  }
  for (let i = 0; i < n; i++) {
    const atom = atoms[i]
    const base = typeof atom?.index === 'number' ? atom.index * 3 : i * 3
    const o = i * 3
    if (xyz && base >= 0 && base + 2 < xyz.length) {
      dest[o] = xyz[base]
      dest[o + 1] = xyz[base + 1]
      dest[o + 2] = xyz[base + 2]
    } else {
      dest[o] = atom?.x ?? 0
      dest[o + 1] = atom?.y ?? 0
      dest[o + 2] = atom?.z ?? 0
    }
  }
}

/**
 * Skip the 16-byte GWXY header and return one packed xyz array for all frames.
 * @param {ArrayBuffer | ArrayBufferView} buffer
 * @param {number} atomCount
 * @param {number} frameCount
 * @returns {Float32Array}
 */
export function gwxyzToAllFrames(buffer, atomCount, frameCount) {
  const bytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const nAtoms = Math.max(0, Math.trunc(atomCount))
  const nFrames = Math.max(0, Math.trunc(frameCount))
  const stride = nAtoms * 3
  const need = GWXY_HEADER_BYTES + nFrames * stride * 4
  if (!nAtoms || !nFrames || bytes.byteLength < need) return new Float32Array(0)
  return new Float32Array(bytes.buffer, bytes.byteOffset + GWXY_HEADER_BYTES, nFrames * stride)
}

/**
 * @param {ArrayBuffer | ArrayBufferView} buffer
 * @returns {{
 *   selection: string,
 *   reference_frame: number,
 *   n_mobile: number,
 *   n_frames: number,
 *   rmsd: number[],
 *   affines: Float32Array
 * }}
 */
export function decodeAlignBinary(buffer) {
  const bytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
  if (magic !== 'GWAL') throw new Error('Not a GWAL alignment payload')
  const nFrames = view.getUint32(8, true)
  const nMobile = view.getUint32(12, true)
  const ref = view.getUint32(16, true)
  const selLen = view.getUint32(20, true)
  const sel = new TextDecoder().decode(bytes.subarray(24, 24 + selLen))
  let headerLen = 24 + selLen
  headerLen += (8 - (headerLen % 8)) % 8
  const rmsd = Array.from(new Float64Array(bytes.buffer, bytes.byteOffset + headerLen, nFrames))
  const affines = new Float32Array(
    bytes.buffer,
    bytes.byteOffset + headerLen + nFrames * 8,
    nFrames * 12
  ).slice()
  return {
    selection: sel,
    reference_frame: ref,
    n_mobile: nMobile,
    n_frames: nFrames,
    rmsd,
    affines
  }
}

/**
 * Read atom xyz from a packed play buffer, else the atom object.
 * @param {{ index?: number, x: number, y: number, z: number }} atom
 * @param {Float32Array | null | undefined} xyz
 * @returns {{ x: number, y: number, z: number }}
 */
export function readAtomXyz(atom, xyz) {
  if (xyz && typeof atom.index === 'number') {
    const o = atom.index * 3
    if (o + 2 < xyz.length) {
      return { x: xyz[o], y: xyz[o + 1], z: xyz[o + 2] }
    }
  }
  return atom
}

/**
 * Copy current packed xyz onto an atom snapshot (labels / measurements / picks).
 * @param {{ index?: number, x: number, y: number, z: number }} atom
 * @param {Float32Array | null | undefined} xyz
 */
export function atomWithPackedXyz(atom, xyz) {
  if (!atom) return atom
  const p = readAtomXyz(atom, xyz)
  if (p === atom || (p.x === atom.x && p.y === atom.y && p.z === atom.z)) return atom
  return { ...atom, x: p.x, y: p.y, z: p.z }
}

/**
 * @param {Array<{ atom?: object }>} labels
 * @param {Float32Array | null | undefined} xyz
 */
export function labelsWithPackedXyz(labels, xyz) {
  if (!xyz || !labels?.length) return labels
  return labels.map((l) => ({ ...l, atom: atomWithPackedXyz(l.atom, xyz) }))
}

/**
 * @param {Array<{ atoms?: object[] }>} measurements
 * @param {Float32Array | null | undefined} xyz
 */
export function measurementsWithPackedXyz(measurements, xyz) {
  if (!xyz || !measurements?.length) return measurements
  return measurements.map((m) => ({
    ...m,
    atoms: (m.atoms || []).map((a) => atomWithPackedXyz(a, xyz))
  }))
}

/**
 * @param {unknown} level
 * @returns {number}
 */
export function clampTrajSmooth(level) {
  const n = Number(level)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(TRAJ_SMOOTH_MAX, n))
}

/**
 * Traj-smooth hydrogen restore defaults on. Only an explicit ``false`` keeps the
 * Cartesian XYZ average (VMD-style collapse).
 * @param {unknown} flag
 */
export function trajSmoothRestoreHEnabled(flag) {
  return flag !== false
}

/**
 * @param {{ element?: string, name?: string, atom?: string } | null | undefined} atom
 */
export function isHydrogenAtom(atom) {
  const el = String(atom?.element ?? '')
    .trim()
    .toUpperCase()
  if (el === 'H' || el === 'D') return true
  if (el) return false
  const name = String(atom?.name ?? atom?.atom ?? '')
    .trim()
    .toUpperCase()
  return name.charAt(0) === 'H'
}

/**
 * @param {Array<{ path?: string, stride?: number }> | null | undefined} files
 * @returns {Record<string, number>}
 */
export function fileStridesFromFiles(files) {
  /** @type {Record<string, number>} */
  const out = {}
  for (const f of files || []) {
    const name = String(f.path || '')
      .split(/[/\\]/)
      .pop()
    if (!name) continue
    out[name] = Math.max(1, Math.round(Number(f.stride) || 1))
  }
  return out
}

/**
 * @param {{ x?: number[], y?: number[], z?: number[], atom_count?: number }} payload
 * @returns {Float32Array}
 */
export function xyzColumnarToFloat32(payload) {
  if (payload?.atoms_format === 'xyz_f32' || payload?.xyz_b64) {
    const frames = xyzPackedToFrames(payload)
    return frames[0] ?? new Float32Array(0)
  }
  const x = payload?.x
  const y = payload?.y
  const z = payload?.z
  const n = payload?.atom_count ?? x?.length ?? 0
  const out = new Float32Array(n * 3)
  if (!x || !y || !z) return out
  for (let i = 0; i < n; i++) {
    const o = i * 3
    out[o] = x[i]
    out[o + 1] = y[i]
    out[o + 2] = z[i]
  }
  return out
}

/**
 * Decode little-endian float32 xyz from ``xyz_b64`` (one or more frames).
 * @param {{ xyz_b64?: string, atom_count?: number, count?: number }} payload
 * @returns {Float32Array[]}
 */
export function xyzPackedToFrames(payload) {
  const b64 = payload?.xyz_b64
  const nAtoms = Math.max(0, Math.trunc(payload?.atom_count ?? 0))
  if (!b64 || !nAtoms) return []
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const all = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4))
  const stride = nAtoms * 3
  const inferred = Math.floor(all.length / stride) || 1
  const count = Math.max(1, Math.trunc(payload.count ?? inferred))
  /** @type {Float32Array[]} */
  const out = []
  for (let i = 0; i < count; i++) {
    const start = i * stride
    if (start + stride > all.length) break
    out.push(all.slice(start, start + stride))
  }
  return out
}

/**
 * Decode `/trajectory/xyz` payload: uint32 atom_count, start, count + float32 xyz.
 * @param {ArrayBuffer | ArrayBufferView} buffer
 * @returns {Float32Array[]}
 */
export function xyzBinaryToFrames(buffer) {
  const bytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  if (bytes.byteLength < TRAJ_XYZ_HEADER_BYTES) return []
  const header = new DataView(bytes.buffer, bytes.byteOffset, TRAJ_XYZ_HEADER_BYTES)
  const nAtoms = header.getUint32(0, true)
  const count = header.getUint32(8, true)
  const stride = nAtoms * 3
  if (!nAtoms || !count || stride <= 0) return []
  const need = TRAJ_XYZ_HEADER_BYTES + count * stride * 4
  if (bytes.byteLength < need) return []
  const floats = new Float32Array(bytes.buffer, bytes.byteOffset + TRAJ_XYZ_HEADER_BYTES, count * stride)
  /** @type {Float32Array[]} */
  const out = []
  for (let i = 0; i < count; i++) {
    out.push(floats.slice(i * stride, (i + 1) * stride))
  }
  return out
}

/**
 * Play clock: frame index (may be fractional) after ``elapsedMs``.
 * @param {number} elapsedMs
 * @param {number} startFrame
 * @param {number} fps
 * @param {number} frameCount
 */
export function playTargetFrame(elapsedMs, startFrame, fps, frameCount) {
  const n = Math.max(0, Math.trunc(frameCount))
  if (n <= 0) return 0
  const last = n - 1
  const f = Number(startFrame) + (Math.max(0, Number(elapsedMs) || 0) / 1000) * (fps || TRAJ_PLAY_FPS)
  if (!Number.isFinite(f)) return Math.max(0, Math.min(last, Number(startFrame) || 0))
  return Math.max(0, Math.min(last, f))
}

/**
 * Video-style display pick: show the target if cached, else the latest ready
 * frame within ``TRAJ_PLAY_MAX_LAG``, else hold the last displayed frame.
 * @param {number} target
 * @param {number} frameCount
 * @param {(frame: number) => boolean} hasFrame
 * @param {number | null | undefined} lastDisplayed
 * @returns {{ frame: number, hold: boolean, missing: boolean }}
 */
export function pickDisplayFrame(target, frameCount, hasFrame, lastDisplayed = null) {
  const n = Math.max(0, Math.trunc(frameCount))
  if (n <= 0) return { frame: 0, hold: true, missing: true }
  const want = Math.max(0, Math.min(n - 1, Math.round(Number(target) || 0)))
  if (hasFrame(want)) return { frame: want, hold: false, missing: false }
  const lo = Math.max(0, want - TRAJ_PLAY_MAX_LAG)
  for (let i = want - 1; i >= lo; i--) {
    if (hasFrame(i)) return { frame: i, hold: false, missing: false }
  }
  if (lastDisplayed != null && hasFrame(Math.trunc(lastDisplayed))) {
    return { frame: Math.trunc(lastDisplayed), hold: true, missing: false }
  }
  return { frame: want, hold: true, missing: true }
}

/**
 * 12-number affine (9 row-major R + 3 t) for a logical frame.
 * Works with Float32Array or a plain array (Svelte $state may wrap typed arrays).
 * @param {ArrayLike<number> | null | undefined} affines
 * @param {number} frame
 * @returns {ArrayLike<number> | null}
 */
export function readAffine12(affines, frame) {
  if (!affines || affines.length < 12) return null
  const i = Math.max(0, Math.trunc(Number(frame) || 0))
  const off = i * 12
  if (off + 12 > affines.length) return null
  if (typeof /** @type {{ subarray?: Function }} */ (affines).subarray === 'function') {
    return /** @type {{ subarray: (a: number, b: number) => ArrayLike<number> }} */ (
      affines
    ).subarray(off, off + 12)
  }
  return Array.prototype.slice.call(affines, off, off + 12)
}

/**
 * Apply ``x' = x @ R + t`` (affine is 9 row-major R + 3 t). Never mutates ``xyz``.
 * @param {Float32Array} xyz
 * @param {ArrayLike<number>} affine
 * @param {Float32Array | null} [out]
 * @returns {Float32Array}
 */
export function applyRigidXyz(xyz, affine, out = null) {
  const dest = out && out !== xyz && out.length === xyz.length ? out : new Float32Array(xyz.length)
  const r00 = Number(affine[0]) || 0
  const r01 = Number(affine[1]) || 0
  const r02 = Number(affine[2]) || 0
  const r10 = Number(affine[3]) || 0
  const r11 = Number(affine[4]) || 0
  const r12 = Number(affine[5]) || 0
  const r20 = Number(affine[6]) || 0
  const r21 = Number(affine[7]) || 0
  const r22 = Number(affine[8]) || 0
  const t0 = Number(affine[9]) || 0
  const t1 = Number(affine[10]) || 0
  const t2 = Number(affine[11]) || 0
  for (let i = 0; i < xyz.length; i += 3) {
    const x = xyz[i]
    const y = xyz[i + 1]
    const z = xyz[i + 2]
    dest[i] = x * r00 + y * r10 + z * r20 + t0
    dest[i + 1] = x * r01 + y * r11 + z * r21 + t1
    dest[i + 2] = x * r02 + y * r12 + z * r22 + t2
  }
  return dest
}

/**
 * @param {Array<{ index?: number, x: number, y: number, z: number }>} atoms
 * @param {Float32Array} xyz
 */
export function applyXyzFloat32ToAtoms(atoms, xyz) {
  if (!atoms?.length || !xyz?.length) return
  for (const a of atoms) {
    const i = a.index
    if (typeof i !== 'number') continue
    const o = i * 3
    if (o + 2 >= xyz.length) continue
    a.x = xyz[o]
    a.y = xyz[o + 1]
    a.z = xyz[o + 2]
  }
}

/**
 * Gaussian weights over [f − L, f + L]. Level 0 is a single snapped frame.
 * @param {number} playhead
 * @param {number} level
 * @param {number} frameCount
 * @returns {Array<[number, number]>}
 */
export function blendWeights(playhead, level, frameCount) {
  const n = Math.max(0, Math.trunc(frameCount))
  if (n <= 0) return []
  const L = clampTrajSmooth(level)
  const f = Math.max(0, Math.min(n - 1, Number(playhead) || 0))
  if (L <= 0) {
    return [[Math.max(0, Math.min(n - 1, Math.round(f))), 1]]
  }
  const sigma = Math.max(0.35, L / 2)
  const lo = Math.max(0, Math.floor(f - L))
  const hi = Math.min(n - 1, Math.ceil(f + L))
  /** @type {Array<[number, number]>} */
  const pairs = []
  let sum = 0
  for (let i = lo; i <= hi; i++) {
    const d = (i - f) / sigma
    const w = Math.exp(-0.5 * d * d)
    if (w < 1e-6) continue
    pairs.push([i, w])
    sum += w
  }
  if (!pairs.length || sum <= 0) return [[Math.max(0, Math.min(n - 1, Math.round(f))), 1]]
  return pairs.map(([i, w]) => /** @type {[number, number]} */ ([i, w / sum]))
}

/**
 * Orthorhombic unit-cell lengths, or null when PBC unwrap must not run.
 * @param {unknown} box
 * @returns {[number, number, number] | null}
 */
export function parseBoxLengths(box) {
  if (!Array.isArray(box) && !(box instanceof Float32Array) && !(box instanceof Float64Array)) {
    return null
  }
  const lx = Number(box[0])
  const ly = Number(box[1])
  const lz = Number(box[2])
  if (!(lx > 0) || !(ly > 0) || !(lz > 0)) return null
  if (![lx, ly, lz].every((v) => Number.isFinite(v))) return null
  return [lx, ly, lz]
}

/**
 * Periodic shortest delta along one axis (any number of wraps).
 * @param {number} delta
 * @param {number} length
 */
export function minImageDelta(delta, length) {
  if (!(length > 0) || !Number.isFinite(delta)) return delta
  return delta - length * Math.round(delta / length)
}

/**
 * Place every atom of ``src`` in the same periodic image as ``ref``.
 * Never mutates ``src`` or ``ref``.
 * @param {Float32Array} src
 * @param {Float32Array} ref
 * @param {[number, number, number] | null | undefined} box
 * @param {Float32Array | null} [out]
 * @returns {Float32Array}
 */
export function unwrapXyzOntoRef(src, ref, box, out = null, indices = null) {
  const dest = out && out !== src && out !== ref && out.length === src.length ? out : new Float32Array(src.length)
  const parsed = parseBoxLengths(box)
  if (!parsed || src.length !== ref.length) {
    if (dest !== src) dest.set(src)
    return dest
  }
  const [lx, ly, lz] = parsed
  if (indices && indices.length) {
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k] * 3
      dest[i] = ref[i] + minImageDelta(src[i] - ref[i], lx)
      dest[i + 1] = ref[i + 1] + minImageDelta(src[i + 1] - ref[i + 1], ly)
      dest[i + 2] = ref[i + 2] + minImageDelta(src[i + 2] - ref[i + 2], lz)
    }
    return dest
  }
  for (let i = 0; i < src.length; i += 3) {
    dest[i] = ref[i] + minImageDelta(src[i] - ref[i], lx)
    dest[i + 1] = ref[i + 1] + minImageDelta(src[i + 1] - ref[i + 1], ly)
    dest[i + 2] = ref[i + 2] + minImageDelta(src[i + 2] - ref[i + 2], lz)
  }
  return dest
}

/**
 * Minimum-image unwrap vs the previous blended xyz (any number of box hops).
 * @param {Float32Array | null | undefined} prev
 * @param {Float32Array} next
 * @param {[number, number, number] | null | undefined} box
 * @returns {Float32Array}
 */
export function applyMinImageStep(prev, next, box) {
  if (!prev || !parseBoxLengths(box) || prev.length !== next.length) return next
  return unwrapXyzOntoRef(next, prev, box)
}

/**
 * Heaviest-weight ready frame; ties keep the first in ``weights`` order.
 * @param {Array<[Float32Array, number]>} ready
 * @returns {Float32Array}
 */
function heaviestReadyXyz(ready) {
  let best = ready[0][0]
  let bestW = ready[0][1]
  for (let i = 1; i < ready.length; i++) {
    if (ready[i][1] > bestW) {
      best = ready[i][0]
      bestW = ready[i][1]
    }
  }
  return best
}

/**
 * Weighted sum of cached frames. Missing slots fall back to the nearest ready frame.
 * With ``box``, each neighbor is unwrapped onto the heaviest-weight frame before averaging
 * so a wrap (e.g. x≈0 and x≈L) interpolates at the boundary, not the box center.
 * @param {Map<number, Float32Array>} frames
 * @param {Array<[number, number]>} weights
 * @param {number} nAtoms
 * @param {Float32Array | null} [fallback]
 * @param {[number, number, number] | null} [box]
 * @returns {Float32Array | null}
 */
export function blendCachedXyz(frames, weights, nAtoms, fallback = null, box = null, opts = null) {
  const n = Math.max(0, Math.trunc(nAtoms))
  if (n <= 0 || !weights.length) return fallback
  /** @type {Array<[Float32Array, number]>} */
  const ready = []
  let wsum = 0
  for (const [idx, w] of weights) {
    const xyz = frames.get(idx)
    if (!xyz || xyz.length < n * 3) continue
    ready.push([xyz, w])
    wsum += w
  }
  if (!ready.length) {
    if (fallback) return fallback
    for (const [idx] of weights) {
      const xyz = frames.get(idx)
      if (xyz && xyz.length >= n * 3) return xyz
    }
    return null
  }
  if (ready.length === 1 || wsum <= 0) return ready[0][0]
  const parsed = parseBoxLengths(box)
  const ref = parsed ? heaviestReadyXyz(ready) : null
  const nFloats = n * 3
  const destIn = opts?.out instanceof Float32Array ? opts.out : null
  const indices = opts?.indices?.length ? opts.indices : null
  let out = destIn && destIn.length === nFloats ? destIn : new Float32Array(nFloats)
  for (const [xyz] of ready) {
    if (xyz === out) {
      out = new Float32Array(nFloats)
      break
    }
  }
  if (indices) {
    for (let k = 0; k < indices.length; k++) {
      const o = indices[k] * 3
      out[o] = 0
      out[o + 1] = 0
      out[o + 2] = 0
    }
  } else if (out === destIn) {
    out.fill(0)
  }
  const inv = 1 / wsum
  const scratchIn = opts?.scratch instanceof Float32Array ? opts.scratch : null
  const scratch =
    parsed && scratchIn && scratchIn.length === nFloats && scratchIn !== out
      ? scratchIn
      : parsed
        ? new Float32Array(nFloats)
        : null
  for (const [xyz, w] of ready) {
    const s = w * inv
    const src =
      parsed && ref && xyz !== ref ? unwrapXyzOntoRef(xyz, ref, parsed, scratch, indices) : xyz
    if (indices) {
      for (let k = 0; k < indices.length; k++) {
        const o = indices[k] * 3
        out[o] += src[o] * s
        out[o + 1] += src[o + 1] * s
        out[o + 2] += src[o + 2] * s
      }
    } else {
      for (let i = 0; i < out.length; i++) out[i] += src[i] * s
    }
  }
  return out
}

/**
 * First bonded heavy parent for each hydrogen (``-1`` if none). Indexed by
 * atom ``index`` (or array position when ``index`` is missing).
 * @param {Array<{ index?: number, element?: string, name?: string }> | null | undefined} atoms
 * @param {Array<[number, number] | [number, number, number]> | null | undefined} bonds
 * @returns {Int32Array}
 */
export function buildHydrogenParentMap(atoms, bonds) {
  if (!atoms?.length) return new Int32Array(0)
  let maxIdx = atoms.length - 1
  for (const a of atoms) {
    if (typeof a.index === 'number' && a.index > maxIdx) maxIdx = a.index
  }
  const n = maxIdx + 1
  const parents = new Int32Array(n)
  parents.fill(-1)
  if (!bonds?.length) return parents
  const isH = new Uint8Array(n)
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i]
    const idx = typeof a.index === 'number' ? a.index : i
    if (idx < 0 || idx >= n) continue
    if (isHydrogenAtom(a)) isH[idx] = 1
  }
  for (const raw of bonds) {
    if (!raw || raw.length < 2) continue
    const i = Number(raw[0])
    const j = Number(raw[1])
    if (!Number.isFinite(i) || !Number.isFinite(j)) continue
    if (i < 0 || j < 0 || i >= n || j >= n) continue
    if (isH[i] && !isH[j] && parents[i] < 0) parents[i] = j
    else if (isH[j] && !isH[i] && parents[j] < 0) parents[j] = i
  }
  return parents
}

/**
 * Place each hydrogen on its smoothed parent using a weighted mean of C→H
 * unit vectors and bond lengths from the same window. Mutates ``out``.
 * @param {Float32Array} out
 * @param {Map<number, Float32Array>} frames
 * @param {Array<[number, number]>} weights
 * @param {Int32Array | ArrayLike<number>} parents
 * @param {{ indices?: Int32Array | number[] | null }} [extra]
 * @returns {Float32Array}
 */
export function restoreHydrogensAfterBlend(out, frames, weights, parents, extra = {}) {
  if (!out || !parents?.length || !weights?.length || !frames?.size) return out
  const n = Math.floor(out.length / 3)
  if (n < 1) return out
  const indices = extra.indices?.length ? extra.indices : null

  /**
   * @param {number} h
   */
  function place(h) {
    if (h < 0 || h >= n || h >= parents.length) return
    const p = parents[h]
    if (p < 0 || p >= n) return
    if (indices) {
      let hasP = false
      for (let k = 0; k < indices.length; k++) {
        if (indices[k] === p) {
          hasP = true
          break
        }
      }
      if (!hasP) return
    }
    let dx = 0
    let dy = 0
    let dz = 0
    let len = 0
    let wsum = 0
    for (const [idx, w] of weights) {
      const xyz = frames.get(idx)
      if (!xyz) continue
      const ho = h * 3
      const po = p * 3
      if (ho + 2 >= xyz.length || po + 2 >= xyz.length) continue
      const vx = xyz[ho] - xyz[po]
      const vy = xyz[ho + 1] - xyz[po + 1]
      const vz = xyz[ho + 2] - xyz[po + 2]
      const d = Math.hypot(vx, vy, vz)
      if (!(d > 1e-8)) continue
      const inv = 1 / d
      dx += vx * inv * w
      dy += vy * inv * w
      dz += vz * inv * w
      len += d * w
      wsum += w
    }
    if (!(wsum > 0)) return
    dx /= wsum
    dy /= wsum
    dz /= wsum
    len /= wsum
    const mag = Math.hypot(dx, dy, dz)
    if (!(mag > 1e-8) || !(len > 1e-8)) return
    const s = len / mag
    const po = p * 3
    const ho = h * 3
    out[ho] = out[po] + dx * s
    out[ho + 1] = out[po + 1] + dy * s
    out[ho + 2] = out[po + 2] + dz * s
  }

  if (indices) {
    for (let k = 0; k < indices.length; k++) place(indices[k])
  } else {
    const lim = Math.min(parents.length, n)
    for (let h = 0; h < lim; h++) {
      if (parents[h] >= 0) place(h)
    }
  }
  return out
}

/**
 * @param {Array<{ index?: number, x: number, y: number, z: number }>} atoms
 * @param {Float32Array} xyz
 * @param {object[]} [reuse]
 * @returns {object[]}
 */
export function applyBlendToViewAtoms(atoms, xyz, reuse = undefined) {
  const n = atoms.length
  const out = reuse && reuse.length === n ? reuse : new Array(n)
  for (let i = 0; i < n; i++) {
    const a = atoms[i]
    const idx = typeof a.index === 'number' ? a.index : i
    const o = idx * 3
    if (o + 2 >= xyz.length) {
      out[i] = a
      continue
    }
    const x = xyz[o]
    const y = xyz[o + 1]
    const z = xyz[o + 2]
    const slot = out[i]
    if (slot && slot !== a && slot.index === a.index) {
      slot.x = x
      slot.y = y
      slot.z = z
      continue
    }
    if (a.x === x && a.y === y && a.z === z) {
      out[i] = a
      continue
    }
    out[i] = { ...a, x, y, z }
  }
  return out
}

/**
 * @param {{
 *   fetchFrame: (logical: number) => Promise<Float32Array>
 *   fetchFrames?: (start: number, count: number) => Promise<Float32Array[]>
 *   nAtoms: number
 *   logicalFrameCount: number
 *   maxFrames?: number
 *   maxBytes?: number
 *   preloadAll?: Float32Array | null
 *   box?: [number, number, number] | null
 * }} opts
 */
export function createTrajectoryFrameCache(opts) {
  const nAtoms = Math.max(0, Math.trunc(opts.nAtoms))
  const frameCount = Math.max(0, Math.trunc(opts.logicalFrameCount))
  const bytesPerFrame = Math.max(1, nAtoms * 3 * 4)
  const maxBytes = opts.maxBytes ?? TRAJ_CACHE_MAX_BYTES
  const maxFrames = Math.max(
    2,
    Math.min(opts.maxFrames ?? TRAJ_CACHE_MAX_FRAMES, Math.floor(maxBytes / bytesPerFrame) || 2)
  )

  /** @type {Float32Array | null} */
  let preloadRaw = opts.preloadAll ?? null
  /** @type {Float32Array | null} */
  let preloadAll = opts.preloadAll ?? null
  /** @type {((frame: number, xyz: Float32Array) => Float32Array) | null} */
  let frameXform = null
  let xformBaked = false
  /** @type {[number, number, number] | null} */
  let pbcBox = parseBoxLengths(opts.box)
  /** @type {Int32Array | null} */
  let hydrogenParents = null
  /** @type {Float32Array | null} */
  let unwrapScratch = null
  /** @type {Float32Array[]} */
  let unwrapPool = []
  let unwrapPoolUsed = 0
  /** @type {Map<number, Float32Array>} */
  const frames = new Map()
  /** @type {number[]} */
  const lru = []
  /** @type {Map<number, Promise<Float32Array | null>>} */
  const inflight = new Map()
  /** @type {Promise<void> | null} */
  let prefetchInflight = null
  let token = 0

  /**
   * @param {Float32Array | null} packed
   * @param {number} frame
   * @returns {Float32Array | undefined}
   */
  function subarrayFrame(packed, frame) {
    if (!packed || nAtoms <= 0) return undefined
    const stride = nAtoms * 3
    const start = Math.trunc(frame) * stride
    if (start >= 0 && start + stride <= packed.length) {
      return packed.subarray(start, start + stride)
    }
    return undefined
  }

  /**
   * Unaligned coordinates (wraps as stored in the trajectory).
   * @param {number} frame
   * @returns {Float32Array | undefined}
   */
  function rawFrameAt(frame) {
    const packed = preloadRaw ?? (xformBaked ? null : preloadAll)
    const fromPacked = subarrayFrame(packed, frame)
    if (fromPacked) return fromPacked
    return frames.get(Math.trunc(frame))
  }

  /**
   * @param {number} frame
   * @returns {Float32Array | undefined}
   */
  function frameAt(frame) {
    if (xformBaked) {
      const baked = subarrayFrame(preloadAll, frame)
      if (baked) return baked
    }
    const raw = rawFrameAt(frame)
    if (!raw || !frameXform) return raw
    return frameXform(Math.trunc(frame), raw)
  }

  function unwrapBuf() {
    const n = nAtoms * 3
    if (!unwrapScratch || unwrapScratch.length !== n) unwrapScratch = new Float32Array(n)
    return unwrapScratch
  }

  /** @param {Float32Array} src */
  function unwrapCopy(src) {
    const n = src.length
    let buf = unwrapPool[unwrapPoolUsed]
    if (!buf || buf.length !== n) {
      buf = new Float32Array(n)
      unwrapPool[unwrapPoolUsed] = buf
    }
    buf.set(src)
    unwrapPoolUsed += 1
    return buf
  }

  /**
   * @param {Float32Array} packed
   * @param {(frame: number, xyz: Float32Array) => Float32Array} fn
   */
  function bakePackedXform(packed, fn) {
    const stride = nAtoms * 3
    const n = stride > 0 ? Math.floor(packed.length / stride) : 0
    const out = new Float32Array(packed.length)
    for (let i = 0; i < n; i++) {
      const src = packed.subarray(i * stride, (i + 1) * stride)
      const dest = out.subarray(i * stride, (i + 1) * stride)
      const next = fn(i, src)
      if (next === dest) continue
      dest.set(next)
    }
    return out
  }

  function touch(frame) {
    const i = lru.indexOf(frame)
    if (i >= 0) lru.splice(i, 1)
    lru.push(frame)
    while (lru.length > maxFrames) {
      const drop = lru.shift()
      if (drop == null) break
      frames.delete(drop)
    }
  }

  /**
   * @param {number} logical
   * @returns {Promise<Float32Array | null>}
   */
  function get(logical) {
    const frame = Math.max(0, Math.min(frameCount - 1, Math.trunc(logical)))
    if (frameCount <= 0) return Promise.resolve(null)
    const pre = frameAt(frame)
    if (pre && (preloadAll || frames.has(frame))) {
      if (!preloadAll) touch(frame)
      return Promise.resolve(pre)
    }
    const pending = inflight.get(frame)
    if (pending) return pending
    const myToken = token
    const p = opts
      .fetchFrame(frame)
      .then((xyz) => {
        if (myToken !== token) return frames.get(frame) ?? xyz
        if (xyz && xyz.length >= nAtoms * 3) {
          frames.set(frame, xyz)
          touch(frame)
          return xyz
        }
        return null
      })
      .catch(() => null)
      .finally(() => {
        if (inflight.get(frame) === p) inflight.delete(frame)
      })
    inflight.set(frame, p)
    return p
  }

  /**
   * @param {number} start
   * @param {number} count
   */
  function putRange(start, arrays) {
    for (let i = 0; i < arrays.length; i++) {
      const xyz = arrays[i]
      const frame = start + i
      if (!xyz || xyz.length < nAtoms * 3) continue
      frames.set(frame, xyz)
      touch(frame)
    }
  }

  /**
   * @param {number} center
   * @param {number} radius
   * @param {{ sequential?: boolean }} [extra]
   */
  function prefetch(center, radius, extra = {}) {
    if (preloadAll || frameCount <= 0) return Promise.resolve()
    const r = Math.max(0, Math.trunc(radius))
    const c = Math.max(0, Math.min(frameCount - 1, center))
    /** @type {number[]} */
    const want = []
    if (extra.sequential) {
      for (let i = 0; i <= r; i++) {
        const f = c + i
        if (f >= 0 && f < frameCount) want.push(f)
      }
    } else {
      for (let i = -r; i <= r; i++) {
        const f = c + i
        if (f >= 0 && f < frameCount) want.push(f)
      }
    }
    const missing = want.filter((f) => !frames.has(f) && !inflight.has(f))
    if (!missing.length) return prefetchInflight ?? Promise.resolve()
    const runPrefetch = () => {
      if (opts.fetchFrames && extra.sequential && missing.length > 1) {
        const start = missing[0]
        let run = 1
        while (run < missing.length && missing[run] === start + run) run += 1
        return opts
          .fetchFrames(start, run)
          .then((arrs) => {
            putRange(start, arrs || [])
          })
          .catch(() => Promise.all(missing.map((f) => get(f))))
          .then(() => undefined)
      }
      return Promise.all(want.map((f) => get(f))).then(() => undefined)
    }
    const p = runPrefetch().finally(() => {
      if (prefetchInflight === p) prefetchInflight = null
    })
    prefetchInflight = p
    return p
  }

  /**
   * @param {number} playhead
   * @param {number} level
   * @param {{
   *   prev?: Float32Array | null,
   *   box?: [number, number, number] | null,
   *   out?: Float32Array | null,
   *   indices?: Int32Array | number[] | null,
   *   scratch?: Float32Array | null,
   *   restoreH?: boolean,
   *   parents?: Int32Array | null
   * }} [opts]
   * @returns {Float32Array | null}
   */
  function blend(playhead, level, extra = {}) {
    const weights = blendWeights(playhead, level, frameCount)
    const box = parseBoxLengths(extra.box ?? pbcBox)
    unwrapPoolUsed = 0
    /** @type {Map<number, Float32Array>} */
    const mapped = new Map()
    if (box) {
      let refIdx = -1
      let refW = -1
      for (const [idx, w] of weights) {
        if (!rawFrameAt(idx)) continue
        if (w > refW) {
          refW = w
          refIdx = idx
        }
      }
      const refRaw = refIdx >= 0 ? rawFrameAt(refIdx) : undefined
      const scratch = unwrapBuf()
      for (const [idx] of weights) {
        const raw = rawFrameAt(idx)
        if (!raw) continue
        let xyz = raw
        if (refRaw && raw !== refRaw) {
          xyz = unwrapXyzOntoRef(raw, refRaw, box, scratch, extra.indices ?? null)
        }
        if (frameXform) xyz = frameXform(idx, xyz)
        mapped.set(idx, xyz === scratch ? unwrapCopy(scratch) : xyz)
      }
    } else {
      for (const [idx] of weights) {
        const xyz = frameAt(idx)
        if (xyz) mapped.set(idx, xyz)
      }
    }
    // Do not unwrap onto extra.prev. A running min-image vs the last play
    // frame walks wrapping waters/ions out of the box ("blow out"). Seek
    // looks fine because it clears that history. Neighbor unwrap above is
    // enough so Traj smooth does not interpolate through the cell center.
    const blended = blendCachedXyz(mapped, weights, nAtoms, extra.prev ?? null, null, {
      out: extra.out ?? null,
      indices: extra.indices ?? null,
      scratch: extra.scratch ?? null
    })
    const parents = extra.parents ?? hydrogenParents
    if (
      !blended ||
      !extra.restoreH ||
      !parents?.length ||
      clampTrajSmooth(level) <= 0 ||
      weights.length <= 1
    ) {
      return blended
    }
    let dest = blended
    for (const xyz of mapped.values()) {
      if (xyz !== dest) continue
      dest =
        extra.out && extra.out !== blended && extra.out.length === blended.length
          ? extra.out
          : new Float32Array(blended.length)
      dest.set(blended)
      break
    }
    restoreHydrogensAfterBlend(dest, mapped, weights, parents, {
      indices: extra.indices ?? null
    })
    return dest
  }

  /** @param {Int32Array | null | undefined} map */
  function setHydrogenParents(map) {
    hydrogenParents = map && map.length ? map : null
  }

  /** @param {Float32Array | null} all */
  function setPreload(all) {
    preloadRaw = all
    if (all && frameXform) {
      preloadAll = bakePackedXform(all, frameXform)
      xformBaked = true
    } else {
      preloadAll = all
      xformBaked = false
    }
  }

  /**
   * Per-frame coordinate transform applied before blend/get.
   * When all frames are in RAM this is baked so smooth reads the aligned traj.
   * @param {((frame: number, xyz: Float32Array) => Float32Array) | null} fn
   */
  function setFrameXform(fn) {
    frameXform = fn
    const src = preloadRaw ?? preloadAll
    if (src && fn) {
      if (!preloadRaw) preloadRaw = src
      preloadAll = bakePackedXform(preloadRaw, fn)
      xformBaked = true
      return
    }
    if (preloadRaw) preloadAll = preloadRaw
    xformBaked = false
  }

  function invalidate() {
    token += 1
    inflight.clear()
  }

  function dispose() {
    invalidate()
    frames.clear()
    lru.length = 0
    preloadAll = null
    preloadRaw = null
    frameXform = null
    xformBaked = false
    pbcBox = null
    unwrapScratch = null
    unwrapPool = []
    unwrapPoolUsed = 0
    hydrogenParents = null
  }

  /**
   * @param {[number, number, number] | null | undefined} next
   */
  function setBox(next) {
    pbcBox = parseBoxLengths(next)
  }

  return {
    get,
    has: (frame) => {
      const i = Math.trunc(frame)
      if (preloadAll || preloadRaw) return i >= 0 && i < frameCount && !!rawFrameAt(i)
      return frames.has(i)
    },
    prefetch,
    blend,
    setHydrogenParents,
    setPreload,
    setFrameXform,
    setBox,
    invalidate,
    dispose,
    get preloaded() {
      return !!preloadAll
    },
    get size() {
      return frames.size
    },
    get maxFrames() {
      return maxFrames
    }
  }
}
