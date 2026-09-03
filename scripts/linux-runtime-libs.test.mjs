import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  parseLddMissing,
  formatMissingLibsHelp,
  aptInstallLine,
  missingLibsForBinary,
  buildWrapperScript
} = require('./linux-runtime-libs.cjs')

test('parseLddMissing reads unresolved sonames', () => {
  const ldd = `
	linux-vdso.so.1 (0x0000)
	libasound.so.2 => not found
	libgtk-3.so.0 => /usr/lib/libgtk-3.so.0 (0x0000)
	libnss3.so => not found
`
  assert.deepEqual(parseLddMissing(ldd), ['libasound.so.2', 'libnss3.so'])
})

test('formatMissingLibsHelp tells Ubuntu 26.04 users to install libasound2t64', () => {
  const help = formatMissingLibsHelp(['libasound.so.2'])
  assert.match(help, /libasound\.so\.2/)
  assert.match(help, /sudo apt install libasound2t64 \|\| sudo apt install libasound2/)
  assert.match(help, /sudo dnf install alsa-lib/)
  assert.match(help, /does not play sound/)
})

test('aptInstallLine prefers t64 names for ALSA and GTK', () => {
  assert.equal(
    aptInstallLine('libasound.so.2'),
    'sudo apt install libasound2t64 || sudo apt install libasound2'
  )
  assert.match(aptInstallLine('libgtk-3.so.0'), /libgtk-3-0t64/)
})

test('missingLibsForBinary uses injected ldd output', () => {
  const libs = missingLibsForBinary('/tmp', () => '\tlibasound.so.2 => not found\n')
  assert.deepEqual(libs, ['libasound.so.2'])
})

test('buildWrapperScript is a POSIX launcher that execs the real ELF', () => {
  const sh = buildWrapperScript('gatewizard-gui-linux.bin')
  assert.match(sh, /^#!\/bin\/sh\n/)
  assert.match(sh, /gatewizard-gui-linux\.bin/)
  assert.match(sh, /libasound\.so\.2/)
  assert.match(sh, /libasound2t64/)
  assert.match(sh, /exec "\$bin" "\$@" <\/dev\/null/)
  assert.match(sh, /GALLIUM_DRIVER=d3d12/)
  assert.match(sh, /ELECTRON_OZONE_PLATFORM_HINT=x11/)
  assert.match(sh, /GPUCache/)
  assert.match(sh, /dbus-daemon/)
  assert.match(sh, /gatewizard-bus/)
  assert.doesNotMatch(sh, /[^A-Za-z0-9._+-]binName/)
})

test('generated Linux wrapper parses under dash/sh -n', async () => {
  const { mkdtemp, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { execFileSync } = await import('node:child_process')

  const dir = await mkdtemp(join(tmpdir(), 'gw-wrap-syntax-'))
  const wrapPath = join(dir, 'gatewizard-gui-linux')
  await writeFile(wrapPath, buildWrapperScript('gatewizard-gui-linux.bin'), { mode: 0o755 })
  execFileSync('sh', ['-n', wrapPath], { encoding: 'utf8' })
})

test('wrapper prints apt install when ldd reports libasound.so.2 missing', async () => {
  const { mkdtemp, writeFile, chmod } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { execFileSync } = await import('node:child_process')

  const dir = await mkdtemp(join(tmpdir(), 'gw-linux-wrap-'))
  const binPath = join(dir, 'gatewizard-gui-linux.bin')
  const wrapPath = join(dir, 'gatewizard-gui-linux')
  const lddPath = join(dir, 'ldd')
  await writeFile(binPath, '#!/bin/sh\necho should-not-run\n', { mode: 0o755 })
  await writeFile(wrapPath, buildWrapperScript('gatewizard-gui-linux.bin'), { mode: 0o755 })
  await writeFile(
    lddPath,
    '#!/bin/sh\necho "\\tlibasound.so.2 => not found"\n',
    { mode: 0o755 }
  )
  await chmod(binPath, 0o755)
  await chmod(wrapPath, 0o755)
  await chmod(lddPath, 0o755)

  let err
  try {
    execFileSync(wrapPath, [], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH || '/usr/bin'}` }
    })
  } catch (e) {
    err = e
  }
  assert.ok(err, 'wrapper should exit non-zero')
  assert.equal(err.status, 1)
  assert.match(String(err.stderr || ''), /libasound\.so\.2/)
  assert.match(String(err.stderr || ''), /libasound2t64/)
  assert.doesNotMatch(String(err.stdout || ''), /should-not-run/)
})
