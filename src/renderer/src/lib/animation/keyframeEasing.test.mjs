import assert from 'node:assert/strict'
import test from 'node:test'
import {
  camerasApproximatelyEqual,
  easingForCapturedKeyframe,
  previousKeyframeAtTime
} from './keyframeEasing.js'

const cam = (x = 0) => ({
  position: [x, 10, 40],
  target: [0, 0, 0],
  up: [0, 1, 0],
  zoom: 1,
  framing: { center: [0, 0, 0], extent: 50, framingZoom: 1 }
})

test('camerasApproximatelyEqual ignores tiny numeric noise', () => {
  const a = cam(0)
  const b = cam(0)
  b.position = [0.0005, 10, 40]
  assert.equal(camerasApproximatelyEqual(a, b), true)
  b.position = [4, 10, 40]
  assert.equal(camerasApproximatelyEqual(a, b), false)
})

test('easingForCapturedKeyframe is linear when traj camera is still', () => {
  assert.equal(
    easingForCapturedKeyframe({
      hasTrajectory: true,
      hasPrevious: true,
      prevCamera: cam(0),
      nextCamera: cam(0)
    }),
    'linear'
  )
  assert.equal(
    easingForCapturedKeyframe({
      hasTrajectory: true,
      hasPrevious: true,
      prevCamera: cam(0),
      nextCamera: cam(8)
    }),
    'easeInOutCubic'
  )
  assert.equal(
    easingForCapturedKeyframe({
      hasTrajectory: true,
      hasPrevious: false,
      prevCamera: null,
      nextCamera: cam(0)
    }),
    undefined
  )
  assert.equal(
    easingForCapturedKeyframe({
      hasTrajectory: false,
      hasPrevious: true,
      prevCamera: cam(0),
      nextCamera: cam(0)
    }),
    undefined
  )
})

test('previousKeyframeAtTime skips the replaced id', () => {
  const keys = [
    { id: 'a', time_s: 0 },
    { id: 'b', time_s: 3 },
    { id: 'c', time_s: 6 }
  ]
  assert.equal(previousKeyframeAtTime(keys, 3, 'b')?.id, 'a')
  assert.equal(previousKeyframeAtTime(keys, 0, 'a'), null)
})
