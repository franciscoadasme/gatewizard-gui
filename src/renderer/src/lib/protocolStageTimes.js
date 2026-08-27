/**
 * Map equilibration trajectory/log filenames to stage durations (ns) from the
 * GateWizard default protocol (resources/protocols/base.json).
 */
import baseProtocol from '../../../../resources/protocols/base.json'

/** @type {Map<string, number>} */
const STAGE_TIME_BY_STEM = buildStageTimeMap()

/** @param {{ stage_kind?: string, name?: string }} stage */
function inferStageKind(stage) {
  const kind = (stage.stage_kind || '').toLowerCase()
  if (kind === 'minimization' || kind === 'production' || kind === 'equilibration') {
    return kind
  }
  const name = (stage.name || '').toLowerCase()
  if (/minim/i.test(name)) return 'minimization'
  if (/prod/i.test(name)) return 'production'
  return 'equilibration'
}

/** @returns {Map<string, number>} stem → time_ns */
function buildStageTimeMap() {
  /** @type {Map<string, number>} */
  const map = new Map()
  const stages = /** @type {Array<{ stage_kind?: string, name?: string, time_ns?: number }>} */ (
    baseProtocol.stages || []
  )
  let eqNum = 0
  for (const stage of stages) {
    const kind = inferStageKind(stage)
    let stem
    if (kind === 'minimization') {
      stem = 'step0_minimization'
    } else if (kind === 'production') {
      stem = 'step7_production'
    } else {
      eqNum += 1
      stem = `step${eqNum}_equilibration`
    }
    const timeNs = Number(stage.time_ns)
    if (Number.isFinite(timeNs)) {
      map.set(stem, timeNs)
    }
  }
  return map
}

/**
 * Look up assigned simulation time (ns) for a trajectory or log basename.
 * Matches GateWizard stems: step0_minimization, step1_equilibration … step7_production.
 * @param {string} filename Basename or full path
 * @returns {number | null}
 */
export function lookupStageTimeNs(filename) {
  const base = filename.replace(/^.*[/\\]/, '').toLowerCase()
  const stem = base.replace(/\.[^.]+$/, '')

  if (STAGE_TIME_BY_STEM.has(stem)) {
    return STAGE_TIME_BY_STEM.get(stem) ?? null
  }

  const match = base.match(/step(\d+)_(equilibration|production|minimization)/)
  if (match) {
    const key = `step${match[1]}_${match[2]}`
    if (STAGE_TIME_BY_STEM.has(key)) {
      return STAGE_TIME_BY_STEM.get(key) ?? null
    }
  }

  return null
}

/**
 * Assign default protocol stage times to file rows ({ path, timeNs, stride? }).
 * @param {Array<{ path: string, timeNs: string, stride?: string }>} files
 * @returns {{ files: typeof files, matched: number, unmatched: string[] }}
 */
export function assignProtocolStageTimes(files) {
  const unmatched = []
  let matched = 0
  const next = files.map((file) => {
    const time = lookupStageTimeNs(file.path)
    if (time == null) {
      unmatched.push(file.path.replace(/^.*[/\\]/, ''))
      return file
    }
    matched += 1
    return { ...file, timeNs: formatTrajectoryTimeNsField(time) }
  })
  return { files: next, matched, unmatched }
}

/** @returns {ReadonlyMap<string, number>} */
export function getDefaultStageTimeMap() {
  return STAGE_TIME_BY_STEM
}

export const defaultProtocolName = baseProtocol.name || 'Default Protocol'

/** Decimal places for trajectory / log time offsets (ns) in the Analysis page. */
export const TRAJECTORY_TIME_NS_DECIMALS = 4

/** @param {number} value */
export function formatTrajectoryTimeNs(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const factor = 10 ** TRAJECTORY_TIME_NS_DECIMALS
  return Math.round(n * factor) / factor
}

/** @param {number} value */
export function formatTrajectoryTimeNsField(value) {
  const n = formatTrajectoryTimeNs(value)
  if (n == null) return ''
  return Number.isInteger(n) ? String(n) : String(n)
}
