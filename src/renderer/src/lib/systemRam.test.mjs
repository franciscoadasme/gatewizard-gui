import assert from 'node:assert/strict'
import test from 'node:test'
import { formatSystemRam, pickSystemMemorySample } from './systemRam.js'

test('pickSystemMemorySample prefers Node os total over a Chromium 8 GiB cap', () => {
  const sample = pickSystemMemorySample(
    { total: 32 * 1024 ** 3, free: 14 * 1024 ** 3 },
    { total: 8 * 1024 * 1024, free: 2 * 1024 * 1024 }
  )
  assert.equal(Math.round(sample.totalKb / (1024 * 1024)), 32)
  assert.equal(Math.round(sample.freeKb / (1024 * 1024)), 14)
})

test('formatSystemRam rounds used / total / free', () => {
  const ram = formatSystemRam({
    totalKb: 32 * 1024 * 1024,
    freeKb: 13.6 * 1024 * 1024
  })
  assert.equal(ram.totalGb.toFixed(1), '32.0')
  assert.equal(ram.freeGb.toFixed(1), '13.6')
  assert.equal(ram.usedGb.toFixed(1), '18.4')
  assert.equal(ram.low, false)
  assert.equal(ram.label, '18.4 / 32.0 GB · 13.6 free')
})

test('formatSystemRam flags free under 2 GB', () => {
  const ram = formatSystemRam({
    totalKb: 16 * 1024 * 1024,
    freeKb: 1.5 * 1024 * 1024
  })
  assert.equal(ram.low, true)
  assert.equal(ram.label, '14.5 / 16.0 GB · 1.5 free')
})

test('formatSystemRam treats missing values as zero', () => {
  const ram = formatSystemRam(null)
  assert.equal(ram.label, '0.0 / 0.0 GB · 0.0 free')
  assert.equal(ram.low, true)
})
