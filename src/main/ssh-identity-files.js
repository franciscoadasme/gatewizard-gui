import { accessSync, constants, readdirSync, readFileSync, statSync } from 'fs'
import { homedir } from 'os'
import path from 'path'

/** Standard OpenSSH private key basenames, best-first. */
export const PREFERRED_SSH_KEY_NAMES = ['id_ed25519', 'id_ecdsa', 'id_rsa', 'id_dsa']

const SKIP_BASENAMES = new Set([
  'authorized_keys',
  'authorized_keys2',
  'config',
  'environment',
  'known_hosts',
  'known_hosts.old'
])

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isSshPublicKeyFilename(name) {
  return name.endsWith('.pub') || name.endsWith('-cert.pub')
}

/**
 * @param {Buffer} buf
 * @returns {boolean}
 */
export function looksLikePrivateKeyFile(buf) {
  const head = buf.slice(0, 80).toString('utf8')
  return /BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY/.test(head)
}

/**
 * @param {string} absolutePath
 * @param {string} home
 * @returns {string}
 */
export function toTildePath(absolutePath, home) {
  const abs = path.resolve(absolutePath).replace(/\\/g, '/')
  const h = path.resolve(home).replace(/\\/g, '/')
  if (abs === h) return '~'
  if (abs.startsWith(`${h}/`)) {
    return `~${abs.slice(h.length)}`
  }
  return absolutePath.replace(/\\/g, '/')
}

/**
 * List readable SSH private keys under ~/.ssh.
 *
 * @param {{ homedir?: string, fs?: object }} [opts]
 * @returns {{ sshDir: string, exists: boolean, keys: { name: string, path: string }[] }}
 */
export function listSshIdentityFiles(opts = {}) {
  const home = opts.homedir || homedir()
  const sshDir = path.join(home, '.ssh')
  const fs = opts.fs || {
    accessSync,
    constants,
    readdirSync,
    readFileSync,
    statSync
  }
  const readMode = fs.constants?.R_OK ?? constants.R_OK

  try {
    fs.accessSync(sshDir)
  } catch {
    return { sshDir: toTildePath(sshDir, home), exists: false, keys: [] }
  }

  /** @type {string[]} */
  let names = []
  try {
    names = fs.readdirSync(sshDir)
  } catch {
    return { sshDir: toTildePath(sshDir, home), exists: true, keys: [] }
  }

  /** @type {{ name: string, path: string, order: number }[]} */
  const keys = []
  for (const name of names) {
    if (!name || name.startsWith('.')) continue
    if (SKIP_BASENAMES.has(name)) continue
    if (isSshPublicKeyFilename(name)) continue
    if (/\.(lock|sock)$/i.test(name)) continue

    const full = path.join(sshDir, name)
    try {
      const st = fs.statSync(full)
      if (!st.isFile()) continue
      fs.accessSync(full, readMode)
    } catch {
      continue
    }

    const isStandard = PREFERRED_SSH_KEY_NAMES.includes(name) || /^id_/.test(name)
    let accepted = isStandard
    if (!accepted) {
      try {
        const buf = fs.readFileSync(full)
        accepted = looksLikePrivateKeyFile(buf)
      } catch {
        accepted = false
      }
    }
    if (!accepted) continue

    const order = PREFERRED_SSH_KEY_NAMES.indexOf(name)
    keys.push({
      name,
      path: toTildePath(full, home),
      order: order >= 0 ? order : 100 + keys.length
    })
  }

  keys.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
  return {
    sshDir: toTildePath(sshDir, home),
    exists: true,
    keys: keys.map(({ name, path: keyPath }) => ({ name, path: keyPath }))
  }
}
