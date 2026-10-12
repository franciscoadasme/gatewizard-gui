import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  isChromiumDbusNoise,
  unixPathFromAddress,
  ensureSessionDbus,
  buildDbusEnsureShell
} = require('./session-dbus.cjs')

test('isChromiumDbusNoise matches WSL Chromium bus errors', () => {
  assert.equal(
    isChromiumDbusNoise(
      '[3627:0901/145403.141715:ERROR:dbus/bus.cc:408] Failed to connect to the bus: Failed to connect to socket /run/user/1000/bus: No such file or directory\n'
    ),
    true
  )
  assert.equal(
    isChromiumDbusNoise(
      'Failed to connect to socket /run/user/1000/gatewizard-bus: No such file or directory\n'
    ),
    true
  )
  assert.equal(
    isChromiumDbusNoise(
      '[3627:0901/145403.806231:ERROR:dbus/object_proxy.cc:573] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type:\n'
    ),
    true
  )
  assert.equal(isChromiumDbusNoise('[gpu] policy=d3d12 reason=wsl-gpu\n'), false)
  assert.equal(
    isChromiumDbusNoise(
      '[1268:0901/161142.475547:ERROR:net/disk_cache/blockfile/block_files.cc:445] Failed to open /home/ada/.config/gatewizard-gui/GPUCache/data_3\n'
    ),
    true
  )
  assert.equal(
    isChromiumDbusNoise(
      '[37830:0929/124404.706807:ERROR:chrome/browser/process_singleton_posix.cc:186] write() failed: Broken pipe (32)\n'
    ),
    true
  )
})

test('unixPathFromAddress reads unix:path', () => {
  assert.equal(unixPathFromAddress('unix:path=/run/user/1000/bus'), '/run/user/1000/bus')
  assert.equal(unixPathFromAddress('unix:path=/tmp/bus,guid=abc'), '/tmp/bus')
  assert.equal(unixPathFromAddress(''), null)
})

test('ensureSessionDbus skips non-linux', () => {
  const env = {}
  assert.equal(ensureSessionDbus(env, { platform: 'darwin' }).action, 'skip')
  assert.equal(env.DBUS_SESSION_BUS_ADDRESS, undefined)
})

test('ensureSessionDbus prefers live default bus over dead gatewizard-bus', () => {
  const env = {
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/gatewizard-bus',
    XDG_RUNTIME_DIR: '/run/user/1000'
  }
  const defaultBus = '/run/user/1000/bus'
  const result = ensureSessionDbus(env, {
    platform: 'linux',
    uid: 1000,
    fs: { mkdirSync() {}, unlinkSync() {}, accessSync() {} },
    spawnSync: (cmd, args) => {
      const blob = `${cmd} ${Array.isArray(args) ? args.join(' ') : ''}`
      if (blob.includes(defaultBus)) return { status: 0 }
      return { status: 1 }
    }
  })
  assert.equal(result.action, 'keep')
  assert.equal(env.DBUS_SESSION_BUS_ADDRESS, `unix:path=${defaultBus}`)
})

test('ensureSessionDbus clears dead gatewizard-bus when no bus is available', () => {
  const env = {
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/gatewizard-bus',
    XDG_RUNTIME_DIR: '/run/user/1000'
  }
  const result = ensureSessionDbus(env, {
    platform: 'linux',
    uid: 1000,
    homedir: '/home/ada',
    dbusDaemon: null,
    fs: {
      mkdirSync() {},
      unlinkSync() {},
      accessSync() {}
    },
    spawnSync: () => ({ status: 1 })
  })
  assert.equal(result.action, 'none')
  assert.equal(env.DBUS_SESSION_BUS_ADDRESS, undefined)
})

test('ensureSessionDbus starts a private bus only when the default bus is dead', () => {
  const env = { XDG_RUNTIME_DIR: '/run/user/1000' }
  let started = false
  const defaultBus = '/run/user/1000/bus'
  const sock = '/run/user/1000/gatewizard-bus'
  let sockProbes = 0
  const result = ensureSessionDbus(env, {
    platform: 'linux',
    uid: 1000,
    homedir: '/home/ada',
    dbusDaemon: '/usr/bin/dbus-daemon',
    fs: {
      mkdirSync() {},
      unlinkSync() {},
      accessSync() {}
    },
    spawnSync: (cmd, args) => {
      if (cmd === '/usr/bin/dbus-daemon') {
        started = true
        assert.ok(args.some((a) => String(a).includes(sock)))
        return { status: 0 }
      }
      const blob = `${cmd} ${Array.isArray(args) ? args.join(' ') : ''}`
      if (blob.includes(defaultBus)) return { status: 1 }
      if (blob.includes(sock)) {
        sockProbes += 1
        return { status: sockProbes > 1 ? 0 : 1 }
      }
      return { status: 1 }
    }
  })
  assert.equal(started, true)
  assert.equal(result.action, 'started')
  assert.equal(env.DBUS_SESSION_BUS_ADDRESS, `unix:path=${sock}`)
})

test('ensureSessionDbus reuses a live gatewizard-bus when default bus is dead', () => {
  const env = { XDG_RUNTIME_DIR: '/run/user/1000' }
  const sock = '/run/user/1000/gatewizard-bus'
  const result = ensureSessionDbus(env, {
    platform: 'linux',
    uid: 1000,
    dbusDaemon: '/usr/bin/dbus-daemon',
    fs: { mkdirSync() {}, unlinkSync() {}, accessSync() {} },
    spawnSync: (cmd, args) => {
      const blob = `${cmd} ${Array.isArray(args) ? args.join(' ') : ''}`
      if (blob.includes(sock)) return { status: 0 }
      return { status: 1 }
    }
  })
  assert.equal(result.action, 'reuse')
  assert.equal(env.DBUS_SESSION_BUS_ADDRESS, `unix:path=${sock}`)
})

test('packaged Electron reuses one gatewizard-bus and never probes with its own binary', () => {
  const sock = '/run/user/1000/gatewizard-bus'
  const calls = []
  let unlinked = false
  const fs = {
    mkdirSync() {},
    unlinkSync() {
      unlinked = true
    },
    accessSync(target) {
      const name = String(target).replace(/\\/g, '/')
      if (name.endsWith('/gatewizard-bus')) return
      const err = new Error(`ENOENT ${target}`)
      err.code = 'ENOENT'
      throw err
    }
  }
  const spawnSync = (cmd, args) => {
    calls.push({ cmd, args })
    return { status: 0 }
  }
  for (let i = 0; i < 3; i += 1) {
    const env = { XDG_RUNTIME_DIR: '/run/user/1000' }
    const result = ensureSessionDbus(env, {
      platform: 'linux',
      uid: 1000,
      inElectron: true,
      dbusDaemon: '/usr/bin/dbus-daemon',
      fs,
      spawnSync
    })
    assert.equal(result.action, 'reuse')
    assert.equal(env.DBUS_SESSION_BUS_ADDRESS, `unix:path=${sock}`)
  }
  assert.equal(calls.length, 0)
  assert.equal(unlinked, false)
})

test('packaged Electron starts a daemon only when the socket file is missing', () => {
  const calls = []
  const fs = {
    mkdirSync() {},
    unlinkSync() {},
    accessSync() {
      const err = new Error('ENOENT')
      err.code = 'ENOENT'
      throw err
    }
  }
  const result = ensureSessionDbus(
    { XDG_RUNTIME_DIR: '/run/user/1000' },
    {
      platform: 'linux',
      uid: 1000,
      inElectron: true,
      dbusDaemon: '/usr/bin/dbus-daemon',
      fs,
      spawnSync: (cmd, args) => {
        calls.push({ cmd, args })
        return { status: 1 }
      }
    }
  )
  assert.equal(result.action, 'none')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].cmd, '/usr/bin/dbus-daemon')
  assert.equal(
    calls.some((call) => (call.args || []).includes('-e')),
    false
  )
})

test('launcher shell does not remove a live gatewizard-bus', () => {
  const sh = buildDbusEnsureShell()
  assert.match(sh, /\[ ! -S "\$gw_sock" \]/)
  assert.doesNotMatch(sh, /rm[^\n]*gatewizard-bus/)
  assert.doesNotMatch(sh, /unlink/)
})

test('buildDbusEnsureShell prefers default bus and unsets dead private bus', () => {
  const sh = buildDbusEnsureShell()
  assert.match(sh, /gw_default_bus/)
  assert.match(sh, /gatewizard-bus/)
  assert.match(sh, /unset DBUS_SESSION_BUS_ADDRESS/)
  assert.doesNotMatch(sh, /gw_need_bus/)
  assert.doesNotMatch(sh, /`/)
})

test('buildDbusEnsureShell is valid dash/sh', () => {
  execFileSync('sh', ['-n', '-c', `#!/bin/sh\n${buildDbusEnsureShell()}`], {
    encoding: 'utf8'
  })
})
