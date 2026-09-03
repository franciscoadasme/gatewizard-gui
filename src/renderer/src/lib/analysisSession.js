/** @typedef {import('./analysisSets.js').AnalysisSet} AnalysisSet */
/** @typedef {import('./analysisSets.js').StructuralSetResult} StructuralSetResult */

import {
  assignCsvStems,
  getSetStructuralResult,
  getSetStructuralResultTypes,
  normalizeAnalysisSetFiles,
  normalizeAnalysisSetStructuralResults,
  structuralResultHasPlotData,
  structuralResultNeedsCsvHydration
} from './analysisSets.js'
import {
  canonicalizeEnergeticProperty,
  remapEnergeticSeries,
  seriesMatchesProperty
} from './energeticProperties.js'

export const ANALYSIS_SESSION_FILENAME = 'analysis_session.json'
export const ANALYSIS_SESSION_VERSION = 1

/**
 * Deep-clone plain analysis data for save/load.
 * structuredClone fails on Svelte $state proxies (e.g. nested arrays in sets).
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function clonePlainAnalysisData(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * Stable CSV filename for a set result. Uses `set.csvStem` (`set1`, `set2`, …)
 * so renaming a simulation set overwrites the same file instead of creating a new one.
 * @param {AnalysisSet} set
 * @param {string} analysisType
 * @param {number} [setIndex] fallback index when `csvStem` is missing
 */
export function csvFileNameForAnalysisSet(set, analysisType, setIndex = 0) {
  const stem = String(set?.csvStem || '').trim() || `set${Number(setIndex) + 1}`
  return `${stem}_${analysisType}.csv`
}

/**
 * Stable CSV filename for energetic set exports (session hydrate).
 * @param {AnalysisSet} set
 * @param {number} [setIndex]
 */
export function csvFileNameForEnergeticSet(set, setIndex = 0) {
  return csvFileNameForAnalysisSet(set, 'energetic', setIndex)
}

/**
 * @param {import('./analysisSets.js').EnergeticSetResult | null | undefined} res
 */
export function energeticResultHasPlotData(res) {
  if (!res) return false
  if ((res.rawX?.length ?? 0) > 0) return true
  return (res.rawSeries || []).some((s) => (s.y?.length ?? 0) > 0)
}

/**
 * @param {import('./analysisSets.js').EnergeticSetResult | null | undefined} res
 */
export function energeticResultNeedsCsvHydration(res) {
  if (!res) return false
  if (energeticResultHasPlotData(res)) return false
  return Boolean(res.dataCsv) || (res.rawSeries || []).some((s) => s.baseName)
}

/**
 * @param {number[]} y
 */
export function computeStatsFromSeries(y) {
  if (!y?.length) return null
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let n = 0
  for (let i = 0; i < y.length; i++) {
    const v = y[i]
    if (!Number.isFinite(v)) continue
    n += 1
    sum += v
    if (v < min) min = v
    if (v > max) max = v
  }
  if (n === 0) return null
  const mean = sum / n
  let varSum = 0
  for (let i = 0; i < y.length; i++) {
    const v = y[i]
    if (!Number.isFinite(v)) continue
    varSum += (v - mean) ** 2
  }
  return {
    mean,
    std: Math.sqrt(varSum / n),
    min,
    max
  }
}

/**
 * Parse exported analysis CSV back into plot arrays.
 * @param {string} text
 * @param {string} [analysisType]
 */
export function parseAnalysisResultCsv(text, analysisType = '') {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return null
  const headers = lines[0].split(',')
  const rows = lines.slice(1).map((line) => line.split(','))
  const rawX = rows.map((r) => Number(r[0]))
  const rawY = rows.map((r) => Number(r[1]))
  /** @type {{ rawX: number[], rawY: number[], extraSeries?: Array<{ name: string, rawY: number[] }> }} */
  const parsed = { rawX, rawY }
  if (
    (analysisType === 'area_per_lipid' || headers.length >= 4) &&
    headers.length >= 3 &&
    rows[0].length >= 3
  ) {
    parsed.extraSeries = []
    for (let i = 2; i < headers.length; i++) {
      parsed.extraSeries.push({
        name: headers[i] || `Series ${i - 1}`,
        rawY: rows.map((r) => Number(r[i]))
      })
    }
  }
  return parsed
}

/**
 * @param {StructuralSetResult | null | undefined} res
 * @returns {boolean}
 */
export { structuralResultHasPlotData, structuralSetHasPlottableResult, structuralResultNeedsCsvHydration } from './analysisSets.js'

/**
 * @param {string | string[]} sessionDirs
 * @param {string} csvName
 * @param {(path: string) => Promise<string>} readText
 * @returns {Promise<string | null>}
 */
async function readCsvFromSessionDirs(sessionDirs, csvName, readText) {
  const dirs = (Array.isArray(sessionDirs) ? sessionDirs : [sessionDirs])
    .map((dir) => String(dir || '').replace(/\\/g, '/').replace(/\/$/, ''))
    .filter(Boolean)
  /** Also try basename-only resolution for case variants on Windows/WSL. */
  const names = [csvName]
  const lower = csvName.toLowerCase()
  if (lower !== csvName) names.push(lower)
  for (const dir of dirs) {
    for (const name of names) {
      try {
        return await readText(`${dir}/${name}`)
      } catch {
        // try next candidate
      }
    }
  }
  return null
}

/**
 * @param {StructuralSetResult} res
 * @param {{ rawX: number[], rawY: number[], extraSeries?: Array<{ name: string, rawY: number[] }> }} parsed
 */
export function applyCsvToStructuralResult(res, parsed) {
  if (!parsed || !res) return res
  const rawY = parsed.rawY
  const parsedExtras = parsed.extraSeries?.filter((s) => s.rawY?.length > 0) ?? []
  return {
    ...res,
    rawX: parsed.rawX,
    rawY,
    extraSeries: parsedExtras.length ? parsedExtras : res.extraSeries,
    primaryStats: computeStatsFromSeries(rawY)
  }
}

/**
 * Strip heavy coordinate arrays from session JSON; CSV files hold the series data.
 * Always slims both structural and energetic results so a mixed session stays small
 * regardless of which mode was last active in the UI.
 * @param {AnalysisSet[]} sets
 * @param {'structural' | 'energetic' | 'all'} [_mode] kept for call-site compatibility
 */
export function slimSetsForSessionSave(sets, _mode = 'all') {
  const cloned = assignCsvStems(clonePlainAnalysisData(sets))
  return cloned.map((set, setIndex) => {
    let next = set

    // Slim structural results (if any)
    const normalized = normalizeAnalysisSetStructuralResults(next)
    const types = getSetStructuralResultTypes(normalized)
    if (types.length > 0) {
      /** @type {Record<string, StructuralSetResult>} */
      const slimResults = {}
      for (const type of types) {
        const res = getSetStructuralResult(normalized, type)
        if (!res) continue
        slimResults[type] = {
          ...res,
          rawX: [],
          rawY: [],
          extraSeries: (res.extraSeries || []).map((s) => ({ name: s.name, rawY: [] })),
          dataCsv: csvFileNameForAnalysisSet(next, type, setIndex)
        }
      }
      const activeType = next.structuralResult?.analysisType
      next = {
        ...next,
        structuralResults: slimResults,
        structuralResult: activeType ? slimResults[activeType] ?? null : null
      }
    }

    // Slim energetic results (if any)
    const eres = next.energeticResult
    if (eres) {
      next = {
        ...next,
        energeticResult: {
          ...eres,
          rawX: [],
          rawSeries: (eres.rawSeries || []).map((s) => ({
            baseName: s.baseName,
            unit: s.unit || '',
            key: s.key,
            y: []
          })),
          dataCsv: csvFileNameForEnergeticSet(next, setIndex)
        }
      }
    }
    return next
  })
}

/**
 * Parse multi-column energetic CSV (x + one column per property base name).
 * @param {string} text
 * @returns {{ rawX: number[], series: Array<{ baseName: string, y: number[] }> } | null}
 */
export function parseEnergeticResultCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return null
  const headers = lines[0].split(',').map((h) => h.trim())
  if (headers.length < 2) return null
  const rows = lines.slice(1).map((line) => line.split(','))
  const rawX = rows.map((r) => Number(r[0]))
  /** @type {Array<{ baseName: string, y: number[] }>} */
  const series = []
  for (let c = 1; c < headers.length; c++) {
    const baseName = headers[c]
    if (!baseName) continue
    series.push({
      baseName,
      y: rows.map((r) => Number(r[c]))
    })
  }
  return { rawX, series }
}

/**
 * @param {import('./analysisSets.js').EnergeticSetResult} res
 * @param {{ rawX: number[], series: Array<{ baseName: string, y: number[] }> }} parsed
 */
export function applyCsvToEnergeticResult(res, parsed) {
  if (!res || !parsed) return res
  const byName = new Map(parsed.series.map((s) => [s.baseName, s.y]))
  const rawSeries = (res.rawSeries || []).map((s) => {
    const y = byName.get(s.baseName)
    if (y) return { ...s, y }
    for (const [name, values] of byName) {
      if (name === s.baseName || name.startsWith(`${s.baseName} (`)) {
        return { ...s, y: values }
      }
      if (seriesMatchesProperty(s, name) || seriesMatchesProperty({ baseName: name }, s.baseName)) {
        return { ...s, y: values }
      }
    }
    return s
  })
  for (const col of parsed.series) {
    if (!rawSeries.some((s) => seriesMatchesProperty(s, col.baseName))) {
      const canon = canonicalizeEnergeticProperty(col.baseName)
      rawSeries.push({
        baseName: canon.displayName,
        key: canon.key,
        nativeName: col.baseName,
        unit: '',
        y: col.y
      })
    }
  }
  return {
    ...res,
    rawX: parsed.rawX,
    rawSeries: remapEnergeticSeries(rawSeries)
  }
}

/**
 * Load plot arrays from sibling CSV exports (fixes stale JSON and reduces RAM on load).
 * @param {AnalysisSessionV1} session
 * @param {string | string[]} sessionDir
 * @param {(path: string) => Promise<string>} readText
 */
export async function hydrateAnalysisSessionFromCsv(session, sessionDir, readText) {
  if (!sessionDir || !session?.sets?.length) return session
  // Hydrate both modes — sessions may contain structural and energetic results together.
  for (let setIndex = 0; setIndex < session.sets.length; setIndex++) {
    const set = session.sets[setIndex]
    const res = set.energeticResult
    if (res && energeticResultNeedsCsvHydration(res)) {
      const csvName = res.dataCsv || csvFileNameForEnergeticSet(set, setIndex)
      const text = await readCsvFromSessionDirs(sessionDir, csvName, readText)
      if (text) {
        const parsed = parseEnergeticResultCsv(text)
        if (parsed) set.energeticResult = applyCsvToEnergeticResult(res, parsed)
      }
    }
    const normalized = normalizeAnalysisSetStructuralResults(set)
    for (const type of getSetStructuralResultTypes(normalized)) {
      const sres = getSetStructuralResult(normalized, type)
      if (!sres || !structuralResultNeedsCsvHydration(sres)) continue
      const csvName =
        sres.dataCsv || csvFileNameForAnalysisSet(set, type, setIndex)
      const text = await readCsvFromSessionDirs(sessionDir, csvName, readText)
      if (!text) continue
      const parsed = parseAnalysisResultCsv(text, type)
      if (!parsed) continue
      const updated = applyCsvToStructuralResult(sres, parsed)
      if (!set.structuralResults) set.structuralResults = {}
      set.structuralResults[type] = updated
      if (set.structuralResult?.analysisType === type) {
        set.structuralResult = updated
      }
    }
  }
  return session
}

/**
 * Hydrate plot arrays for in-memory analysis sets from CSV exports.
 * @param {AnalysisSet[]} sets
 * @param {string | string[]} sessionDir
 * @param {(path: string) => Promise<string>} readText
 * @returns {Promise<AnalysisSet[]>}
 */
export async function hydrateAnalysisSetsFromCsv(sets, sessionDir, readText, mode = 'structural') {
  if (!sets?.length || !sessionDir) return sets
  if (mode === 'energetic') {
    /** @type {AnalysisSet[]} */
    let next = sets
    for (let setIndex = 0; setIndex < sets.length; setIndex++) {
      const set = sets[setIndex]
      const res = set.energeticResult
      if (!res || !energeticResultNeedsCsvHydration(res)) continue
      const csvName = res.dataCsv || csvFileNameForEnergeticSet(set, setIndex)
      const text = await readCsvFromSessionDirs(sessionDir, csvName, readText)
      if (!text) continue
      const parsed = parseEnergeticResultCsv(text)
      if (!parsed) continue
      const updated = applyCsvToEnergeticResult(res, parsed)
      next = next.map((s) => (s.id === set.id ? { ...s, energeticResult: updated } : s))
    }
    return next
  }
  /** @type {AnalysisSet[]} */
  let next = sets
  for (let setIndex = 0; setIndex < sets.length; setIndex++) {
    const set = sets[setIndex]
    const normalized = normalizeAnalysisSetStructuralResults(set)
    for (const type of getSetStructuralResultTypes(normalized)) {
      const res = getSetStructuralResult(normalized, type)
      if (!res || !structuralResultNeedsCsvHydration(res)) continue
      const csvName = res.dataCsv || csvFileNameForAnalysisSet(set, type, setIndex)
      const text = await readCsvFromSessionDirs(sessionDir, csvName, readText)
      if (!text) continue
      const parsed = parseAnalysisResultCsv(text, type)
      if (!parsed) continue
      const updated = applyCsvToStructuralResult(res, parsed)
      next = next.map((s) => {
        if (s.id !== set.id) return s
        const prior = { ...(s.structuralResults || {}) }
        return {
          ...s,
          structuralResults: { ...prior, [type]: updated },
          structuralResult: s.structuralResult?.analysisType === type ? updated : s.structuralResult
        }
      })
    }
  }
  return next
}

/**
 * @typedef {'overlay' | 'grid'} EnergeticCompareLayout
 * @typedef {'by_property' | 'by_set'} EnergeticGridFill
 */

/**
 * @typedef {Object} AnalysisSessionV1
 * @property {number} version
 * @property {string} savedAt ISO timestamp
 * @property {'structural' | 'energetic'} mode
 * @property {'overlay' | 'grid'} compareLayout structural multi-set layout
 * @property {EnergeticCompareLayout} [energeticCompareLayout] energetic overlay vs mosaic
 * @property {EnergeticGridFill} [energeticGridFill] seed used when energeticGridLayout is missing
 * @property {string} outputFolderName
 * @property {string} [sessionName] Optional human label (independent of folder name)
 * @property {string} activeSetId
 * @property {AnalysisSet[]} sets
 * @property {object} [gridLayout] Custom mosaic (cols/rows, per-cell setIds, legends)
 * @property {object} [energeticGridLayout] Energetic mosaic (setIds + propertyKeys)
 * @property {{
 *   structural?: Record<string, Record<string, unknown>>,
 *   energeticGlobal?: Record<string, unknown>,
 *   energeticPanels?: Record<string, unknown>
 * } | null} [plotSettings]
 */

/** Legacy hardcoded plot colors (treated as “follow theme” when loading old sessions). */
export const LEGACY_PLOT_BG = '#0a0a0a'
export const LEGACY_PLOT_TEXT = '#a3a3a3'

/**
 * @param {'dark' | 'light'} theme
 */
export function themePlotBackgroundHex(theme) {
  return theme === 'light' ? '#ffffff' : '#0a0a0a'
}

/**
 * @param {'dark' | 'light'} theme
 */
export function themePlotTextHex(theme) {
  return theme === 'light' ? '#262626' : '#a3a3a3'
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 */
export function normalizeHexColor(value, fallback = '#0a0a0a') {
  const raw = String(value || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toLowerCase()
  }
  return fallback
}

/**
 * @param {unknown} value
 * @param {string} legacyDefault
 */
export function colorLooksCustomized(value, legacyDefault) {
  const s = String(value || '').trim().toLowerCase()
  if (!s) return false
  return s !== String(legacyDefault || '').trim().toLowerCase()
}

/** Plot-settings keys bound to number <input>s — keep them strings to avoid int↔string loops. */
const PLOT_STRING_KEYS = new Set([
  'lineWidth',
  'xMin',
  'xMax',
  'yMin',
  'yMax',
  'aspectRatio',
  'dpi',
  'extraLeftMargin',
  'extraRightMargin',
  'extraTopMargin',
  'extraBottomMargin',
  'tickLabelGap',
  'tickLength',
  'tickWidth',
  'spineWidth',
  'legendSwatchSize',
  'legendFontSize',
  'axisFontSize',
  'titleFontSize',
  'xTickCount',
  'yTickCount',
  'xTickDecimals',
  'yTickDecimals',
  'xTickStep',
  'yTickStep',
  'aplMarkerSize',
  'aplMeanMarkerEvery',
  'aplUpperMarkerEvery',
  'aplLowerMarkerEvery'
])

/**
 * @param {unknown} plot
 */
export function stringifyPlotSettingNumbers(plot) {
  if (!plot || typeof plot !== 'object' || Array.isArray(plot)) return plot
  const next = { ...plot }
  for (const key of PLOT_STRING_KEYS) {
    const v = next[key]
    if (typeof v === 'number' && Number.isFinite(v)) next[key] = String(v)
  }
  return next
}

/**
 * @param {unknown} plotSettings
 */
export function normalizeSessionPlotSettings(plotSettings) {
  if (!plotSettings || typeof plotSettings !== 'object') return plotSettings
  const src = /** @type {Record<string, unknown>} */ (plotSettings)
  const structuralSrc =
    src.structural && typeof src.structural === 'object' && !Array.isArray(src.structural)
      ? /** @type {Record<string, unknown>} */ (src.structural)
      : null
  const panelsSrc =
    src.energeticPanels &&
    typeof src.energeticPanels === 'object' &&
    !Array.isArray(src.energeticPanels)
      ? /** @type {Record<string, unknown>} */ (src.energeticPanels)
      : null
  return {
    ...src,
    structural: structuralSrc
      ? Object.fromEntries(
          Object.entries(structuralSrc).map(([k, v]) => [k, stringifyPlotSettingNumbers(v)])
        )
      : src.structural,
    energeticGlobal: stringifyPlotSettingNumbers(src.energeticGlobal),
    energeticPanels: panelsSrc
      ? Object.fromEntries(
          Object.entries(panelsSrc).map(([k, v]) => [k, stringifyPlotSettingNumbers(v)])
        )
      : src.energeticPanels
  }
}

/**
 * Fill plotBgCustomized / textColorCustomized for old sessions that only stored hex.
 * @param {Record<string, unknown> | null | undefined} plot
 */
export function hydratePlotColorFlags(plot) {
  if (!plot || typeof plot !== 'object') return plot
  const next = stringifyPlotSettingNumbers({ ...plot })
  if (next.plotBgCustomized == null) {
    next.plotBgCustomized = colorLooksCustomized(next.plotBg, LEGACY_PLOT_BG)
    if (!next.plotBgCustomized) next.plotBg = ''
  } else {
    next.plotBgCustomized = Boolean(next.plotBgCustomized)
  }
  if (next.textColorCustomized == null) {
    next.textColorCustomized = colorLooksCustomized(next.textColor, LEGACY_PLOT_TEXT)
    if (!next.textColorCustomized) next.textColor = ''
  } else {
    next.textColorCustomized = Boolean(next.textColorCustomized)
  }
  return next
}

/**
 * @param {Record<string, unknown> | null | undefined} plot
 * @param {'dark' | 'light'} theme
 */
export function resolvePlotColors(plot, theme) {
  const bgFallback = themePlotBackgroundHex(theme)
  const textFallback = themePlotTextHex(theme)
  return {
    plotBg: plot?.plotBgCustomized
      ? normalizeHexColor(plot.plotBg, bgFallback)
      : bgFallback,
    textColor: plot?.textColorCustomized
      ? normalizeHexColor(plot.textColor, textFallback)
      : textFallback
  }
}

/**
 * @param {unknown} raw
 * @returns {EnergeticCompareLayout}
 */
export function normalizeEnergeticCompareLayout(raw) {
  if (raw === 'overlay') return 'overlay'
  if (
    raw === 'grid' ||
    raw === 'by_property' ||
    raw === 'by_set' ||
    raw === 'property'
  ) {
    return 'grid'
  }
  return 'grid'
}

/**
 * How to auto-fill an energetic mosaic when the session has no stored grid.
 * Old `by_set` (and leftover compareLayout=grid) → one cell per set.
 * @param {unknown} rawLayout
 * @param {unknown} [legacyCompareLayout]
 * @returns {EnergeticGridFill}
 */
export function inferEnergeticGridFill(rawLayout, legacyCompareLayout) {
  if (rawLayout === 'by_set') return 'by_set'
  if (rawLayout == null && legacyCompareLayout === 'grid') return 'by_set'
  return 'by_property'
}

/**
 * @param {{
 *   mode: 'structural' | 'energetic',
 *   compareLayout: 'overlay' | 'grid',
 *   energeticCompareLayout?: EnergeticCompareLayout,
 *   energeticGridFill?: EnergeticGridFill,
 *   outputFolderName: string,
 *   sessionName?: string,
 *   activeSetId: string,
 *   sets: AnalysisSet[],
 *   gridLayout?: object,
 *   energeticGridLayout?: object,
 *   plotSettings?: AnalysisSessionV1['plotSettings'],
 * }} state
 * @returns {AnalysisSessionV1}
 */
export function serializeAnalysisSession(state) {
  return {
    version: ANALYSIS_SESSION_VERSION,
    savedAt: new Date().toISOString(),
    mode: state.mode,
    compareLayout: state.compareLayout,
    energeticCompareLayout: normalizeEnergeticCompareLayout(
      state.energeticCompareLayout ?? 'grid'
    ),
    energeticGridFill: state.energeticGridFill === 'by_set' ? 'by_set' : 'by_property',
    outputFolderName: state.outputFolderName,
    sessionName: String(state.sessionName || '').trim(),
    activeSetId: state.activeSetId,
    sets: clonePlainAnalysisData(state.sets).map(normalizeAnalysisSetFiles),
    gridLayout: state.gridLayout ? clonePlainAnalysisData(state.gridLayout) : null,
    energeticGridLayout: state.energeticGridLayout
      ? clonePlainAnalysisData(state.energeticGridLayout)
      : null,
    plotSettings: state.plotSettings ? clonePlainAnalysisData(state.plotSettings) : null
  }
}

/**
 * @param {unknown} raw
 * @returns {AnalysisSessionV1}
 */
export function deserializeAnalysisSession(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid analysis session: not an object.')
  }
  const obj = /** @type {Record<string, unknown>} */ (raw)
  const version = Number(obj.version)
  if (version !== ANALYSIS_SESSION_VERSION) {
    throw new Error(`Unsupported analysis session version: ${obj.version}`)
  }
  const mode = obj.mode
  if (mode !== 'structural' && mode !== 'energetic') {
    throw new Error('Invalid analysis session: mode must be structural or energetic.')
  }
  let compareLayout = obj.compareLayout
  // Older sessions reused compareLayout for energetic ("grid" = by set).
  if (compareLayout !== 'overlay' && compareLayout !== 'grid') {
    if (compareLayout === 'by_set') compareLayout = 'grid'
    else if (compareLayout === 'by_property') compareLayout = 'overlay'
    else {
      throw new Error('Invalid analysis session: compareLayout must be overlay or grid.')
    }
  }
  const rawEnergetic = obj.energeticCompareLayout
  const energeticCompareLayout = normalizeEnergeticCompareLayout(
    rawEnergetic ??
      (obj.compareLayout === 'by_set'
        ? 'grid'
        : obj.compareLayout === 'by_property'
          ? 'grid'
          : 'grid')
  )
  const energeticGridFill =
    obj.energeticGridFill === 'by_set'
      ? 'by_set'
      : inferEnergeticGridFill(rawEnergetic, obj.compareLayout)
  if (!Array.isArray(obj.sets) || obj.sets.length === 0) {
    throw new Error('Invalid analysis session: sets array is missing or empty.')
  }
  return /** @type {AnalysisSessionV1} */ ({
    version,
    savedAt: String(obj.savedAt || ''),
    mode,
    compareLayout,
    energeticCompareLayout,
    energeticGridFill,
    outputFolderName: String(obj.outputFolderName || ''),
    sessionName: String(obj.sessionName || obj.session_name || '').trim(),
    activeSetId: String(obj.activeSetId || obj.sets[0]?.id || ''),
    sets: /** @type {AnalysisSet[]} */ (obj.sets).map(normalizeAnalysisSetFiles),
    gridLayout: obj.gridLayout && typeof obj.gridLayout === 'object' ? obj.gridLayout : null,
    energeticGridLayout:
      obj.energeticGridLayout && typeof obj.energeticGridLayout === 'object'
        ? obj.energeticGridLayout
        : null,
    plotSettings:
      obj.plotSettings && typeof obj.plotSettings === 'object'
        ? normalizeSessionPlotSettings(obj.plotSettings)
        : null
  })
}

/**
 * Label for pickers / logs: optional session name + folder name.
 * @param {{ sessionName?: string, session_name?: string, outputFolderName?: string, name?: string, folder_name?: string }} session
 * @returns {string}
 */
export function formatAnalysisSessionIdentity(session) {
  const folder = String(
    session.outputFolderName || session.folder_name || session.name || ''
  ).trim()
  const title = String(session.sessionName || session.session_name || '').trim()
  if (title && folder && title !== folder) return `${title} · ${folder}`
  return title || folder || 'session'
}

/**
 * @param {AnalysisSessionV1 | null | undefined} session
 * @returns {boolean}
 */
export function sessionHasPlottableResults(session) {
  if (!session?.sets?.length) return false
  return (
    setsHavePlottableResults(session.sets, 'structural') ||
    setsHavePlottableResults(session.sets, 'energetic')
  )
}

/**
 * @param {AnalysisSessionV1} session
 * @returns {string}
 */
export function sessionAnalysisSummary(session) {
  const hasStruct = setsHavePlottableResults(session.sets, 'structural')
  const hasEnerg = setsHavePlottableResults(session.sets, 'energetic')
  if (!hasStruct && !hasEnerg) return 'No results'
  /** @type {string[]} */
  const parts = []
  if (hasStruct) {
    const types = [
      ...new Set(
        session.sets.flatMap((s) => {
          const fromMap = Object.keys(s.structuralResults || {})
          if (fromMap.length) return fromMap
          return s.structuralResult?.analysisType ? [s.structuralResult.analysisType] : []
        })
      )
    ]
    parts.push(types.length ? types.join(', ') : 'structural')
  }
  if (hasEnerg) {
    const props = session.sets.flatMap(
      (s) => s.energeticResult?.selectedProperties ?? s.energeticOptions?.selectedProperties ?? []
    )
    const uniq = [...new Set(props)]
    parts.push(
      uniq.length ? uniq.slice(0, 3).join(', ') + (uniq.length > 3 ? '…' : '') : 'energetic'
    )
  }
  return parts.join(' · ')
}

/**
 * True if any set has structural or energetic plottable results.
 * @param {AnalysisSet[]} sets
 */
export function setsHaveAnyPlottableResults(sets) {
  return (
    setsHavePlottableResults(sets, 'structural') || setsHavePlottableResults(sets, 'energetic')
  )
}

/**
 * @param {AnalysisSet[]} sets
 * @param {'structural' | 'energetic'} mode
 * @returns {boolean}
 */
export function setsHavePlottableResults(sets, mode) {
  if (!sets?.length) return false
  if (mode === 'energetic') {
    return sets.some(
      (s) =>
        energeticResultHasPlotData(s.energeticResult) ||
        Boolean(s.energeticResult?.dataCsv) ||
        s.energeticResult != null
    )
  }
  return sets.some((s) => {
    const normalized = normalizeAnalysisSetStructuralResults(s)
    return getSetStructuralResultTypes(normalized).some((type) => {
      const res = getSetStructuralResult(normalized, type)
      return structuralResultHasPlotData(res) || Boolean(res?.dataCsv)
    })
  })
}
