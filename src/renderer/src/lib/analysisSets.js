/** @typedef {{ path: string, timeNs: string, stride: string }} TrajRow */

import { clonePlainAnalysisData } from './analysisSession.js'

/**
 * @typedef {Object} StructuralOptions
 * @property {string} structuralType
 * @property {string} selection
 * @property {string} selection2
 * @property {string} referenceFrame
 * @property {boolean} align
 * @property {string} rmsfXaxisType
 * @property {string} leafletLipidSel
 * @property {string} leafletFilterSel
 * @property {string} nBins
 * @property {boolean} interpolate
 */

/**
 * @typedef {Object} EnergeticOptions
 * @property {string} energeticEngine
 * @property {TrajRow[]} logFiles
 * @property {string[]} availableProperties
 * @property {string[]} selectedProperties
 * @property {string} timeUnits
 * @property {string} energyUnits
 * @property {string} pressureUnits
 * @property {string} temperatureUnits
 * @property {string} volumeUnits
 */

/**
 * @typedef {Object} StructuralSetResult
 * @property {string} analysisType
 * @property {number[]} rawX
 * @property {number[]} rawY
 * @property {string[]} [xLabels]
 * @property {Array<{ name: string, rawY: number[] }>} [extraSeries]
 * @property {string} seriesName
 * @property {{ mean: number, std: number, min: number, max: number } | null} primaryStats
 * @property {string} chartXLabel
 * @property {string} chartYLabel
 * @property {string} chartTitle
 * @property {string} selectionSubtitle
 * @property {boolean} lastAnalysisHasTimeX
 */

/**
 * @typedef {Object} EnergeticSetResult
 * @property {number[]} rawX
 * @property {string} rawXTimeUnit
 * @property {Array<{ baseName: string, unit: string, y: number[], key?: string }>} rawSeries
 * @property {string} chartTitle
 * @property {string} chartXLabel
 * @property {string[]} selectedProperties
 * @property {string} energeticEngine
 * @property {Record<string, { mean: number, std: number, min: number, max: number }>} [statistics]
 * @property {string} [dataCsv] sibling CSV used when session JSON is slimmed
 */

/**
 * @typedef {Object} AnalysisSet
 * @property {string} id
 * @property {string} label
 * @property {boolean} visible
 * @property {string} color
 * @property {string} topologyPath
 * @property {TrajRow[]} trajectoryFiles
 * @property {StructuralOptions} structuralOptions
 * @property {EnergeticOptions} energeticOptions
 * @property {Record<string, StructuralSetResult>} [structuralResults]
 * @property {StructuralSetResult | null} structuralResult
 * @property {EnergeticSetResult | null} energeticResult
 */

const SET_COLORS = ['#f59e0b', '#22c55e', '#38bdf8', '#f87171', '#a78bfa', '#f472b6']

let _setCounter = 1

/** @returns {StructuralOptions} */
export function defaultStructuralOptions() {
  return {
    structuralType: 'rmsd',
    selection: 'protein and backbone',
    selection2: 'protein and resid 50',
    referenceFrame: '0',
    align: true,
    rmsfXaxisType: 'residue_number',
    leafletLipidSel: '',
    leafletFilterSel: '',
    nBins: '1',
    interpolate: false
  }
}

/** @returns {EnergeticOptions} */
export function defaultEnergeticOptions() {
  return {
    energeticEngine: 'namd',
    logFiles: [],
    availableProperties: [],
    selectedProperties: [],
    timeUnits: 'ns',
    energyUnits: 'kcal/mol',
    pressureUnits: 'atm',
    temperatureUnits: 'K',
    volumeUnits: 'Å³'
  }
}

/** @returns {string} */
export function newSetId() {
  return `set-${Date.now()}-${_setCounter++}`
}

/** @param {number} index @param {string} [id] @returns {AnalysisSet} */
export function createAnalysisSet(index = 0, id = newSetId()) {
  return {
    id,
    label: `Sim ${index + 1}`,
    visible: true,
    color: SET_COLORS[index % SET_COLORS.length],
    topologyPath: '',
    trajectoryFiles: [],
    structuralOptions: defaultStructuralOptions(),
    energeticOptions: defaultEnergeticOptions(),
    structuralResults: {},
    structuralResult: null,
    energeticResult: null
  }
}

/** @param {AnalysisSet | null | undefined} set @param {string} [type] @returns {StructuralSetResult | null} */
export function getSetStructuralResult(set, type) {
  if (!set) return null
  if (type) {
    if (set.structuralResults?.[type]) return set.structuralResults[type]
    if (set.structuralResult?.analysisType === type) return set.structuralResult
    return null
  }
  return set.structuralResult ?? null
}

/** @param {AnalysisSet} set @returns {string[]} */
export function getSetStructuralResultTypes(set) {
  const types = new Set(Object.keys(set.structuralResults || {}))
  if (set.structuralResult?.analysisType) types.add(set.structuralResult.analysisType)
  return [...types]
}

/** @param {AnalysisSet} set @param {string} [type] */
export function setHasStructuralResult(set, type) {
  if (type) return getSetStructuralResult(set, type) != null
  return getSetStructuralResultTypes(set).length > 0
}

/** @param {StructuralSetResult | null | undefined} res @returns {boolean} */
export function structuralResultHasPlotData(res) {
  if (!res) return false
  if (Array.isArray(res.rawY) && res.rawY.length > 0) return true
  return (res.extraSeries || []).some((s) => Array.isArray(s.rawY) && s.rawY.length > 0)
}

/** True when CSV should be re-read (missing arrays or bilayer leaflets stripped). */
export function structuralResultNeedsCsvHydration(res) {
  if (!res) return false
  if (!structuralResultHasPlotData(res)) return true
  const extras = res.extraSeries || []
  if (extras.length === 0) return false
  return !extras.some((s) => Array.isArray(s.rawY) && s.rawY.length > 0)
}

/** @param {AnalysisSet | null | undefined} set @param {string} [type] @returns {boolean} */
export function structuralSetHasPlottableResult(set, type) {
  if (!set) return false
  const normalized = normalizeAnalysisSetStructuralResults(set)
  const res = getSetStructuralResult(normalized, type)
  return structuralResultHasPlotData(res)
}

/** @param {AnalysisSet} set @returns {AnalysisSet} */
export function normalizeAnalysisSetStructuralResults(set) {
  const results = { ...(set.structuralResults || {}) }
  if (set.structuralResult?.analysisType) {
    const type = set.structuralResult.analysisType
    const existing = results[type]
    const incoming = set.structuralResult
    if (
      existing &&
      structuralResultHasPlotData(existing) &&
      !structuralResultHasPlotData(incoming)
    ) {
      results[type] = existing
    } else {
      results[type] = incoming
    }
  }
  const keys = Object.keys(results)
  return {
    ...set,
    structuralResults: keys.length ? results : {},
    structuralResult:
      set.structuralResult ??
      (keys.length ? results[keys[keys.length - 1]] : null)
  }
}

/** @param {AnalysisSet} set @param {number} index @returns {AnalysisSet} */
export function duplicateAnalysisSet(set, index) {
  return {
    ...clonePlainAnalysisData(set),
    id: newSetId(),
    label: `${set.label} copy`,
    color: SET_COLORS[index % SET_COLORS.length],
    structuralResults: {},
    structuralResult: null,
    energeticResult: null
  }
}

/** @param {AnalysisSet | null | undefined} set @param {string} mode @param {string} [structuralType] */
export function setHasResult(set, mode, structuralType) {
  if (!set) return false
  if (mode === 'energetic') return set.energeticResult != null
  if (structuralType) return setHasStructuralResult(set, structuralType)
  return setHasStructuralResult(set)
}

export { SET_COLORS }
