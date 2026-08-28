/** @typedef {{ path: string, timeNs: string, stride: string }} TrajRow */

import { clonePlainAnalysisData } from './analysisSession.js'

/**
 * Per-analysis-type selection snapshot so RMSD protein selections never overwrite
 * bilayer headgroup selections (and vice versa).
 * @typedef {Object} StructuralTypeSelection
 * @property {string} selection
 * @property {string} selection2
 * @property {string} [referenceStructurePath]
 * @property {string} [referenceFrame]
 * @property {boolean} [align]
 * @property {string} [rmsfXaxisType]
 * @property {string} [leafletLipidSel]
 * @property {string} [leafletFilterSel]
 * @property {string} [nBins]
 * @property {boolean} [interpolate]
 * @property {string} [excludeSel]
 * @property {string} [excludeCutoff]
 * @property {string} [aplMethod]
 * @property {string} [gridmatN]
 * @property {string} [gridmatPrecision]
 * @property {string} [vtmcNSamples]
 * @property {string} [vtmcProteinRadius]
 * @property {Array<{ name: string, atomCount: number, enabled: boolean }>} [lipidHeadgroupAtoms]
 */

/**
 * @typedef {Object} StructuralOptions
 * @property {string} structuralType
 * @property {string} selection
 * @property {string} selection2
 * @property {string} referenceStructurePath
 * @property {string} referenceFrame
 * @property {boolean} align
 * @property {string} rmsfXaxisType
 * @property {string} leafletLipidSel
 * @property {string} leafletFilterSel
 * @property {string} nBins
 * @property {boolean} interpolate
 * @property {string} [excludeSel]
 * @property {string} [excludeCutoff]
 * @property {string} [aplMethod]
 * @property {string} [gridmatN]
 * @property {string} [gridmatPrecision]
 * @property {string} [vtmcNSamples]
 * @property {string} [vtmcProteinRadius]
 * @property {Record<string, StructuralTypeSelection>} [selectionsByType]
 */

/** GUI APL methods. */
export const APL_METHODS = [
  {
    id: 'evapl',
    label: 'EVAPL (default)',
    hint: 'Exclusion-aware Voronoi Area Per Lipid: one periodic Voronoi; exclude atoms (protein, peptide, DNA, ligands, …) in a lipid cell shrink that cell (one COM clip).'
  },
  {
    id: 'lipyphilic',
    label: 'Box Voronoi (lipyphilic)',
    hint: 'Pure-lipid reference only. Ignores occupants; mean ≈ box XY / lipids per leaflet. Not recommended when protein, DNA, or other non-lipids occupy the leaflet — use EVAPL, GridMAT, or VTMC.'
  },
  {
    id: 'gridmat',
    label: 'GridMAT-MD',
    hint: 'Assign a grid to the nearest headgroup or nearby protein atom (Allen et al. 2009).'
  },
  {
    id: 'vtmc',
    label: 'VTMC (Voronoi + Monte Carlo)',
    hint: 'Subtract protein disks by Monte Carlo sampling (Mori, Ogushi & Sugita 2012).'
  }
]

export const APL_METHOD_DEFAULTS = {
  aplMethod: 'evapl',
  gridmatN: '20',
  gridmatPrecision: '13',
  vtmcNSamples: '50000',
  vtmcProteinRadius: '1.7'
}

/** @param {string | null | undefined} method */
export function normalizeAplMethod(method) {
  const m = String(method || 'evapl')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
  if (m === 'auto' || m === '') return 'evapl'
  if (m === 'voronoi' || m === 'standard') return 'lipyphilic'
  if (m === 'evapl') return 'evapl'
  if (m === 'gridmat' || m === 'gridmat_md' || m === 'grid') return 'gridmat'
  if (m === 'vtmc' || m === 'voronoi_mc' || m === 'mori') return 'vtmc'
  if (m === 'lipyphilic') return 'lipyphilic'
  return 'evapl'
}

/** @param {string | null | undefined} method */
export function aplMethodLabel(method) {
  const id = normalizeAplMethod(method)
  return APL_METHODS.find((item) => item.id === id)?.label || id
}

export const BILAYER_STRUCTURAL_TYPES = new Set(['area_per_lipid', 'membrane_thickness'])

/** @param {string} type */
export function isBilayerStructuralType(type) {
  return BILAYER_STRUCTURAL_TYPES.has(type)
}

/**
 * True when a selection looks like a protein/RMSD-style MDAnalysis string.
 * @param {string} sel
 */
export function looksLikeProteinSelection(sel) {
  const s = String(sel || '')
    .trim()
    .toLowerCase()
  if (!s) return false
  if (/\bprotein\b/.test(s)) return true
  if (/\bbackbone\b/.test(s)) return true
  if (/\bname\s+ca\b/.test(s)) return true
  if (/\band\s+name\s+ca\b/.test(s)) return true
  return false
}

/**
 * True when a selection looks like lipid headgroup / phosphate atoms.
 * @param {string} sel
 */
export function looksLikeBilayerHeadgroupSelection(sel) {
  const s = String(sel || '')
    .trim()
    .toLowerCase()
  if (!s) return false
  if (looksLikeProteinSelection(s)) return false
  // Typical headgroup detect output: "name P" / "name P P1 PO4"
  if (/^name\s+[\w*]+(?:\s+[\w*]+)*$/.test(s)) return true
  if (/\b(popc|pope|dopc|dppc|dppe|chol|cholesterol|lipid)\b/.test(s)) return true
  return false
}

/**
 * Default MDAnalysis selections when a type has no saved snapshot yet.
 * @param {string} type
 * @returns {{ selection: string, selection2: string }}
 */
export function defaultSelectionForStructuralType(type) {
  switch (type) {
    case 'rmsf':
      return { selection: 'protein and name CA', selection2: 'protein and resid 50' }
    case 'distance':
      return { selection: 'protein and backbone', selection2: 'protein and resid 50' }
    case 'radius_of_gyration':
      return { selection: 'protein', selection2: 'protein and resid 50' }
    case 'area_per_lipid':
    case 'membrane_thickness':
      return { selection: '', selection2: 'protein and resid 50' }
    case 'rmsd':
    default:
      return { selection: 'protein and backbone', selection2: 'protein and resid 50' }
  }
}

/**
 * Resolve flat selection fields for a structural type from the per-type map,
 * falling back to sibling bilayer type, then defaults.
 * @param {StructuralOptions | null | undefined} opts
 * @param {string} type
 * @returns {StructuralTypeSelection}
 */
export function resolveStructuralTypeSelection(opts, type) {
  const map = opts?.selectionsByType || {}
  const saved = map[type]
  if (saved && typeof saved.selection === 'string') {
    return { ...saved }
  }
  if (isBilayerStructuralType(type)) {
    const sibling = type === 'area_per_lipid' ? 'membrane_thickness' : 'area_per_lipid'
    const sib = map[sibling]
    if (
      sib &&
      typeof sib.selection === 'string' &&
      sib.selection.trim() &&
      !looksLikeProteinSelection(sib.selection)
    ) {
      return { ...sib }
    }
  }
  // Migrate legacy flat fields when they already match the requested type.
  if (opts?.structuralType === type && typeof opts.selection === 'string') {
    const legacyOk =
      !isBilayerStructuralType(type) ||
      (!looksLikeProteinSelection(opts.selection) && Boolean(opts.selection.trim()))
    if (legacyOk) {
      return {
        selection: opts.selection,
        selection2: opts.selection2 || 'protein and resid 50',
        referenceFrame: opts.referenceFrame,
        referenceStructurePath: opts.referenceStructurePath || '',
        align: opts.align,
        rmsfXaxisType: opts.rmsfXaxisType,
        leafletLipidSel: opts.leafletLipidSel,
        leafletFilterSel: opts.leafletFilterSel,
        nBins: opts.nBins,
        interpolate: opts.interpolate,
        excludeSel: opts.excludeSel,
        excludeCutoff: opts.excludeCutoff,
        aplMethod: normalizeAplMethod(opts.aplMethod),
        gridmatN: opts.gridmatN,
        gridmatPrecision: opts.gridmatPrecision,
        vtmcNSamples: opts.vtmcNSamples,
        vtmcProteinRadius: opts.vtmcProteinRadius
      }
    }
  }
  const defaults = defaultSelectionForStructuralType(type)
  return {
    selection: defaults.selection,
    selection2: defaults.selection2,
    referenceFrame: opts?.referenceFrame ?? '0',
    referenceStructurePath: opts?.referenceStructurePath ?? '',
    align: opts?.align ?? true,
    rmsfXaxisType: opts?.rmsfXaxisType ?? 'residue_number',
    leafletLipidSel: '',
    leafletFilterSel: '',
    nBins: opts?.nBins ?? '1',
    interpolate: opts?.interpolate ?? false,
    excludeSel: opts?.excludeSel ?? 'protein',
    excludeCutoff: opts?.excludeCutoff ?? '30',
    aplMethod: normalizeAplMethod(opts?.aplMethod),
    gridmatN: opts?.gridmatN ?? APL_METHOD_DEFAULTS.gridmatN,
    gridmatPrecision: opts?.gridmatPrecision ?? APL_METHOD_DEFAULTS.gridmatPrecision,
    vtmcNSamples: opts?.vtmcNSamples ?? APL_METHOD_DEFAULTS.vtmcNSamples,
    vtmcProteinRadius: opts?.vtmcProteinRadius ?? APL_METHOD_DEFAULTS.vtmcProteinRadius,
    lipidHeadgroupAtoms: []
  }
}

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
 * @property {Array<{ path: string, basename: string, timeNs: string, start: number, nPoints: number }> | null} [sourceFiles]
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
 * @property {Array<{ path: string, basename: string, timeNs: string, start: number, nPoints: number }> | null} [sourceFiles]
 */

/**
 * @typedef {Object} AnalysisSet
 * @property {string} id
 * @property {string} label
 * @property {string} [legendLabel] custom plot legend; empty follows `label`
 * @property {string} [csvStem] stable CSV prefix (`set1`, `set2`, …); independent of the display name
 * @property {boolean} visible
 * @property {string} color
 * @property {string} [aplMeanLabel] area-per-lipid Average legend; empty → "Average"
 * @property {string} [aplUpperLabel] empty → "Upper leaflet"
 * @property {string} [aplLowerLabel] empty → "Lower leaflet"
 * @property {string} [aplUpperColor] empty → set color
 * @property {string} [aplLowerColor] empty → set color
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
  const defaults = defaultSelectionForStructuralType('rmsd')
  return {
    structuralType: 'rmsd',
    selection: defaults.selection,
    selection2: defaults.selection2,
    referenceFrame: '0',
    referenceStructurePath: '',
    align: true,
    rmsfXaxisType: 'residue_number',
    leafletLipidSel: '',
    leafletFilterSel: '',
    nBins: '1',
    interpolate: false,
    excludeSel: 'protein',
    excludeCutoff: '30',
    ...APL_METHOD_DEFAULTS,
    selectionsByType: {
      rmsd: {
        selection: defaults.selection,
        selection2: defaults.selection2,
        referenceFrame: '0',
        referenceStructurePath: '',
        align: true,
        rmsfXaxisType: 'residue_number',
        leafletLipidSel: '',
        leafletFilterSel: '',
        nBins: '1',
        interpolate: false,
        excludeSel: 'protein',
        excludeCutoff: '30',
        ...APL_METHOD_DEFAULTS,
        lipidHeadgroupAtoms: []
      }
    }
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

/** Next unused `setN` stem so renaming a set does not create new CSV files. */
export function nextCsvStem(existingSets = []) {
  const used = new Set(
    existingSets.map((s) => String(s?.csvStem || '').trim()).filter(Boolean)
  )
  let n = 1
  while (used.has(`set${n}`)) n++
  return `set${n}`
}

/**
 * Coerce trajectory/log time+stride to strings so number inputs cannot
 * ping-pong int ↔ string (that loop blocks Svelte `tick()` during session load).
 * @param {unknown} file
 * @returns {{ path: string, timeNs: string, stride: string }}
 */
export function normalizeAnalysisFileRow(file) {
  const src = file && typeof file === 'object' ? /** @type {Record<string, unknown>} */ (file) : {}
  const timeRaw = src.timeNs
  let timeNs = ''
  if (timeRaw !== '' && timeRaw != null && String(timeRaw).trim() !== '') {
    const n = Number(timeRaw)
    timeNs = Number.isFinite(n) ? String(n) : String(timeRaw).trim()
  }
  const strideN = Math.min(999, Math.max(1, Math.floor(Number(src.stride) || 1)))
  return {
    ...src,
    path: String(src.path || ''),
    timeNs,
    stride: String(strideN)
  }
}

/** @param {AnalysisSet} set */
export function normalizeAnalysisSetFiles(set) {
  if (!set || typeof set !== 'object') return set
  /** @type {AnalysisSet} */
  const next = {
    ...set,
    trajectoryFiles: Array.isArray(set.trajectoryFiles)
      ? set.trajectoryFiles.map(normalizeAnalysisFileRow)
      : []
  }
  if (set.energeticOptions && typeof set.energeticOptions === 'object') {
    const logs = set.energeticOptions.logFiles
    next.energeticOptions = {
      ...set.energeticOptions,
      logFiles: Array.isArray(logs) ? logs.map(normalizeAnalysisFileRow) : logs
    }
  }
  return next
}

/** Fill missing/duplicate csv stems (`set1`, `set2`, …) without renaming existing unique ones. */
export function assignCsvStems(sets) {
  const used = new Set()
  return (sets || []).map((set, index) => {
    let stem = String(set?.csvStem || '').trim()
    if (!/^set\d+$/.test(stem) || used.has(stem)) {
      let n = index + 1
      while (used.has(`set${n}`)) n++
      stem = `set${n}`
    }
    used.add(stem)
    return { ...set, csvStem: stem }
  })
}

/** @param {number} index @param {string} [id] @param {AnalysisSet[]} [existingSets] @returns {AnalysisSet} */
export function createAnalysisSet(index = 0, id = newSetId(), existingSets = []) {
  return {
    id,
    label: `Sim ${index + 1}`,
    legendLabel: '',
    csvStem: nextCsvStem(existingSets),
    visible: true,
    color: SET_COLORS[index % SET_COLORS.length],
    aplMeanLabel: '',
    aplUpperLabel: '',
    aplLowerLabel: '',
    aplUpperColor: '',
    aplLowerColor: '',
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

/** @param {AnalysisSet} set @param {number} index @param {AnalysisSet[]} [existingSets] @returns {AnalysisSet} */
export function duplicateAnalysisSet(set, index, existingSets = []) {
  return {
    ...clonePlainAnalysisData(set),
    id: newSetId(),
    label: `${set.label} copy`,
    legendLabel: '',
    csvStem: nextCsvStem(existingSets),
    color: SET_COLORS[index % SET_COLORS.length],
    aplMeanLabel: '',
    aplUpperLabel: '',
    aplLowerLabel: '',
    aplUpperColor: '',
    aplLowerColor: '',
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

export const APL_DEFAULT_MEAN_LABEL = 'Average'
export const APL_DEFAULT_UPPER_LABEL = 'Upper leaflet'
export const APL_DEFAULT_LOWER_LABEL = 'Lower leaflet'

/** @param {AnalysisSet | null | undefined} set @param {'mean' | 'upper' | 'lower'} role */
export function aplSeriesLabel(set, role) {
  if (role === 'upper') return String(set?.aplUpperLabel ?? '').trim() || APL_DEFAULT_UPPER_LABEL
  if (role === 'lower') return String(set?.aplLowerLabel ?? '').trim() || APL_DEFAULT_LOWER_LABEL
  return String(set?.aplMeanLabel ?? '').trim() || APL_DEFAULT_MEAN_LABEL
}

/**
 * Area-per-lipid plot visibility. Missing flags (older sessions) stay visible.
 * @param {object | null | undefined} plotSettings
 * @param {'mean' | 'upper' | 'lower' | string} role
 */
export function aplRoleIsVisible(plotSettings, role) {
  if (role === 'upper') return plotSettings?.aplShowUpper !== false
  if (role === 'lower') return plotSettings?.aplShowLower !== false
  if (role === 'mean') return plotSettings?.aplShowMean !== false
  return true
}

/** @param {AnalysisSet | null | undefined} set @param {'mean' | 'upper' | 'lower'} role */
export function aplSeriesColor(set, role) {
  const base = String(set?.color || '').trim() || '#f59e0b'
  if (role === 'upper') return String(set?.aplUpperColor ?? '').trim() || base
  if (role === 'lower') return String(set?.aplLowerColor ?? '').trim() || base
  return base
}

/** @param {{ name?: string, role?: string } | null | undefined} extra */
export function extraSeriesRole(extra) {
  const role = String(extra?.role || '').toLowerCase()
  if (role === 'upper' || role === 'lower') return role
  const name = String(extra?.name || '')
  if (/upper/i.test(name)) return 'upper'
  if (/lower/i.test(name)) return 'lower'
  return 'extra'
}

/**
 * Mean Y for a structural result. If the Average column was lost, rebuild it
 * from upper/lower leaflet series.
 * @param {StructuralSetResult | null | undefined} res
 * @returns {number[]}
 */
export function structuralMeanY(res) {
  if (Array.isArray(res?.rawY) && res.rawY.length > 0) return res.rawY
  const extras = res?.extraSeries || []
  const upper = extras.find((s) => extraSeriesRole(s) === 'upper')?.rawY
  const lower = extras.find((s) => extraSeriesRole(s) === 'lower')?.rawY
  if (!Array.isArray(upper) || !Array.isArray(lower) || !upper.length || !lower.length) {
    return []
  }
  const n = Math.min(upper.length, lower.length)
  const out = []
  for (let i = 0; i < n; i++) {
    const a = Number(upper[i])
    const b = Number(lower[i])
    out.push(Number.isFinite(a) && Number.isFinite(b) ? (a + b) / 2 : Number.isFinite(a) ? a : b)
  }
  return out
}

export { SET_COLORS }
