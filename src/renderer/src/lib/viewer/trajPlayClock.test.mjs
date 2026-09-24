import assert from 'node:assert/strict'
import test from 'node:test'
import { blendPlayXyz, playIndicesEqual, setTrajPlayClock, trajPlayClock } from './trajPlayClock.js'

test('blendPlayXyz reuses the last full-frame blend', () => {
  let calls = 0
  const frame = new Float32Array([1, 2, 3])
  setTrajPlayClock({
    playing: true,
    playhead: 4,
    nAtoms: 1,
    box: null,
    cache: {
      blend() {
        calls += 1
        return frame
      }
    }
  })
  assert.equal(trajPlayClock.playhead, 4)
  assert.equal(blendPlayXyz(0, null), frame)
  assert.equal(blendPlayXyz(0, null), frame)
  assert.equal(calls, 1)
  setTrajPlayClock({ playhead: 5 })
  assert.equal(blendPlayXyz(0, null), frame)
  assert.equal(calls, 2)
})

test('blendPlayXyz treats a near-full index list as the whole frame', () => {
  let calls = 0
  const frame = new Float32Array(30)
  setTrajPlayClock({
    playing: true,
    playhead: 1,
    nAtoms: 10,
    box: null,
    cache: {
      blend(_playhead, _level, extra) {
        calls += 1
        assert.equal(extra.indices, null)
        return frame
      }
    }
  })
  const a = new Int32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  const b = new Int32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  assert.equal(blendPlayXyz(0, a), frame)
  assert.equal(blendPlayXyz(0, b), frame)
  assert.equal(calls, 1)
})

test('playIndicesEqual matches interned and copied index lists', () => {
  const a = new Int32Array([1, 4, 9])
  const b = new Int32Array([1, 4, 9])
  const c = new Int32Array([1, 4, 8])
  assert.equal(playIndicesEqual(a, a), true)
  assert.equal(playIndicesEqual(a, b), true)
  assert.equal(playIndicesEqual(a, c), false)
  assert.equal(playIndicesEqual(null, null), true)
  assert.equal(playIndicesEqual(a, null), false)
})

test('blendPlayXyz shares a subset blend across copied index arrays', () => {
  let calls = 0
  const frame = new Float32Array(9)
  setTrajPlayClock({
    playing: true,
    playhead: 7,
    nAtoms: 20,
    box: null,
    cache: {
      blend() {
        calls += 1
        return frame
      }
    }
  })
  const a = new Int32Array([2, 3, 4])
  const b = new Int32Array([2, 3, 4])
  assert.equal(blendPlayXyz(3, a, true), frame)
  assert.equal(blendPlayXyz(3, b, true), frame)
  assert.equal(calls, 1)
})

test('blendPlayXyz keeps subset blends for different views', () => {
  const protein = new Float32Array([1, 0, 0])
  const lipid = new Float32Array([2, 0, 0])
  setTrajPlayClock({
    playing: true,
    playhead: 3,
    nAtoms: 10,
    box: null,
    cache: {
      blend(_playhead, _level, extra) {
        return extra.indices?.[0] === 0 ? protein : lipid
      }
    }
  })
  const a = new Int32Array([0, 1])
  const b = new Int32Array([5, 6, 7])
  assert.equal(blendPlayXyz(2, a), protein)
  assert.equal(blendPlayXyz(2, b), lipid)
  assert.equal(blendPlayXyz(2, a), protein)
  assert.equal(blendPlayXyz(2, new Int32Array([0, 1])), protein)
})

test('blendPlayXyz does not share blends with different restoreH', () => {
  let lastRestore = /** @type {boolean | undefined} */ (undefined)
  let calls = 0
  setTrajPlayClock({
    playing: true,
    playhead: 2,
    nAtoms: 1,
    box: null,
    cache: {
      blend(_playhead, _level, extra) {
        calls += 1
        lastRestore = extra.restoreH
        return new Float32Array([calls, 0, 0])
      }
    }
  })
  const a = blendPlayXyz(3, null, true)
  const b = blendPlayXyz(3, null, true)
  assert.equal(a, b)
  assert.equal(calls, 1)
  assert.equal(lastRestore, true)
  const c = blendPlayXyz(3, null, false)
  assert.notEqual(c, a)
  assert.equal(calls, 2)
  assert.equal(lastRestore, false)
})
