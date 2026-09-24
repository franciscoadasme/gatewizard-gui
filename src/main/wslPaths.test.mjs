import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveWritableDir, sidecarFsCandidates, sidecarReadCandidates } from './wslPaths.js'

test('Windows path also yields /mnt drive path', () => {
  assert.deepEqual(
    sidecarFsCandidates('C:\\Users\\me\\a.gwxyz'),
    ['C:\\Users\\me\\a.gwxyz', '/mnt/c/Users/me/a.gwxyz']
  )
})

test('WSL /mnt path also yields Windows path', () => {
  assert.deepEqual(sidecarFsCandidates('/mnt/c/Users/me/a.gwxyz'), [
    '/mnt/c/Users/me/a.gwxyz',
    'C:\\Users\\me\\a.gwxyz'
  ])
})

test('a finished cache is tried when play still names the partial file', () => {
  assert.deepEqual(sidecarReadCandidates('/mnt/c/Users/me/cache/id.gwxyz.part'), [
    '/mnt/c/Users/me/cache/id.gwxyz.part',
    'C:\\Users\\me\\cache\\id.gwxyz.part',
    '/mnt/c/Users/me/cache/id.gwxyz',
    'C:\\Users\\me\\cache\\id.gwxyz'
  ])
})

test('empty and already-native Linux paths stay single', () => {
  assert.deepEqual(sidecarFsCandidates(''), [])
  assert.deepEqual(sidecarFsCandidates('/home/me/a.gwxyz'), ['/home/me/a.gwxyz'])
})

test('resolveWritableDir prefers the candidate whose parent exists', () => {
  const exists = (p) => p === '/mnt/c/Users/me' || p === '/mnt/c/Users/me/out'
  const dirname = (p) => p.replace(/\\/g, '/').replace(/\/[^/]+$/, '') || '/'
  assert.equal(
    resolveWritableDir('C:\\Users\\me\\out', exists, dirname),
    '/mnt/c/Users/me/out'
  )
  assert.equal(
    resolveWritableDir('C:\\Users\\me\\newfolder', exists, dirname),
    '/mnt/c/Users/me/newfolder'
  )
})
