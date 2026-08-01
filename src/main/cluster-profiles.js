/**
 * Persist cluster profiles under Electron userData (no passwords).
 */
import fs from 'fs/promises'
import path from 'path'
import { getGatewizardDataRoot } from './runtime-bootstrap.js'

const FILE_NAME = 'clusters.json'

function profilesPath() {
  return path.join(getGatewizardDataRoot(), FILE_NAME)
}

/**
 * @returns {Promise<{ profiles: object[] }>}
 */
export async function loadClusterProfiles() {
  const file = profilesPath()
  try {
    const raw = await fs.readFile(file, 'utf8')
    const data = JSON.parse(raw)
    const profiles = Array.isArray(data?.profiles) ? data.profiles : []
    return { profiles }
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err instanceof SyntaxError)) {
      return { profiles: [] }
    }
    throw err
  }
}

/**
 * @param {{ profiles: object[] }} payload
 */
export async function saveClusterProfiles(payload) {
  const root = getGatewizardDataRoot()
  await fs.mkdir(root, { recursive: true })
  // Defensive plain-object copy (renderer may send Proxies in some paths)
  const rawProfiles = Array.isArray(payload?.profiles) ? payload.profiles : []
  const profiles = JSON.parse(JSON.stringify(rawProfiles))
  const cleaned = profiles.map((p) => {
    if (!p || typeof p !== 'object') return p
    const { password: _pw, passphrase: _pp, ...rest } = p
    return rest
  })
  const file = profilesPath()
  await fs.writeFile(file, JSON.stringify({ profiles: cleaned }, null, 2), 'utf8')
  return { profiles: cleaned }
}
