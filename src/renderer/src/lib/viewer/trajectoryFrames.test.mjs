import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyBlendToViewAtoms,
  applyMinImageStep,
  applyRigidXyz,
  readAffine12,
  blendCachedXyz,
  blendWeights,
  buildHydrogenParentMap,
  clampTrajSmooth,
  createTrajectoryFrameCache,
  isHydrogenAtom,
  restoreHydrogensAfterBlend,
  trajSmoothRestoreHEnabled,
  fileStridesFromFiles,
  gwxyzToAllFrames,
  labelsWithPackedXyz,
  loadAllFits,
  concatSidecarSlices,
  splitPackedFrames,
  trajLoadAllBytesCap,
  trajPlayReady,
  TRAJ_LOAD_ALL_BYTES_CAP,
  TRAJ_LOAD_ALL_BYTES_CAP_LOW_RAM,
  writeInstanceTranslationScale,
  writePointPositions,
  collectAtomIndices,
  unionAtomIndices,
  measurementsWithPackedXyz,
  pickDisplayFrame,
  playTargetFrame,
  xyzBinaryToFrames,
  xyzColumnarToFloat32,
  xyzPackedToFrames
} from './trajectoryFrames.js'

test('clampTrajSmooth stays in 0–8', () => {
  assert.equal(clampTrajSmooth(-2), 0)
  assert.equal(clampTrajSmooth(3), 3)
  assert.equal(clampTrajSmooth(99), 8)
  assert.equal(clampTrajSmooth('nope'), 0)
})

test('fileStridesFromFiles uses basename', () => {
  const strides = fileStridesFromFiles([
    { path: 'C:/data/run.xtc', stride: 2 },
    { path: '/tmp/b.dcd', stride: 3 }
  ])
  assert.equal(strides['run.xtc'], 2)
  assert.equal(strides['b.dcd'], 3)
})

test('blendWeights level 0 snaps to nearest frame', () => {
  assert.deepEqual(blendWeights(2.4, 0, 10), [[2, 1]])
  assert.deepEqual(blendWeights(2.6, 0, 10), [[3, 1]])
})

test('blendWeights higher level spans neighbors and sums to 1', () => {
  const w = blendWeights(2, 2, 10)
  assert.ok(w.length >= 3)
  const sum = w.reduce((s, [, x]) => s + x, 0)
  assert.ok(Math.abs(sum - 1) < 1e-6)
  assert.ok(w.some(([i]) => i === 2))
})

test('loadAllFits uses the 4 GiB cap', () => {
  assert.equal(loadAllFits(10, 10), true)
  assert.equal(loadAllFits(200000, 1000), true)
  assert.equal(loadAllFits(97000, 2000), true)
  assert.equal(loadAllFits(200000, 20000), false)
  assert.equal(loadAllFits(200000, 1000, TRAJ_LOAD_ALL_BYTES_CAP_LOW_RAM), false)
})

test('trajPlayReady waits for a finished sidecar', () => {
  assert.equal(trajPlayReady(null), false)
  assert.equal(trajPlayReady({ complete: false, frames_ready: 40 }), false)
  assert.equal(trajPlayReady({ complete: true, error: 'extract failed' }), false)
  assert.equal(trajPlayReady({ complete: true, error: null }), true)
  assert.equal(trajPlayReady({ complete: true }, { adoptPending: true }), false)
  assert.equal(trajPlayReady({ complete: true }, { framesReady: false }), false)
  assert.equal(trajPlayReady({ complete: true }, { adoptPending: false, framesReady: true }), true)
})

test('concatSidecarSlices splits large reads', async () => {
  const src = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  const calls = []
  const out = await concatSidecarSlices(
    async (path, offset, length) => {
      calls.push({ path, offset, length })
      return src.buffer.slice(offset, offset + length)
    },
    'x.gwxyz',
    0,
    src.length,
    4
  )
  assert.deepEqual([...new Uint8Array(out)], [...src])
  assert.equal(calls.length, 3)
  assert.deepEqual(calls[0], { path: 'x.gwxyz', offset: 0, length: 4 })
  assert.deepEqual(calls[2], { path: 'x.gwxyz', offset: 8, length: 2 })
})

test('concatSidecarSlices reports progress and can skip yield', async () => {
  const src = new Uint8Array([1, 2, 3, 4, 5])
  const progress = []
  const out = await concatSidecarSlices(
    async (_path, offset, length) => src.buffer.slice(offset, offset + length),
    'x.gwxyz',
    0,
    src.length,
    2,
    {
      yieldBetween: false,
      onProgress: (chunk, total) => progress.push([chunk, total])
    }
  )
  assert.deepEqual([...new Uint8Array(out)], [...src])
  assert.deepEqual(progress, [
    [1, 3],
    [2, 3],
    [3, 3]
  ])
})

test('trajLoadAllBytesCap stays at 1.5 GiB under 8 GB', () => {
  assert.equal(trajLoadAllBytesCap(4), TRAJ_LOAD_ALL_BYTES_CAP_LOW_RAM)
  assert.equal(trajLoadAllBytesCap(7.9), TRAJ_LOAD_ALL_BYTES_CAP_LOW_RAM)
  assert.equal(trajLoadAllBytesCap(8), TRAJ_LOAD_ALL_BYTES_CAP)
  assert.equal(trajLoadAllBytesCap(undefined), TRAJ_LOAD_ALL_BYTES_CAP)
  assert.equal(trajLoadAllBytesCap(0), TRAJ_LOAD_ALL_BYTES_CAP)
})

test('trajLoadAllBytesCap honors a user Settings GiB cap', () => {
  assert.equal(trajLoadAllBytesCap(4, 6), 6 * 1024 * 1024 * 1024)
  assert.equal(trajLoadAllBytesCap(8, 0), 0)
  assert.equal(loadAllFits(97000, 2000, trajLoadAllBytesCap(undefined, 2)), false)
  assert.equal(loadAllFits(97000, 2000, trajLoadAllBytesCap(undefined, 4)), true)
})

test('writePointPositions copies a dense frame in order', () => {
  const atoms = [
    { index: 0, x: 0, y: 0, z: 0 },
    { index: 1, x: 0, y: 0, z: 0 }
  ]
  const xyz = new Float32Array([1, 2, 3, 4, 5, 6])
  const dest = new Float32Array(6)
  writePointPositions(dest, atoms, xyz, true)
  assert.deepEqual([...dest], [1, 2, 3, 4, 5, 6])
})

test('writePointPositions scatters a subset without extra objects', () => {
  const atoms = [{ index: 1, x: 9, y: 9, z: 9 }]
  const xyz = new Float32Array([1, 2, 3, 4, 5, 6])
  const dest = new Float32Array(3)
  writePointPositions(dest, atoms, xyz, false)
  assert.deepEqual([...dest], [4, 5, 6])
})

test('writeInstanceTranslationScale is a column-major translate+scale', () => {
  const dest = new Float32Array(16)
  writeInstanceTranslationScale(dest, 0, 1, 2, 3, 4)
  assert.deepEqual([...dest], [4, 0, 0, 0, 0, 4, 0, 0, 0, 0, 4, 0, 1, 2, 3, 1])
})

test('unionAtomIndices unique-sorts view atoms', () => {
  const a = collectAtomIndices([{ index: 2 }, { index: 0 }, { x: 1 }])
  const b = collectAtomIndices([{ index: 0 }, { index: 5 }])
  const u = unionAtomIndices([a, b])
  assert.deepEqual([...u].sort((x, y) => x - y), [0, 2, 5])
})

test('collectAtomIndices interns the same atom list for play-blend sharing', () => {
  const atoms = [{ index: 4 }, { index: 1 }, { index: 9 }]
  const first = collectAtomIndices(atoms)
  const second = collectAtomIndices(atoms)
  assert.ok(first)
  assert.equal(first, second)
})

test('blendCachedXyz reuses out and can restrict to indices', () => {
  const frames = new Map([
    [0, new Float32Array([0, 0, 0, 10, 0, 0])],
    [1, new Float32Array([2, 0, 0, 20, 0, 0])]
  ])
  const dest = new Float32Array(6)
  dest.set([9, 9, 9, 9, 9, 9])
  const out = blendCachedXyz(frames, [[0, 0.5], [1, 0.5]], 2, null, null, {
    out: dest,
    indices: new Int32Array([0])
  })
  assert.equal(out, dest)
  assert.ok(Math.abs(out[0] - 1) < 1e-6)
  assert.equal(out[3], 9)
})

test('splitPackedFrames shares one buffer across a span', () => {
  const raw = new Float32Array([1, 0, 0, 2, 0, 0])
  const frames = splitPackedFrames(raw.buffer, 1, 2)
  assert.equal(frames.length, 2)
  assert.equal(frames[0][0], 1)
  assert.equal(frames[1][0], 2)
  assert.equal(frames[0].buffer, frames[1].buffer)
})

test('gwxyzToAllFrames skips the 16-byte header', () => {
  const nAtoms = 1
  const nFrames = 2
  const buf = new ArrayBuffer(16 + nFrames * nAtoms * 12)
  const header = new DataView(buf)
  header.setUint32(4, 1, true)
  header.setUint32(8, nAtoms, true)
  header.setUint32(12, nFrames, true)
  const xyz = new Float32Array(buf, 16)
  xyz.set([1, 2, 3, 4, 5, 6])
  const all = gwxyzToAllFrames(buf, nAtoms, nFrames)
  assert.deepEqual([...all], [1, 2, 3, 4, 5, 6])
})

test('preloadAll makes has/get O(1)', async () => {
  const all = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0])
  const cache = createTrajectoryFrameCache({
    nAtoms: 1,
    logicalFrameCount: 3,
    preloadAll: all,
    fetchFrame: async () => {
      throw new Error('should not fetch')
    }
  })
  assert.equal(cache.has(2), true)
  const xyz = await cache.get(2)
  assert.equal(xyz[0], 2)
})

test('xyzBinaryToFrames reads the uint32 header', () => {
  const xyz = new Float32Array([1, 2, 3, 4, 5, 6])
  const buf = new ArrayBuffer(12 + xyz.byteLength)
  const header = new DataView(buf)
  header.setUint32(0, 2, true)
  header.setUint32(4, 7, true)
  header.setUint32(8, 1, true)
  new Float32Array(buf, 12).set(xyz)
  const frames = xyzBinaryToFrames(buf)
  assert.equal(frames.length, 1)
  assert.deepEqual([...frames[0]], [1, 2, 3, 4, 5, 6])
})

test('playTargetFrame advances at fps and clamps', () => {
  assert.equal(playTargetFrame(0, 2, 30, 10), 2)
  assert.equal(playTargetFrame(1000, 0, 30, 100), 30)
  assert.equal(playTargetFrame(10_000, 0, 30, 5), 4)
})

test('pickDisplayFrame holds or walks back on cache holes', () => {
  const have = new Set([2, 3])
  const has = (f) => have.has(f)
  assert.deepEqual(pickDisplayFrame(3, 10, has, 2), { frame: 3, hold: false, missing: false })
  assert.deepEqual(pickDisplayFrame(5, 10, has, 2), { frame: 3, hold: false, missing: false })
  const held = pickDisplayFrame(20, 30, has, 3)
  assert.equal(held.frame, 3)
  assert.equal(held.hold, true)
  assert.equal(pickDisplayFrame(1, 10, () => false, null).missing, true)
})

test('applyRigidXyz is x @ R + t and does not mutate source', () => {
  const src = new Float32Array([1, 0, 0])
  const ident = [1, 0, 0, 0, 1, 0, 0, 0, 1, 5, 0, 0]
  const out = applyRigidXyz(src, ident)
  assert.deepEqual([...src], [1, 0, 0])
  assert.deepEqual([...out], [6, 0, 0])
})

test('readAffine12 works for typed and plain arrays', () => {
  const typed = new Float32Array(24)
  typed.set([1, 0, 0, 0, 1, 0, 0, 0, 1, 9, 8, 7], 12)
  const a = readAffine12(typed, 1)
  assert.ok(a)
  assert.equal(a[9], 9)
  const plain = Array.from(typed)
  const b = readAffine12(plain, 1)
  assert.ok(b)
  assert.equal(b[10], 8)
  assert.equal(readAffine12(typed, 4), null)
})

test('applyRigidXyz applies the same R,t to every atom', () => {
  const src = new Float32Array([5, 1, 2, 6, 1, 2])
  const affine = [1, 0, 0, 0, 1, 0, 0, 0, 1, -5, 0, 0]
  const out = applyRigidXyz(src, affine)
  assert.deepEqual([...out], [0, 1, 2, 1, 1, 2])
})

test('xyzPackedToFrames decodes base64 float32 blocks', () => {
  const xyz = new Float32Array([1, 2, 3, 4, 5, 6])
  const b64 = Buffer.from(xyz.buffer).toString('base64')
  const frames = xyzPackedToFrames({ xyz_b64: b64, atom_count: 2, count: 1 })
  assert.equal(frames.length, 1)
  assert.deepEqual([...frames[0]], [1, 2, 3, 4, 5, 6])
})

test('xyzColumnarToFloat32 packs x/y/z', () => {
  const xyz = xyzColumnarToFloat32({
    atom_count: 2,
    x: [1, 4],
    y: [2, 5],
    z: [3, 6]
  })
  assert.deepEqual([...xyz], [1, 2, 3, 4, 5, 6])
})

test('blendCachedXyz falls back when a slot is missing', () => {
  const frames = new Map()
  frames.set(1, new Float32Array([10, 0, 0, 0, 0, 0]))
  const out = blendCachedXyz(frames, [[0, 0.5], [1, 0.5]], 2)
  assert.ok(out)
  assert.equal(out[0], 10)
})

test('applyMinImageStep unwraps a half-box hop', () => {
  const prev = new Float32Array([1, 0, 0])
  const next = new Float32Array([19, 0, 0])
  const out = applyMinImageStep(prev, next, [20, 20, 20])
  assert.ok(out[0] < 0)
})

test('applyMinImageStep unwraps multiple box hops', () => {
  const prev = new Float32Array([41, 0, 0])
  const next = new Float32Array([1, 0, 0])
  const out = applyMinImageStep(prev, next, [20, 20, 20])
  assert.ok(Math.abs(out[0] - 41) < 1e-5)
})

test('blendCachedXyz without box averages a wrap through the center', () => {
  const frames = new Map()
  frames.set(0, new Float32Array([1, 0, 0]))
  frames.set(1, new Float32Array([19, 0, 0]))
  const naive = blendCachedXyz(frames, [[0, 0.5], [1, 0.5]], 1)
  assert.ok(naive)
  assert.ok(Math.abs(naive[0] - 10) < 1e-5)
})

test('blendCachedXyz with box interpolates a wrap at the boundary', () => {
  const frames = new Map()
  frames.set(0, new Float32Array([1, 0, 0]))
  frames.set(1, new Float32Array([19, 0, 0]))
  const out = blendCachedXyz(frames, [[0, 0.5], [1, 0.5]], 1, null, [20, 20, 20])
  assert.ok(out)
  assert.ok(Math.abs(out[0]) < 1e-5, `expected x≈0, got ${out[0]}`)
  assert.ok(Math.abs(out[0] - 10) > 4)
})

test('traj smooth with PBC does not fly through the box center', async () => {
  const cache = createTrajectoryFrameCache({
    nAtoms: 1,
    logicalFrameCount: 2,
    box: [20, 20, 20],
    fetchFrame: async (i) => new Float32Array([i === 0 ? 1 : 19, 0, 0])
  })
  await cache.get(0)
  await cache.get(1)
  const mid = cache.blend(0.5, 2)
  assert.ok(mid)
  assert.ok(Math.abs(mid[0]) < 1e-4, `expected boundary x≈0, got ${mid[0]}`)
  const atOne = cache.blend(1, 0, { prev: mid, box: [20, 20, 20] })
  assert.ok(atOne)
  assert.ok(Math.abs(atOne[0] - 19) < 1e-4, `play must stay wrapped, got ${atOne[0]}`)
  const midAgain = cache.blend(0.5, 2)
  assert.ok(midAgain)
  assert.ok(Math.abs(midAgain[0] - mid[0]) < 1e-6, 'unwrap pool must not corrupt the next blend')
})

test('play does not accumulate unwrap and blow ions out of the box', async () => {
  const xs = [1, 19, 19, 1]
  const cache = createTrajectoryFrameCache({
    nAtoms: 1,
    logicalFrameCount: 4,
    box: [20, 20, 20],
    fetchFrame: async (i) => new Float32Array([xs[i], 0, 0])
  })
  for (let i = 0; i < 4; i++) await cache.get(i)
  let prev = null
  const played = []
  for (let i = 0; i < 4; i++) {
    const xyz = cache.blend(i, 0, { prev, box: [20, 20, 20] })
    assert.ok(xyz)
    prev = xyz
    played.push(xyz[0])
  }
  assert.deepEqual(
    played.map((x) => Math.round(x * 1e4) / 1e4),
    [1, 19, 19, 1]
  )
})

test('PBC unwrap happens on raw coords before alignment', async () => {
  const cache = createTrajectoryFrameCache({
    nAtoms: 1,
    logicalFrameCount: 2,
    box: [20, 20, 20],
    fetchFrame: async (i) => new Float32Array([i === 0 ? 1 : 19, 0, 0])
  })
  await cache.get(0)
  await cache.get(1)
  const ident = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]
  cache.setFrameXform((_frame, xyz) => applyRigidXyz(xyz, ident))
  const mid = cache.blend(0.5, 2)
  assert.ok(mid)
  assert.ok(Math.abs(mid[0]) < 1e-4, `expected PBC blend after identity align, got ${mid[0]}`)
})

test('labels and measurements follow packed xyz', () => {
  const xyz = new Float32Array([1, 2, 3, 9, 8, 7])
  const labels = labelsWithPackedXyz(
    [{ id: 'l', atom: { index: 1, x: 0, y: 0, z: 0 }, text: 'PC' }],
    xyz
  )
  assert.equal(labels[0].atom.x, 9)
  const meas = measurementsWithPackedXyz(
    [{ id: 'm', type: 'distance', atoms: [{ index: 0, x: 0, y: 0, z: 0 }] }],
    xyz
  )
  assert.equal(meas[0].atoms[0].y, 2)
})

test('applyBlendToViewAtoms writes by atom.index', () => {
  const atoms = [
    { index: 1, x: 0, y: 0, z: 0, name: 'CA' },
    { index: 0, x: 0, y: 0, z: 0, name: 'N' }
  ]
  const xyz = new Float32Array([9, 8, 7, 1, 2, 3])
  const out = applyBlendToViewAtoms(atoms, xyz)
  assert.equal(out[0].x, 1)
  assert.equal(out[1].x, 9)
})

test('smooth blends aligned frames, not raw then one affine', async () => {
  const frames = [
    new Float32Array([1, 0, 0]),
    new Float32Array([0, 1, 0])
  ]
  const rotBack = [0, -1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0]
  const cache = createTrajectoryFrameCache({
    nAtoms: 1,
    logicalFrameCount: 2,
    fetchFrame: async (i) => frames[i]
  })
  await cache.get(0)
  await cache.get(1)
  cache.setFrameXform((frame, xyz) => (frame === 1 ? applyRigidXyz(xyz, rotBack) : xyz))
  const mid = cache.blend(0.5, 2)
  assert.ok(mid)
  assert.ok(Math.abs(mid[0] - 1) < 1e-5, `expected aligned blend x≈1, got ${mid[0]}`)
  assert.ok(Math.abs(mid[1]) < 1e-5, `expected aligned blend y≈0, got ${mid[1]}`)
})

test('preload bake makes alignment the live trajectory', () => {
  const all = new Float32Array([1, 0, 0, 0, 1, 0])
  const rotBack = [0, -1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0]
  const cache = createTrajectoryFrameCache({
    nAtoms: 1,
    logicalFrameCount: 2,
    preloadAll: all,
    fetchFrame: async () => {
      throw new Error('should not fetch')
    }
  })
  cache.setFrameXform((frame, xyz) => (frame === 1 ? applyRigidXyz(xyz, rotBack) : xyz))
  const f1 = cache.blend(1, 0)
  assert.ok(f1)
  assert.deepEqual([...f1], [1, 0, 0])
  const mid = cache.blend(0.5, 2)
  assert.ok(mid)
  assert.ok(Math.abs(mid[0] - 1) < 1e-5)
  assert.ok(Math.abs(mid[1]) < 1e-5)
  cache.setFrameXform(null)
  const raw = cache.blend(1, 0)
  assert.ok(raw)
  assert.deepEqual([...raw], [0, 1, 0])
})

test('LRU cache evicts oldest frames and prefetches neighbors', async () => {
  const fetched = []
  const cache = createTrajectoryFrameCache({
    nAtoms: 1,
    logicalFrameCount: 8,
    maxFrames: 3,
    fetchFrame: async (i) => {
      fetched.push(i)
      return new Float32Array([i, 0, 0])
    }
  })
  await cache.get(0)
  await cache.get(1)
  await cache.get(2)
  await cache.get(3)
  assert.equal(cache.has(0), false)
  assert.equal(cache.has(3), true)
  await cache.prefetch(5, 1)
  assert.ok(cache.has(4) || fetched.includes(4))
  assert.ok(fetched.includes(5))
  assert.ok(fetched.includes(6))
})

test('trajSmoothRestoreHEnabled defaults on', () => {
  assert.equal(trajSmoothRestoreHEnabled(undefined), true)
  assert.equal(trajSmoothRestoreHEnabled(true), true)
  assert.equal(trajSmoothRestoreHEnabled(false), false)
})

test('isHydrogenAtom uses element then name', () => {
  assert.equal(isHydrogenAtom({ element: 'H' }), true)
  assert.equal(isHydrogenAtom({ element: 'D' }), true)
  assert.equal(isHydrogenAtom({ element: 'C', name: 'HA' }), false)
  assert.equal(isHydrogenAtom({ name: 'HG21' }), true)
})

test('buildHydrogenParentMap picks the first heavy neighbor', () => {
  const atoms = [
    { index: 0, element: 'C', name: 'C1' },
    { index: 1, element: 'H', name: 'H11' },
    { index: 2, element: 'H', name: 'H12' },
    { index: 3, element: 'O', name: 'OH2' }
  ]
  const parents = buildHydrogenParentMap(atoms, [
    [0, 1],
    [0, 2],
    [3, 1]
  ])
  assert.equal(parents[1], 0)
  assert.equal(parents[2], 0)
  assert.equal(parents[0], -1)
})

test('restoreHydrogensAfterBlend keeps C–H length after a rotating methyl', () => {
  const frames = new Map([
    [0, new Float32Array([0, 0, 0, 1, 0, 0, -1, 0, 0])],
    [1, new Float32Array([0, 0, 0, 0, 1, 0, 0, -1, 0])]
  ])
  const weights = [
    [0, 0.5],
    [1, 0.5]
  ]
  const cartesian = blendCachedXyz(frames, weights, 3)
  assert.ok(cartesian)
  const h1 = Math.hypot(cartesian[3], cartesian[4], cartesian[5])
  assert.ok(h1 < 0.8, `cartesian H collapsed, got ${h1}`)

  const restored = restoreHydrogensAfterBlend(
    cartesian.slice(),
    frames,
    weights,
    Int32Array.from([-1, 0, 0])
  )
  const r1 = Math.hypot(restored[3], restored[4], restored[5])
  const r2 = Math.hypot(restored[6], restored[7], restored[8])
  assert.ok(Math.abs(r1 - 1) < 1e-5, `restored H1 length ${r1}`)
  assert.ok(Math.abs(r2 - 1) < 1e-5, `restored H2 length ${r2}`)
})

test('cache blend restoreH off matches Cartesian blend', async () => {
  const f0 = new Float32Array([0, 0, 0, 1, 0, 0])
  const f1 = new Float32Array([0, 0, 0, 0, 1, 0])
  const cache = createTrajectoryFrameCache({
    nAtoms: 2,
    logicalFrameCount: 2,
    fetchFrame: async (i) => (i === 0 ? f0 : f1)
  })
  cache.setHydrogenParents(Int32Array.from([-1, 0]))
  await cache.get(0)
  await cache.get(1)
  const off = cache.blend(0.5, 2, { restoreH: false })
  const on = cache.blend(0.5, 2, { restoreH: true })
  assert.ok(off && on)
  const cart = blendCachedXyz(
    new Map([
      [0, f0],
      [1, f1]
    ]),
    blendWeights(0.5, 2, 2),
    2
  )
  assert.ok(cart)
  assert.deepEqual([...off], [...cart])
  const cartLen = Math.hypot(cart[3], cart[4], cart[5])
  const onLen = Math.hypot(on[3], on[4], on[5])
  assert.ok(onLen > cartLen)
  assert.ok(Math.abs(onLen - 1) < 1e-4)
})
