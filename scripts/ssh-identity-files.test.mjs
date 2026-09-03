import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const {
  isSshPublicKeyFilename,
  looksLikePrivateKeyFile,
  toTildePath,
  listSshIdentityFiles
} = require('../src/main/ssh-identity-files.js')

test('isSshPublicKeyFilename matches .pub and cert pub', () => {
  assert.equal(isSshPublicKeyFilename('id_ed25519.pub'), true)
  assert.equal(isSshPublicKeyFilename('id_rsa-cert.pub'), true)
  assert.equal(isSshPublicKeyFilename('id_ed25519'), false)
})

test('looksLikePrivateKeyFile reads PEM headers', () => {
  assert.equal(
    looksLikePrivateKeyFile(Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----\n')),
    true
  )
  assert.equal(looksLikePrivateKeyFile(Buffer.from('not a key')), false)
})

test('toTildePath shortens home directory', () => {
  assert.equal(toTildePath('/home/ada/.ssh/id_ed25519', '/home/ada'), '~/.ssh/id_ed25519')
})

test('listSshIdentityFiles returns preferred keys from ~/.ssh', () => {
  const home = '/home/ada'
  const sshDir = path.join(home, '.ssh')
  const files = {
    [path.join(sshDir, 'id_ed25519')]: '-----BEGIN OPENSSH PRIVATE KEY-----\n',
    [path.join(sshDir, 'id_ed25519.pub')]: 'ssh-ed25519 AAAA',
    [path.join(sshDir, 'id_rsa')]: '-----BEGIN OPENSSH PRIVATE KEY-----\n',
    [path.join(sshDir, 'known_hosts')]: 'host key',
    [path.join(sshDir, 'config')]: 'Host *\n'
  }
  const fs = {
    constants: { R_OK: 4 },
    accessSync(p) {
      if (p === sshDir || files[p] != null) return
      throw new Error(`ENOENT ${p}`)
    },
    readdirSync() {
      return Object.keys(files).map((p) => path.basename(p))
    },
    statSync(p) {
      if (files[p] == null) throw new Error(`ENOENT ${p}`)
      return { isFile: () => true }
    },
    readFileSync(p) {
      return Buffer.from(files[p] || '')
    }
  }
  const result = listSshIdentityFiles({ homedir: home, fs })
  assert.equal(result.exists, true)
  assert.deepEqual(
    result.keys.map((k) => k.path),
    ['~/.ssh/id_ed25519', '~/.ssh/id_rsa']
  )
})

test('listSshIdentityFiles handles missing ~/.ssh', () => {
  const fs = {
    constants: { R_OK: 4 },
    accessSync() {
      throw new Error('ENOENT')
    }
  }
  const result = listSshIdentityFiles({ homedir: '/home/ada', fs })
  assert.equal(result.exists, false)
  assert.deepEqual(result.keys, [])
})
