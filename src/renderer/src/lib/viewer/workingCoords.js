/**
 * Sparse coordinate patches for in-memory transforms and animation.
 *
 * Patch shape: { indices: number[], xyz: number[] } where xyz length is 3 * indices.length.
 * Absolute world coordinates (Å), not deltas.
 */

/**
 * @typedef {{ indices: number[], xyz: number[] }} CoordPatch
 */

/**
 * @param {unknown} raw
 * @returns {CoordPatch | null}
 */
export function normalizeCoordPatch(raw) {
  if (!raw || typeof raw !== 'object') return null
  const r = /** @type {Record<string, unknown>} */ (raw)
  if (!Array.isArray(r.indices) || !Array.isArray(r.xyz)) return null
  const indices = r.indices.filter((i) => typeof i === 'number' && Number.isFinite(i))
  if (!indices.length) return null
  const xyz = r.xyz.filter((n) => typeof n === 'number' && Number.isFinite(n))
  if (xyz.length !== indices.length * 3) return null
  return { indices: indices.map((i) => Math.trunc(i)), xyz: xyz.map(Number) }
}

/**
 * @param {CoordPatch | null | undefined} patch
 * @returns {Map<number, [number, number, number]>}
 */
export function coordPatchToMap(patch) {
  /** @type {Map<number, [number, number, number]>} */
  const map = new Map()
  if (!patch?.indices?.length) return map
  for (let i = 0; i < patch.indices.length; i++) {
    const o = i * 3
    map.set(patch.indices[i], [patch.xyz[o], patch.xyz[o + 1], patch.xyz[o + 2]])
  }
  return map
}

/**
 * @param {Map<number, [number, number, number]> | Record<number, number[]> | Array<number[] | undefined> | null | undefined} positions
 * @returns {CoordPatch | null}
 */
export function positionsToCoordPatch(positions) {
  if (!positions) return null
  /** @type {number[]} */
  const indices = []
  /** @type {number[]} */
  const xyz = []

  if (positions instanceof Map) {
    for (const [idx, p] of positions) {
      if (!p || p.length < 3) continue
      indices.push(idx)
      xyz.push(p[0], p[1], p[2])
    }
  } else {
    // Object.keys works for sparse arrays and Svelte $state array proxies
    // (length-based loops can miss or mis-handle holes / proxies).
    const keys =
      typeof positions === 'object'
        ? Object.keys(positions).filter((k) => /^\d+$/.test(k))
        : []
    for (const key of keys) {
      const idx = Number(key)
      const p = /** @type {Record<string, number[]>} */ (positions)[key]
      if (!Number.isFinite(idx) || !p || p.length < 3) continue
      if (typeof p[0] !== 'number' || typeof p[1] !== 'number' || typeof p[2] !== 'number') {
        continue
      }
      indices.push(idx)
      xyz.push(p[0], p[1], p[2])
    }
  }

  if (!indices.length) return null
  return { indices, xyz }
}

/**
 * Snapshot XYZ for diff / base pose (index → [x,y,z]).
 * @param {Array<{ index?: number, x: number, y: number, z: number }>} atoms
 * @returns {Map<number, [number, number, number]>}
 */
export function snapshotAtomCoords(atoms) {
  /** @type {Map<number, [number, number, number]>} */
  const map = new Map()
  for (const a of atoms ?? []) {
    const idx = typeof a.index === 'number' ? a.index : -1
    if (idx < 0) continue
    map.set(idx, [a.x, a.y, a.z])
  }
  return map
}

/**
 * Sparse patch of atoms that differ from base (absolute working coords).
 * @param {Map<number, [number, number, number]>} base
 * @param {Array<{ index?: number, x: number, y: number, z: number }>} workingAtoms
 * @param {number} [eps=1e-4]
 * @returns {CoordPatch | null}
 */
export function diffFromBase(base, workingAtoms, eps = 1e-4) {
  /** @type {number[]} */
  const indices = []
  /** @type {number[]} */
  const xyz = []
  const thr = eps * eps
  for (const a of workingAtoms ?? []) {
    const idx = typeof a.index === 'number' ? a.index : -1
    if (idx < 0) continue
    const b = base.get(idx)
    if (!b) {
      indices.push(idx)
      xyz.push(a.x, a.y, a.z)
      continue
    }
    const dx = a.x - b[0]
    const dy = a.y - b[1]
    const dz = a.z - b[2]
    if (dx * dx + dy * dy + dz * dz > thr) {
      indices.push(idx)
      xyz.push(a.x, a.y, a.z)
    }
  }
  if (!indices.length) return null
  return { indices, xyz }
}

/**
 * Inverse patch: restore base coords for indices touched by `forward`.
 * @param {Map<number, [number, number, number]>} before
 * @param {CoordPatch} forward
 * @returns {CoordPatch | null}
 */
export function inversePatchFromBefore(before, forward) {
  if (!forward?.indices?.length) return null
  /** @type {number[]} */
  const indices = []
  /** @type {number[]} */
  const xyz = []
  for (const idx of forward.indices) {
    const b = before.get(idx)
    if (!b) continue
    indices.push(idx)
    xyz.push(b[0], b[1], b[2])
  }
  if (!indices.length) return null
  return { indices, xyz }
}

/**
 * Apply a sparse patch onto an atom list (returns new array; does not mutate).
 * @template {{ index?: number, x: number, y: number, z: number }} T
 * @param {T[]} atoms
 * @param {CoordPatch | null | undefined} patch
 * @returns {T[]}
 */
export function applyPatchToAtoms(atoms, patch) {
  if (!patch?.indices?.length) return atoms
  const map = coordPatchToMap(patch)
  return atoms.map((a) => {
    const idx = typeof a.index === 'number' ? a.index : -1
    const p = map.get(idx)
    if (!p) return a
    return { ...a, x: p[0], y: p[1], z: p[2] }
  })
}

/**
 * Reset atom XYZ to a base snapshot, then apply an optional absolute patch.
 * Used when animation scrub/play asserts keyframe coordinates (discarding unsaved moves).
 * @template {{ index?: number, x: number, y: number, z: number }} T
 * @param {T[]} atoms
 * @param {Map<number, [number, number, number]> | null | undefined} base
 * @param {CoordPatch | null | undefined} patch
 * @returns {T[]}
 */
export function atomsFromBaseAndPatch(atoms, base, patch) {
  if (!atoms?.length) return atoms ?? []
  const restored =
    base?.size
      ? atoms.map((a) => {
          const idx = typeof a.index === 'number' ? a.index : -1
          const b = idx >= 0 ? base.get(idx) : undefined
          return b ? { ...a, x: b[0], y: b[1], z: b[2] } : a
        })
      : atoms
  return applyPatchToAtoms(restored, patch)
}

/**
 * Mutate atom XYZ in place from a sparse patch (and matching view atom arrays).
 * @param {Array<{ index?: number, x: number, y: number, z: number }>} atoms
 * @param {CoordPatch} patch
 */
export function applyPatchInPlace(atoms, patch) {
  if (!patch?.indices?.length) return
  const map = coordPatchToMap(patch)
  for (const a of atoms) {
    const idx = typeof a.index === 'number' ? a.index : -1
    const p = map.get(idx)
    if (!p) continue
    a.x = p[0]
    a.y = p[1]
    a.z = p[2]
  }
}

/**
 * Lerp two sparse patches. Missing side uses `base` when provided, else holds.
 * @param {CoordPatch | null | undefined} a
 * @param {CoordPatch | null | undefined} b
 * @param {number} t
 * @param {Map<number, [number, number, number]> | null} [base]
 * @returns {CoordPatch | null}
 */
export function lerpPatches(a, b, t, base = null) {
  const ma = coordPatchToMap(a)
  const mb = coordPatchToMap(b)
  if (!ma.size && !mb.size) return null
  const u = typeof t === 'number' && Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0
  /** @type {Set<number>} */
  const ids = new Set([...ma.keys(), ...mb.keys()])
  /** @type {number[]} */
  const indices = []
  /** @type {number[]} */
  const xyz = []
  for (const idx of ids) {
    const pa = ma.get(idx)
    const pb = mb.get(idx)
    const baseP = base?.get(idx)
    let x0
    let y0
    let z0
    let x1
    let y1
    let z1
    if (pa && pb) {
      ;[x0, y0, z0] = pa
      ;[x1, y1, z1] = pb
    } else if (pa && !pb) {
      ;[x0, y0, z0] = pa
      ;[x1, y1, z1] = baseP ?? pa
    } else if (!pa && pb) {
      ;[x0, y0, z0] = baseP ?? pb
      ;[x1, y1, z1] = pb
    } else {
      continue
    }
    indices.push(idx)
    xyz.push(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, z0 + (z1 - z0) * u)
  }
  if (!indices.length) return null
  return { indices, xyz }
}

/**
 * Convert patch to sparse array suitable for previewPositions[index] = [x,y,z].
 * @param {CoordPatch | null | undefined} patch
 * @returns {Array<number[] | undefined> | null}
 */
export function coordPatchToPreviewArray(patch) {
  if (!patch?.indices?.length) return null
  /** @type {Array<number[] | undefined>} */
  const arr = []
  for (let i = 0; i < patch.indices.length; i++) {
    const o = i * 3
    arr[patch.indices[i]] = [patch.xyz[o], patch.xyz[o + 1], patch.xyz[o + 2]]
  }
  return arr
}

/**
 * Merge dense backend positions (ordered by atom index 0..n-1 or parallel to atoms)
 * into a sparse preview array keyed by atom.index.
 * @param {number[][]} dense
 * @param {Array<{ index?: number }>} atoms
 * @returns {Array<number[] | undefined>}
 */
export function densePositionsToPreview(dense, atoms) {
  /** @type {Array<number[] | undefined>} */
  const arr = []
  if (!dense?.length || !atoms?.length) return arr
  // Prefer mapping by enumeration when lengths match and indices are 0..n-1
  if (dense.length === atoms.length) {
    for (let i = 0; i < atoms.length; i++) {
      const a = atoms[i]
      const p = dense[i]
      if (!p || p.length < 3) continue
      const idx = typeof a.index === 'number' ? a.index : i
      arr[idx] = [p[0], p[1], p[2]]
    }
    return arr
  }
  for (let i = 0; i < dense.length; i++) {
    const p = dense[i]
    if (p && p.length >= 3) arr[i] = [p[0], p[1], p[2]]
  }
  return arr
}

/**
 * Simple undo stack of inverse CoordPatches.
 */
export function createCoordUndoStack(max = 32) {
  /** @type {CoordPatch[]} */
  const stack = []
  return {
    /** @param {CoordPatch | null | undefined} inverse */
    push(inverse) {
      if (!inverse?.indices?.length) return
      stack.push(inverse)
      while (stack.length > max) stack.shift()
    },
    /** @returns {CoordPatch | null} */
    pop() {
      return stack.pop() ?? null
    },
    clear() {
      stack.length = 0
    },
    get size() {
      return stack.length
    }
  }
}
