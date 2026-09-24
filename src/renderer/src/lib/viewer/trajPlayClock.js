/**
 * Play-clock for Visualize: the rAF tick writes here so representations can
 * upload GPU buffers without flushing the Visualize page every frame.
 */

import { clampTrajSmooth } from './trajectoryFrames.js'

/**
 * @typedef {{
 *   playing: boolean
 *   playhead: number
 *   cache: { blend: Function } | null
 *   box: [number, number, number] | null
 *   nAtoms: number
 *   generation: number
 * }} TrajPlayClock
 */

/** @type {TrajPlayClock} */
export const trajPlayClock = {
  playing: false,
  playhead: 0,
  cache: null,
  box: null,
  nAtoms: 0,
  generation: 0
}

/** @type {(() => void) | null} */
let invalidateView = null

/** One slot per distinct (smooth, restoreH, index set) so a duplicate lipid view
 * does not re-run Gaussian + H-restore after the protein/ion pass overwrote the
 * previous single-slot result. */
const PLAY_BLEND_SLOTS = 6

/**
 * @typedef {{
 *   playhead: number
 *   level: number
 *   restoreH: boolean
 *   indices: Int32Array | null
 *   xyz: Float32Array | null
 *   scratch: Float32Array | null
 * }} PlayBlendSlot
 */

/** @type {PlayBlendSlot[]} */
let playBlendSlots = []

/**
 * @param {Int32Array | null} a
 * @param {Int32Array | null} b
 */
export function playIndicesEqual(a, b) {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function clearPlayBlendSlots() {
  playBlendSlots = []
}

/** @param {() => void} fn */
export function setTrajPlayInvalidate(fn) {
  invalidateView = fn
}

export function requestTrajPlayFrame() {
  invalidateView?.()
}

/**
 * @param {Partial<TrajPlayClock>} next
 */
export function setTrajPlayClock(next) {
  const cacheChanged = next.cache !== undefined && next.cache !== trajPlayClock.cache
  const nChanged = next.nAtoms != null && next.nAtoms !== trajPlayClock.nAtoms
  if (next.playing != null) trajPlayClock.playing = next.playing
  if (next.playhead != null) trajPlayClock.playhead = next.playhead
  if (next.cache !== undefined) trajPlayClock.cache = next.cache
  if (next.box !== undefined) trajPlayClock.box = next.box
  if (next.nAtoms != null) trajPlayClock.nAtoms = next.nAtoms
  trajPlayClock.generation += 1
  if (cacheChanged || nChanged) clearPlayBlendSlots()
}

/**
 * Packed xyz for the current playhead. Views that share smooth / restore-H /
 * atom indices reuse one slot (a duplicate representation is not a second blend).
 * @param {number} level
 * @param {Int32Array | null} [indices]
 * @param {boolean} [restoreH]
 * @returns {Float32Array | null}
 */
export function blendPlayXyz(level, indices = null, restoreH = true) {
  const cache = trajPlayClock.cache
  if (!cache) return null
  const L = clampTrajSmooth(level)
  const wantRestore = restoreH !== false
  const rawIdx = indices && indices.length ? indices : null
  const nAtoms = trajPlayClock.nAtoms
  const idx = rawIdx && nAtoms && rawIdx.length < nAtoms * 0.85 ? rawIdx : null
  const playhead = trajPlayClock.playhead
  for (const slot of playBlendSlots) {
    if (
      slot.xyz &&
      slot.playhead === playhead &&
      slot.level === L &&
      slot.restoreH === wantRestore &&
      playIndicesEqual(slot.indices, idx)
    ) {
      return slot.xyz
    }
  }
  let slot = playBlendSlots.find((s) => s.playhead !== playhead)
  if (!slot) {
    if (playBlendSlots.length < PLAY_BLEND_SLOTS) {
      slot = {
        playhead: -1,
        level: -1,
        restoreH: true,
        indices: null,
        xyz: null,
        scratch: null
      }
      playBlendSlots.push(slot)
    } else {
      slot = playBlendSlots.shift()
      playBlendSlots.push(slot)
    }
  }
  const nFloats = Math.max(0, nAtoms) * 3
  if (!slot.scratch || slot.scratch.length !== nFloats) {
    slot.scratch = nFloats > 0 ? new Float32Array(nFloats) : null
  }
  const xyz = cache.blend(playhead, L, {
    box: trajPlayClock.box,
    out: slot.scratch,
    indices: idx,
    restoreH: wantRestore
  })
  slot.playhead = playhead
  slot.level = L
  slot.restoreH = wantRestore
  slot.indices = idx
  slot.xyz = xyz
  return xyz
}
