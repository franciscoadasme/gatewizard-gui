import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { getAppConfigDir, clearCorruptedGpuCache, buildGpuCacheShell } = require('./gpu-cache.cjs')

test('getAppConfigDir uses XDG config on Linux', () => {
  assert.equal(
    getAppConfigDir({ platform: 'linux', homedir: '/home/ada' }),
    path.join('/home/ada', '.config', 'gatewizard-gui')
  )
})

test('getAppConfigDir uses Library on macOS', () => {
  assert.equal(
    getAppConfigDir({ platform: 'darwin', homedir: '/Users/ada' }),
    path.join('/Users/ada', 'Library', 'gatewizard-gui')
  )
})

test('clearCorruptedGpuCache no-op when GPUCache is absent', () => {
  const removed = []
  const fs = {
    accessSync(p) {
      throw new Error('missing')
    },
    rmSync(p) {
      removed.push(p)
    }
  }
  assert.equal(clearCorruptedGpuCache('/cfg', fs), false)
  assert.equal(removed.length, 0)
})

test('clearCorruptedGpuCache no-op when index is absent', () => {
  const fs = {
    accessSync() {},
    readdirSync() {
      return ['data_0']
    },
    rmSync() {
      throw new Error('should not remove')
    }
  }
  assert.equal(clearCorruptedGpuCache('/cfg', fs), false)
})

test('clearCorruptedGpuCache removes cache when index exists but data_3 is missing', () => {
  const removed = []
  const fs = {
    accessSync(p, mode) {
      if (String(p).endsWith('GPUCache') && mode == null) return
      if (String(p).endsWith('data_3')) throw new Error('ENOENT')
    },
    readdirSync() {
      return ['index', 'data_0', 'data_1', 'data_2']
    },
    rmSync(p) {
      removed.push(p)
    },
    constants: { R_OK: 4, W_OK: 2 }
  }
  assert.equal(clearCorruptedGpuCache('/cfg', fs), true)
  assert.deepEqual(removed, [path.join('/cfg', 'GPUCache')])
})

test('clearCorruptedGpuCache removes cache when directory cannot be read', () => {
  const removed = []
  const fs = {
    accessSync() {},
    readdirSync() {
      throw new Error('EACCES')
    },
    rmSync(p) {
      removed.push(p)
    }
  }
  assert.equal(clearCorruptedGpuCache('/cfg', fs), true)
  assert.deepEqual(removed, [path.join('/cfg', 'GPUCache')])
})

test('buildGpuCacheShell is valid dash/sh', () => {
  const { execFileSync } = require('node:child_process')
  execFileSync('sh', ['-n', '-c', `#!/bin/sh\n${buildGpuCacheShell()}`], { encoding: 'utf8' })
})
