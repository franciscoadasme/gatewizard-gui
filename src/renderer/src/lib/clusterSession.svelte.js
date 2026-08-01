/**
 * Shared cluster SSH session for Equilibration Progress (all job cards).
 */

import { clusterConnect, clusterDisconnect, clusterProbe } from './backendApi.js'
import { formatClusterConnectError } from './clusterConnectError.js'

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
    get statusMessage() {
      return statusMessage
    },
    get statusError() {
      return statusError
    },
    get connected() {
      return Boolean(sessionId)
    }
  }
}

/**
 * @param {ClusterProfile} nextProfile
 * @param {string} [password]
 */
export async function connectSharedCluster(nextProfile, password = '') {
  connecting = true
  statusError = false
  statusMessage = 'Connecting…'
  try {
    if (sessionId) {
      await clusterDisconnect({ session_id: sessionId }).catch(() => {})
      sessionId = null
    }
    const plain = JSON.parse(JSON.stringify(nextProfile))
    const conn = await clusterConnect({
      profile: plain,
      password: password || undefined
    })
    sessionId = conn.session_id
    profile = plain
    statusMessage = 'Probing modules & partitions…'
    const result = await clusterProbe({ session_id: sessionId, profile: plain })
    probe = result.probe || result
    connectedAt = new Date().toISOString()
    statusMessage = `Connected to ${plain.name || plain.host}`
    statusError = false
    return { sessionId, profile, probe }
  } catch (err) {
    sessionId = null
    probe = null
    connectedAt = ''
    statusError = true
    statusMessage = formatClusterConnectError(err, nextProfile)
    throw err
  } finally {
    connecting = false
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
}
