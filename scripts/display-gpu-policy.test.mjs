import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const {
  WSL_LIB_DIR,
  WSL_DXG_PATH,
  WSL_D3D12_PATH,
  getGpuPolicyPath,
  persistGpuSafeMode,
  applyDisplayGpuEnv,
  buildDisplayGpuShell
} = require('./display-gpu-policy.cjs')

function makeFs(paths) {
  const files = { ...paths }
  return {
    accessSync(p) {
      if (Object.prototype.hasOwnProperty.call(files, p)) return
      const err = new Error(`ENOENT: ${p}`)
      err.code = 'ENOENT'
      throw err
    },
    readFileSync(p) {
      if (!Object.prototype.hasOwnProperty.call(files, p)) {
        const err = new Error(`ENOENT: ${p}`)
        err.code = 'ENOENT'
        throw err
      }
      return files[p]
    },
    writeFileSync(p, data) {
      files[p] = String(data)
    },
    mkdirSync() {},
    unlinkSync(p) {
      delete files[p]
    },
    _files: files
  }
}

function wslGpuFs(extra = {}) {
  return makeFs({
    [WSL_DXG_PATH]: '',
    [WSL_D3D12_PATH]: '',
    [WSL_LIB_DIR]: '',
    ...extra
  })
}

test('darwin persist path is Library/gatewizard-gui', () => {
  assert.equal(
    getGpuPolicyPath({ platform: 'darwin', homedir: '/Users/ada' }),
    path.join('/Users/ada', 'Library', 'gatewizard-gui', 'gpu-policy.json')
  )
})

test('linux persist path is .config/gatewizard-gui', () => {
  assert.equal(
    getGpuPolicyPath({ platform: 'linux', homedir: '/home/ada' }),
    path.join('/home/ada', '.config', 'gatewizard-gui', 'gpu-policy.json')
  )
})

test('darwin does not set GALLIUM_DRIVER', () => {
  const env = {}
  const logs = []
  const result = applyDisplayGpuEnv(env, {
    platform: 'darwin',
    fs: makeFs({}),
    persistPath: '/tmp/gpu-policy.json',
    log: (line) => logs.push(line)
  })
  assert.equal(result.policy, 'metal')
  assert.equal(env.GALLIUM_DRIVER, undefined)
  assert.equal(env.MESA_D3D12_DEFAULT_ADAPTER_NAME, undefined)
  assert.match(logs.join('\n'), /\[gpu\] policy=metal reason=darwin/)
})

test('native Linux does not set GALLIUM_DRIVER', () => {
  const env = {}
  const result = applyDisplayGpuEnv(env, {
    platform: 'linux',
    fs: makeFs({}),
    persistPath: '/tmp/gpu-policy.json',
    log: () => {}
  })
  assert.equal(result.policy, 'leave')
  assert.equal(result.reason, 'native-linux')
  assert.equal(env.GALLIUM_DRIVER, undefined)
})

test('WSL + GPU files sets d3d12 and LD_LIBRARY_PATH', () => {
  const env = { WSL_DISTRO_NAME: 'Ubuntu-26.04' }
  const result = applyDisplayGpuEnv(env, {
    platform: 'linux',
    fs: wslGpuFs(),
    persistPath: '/tmp/gpu-policy.json',
    log: () => {}
  })
  assert.equal(result.policy, 'd3d12')
  assert.equal(env.GALLIUM_DRIVER, 'd3d12')
  assert.ok(
    String(env.LD_LIBRARY_PATH || '')
      .split(':')
      .includes(WSL_LIB_DIR)
  )
  assert.equal(env.MESA_D3D12_DEFAULT_ADAPTER_NAME, undefined)
})

test('WSL missing dxg leaves GALLIUM_DRIVER unset', () => {
  const env = { WSL_DISTRO_NAME: 'Ubuntu' }
  const result = applyDisplayGpuEnv(env, {
    platform: 'linux',
    fs: makeFs({ [WSL_D3D12_PATH]: '', [WSL_LIB_DIR]: '' }),
    persistPath: '/tmp/gpu-policy.json',
    log: () => {}
  })
  assert.equal(result.policy, 'leave')
  assert.equal(result.reason, 'wsl-no-gpu')
  assert.equal(env.GALLIUM_DRIVER, undefined)
})

test('WSL missing libd3d12.so leaves GALLIUM_DRIVER unset', () => {
  const env = { WSL_DISTRO_NAME: 'Ubuntu' }
  const result = applyDisplayGpuEnv(env, {
    platform: 'linux',
    fs: makeFs({ [WSL_DXG_PATH]: '', [WSL_LIB_DIR]: '' }),
    persistPath: '/tmp/gpu-policy.json',
    log: () => {}
  })
  assert.equal(result.reason, 'wsl-no-gpu')
  assert.equal(env.GALLIUM_DRIVER, undefined)
})

test('existing GALLIUM_DRIVER is left unchanged', () => {
  const env = { WSL_DISTRO_NAME: 'Ubuntu', GALLIUM_DRIVER: 'zink' }
  const result = applyDisplayGpuEnv(env, {
    platform: 'linux',
    fs: wslGpuFs(),
    persistPath: '/tmp/gpu-policy.json',
    log: () => {}
  })
  assert.equal(result.policy, 'honor')
  assert.equal(env.GALLIUM_DRIVER, 'zink')
})

test('GATEWIZARD_GALLIUM_DRIVER=llvmpipe wins over auto d3d12', () => {
  const env = {
    WSL_DISTRO_NAME: 'Ubuntu',
    GATEWIZARD_GALLIUM_DRIVER: 'llvmpipe'
  }
  const result = applyDisplayGpuEnv(env, {
    platform: 'linux',
    fs: wslGpuFs(),
    persistPath: '/tmp/gpu-policy.json',
    log: () => {}
  })
  assert.equal(result.policy, 'honor')
  assert.equal(env.GALLIUM_DRIVER, 'llvmpipe')
})

test('empty GATEWIZARD_GALLIUM_DRIVER disables auto d3d12', () => {
  const env = { WSL_DISTRO_NAME: 'Ubuntu', GATEWIZARD_GALLIUM_DRIVER: '' }
  const result = applyDisplayGpuEnv(env, {
    platform: 'linux',
    fs: wslGpuFs(),
    persistPath: '/tmp/gpu-policy.json',
    log: () => {}
  })
  assert.equal(result.policy, 'honor')
  assert.equal(result.reason, 'GATEWIZARD_GALLIUM_DRIVER-empty')
  assert.equal(env.GALLIUM_DRIVER, undefined)
})

test('persisted safeMode skips d3d12 and sets GATEWIZARD_GPU_SAFE_MODE', () => {
  const persistPath = '/tmp/gw-gpu-policy.json'
  const fs = wslGpuFs({
    [persistPath]: JSON.stringify({ safeMode: true, reason: 'test', at: '2026-01-01' })
  })
  const env = { WSL_DISTRO_NAME: 'Ubuntu' }
  const result = applyDisplayGpuEnv(env, {
    platform: 'linux',
    fs,
    persistPath,
    log: () => {}
  })
  assert.equal(result.policy, 'safe')
  assert.equal(env.GATEWIZARD_GPU_SAFE_MODE, '1')
  assert.equal(env.GALLIUM_DRIVER, undefined)
})

test('GATEWIZARD_GPU_RETRY=1 ignores persist and applies d3d12', () => {
  const persistPath = '/tmp/gw-gpu-policy.json'
  const fs = wslGpuFs({
    [persistPath]: JSON.stringify({ safeMode: true, reason: 'test' })
  })
  const env = { WSL_DISTRO_NAME: 'Ubuntu', GATEWIZARD_GPU_RETRY: '1' }
  const result = applyDisplayGpuEnv(env, {
    platform: 'linux',
    fs,
    persistPath,
    log: () => {}
  })
  assert.equal(result.policy, 'd3d12')
  assert.equal(env.GALLIUM_DRIVER, 'd3d12')
  assert.equal(fs._files[persistPath], undefined)
})

test('never writes MESA_D3D12_DEFAULT_ADAPTER_NAME', () => {
  const env = { WSL_DISTRO_NAME: 'Ubuntu' }
  applyDisplayGpuEnv(env, {
    platform: 'linux',
    fs: wslGpuFs(),
    persistPath: '/tmp/gpu-policy.json',
    log: () => {}
  })
  assert.ok(!Object.prototype.hasOwnProperty.call(env, 'MESA_D3D12_DEFAULT_ADAPTER_NAME'))
})

test('persistGpuSafeMode writes safeMode json', () => {
  const persistPath = '/tmp/gw-written-gpu-policy.json'
  const fs = makeFs({})
  persistGpuSafeMode('child-process-gone:crashed', {
    fs,
    persistPath,
    at: '2026-09-01T00:00:00.000Z'
  })
  const written = JSON.parse(fs._files[persistPath])
  assert.equal(written.safeMode, true)
  assert.equal(written.reason, 'child-process-gone:crashed')
  assert.equal(written.at, '2026-09-01T00:00:00.000Z')
})

test('buildDisplayGpuShell is valid dash/sh', () => {
  const { execFileSync } = require('node:child_process')
  execFileSync('sh', ['-n', '-c', `#!/bin/sh\n${buildDisplayGpuShell()}`], {
    encoding: 'utf8'
  })
})
