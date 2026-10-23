/** Published docs site. Fragments match MkDocs heading slugs. */
export const DOCS_SITE = 'https://maurobedoya.github.io/gatewizard/'

export const DOCS_BASE = `${DOCS_SITE}user-guide/`

/**
 * One entry per info button. `guide` is the user-guide heading.
 * `api` entries are short names for the matching module page.
 * @type {Record<string, { guide: string, api: { label: string, path: string }[] }>}
 */
export const DOCS_LINKS = {
  preparation: {
    guide: 'preparation',
    api: [
      { label: 'Protonation', path: 'api/preparation/#apply_protonation_states' },
      { label: 'Missing atoms', path: 'api/preparation/#complete_missing_heavy_atoms' },
      { label: 'Short gaps', path: 'api/preparation/#fill_short_gaps' },
      { label: 'Altlocs', path: 'api/structure_checker/#keep_most_likely_altlocs' }
    ]
  },
  propka: {
    guide: 'propka',
    api: [
      { label: 'Run PropKa', path: 'api/preparation/#run_analysis' },
      { label: 'Read the summary', path: 'api/preparation/#parse_summary' }
    ]
  },
  disulfideBonds: {
    guide: 'disulfide-bonds',
    api: [
      { label: 'Detect bonds', path: 'api/preparation/#detect_disulfide_bonds' },
      { label: 'Apply bonds', path: 'api/preparation/#apply_disulfide_bonds' }
    ]
  },
  builder: {
    guide: 'builder',
    api: [{ label: 'Prepare a system', path: 'api/builder/#prepare_system' }]
  },
  forceFields: {
    guide: 'force-fields',
    api: [{ label: 'Check a combination', path: 'api/builder/#validate_combination' }]
  },
  ligandCharges: {
    guide: 'ligand-charges',
    api: [{ label: 'Parametrize a ligand', path: 'api/builder/#parametrize_ligand' }]
  },
  lipidCatalog: {
    guide: 'lipid-catalog',
    api: [{ label: 'Lipid catalog', path: 'api/builder/#get_lipid_catalog' }]
  },
  freeMolecules: {
    guide: 'free-molecules',
    api: [{ label: 'Free molecules', path: 'api/builder/#bilayer-only-and-free-molecules' }]
  },
  equilibration: {
    guide: 'equilibration',
    api: [
      { label: 'OpenMM setup', path: 'api/equilibration/#setup_openmm_equilibration' },
      { label: 'Default protocol', path: 'api/equilibration/#default-equilibration-protocol' }
    ]
  },
  computeTarget: {
    guide: 'compute-target',
    api: [
      { label: 'Run OpenMM', path: 'api/equilibration/#how-to-run-openmm' },
      { label: 'GPU', path: 'api/equilibration/#gpu-acceleration' }
    ]
  },
  computeResources: {
    guide: 'default-compute-resources',
    api: [{ label: 'Stage fields', path: 'api/equilibration/#stage-parameters-dictionary' }]
  },
  jobs: {
    guide: 'jobs',
    api: [{ label: 'Job monitor', path: 'api/builder/#class-jobmonitor' }]
  },
  cluster: {
    guide: 'cluster',
    api: [{ label: 'Cluster helpers', path: 'api/equilibration/#remote-cluster-helpers-slurm-first' }]
  },
  tools: {
    guide: 'tools',
    api: [{ label: 'Prepare inputs', path: 'api/analysis/#prepare_structural_inputs' }]
  },
  analysis: {
    guide: 'analysis',
    api: [{ label: 'Analysis module', path: 'api/analysis/#overview' }]
  },
  structural: {
    guide: 'structural',
    api: [
      { label: 'RMSD', path: 'api/analysis/#calculate_rmsd' },
      { label: 'Area per lipid', path: 'api/analysis/#calculate_area_per_lipid' }
    ]
  },
  energetic: {
    guide: 'energetic',
    api: [
      { label: 'NAMD log', path: 'api/analysis/#parse_namd_log' },
      { label: 'OpenMM log', path: 'api/analysis/#run_openmm_energetic_analysis' }
    ]
  },
  animation: {
    guide: 'animation',
    api: []
  }
}

/**
 * @param {string} id
 * @returns {{ label: string, url: string }[]}
 */
export function docsEntries(id) {
  const entry = DOCS_LINKS[id]
  if (!entry) return [{ label: 'User guide', url: DOCS_BASE }]
  const links = [{ label: 'User guide', url: `${DOCS_BASE}#${entry.guide}` }]
  for (const api of entry.api) {
    links.push({ label: api.label, url: `${DOCS_SITE}${api.path}` })
  }
  return links
}

/** @param {string} id */
export function docsUrl(id) {
  return docsEntries(id)[0].url
}
