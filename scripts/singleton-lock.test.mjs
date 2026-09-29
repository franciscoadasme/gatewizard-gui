import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const {
  parseSingletonLockPid,
  clearStaleSingletonLock,
  buildSingletonLockShell,
  getSingletonUserDataDir
} = require('./singleton-lock.cjs')

test('parseSingletonLockPid reads hostname-pid', () => {
  assert.equal(parseSingletonLockPid('MB-12345'), 12345)
  assert.equal(parseSingletonLockPid('host-with-dashes-9'), 9)
  assert.equal(parseSingletonLockPid('nope'), null)
  assert.equal(parseSingletonLockPid('host-'), null)
  assert.equal(parseSingletonLockPid(''), null)
})

test('getSingletonUserDataDir uses XDG-style path on linux', () => {
  assert.equal(
    getSingletonUserDataDir({ platform: 'linux', homedir: '/home/u' }),
    path.join('/home/u', '.config', 'gatewizard-gui')
  )
})

test('clearStaleSingletonLock removes files when PID is dead', () => {
  const removed = []
  const result = clearStaleSingletonLock('/tmp/gw-ud', {
    platform: 'linux',
    lstatSync: () => ({ isSymbolicLink: () => true }),
    readlinkSync: () => 'MB-4242',
    rmSync: (p) => {
      removed.push(p)
    },
    existsSync: () => false,
    kill: () => {
      const err = new Error('ESRCH')
      /** @type {any} */ (err).code = 'ESRCH'
      throw err
    }
  })
  assert.equal(result.cleared, true)
  assert.equal(result.pid, 4242)
  assert.ok(removed.some((p) => String(p).endsWith('SingletonLock')))
  assert.ok(removed.some((p) => String(p).endsWith('SingletonSocket')))
  assert.ok(removed.some((p) => String(p).endsWith('SingletonCookie')))
})

test('clearStaleSingletonLock keeps lock when PID is alive', () => {
  const removed = []
  const result = clearStaleSingletonLock('/tmp/gw-ud', {
    platform: 'linux',
    lstatSync: () => ({ isSymbolicLink: () => true }),
    readlinkSync: () => 'MB-7',
    rmSync: (p) => {
      removed.push(p)
    },
    kill: () => true
  })
  assert.equal(result.cleared, false)
  assert.equal(result.reason, 'alive')
  assert.equal(removed.length, 0)
})

test('clearStaleSingletonLock drops orphan socket without lock', () => {
  const removed = []
  const result = clearStaleSingletonLock('/tmp/gw-ud', {
    platform: 'linux',
    lstatSync: () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    },
    existsSync: (p) => String(p).endsWith('SingletonSocket'),
    rmSync: (p) => {
      removed.push(p)
    }
  })
  assert.equal(result.cleared, true)
  assert.equal(result.reason, 'orphan-socket')
  assert.ok(removed.some((p) => String(p).endsWith('SingletonSocket')))
})

test('buildSingletonLockShell mentions lock cleanup', () => {
  const sh = buildSingletonLockShell()
  assert.match(sh, /SingletonLock/)
  assert.match(sh, /kill -0/)
  assert.match(sh, /SingletonSocket/)
})

test('buildSingletonLockShell is valid dash/sh', { skip: process.platform === 'win32' }, () => {
  execFileSync('sh', ['-n', '-c', `#!/bin/sh\n${buildSingletonLockShell()}`], {
    encoding: 'utf8'
  })
})
