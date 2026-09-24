import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isWslHost,
  parseWindowsMemoryPair,
  readSystemMemoryKb,
  readSystemMemoryKbAsync,
  readWindowsMemoryAsync,
  resetWindowsInstalledCache
} from './systemMemory.js'

test('isWslHost detects WSL interop env', () => {
  assert.equal(isWslHost('win32', {}), false)
  assert.equal(isWslHost('linux', { WSL_DISTRO_NAME: 'Ubuntu' }), true)
  assert.equal(isWslHost('linux', {}, '6.6.0-microsoft-standard-WSL2'), true)
  assert.equal(isWslHost('linux', {}, '6.8.0-generic'), false)
})

test('parseWindowsMemoryPair reads CIM total bytes and free KB', () => {
  const parsed = parseWindowsMemoryPair('17126428672 3352536\r\n')
  assert.ok(parsed)
  assert.equal(parsed.totalBytes, 17126428672)
  assert.equal(parsed.freeBytes, 3352536 * 1024)
  assert.equal(parseWindowsMemoryPair(''), null)
})

test('readSystemMemoryKb prefers Windows host total and free over a WSL 8 GiB guest', () => {
  resetWindowsInstalledCache()
  const sample = readSystemMemoryKb({
    totalmem: () => 8 * 1024 ** 3,
    freemem: () => 2 * 1024 ** 3,
    windowsMemory: { totalBytes: 16 * 1024 ** 3, freeBytes: 9 * 1024 ** 3 },
    platform: 'linux'
  })
  assert.equal(Math.round(sample.totalKb / (1024 * 1024)), 16)
  assert.equal(Math.round(sample.freeKb / (1024 * 1024)), 9)
})

test('readWindowsMemoryAsync uses spawn, not spawnSync', async () => {
  resetWindowsInstalledCache()
  let calls = 0
  const win = await readWindowsMemoryAsync({
    platform: 'linux',
    env: { WSL_DISTRO_NAME: 'Ubuntu' },
    psCandidates: ['powershell.exe'],
    spawn(exe, args) {
      calls += 1
      assert.equal(exe, 'powershell.exe')
      assert.ok(args.includes('-Command'))
      return {
        stdout: {
          on(event, fn) {
            if (event === 'data') fn('17126428672 3352536\n')
          }
        },
        on(event, fn) {
          if (event === 'close') fn(0)
        },
        kill() {}
      }
    }
  })
  assert.equal(calls, 1)
  assert.ok(win)
  assert.equal(win.totalBytes, 17126428672)
})

test('readSystemMemoryKbAsync shares one in-flight PowerShell', async () => {
  resetWindowsInstalledCache()
  let calls = 0
  const deps = {
    platform: 'linux',
    env: { WSL_DISTRO_NAME: 'Ubuntu' },
    totalmem: () => 8 * 1024 ** 3,
    freemem: () => 1 * 1024 ** 3,
    psCandidates: ['powershell.exe'],
    spawn() {
      calls += 1
      return {
        stdout: {
          on(event, fn) {
            if (event === 'data') queueMicrotask(() => fn('17126428672 3352536\n'))
          }
        },
        on(event, fn) {
          if (event === 'close') queueMicrotask(() => fn(0))
        },
        kill() {}
      }
    }
  }
  const [a, b] = await Promise.all([readSystemMemoryKbAsync(deps), readSystemMemoryKbAsync(deps)])
  assert.equal(calls, 1)
  assert.equal(a.totalKb, b.totalKb)
})
