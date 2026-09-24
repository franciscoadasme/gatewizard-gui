import assert from 'node:assert/strict'
import test from 'node:test'
import { interpolateTrajFrame, resolvedTrajFrame } from './trajFrame.js'

test('trajFrame inherits the previous keyframe and lerps', () => {
  const keyframes = [
    { id: 'a', time_s: 0, trajFrame: 0 },
    { id: 'b', time_s: 2 },
    { id: 'c', time_s: 4, trajFrame: 200 }
  ]
  assert.equal(resolvedTrajFrame(keyframes[1], keyframes), 0)
  assert.equal(resolvedTrajFrame(keyframes[2], keyframes), 200)
  const mid = interpolateTrajFrame(keyframes[1], keyframes[2], 0.5, keyframes)
  assert.ok(Math.abs((mid ?? 0) - 100) < 1e-6)
})
