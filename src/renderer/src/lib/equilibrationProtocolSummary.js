/**
 * Compact labels for Equilibration protocol stage summary chips (collapsed section).
 */

import { canonicalEnsemble } from './ensemble.js'
import { effectiveStageEnsemble, isSidebarControlledStage } from './equilibrationStageFields.js'

/**
 * @param {{ name?: string, stage_kind?: string } | null | undefined} stage
 * @returns {'minimization' | 'equilibration' | 'production'}
 */
export function stageKindOf(stage) {
  const explicit = String(stage?.stage_kind || '').toLowerCase()
  if (explicit === 'minimization' || explicit === 'equilibration' || explicit === 'production') {
    return explicit
  }
  const name = String(stage?.name || '').toLowerCase()
  if (name === 'minimization' || name === 'energy minimization') return 'minimization'
  if (name === 'production') return 'production'
  return 'equilibration'
}

/**
 * @param {{
 *   name?: string,
 *   stage_kind?: string,
 *   cpu_cores?: number,
 *   num_gpus?: number,
 *   use_gpu?: boolean
 * } | null | undefined} stage
 */
export function stageResourceLabel(stage) {
  const kind = stageKindOf(stage)
  const isMini = kind === 'minimization'
  const cpu = stage?.cpu_cores ?? (isMini ? 4 : 1)
  if (isMini) return `CPU×${cpu}`
  const useGpu = stage?.use_gpu !== false
  if (useGpu) return `CPU×${cpu} · GPU×${stage?.num_gpus ?? 1}`
  return `CPU×${cpu}`
}

/**
 * @param {{
 *   name?: string,
 *   stage_kind?: string,
 *   time_ns?: number,
 *   minimize_steps?: number,
 *   steps?: number
 * } | null | undefined} stage
 */
export function stageDurationLabel(stage) {
  if (stageKindOf(stage) === 'minimization') {
    const steps = Number(stage?.minimize_steps ?? stage?.steps)
    if (Number.isFinite(steps) && steps > 0) {
      return `${Math.round(steps).toLocaleString('en-US')} steps`
    }
    return '—'
  }
  const ns = Number(stage?.time_ns)
  if (Number.isFinite(ns) && ns > 0) {
    const text = Number.isInteger(ns) ? String(ns) : String(parseFloat(ns.toPrecision(6)))
    return `${text} ns`
  }
  return '—'
}

/**
 * @param {{ name?: string, stage_kind?: string, ensemble?: string|null } | null | undefined} stage
 * @param {string|null|undefined} sidebarEnsemble
 */
export function stageEnsembleLabel(stage, sidebarEnsemble) {
  if (stageKindOf(stage) === 'minimization') return '—'
  if (isSidebarControlledStage(stage)) {
    return canonicalEnsemble(effectiveStageEnsemble(null, sidebarEnsemble))
  }
  const raw = stage?.ensemble
  if (raw == null || String(raw).trim() === '') {
    return canonicalEnsemble(effectiveStageEnsemble(null, sidebarEnsemble))
  }
  return canonicalEnsemble(raw)
}

/**
 * @param {{ constraints?: Array<{ force_constant?: number } | null | undefined> } | null | undefined} stage
 * @returns {string | null}
 */
export function stageRestraintLabel(stage) {
  const list = Array.isArray(stage?.constraints) ? stage.constraints : []
  const n = list.filter((c) => {
    const fc = Number(c?.force_constant)
    return Number.isFinite(fc) && fc !== 0
  }).length
  if (n <= 0) return null
  return n === 1 ? '1 restraint' : `${n} restraints`
}

/**
 * @param {Record<string, unknown> | null | undefined} stage
 * @param {string|null|undefined} sidebarEnsemble
 */
export function summarizeProtocolStage(stage, sidebarEnsemble) {
  return {
    name: String(stage?.name || 'Stage'),
    durationLabel: stageDurationLabel(stage),
    ensembleLabel: stageEnsembleLabel(stage, sidebarEnsemble),
    resourceLabel: stageResourceLabel(stage),
    restraintLabel: stageRestraintLabel(stage)
  }
}
