/**
 * Cluster profile helpers for Settings / Equilibration (Electron userData).
 */

/** @typedef {{
 *   id: string,
 *   name: string,
 *   host: string,
 *   username: string,
 *   port?: number,
 *   identity_file?: string,
 *   scheduler?: string,
 *   submit_root?: string,
 *   scratch_root?: string,
 *   workdir_strategy?: string,
 *   purge_modules?: boolean,
 *   mail_user?: string,
 *   mail_type?: string,
 *   extra_sbatch_lines?: string[],
 *   batch_template?: string|null,
 *   module_hints?: Record<string, string[]>,
 *   last_probe?: object|null
 * }} ClusterProfile */

export const WORKDIR_STRATEGIES = [
  { id: 'run_in_place', label: 'Run in submit directory' },
  { id: 'scratch_job_id', label: 'Scratch per Slurm job id (copy back)' },
  { id: 'scratch_named', label: 'Scratch named folder (copy back)' },
  { id: 'tmpdir', label: 'Slurm TMPDIR / TMPDIR (copy back)' },
  { id: 'custom_template', label: 'Custom batch template' }
]

/**
 * Electron IPC cannot clone Svelte `$state` proxies — always send plain JSON data.
 * @param {unknown} value
 */
function toPlain(value) {
  return JSON.parse(JSON.stringify(value ?? null))
}

/**
 * @returns {Promise<ClusterProfile[]>}
 */
export async function loadClusterProfiles() {
  if (!window.api?.loadClusterProfiles) return []
  const data = await window.api.loadClusterProfiles()
  return Array.isArray(data?.profiles) ? data.profiles : []
}

/**
 * @param {ClusterProfile[]} profiles
 */
export async function saveClusterProfiles(profiles) {
  if (!window.api?.saveClusterProfiles) {
    throw new Error('Cluster profile API is not available in this build.')
  }
  const plain = toPlain({ profiles: Array.isArray(profiles) ? profiles : [] })
  const data = await window.api.saveClusterProfiles(plain)
  return Array.isArray(data?.profiles) ? data.profiles : plain.profiles
}

/**
 * @param {Partial<ClusterProfile>} [overrides]
 * @returns {ClusterProfile}
 */
export function emptyClusterProfile(overrides = {}) {
  const id =
    overrides.id ||
    `cluster_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
  return {
    id,
    name: 'New cluster',
    host: '',
    username: '',
    port: 22,
    identity_file: '',
    scheduler: 'slurm',
    submit_root: '/data/$USER/gatewizard',
    scratch_root: '$SCRATCH_DIR',
    workdir_strategy: 'scratch_job_id',
    purge_modules: true,
    mail_user: '',
    mail_type: 'NONE',
    extra_sbatch_lines: [],
    batch_template: null,
    module_hints: {
      namd: ['md/namd'],
      gromacs: ['md/gromacs'],
      amber: ['md/amber'],
      openmm: ['openmm']
    },
    last_probe: null,
    ...overrides
  }
}
