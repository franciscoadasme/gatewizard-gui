import assert from 'node:assert/strict'
import test from 'node:test'
import {
  animFrameToTime,
  animTimeToFrame,
  coordPatchSignature,
  keyframeAtPlayhead,
  shouldApplyCoordPatch,
  shouldSeekTrajFrame,
  snapAnimTime,
  viewListNeedsReplace
} from './timelinePlayhead.js'

test('snapAnimTime snaps to fps steps and clamps', () => {
  assert.equal(snapAnimTime(1.016, 30, 10), 1)
  assert.equal(snapAnimTime(-1, 30, 10), 0)
  assert.equal(snapAnimTime(99, 30, 2), 2)
})

test('anim time and frame convert with the same numbering as the label', () => {
  assert.equal(animTimeToFrame(0, 30), 0)
  assert.equal(animTimeToFrame(1, 30), 30)
  assert.equal(animFrameToTime(30, 30, 10), 1)
  assert.equal(animFrameToTime(0, 24, 5), 0)
  assert.equal(animTimeToFrame(animFrameToTime(15, 30, 10), 30), 15)
})

test('keyframeAtPlayhead picks the diamond under the playhead', () => {
  const keys = [
    { id: 'a', time_s: 0 },
    { id: 'b', time_s: 1 },
    { id: 'c', time_s: 2 }
  ]
  assert.equal(keyframeAtPlayhead(keys, 1, 30)?.id, 'b')
  assert.equal(keyframeAtPlayhead(keys, 1.01, 30)?.id, 'b')
  assert.equal(keyframeAtPlayhead(keys, 1.2, 30), null)
  assert.equal(keyframeAtPlayhead([], 1, 30), null)
})

test('shouldApplyCoordPatch skips an unchanged empty patch after the first apply', () => {
  const first = shouldApplyCoordPatch(undefined, null)
  assert.equal(first.apply, true)
  assert.equal(first.signature, '')
  const second = shouldApplyCoordPatch(first.signature, null)
  assert.equal(second.apply, false)
  const moved = shouldApplyCoordPatch(first.signature, { indices: [3], xyz: [1, 2, 3] })
  assert.equal(moved.apply, true)
  assert.notEqual(moved.signature, first.signature)
})

test('coordPatchSignature changes when xyz moves', () => {
  const a = coordPatchSignature({ indices: [1, 2], xyz: [0, 0, 0, 1, 0, 0] })
  const b = coordPatchSignature({ indices: [1, 2], xyz: [0, 0, 0, 2, 0, 0] })
  assert.notEqual(a, b)
})

test('viewListNeedsReplace is false when the same objects stay in order', () => {
  const v1 = { id: 'a' }
  const v2 = { id: 'b' }
  assert.equal(viewListNeedsReplace([v1, v2], [v1, v2]), false)
  assert.equal(viewListNeedsReplace([v1, v2], [v2, v1]), true)
  assert.equal(viewListNeedsReplace([v1], [v1, v2]), true)
})

test('shouldSeekTrajFrame is a no-op on the same logical frame', () => {
  assert.equal(shouldSeekTrajFrame(10, 10), false)
  assert.equal(shouldSeekTrajFrame(10.4, 10), false)
  assert.equal(shouldSeekTrajFrame(11, 10), true)
})
