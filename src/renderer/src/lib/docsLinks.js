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
      { label: 'RMSF', path: 'api/analysis/#calculate_rmsf' },
      { label: 'Distance', path: 'api/analysis/#calculate_distances' },
      { label: 'Radius of gyration', path: 'api/analysis/#calculate_radius_of_gyration' },
      { label: 'Membrane thickness', path: 'api/analysis/#calculate_membrane_thickness' },
      { label: 'Area per lipid', path: 'api/analysis/#calculate_area_per_lipid' },
      { label: 'Titration', path: 'api/preparation/#build_titration_figure' }
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
 * One row per Structural Options analysis. `guide` is the user-guide heading.
 * The book menu lists every API link, with the selected type first.
 * @type {Array<{ type: string, guide: string, label: string, path: string, help: string }>}
 */
export const STRUCTURAL_ANALYSIS_DOCS = [
  {
    type: 'rmsd',
    guide: 'rmsd',
    label: 'RMSD',
    path: 'api/analysis/#calculate_rmsd',
    help: 'RMSD is the deviation of the selection from a reference frame or a reference PDB. Alignment can be turned on. A protein trace uses protein and name CA.'
  },
  {
    type: 'rmsf',
    guide: 'rmsf',
    label: 'RMSF',
    path: 'api/analysis/#calculate_rmsf',
    help: 'RMSF is the fluctuation of each residue in the selection across the trajectory. Peaks are the flexible parts.'
  },
  {
    type: 'distance',
    guide: 'distance',
    label: 'Distance',
    path: 'api/analysis/#calculate_distances',
    help: 'Distance follows one or more MDAnalysis pairs over time. Each pair is its own trace.'
  },
  {
    type: 'radius_of_gyration',
    guide: 'radius-of-gyration',
    label: 'Radius of gyration',
    path: 'api/analysis/#calculate_radius_of_gyration',
    help: 'Radius of gyration is the compactness of the selection over time. A steady trace means the selection keeps its size.'
  },
  {
    type: 'membrane_thickness',
    guide: 'membrane-thickness',
    label: 'Membrane thickness',
    path: 'api/analysis/#calculate_membrane_thickness',
    help: 'Membrane thickness is the distance between the two leaflet headgroups. A PDB or GRO in the trajectory list is skipped because that file has no periodic box.'
  },
  {
    type: 'area_per_lipid',
    guide: 'area-per-lipid',
    label: 'Area per lipid',
    path: 'api/analysis/#calculate_area_per_lipid',
    help: 'Area per lipid is the bilayer area from FATSLiM, GridMAT, or lipyphilic. A PDB or GRO in the trajectory list is skipped because that file has no periodic box.'
  },
  {
    type: 'titration',
    guide: 'titration',
    label: 'Titration',
    path: 'api/preparation/#build_titration_figure',
    help: 'Panel A is the pKa comparison, B is the protonated fraction, and C is the titration curve. Uncheck a residue type to hide it from A and B. A/B includes a residue in the pKa and fraction plots. C draws its titration curve. Cysteines in a disulfide bond are left out of A and B. Uncheck A/B for any other residue to leave it out of those panels.'
  }
]

/** @param {string} type */
export function structuralDocsId(type) {
  return STRUCTURAL_ANALYSIS_DOCS.some((item) => item.type === type) ? `structural-${type}` : 'structural'
}

/** @param {string} type */
export function structuralHelpText(type) {
  return STRUCTURAL_ANALYSIS_DOCS.find((item) => item.type === type)?.help || STRUCTURAL_ANALYSIS_DOCS[0].help
}

/**
 * @param {string} id
 * @returns {{ label: string, url: string }[]}
 */
export function docsEntries(id) {
  const structuralType = id.startsWith('structural-') ? id.slice('structural-'.length) : ''
  const selected = STRUCTURAL_ANALYSIS_DOCS.find((item) => item.type === structuralType)
  if (selected) {
    const ordered = [
      selected,
      ...STRUCTURAL_ANALYSIS_DOCS.filter((item) => item.type !== selected.type)
    ]
    return [
      { label: 'User guide', url: `${DOCS_BASE}#${selected.guide}` },
      ...ordered.map((item) => ({ label: item.label, url: `${DOCS_SITE}${item.path}` }))
    ]
  }
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
