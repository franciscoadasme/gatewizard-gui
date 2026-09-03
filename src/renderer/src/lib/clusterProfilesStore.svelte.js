/**
 * Bump when cluster profiles are saved so live pages (Equilibration) can reload.
 */
export const clusterProfilesStore = $state({
  revision: 0
})

export function notifyClusterProfilesChanged() {
  clusterProfilesStore.revision += 1
}
