/** @typedef {import('./analysisSets.js').AnalysisSet} AnalysisSet */
/** @typedef {import('./analysisSets.js').StructuralSetResult} StructuralSetResult */

import {
  getSetStructuralResult,
  getSetStructuralResultTypes,
  normalizeAnalysisSetStructuralResults,
  structuralResultHasPlotData,
  structuralResultNeedsCsvHydration
} from './analysisSets.js'

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
 * CSV filename for a set's structural result (matches Analysis page export).
 * @param {AnalysisSet} set
 * @param {string} analysisType
 * @param {number} setCount
 */
export function csvFileNameForAnalysisSet(set, analysisType, setCount) {
  if (setCount > 1) {
    const label = set.label.replace(/[^a-z0-9_\-]/gi, '_').toLowerCase() || 'set'
    return `${label}_${analysisType}.csv`
  }
  return `analysis_${analysisType}.csv`
}

/**
 * Stable CSV filename for energetic set exports (session hydrate).
 * @param {AnalysisSet} set
 * @param {number} setCount
 */
export function csvFileNameForEnergeticSet(set, setCount) {
  return csvFileNameForAnalysisSet(set, 'energetic', setCount)
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
  const mean = y.reduce((a, b) => a + b, 0) / y.length
  const variance = y.reduce((a, v) => a + (v - mean) ** 2, 0) / y.length
  return {
    mean,
    std: Math.sqrt(variance),
    min: Math.min(...y),
    max: Math.max(...y)
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
  const cloned = clonePlainAnalysisData(sets)
  const setCount = cloned.length
  return cloned.map((set) => {
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
          dataCsv: csvFileNameForAnalysisSet(next, type, setCount)
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
          dataCsv: eres.dataCsv || csvFileNameForEnergeticSet(next, setCount)
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
    // Fallback: strip unit suffix from CSV headers like "Temperature (K)"
    for (const [name, values] of byName) {
      if (name === s.baseName || name.startsWith(`${s.baseName} (`)) {
        return { ...s, y: values }
      }
    }
    return s
  })
  // Columns present in CSV but missing from metadata
  for (const col of parsed.series) {
    if (!rawSeries.some((s) => s.baseName === col.baseName)) {
      rawSeries.push({ baseName: col.baseName, unit: '', y: col.y })
    }
  }
  return {
    ...res,
    rawX: parsed.rawX,
    rawSeries
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
  for (const set of session.sets) {
    const res = set.energeticResult
    if (res && energeticResultNeedsCsvHydration(res)) {
      const csvName = res.dataCsv || csvFileNameForEnergeticSet(set, session.sets.length)
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
        sres.dataCsv || csvFileNameForAnalysisSet(set, type, session.sets.length)
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
    for (const set of sets) {
      const res = set.energeticResult
      if (!res || !energeticResultNeedsCsvHydration(res)) continue
      const csvName = res.dataCsv || csvFileNameForEnergeticSet(set, sets.length)
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
  for (const set of sets) {
    const normalized = normalizeAnalysisSetStructuralResults(set)
    for (const type of getSetStructuralResultTypes(normalized)) {
      const res = getSetStructuralResult(normalized, type)
      if (!res || !structuralResultNeedsCsvHydration(res)) continue
      const csvName = res.dataCsv || csvFileNameForAnalysisSet(set, type, sets.length)
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
 * @typedef {'overlay' | 'by_property' | 'by_set'} EnergeticCompareLayout
 */

/**
 * @typedef {Object} AnalysisSessionV1
 * @property {number} version
 * @property {string} savedAt ISO timestamp
 * @property {'structural' | 'energetic'} mode
 * @property {'overlay' | 'grid'} compareLayout structural multi-set layout
 * @property {EnergeticCompareLayout} [energeticCompareLayout] energetic multi-set layout
 * @property {string} outputFolderName
 * @property {string} [sessionName] Optional human label (independent of folder name)
 * @property {string} activeSetId
 * @property {AnalysisSet[]} sets
 */

/**
 * @param {unknown} raw
 * @returns {EnergeticCompareLayout}
 */
export function normalizeEnergeticCompareLayout(raw) {
  if (raw === 'by_property' || raw === 'property') return 'by_property'
  if (raw === 'by_set' || raw === 'grid') return 'by_set'
  if (raw === 'overlay') return 'overlay'
  return 'by_property'
}

/**
 * @param {{
 *   mode: 'structural' | 'energetic',
 *   compareLayout: 'overlay' | 'grid',
 *   energeticCompareLayout?: EnergeticCompareLayout,
 *   outputFolderName: string,
 *   sessionName?: string,
 *   activeSetId: string,
 *   sets: AnalysisSet[],
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
      state.energeticCompareLayout ?? 'by_property'
    ),
    outputFolderName: state.outputFolderName,
    sessionName: String(state.sessionName || '').trim(),
    activeSetId: state.activeSetId,
    sets: clonePlainAnalysisData(state.sets)
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
  const energeticCompareLayout = normalizeEnergeticCompareLayout(
    obj.energeticCompareLayout ??
      (obj.compareLayout === 'grid'
        ? 'by_set'
        : obj.compareLayout === 'by_property'
          ? 'by_property'
          : 'by_property')
  )
  if (!Array.isArray(obj.sets) || obj.sets.length === 0) {
    throw new Error('Invalid analysis session: sets array is missing or empty.')
  }
  return /** @type {AnalysisSessionV1} */ ({
    version,
    savedAt: String(obj.savedAt || ''),
    mode,
    compareLayout,
    energeticCompareLayout,
    outputFolderName: String(obj.outputFolderName || ''),
    sessionName: String(obj.sessionName || obj.session_name || '').trim(),
    activeSetId: String(obj.activeSetId || obj.sets[0]?.id || ''),
    sets: /** @type {AnalysisSet[]} */ (obj.sets)
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
