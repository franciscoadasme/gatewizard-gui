import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  parseLddMissing,
  formatMissingLibsHelp,
  aptInstallLine,
  missingLibsForBinary,
  buildWrapperScript,
  ubuntuReleaseBefore
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

test('ubuntuReleaseBefore allows 24.04 and 26.04 and refuses 22.04', () => {
  assert.equal(ubuntuReleaseBefore('22.04'), true)
  assert.equal(ubuntuReleaseBefore('20.04'), true)
  assert.equal(ubuntuReleaseBefore('24.04'), false)
  assert.equal(ubuntuReleaseBefore('24.10'), false)
  assert.equal(ubuntuReleaseBefore('26.04'), false)
  assert.equal(ubuntuReleaseBefore(''), false)
})

test('buildWrapperScript is a POSIX launcher that execs the real ELF', () => {
  const sh = buildWrapperScript('gatewizard-gui-linux.bin')
  assert.match(sh, /^#!\/bin\/sh\n/)
  assert.match(sh, /gatewizard-gui-linux\.bin/)
  assert.match(sh, /libasound\.so\.2/)
  assert.match(sh, /libasound2t64/)
  assert.match(sh, /GATEWIZARD_LAUNCH_CWD/)
  assert.match(sh, /exec "\$bin" "\$@"/)
  assert.doesNotMatch(sh, /mkfifo/)
  assert.doesNotMatch(sh, /gw_err_fifo/)
  assert.match(sh, /GALLIUM_DRIVER=d3d12/)
  assert.match(sh, /ELECTRON_OZONE_PLATFORM_HINT=x11/)
  assert.match(sh, /GPUCache/)
  assert.match(sh, /SingletonLock/)
  assert.match(sh, /kill -0/)
  assert.doesNotMatch(sh, /process_singleton_posix/)
  assert.match(sh, /dbus-daemon/)
  assert.match(sh, /gatewizard-bus/)
  assert.match(sh, /\[ ! -S "\$gw_sock" \]/)
  assert.doesNotMatch(sh, /rm[^\n]*gatewizard-bus/)
  assert.match(sh, /GateWizard GUI on WSL requires Ubuntu 24\.04 or newer/)
  assert.match(sh, /refuse_old_wsl_ubuntu/)
  assert.match(sh, /cannot install yet/)
  assert.match(sh, /sudo apt update/)
  assert.match(sh, /flock -n 9/)
  assert.match(sh, /GateWizard is already open/)
  assert.doesNotMatch(sh, /wsl\.exe --shutdown/)
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
  const procVersion = join(dir, 'proc-version')
  await writeFile(binPath, '#!/bin/sh\necho should-not-run\n', { mode: 0o755 })
  await writeFile(wrapPath, buildWrapperScript('gatewizard-gui-linux.bin'), { mode: 0o755 })
  await writeFile(procVersion, 'Linux version 6.6.0\n')
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
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH || '/usr/bin'}`,
        GATEWIZARD_PROC_VERSION: procVersion,
        GATEWIZARD_WSL_INTEROP: join(dir, 'no-wsl-interop'),
        GATEWIZARD_SKIP_DEB_LIBS: '1'
      }
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

test('preinst refuses WSL Ubuntu 22.04 and allows 24.04, 26.04, native, and Debian', async () => {
  const { mkdtemp, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const { execFileSync } = await import('node:child_process')

  const dir = await mkdtemp(join(tmpdir(), 'gw-wsl-ubuntu-'))
  const preinst = join(dirname(fileURLToPath(import.meta.url)), 'wsl-ubuntu-preinst.sh')
  const procWsl = join(dir, 'proc-wsl')
  const procNative = join(dir, 'proc-native')
  const noInterop = join(dir, 'no-wsl-interop')
  await writeFile(procWsl, 'Linux version 5.15.0-microsoft-standard-WSL2\n')
  await writeFile(procNative, 'Linux version 6.8.0-generic\n')

  const osRelease = async (id, version) => {
    const file = join(dir, `os-${id}-${version}`)
    await writeFile(file, `ID=${id}\nVERSION_ID="${version}"\n`)
    return file
  }

  const run = (osFile, procFile) => {
    try {
      execFileSync('sh', [preinst], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GATEWIZARD_PROC_VERSION: procFile,
          GATEWIZARD_WSL_INTEROP: noInterop,
          GATEWIZARD_OS_RELEASE: osFile,
          GATEWIZARD_SKIP_DEB_LIBS: '1'
        }
      })
      return { status: 0, stderr: '' }
    } catch (err) {
      return { status: err.status, stderr: String(err.stderr || '') }
    }
  }

  const old = run(await osRelease('ubuntu', '22.04'), procWsl)
  assert.equal(old.status, 1)
  assert.match(old.stderr, /requires Ubuntu 24\.04 or newer/)
  assert.match(old.stderr, /Ubuntu 22\.04/)

  assert.equal(run(await osRelease('ubuntu', '24.04'), procWsl).status, 0)
  assert.equal(run(await osRelease('ubuntu', '26.04'), procWsl).status, 0)
  assert.equal(run(await osRelease('ubuntu', '22.04'), procNative).status, 0)
  assert.equal(run(await osRelease('debian', '12'), procWsl).status, 0)
})

test('preinst tells the user to apt update when Electron libraries are missing', async () => {
  const { mkdtemp, writeFile, chmod } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const { execFileSync } = await import('node:child_process')

  const dir = await mkdtemp(join(tmpdir(), 'gw-deb-libs-'))
  const preinst = join(dirname(fileURLToPath(import.meta.url)), 'wsl-ubuntu-preinst.sh')
  const query = join(dir, 'dpkg-query')
  const procNative = join(dir, 'proc-native')
  const osRelease = join(dir, 'os-release')
  await writeFile(procNative, 'Linux version 6.8.0-generic\n')
  await writeFile(osRelease, 'ID=ubuntu\nVERSION_ID="26.04"\n')
  await writeFile(
    query,
    `#!/bin/sh
pkg=
prev=
for arg in "$@"; do
  if [ "$prev" = "-f" ]; then
    :
  fi
  prev=$arg
  pkg=$arg
done
case $pkg in
  libasound2t64|libasound2) exit 1 ;;
esac
printf '%s' 'install ok installed'
`,
    { mode: 0o755 }
  )
  await chmod(query, 0o755)

  const env = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH || '/usr/bin'}`,
    GATEWIZARD_PROC_VERSION: procNative,
    GATEWIZARD_WSL_INTEROP: join(dir, 'no-wsl-interop'),
    GATEWIZARD_OS_RELEASE: osRelease
  }
  let err
  try {
    execFileSync('sh', [preinst], { encoding: 'utf8', env })
  } catch (e) {
    err = e
  }
  assert.ok(err, 'missing ALSA should stop the install')
  assert.equal(err.status, 1)
  const stderr = String(err.stderr || '')
  assert.match(stderr, /cannot install yet/)
  assert.match(stderr, /libasound2t64 or libasound2/)
  assert.match(stderr, /-{10,}/)
  assert.match(stderr, /1\. sudo apt update/)
  assert.match(stderr, /2\. sudo apt install libasound2t64/)
  assert.match(stderr, /404 Not Found/)
  assert.doesNotMatch(stderr, /libgtk-3-0t64 or libgtk-3-0/)
  assert.doesNotMatch(stderr, /apt install libgtk-3-0t64/)
})

test('preinst asks for a C compiler before the first Python install', async () => {
  const { mkdtemp, writeFile, chmod, symlink } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const { execFileSync } = await import('node:child_process')

  const dir = await mkdtemp(join(tmpdir(), 'gw-deb-cc-'))
  const preinst = join(dirname(fileURLToPath(import.meta.url)), 'wsl-ubuntu-preinst.sh')
  const query = join(dir, 'dpkg-query')
  const procNative = join(dir, 'proc-native')
  const osRelease = join(dir, 'os-release')
  await writeFile(procNative, 'Linux version 6.8.0-generic\n')
  await writeFile(osRelease, 'ID=ubuntu\nVERSION_ID="26.04"\n')
  await writeFile(
    query,
    `#!/bin/sh
printf '%s' 'install ok installed'
`,
    { mode: 0o755 }
  )
  await chmod(query, 0o755)
  await symlink('/bin/sh', join(dir, 'sh'))

  const env = {
    ...process.env,
    PATH: dir,
    GATEWIZARD_PROC_VERSION: procNative,
    GATEWIZARD_WSL_INTEROP: join(dir, 'no-wsl-interop'),
    GATEWIZARD_OS_RELEASE: osRelease
  }
  let err
  try {
    execFileSync('sh', [preinst], { encoding: 'utf8', env })
  } catch (e) {
    err = e
  }
  assert.ok(err, 'missing cc should stop the install')
  assert.equal(err.status, 1)
  const stderr = String(err.stderr || '')
  assert.match(stderr, /cannot install yet/)
  assert.match(stderr, /C compiler/)
  assert.match(stderr, /-{10,}/)
  assert.match(stderr, /1\. sudo apt update/)
  assert.match(stderr, /2\. sudo apt install build-essential/)
  assert.doesNotMatch(stderr, /Chromium needs them/)
  assert.doesNotMatch(stderr, /libasound2/)
})

test('preinst accepts libdrm2 when dpkg prints the installed status twice', async () => {
  const { mkdtemp, writeFile, chmod, symlink } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const { execFileSync } = await import('node:child_process')

  const dir = await mkdtemp(join(tmpdir(), 'gw-deb-drm-'))
  const preinst = join(dirname(fileURLToPath(import.meta.url)), 'wsl-ubuntu-preinst.sh')
  const query = join(dir, 'dpkg-query')
  const procNative = join(dir, 'proc-native')
  const osRelease = join(dir, 'os-release')
  await writeFile(procNative, 'Linux version 6.8.0-generic\n')
  await writeFile(osRelease, 'ID=linuxmint\nVERSION_ID="21.1"\n')
  await writeFile(
    query,
    `#!/bin/sh
pkg=
for arg in "$@"; do
  pkg=$arg
done
if [ "$pkg" = libdrm2 ]; then
  printf '%s' 'install ok installedinstall ok installed'
  exit 0
fi
printf '%s' 'install ok installed'
`,
    { mode: 0o755 }
  )
  await chmod(query, 0o755)
  await writeFile(join(dir, 'cc'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  await chmod(join(dir, 'cc'), 0o755)
  await symlink('/bin/sh', join(dir, 'sh'))

  const env = {
    ...process.env,
    PATH: dir,
    GATEWIZARD_PROC_VERSION: procNative,
    GATEWIZARD_WSL_INTEROP: join(dir, 'no-wsl-interop'),
    GATEWIZARD_OS_RELEASE: osRelease
  }
  const result = execFileSync('sh', [preinst], { encoding: 'utf8', env })
  assert.equal(result, '')
})
