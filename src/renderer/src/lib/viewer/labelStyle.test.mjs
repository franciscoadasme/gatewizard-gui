import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  hexToRgba,
  labelBackgroundCss,
  labelExportBoxOrigin,
  clearLabelScreenOffset,
  interpolateLabelLift,
  labelLiftVector,
  labelOffsetY,
  labelPadding,
  labelRadius,
  labelScreenPlacement,
  nearestLabelLiftDir,
  normalizeLabelLiftDir
} from './labelStyle.js'

test('hexToRgba converts hex + alpha', () => {
  assert.equal(hexToRgba('#000000', 0.75), 'rgba(0,0,0,0.75)')
  assert.equal(hexToRgba('#ff0000', 1), 'rgba(255,0,0,1)')
  assert.equal(hexToRgba('#0f0', 0.5), 'rgba(0,255,0,0.5)')
})

test('labelBackgroundCss defaults to black at 75% opacity', () => {
  assert.equal(labelBackgroundCss({}), 'rgba(0,0,0,0.75)')
  assert.equal(
    labelBackgroundCss({ background: '#112233', backgroundOpacity: 0.4 }),
    'rgba(17,34,51,0.4)'
  )
})

test('label padding / radius / offset defaults and clamps', () => {
  assert.equal(labelPadding({}), 6)
  assert.equal(labelPadding({ padding: 12 }), 12)
  assert.equal(labelPadding({ padding: 99 }), 24)
  assert.equal(labelRadius({}), 4)
  assert.equal(labelRadius({ radius: 0 }), 0)
  assert.equal(labelOffsetY({}), 22)
  assert.equal(labelOffsetY({ offsetY: 40 }), 40)
})

test('label lift direction placement', () => {
  assert.equal(normalizeLabelLiftDir('left'), 'left')
  assert.equal(normalizeLabelLiftDir('nope'), 'up')
  assert.deepEqual(labelLiftVector({ offsetY: 20, liftDir: 'up' }), { x: 0, y: -20 })
  assert.deepEqual(labelLiftVector({ offsetY: 20, liftDir: 'right' }), { x: 20, y: 0 })
  const up = labelScreenPlacement({ offsetY: 20, liftDir: 'up' })
  assert.equal(up.top, -20)
  assert.equal(up.transform, 'translate(-50%, -50%)')
  const right = labelScreenPlacement({ offsetY: 20, liftDir: 'right' })
  assert.equal(right.left, 20)
  const box = labelExportBoxOrigin({ offsetY: 10, liftDir: 'left' }, 40, 20)
  assert.equal(box.ox, -30)
  assert.equal(box.oy, -10)
  assert.equal(nearestLabelLiftDir(8, -2), 'right')
  assert.equal(nearestLabelLiftDir(-1, -9), 'up')
})

test('screenDX/DY override directional lift for animation frames', () => {
  const place = labelScreenPlacement({
    offsetY: 22,
    liftDir: 'up',
    screenDX: 12,
    screenDY: -8
  })
  assert.equal(place.left, 12)
  assert.equal(place.top, -8)
})

test('interpolateLabelLift slides between directions', () => {
  const mid = interpolateLabelLift(
    { offsetY: 20, liftDir: 'up' },
    { offsetY: 20, liftDir: 'right' },
    0.5
  )
  assert.ok(Math.abs(mid.screenDX - 10) < 1e-6)
  assert.ok(Math.abs(mid.screenDY - -10) < 1e-6)
  assert.ok(Math.abs(mid.offsetY - Math.SQRT2 * 10) < 1e-6)
})

test('clearLabelScreenOffset lets liftDir/offsetY drive placement again', () => {
  const label = {
    offsetY: 30,
    liftDir: 'left',
    screenDX: 12,
    screenDY: -8
  }
  assert.deepEqual(labelLiftVector(label), { x: 12, y: -8 })
  clearLabelScreenOffset(label)
  assert.deepEqual(labelLiftVector(label), { x: -30, y: 0 })
})

test('interpolateLabelLift ignores stale screenDX on keyframe endpoints', () => {
  const mid = interpolateLabelLift(
    { offsetY: 20, liftDir: 'up', screenDX: 99, screenDY: 99 },
    { offsetY: 20, liftDir: 'right', screenDX: -99, screenDY: -99 },
    0.5
  )
  assert.ok(Math.abs(mid.screenDX - 10) < 1e-6)
  assert.ok(Math.abs(mid.screenDY - -10) < 1e-6)
})
