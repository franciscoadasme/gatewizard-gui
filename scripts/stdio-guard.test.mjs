import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { isBrokenPipeError, writeStdioSafe } = require('./stdio-guard.cjs')

test('isBrokenPipeError matches EPIPE/EIO', () => {
  assert.equal(isBrokenPipeError({ code: 'EPIPE' }), true)
  assert.equal(isBrokenPipeError({ code: 'EIO' }), true)
  assert.equal(isBrokenPipeError({ code: 'ERR_STREAM_DESTROYED' }), true)
  assert.equal(isBrokenPipeError({ code: 'ENOENT' }), false)
  assert.equal(isBrokenPipeError(null), false)
})

test('writeStdioSafe swallows EPIPE and skips destroyed streams', () => {
  const destroyed = { destroyed: true, write() { throw new Error('should not write') } }
  assert.equal(writeStdioSafe(destroyed, 'x'), false)

  const closed = {
    destroyed: false,
    writableEnded: false,
    write() {
      const err = new Error('write EPIPE')
      err.code = 'EPIPE'
      throw err
    }
  }
  assert.equal(writeStdioSafe(closed, 'x'), false)

  const ok = { destroyed: false, writableEnded: false, write() { return true } }
  assert.equal(writeStdioSafe(ok, 'hello'), true)
})

test('writeStdioSafe rethrows unrelated write errors', () => {
  const boom = {
    destroyed: false,
    writableEnded: false,
    write() {
      throw new Error('disk full')
    }
  }
  assert.throws(() => writeStdioSafe(boom, 'x'), /disk full/)
})

test('ignoreBrokenStdio is a function', () => {
  const { ignoreBrokenStdio } = require('./stdio-guard.cjs')
  assert.equal(typeof ignoreBrokenStdio, 'function')
})
