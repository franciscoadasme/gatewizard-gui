import assert from 'node:assert/strict'
import test from 'node:test'
import {
  camerasApproximatelyEqual,
  scenesApproximatelyEqual,
  viewsApproximatelyEqual,
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

test('scenesApproximatelyEqual notices lights, shadows, and background', () => {
  const scene = {
    backgroundMode: 'custom',
    customBackgroundHex: '#000000',
    theme: 'dark',
    ambientIntensity: 0,
    hemisphereIntensity: 0,
    fog: { enabled: true, near: 70, far: 140, color: '#000000', matchBackground: true },
    shadows: { enabled: true, strength: 0, softness: 0.45 },
    dof: { enabled: false, focusDistance: 80, focusRange: 20, bokehScale: 2.5, focusTarget: null }
  }
  assert.equal(scenesApproximatelyEqual(scene, { ...scene }), true)
  assert.equal(scenesApproximatelyEqual(scene, { ...scene, ambientIntensity: 2 }), false)
  assert.equal(scenesApproximatelyEqual(scene, { ...scene, hemisphereIntensity: 2 }), false)
  assert.equal(
    scenesApproximatelyEqual(scene, { ...scene, shadows: { ...scene.shadows, strength: 1 } }),
    false
  )
  assert.equal(scenesApproximatelyEqual(scene, { ...scene, customBackgroundHex: '#ffffff' }), false)
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

test('viewsApproximatelyEqual compares style fields for capture', () => {
  const a = /** @type {any} */ ({
    id: 'ion',
    visible: true,
    opacity: 1,
    selection: 'ion',
    representation: { type: 'ball+stick' },
    colorScheme: { name: 'uniform', color: '#ff0000' }
  })
  assert.equal(viewsApproximatelyEqual(a, { ...a }), true)
  assert.equal(viewsApproximatelyEqual(a, { ...a, colorScheme: { name: 'uniform', color: '#00ff00' } }), false)
})

test('viewsApproximatelyEqual treats identical hidden holds as equal', () => {
  const water = /** @type {any} */ ({
    id: 'water',
    visible: false,
    opacity: 0,
    selection: 'water',
    representation: { type: 'points' },
    colorScheme: { name: 'cpk' }
  })
  assert.equal(viewsApproximatelyEqual(water, { ...water }), true)
  assert.equal(viewsApproximatelyEqual(water, { ...water, visible: true, opacity: 1 }), false)
  // First capture of a hidden water view stores opacity 1; later holds store 0.
  assert.equal(viewsApproximatelyEqual(water, { ...water, opacity: 1 }), true)
})

test('viewsApproximatelyEqual detects atom size changes', () => {
  const ion = /** @type {any} */ ({
    id: 'ion',
    visible: true,
    opacity: 1,
    selection: 'ion',
    representation: { type: 'vdw' },
    colorScheme: { name: 'cpk' },
    atomScale: 1
  })
  assert.equal(viewsApproximatelyEqual(ion, { ...ion }), true)
  assert.equal(viewsApproximatelyEqual(ion, { ...ion, atomScale: 1.4 }), false)
  assert.equal(viewsApproximatelyEqual(ion, { ...ion, bondScale: 2 }), false)
  assert.equal(viewsApproximatelyEqual({ ...ion, atomScale: undefined }, ion), true)
})
