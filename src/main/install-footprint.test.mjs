import test from 'node:test'
import assert from 'node:assert/strict'
import {
  collectInstallFootprint,
  formatByteSize,
  parseDpkgInstalledBytes,
  parseDuBytes,
  parseOsReleasePretty,
  parseWslVersionOutput
} from './install-footprint.js'

test('formatByteSize uses one decimal above bytes', () => {
  assert.equal(formatByteSize(0), '0 B')
  assert.equal(formatByteSize(1536), '1.5 KB')
  assert.equal(formatByteSize(5.4 * 1024 * 1024 * 1024), '5.4 GB')
  assert.equal(formatByteSize(null), null)
})

test('parseWslVersionOutput reads wsl.exe --version', () => {
  const text = 'WSL version: 2.4.13.0\nKernel version: 5.15.167.4-1\n'
  assert.equal(parseWslVersionOutput(text), '2.4.13.0')
  assert.equal(parseWslVersionOutput(''), null)
})

test('parseOsReleasePretty reads PRETTY_NAME', () => {
  const text = 'NAME="Ubuntu"\nVERSION_ID="24.04"\nPRETTY_NAME="Ubuntu 24.04.3 LTS"\n'
  assert.equal(parseOsReleasePretty(text), 'Ubuntu 24.04.3 LTS')
})

test('parseDuBytes and dpkg size', () => {
  assert.equal(parseDuBytes('5480000000\t/home/ada/.config/gatewizard-gui/mamba-env\n'), 5480000000)
  assert.equal(parseDpkgInstalledBytes('186432\n'), 186432 * 1024)
})

test('collectInstallFootprint reports WSL, the deb, and mamba-env', async () => {
  const files = {
    '/proc/version': 'Linux version 5.15.0-microsoft-standard-WSL2',
    '/etc/os-release': 'PRETTY_NAME="Ubuntu 26.04 LTS"\n'
  }
  const result = await collectInstallFootprint({
    platform: 'linux',
    runtimePrefix: '/home/ada/.config/gatewizard-gui/mamba-env',
    packaged: true,
    execPath: '/opt/GateWizard GUI/gatewizard-gui-linux',
    readFile: (filePath) => {
      if (!Object.prototype.hasOwnProperty.call(files, filePath)) {
        const err = new Error('ENOENT')
        throw err
      }
      return files[filePath]
    },
    run: async (command, args) => {
      if (command === 'wsl.exe') return 'WSL version: 2.4.13.0\n'
      if (command === 'dpkg-query') return '180000'
      if (command === 'du' && args.includes('/home/ada/.config/gatewizard-gui/mamba-env')) {
        return '5800000000\t/home/ada/.config/gatewizard-gui/mamba-env\n'
      }
      return ''
    }
  })
  assert.deepEqual(result.wsl, { version: '2.4.13.0', distro: 'Ubuntu 26.04 LTS' })
  assert.equal(result.appBytes, 180000 * 1024)
  assert.equal(result.appLabel, formatByteSize(180000 * 1024))
  assert.equal(result.runtimeBytes, 5800000000)
  assert.equal(result.runtimeLabel, '5.4 GB')
})

test('collectInstallFootprint skips WSL on native Linux', async () => {
  const result = await collectInstallFootprint({
    platform: 'linux',
    env: {},
    runtimePrefix: '/home/ada/.config/gatewizard-gui/mamba-env',
    readFile: () => {
      throw new Error('ENOENT')
    },
    run: async (command) => (command === 'du' ? '1024\t/tmp\n' : '')
  })
  assert.equal(result.wsl, null)
  assert.equal(result.runtimeBytes, 1024)
})
