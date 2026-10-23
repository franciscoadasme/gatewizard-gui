import assert from 'node:assert/strict'
import test from 'node:test'
import { nextTimelineZoom, timelineZoomMax } from './timelineZoom.js'

test('timeline zoom stays at fit and can show about 4 seconds of a 600 s movie', () => {
  assert.equal(nextTimelineZoom(1, -1, 600), 1)
  assert.equal(nextTimelineZoom(0.2, -1, 10), 1)
  const maxZoom = timelineZoomMax(600)
  assert.ok(Math.abs(600 / maxZoom - 4) < 0.01)
  let zoom = 1
  for (let i = 0; i < 20; i += 1) zoom = nextTimelineZoom(zoom, 1, 600)
  assert.equal(zoom, maxZoom)
  assert.ok(maxZoom <= 512)
})
