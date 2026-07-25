import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyPatchToAtoms,
  atomsFromBaseAndPatch,
  coordPatchToMap,
  createCoordUndoStack,
  diffFromBase,
  inversePatchFromBefore,
  lerpPatches,
  normalizeCoordPatch,
  positionsToCoordPatch,
  snapshotAtomCoords
} from './workingCoords.js'

test('diffFromBase returns only moved atoms', () => {
  const atoms = [
    { index: 0, x: 0, y: 0, z: 0 },
    { index: 1, x: 1, y: 0, z: 0 },
    { index: 2, x: 2, y: 0, z: 0 }
  ]
  const base = snapshotAtomCoords(atoms)
  const working = [
    { index: 0, x: 0, y: 0, z: 0 },
    { index: 1, x: 1.5, y: 0, z: 0 },
    { index: 2, x: 2, y: 0, z: 0 }
  ]
  const patch = diffFromBase(base, working)
  assert.ok(patch)
  assert.deepEqual(patch.indices, [1])
  assert.ok(Math.abs(patch.xyz[0] - 1.5) < 1e-9)
})

test('lerpPatches interpolates shared indices', () => {
  const a = { indices: [1], xyz: [0, 0, 0] }
  const b = { indices: [1], xyz: [10, 0, 0] }
  const mid = lerpPatches(a, b, 0.5)
  assert.deepEqual(mid.indices, [1])
  assert.ok(Math.abs(mid.xyz[0] - 5) < 1e-9)
})

test('lerpPatches uses base when only on one side', () => {
  const base = new Map([[2, /** @type {[number,number,number]} */ ([0, 0, 0])]])
  const b = { indices: [2], xyz: [4, 0, 0] }
  const mid = lerpPatches(null, b, 0.5, base)
  assert.ok(Math.abs(mid.xyz[0] - 2) < 1e-9)
})

test('applyPatchToAtoms and inverse round-trip', () => {
  const atoms = [
    { index: 0, x: 0, y: 0, z: 0 },
    { index: 1, x: 1, y: 1, z: 1 }
  ]
  const before = snapshotAtomCoords(atoms)
  const forward = { indices: [1], xyz: [9, 9, 9] }
  const next = applyPatchToAtoms(atoms, forward)
  assert.equal(next[1].x, 9)
  const inv = inversePatchFromBefore(before, forward)
  const back = applyPatchToAtoms(next, inv)
  assert.equal(back[1].x, 1)
})

test('normalizeCoordPatch rejects bad lengths', () => {
  assert.equal(normalizeCoordPatch({ indices: [1], xyz: [1, 2] }), null)
  assert.ok(normalizeCoordPatch({ indices: [1], xyz: [1, 2, 3] }))
})

test('positionsToCoordPatch from sparse array', () => {
  /** @type {Array<number[]|undefined>} */
  const arr = []
  arr[5] = [1, 2, 3]
  const p = positionsToCoordPatch(arr)
  assert.deepEqual(p.indices, [5])
  assert.deepEqual(coordPatchToMap(p).get(5), [1, 2, 3])
})

test('positionsToCoordPatch from plain object snapshot', () => {
  const obj = { 12: [4, 5, 6], 99: [7, 8, 9] }
  const p = positionsToCoordPatch(obj)
  assert.deepEqual(p.indices.sort((a, b) => a - b), [12, 99])
  assert.deepEqual(coordPatchToMap(p).get(12), [4, 5, 6])
})

test('coord undo stack push/pop', () => {
  const stack = createCoordUndoStack(2)
  stack.push({ indices: [1], xyz: [0, 0, 0] })
  stack.push({ indices: [2], xyz: [0, 0, 0] })
  stack.push({ indices: [3], xyz: [0, 0, 0] })
  assert.equal(stack.size, 2)
  assert.deepEqual(stack.pop()?.indices, [3])
})

test('atomsFromBaseAndPatch discards unsaved moves then applies keyframe patch', () => {
  const baseAtoms = [
    { index: 0, x: 0, y: 0, z: 0 },
    { index: 1, x: 1, y: 0, z: 0 }
  ]
  const base = snapshotAtomCoords(baseAtoms)
  const dirty = [
    { index: 0, x: 9, y: 9, z: 9 },
    { index: 1, x: 1, y: 0, z: 0 }
  ]
  const patch = { indices: [1], xyz: [5, 0, 0] }
  const restored = atomsFromBaseAndPatch(dirty, base, patch)
  assert.equal(restored[0].x, 0)
  assert.equal(restored[1].x, 5)
  const toBaseOnly = atomsFromBaseAndPatch(dirty, base, null)
  assert.equal(toBaseOnly[0].x, 0)
  assert.equal(toBaseOnly[1].x, 1)
})
