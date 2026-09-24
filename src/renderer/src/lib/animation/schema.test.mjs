import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultExportFrame, normalizeExportFrame } from './schema.js'

test('normalizeExportFrame defaults transparentBg to false', () => {
  const empty = normalizeExportFrame({})
  assert.equal(empty.transparentBg, false)
  assert.equal(defaultExportFrame().transparentBg, false)
})

test('normalizeExportFrame preserves transparentBg true', () => {
  const frame = normalizeExportFrame({
    aspectPreset: '16:9',
    width: 1920,
    height: 1080,
    transparentBg: true
  })
  assert.equal(frame.transparentBg, true)
})

test('normalizeExportFrame ignores a truthy non-boolean transparentBg', () => {
  const frame = normalizeExportFrame({ transparentBg: 'yes' })
  assert.equal(frame.transparentBg, false)
})

test('normalizeExportFrame switches MP4 to GIF when transparent', () => {
  const frame = normalizeExportFrame({
    exportFormat: 'mp4',
    transparentBg: true
  })
  assert.equal(frame.transparentBg, true)
  assert.equal(frame.exportFormat, 'gif')
})
