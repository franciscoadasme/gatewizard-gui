/**
 * Shared cluster SSH session for Equilibration Progress (all job cards).
 */

import { clusterConnect, clusterDisconnect, clusterProbe } from './backendApi.js'
import { formatClusterConnectError } from './clusterConnectError.js'
import { loadClusterProfiles, saveClusterProfiles } from './clusterProfiles.js'

/** @typedef {import('./clusterProfiles.js').ClusterProfile} ClusterProfile */

/** @type {string | null} */
let sessionId = $state(null)
/** @type {ClusterProfile | null} */
let profile = $state(null)
/** @type {object | null} */
let probe = $state(null)
/** @type {string} */
let connectedAt = $state('')
/** @type {boolean} */
let connecting = $state(false)
/** True while SSH is up but inventory probe has not finished. */
let probing = $state(false)
/** @type {string} */
let statusMessage = $state('')
/** @type {boolean} */
let statusError = $state(false)

export function getClusterSession() {
  return {
    get sessionId() {
      return sessionId
    },
    get profile() {
      return profile
    },
    get probe() {
      return probe
    },
    get connectedAt() {
      return connectedAt
    },
    get connecting() {
      return connecting
    },
    get probing() {
      return probing
    },
    get statusMessage() {
      return statusMessage
    },
    get statusError() {
      return statusError
    },
    get connected() {
      return Boolean(sessionId)
    },
    /** Session ready for heavy Watching / log sync (probe finished). */
    get inventoryReady() {
      return Boolean(sessionId && probe && !probing && !connecting)
    }
  }
}

/**
 * Persist probe snapshot on the matching Settings profile (best-effort).
 * @param {ClusterProfile} plain
 * @param {object|null} nextProbe
 * @param {object|null} [apiProfile]
 */
async function persistLastProbe(plain, nextProbe, apiProfile = null) {
  if (!plain?.id || !nextProbe) return
  try {
    const profiles = await loadClusterProfiles()
    const next = profiles.map((p) => {
      if (p.id !== plain.id) return p
      const api = apiProfile || {}
      const keepSubmit = (p.submit_root || '').trim() && !String(p.submit_root).includes('$')
      const keepScratch =
        (p.scratch_root || '').trim() &&
        !['$SCRATCH_DIR', '${SCRATCH_DIR}'].includes(String(p.scratch_root).trim()) &&
        !String(p.scratch_root).includes('$')
      return {
        ...p,
        submit_root: keepSubmit ? p.submit_root : api.submit_root || p.submit_root,
        scratch_root: keepScratch ? p.scratch_root : api.scratch_root || p.scratch_root,
        last_probe: nextProbe
      }
    })
    await saveClusterProfiles(next)
    const saved = next.find((p) => p.id === plain.id)
    if (saved) profile = JSON.parse(JSON.stringify(saved))
  } catch {
    /* Settings write is optional for Connect */
  }
}

/**
 * @param {ClusterProfile} nextProfile
 * @param {string} [password]
 */
export async function connectSharedCluster(nextProfile, password = '') {
  connecting = true
  probing = false
  statusError = false
  statusMessage = 'Connecting…'
  /** @type {string|null} */
  let pendingSessionId = null
  try {
    if (sessionId) {
      await clusterDisconnect({ session_id: sessionId }).catch(() => {})
      sessionId = null
    }
    // Do not publish sessionId/probe until inventory is ready — otherwise
    // Watching / runtime prefetch starts mid-probe and starves sinfo.
    probe = null
    const plain = JSON.parse(JSON.stringify(nextProfile))
    profile = plain
    const conn = await clusterConnect({
      profile: plain,
      password: password || undefined
    })
    pendingSessionId = conn.session_id
    probing = true
    statusMessage = 'Probing partitions & modules…'
    const result = await clusterProbe({
      session_id: pendingSessionId,
      profile: plain
    })
    probe = result.probe || result
    sessionId = pendingSessionId
    pendingSessionId = null
    connectedAt = new Date().toISOString()
    statusMessage = `Connected to ${plain.name || plain.host}`
    statusError = false
    void persistLastProbe(plain, probe, result.profile || null)
    return { sessionId, profile, probe }
  } catch (err) {
    if (pendingSessionId) {
      await clusterDisconnect({ session_id: pendingSessionId }).catch(() => {})
    }
    sessionId = null
    probe = null
    connectedAt = ''
    statusError = true
    statusMessage = formatClusterConnectError(err, nextProfile)
    throw err
  } finally {
    connecting = false
    probing = false
  }
}

export async function disconnectSharedCluster() {
  const sid = sessionId
  sessionId = null
  profile = null
  probe = null
  connectedAt = ''
  statusMessage = ''
  statusError = false
  connecting = false
  probing = false
  if (sid) {
    await clusterDisconnect({ session_id: sid }).catch(() => {})
  }
}

/** Plain profile snapshot for API calls (never send Svelte proxies). */
export function sharedProfilePlain() {
  return profile ? JSON.parse(JSON.stringify(profile)) : null
}

/**
 * Adopt a session created elsewhere (e.g. Cluster dialog) as the shared Progress session.
 * @param {{ sessionId: string, profile: ClusterProfile, probe?: object|null }} opts
 */
export function adoptSharedSession(opts) {
  sessionId = opts.sessionId
  profile = opts.profile ? JSON.parse(JSON.stringify(opts.profile)) : null
  probe = opts.probe || null
  connectedAt = new Date().toISOString()
  statusMessage = `Connected to ${profile?.name || profile?.host || 'cluster'}`
  statusError = false
  connecting = false
  probing = false
  if (profile && probe) {
    void persistLastProbe(profile, probe)
  }
}
