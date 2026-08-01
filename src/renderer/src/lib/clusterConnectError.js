/**
 * Turn raw SSH / probe failures into a short user-facing message.
 * @param {unknown} err
 * @param {{ host?: string, name?: string } | null} [profile]
 */
export function formatClusterConnectError(err, profile = null) {
  const raw = (err instanceof Error ? err.message : String(err || '')).trim()
  const lower = raw.toLowerCase()
  const host = (profile?.host || '').trim()
  const where = host ? ` (${host})` : ''

  if (
    /connection timed out|connect to host.*timed out|operation timed out|connection time/.test(
      lower
    )
  ) {
    return (
      `Cannot reach the cluster${where}: connection timed out. ` +
      `Check VPN / network, that the host is online, and that SSH port 22 is open.`
    )
  }
  if (/no route to host|network is unreachable|host is unreachable/.test(lower)) {
    return (
      `Cannot reach the cluster${where}: network unreachable. ` +
      `Turn on VPN if you use one, then try Connect again.`
    )
  }
  if (/connection refused/.test(lower)) {
    return (
      `Cluster refused the SSH connection${where}. ` +
      `Confirm the host/port and that sshd is running.`
    )
  }
  if (
    /permission denied|authentication failed|publickey|too many authentication/.test(lower)
  ) {
    return (
      `SSH authentication failed${where}. ` +
      `Check the username, identity file / ssh-agent, or enter a password if the profile needs one.`
    )
  }
  if (/could not resolve|name or service not known|nodename nor servname/.test(lower)) {
    return (
      `Unknown host${where || ''}. Check the hostname in the cluster profile` +
      (host ? '.' : '.')
    )
  }
  if (/host key verification failed/.test(lower)) {
    return (
      `SSH host key verification failed${where}. ` +
      `The remote host key may have changed — verify it before connecting.`
    )
  }
  if (raw) {
    const clipped = raw.length > 280 ? `${raw.slice(0, 277)}…` : raw
    return `Cluster connection failed${where}: ${clipped}`
  }
  return `Cluster connection failed${where}.`
}
