/**
 * Which Equilibration protocol-card fields are editable for each MD engine.
 *
 * CONVENTION: only expose a control when the gatewizard generator for that
 * engine actually reads the value from stage params and writes it into inputs.
 * If a value is hard-coded in templates and ignored by the generator, hide the
 * control — do not show “dead” settings that confuse users.
 *
 * Keep this matrix in sync with gatewizard/tools/equilibration.py generators:
 * - NAMD: margin, pressure, surface_tension (NPgT), dcd_freq
 * - Amber: pressure ({PRES0}), surface_tension ({GAMMA_TEN} on NPgT), dcd_freq → ntwx
 * - OpenMM: dcd_freq ({NSTDCD}), pressure (p_ref), surface_tension (p_tens on NPT/NPgT)
 * - GROMACS: dcd_freq (nstxout-compressed), pressure/surface_tension (ref_p;
 *   γ dyn/cm → bar·nm via ×10 for NPgT surface-tension coupling)
 *
 * NPAT holds the membrane area fixed (NAMD useConstantArea, Amber Z-only
 * scaling, GROMACS XY compressibility 0, OpenMM p_scale = Z). That card
 * shows surface area, not a tension target.
 */

import { formEnsembleValue } from './ensemble.js'

/** @typedef {'namd' | 'gromacs' | 'openmm' | 'amber'} EqEngine */

/**
 * @param {string|null|undefined} engine
 * @returns {EqEngine}
 */
export function normalizeEqEngine(engine) {
  const key = String(engine || 'namd').toLowerCase().trim()
  if (key === 'gromacs' || key === 'openmm' || key === 'amber' || key === 'namd') {
    return key
  }
  return 'namd'
}

/**
 * Effective ensemble for a stage (stage override, else sidebar selection).
 * @param {string|null|undefined} stageEnsemble
 * @param {string|null|undefined} sidebarEnsemble
 */
export function effectiveStageEnsemble(stageEnsemble, sidebarEnsemble) {
  return formEnsembleValue(stageEnsemble || sidebarEnsemble || 'npt')
}

/**
 * Stages that follow the sidebar ensemble (production only). Thermalization, scaffold,
 * and packing (Eq1–6) keep their protocol ensembles.
 * @param {{ name?: string, stage_kind?: string, ensemble?: string|null, description?: string }} stage
 */
export function isSidebarControlledStage(stage) {
  const kind = String(stage?.stage_kind || '').toLowerCase()
  const name = String(stage?.name || '').toLowerCase()
  if (kind === 'production' || name === 'production') return true
  return false
}

/**
 * Reset sidebar-controlled stages to inherit (`ensemble: null`) and ensure
 * barostat-related fields exist when the effective ensemble needs them.
 * Packing / early NVT stages keep their explicit ensembles.
 *
 * @param {{ stages?: Array<Record<string, unknown>> } | null | undefined} protocol
 * @param {string|null|undefined} sidebarEnsemble
 * @param {string|null|undefined} [engine]
 * @returns {boolean} whether any stage was mutated
 */
export function syncProtocolToSidebarEnsemble(protocol, sidebarEnsemble, engine = 'namd') {
  const stages = protocol?.stages
  if (!Array.isArray(stages) || stages.length === 0) return false
  const eng = normalizeEqEngine(engine)
  let changed = false
  for (const stage of stages) {
    if (!stage || typeof stage !== 'object') continue
    if (isSidebarControlledStage(stage) && stage.ensemble != null && stage.ensemble !== '') {
      stage.ensemble = null
      changed = true
    }
    const kind = String(stage.stage_kind || '').toLowerCase()
    const name = String(stage.name || '').toLowerCase()
    const isMini =
      kind === 'minimization' || name === 'minimization' || name === 'energy minimization'
    if (isMini) continue

    const ens = effectiveStageEnsemble(
      /** @type {string|null|undefined} */ (stage.ensemble),
      sidebarEnsemble
    )
    const barostatted = ens === 'npt' || ens === 'npat' || ens === 'npgt'
    if (barostatted && (stage.pressure == null || stage.pressure === '')) {
      stage.pressure = 1.0
      changed = true
    }
    const needsGamma = ens === 'npgt' || (eng === 'openmm' && ens === 'npt')
    if (needsGamma && (stage.surface_tension == null || stage.surface_tension === '')) {
      stage.surface_tension = 0.0
      changed = true
    }
    if (eng === 'namd' && (stage.margin == null || stage.margin === '')) {
      stage.margin = 5.0
      changed = true
    }
  }
  return changed
}

/**
 * @param {string|null|undefined} engine
 * @param {string|null|undefined} stageEnsemble
 * @param {string|null|undefined} sidebarEnsemble
 * @param {{ isMinimization?: boolean }} [opts]
 */
export function stageFieldVisibility(
  engine,
  stageEnsemble,
  sidebarEnsemble,
  opts = {}
) {
  const eng = normalizeEqEngine(engine)
  const ens = effectiveStageEnsemble(stageEnsemble, sidebarEnsemble)
  const isMini = Boolean(opts.isMinimization)
  const barostatted = ens === 'npt' || ens === 'npat' || ens === 'npgt'
  // NPgT (and the OpenMM NPT membrane barostat) takes a surface-tension target.
  // NPAT holds the membrane area fixed and does not write a tension.
  const surfaceTension =
    !isMini && (ens === 'npgt' || (eng === 'openmm' && ens === 'npt'))
  const surfaceArea = !isMini && ens === 'npat'

  return {
    /** NAMD PME padding only (`{MARGIN}`). */
    margin: eng === 'namd' && !isMini,
    /** Target pressure — wired for all engines when a barostat is active. */
    pressure: !isMini && barostatted,
    /**
     * Surface tension (dyn/cm) for NPgT, and for the OpenMM NPT membrane barostat.
     */
    surfaceTension,
    /**
     * NPAT holds the membrane XY area fixed. There is no tension target to edit.
     */
    surfaceArea,
    /**
     * Trajectory write frequency in steps.
     * Wired for all engines (Amber `ntwx`, GROMACS `nstxout-compressed`,
     * NAMD `dcdfreq`, OpenMM `{NSTDCD}`).
     */
    trajFreq: !isMini,
    trajFreqLabel:
      eng === 'gromacs'
        ? 'XTC frequency'
        : eng === 'amber'
          ? 'NetCDF frequency'
          : 'DCD frequency',
    trajFreqHint:
      eng === 'gromacs' ? 'steps (xtc)' : eng === 'amber' ? 'steps (nc)' : 'steps (dcd)',
  }
}
