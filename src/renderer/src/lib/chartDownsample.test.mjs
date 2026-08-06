import test from 'node:test'
import assert from 'node:assert/strict'
import { downsampleIndices, downsampleXY } from './chartDownsample.js'

test('downsampleIndices returns null when already small', () => {
  assert.equal(downsampleIndices(10, 4000), null)
})

test('downsampleIndices keeps endpoints', () => {
  const idx = downsampleIndices(10001, 5)
  assert.equal(idx[0], 0)
  assert.equal(idx[idx.length - 1], 10000)
  assert.equal(idx.length, 5)
})

test('downsampleXY preserves shape', () => {
  const x = Array.from({ length: 1000 }, (_, i) => i)
  const y = x.map((v) => v * 2)
  const out = downsampleXY(x, y, 10)
  assert.equal(out.x.length, 10)
  assert.equal(out.y[0], 0)
  assert.equal(out.y[9], 1998)
})
