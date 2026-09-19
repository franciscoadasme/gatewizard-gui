import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PIPE_BEND_FACTOR,
  buildAdjacency,
  classifyAtoms,
  computeBranchJoints,
  computeElbowFrame,
  computeElbows,
  computeEndAdjustments,
  computeTerminals,
  elbowFrameMatrixElements,
  elbowMatrixElements,
  elbowShortenLength,
  pipeBendRadius,
  stickEndpoints
} from './licoricePipe.js'

test('buildAdjacency is undirected and unique', () => {
  const adj = buildAdjacency([
    { i: 0, j: 1 },
    { i: 1, j: 0 },
    { i: 1, j: 2 }
  ])
  assert.deepEqual(adj.get(0)?.sort(), [1])
  assert.deepEqual(adj.get(1)?.sort(), [0, 2])
  assert.deepEqual(adj.get(2)?.sort(), [1])
})

test('classifyAtoms degrees', () => {
  const adj = buildAdjacency([
    { i: 0, j: 1 },
    { i: 1, j: 2 },
    { i: 2, j: 3 },
    { i: 2, j: 4 }
  ])
  const c = classifyAtoms(adj)
  assert.equal(c.get(0)?.degree, 1)
  assert.equal(c.get(1)?.degree, 2)
  assert.equal(c.get(2)?.degree, 3)
  assert.equal(c.get(3)?.degree, 1)
})

test('elbowShortenLength for 90° bond angle', () => {
  const R = 1
  const L = elbowShortenLength(Math.PI / 2, R)
  // L = R / tan(θ/2) = 1 / tan(π/4) = 1
  assert.ok(Math.abs(L - 1) < 1e-9)
})

test('elbowShortenLength for 120° bond angle', () => {
  const R = 2
  const θ = (120 * Math.PI) / 180
  const L = elbowShortenLength(θ, R)
  const expected = R / Math.tan(θ / 2)
  assert.ok(Math.abs(L - expected) < 1e-9)
})

test('computeElbowFrame center is R from both tangents', () => {
  const pos = /** @type {[number, number, number]} */ ([0, 0, 0])
  const d0 = /** @type {[number, number, number]} */ ([1, 0, 0])
  const d1 = /** @type {[number, number, number]} */ ([0, 1, 0])
  const R = 0.175
  const frame = computeElbowFrame(pos, d0, d1, R)
  assert.ok(frame)
  const t0 = [pos[0] + d0[0] * frame.shorten, pos[1] + d0[1] * frame.shorten, pos[2] + d0[2] * frame.shorten]
  const t1 = [pos[0] + d1[0] * frame.shorten, pos[1] + d1[1] * frame.shorten, pos[2] + d1[2] * frame.shorten]
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  assert.ok(Math.abs(dist(frame.center, t0) - R) < 1e-9)
  assert.ok(Math.abs(dist(frame.center, t1) - R) < 1e-9)
  // Center lies on the bond-bisector side (first quadrant for +X/+Y arms)
  assert.ok(frame.center[0] > 0)
  assert.ok(frame.center[1] > 0)
})

test('computeEndAdjustments shortens degree-2; branches stay at atom', () => {
  const adj = buildAdjacency([
    { i: 0, j: 1 },
    { i: 1, j: 2 },
    { i: 2, j: 3 },
    { i: 2, j: 4 }
  ])
  const classified = classifyAtoms(adj)
  /** @type {Map<number, [number, number, number]>} */
  const positions = new Map([
    [0, [0, 0, 0]],
    [1, [1, 0, 0]],
    [2, [1.5, 1, 0]],
    [3, [1.5, 2, 0]],
    [4, [2.5, 1, 0]]
  ])
  const stickR = 0.1
  const endAdj = computeEndAdjustments(classified, positions, stickR)
  // atom 1 is degree 2 → positive shorten for torus elbow
  assert.ok((endAdj.get(1)?.get(0) ?? 0) > 0)
  assert.ok((endAdj.get(1)?.get(2) ?? 0) > 0)
  // atom 2 is degree 3 → stick meets atom (branch sphere)
  assert.equal(endAdj.get(2)?.get(1), 0)
  assert.equal(endAdj.get(2)?.get(3), 0)
  // terminal 0 → 0
  assert.equal(endAdj.get(0)?.get(1), 0)
})

test('stickEndpoints respects shorten on both ends', () => {
  const r = stickEndpoints([0, 0, 0], [10, 0, 0], 1, 2)
  assert.ok(r)
  assert.deepEqual(r.start, [1, 0, 0])
  assert.deepEqual(r.end, [8, 0, 0])
  assert.ok(Math.abs(r.length - 7) < 1e-9)
})

test('computeElbows and terminals', () => {
  const adj = buildAdjacency([
    { i: 0, j: 1 },
    { i: 1, j: 2 }
  ])
  const classified = classifyAtoms(adj)
  const positions = new Map([
    [0, /** @type {[number, number, number]} */ ([0, 0, 0])],
    [1, /** @type {[number, number, number]} */ ([1, 0, 0])],
    [2, /** @type {[number, number, number]} */ ([1, 1, 0])]
  ])
  const elbows = computeElbows(classified, positions, 0.1)
  assert.equal(elbows.length, 1)
  assert.equal(elbows[0].atomIndex, 1)
  assert.equal(computeTerminals(classified).sort()[0], 0)
  assert.deepEqual(computeTerminals(classified).sort(), [0, 2])
})

test('computeBranchJoints lists degree ≥ 3', () => {
  const adj = buildAdjacency([
    { i: 0, j: 1 },
    { i: 1, j: 2 },
    { i: 1, j: 3 }
  ])
  const classified = classifyAtoms(adj)
  assert.deepEqual(computeBranchJoints(classified).sort(), [1])
})

test('elbowMatrixElements scale and translation', () => {
  const into = new Float32Array(16)
  elbowMatrixElements(
    {
      center: [3, 4, 5],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      zAxis: [0, 0, 1],
      bendRadius: 2
    },
    into
  )
  assert.equal(into[0], 2)
  assert.equal(into[5], 2)
  assert.equal(into[10], 2)
  assert.equal(into[12], 3)
  assert.equal(into[13], 4)
  assert.equal(into[14], 5)
  assert.equal(into[15], 1)
})

test('elbowFrameMatrixElements is unscaled basis', () => {
  const into = new Float32Array(16)
  elbowFrameMatrixElements(
    {
      center: [1, 2, 3],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      zAxis: [0, 0, 1]
    },
    into
  )
  assert.equal(into[0], 1)
  assert.equal(into[5], 1)
  assert.equal(into[10], 1)
  assert.equal(into[12], 1)
  assert.equal(into[13], 2)
  assert.equal(into[14], 3)
})

test('pipeBendRadius uses factor', () => {
  assert.equal(pipeBendRadius(0.2), 0.2 * PIPE_BEND_FACTOR)
})
