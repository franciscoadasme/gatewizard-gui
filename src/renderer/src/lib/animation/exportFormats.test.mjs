import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  coerceExportFormat,
  exportFormatsForBackground,
  TRANSPARENT_ANIMATION_EXPORT_FORMATS
} from './exportFormats.js'

test('transparent format list is GIF, WebM, and PNG frames', () => {
  const ids = exportFormatsForBackground(true).map((f) => f.id)
  assert.deepEqual(ids, ['webm', 'gif', 'png'])
  assert.deepEqual([...TRANSPARENT_ANIMATION_EXPORT_FORMATS], ['webm', 'gif', 'png'])
})

test('opaque format list keeps MP4 and MOV', () => {
  const ids = exportFormatsForBackground(false).map((f) => f.id)
  assert.ok(ids.includes('mp4'))
  assert.ok(ids.includes('mov'))
})

test('coerceExportFormat switches MP4 and MOV to GIF when transparent', () => {
  assert.equal(coerceExportFormat('mp4', true), 'gif')
  assert.equal(coerceExportFormat('mov', true), 'gif')
  assert.equal(coerceExportFormat('webm', true), 'webm')
  assert.equal(coerceExportFormat('gif', true), 'gif')
  assert.equal(coerceExportFormat('png', true), 'png')
  assert.equal(coerceExportFormat('mp4', false), 'mp4')
})
