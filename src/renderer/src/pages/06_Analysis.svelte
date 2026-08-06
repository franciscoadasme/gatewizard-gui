<script>
  import { tick } from 'svelte'
  import Beaker from '../components/icons/Beaker.svelte'
  import Protein from '../components/icons/Protein.svelte'
  import TopologyInfoModal from '../components/TopologyInfoModal.svelte'
  import Button from '../components/ui/Button.svelte'
  import Checkbox from '../components/ui/Checkbox.svelte'
  import Divider from '../components/ui/Divider.svelte'
  import { analysisStatus } from '../lib/pageStatus.svelte.js'
  import Input from '../components/ui/Input.svelte'
  import Select from '../components/ui/Select.svelte'
  import Spinner from '../components/ui/Spinner.svelte'
  import LineChart from '../components/LineChart.svelte'
  import {
    analyzeTopology,
    countAnalysisSelection,
    detectLipidHeadgroups,
    ensureOutputFolder,
    getEnergeticProperties,
    renderAnalysisPlot,
    runEnergeticAnalysis,
    runStructuralAnalysis,
    scanAnalysisSessions
  } from '../lib/backendApi'
  import { computeMultiSeriesStats, computeSeriesStats } from '../lib/chartStats.js'
  import {
    createAnalysisSet,
    duplicateAnalysisSet,
    getSetStructuralResult,
    getSetStructuralResultTypes,
    normalizeAnalysisSetStructuralResults,
    newSetId,
    setHasResult,
    structuralSetHasPlottableResult
  } from '../lib/analysisSets.js'
  import {
    ANALYSIS_SESSION_FILENAME,
    clonePlainAnalysisData,
    deserializeAnalysisSession,
    hydrateAnalysisSessionFromCsv,
    hydrateAnalysisSetsFromCsv,
    csvFileNameForEnergeticSet,
    energeticResultHasPlotData,
    normalizeEnergeticCompareLayout,
    serializeAnalysisSession,
    sessionHasPlottableResults,
    setsHaveAnyPlottableResults,
    setsHavePlottableResults,
    slimSetsForSessionSave,
    structuralResultHasPlotData
  } from '../lib/analysisSession.js'
  import {
    DEFAULT_CHART_MAX_POINTS,
    downsampleIndices
  } from '../lib/chartDownsample.js'
  import {
    buildPlotSpecFromGui,
    defaultPanelSettings,
    energGlobalDefaults
  } from '../lib/plotSpec.js'
  import {
    defaultAnalysisFolderName,
    outputFolderPath
  } from '../lib/outputFolders.js'
  import {
    assignProtocolStageTimes,
    defaultProtocolName
  } from '../lib/protocolStageTimes.js'
  import { logEvent } from '../lib/pageStatus.svelte.js'
  import { themeState } from '../lib/theme.svelte.js'
  import { themeBackgroundHex } from '../lib/viewerSettings.svelte.js'

  /** @type {{ workingDir?: string }} */
  let { workingDir = '' } = $props()

  /** @type {Array<{ id: 'structural' | 'energetic', label: string, Icon: typeof Protein }>} */
  const ANALYSIS_MODES = [
    { id: 'structural', label: 'Structural', Icon: Protein },
    { id: 'energetic', label: 'Energetic', Icon: Beaker }
  ]

  const paneBackgroundStyle = $derived(
    `background-color: ${themeBackgroundHex(themeState.current)}`
  )

  let mode = $state('structural')
  let running = $state(false)
  /** Separate from analysis run — Detect Properties must not freeze the Run button. */
  let detectingProperties = $state(false)
  let outputFolderName = $state('')

  function resolveOutputFolderName() {
    if (outputFolderName.trim()) return outputFolderName.trim()
    return defaultAnalysisFolderName(topologyPath)
  }

  function syncOutputFolderName() {
    const resolved = resolveOutputFolderName()
    if (resolved && resolved !== outputFolderName.trim()) {
      outputFolderName = resolved
    }
    return resolved
  }

  const outputDir = $derived(outputFolderPath(workingDir, resolveOutputFolderName()))

  $effect(() => {
    if (workingDir && !outputFolderName.trim()) {
      outputFolderName = defaultAnalysisFolderName(topologyPath)
    }
  })

  const canRunAnalysis = $derived(workingDir !== '')

  // --- Structural state ---
  let topologyPath = $state('')
  /** @type {Array<{ path: string, timeNs: string, stride: string }>} */
  let trajectoryFiles = $state([])
  let structuralType = $state('rmsd')
  let selection = $state('protein and backbone')
  let selection2 = $state('protein and resid 50')
  /** @type {number | null} */
  let selectionAtomCount = $state(null)
  /** @type {number | null} */
  let selection2AtomCount = $state(null)
  let selectionCountLoading = $state(false)
  let selectionCountError = $state('')
  let referenceFrame = $state('0')
  let align = $state(true)
  let rmsfXaxisType = $state('residue_number')
  let leafletLipidSel = $state('')
  let leafletFilterSel = $state('')
  let nBins = $state('1')
  let interpolate = $state(false)
  /** @type {Array<{ name: string, atomCount: number, enabled: boolean }>} */
  let lipidHeadgroupAtoms = $state([])
  let headgroupDetecting = $state(false)
  let headgroupDetectAttempted = $state(false)
  let headgroupDetectGeneration = 0
  let manualHeadgroupName = $state('')
  let bilayerAdvancedOpen = $state(false)

  /** @type {import('../lib/analysisSets.js').AnalysisSet[]} */
  let analysisSets = $state([createAnalysisSet(0, 'set-1')])
  let activeSetId = $state('set-1')
  /** @type {'overlay' | 'grid'} */
  /** Structural multi-set layout */
  let compareLayout = $state('overlay')
  /** Energetic multi-set layout: by_property | by_set | overlay */
  let energeticCompareLayout = $state(
    /** @type {import('../lib/analysisSession.js').EnergeticCompareLayout} */ ('by_property')
  )
  /** Bumped when plot arrays change so chart view rebuilds. */
  let plotDataRevision = $state(0)
  /**
   * Explicit chart snapshot — avoids Svelte nested-proxy derived staleness after session load.
   * @type {{ mode: 'empty' | 'overlay' | 'grid', series: Array<{ name: string, x: number[], y: number[], color?: string }>, panels: Array<{ key: string, title: string, series: Array<{ name: string, x: number[], y: number[], color?: string }> }> }}
   */
  let chartView = $state({ mode: 'empty', series: [], panels: [] })
  let statsRangeStartInput = $state('')
  let statsRangeEndInput = $state('')
  /** @type {'current' | 'all'} */
  let runAnalysisScope = $state('current')
  let runAnalysisMenuOpen = $state(false)
  /** @type {HTMLDivElement | null} */
  let runAnalysisMenuEl = $state(null)
  /** @type {Array<{ session_path: string, output_dir: string, name: string, saved_at: string, mode: string, set_count: number, analysis_summary: string }>} */
  let savedSessions = $state([])
  let selectedSessionPath = $state('')
  let sessionScanHint = $state('')
  let analysisActionNotice = $state('')
  /** @type {Array<{ id: string, label: string, status: 'pending' | 'running' | 'done' | 'error' }>} */
  let runProgressStages = $state([])

  $effect(() => {
    if (!runAnalysisMenuOpen) return
    const onDoc = (/** @type {PointerEvent} */ e) => {
      const el = runAnalysisMenuEl
      if (el && e.target instanceof Node && !el.contains(e.target)) {
        runAnalysisMenuOpen = false
      }
    }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  })

  $effect(() => {
    if (workingDir) {
      void refreshSavedSessions()
    } else {
      savedSessions = []
      selectedSessionPath = ''
      sessionScanHint = ''
    }
  })

  async function refreshSavedSessions() {
    if (!workingDir) {
      savedSessions = []
      sessionScanHint = ''
      return
    }
    try {
      const { sessions } = await scanAnalysisSessions(workingDir)
      savedSessions = sessions || []
      sessionScanHint =
        savedSessions.length === 0
          ? 'None found'
          : `${savedSessions.length} found`
      if (selectedSessionPath && !savedSessions.some((s) => s.session_path === selectedSessionPath)) {
        selectedSessionPath = ''
      }
    } catch {
      savedSessions = []
      sessionScanHint = 'Scan failed'
    }
  }

  function resetAnalysisProgress() {
    analysisStatus.progress = {
      active: false,
      current: 0,
      total: 0,
      label: '',
      phase: 'running'
    }
    runProgressStages = []
  }

  /** @param {number} current @param {number} total @param {string} label */
  function setAnalysisProgress(current, total, label) {
    analysisStatus.progress = {
      active: true,
      current,
      total,
      label,
      phase: 'running'
    }
  }

  function rebuildStructResultsFromSets() {
    structResults = {
      rmsd: null,
      rmsf: null,
      distance: null,
      radius_of_gyration: null,
      area_per_lipid: null,
      membrane_thickness: null
    }
    const active = analysisSets.find((s) => s.id === activeSetId)
    if (!active) return
    const normalized = normalizeAnalysisSetStructuralResults(active)
    for (const type of getSetStructuralResultTypes(normalized)) {
      const res = getSetStructuralResult(normalized, type)
      if (res) structResults[type] = clonePlainAnalysisData(res)
    }
  }

  /** @param {import('../lib/analysisSets.js').AnalysisSet} set @param {string} [type] */
  function resultForSetAndType(set, type = structuralType) {
    return getSetStructuralResult(normalizeAnalysisSetStructuralResults(set), type)
  }

  /** @param {string[]} dirs */
  function sessionHydrationDirs(...dirs) {
    return [...new Set(dirs.map((d) => String(d || '').replace(/\\/g, '/').replace(/\/$/, '')).filter(Boolean))]
  }

  /**
   * Reload plot arrays from CSV exports in the analysis output folder.
   * Always hydrates both result types into sets, but only refreshes the
   * currently open tab's view (avoids structural/energetic flicker).
   */
  async function hydratePlotDataFromOutputFolder(extraDirs = []) {
    const dirs = sessionHydrationDirs(outputDir, ...extraDirs)
    if (dirs.length === 0) return false
    const viewMode = mode
    let hydrated = await hydrateAnalysisSetsFromCsv(
      analysisSets,
      dirs,
      (path) => window.api.readText(path),
      'structural'
    )
    hydrated = await hydrateAnalysisSetsFromCsv(
      hydrated,
      dirs,
      (path) => window.api.readText(path),
      'energetic'
    )
    analysisSets = clonePlainAnalysisData(hydrated).map(normalizeAnalysisSetStructuralResults)
    if (viewMode === 'structural') {
      rebuildStructResultsFromSets()
      bumpPlotData()
    } else {
      rebuildEnergeticViewAfterLoad()
    }
    return true
  }

  function bumpPlotData() {
    plotDataRevision += 1
    syncChartViewFromSets()
  }

  /** Line dash pattern from plot style name. */
  function strokeDashForStyle(style) {
    switch (String(style || 'solid')) {
      case 'dashed':
        return '8 4'
      case 'dotted':
        return '2 3'
      case 'dashdot':
        return '8 3 2 3'
      default:
        return ''
    }
  }

  /**
   * Snapshot chart series/panels from analysisSets into plain chartView state.
   * Must be called after any load/store/visibility/layout change.
   */
  function syncChartViewFromSets() {
    if (mode !== 'structural') {
      return
    }
    try {
      const type = structuralType
      const layout = compareLayout
      const setsPlain = clonePlainAnalysisData(analysisSets)
      const visible = setsPlain.filter(
        (s) => s.visible && structuralSetHasPlottableResult(s, type)
      )
      if (visible.length === 0) {
        chartView = { mode: 'empty', series: [], panels: [] }
        return
      }
      const multi = setsPlain.length > 1
      const useGrid = multi && visible.length > 1 && layout === 'grid'
      if (useGrid) {
        const panels = visible.map((set) => {
          const res = getSetStructuralResult(normalizeAnalysisSetStructuralResults(set), type)
          return {
            key: set.id,
            title: set.label,
            series: res
              ? buildStructuralSeries(set, res, { setPrefix: false, colorBySet: false })
              : []
          }
        })
        chartView = {
          mode: 'grid',
          series: panels.flatMap((p) => p.series),
          panels
        }
        return
      }
      const series = visible.flatMap((set) => {
        const res = getSetStructuralResult(normalizeAnalysisSetStructuralResults(set), type)
        if (!res) return []
        return buildStructuralSeries(set, res, {
          setPrefix: multi && visible.length >= 1,
          colorBySet: multi
        })
      })
      chartView = { mode: 'overlay', series, panels: [] }
    } catch (err) {
      logEvent(
        'error',
        'analysis',
        'Failed to rebuild chart view',
        err instanceof Error ? err.message : String(err)
      )
      chartView = { mode: 'empty', series: [], panels: [] }
    }
  }

  /**
   * Chart/CSV series builder that does not depend on overlay derived flags.
   * @param {import('../lib/analysisSets.js').AnalysisSet} set
   * @param {import('../lib/analysisSets.js').StructuralSetResult} res
   * @param {{ setPrefix?: boolean, colorBySet?: boolean }} [opts]
   */
  function buildStructuralSeries(set, res, opts = {}) {
    if (!structuralResultHasPlotData(res)) return []
    const type = res.analysisType ?? structuralType
    const sp = sPlots[type] || structDefaults
    const xUnit = sp.xUnit || 'ns'
    const yUnit = sp.yUnit || 'Å'
    const xs = res.lastAnalysisHasTimeX ? convertX(res.rawX, 'ns', xUnit) : [...(res.rawX || [])]
    const prefix = opts.setPrefix ? `${set.label} · ` : ''
    const mainColor = opts.colorBySet ? set.color : sp.lineColor || '#f59e0b'
    const mainLabel =
      type === 'area_per_lipid'
        ? res.seriesName?.trim() || 'Mean'
        : res.seriesName?.trim() || 'Series'
    const isApl = type === 'area_per_lipid'
    /** @type {Array<{ name: string, x: number[], y: number[], color?: string, strokeDasharray?: string, strokeWidth?: number, marker?: string, markerSize?: number, markerEvery?: number, seriesRole?: string }>} */
    const out = [
      {
        name: `${prefix}${mainLabel}`,
        x: xs,
        y: convertStructY(res.rawY, yUnit, type),
        color: mainColor,
        strokeDasharray: isApl ? strokeDashForStyle(sp.aplMeanLineStyle) : '',
        strokeWidth: Number(sp.lineWidth) || 2,
        marker: isApl ? sp.aplMeanMarker || 'none' : 'none',
        markerSize: Number(sp.aplMarkerSize) || 3,
        markerEvery: isApl ? Math.max(1, Math.floor(Number(sp.aplMeanMarkerEvery) || 10)) : 1,
        seriesRole: 'mean'
      }
    ]
    const aplStyles = [
      {
        match: /upper/i,
        dash: sp.aplUpperLineStyle || 'dashed',
        marker: sp.aplUpperMarker || 'none',
        color: (sp.aplUpperColor || '').trim() || mainColor,
        markerEvery: Math.max(1, Math.floor(Number(sp.aplUpperMarkerEvery) || 10))
      },
      {
        match: /lower/i,
        dash: sp.aplLowerLineStyle || 'dotted',
        marker: sp.aplLowerMarker || 'none',
        color: (sp.aplLowerColor || '').trim() || mainColor,
        markerEvery: Math.max(1, Math.floor(Number(sp.aplLowerMarkerEvery) || 10))
      }
    ]
    for (const s of res.extraSeries || []) {
      if (!Array.isArray(s.rawY) || s.rawY.length === 0) continue
      const style =
        aplStyles.find((st) => st.match.test(s.name || '')) || {
          dash: 'dashed',
          marker: 'none',
          color: mainColor,
          markerEvery: 10
        }
      out.push({
        name: `${prefix}${s.name}`,
        x: xs,
        y: convertStructY(s.rawY, yUnit, type),
        color: isApl ? style.color : mainColor,
        strokeDasharray: isApl ? strokeDashForStyle(style.dash) : '',
        strokeWidth: Number(sp.lineWidth) || 2,
        marker: isApl ? style.marker : 'none',
        markerSize: Number(sp.aplMarkerSize) || 3,
        markerEvery: isApl ? style.markerEvery : 1,
        seriesRole: /upper/i.test(s.name || '')
          ? 'upper'
          : /lower/i.test(s.name || '')
            ? 'lower'
            : 'extra'
      })
    }
    return out
  }

  /**
   * @param {import('../lib/analysisSets.js').AnalysisSet} set
   * @param {{ mode?: 'structural' | 'energetic', structuralType?: string }} [opts]
   */
  function buildSeriesForSetCsv(set, opts = {}) {
    const csvMode = opts.mode ?? mode
    const type = opts.structuralType ?? structuralType
    if (csvMode === 'structural') {
      const res = resultForSetAndType(set, type)
      if (!res || !structuralResultHasPlotData(res)) return []
      // Stable CSV columns (no overlay prefixes) so leaflets survive save/load.
      const xs = res.rawX || []
      /** @type {Array<{ name: string, x: number[], y: number[] }>} */
      const out = [
        {
          name: res.seriesName?.trim() || (type === 'area_per_lipid' ? 'Mean' : 'y'),
          x: xs,
          y: res.rawY || []
        }
      ]
      for (const s of res.extraSeries || []) {
        if (!s?.rawY?.length) continue
        out.push({ name: s.name, x: xs, y: s.rawY })
      }
      return out
    }
    if (csvMode === 'energetic' && set.energeticResult) {
      // Full-resolution, stable baseName headers (not unit-converted display names).
      const res = set.energeticResult
      const props =
        res.selectedProperties ?? set.energeticOptions.selectedProperties ?? []
      const xs = res.rawX || []
      /** @type {Array<{ name: string, x: number[], y: number[] }>} */
      const out = []
      for (const prop of props) {
        const s = res.rawSeries?.find((r) => r.baseName === prop)
        if (!s?.y?.length) continue
        out.push({ name: prop, x: xs, y: s.y })
      }
      return out
    }
    return []
  }

  /**
   * @param {import('../lib/analysisSets.js').AnalysisSet} set
   * @param {{ mode?: 'structural' | 'energetic', structuralType?: string }} [opts]
   */
  function csvFileNameForSet(set, opts = {}) {
    const csvMode = opts.mode ?? mode
    const type = opts.structuralType ?? structuralType
    if (csvMode === 'energetic') {
      return csvFileNameForEnergeticSet(set, analysisSets.length)
    }
    if (analysisSets.length > 1) {
      const label = set.label.replace(/[^a-z0-9_\-]/gi, '_').toLowerCase() || 'set'
      return `${label}_${type}.csv`
    }
    return `analysis_${type}.csv`
  }

  /** @param {import('../lib/analysisSession.js').AnalysisSessionV1} session */
  function warnMissingSessionPaths(session) {
    logEvent(
      'warn',
      'analysis',
      'Loaded session with cached results; verify input paths if you re-run.',
      `${session.sets.length} set(s) restored from disk.`
    )
  }

  /** @param {import('../lib/analysisSession.js').AnalysisSessionV1} session */
  function applyAnalysisSession(session) {
    mode = session.mode
    compareLayout = session.compareLayout === 'grid' ? 'grid' : 'overlay'
    energeticCompareLayout = normalizeEnergeticCompareLayout(
      session.energeticCompareLayout ?? 'by_property'
    )
    outputFolderName = session.outputFolderName || defaultAnalysisFolderName('')
    analysisSets = clonePlainAnalysisData(session.sets).map(normalizeAnalysisSetStructuralResults)
    activeSetId =
      session.activeSetId && analysisSets.some((s) => s.id === session.activeSetId)
        ? session.activeSetId
        : analysisSets[0].id
    rebuildStructResultsFromSets()
    loadActiveSetFields()
    if (session.outputFolderName) {
      outputFolderName = session.outputFolderName
    }
    statsRange = null
    panelRangeStats = {}
    lastError = ''
    warnMissingSessionPaths(session)
    bumpPlotData()
    logEvent('info', 'analysis', 'Loaded analysis session', sessionAnalysisLabel(session))
  }

  /** @param {import('../lib/analysisSession.js').AnalysisSessionV1} session */
  function sessionAnalysisLabel(session) {
    const date = session.savedAt ? new Date(session.savedAt).toLocaleString() : ''
    return `${session.mode} · ${session.sets.length} set(s)${date ? ` · ${date}` : ''}`
  }

  async function loadSelectedSavedSession() {
    if (!selectedSessionPath) return
    await loadAnalysisSessionFromPath(selectedSessionPath)
  }

  /** @param {string} sessionPath */
  async function loadAnalysisSessionFromPath(sessionPath) {
    if (
      setsHavePlottableResults(analysisSets, mode) ||
      setsHavePlottableResults(analysisSets, 'energetic')
    ) {
      const ok = confirm('Replace the current analysis session with the saved one?')
      if (!ok) return
    }
    try {
      const raw = await window.api.readJson(sessionPath)
      let session = deserializeAnalysisSession(raw)
      const sessionDir = sessionPath.replace(/\\/g, '/').replace(/\/[^/]+$/, '')
      const hydrationDirs = sessionHydrationDirs(
        sessionDir,
        session.outputFolderName ? outputFolderPath(workingDir, session.outputFolderName) : '',
        outputDir
      )
      session = await hydrateAnalysisSessionFromCsv(session, hydrationDirs, async (path) => {
        try {
          return await window.api.readText(path)
        } catch (err) {
          logEvent('warn', 'analysis', 'Failed to read analysis CSV', `${path}: ${err}`)
          // Let readCsvFromSessionDirs try the next directory (do not abort hydrate).
          throw err
        }
      })
      const hydratedEnergetic = session.sets.some((s) =>
        energeticResultHasPlotData(s.energeticResult)
      )
      const hydratedStructural = session.sets.some((s) =>
        getSetStructuralResultTypes(normalizeAnalysisSetStructuralResults(s)).some((type) =>
          structuralResultHasPlotData(
            getSetStructuralResult(normalizeAnalysisSetStructuralResults(s), type)
          )
        )
      )
      const hydratedAny = hydratedEnergetic || hydratedStructural
      if (!sessionHasPlottableResults(session)) {
        throw new Error('Session has no plottable results.')
      }
      if (!hydratedAny) {
        logEvent(
          'warn',
          'analysis',
          'Session metadata loaded but CSV plot data was not found beside the session file.',
          sessionDir
        )
      }
      applyAnalysisSession(session)
      await hydratePlotDataFromOutputFolder([sessionDir])
      // Force a clean chart rebuild after async load (avoids stale empty view).
      await tick()
      await tick()
      if (mode === 'energetic') {
        rebuildEnergeticViewAfterLoad()
        await tick()
        bumpPlotData()
        const nPanels = energeticPanels.length
        const nPoints =
          energeticPanels[0]?.series?.[0]?.y?.length ||
          displaySeries[0]?.y?.length ||
          rawX.length ||
          0
        logEvent(
          'info',
          'analysis',
          'Energetic session loaded',
          `${nPanels} panel(s) · ${displaySeries.length} series · ${nPoints} points` +
            (hydratedEnergetic ? '' : ' · CSV hydrate missed energetic arrays')
        )
        if (nPanels === 0 && hydratedEnergetic) {
          analysisSets = clonePlainAnalysisData(analysisSets)
          rebuildEnergeticViewAfterLoad()
          await tick()
          bumpPlotData()
        }
      } else {
        bumpPlotData()
        const nSeries = chartView.series.length
        const nPoints = chartView.series[0]?.y?.length || 0
        logEvent(
          'info',
          'analysis',
          'Chart rebuilt after session load',
          `${chartView.mode} · ${nSeries} series · ${nPoints} points`
        )
        if (nSeries === 0 && hydratedAny) {
          analysisSets = clonePlainAnalysisData(analysisSets)
          await tick()
          bumpPlotData()
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      logEvent('error', 'analysis', 'Failed to load analysis session', lastError)
    }
  }

  async function browseAnalysisSessionFile() {
    const result = await window.api.openFileDialog(
      'Open Analysis Session',
      [{ name: 'Analysis session', extensions: ['json'] }],
      workingDir || outputDir || undefined
    )
    if (result.canceled || !result.filePath) return
    await loadAnalysisSessionFromPath(result.filePath)
    selectedSessionPath = result.filePath
  }

  // --- Energetic state ---
  /** @type {Array<{ path: string, timeNs: string, stride: string }>} */
  let logFiles = $state([])
  let energeticEngine = $state('namd') // 'namd' | 'openmm' | 'gromacs' | 'amber'
  /** @type {string[]} */
  let availableProperties = $state([])
  /** @type {string[]} */
  let selectedProperties = $state([])
  let timeUnits = $state('ns')
  let energyUnits = $state('kcal/mol')
  let pressureUnits = $state('atm')
  let temperatureUnits = $state('K')
  let volumeUnits = $state('Å³')

  // --- Output ---
  /** @type {Array<{ name: string, x: number[], y: number[], color?: string }>} */
  let chartSeries = $state([])
  let chartXLabel = $state('X')
  let chartYLabel = $state('Y')
  let chartTitle = $state('')
  let lastError = $state('')

  /** @param {string} text */
  async function copyAnalysisError(text) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* clipboard may be unavailable */
    }
  }

  /** @type {Record<string, number> | null} */
  let primaryStats = $state(null)
  let rawX = $state([])
  let rawY = $state([])
  /** @type {Array<{baseName:string,unit:string,y:number[],key?:string}>} */
  let rawSeries = $state([]) // Energetic series with base names + original units
  let rawXTimeUnit = $state('ns') // Time unit rawX was returned in (energetic)

  // --- Plot settings (collapsible) ---
  let plotSettingsOpen = $state(false)

  // Structural plot settings defaults
  const structDefaults = {
    title: '',
    xLabel: '',
    yLabel: '',
    lineColor: '#f59e0b',
    lineWidth: '2',
    plotBg: '#0a0a0a',
    textColor: '#a3a3a3',
    showGrid: true,
    xMin: '',
    xMax: '',
    yMin: '',
    yMax: '',
    yUnit: 'Å',
    xUnit: 'ns',
    aspectRatio: '2.5',
    transparentBg: false,
    dpi: '150',
    fontFamily: 'Roboto, sans-serif',
    extraLeftMargin: '0',
    extraBottomMargin: '0',
    legendPosition: 'top-left',
    xTickCount: '5',
    yTickCount: '5',
    residueCodeFormat: 'three',
    /** Show atom/residue selection under the plot title */
    showSelectionSubtitle: true,
    // Area-per-lipid series styling
    aplMeanLineStyle: 'solid',
    aplUpperLineStyle: 'dashed',
    aplLowerLineStyle: 'dotted',
    aplMeanMarker: 'none',
    aplUpperMarker: 'none',
    aplLowerMarker: 'none',
    aplMarkerSize: '3',
    /** Empty = use lineColor for mean */
    aplUpperColor: '',
    aplLowerColor: '',
    /** Marker every N points (1 = every point). */
    aplMeanMarkerEvery: '10',
    aplUpperMarkerEvery: '10',
    aplLowerMarkerEvery: '10'
  }
  // Energetic plot settings defaults
  const energDefaults = {
    title: '',
    xLabel: '',
    yLabel: '',
    lineColor: '#f59e0b',
    plotBg: '#0a0a0a',
    textColor: '#a3a3a3',
    showGrid: true,
    xMin: '',
    xMax: '',
    yMin: '',
    yMax: '',
    xUnit: 'ns',
    aspectRatio: '2.5',
    transparentBg: false,
    dpi: '150',
    fontFamily: 'Roboto, sans-serif',
    extraLeftMargin: '20',
    extraBottomMargin: '0',
    legendPosition: 'top-left',
    xTickCount: '5',
    yTickCount: '5',
    residueCodeFormat: 'three'
  }

  // Per-type plot settings — each analysis type keeps its own independent copy
  let sPlots = $state({
    rmsd: { ...structDefaults },
    rmsf: { ...structDefaults },
    distance: { ...structDefaults },
    radius_of_gyration: { ...structDefaults },
    area_per_lipid: { ...structDefaults, yUnit: 'Å²' },
    membrane_thickness: { ...structDefaults }
  })
  // Energetic plot: global defaults + per-panel overrides
  const energPanelShell = {
    aspectRatio: '2.5',
    transparentBg: false,
    legendPosition: 'top-left',
    xTickCount: '5',
    yTickCount: '5',
    extraLeftMargin: '20',
    extraBottomMargin: '0',
    residueCodeFormat: 'three'
  }
  let ePlotGlobal = $state({ ...energGlobalDefaults, ...energPanelShell })
  /** @type {Record<string, ReturnType<typeof defaultPanelSettings>>} */
  let ePlotPanels = $state({})
  /** @type {'overlay' | 'grid'} */
  let energeticLayout = $state('grid')
  /** @type {'pan' | 'boxZoom' | 'rangeSelect'} */
  let chartInteractionMode = $state('pan')
  let focusedPanelKey = $state('')
  /** @type {{ t0: number, t1: number } | null} */
  let statsRange = $state(null)
  /** @type {Record<string, import('../lib/chartStats.js').ReturnType<import('../lib/chartStats.js').computeSeriesStats>>} */
  let panelRangeStats = $state({})

  // Per-type stored structural results (null = not yet run for that type)
  /** @type {Record<string,{rawX:number[],rawY:number[],xLabels:string[],seriesName:string,primaryStats:any,chartXLabel:string,chartYLabel:string,chartTitle:string,selectionSubtitle:string,lastAnalysisHasTimeX:boolean}|null>} */
  let structResults = $state({
    rmsd: null,
    rmsf: null,
    distance: null,
    radius_of_gyration: null,
    area_per_lipid: null,
    membrane_thickness: null
  })

  const canSaveSession = $derived(
    canRunAnalysis &&
      (setsHavePlottableResults(analysisSets, mode) ||
        (mode === 'structural' && Object.values(structResults).some((r) => r != null)) ||
        (mode === 'energetic' && analysisSets.some((s) => s.energeticResult != null)))
  )

  /**
   * Build a short subtitle describing the selection(s) used for a structural run.
   * @param {string} type
   * @param {string} sel
   * @param {string} sel2
   * @param {string} leafletLipid
   * @param {string} leafletFilter
   */
  function formatSelectionSubtitle(type, sel, sel2, leafletLipid, leafletFilter) {
    const s1 = (sel || '').trim()
    const s2 = (sel2 || '').trim()
    let text = ''
    if (type === 'distance') {
      if (!s1 && !s2) return ''
      text = `Selection: ${s1 || '—'}  ·  ${s2 || '—'}`
    } else if (type === 'area_per_lipid' || type === 'membrane_thickness') {
      const parts = []
      if (s1) parts.push(s1)
      if ((leafletLipid || '').trim()) parts.push(`lipid: ${leafletLipid.trim()}`)
      if ((leafletFilter || '').trim()) parts.push(`filter: ${leafletFilter.trim()}`)
      if (!parts.length) return ''
      text = `Selection: ${parts.join(' · ')}`
    } else if (s1) {
      text = `Selection: ${s1}`
    } else {
      return ''
    }
    // Keep subtitle readable in the SVG title band
    const max = 96
    return text.length > max ? `${text.slice(0, max - 1)}…` : text
  }

  // Derived: active plot settings for structural mode
  const ps = $derived(mode === 'structural' ? sPlots[structuralType] : sPlots.rmsd)
  // Derived: active structural result for current type (null = not run yet)
  const activeStructRes = $derived.by(() => {
    if (mode !== 'structural') return null
    const set = analysisSets.find((s) => s.id === activeSetId)
    return resultForSetAndType(set, structuralType) ?? structResults[structuralType] ?? null
  })

  // ── Sync to shared status bar store ──
  $effect(() => {
    analysisStatus.running = running
    analysisStatus.mode = mode
    analysisStatus.analysisType = mode === 'structural' ? structuralType : 'energetic'
    analysisStatus.resultAvailable =
      mode === 'structural'
        ? activeStructRes !== null || showStructuralSetOverlay
        : chartSeries.length > 0 || isCompareOverlay
    analysisStatus.error = lastError || ''
  })

  const BILAYER_TYPES = new Set(['area_per_lipid', 'membrane_thickness'])
  const isBilayerType = (type) => BILAYER_TYPES.has(type)

  /** Default MDAnalysis selections when switching structural analysis type. */
  function defaultSelectionForStructuralType(type) {
    switch (type) {
      case 'rmsf':
        return { selection: 'protein and name CA', selection2: 'protein and resid 50' }
      case 'distance':
        return { selection: 'protein and backbone', selection2: 'protein and resid 50' }
      case 'radius_of_gyration':
        return { selection: 'protein', selection2: 'protein and resid 50' }
      case 'rmsd':
      default:
        return { selection: 'protein and backbone', selection2: 'protein and resid 50' }
    }
  }
  function convertX(xs, fromUnit, toUnit) {
    if (fromUnit === toUnit) return xs
    const factors = { ns: 1, ps: 1000, µs: 0.001 }
    const f = factors[toUnit] / factors[fromUnit]
    return xs.map((v) => v * f)
  }
  function convertStructY(ys, toUnit, analysisType = structuralType) {
    if (analysisType === 'area_per_lipid') {
      if (toUnit === 'Å²' || toUnit === '') return ys
      if (toUnit === 'nm²') return ys.map((v) => v * 0.01)
      return ys
    }
    // API returns Å; convert to nm if needed
    if (toUnit === 'Å' || toUnit === '') return ys
    if (toUnit === 'nm') return ys.map((v) => v * 0.1)
    return ys
  }

  // --- Energetic unit conversion helpers ---
  function getUnitType(unit) {
    if (['kcal/mol', 'kJ/mol'].includes(unit)) return 'energy'
    if (['atm', 'bar', 'kPa', 'MPa'].includes(unit)) return 'pressure'
    if (['K', '°C', '°F'].includes(unit)) return 'temperature'
    if (['Å³', 'nm³', 'mL', 'L'].includes(unit)) return 'volume'
    return null
  }

  function getTargetUnit(srcUnit) {
    const t = getUnitType(srcUnit)
    if (t === 'energy') return energyUnits
    if (t === 'pressure') return pressureUnits
    if (t === 'temperature') return temperatureUnits
    if (t === 'volume') return volumeUnits
    return srcUnit
  }

  function getTargetUnitForSet(srcUnit, /** @type {import('../lib/analysisSets.js').EnergeticOptions} */ eo) {
    const t = getUnitType(srcUnit)
    if (t === 'energy') return eo.energyUnits
    if (t === 'pressure') return eo.pressureUnits
    if (t === 'temperature') return eo.temperatureUnits
    if (t === 'volume') return eo.volumeUnits
    return srcUnit
  }

  function convertEnergeticYForSet(ys, fromUnit, /** @type {import('../lib/analysisSets.js').EnergeticOptions} */ eo) {
    if (!fromUnit || !ys?.length) return ys
    const toUnit = getTargetUnitForSet(fromUnit, eo)
    if (toUnit === fromUnit) return ys
    const type = getUnitType(fromUnit)
    if (type === 'energy') {
      const f = fromUnit === 'kcal/mol' ? 4.184 : 1 / 4.184
      return ys.map((v) => v * f)
    }
    if (type === 'pressure') {
      const perAtm = { atm: 1, bar: 1.01325, kPa: 101.325, MPa: 0.101325 }
      const f = perAtm[toUnit] / perAtm[fromUnit]
      return ys.map((v) => v * f)
    }
    if (type === 'temperature') {
      const toK = (v, u) => (u === 'K' ? v : u === '°C' ? v + 273.15 : ((v + 459.67) * 5) / 9)
      const fromK = (v, u) => (u === 'K' ? v : u === '°C' ? v - 273.15 : (v * 9) / 5 - 459.67)
      return ys.map((v) => fromK(toK(v, fromUnit), toUnit))
    }
    if (type === 'volume') {
      const perA3 = { 'Å³': 1, 'nm³': 1e-3, mL: 1e-24, L: 1e-27 }
      const f = perA3[toUnit] / perA3[fromUnit]
      return ys.map((v) => v * f)
    }
    return ys
  }

  function convertEnergeticYArr(ys, fromUnit) {
    if (!fromUnit || !ys?.length) return ys
    const toUnit = getTargetUnit(fromUnit)
    if (toUnit === fromUnit) return ys
    const type = getUnitType(fromUnit)
    if (type === 'energy') {
      const f = fromUnit === 'kcal/mol' ? 4.184 : 1 / 4.184
      return ys.map((v) => v * f)
    }
    if (type === 'pressure') {
      // perAtm[u] = how many u per 1 atm
      const perAtm = { atm: 1, bar: 1.01325, kPa: 101.325, MPa: 0.101325 }
      const f = perAtm[toUnit] / perAtm[fromUnit]
      return ys.map((v) => v * f)
    }
    if (type === 'temperature') {
      const toK = (v, u) => (u === 'K' ? v : u === '°C' ? v + 273.15 : ((v + 459.67) * 5) / 9)
      const fromK = (v, u) => (u === 'K' ? v : u === '°C' ? v - 273.15 : (v * 9) / 5 - 459.67)
      return ys.map((v) => fromK(toK(v, fromUnit), toUnit))
    }
    if (type === 'volume') {
      // perA3[u] = how many u per 1 Å³
      const perA3 = { 'Å³': 1, 'nm³': 1e-3, mL: 1e-24, L: 1e-27 }
      const f = perA3[toUnit] / perA3[fromUnit]
      return ys.map((v) => v * f)
    }
    return ys
  }

  // Derived helpers — per active type
  const activeXLabels = $derived(activeStructRes?.xLabels ?? [])
  const residueOneLetter = {
    ALA: 'A',
    ARG: 'R',
    ASN: 'N',
    ASP: 'D',
    CYS: 'C',
    GLU: 'E',
    GLN: 'Q',
    GLY: 'G',
    HIS: 'H',
    ILE: 'I',
    LEU: 'L',
    LYS: 'K',
    MET: 'M',
    PHE: 'F',
    PRO: 'P',
    SER: 'S',
    THR: 'T',
    TRP: 'W',
    TYR: 'Y',
    VAL: 'V',
    ASX: 'B',
    GLX: 'Z',
    SEC: 'U',
    PYL: 'O'
  }
  function toOneLetterResidueLabel(label) {
    const m = String(label || '').match(/^([A-Za-z]{3})([-+]?\d+)$/)
    if (!m) return String(label || '')
    const one = residueOneLetter[m[1].toUpperCase()] || m[1][0].toUpperCase()
    return `${one}${m[2]}`
  }
  const displayXTickLabels = $derived.by(() => {
    if (mode !== 'structural') return []
    if (structuralType !== 'rmsf') return activeXLabels
    if (rmsfXaxisType !== 'residue_type_number') return activeXLabels
    if (ps.residueCodeFormat !== 'one') return activeXLabels
    return activeXLabels.map(toOneLetterResidueLabel)
  })
  const activePrimaryStats = $derived(
    mode === 'structural' ? (activeStructRes?.primaryStats ?? null) : primaryStats
  )

  const visibleCompareSets = $derived.by(() => {
    plotDataRevision
    chartView.series.length
    if (mode === 'structural') {
      return analysisSets.filter(
        (s) => s.visible && structuralSetHasPlottableResult(s, structuralType)
      )
    }
    return analysisSets.filter((s) => s.visible && s.energeticResult)
  })
  /** True when this session has multiple energetic sets (compare UI), regardless of visibility. */
  const energeticMultiSetSession = $derived(
    mode === 'energetic' && analysisSets.filter((s) => s.energeticResult != null).length > 1
  )
  const showCompareLayoutControl = $derived(analysisSets.length > 1)
  /**
   * Structural: overlay when 2+ visible sets.
   * Energetic: stay on the multi-set path whenever the session has 2+ energetic
   * results — even if 0 or 1 set is checked — so we never fall back to the
   * active set's rawSeries (wrong data/color when the visible set ≠ active).
   */
  const isCompareOverlay = $derived(
    mode === 'structural'
      ? chartView.mode !== 'empty' &&
          analysisSets.filter((s) => s.visible && structuralSetHasPlottableResult(s, structuralType))
            .length > 1
      : energeticMultiSetSession
  )
  const showStructuralSetOverlay = $derived(
    mode === 'structural' && analysisSets.length > 1 && chartView.mode !== 'empty'
  )

  const analysisProgressDoneCount = $derived(
    runProgressStages.filter((s) => s.status === 'done').length
  )

  /**
   * Properties shown on energetic charts.
   * Uses the Properties checkboxes (selectedProperties), restricted in compare mode
   * to props that exist in every visible set's result data.
   */
  const compareEnergeticProperties = $derived.by(() => {
    if (mode !== 'energetic') return selectedProperties
    const sourceSets = energeticMultiSetSession
      ? visibleCompareSets.length
        ? visibleCompareSets
        : []
      : analysisSets.filter((s) => s.id === activeSetId)
    if (energeticMultiSetSession && visibleCompareSets.length === 0) return []
    const fallbackProps = [
      ...new Set(
        sourceSets.flatMap((s) => {
          const res = s.energeticResult
          if (!res) return []
          if (res.selectedProperties?.length) return res.selectedProperties
          return (res.rawSeries || []).map((r) => r.baseName).filter(Boolean)
        })
      )
    ]
    const base = selectedProperties.length ? selectedProperties : fallbackProps
    if (!energeticMultiSetSession) return base
    // Keep props that exist on every currently visible set.
    return base.filter((prop) =>
      visibleCompareSets.every((set) =>
        (set.energeticResult?.rawSeries || []).some((s) => s.baseName === prop)
      )
    )
  })

  const hasChartTimeAxis = $derived.by(() => {
    if (mode === 'energetic') return true
    if (showStructuralSetOverlay || isCompareOverlay) {
      return visibleCompareSets.every(
        (s) => resultForSetAndType(s, structuralType)?.lastAnalysisHasTimeX !== false
      )
    }
    return activeStructRes?.lastAnalysisHasTimeX !== false
  })

  const chartTimeUnitLabel = $derived(
    mode === 'energetic' ? timeUnits : sPlots[structuralType]?.xUnit || 'ns'
  )

  /** Build chart series from a stored structural set result. */
  function seriesFromSetResult(set, res) {
    const overlay = showStructuralSetOverlay
    const useSetPrefix = overlay && !(isCompareOverlay && compareLayout === 'grid')
    return buildStructuralSeries(set, res, {
      setPrefix: useSetPrefix,
      colorBySet: overlay
    })
  }

  /**
   * Build overlay series from an energetic set result.
   * @param {import('../lib/analysisSets.js').AnalysisSet} set
   * @param {string[] | null | undefined} properties
   * @param {{
   *   maxPoints?: number,
   *   colorBySet?: boolean,
   *   nameMode?: 'set' | 'prop' | 'set_prop'
   * }} [opts]
   */
  function seriesFromEnergeticSet(set, properties, opts = {}) {
    const res = set.energeticResult
    if (!res) return []
    const maxPoints = opts.maxPoints ?? 0
    const colorBySet = opts.colorBySet === true
    const nameMode = opts.nameMode ?? (colorBySet ? 'set_prop' : 'prop')
    const eo = set.energeticOptions
    const rawXs = res.rawX || []
    const props = properties ?? res.selectedProperties ?? []
    /** @type {Array<{ name: string, x: number[], y: number[], color?: string, baseName?: string, propLabel?: string }>} */
    const out = []
    for (const prop of props) {
      const s = res.rawSeries.find((r) => r.baseName === prop)
      if (!s) continue
      const n = Math.min(rawXs.length, s.y?.length ?? 0)
      const idx = maxPoints > 0 ? downsampleIndices(n, maxPoints) : null
      const xSample = idx ? idx.map((i) => rawXs[i]) : rawXs
      const ySample = idx ? idx.map((i) => s.y[i]) : s.y
      const xs = convertX(xSample, res.rawXTimeUnit, eo.timeUnits)
      const ys = convertEnergeticYForSet(ySample, s.unit, eo)
      const tUnit = getTargetUnitForSet(s.unit, eo)
      const propLabel = tUnit ? `${prop} (${tUnit})` : prop
      const name =
        nameMode === 'set'
          ? set.label
          : nameMode === 'set_prop'
            ? `${set.label} · ${propLabel}`
            : propLabel
      out.push({
        name,
        baseName: prop,
        propLabel,
        x: xs,
        y: ys,
        color: colorBySet ? set.color : ePlotPanels[s.baseName]?.lineColor || set.color
      })
    }
    return out
  }

  /** Default Y-axis label for a property (name + units), never includes set label. */
  function energeticPropYLabel(baseName) {
    if (!baseName) return 'Value'
    for (const set of visibleCompareSets.length ? visibleCompareSets : analysisSets) {
      const s = set.energeticResult?.rawSeries?.find((r) => r.baseName === baseName)
      if (!s) continue
      const eo = set.energeticOptions
      const tUnit = getTargetUnitForSet(s.unit, eo)
      return tUnit ? `${baseName} (${tUnit})` : baseName
    }
    const local = rawSeries.find((r) => r.baseName === baseName)
    if (local) {
      const tUnit = getTargetUnit(local.unit)
      return tUnit ? `${baseName} (${tUnit})` : baseName
    }
    return baseName
  }

  /** Y-axis label for an energetic panel (property + units; not set names). */
  function energeticPanelYLabel(panel, pset) {
    const custom = String(pset?.ylabel || '').trim()
    if (custom) return custom
    const fromSeries = [
      ...new Set(
        (panel?.series || [])
          .map((s) => s.propLabel || energeticPropYLabel(s.baseName) || '')
          .filter(Boolean)
      )
    ]
    if (fromSeries.length === 1) return fromSeries[0]
    if (panel?.key && panel.key !== '__compare__' && panel.key !== '__overlay__') {
      // Property-keyed panel
      if (selectedProperties.includes(panel.key) || availableProperties.includes(panel.key)) {
        return energeticPropYLabel(panel.key)
      }
    }
    if (compareEnergeticProperties.length === 1) {
      return energeticPropYLabel(compareEnergeticProperties[0])
    }
    return 'Value'
  }

  /** Chart title for an energetic panel (custom panel title → global → defaults). */
  function energeticPanelChartTitle(panel, pset) {
    const panelTitle = String(pset?.title || '').trim()
    if (panelTitle) return panelTitle
    const globalTitle = String(ePlotGlobal.title || '').trim()
    if (panel?.key === '__compare__' || panel?.key === '__overlay__') {
      return globalTitle || chartTitle || panel?.title || ''
    }
    // Per-property or per-set panel: prefer panel default title, then global
    return panel?.title || globalTitle || chartTitle || ''
  }

  const comparePanels = $derived.by(() => {
    plotDataRevision
    if (mode === 'structural') {
      return chartView.mode === 'grid' ? chartView.panels : []
    }
    // Energetic compare panels are built in energeticPanels (by_property / by_set).
    return []
  })

  $effect(() => {
    if (statsRange) {
      statsRangeStartInput = String(Math.min(statsRange.t0, statsRange.t1))
      statsRangeEndInput = String(Math.max(statsRange.t0, statsRange.t1))
    }
  })

  const hasSavedResultMetadata = $derived(
    mode === 'structural'
      ? analysisSets.some((s) => resultForSetAndType(s, structuralType) != null)
      : analysisSets.some(
          (s) =>
            s.energeticResult != null ||
            Boolean(s.energeticResult?.dataCsv) ||
            (s.energeticOptions?.logFiles?.length ?? 0) > 0
        )
  )

  // Build displayed chart series applying unit conversions
  const displaySeries = $derived.by(() => {
    plotDataRevision
    if (mode === 'structural') {
      return chartView.series
    }
    // Multi-set energetic sessions: always build from visible sets only (never active rawSeries).
    if (energeticMultiSetSession) {
      if (visibleCompareSets.length === 0 || compareEnergeticProperties.length === 0) return []
      const colorBySet = energeticCompareLayout !== 'by_set'
      const nameMode =
        energeticCompareLayout === 'by_property'
          ? 'set'
          : energeticCompareLayout === 'by_set'
            ? 'prop'
            : 'set_prop'
      return visibleCompareSets.flatMap((set) =>
        seriesFromEnergeticSet(set, compareEnergeticProperties, {
          maxPoints: DEFAULT_CHART_MAX_POINTS,
          colorBySet,
          nameMode
        })
      )
    }
    // Single-set energetic: active set rawSeries
    if (rawSeries.length === 0) return []
    const visible = rawSeries.filter((s) => selectedProperties.includes(s.baseName))
    return visible.map((s) => {
      const n = Math.min(rawX.length, s.y?.length ?? 0)
      const idx = downsampleIndices(n, DEFAULT_CHART_MAX_POINTS)
      const xSample = idx ? idx.map((i) => rawX[i]) : rawX
      const ySample = idx ? idx.map((i) => s.y[i]) : s.y
      const xs = convertX(xSample, rawXTimeUnit, timeUnits)
      const ys = convertEnergeticYArr(ySample, s.unit)
      const tUnit = getTargetUnit(s.unit)
      const displayName = tUnit ? `${s.baseName} (${tUnit})` : s.baseName
      return {
        name: displayName,
        propLabel: displayName,
        x: xs,
        y: ys,
        key: s.key,
        baseName: s.baseName,
        color: ePlotPanels[s.baseName]?.lineColor
      }
    })
  })

  const chartStatsRows = $derived.by(() => {
    if (displaySeries.length === 0) return []
    const t0 = statsRange ? Math.min(statsRange.t0, statsRange.t1) : null
    const t1 = statsRange ? Math.max(statsRange.t0, statsRange.t1) : null
    return displaySeries.map((s) => {
      let stats
      if (t0 != null && t1 != null && hasChartTimeAxis) {
        stats = computeSeriesStats(s, t0, t1)
      } else if (
        !statsRange &&
        mode === 'structural' &&
        !showStructuralSetOverlay &&
        !isCompareOverlay &&
        s.name === activeStructRes?.seriesName &&
        activePrimaryStats
      ) {
        stats = {
          count: s.y?.length ?? 0,
          mean: activePrimaryStats.mean,
          std: activePrimaryStats.std,
          min: activePrimaryStats.min,
          max: activePrimaryStats.max
        }
      } else if (
        !statsRange &&
        mode === 'energetic' &&
        !energeticMultiSetSession &&
        primaryStats &&
        displaySeries.length === 1
      ) {
        // Only reuse active-set primaryStats in single-set mode (visible set may ≠ active).
        stats = {
          count: s.y?.length ?? 0,
          mean: primaryStats.mean,
          std: primaryStats.std,
          min: primaryStats.min,
          max: primaryStats.max
        }
      } else {
        stats = computeSeriesStats(s)
      }
      return { name: s.name, color: s.color || '#f59e0b', stats }
    })
  })

  const energeticPanels = $derived.by(() => {
    plotDataRevision
    if (mode !== 'energetic') return []
    // Multi-set session: panels always follow checked (visible) sets only.
    if (energeticMultiSetSession) {
      if (visibleCompareSets.length === 0 || compareEnergeticProperties.length === 0) return []
      if (energeticCompareLayout === 'overlay') {
        if (displaySeries.length === 0) return []
        return [{ key: '__compare__', title: displayTitle || chartTitle, series: displaySeries }]
      }
      if (energeticCompareLayout === 'by_set') {
        return visibleCompareSets
          .map((set) => ({
            key: set.id,
            title: set.label,
            series: seriesFromEnergeticSet(set, compareEnergeticProperties, {
              maxPoints: DEFAULT_CHART_MAX_POINTS,
              colorBySet: false,
              nameMode: 'prop'
            })
          }))
          .filter((p) => p.series.length > 0)
      }
      // by_property (default): one panel per property; each visible set keeps its own color
      return compareEnergeticProperties
        .map((prop) => ({
          key: prop,
          title: prop,
          series: visibleCompareSets.flatMap((set) =>
            seriesFromEnergeticSet(set, [prop], {
              maxPoints: DEFAULT_CHART_MAX_POINTS,
              colorBySet: true,
              nameMode: 'set'
            })
          )
        }))
        .filter((p) => p.series.length > 0)
    }
    if (displaySeries.length === 0) return []
    if (energeticLayout === 'overlay') {
      return [{ key: '__overlay__', title: displayTitle || chartTitle, series: displaySeries }]
    }
    return displaySeries.map((s) => ({
      key: s.baseName ?? s.key ?? s.name,
      title: s.baseName ?? s.name,
      series: [s]
    }))
  })

  const energeticChartIsEmpty = $derived(
    mode === 'energetic' && energeticPanels.length === 0 && displaySeries.length === 0
  )

  /** @param {string} key */
  function ensureEPlotPanel(key) {
    if (!key || ePlotPanels[key]) return
    const idx = selectedProperties.indexOf(key)
    const colors = ['#f59e0b', '#22c55e', '#38bdf8', '#f87171', '#a78bfa', '#f472b6']
    ePlotPanels = {
      ...ePlotPanels,
      [key]: defaultPanelSettings(colors[idx >= 0 ? idx % colors.length : 0])
    }
  }

  /** @param {string} key */
  function focusPanel(key) {
    if (!key) return
    ensureEPlotPanel(key)
    focusedPanelKey = key
  }

  /** @param {string} key @param {{ xMin?: number|null, xMax?: number|null, yMin?: number|null, yMax?: number|null }} range */
  function applyPanelAxisRange(key, range) {
    if (!key) return
    ensureEPlotPanel(key)
    const panel = { ...ePlotPanels[key] }
    if (range.xMin != null) panel.xMin = String(range.xMin)
    if (range.xMax != null) panel.xMax = String(range.xMax)
    if (range.yMin != null) panel.yMin = String(range.yMin)
    if (range.yMax != null) panel.yMax = String(range.yMax)
    if (range.xMin == null && range.xMax == null && range.yMin == null && range.yMax == null) {
      panel.xMin = ''
      panel.xMax = ''
      panel.yMin = ''
      panel.yMax = ''
    }
    ePlotPanels = { ...ePlotPanels, [key]: panel }
    if (ePlotGlobal.syncX !== false && range.xMin != null && range.xMax != null) {
      const next = { ...ePlotPanels }
      for (const k of Object.keys(next)) {
        next[k] = { ...next[k], xMin: String(range.xMin), xMax: String(range.xMax) }
      }
      ePlotPanels = next
    }
  }

  /** @param {{ t0: number, t1: number } | null} range */
  function handleStatsRange(range) {
    statsRange = range
    if (!range) {
      panelRangeStats = {}
      return
    }
    const t0 = Math.min(range.t0, range.t1)
    const t1 = Math.max(range.t0, range.t1)
    if (mode === 'structural' || energeticLayout === 'overlay') {
      panelRangeStats = computeMultiSeriesStats(displaySeries, t0, t1)
      return
    }
    const key = focusedPanelKey || energeticPanels[0]?.key
    const panel = energeticPanels.find((p) => p.key === key) ?? energeticPanels[0]
    if (panel) {
      panelRangeStats = computeMultiSeriesStats(panel.series, t0, t1)
    }
  }

  function applyStructAxisRange(range) {
    const type = structuralType
    const plot = { ...sPlots[type] }
    if (range.xMin != null) plot.xMin = String(range.xMin)
    if (range.xMax != null) plot.xMax = String(range.xMax)
    if (range.yMin != null) plot.yMin = String(range.yMin)
    if (range.yMax != null) plot.yMax = String(range.yMax)
    if (range.xMin == null && range.xMax == null && range.yMin == null && range.yMax == null) {
      plot.xMin = ''
      plot.xMax = ''
      plot.yMin = ''
      plot.yMax = ''
    }
    sPlots = { ...sPlots, [type]: plot }
  }

  function resetChartView() {
    chartInteractionMode = 'pan'
    statsRange = null
    panelRangeStats = {}
    statsRangeStartInput = ''
    statsRangeEndInput = ''
    if (mode === 'structural') {
      applyStructAxisRange({})
    } else {
      const next = { ...ePlotPanels }
      for (const k of Object.keys(next)) {
        next[k] = { ...next[k], xMin: '', xMax: '', yMin: '', yMax: '' }
      }
      ePlotPanels = next
    }
  }

  function applyStatsRangeFromInputs() {
    const t0 = Number(statsRangeStartInput)
    const t1 = Number(statsRangeEndInput)
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) return
    chartInteractionMode = 'rangeSelect'
    handleStatsRange({ t0, t1 })
  }

  function clearStatsRange() {
    handleStatsRange(null)
    statsRangeStartInput = ''
    statsRangeEndInput = ''
  }

  function captureStructuralOptions() {
    return {
      structuralType,
      selection,
      selection2,
      referenceFrame,
      align,
      rmsfXaxisType,
      leafletLipidSel,
      leafletFilterSel,
      nBins,
      interpolate
    }
  }

  function captureEnergeticOptions() {
    return {
      energeticEngine,
      logFiles: [...logFiles],
      availableProperties: [...availableProperties],
      selectedProperties: [...selectedProperties],
      timeUnits,
      energyUnits,
      pressureUnits,
      temperatureUnits,
      volumeUnits
    }
  }

  function applyStructuralOptions(/** @type {import('../lib/analysisSets.js').StructuralOptions} */ opts) {
    structuralType = opts.structuralType
    selection = opts.selection
    selection2 = opts.selection2
    referenceFrame = opts.referenceFrame
    align = opts.align
    rmsfXaxisType = opts.rmsfXaxisType
    leafletLipidSel = opts.leafletLipidSel
    leafletFilterSel = opts.leafletFilterSel
    nBins = opts.nBins
    interpolate = opts.interpolate
  }

  function applyEnergeticOptions(/** @type {import('../lib/analysisSets.js').EnergeticOptions} */ opts) {
    energeticEngine = opts.energeticEngine || 'namd'
    logFiles = [...(opts.logFiles || [])]
    availableProperties = [...(opts.availableProperties || [])]
    selectedProperties = [...(opts.selectedProperties || [])]
    timeUnits = opts.timeUnits || 'ns'
    energyUnits = opts.energyUnits || 'kcal/mol'
    pressureUnits = opts.pressureUnits || 'atm'
    temperatureUnits = opts.temperatureUnits || 'K'
    volumeUnits = opts.volumeUnits || 'Å³'
  }

  function applyEnergeticResultToView(/** @type {import('../lib/analysisSets.js').EnergeticSetResult | null} */ res) {
    if (!res) {
      rawX = []
      rawY = []
      rawSeries = []
      chartSeries = []
      chartTitle = ''
      chartXLabel = 'Time'
      primaryStats = null
      return
    }
    rawX = res.rawX || []
    rawY = res.rawSeries?.[0]?.y || []
    rawXTimeUnit = res.rawXTimeUnit || 'ns'
    rawSeries = (res.rawSeries || []).map((s) => ({ ...s, y: s.y || [] }))
    chartSeries = rawSeries.map((s) => ({
      name: s.unit ? `${s.baseName} (${s.unit})` : s.baseName,
      x: rawX,
      y: s.y
    }))
    chartTitle = res.chartTitle || chartTitle || 'Energetic Analysis'
    chartXLabel = res.chartXLabel || 'Time'
    // Keep property checkboxes aligned with stored result (session load / set switch).
    const fromResult = res.selectedProperties?.length
      ? [...res.selectedProperties]
      : rawSeries.map((s) => s.baseName).filter(Boolean)
    if (fromResult.length && selectedProperties.length === 0) {
      selectedProperties = fromResult
    }
    if (fromResult.length && availableProperties.length === 0) {
      availableProperties = [...fromResult]
    }
    for (const p of selectedProperties) ensureEPlotPanel(p)
    const first = rawSeries?.[0]?.key ?? res.selectedProperties?.[0]
    primaryStats = first && res.statistics ? res.statistics[first] || null : null
  }

  /**
   * After loading a slim energetic (or mixed) session, force the open energetic
   * tab to rebuild from hydrated set data. Fixes empty chart until the user
   * toggles sets / switches modes.
   */
  function rebuildEnergeticViewAfterLoad() {
    if (mode !== 'energetic') return
    // Prefer a visible set with plottable energetic data as the "active" view source.
    const visibleWithData = analysisSets.filter(
      (s) => s.visible && energeticResultHasPlotData(s.energeticResult)
    )
    const active = analysisSets.find((s) => s.id === activeSetId)
    if (
      visibleWithData.length > 0 &&
      (!active?.visible || !energeticResultHasPlotData(active.energeticResult))
    ) {
      activeSetId = visibleWithData[0].id
    }
    const set = analysisSets.find((s) => s.id === activeSetId) || visibleWithData[0]
    if (!set) return
    applyEnergeticOptions(set.energeticOptions || defaultEnergeticOptionsFallback())
    // Merge selected props from all sets that have energetic results (compare UX).
    const unionProps = [
      ...new Set(
        analysisSets.flatMap((s) => {
          const res = s.energeticResult
          if (!res) return []
          if (res.selectedProperties?.length) return res.selectedProperties
          return (res.rawSeries || []).map((r) => r.baseName).filter(Boolean)
        })
      )
    ]
    if (unionProps.length) {
      selectedProperties = unionProps.filter(
        (p) =>
          !availableProperties.length ||
          availableProperties.includes(p) ||
          analysisSets.some((s) =>
            (s.energeticResult?.rawSeries || []).some((r) => r.baseName === p)
          )
      )
      if (selectedProperties.length === 0) selectedProperties = [...unionProps]
    }
    applyEnergeticResultToView(set.energeticResult)
    for (const p of selectedProperties) ensureEPlotPanel(p)
    // Touch analysisSets so $derived charts re-subscribe after async hydrate.
    analysisSets = analysisSets.map((s) => ({ ...s }))
    bumpPlotData()
  }

  function defaultEnergeticOptionsFallback() {
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

  function persistActiveSetFields() {
    analysisSets = analysisSets.map((s) =>
      s.id === activeSetId
        ? {
            ...s,
            topologyPath,
            trajectoryFiles: [...trajectoryFiles],
            structuralOptions: captureStructuralOptions(),
            energeticOptions: captureEnergeticOptions()
          }
        : s
    )
  }

  function loadActiveSetFields() {
    const set = analysisSets.find((s) => s.id === activeSetId)
    if (!set) return
    topologyPath = set.topologyPath
    trajectoryFiles = [...set.trajectoryFiles]
    applyStructuralOptions(set.structuralOptions)
    applyEnergeticOptions(set.energeticOptions)
    if (!outputFolderName.trim()) {
      outputFolderName = defaultAnalysisFolderName(topologyPath)
    }
    lipidHeadgroupAtoms = []
    headgroupDetectAttempted = false
    if (set.structuralResult || set.structuralResults) {
      rebuildStructResultsFromSets()
    }
    if (mode === 'energetic') {
      applyEnergeticResultToView(set.energeticResult)
    }
  }

  function updateSetLabel(id, label) {
    analysisSets = analysisSets.map((s) => (s.id === id ? { ...s, label } : s))
  }

  function onModeChange(/** @type {'structural' | 'energetic'} */ next) {
    if (next === mode) return
    persistActiveSetFields()
    mode = next
    loadActiveSetFields()
    if (next === 'energetic') {
      rebuildEnergeticViewAfterLoad()
    } else {
      rebuildStructResultsFromSets()
      bumpPlotData()
    }
  }

  function selectAnalysisSet(id) {
    if (id === activeSetId) return
    persistActiveSetFields()
    activeSetId = id
    loadActiveSetFields()
  }

  function addAnalysisSet() {
    persistActiveSetFields()
    const id = newSetId()
    analysisSets = [...analysisSets, createAnalysisSet(analysisSets.length, id)]
    activeSetId = id
    loadActiveSetFields()
  }

  function duplicateActiveSet() {
    persistActiveSetFields()
    const current = analysisSets.find((s) => s.id === activeSetId)
    if (!current) return
    const copy = duplicateAnalysisSet(current, analysisSets.length)
    analysisSets = [...analysisSets, copy]
    activeSetId = copy.id
    loadActiveSetFields()
  }

  function removeAnalysisSet(id) {
    if (analysisSets.length <= 1) return
    analysisSets = analysisSets.filter((s) => s.id !== id)
    if (activeSetId === id) {
      activeSetId = analysisSets[0].id
      loadActiveSetFields()
    }
  }

  function toggleSetVisible(id, visible) {
    analysisSets = analysisSets.map((s) => (s.id === id ? { ...s, visible } : s))
    bumpPlotData()
  }

  /** @param {'overlay' | 'grid'} layout */
  function setCompareLayout(layout) {
    compareLayout = layout === 'grid' ? 'grid' : 'overlay'
    bumpPlotData()
  }

  /** @param {import('../lib/analysisSession.js').EnergeticCompareLayout | string} layout */
  function setEnergeticCompareLayout(layout) {
    energeticCompareLayout = normalizeEnergeticCompareLayout(layout)
    bumpPlotData()
  }

  /** @param {string} type @param {object} resultPayload */
  function storeStructuralResult(type, resultPayload) {
    const payload = clonePlainAnalysisData({ analysisType: type, ...resultPayload })
    structResults[type] = payload
    analysisSets = clonePlainAnalysisData(
      analysisSets.map((s) => {
        if (s.id !== activeSetId) return { ...s }
        const prior = { ...(s.structuralResults || {}) }
        if (s.structuralResult?.analysisType) {
          const prevType = s.structuralResult.analysisType
          const existing = prior[prevType]
          if (
            !(
              existing &&
              structuralResultHasPlotData(existing) &&
              !structuralResultHasPlotData(s.structuralResult)
            )
          ) {
            prior[prevType] = clonePlainAnalysisData(s.structuralResult)
          }
        }
        return {
          ...s,
          structuralResult: payload,
          structuralResults: { ...prior, [type]: payload }
        }
      })
    )
    bumpPlotData()
  }

  /** @param {import('../lib/analysisSets.js').EnergeticSetResult} resultPayload */
  function storeEnergeticResult(resultPayload) {
    const set = analysisSets.find((s) => s.id === activeSetId)
    const withCsv = {
      ...resultPayload,
      dataCsv:
        resultPayload.dataCsv ||
        csvFileNameForEnergeticSet(set || { label: 'set' }, analysisSets.length)
    }
    analysisSets = analysisSets.map((s) =>
      s.id === activeSetId ? { ...s, energeticResult: withCsv } : s
    )
    applyEnergeticResultToView(withCsv)
  }

  async function runStructuralForActiveSet() {
    if (!topologyPath) throw new Error(`Set "${analysisSets.find((s) => s.id === activeSetId)?.label}": select a topology file.`)
    if (trajectoryFiles.length === 0) throw new Error(`Set "${analysisSets.find((s) => s.id === activeSetId)?.label}": add at least one trajectory file.`)
    if (structuralType === 'distance' && (!selection || !selection2))
      throw new Error('Distance analysis requires two atom selections.')
    if (isBilayerType(structuralType)) {
      if (!selection.trim() && topologyPath) {
        await refreshHeadgroupAtoms()
      }
      if (!selection.trim())
        throw new Error('Enable at least one phosphate/headgroup atom name.')
    }

    const result = await runStructuralAnalysis({
      topologyPath,
      trajectoryPaths: trajectoryFiles.map((f) => f.path),
      analysisType: structuralType,
      selection,
      selection2,
      referenceFrame: Number(referenceFrame || 0),
      align,
      fileTimes: makeFileTimes(trajectoryFiles),
      fileStrides: makeFileStrides(trajectoryFiles),
      rmsfXaxisType: rmsfXaxisType,
      leafletLipidSel: leafletLipidSel.trim() || null,
      leafletFilterSel: leafletFilterSel.trim() || null,
      nBins: Number(nBins) || 1,
      interpolate
    })

    const xLabelsResult = result.x_labels || []
    const extraSeries =
      structuralType === 'area_per_lipid'
        ? [
            { name: 'Upper leaflet', rawY: result.mean_upper_leaflet || [] },
            { name: 'Lower leaflet', rawY: result.mean_lower_leaflet || [] }
          ]
        : []
    storeStructuralResult(structuralType, {
      rawX: result.x || [],
      rawY: result.y || [],
      xLabels: xLabelsResult,
      extraSeries,
      seriesName: result.series_name,
      primaryStats: result.stats || null,
      chartXLabel: result.x_label || 'X',
      chartYLabel: result.y_label || 'Y',
      chartTitle: `${(result.analysis_type || structuralType).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} Analysis`,
      selectionSubtitle: formatSelectionSubtitle(
        structuralType,
        selection,
        selection2,
        leafletLipidSel,
        leafletFilterSel
      ),
      lastAnalysisHasTimeX: xLabelsResult.length === 0
    })
  }

  async function runEnergeticForActiveSet() {
    const setLabel = analysisSets.find((s) => s.id === activeSetId)?.label ?? 'Set'
    if (logFiles.length === 0) throw new Error(`Set "${setLabel}": add at least one log file.`)
    if (selectedProperties.length === 0) throw new Error(`Set "${setLabel}": select at least one property.`)

    const result = await runEnergeticAnalysis({
      logPaths: logFiles.map((f) => f.path),
      properties: selectedProperties,
      fileTimes: makeFileTimes(logFiles),
      fileStrides: makeFileStrides(logFiles),
      timeUnits,
      energyUnits,
      pressureUnits,
      temperatureUnits,
      volumeUnits,
      engine: energeticEngine
    })

    const engineLabels = { namd: 'NAMD', openmm: 'OpenMM', gromacs: 'GROMACS', amber: 'Amber' }
    const rawSeriesLocal = (result.series || []).map((s) => ({
      baseName: s.name,
      unit: s.unit || '',
      y: s.y || [],
      key: s.key
    }))

    storeEnergeticResult({
      rawX: result.x || [],
      rawXTimeUnit: timeUnits,
      rawSeries: rawSeriesLocal,
      chartTitle: `${engineLabels[energeticEngine] || energeticEngine.toUpperCase()} Energetic Analysis`,
      chartXLabel: result.x_label || 'Time',
      selectedProperties: [...selectedProperties],
      energeticEngine,
      statistics: result.statistics || {}
    })

    for (const s of rawSeriesLocal) {
      ensureEPlotPanel(s.baseName)
    }
    focusedPanelKey = selectedProperties[0] ?? ''
    if (!isCompareOverlay) {
      energeticLayout = selectedProperties.length >= 2 ? 'grid' : 'overlay'
    }
  }

  function buildEnergeticPlotPayload() {
    const seriesForSpec = rawSeries.filter((s) => selectedProperties.includes(s.baseName))
    const xs = convertX(rawX, rawXTimeUnit, timeUnits)
    return {
      data: {
        x: xs,
        series: seriesForSpec.map((s) => ({
          key: s.key,
          name: s.baseName,
          unit: getTargetUnit(s.unit),
          y: convertEnergeticYArr(s.y, s.unit)
        }))
      },
      plotSpec: buildPlotSpecFromGui({
        layout: energeticLayout,
        globalSettings: ePlotGlobal,
        panelSettings: ePlotPanels,
        rawSeries: seriesForSpec,
        selectedKeys: selectedProperties,
        timeUnits,
        energyUnits
      })
    }
  }

  const displayXLabel = $derived.by(() => {
    if (mode === 'energetic') {
      if (ePlotGlobal.xLabel) return ePlotGlobal.xLabel
      return `${chartXLabel.replace(/\s*\(.*\)$/, '')} (${timeUnits})`
    }
    if (ps.xLabel) return ps.xLabel
    if (!activeStructRes) return 'X'
    if (!activeStructRes.lastAnalysisHasTimeX) return activeStructRes.chartXLabel
    const sp = sPlots[structuralType]
    return activeStructRes.chartXLabel.includes('(')
      ? activeStructRes.chartXLabel.replace(/\(.*\)/, `(${sp.xUnit})`).trim()
      : `${activeStructRes.chartXLabel} (${sp.xUnit})`
  })
  const displayYLabel = $derived.by(() => {
    if (mode === 'energetic') {
      const props = isCompareOverlay ? compareEnergeticProperties : selectedProperties
      if (props.length === 1) return energeticPropYLabel(props[0])
      const labels = [
        ...new Set(
          displaySeries
            .map((s) => s.propLabel || energeticPropYLabel(s.baseName) || '')
            .filter(Boolean)
        )
      ]
      if (labels.length === 1) return labels[0]
      return labels.length ? 'Value' : 'Value'
    }
    if (ps.yLabel) return ps.yLabel
    if (!activeStructRes) return 'Y'
    const sp = sPlots[structuralType]
    if (structuralType === 'area_per_lipid') {
      return sp.yUnit !== 'Å²'
        ? activeStructRes.chartYLabel.replace(/\(Å²\)/, `(${sp.yUnit})`)
        : activeStructRes.chartYLabel
    }
    return sp.yUnit !== 'Å'
      ? activeStructRes.chartYLabel.replace(/\(Å\)/, `(${sp.yUnit})`)
      : activeStructRes.chartYLabel
  })
  const displayTitle = $derived.by(() => {
    if (mode === 'energetic') {
      return String(ePlotGlobal.title || '').trim() || chartTitle || 'Energetic Analysis'
    }
    return ps.title || activeStructRes?.chartTitle || ''
  })
  const displaySubtitle = $derived.by(() => {
    if (mode !== 'structural') return ''
    // Default on when the setting is missing (older session state)
    if (ps.showSelectionSubtitle === false) return ''
    return activeStructRes?.selectionSubtitle || ''
  })

  // Axis overrides
  const xMinO = $derived(
    ps.xMin !== '' && Number.isFinite(Number(ps.xMin)) ? Number(ps.xMin) : null
  )
  const xMaxO = $derived(
    ps.xMax !== '' && Number.isFinite(Number(ps.xMax)) ? Number(ps.xMax) : null
  )
  const yMinO = $derived(
    ps.yMin !== '' && Number.isFinite(Number(ps.yMin)) ? Number(ps.yMin) : null
  )
  const yMaxO = $derived(
    ps.yMax !== '' && Number.isFinite(Number(ps.yMax)) ? Number(ps.yMax) : null
  )

  // --- Modals ---
  let showSelectionHelp = $state(false)
  let showTopoInfo = $state(false)
  let topoInfo = $state(null)
  let topoLoading = $state(false)

  // SVG element ref for export
  let svgEl = $state(null)

  // ---- Helpers ----
  function applyHeadgroupDetection(data) {
    const atoms = data?.lipid_headgroup_atoms || []
    lipidHeadgroupAtoms = atoms.map((a) => ({
      name: a.name,
      atomCount: a.atom_count ?? a.atomCount ?? 0,
      enabled: true
    }))
    syncHeadgroupSelection()
  }

  function addManualHeadgroupName() {
    const name = manualHeadgroupName.trim()
    if (!name) return
    if (lipidHeadgroupAtoms.some((a) => a.name === name)) {
      lipidHeadgroupAtoms = lipidHeadgroupAtoms.map((a) =>
        a.name === name ? { ...a, enabled: true } : a
      )
    } else {
      lipidHeadgroupAtoms = [
        ...lipidHeadgroupAtoms,
        { name, atomCount: 0, enabled: true }
      ]
    }
    manualHeadgroupName = ''
    syncHeadgroupSelection()
  }

  function removeHeadgroupAtom(name) {
    lipidHeadgroupAtoms = lipidHeadgroupAtoms.filter((a) => a.name !== name)
    syncHeadgroupSelection()
  }

  function syncHeadgroupSelection() {
    const names = lipidHeadgroupAtoms.filter((a) => a.enabled).map((a) => a.name)
    selection = names.length ? `name ${names.join(' ')}` : ''
  }

  function toggleHeadgroupAtom(name, enabled) {
    lipidHeadgroupAtoms = lipidHeadgroupAtoms.map((a) =>
      a.name === name ? { ...a, enabled } : a
    )
    syncHeadgroupSelection()
  }

  async function refreshHeadgroupAtoms() {
    if (!topologyPath) return
    const gen = ++headgroupDetectGeneration
    headgroupDetecting = true
    headgroupDetectAttempted = true
    try {
      const data = await detectLipidHeadgroups({
        topologyPath,
        trajectoryPaths: trajectoryFiles.map((f) => f.path)
      })
      if (gen !== headgroupDetectGeneration || !isBilayerType(structuralType)) return
      applyHeadgroupDetection(data)
      persistActiveSetFields()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      if (gen === headgroupDetectGeneration) headgroupDetecting = false
    }
  }

  function basename(path) {
    return path.split(/[\\/]/).pop() || path
  }

  function sortByName(files) {
    return [...files].sort((a, b) =>
      basename(a.path).localeCompare(basename(b.path), undefined, {
        numeric: true,
        sensitivity: 'base'
      })
    )
  }

  function makeFileTimes(items) {
    const map = {}
    for (const item of items) {
      const value = Number(item.timeNs)
      if (Number.isFinite(value) && value > 0) {
        map[basename(item.path)] = Math.round(value * 1000) / 1000
      }
    }
    return map
  }

  function makeFileStrides(items) {
    const map = {}
    for (const item of items) {
      const value = Math.min(999, Math.max(1, Math.floor(Number(item.stride) || 1)))
      map[basename(item.path)] = value
    }
    return map
  }

  $effect(() => {
    selection
    selection2
    topologyPath
    selectionAtomCount = null
    selection2AtomCount = null
    selectionCountError = ''
  })

  /** @param {'selection' | 'selection2'} which */
  async function countSelectionAtoms(which) {
    selectionCountError = ''
    if (!topologyPath) {
      selectionCountError = 'Select a topology file first.'
      return
    }
    const sel = (which === 'selection2' ? selection2 : selection).trim()
    if (!sel) {
      selectionCountError = 'Enter a selection first.'
      return
    }
    selectionCountLoading = true
    try {
      const result = await countAnalysisSelection({
        topologyPath,
        trajectoryPaths: trajectoryFiles.map((f) => f.path),
        selection: sel
      })
      if (which === 'selection2') {
        selection2AtomCount = result.count
      } else {
        selectionAtomCount = result.count
      }
    } catch (error) {
      selectionCountError = error instanceof Error ? error.message : String(error)
      if (which === 'selection2') selection2AtomCount = null
      else selectionAtomCount = null
    } finally {
      selectionCountLoading = false
    }
  }

  // ---- File pickers ----
  async function pickTopologyFile() {
    const result = await window.api.openFileDialog(
      'Select Topology File',
      [{ name: 'Topology', extensions: ['pdb', 'psf', 'prmtop', 'parm7', 'gro'] }],
      workingDir || undefined
    )
    if (!result.canceled) {
      topologyPath = result.filePath
      outputFolderName = defaultAnalysisFolderName(result.filePath)
      persistActiveSetFields()
      lipidHeadgroupAtoms = []
      headgroupDetectAttempted = false
      if (isBilayerType(structuralType)) {
        await refreshHeadgroupAtoms()
      }
    }
  }

  async function addTrajectoryFile() {
    const result = await window.api.openFilesDialog(
      'Add Trajectory Files',
      [{ name: 'Trajectory', extensions: ['dcd', 'xtc', 'trr', 'nc', 'mdcrd'] }],
      workingDir || undefined
    )
    if (result.canceled) return
    const existing = new Set(trajectoryFiles.map((f) => f.path))
    trajectoryFiles = [
      ...trajectoryFiles,
      ...result.filePaths.filter((p) => !existing.has(p)).map((p) => ({ path: p, timeNs: '', stride: '1' }))
    ]
    trajectoryFiles = sortByName(trajectoryFiles)
    if (isBilayerType(structuralType) && topologyPath) {
      await refreshHeadgroupAtoms()
    }
  }

  function removeTrajectory(index) {
    trajectoryFiles = trajectoryFiles.filter((_, i) => i !== index)
  }

  function assignProtocolTimesToTrajectories() {
    const { files, matched, unmatched } = assignProtocolStageTimes(trajectoryFiles)
    trajectoryFiles = files
    persistActiveSetFields()
    if (matched > 0) {
      logEvent(
        'info',
        'analysis',
        `Assigned ${defaultProtocolName} stage times to ${matched} trajectory file(s).`
      )
    }
    if (unmatched.length > 0) {
      logEvent(
        'warn',
        'analysis',
        `No protocol stage match: ${unmatched.slice(0, 5).join(', ')}${unmatched.length > 5 ? ` (+${unmatched.length - 5} more)` : ''}`
      )
    } else if (matched === 0) {
      logEvent(
        'warn',
        'analysis',
        'No trajectory files matched GateWizard stage names (e.g. step1_equilibration.dcd).'
      )
    }
  }

  function assignProtocolTimesToLogs() {
    const { files, matched, unmatched } = assignProtocolStageTimes(logFiles)
    logFiles = files
    persistActiveSetFields()
    if (matched > 0) {
      logEvent(
        'info',
        'analysis',
        `Assigned ${defaultProtocolName} stage times to ${matched} log file(s).`
      )
    }
    if (unmatched.length > 0) {
      logEvent(
        'warn',
        'analysis',
        `No protocol stage match: ${unmatched.slice(0, 5).join(', ')}${unmatched.length > 5 ? ` (+${unmatched.length - 5} more)` : ''}`
      )
    } else if (matched === 0) {
      logEvent(
        'warn',
        'analysis',
        'No log files matched GateWizard stage names (e.g. step1_equilibration.log).'
      )
    }
  }

  async function onStructuralTypeChange(nextType) {
    if (nextType === structuralType) return
    const activeSet = analysisSets.find((s) => s.id === activeSetId)
    const prevType = activeSet?.structuralOptions?.structuralType ?? structuralType

    if (isBilayerType(prevType) && !isBilayerType(nextType)) {
      headgroupDetectGeneration += 1
    }

    structuralType = nextType
    analysisSets = analysisSets.map((s) =>
      s.id === activeSetId
        ? {
            ...s,
            structuralOptions: {
              ...s.structuralOptions,
              structuralType: nextType,
              ...(isBilayerType(prevType) && !isBilayerType(nextType)
                ? defaultSelectionForStructuralType(nextType)
                : nextType === 'rmsf' &&
                    (!s.structuralOptions?.selection ||
                      s.structuralOptions.selection === 'protein and backbone')
                  ? { selection: 'protein and name CA' }
                  : {})
            }
          }
        : { ...s, structuralOptions: { ...s.structuralOptions, structuralType: nextType } }
    )
    rebuildStructResultsFromSets()

    if (isBilayerType(nextType)) {
      lipidHeadgroupAtoms = []
      headgroupDetectAttempted = false
      if (topologyPath) {
        await refreshHeadgroupAtoms()
      }
    } else if (isBilayerType(prevType)) {
      const defs = defaultSelectionForStructuralType(nextType)
      selection = defs.selection
      selection2 = defs.selection2
      lipidHeadgroupAtoms = []
      headgroupDetectAttempted = false
      leafletLipidSel = ''
      leafletFilterSel = ''
    } else if (nextType === 'rmsf' && (!selection || selection === 'protein and backbone')) {
      selection = 'protein and name CA'
    }

    persistActiveSetFields()
    await hydratePlotDataFromOutputFolder()
    bumpPlotData()
  }

  /** File picker filters for energetic logs — Amber uses mdout, others use .log. */
  function energeticLogFilters() {
    if (energeticEngine === 'amber') {
      return [
        { name: 'Amber mdout', extensions: ['mdout', 'out'] },
        { name: 'Log / text', extensions: ['log', 'txt', 'csv'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }
    if (energeticEngine === 'gromacs') {
      return [
        { name: 'GROMACS log', extensions: ['log'] },
        { name: 'Log / text', extensions: ['log', 'txt', 'csv'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }
    if (energeticEngine === 'openmm') {
      return [
        { name: 'OpenMM log', extensions: ['log'] },
        { name: 'Log / text', extensions: ['log', 'txt', 'csv'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }
    return [
      { name: 'NAMD log', extensions: ['log'] },
      { name: 'Log / text', extensions: ['log', 'txt', 'csv'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  }

  async function addLogFile() {
    const engineLabels = { namd: 'NAMD', openmm: 'OpenMM', gromacs: 'GROMACS', amber: 'Amber' }
    const engineLabel = engineLabels[energeticEngine] || 'Engine'
    const dialogTitle =
      energeticEngine === 'amber'
        ? `Add ${engineLabel} mdout Files`
        : `Add ${engineLabel} Log Files`
    const result = await window.api.openFilesDialog(
      dialogTitle,
      energeticLogFilters(),
      workingDir || undefined
    )
    if (result.canceled) return
    const existing = new Set(logFiles.map((f) => f.path))
    const added = result.filePaths
      .filter((p) => !existing.has(p))
      .map((p) => ({ path: p, timeNs: '', stride: '1' }))
    if (added.length === 0) return
    logFiles = sortByName([...logFiles, ...added])
    // Auto-detect columns for this set (fast header peek — does not run analysis).
    await detectEnergeticColumns({ quiet: true })
  }

  function removeLog(index) {
    logFiles = logFiles.filter((_, i) => i !== index)
  }

  // ---- Drag-to-reorder state ----
  let dragIdx = $state(-1)
  let dragOverIdx = $state(-1)

  function onDragStart(index) {
    dragIdx = index
  }

  function onDragOver(e, index) {
    e.preventDefault()
    dragOverIdx = index
  }

  function onDragEnd() {
    dragIdx = -1
    dragOverIdx = -1
  }

  /** @param {string} message */
  function showAnalysisActionNotice(message) {
    analysisActionNotice = message
    lastError = ''
  }

  function onDropTrajectory(e, index) {
    e.preventDefault()
    if (dragIdx === -1 || dragIdx === index) {
      onDragEnd()
      return
    }
    const arr = [...trajectoryFiles]
    const [moved] = arr.splice(dragIdx, 1)
    arr.splice(index, 0, moved)
    trajectoryFiles = arr
    onDragEnd()
    // Clear all structural results — order changed, must re-run
    structResults = {
      rmsd: null,
      rmsf: null,
      distance: null,
      radius_of_gyration: null,
      area_per_lipid: null,
      membrane_thickness: null
    }
  }

  function onDropLog(e, index) {
    e.preventDefault()
    if (dragIdx === -1 || dragIdx === index) {
      onDragEnd()
      return
    }
    const arr = [...logFiles]
    const [moved] = arr.splice(dragIdx, 1)
    arr.splice(index, 0, moved)
    logFiles = arr
    onDragEnd()
    // Re-run energetic analysis automatically if data already exists
    if (rawSeries.length > 0) runAnalysis('current')
  }

  // ---- Topology analysis ----
  async function doAnalyzeTopology() {
    if (!topologyPath) {
      alert('Select a topology file first.')
      return
    }
    topoLoading = true
    try {
      topoInfo = await analyzeTopology({ topologyPath })
      if (isBilayerType(structuralType)) {
        applyHeadgroupDetection(topoInfo)
      }
      showTopoInfo = true
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      topoLoading = false
    }
  }

  function onClear() {
    mode = 'structural'
    running = false
    outputFolderName = ''
    topologyPath = ''
    trajectoryFiles = []
    structuralType = 'rmsd'
    selection = 'protein and backbone'
    selection2 = 'protein and resid 50'
    referenceFrame = '0'
    align = true
    rmsfXaxisType = 'residue_number'
    leafletLipidSel = ''
    leafletFilterSel = ''
    nBins = '1'
    interpolate = false
    lipidHeadgroupAtoms = []
    headgroupDetecting = false
    headgroupDetectAttempted = false
    manualHeadgroupName = ''
    bilayerAdvancedOpen = false
    analysisSets = [createAnalysisSet(0, 'set-1')]
    activeSetId = 'set-1'
    compareLayout = 'overlay'
    energeticCompareLayout = 'by_property'
    statsRangeStartInput = ''
    statsRangeEndInput = ''
    logFiles = []
    energeticEngine = 'namd'
    availableProperties = []
    selectedProperties = []
    timeUnits = 'ns'
    energyUnits = 'kcal/mol'
    pressureUnits = 'atm'
    temperatureUnits = 'K'
    volumeUnits = 'Å³'
    chartSeries = []
    chartXLabel = 'X'
    chartYLabel = 'Y'
    chartTitle = ''
    lastError = ''
    primaryStats = null
    rawX = []
    rawY = []
    rawSeries = []
    rawXTimeUnit = 'ns'
    plotSettingsOpen = false
    sPlots = {
      rmsd: { ...structDefaults },
      rmsf: { ...structDefaults },
      distance: { ...structDefaults },
      radius_of_gyration: { ...structDefaults },
      area_per_lipid: { ...structDefaults, yUnit: 'Å²' },
      membrane_thickness: { ...structDefaults }
    }
    ePlotGlobal = { ...energGlobalDefaults, ...energPanelShell }
    ePlotPanels = {}
    energeticLayout = 'grid'
    chartInteractionMode = 'pan'
    focusedPanelKey = ''
    statsRange = null
    panelRangeStats = {}
    structResults = {
      rmsd: null,
      rmsf: null,
      distance: null,
      radius_of_gyration: null,
      area_per_lipid: null,
      membrane_thickness: null
    }
    showSelectionHelp = false
    showTopoInfo = false
    topoInfo = null
    topoLoading = false
    analysisStatus.running = false
    analysisStatus.mode = ''
    analysisStatus.analysisType = ''
    analysisStatus.resultAvailable = false
    analysisStatus.error = ''
    resetAnalysisProgress()
    if (workingDir) {
      void refreshSavedSessions()
    }
  }

  // ---- Energetic properties ----
  /**
   * @param {{ quiet?: boolean, selectAll?: boolean }} [opts]
   */
  async function detectEnergeticColumns(opts = {}) {
    const quiet = opts.quiet === true
    const selectAll = opts.selectAll !== false
    if (logFiles.length === 0) {
      if (!quiet) alert('Add at least one log file first.')
      return
    }
    if (detectingProperties) return
    try {
      detectingProperties = true
      lastError = ''
      const { properties } = await getEnergeticProperties({
        logPaths: logFiles.map((f) => f.path),
        fileTimes: makeFileTimes(logFiles),
        engine: energeticEngine
      })
      availableProperties = properties || []
      if (selectAll || selectedProperties.length === 0) {
        selectedProperties = [...availableProperties]
      } else {
        // Keep prior selection that still exists; add newly found props only if none selected
        selectedProperties = selectedProperties.filter((p) => availableProperties.includes(p))
        if (selectedProperties.length === 0) selectedProperties = [...availableProperties]
      }
      for (const p of selectedProperties) ensureEPlotPanel(p)
      persistActiveSetFields()
      if (!quiet) {
        showAnalysisActionNotice(
          `Detected ${availableProperties.length} properties for the active set.`
        )
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      if (!quiet) {
        logEvent('error', 'analysis', 'Property detection failed', lastError)
      }
    } finally {
      detectingProperties = false
    }
  }

  /** Detect properties for every set that has log files (no analysis run). */
  async function detectEnergeticColumnsAllSets() {
    if (detectingProperties || running) return
    persistActiveSetFields()
    const savedId = activeSetId
    detectingProperties = true
    lastError = ''
    /** @type {string[]} */
    const errors = []
    let ok = 0
    try {
      for (const set of analysisSets) {
        const logs = set.energeticOptions?.logFiles || []
        if (logs.length === 0) continue
        activeSetId = set.id
        loadActiveSetFields()
        try {
          const { properties } = await getEnergeticProperties({
            logPaths: logFiles.map((f) => f.path),
            fileTimes: makeFileTimes(logFiles),
            engine: energeticEngine
          })
          availableProperties = properties || []
          selectedProperties = [...availableProperties]
          for (const p of selectedProperties) ensureEPlotPanel(p)
          persistActiveSetFields()
          ok += 1
        } catch (error) {
          errors.push(
            `${set.label}: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
      if (errors.length) {
        lastError = errors.join(' ')
      }
      showAnalysisActionNotice(
        `Detected properties on ${ok} set(s)${errors.length ? ` (${errors.length} failed)` : ''}.`
      )
    } finally {
      activeSetId = savedId
      loadActiveSetFields()
      detectingProperties = false
    }
  }

  function toggleProperty(prop, checked) {
    const nextProps = checked
      ? selectedProperties.includes(prop)
        ? [...selectedProperties]
        : [...selectedProperties, prop]
      : selectedProperties.filter((p) => p !== prop)
    selectedProperties = nextProps
    if (checked) ensureEPlotPanel(prop)
    // Keep stored set metadata aligned so save/compare stay consistent with checkboxes.
    analysisSets = analysisSets.map((s) => {
      if (isCompareOverlay) {
        // While comparing, property visibility is shared across sets.
        if (!s.energeticResult && s.id !== activeSetId) return s
        return {
          ...s,
          energeticOptions: { ...s.energeticOptions, selectedProperties: [...nextProps] },
          energeticResult: s.energeticResult
            ? { ...s.energeticResult, selectedProperties: [...nextProps] }
            : s.energeticResult
        }
      }
      if (s.id !== activeSetId) return s
      return {
        ...s,
        energeticOptions: { ...s.energeticOptions, selectedProperties: [...nextProps] },
        energeticResult: s.energeticResult
          ? { ...s.energeticResult, selectedProperties: [...nextProps] }
          : s.energeticResult
      }
    })
    if (checked && !focusedPanelKey) focusedPanelKey = prop
    bumpPlotData()
  }

  // ---- Run analysis ----
  /** @param {'current' | 'all'} [scope] */
  async function runAnalysis(scope = runAnalysisScope) {
    if (scope === 'all' && analysisSets.length > 1) {
      await runAnalysisAllSets()
      return
    }
    await runAnalysisCurrentSet()
  }

  async function runAnalysisCurrentSet() {
    resetAnalysisProgress()
    try {
      running = true
      lastError = ''
      syncOutputFolderName()
      if (mode === 'structural') {
        persistActiveSetFields()
        structResults[structuralType] = null
        statsRange = null
        panelRangeStats = {}
        await runStructuralForActiveSet()
        rebuildStructResultsFromSets()
      } else {
        persistActiveSetFields()
        statsRange = null
        panelRangeStats = {}
        await runEnergeticForActiveSet()
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    } finally {
      // Unblock UI before save — session write must not keep "Running..." stuck.
      running = false
      resetAnalysisProgress()
    }
    try {
      await saveAnalysisCsvToOutputFolder()
      // Save both structural + energetic results present on sets (mixed sessions).
      await saveAnalysisSessionToOutputFolder()
      await hydratePlotDataFromOutputFolder()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      lastError = lastError || msg
      logEvent('error', 'analysis', 'Post-run save failed', msg)
    }
  }

  async function runAnalysisAllSets() {
    persistActiveSetFields()
    const runStructuralType = structuralType
    running = true
    lastError = ''
    statsRange = null
    panelRangeStats = {}
    syncOutputFolderName()
    const savedId = activeSetId
    /** @type {string[]} */
    const errors = []
    let completed = 0
    const total = analysisSets.length
    runProgressStages = analysisSets.map((set) => ({
      id: set.id,
      label: set.label,
      status: /** @type {'pending'} */ ('pending')
    }))
    try {
      for (let i = 0; i < analysisSets.length; i++) {
        const set = analysisSets[i]
        activeSetId = set.id
        loadActiveSetFields()
        structuralType = runStructuralType
        persistActiveSetFields()
        runProgressStages = runProgressStages.map((stage, idx) =>
          idx === i ? { ...stage, status: 'running' } : stage
        )
        const typeLabel = mode === 'structural' ? runStructuralType : 'energetic'
        setAnalysisProgress(i + 1, total, `${set.label} (${typeLabel})`)
        try {
          if (mode === 'structural') {
            await runStructuralForActiveSet()
            rebuildStructResultsFromSets()
            const updatedSet = analysisSets.find((s) => s.id === set.id)
            if (updatedSet) {
              await saveAnalysisCsvToOutputFolder(updatedSet, {
                mode: 'structural',
                structuralType: runStructuralType
              })
            }
          } else {
            await runEnergeticForActiveSet()
            const updatedSet = analysisSets.find((s) => s.id === set.id)
            if (updatedSet) {
              await saveAnalysisCsvToOutputFolder(updatedSet, { mode: 'energetic' })
            }
          }
          // Refresh only the open tab's view (keeps structural/energetic from flickering).
          await hydratePlotDataFromOutputFolder()
          completed += 1
          runProgressStages = runProgressStages.map((stage, idx) =>
            idx === i ? { ...stage, status: 'done' } : stage
          )
          await saveAnalysisSessionToOutputFolder()
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          errors.push(`${set.label}: ${msg}`)
          runProgressStages = runProgressStages.map((stage, idx) =>
            idx === i ? { ...stage, status: 'error' } : stage
          )
        }
      }
      if (errors.length > 0) {
        lastError =
          errors.length === analysisSets.length
            ? errors[0]
            : `Completed ${completed}/${analysisSets.length} sets. ${errors.join(' ')}`
        if (completed > 0) {
          logEvent(
            'warn',
            'analysis',
            `Ran analysis on ${completed}/${analysisSets.length} sets; ${errors.length} failed.`
          )
        }
      } else {
        logEvent('info', 'analysis', `Ran analysis on all ${analysisSets.length} sets.`)
      }
    } finally {
      activeSetId = savedId
      loadActiveSetFields()
      await hydratePlotDataFromOutputFolder()
      running = false
      analysisStatus.progress.phase = errors.length > 0 && completed > 0 ? 'error' : 'done'
      if (completed === total && errors.length === 0) {
        resetAnalysisProgress()
      } else {
        analysisStatus.progress.active = false
      }
    }
  }

  function runAnalysisButtonLabel() {
    if (running) return null
    if (analysisSets.length > 1 && runAnalysisScope === 'all') {
      return `Run Analysis (all ${analysisSets.length} sets)`
    }
    return 'Run Analysis'
  }

  // ---- Export ----
  function exportBaseName() {
    return (displayTitle || chartTitle || 'analysis').replace(/[^a-z0-9_\-]/gi, '_').toLowerCase()
  }

  function buildCsvContent(series) {
    if (series.length === 0) return null
    const header = ['x', ...series.map((s) => s.name)].join(',')
    const rows = series[0].x.map((xv, i) =>
      [xv, ...series.map((s) => s.y[i] ?? '')].join(',')
    )
    return [header, ...rows].join('\n')
  }

  async function resolveExportPath(fileName, prompt, filters) {
    syncOutputFolderName()
    if (outputDir) {
      await ensureOutputFolder(workingDir, resolveOutputFolderName())
      return `${outputDir}/${fileName}`.replace(/\\/g, '/')
    }
    const result = await window.api.saveFileDialog(prompt, filters, fileName)
    if (result.canceled) return null
    return result.filePath
  }

  /**
   * @param {import('../lib/analysisSets.js').AnalysisSet | null} [setOverride]
   * @param {{ mode?: 'structural' | 'energetic', structuralType?: string }} [opts]
   */
  async function saveAnalysisCsvToOutputFolder(setOverride = null, opts = {}) {
    if (!canRunAnalysis) return
    syncOutputFolderName()
    const folderName = resolveOutputFolderName()
    const set =
      setOverride ?? analysisSets.find((s) => s.id === activeSetId) ?? null
    if (!set) return
    const series = buildSeriesForSetCsv(set, opts)
    const csv = buildCsvContent(series)
    if (!csv) return
    try {
      const { output_dir } = await ensureOutputFolder(workingDir, folderName)
      const filePath = `${output_dir}/${csvFileNameForSet(set, opts)}`.replace(/\\/g, '/')
      await window.api.writeText(filePath, csv)
      logEvent('info', 'analysis', 'Saved analysis results', filePath)
    } catch {
      // Non-fatal if auto-save fails
    }
  }

  function syncActiveEnergeticResultToSet() {
    if (mode !== 'energetic') return
    const set = analysisSets.find((s) => s.id === activeSetId)
    if (!set?.energeticResult && rawSeries.length > 0) {
      storeEnergeticResult({
        rawX,
        rawXTimeUnit,
        rawSeries: rawSeries.map((s) => ({ ...s })),
        chartTitle,
        chartXLabel,
        selectedProperties: [...selectedProperties],
        energeticEngine,
        statistics: primaryStats ? { [selectedProperties[0] || '']: primaryStats } : undefined
      })
    }
  }

  function syncResultsToSetsBeforeSave() {
    persistActiveSetFields()
    if (mode === 'energetic') {
      syncActiveEnergeticResultToSet()
    }
  }

  async function saveAnalysisSessionToOutputFolder() {
    if (!canRunAnalysis) {
      lastError = 'Set a working directory in the top bar before saving.'
      return false
    }
    syncResultsToSetsBeforeSave()
    syncOutputFolderName()
    const folderName = resolveOutputFolderName()
    if (!folderName) {
      lastError = 'Set an output folder name before saving.'
      return false
    }
    if (!setsHaveAnyPlottableResults(analysisSets)) {
      lastError = 'No analysis results to save. Run analysis first.'
      return false
    }
    try {
      // Write CSVs for both result types without flipping the open tab (mode).
      for (const set of analysisSets) {
        if (set.energeticResult) {
          await saveAnalysisCsvToOutputFolder(set, { mode: 'energetic' })
        }
        if (structuralSetHasPlottableResult(set)) {
          const types = getSetStructuralResultTypes(normalizeAnalysisSetStructuralResults(set))
          for (const type of types) {
            const res = getSetStructuralResult(set, type)
            if (!res || !structuralResultHasPlotData(res)) continue
            await saveAnalysisCsvToOutputFolder(set, {
              mode: 'structural',
              structuralType: type
            })
          }
        }
      }
      const { output_dir } = await ensureOutputFolder(workingDir, folderName)
      const session = serializeAnalysisSession({
        mode,
        compareLayout,
        energeticCompareLayout,
        outputFolderName: folderName,
        activeSetId,
        sets: slimSetsForSessionSave(analysisSets, 'all')
      })
      const filePath = `${output_dir}/${ANALYSIS_SESSION_FILENAME}`.replace(/\\/g, '/')
      await window.api.writeJson(filePath, session)
      logEvent('info', 'analysis', 'Saved analysis session', filePath)
      selectedSessionPath = filePath
      lastError = ''
      await refreshSavedSessions()
      showAnalysisActionNotice(`Saved session to ${filePath}`)
      return true
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      logEvent('error', 'analysis', 'Failed to save analysis session', lastError)
      return false
    }
  }

  async function exportCsv() {
    if (displaySeries.length === 0) return
    const csv = buildCsvContent(displaySeries)
    if (!csv) return
    const filePath = await resolveExportPath(
      `${exportBaseName()}.csv`,
      'Export CSV — file will be saved as .csv',
      [{ name: 'CSV', extensions: ['csv'] }]
    )
    if (!filePath) return
    await window.api.writeText(filePath, csv)
    showAnalysisActionNotice(`Exported CSV to ${filePath}`)
    logEvent('info', 'analysis', 'Exported CSV', filePath)
  }

  async function exportSvg() {
    if (!svgEl) return
    const filePath = await resolveExportPath(
      `${exportBaseName()}.svg`,
      'Export SVG — file will be saved as .svg',
      [{ name: 'SVG', extensions: ['svg'] }]
    )
    if (!filePath) return
    const svgStr = '<?xml version="1.0" encoding="UTF-8"?>\n' + svgEl.outerHTML
    await window.api.writeText(filePath, svgStr)
    showAnalysisActionNotice(`Exported SVG to ${filePath}`)
    logEvent('info', 'analysis', 'Exported SVG', filePath)
  }

  async function exportPublicationPng() {
    if (mode !== 'energetic' || rawSeries.length === 0) return
    try {
      const filePath = await resolveExportPath(
        `${exportBaseName()}_publication.png`,
        'Export publication PNG (matplotlib / API style)',
        [{ name: 'PNG Image', extensions: ['png'] }]
      )
      if (!filePath) return
      const blob = await renderAnalysisPlot(buildEnergeticPlotPayload())
      const buf = await blob.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      await window.api.writeBinary(filePath, btoa(binary))
      showAnalysisActionNotice(`Exported publication PNG to ${filePath}`)
      logEvent('info', 'analysis', 'Exported publication PNG', filePath)
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  async function exportPng() {
    if (!svgEl) return
    try {
      const filePath = await resolveExportPath(
        `${exportBaseName()}.png`,
        'Export PNG — file will be saved as .png',
        [{ name: 'PNG Image', extensions: ['png'] }]
      )
      if (!filePath) return

      // Get intrinsic dimensions from viewBox (SVG may have no width/height attrs)
      const vb = svgEl.viewBox?.baseVal
      const svgW = vb && vb.width > 0 ? vb.width : 900
      const svgH = vb && vb.height > 0 ? vb.height : 360

      // Scale factor from DPI setting (SVG is designed at 96 dpi baseline)
      const dpi = Math.max(72, Math.min(600, Number(ps.dpi) || 150))
      const pixelScale = dpi / 96

      // Serialise SVG with explicit dimensions so the browser renders it correctly
      const clone = svgEl.cloneNode(true)
      clone.setAttribute('width', svgW)
      clone.setAttribute('height', svgH)
      // Remove any clipPath id collisions by making them unique
      const uniqueId = `plot-area-${Date.now()}`
      clone.querySelectorAll('[id="plot-area"]').forEach((el) => el.setAttribute('id', uniqueId))
      clone
        .querySelectorAll('[clip-path="url(#plot-area)"]')
        .forEach((el) => el.setAttribute('clip-path', `url(#${uniqueId})`))
      const svgData = new XMLSerializer().serializeToString(clone)
      // Use data URI instead of blob URL — more reliable in Electron's sandboxed renderer
      const svgB64 = btoa(unescape(encodeURIComponent(svgData)))
      const url = `data:image/svg+xml;base64,${svgB64}`

      const img = new Image()
      img.width = svgW
      img.height = svgH
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = (e) => reject(new Error('SVG image failed to load: ' + String(e)))
        img.src = url
      })

      const canvas = document.createElement('canvas')
      canvas.width = Math.round(svgW * pixelScale)
      canvas.height = Math.round(svgH * pixelScale)
      const ctx = canvas.getContext('2d')
      if (!ps.transparentBg) {
        ctx.fillStyle = ps.plotBg
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

      const dataUrl = canvas.toDataURL('image/png')
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
      await window.api.writeBinary(filePath, base64)
      showAnalysisActionNotice(`Exported PNG to ${filePath}`)
      logEvent('info', 'analysis', 'Exported PNG', filePath)
    } catch (err) {
      lastError = 'PNG export failed: ' + (err instanceof Error ? err.message : String(err))
    }
  }
</script>

<!-- Selection help modal -->
{#if showSelectionHelp}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    onmousedown={() => (showSelectionHelp = false)}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="mx-4 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border border-neutral-300 bg-white p-5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
      onmousedown={(e) => e.stopPropagation()}
    >
      <h2 class="mb-3 text-sm font-semibold">MDAnalysis Atom Selection Syntax</h2>
      <pre class="leading-relaxed whitespace-pre-wrap text-neutral-300">{`BASIC SELECTIONS
protein          — all protein atoms
backbone         — backbone atoms (CA, C, N, O)
name CA          — alpha carbon atoms
all              — all atoms
water            — water molecules
resname ALA      — all alanine residues

COMBINING SELECTIONS
protein and backbone        — protein backbone only
protein and not name H*     — protein without hydrogens
name CA or name CB          — alpha and beta carbons
resid 1:50                  — residues 1-50
protein and resid 10:100    — protein residues 10-100

RESIDUE SELECTIONS
resname ALA GLY VAL         — specific amino acids
resid 1 5 10                — specific residue numbers
resid 1:50 and name CA      — CA atoms in residues 1-50

SEGMENT / CHAIN
segid A            — segment A
segid A B          — segments A and B

ATOM PROPERTIES
type CA            — atoms of type CA
mass > 12          — atoms with mass > 12
charge < 0         — negatively charged atoms

EXAMPLES
"protein and backbone"         → RMSD of protein structure
"name CA"                      → fast RMSD with C-alpha only
"protein and resid 50:150"     → specific protein region
"protein and not resname GLY PRO"   → exclude flexible residues

Docs: https://docs.mdanalysis.org/stable/documentation_pages/selections.html`}</pre>
      <Button className="mt-4 w-full" onclick={() => (showSelectionHelp = false)}>Close</Button>
    </div>
  </div>
{/if}

{#if showTopoInfo && topoInfo}
  <TopologyInfoModal topoInfo={topoInfo} onClose={() => (showTopoInfo = false)} />
{/if}

<div class="flex min-w-0 flex-1 divide-x divide-neutral-200 overflow-hidden dark:divide-neutral-800">
  <!-- ===== SIDEBAR ===== -->
  <aside class="w-80 shrink-0 space-y-4 overflow-x-clip overflow-y-auto p-4 text-xs select-none">
    <div class="space-y-2">
      <h2 class="sidebar-heading">Analysis</h2>
      <div class="flex items-center gap-1" role="tablist" aria-label="Analysis mode">
        {#each ANALYSIS_MODES as item (item.id)}
          {@const Icon = item.Icon}
          {@const active = mode === item.id}
          <button
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={item.label}
            title={item.label}
            onclick={() => onModeChange(item.id)}
            class="group relative flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border transition-colors
              {active
              ? 'border-neutral-400 bg-neutral-200 text-black dark:border-neutral-600 dark:bg-neutral-800 dark:text-white'
              : 'border-neutral-200 bg-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:border-neutral-800 dark:hover:bg-neutral-900 dark:hover:text-neutral-200'}"
          >
            <Icon className="size-4 shrink-0" />
            <span class="truncate text-[11px] font-medium">{item.label}</span>
          </button>
        {/each}
      </div>
    </div>

    <Divider />

    <!-- Saved analysis (structural + energetic) -->
    <div class="space-y-2">
      <div class="flex items-center justify-between gap-2">
        <h2 class="sidebar-heading">Saved analysis</h2>
        {#if sessionScanHint}
          <span
            class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none
              {savedSessions.length > 0
              ? 'bg-amber-500/15 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
              : sessionScanHint === 'Scan failed'
                ? 'bg-red-500/15 text-red-700 dark:bg-red-500/20 dark:text-red-300'
                : 'bg-neutral-500/10 text-neutral-500 dark:text-neutral-400'}"
            title={savedSessions.length > 0
              ? `${savedSessions.length} saved session${savedSessions.length === 1 ? '' : 's'} in working directory`
              : sessionScanHint === 'Scan failed'
                ? 'Could not scan for saved sessions'
                : 'No saved sessions in working directory'}
          >
            {sessionScanHint}
          </span>
        {/if}
      </div>
      {#if savedSessions.length > 0}
        <Select size="sm" className="w-full" bind:value={selectedSessionPath}>
          <option value="">Select a saved session…</option>
          {#each savedSessions as session (session.session_path)}
            <option value={session.session_path}>
              {session.name} · {session.mode} · {session.set_count} set(s) · {session.analysis_summary}
            </option>
          {/each}
        </Select>
      {/if}
      <div class="flex gap-1">
        <Button
          size="sm"
          variant="outline"
          className="min-w-0 flex-1"
          onclick={() => void saveAnalysisSessionToOutputFolder()}
          disabled={!canSaveSession || running}
          title="Write analysis_session.json to the output folder"
        >
          Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="min-w-0 flex-1"
          onclick={loadSelectedSavedSession}
          disabled={!selectedSessionPath || running}
        >
          Load
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="min-w-0 flex-1"
          onclick={browseAnalysisSessionFile}
          disabled={running}
        >
          Browse…
        </Button>
      </div>
    </div>

    <Divider />

    <!-- Simulation sets (structural + energetic compare) -->
    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <h2 class="sidebar-heading">Simulation sets</h2>
        <div class="flex gap-1">
          <Button size="sm" variant="outline" onclick={addAnalysisSet} title="Add set">+</Button>
          <Button size="sm" variant="outline" onclick={duplicateActiveSet} title="Duplicate active set">⧉</Button>
        </div>
      </div>
      <div class="space-y-1">
        {#each analysisSets as set (set.id)}
          {@const isActive = activeSetId === set.id}
          <div
            class={`flex items-center gap-1.5 rounded-md border px-1.5 py-1 transition-colors ${
              isActive
                ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-500/30 dark:border-amber-500/80 dark:bg-amber-500/15 dark:ring-amber-500/40'
                : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:border-neutral-600 dark:hover:bg-neutral-800/50'
            }`}
          >
            {#if isActive}
              <span
                class="h-2 w-2 shrink-0 rounded-full"
                style={`background:${set.color}`}
                aria-hidden="true"
              ></span>
              <Input
                size="sm"
                blurOnEnter
                value={set.label}
                oninput={(e) => updateSetLabel(set.id, e.currentTarget.value)}
                className="min-w-0 flex-1 border-amber-300/60 bg-white dark:border-amber-500/40 dark:bg-neutral-950"
                onclick={(e) => e.stopPropagation()}
              />
            {:else}
              <button
                type="button"
                class="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-neutral-800 transition-colors hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
                onclick={() => selectAnalysisSet(set.id)}
                title={mode === 'structural' ? set.topologyPath || 'No topology' : `${set.energeticOptions.logFiles.length} log file(s)`}
              >
                <span
                  class="mr-1 inline-block h-2 w-2 shrink-0 rounded-full align-middle"
                  style={`background:${set.color}`}
                  aria-hidden="true"
                ></span>
                {set.label}
                {#if setHasResult(set, mode, structuralType)}
                  <span class="text-emerald-600 dark:text-emerald-400"> ✓</span>
                {/if}
              </button>
            {/if}
            <Checkbox
              name={`set-vis-${set.id}`}
              checked={set.visible}
              onchange={(e) => {
                const checked = /** @type {HTMLInputElement} */ (e.currentTarget).checked
                toggleSetVisible(set.id, checked)
              }}
              title="Show in chart overlay"
            />
            {#if analysisSets.length > 1}
              <button
                type="button"
                class="shrink-0 rounded px-1 text-red-600 transition-colors hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                onclick={() => removeAnalysisSet(set.id)}
                title="Remove set">✕</button
              >
            {/if}
          </div>
        {/each}
      </div>
      {#if showCompareLayoutControl}
        {#if mode === 'structural'}
          <Select
            size="sm"
            className="w-full"
            value={compareLayout}
            onchange={(e) =>
              setCompareLayout(
                /** @type {'overlay' | 'grid'} */ (
                  /** @type {HTMLSelectElement} */ (e.currentTarget).value
                )
              )
            }
          >
            <option value="overlay">Compare: overlay</option>
            <option value="grid">Compare: separate panels (per set)</option>
          </Select>
        {:else}
          <Select
            size="sm"
            className="w-full"
            value={energeticCompareLayout}
            onchange={(e) => setEnergeticCompareLayout(e.currentTarget.value)}
          >
            <option value="by_property">Compare: one panel per property</option>
            <option value="by_set">Compare: one panel per set</option>
            <option value="overlay">Compare: all on one plot</option>
          </Select>
          <p class="sidebar-hint">
            Per property: each property has its own plot with all sets (distinct set colors). Per set:
            each set is a panel with its properties.
          </p>
        {/if}
      {/if}
      {#if mode === 'energetic' && isCompareOverlay && visibleCompareSets.length > 0 && selectedProperties.length > 0 && compareEnergeticProperties.length === 0}
        <p class="sidebar-hint text-amber-600 dark:text-amber-400">
          Checked properties are missing from one or more visible sets — uncheck them or re-run analysis with matching properties.
        </p>
      {/if}
      <p class="sidebar-hint">
        Each set keeps its own files, analysis options, and results. Use the checkbox to show or hide sets in the chart overlay.
      </p>
    </div>

    <Divider />

    {#if mode === 'structural'}
      <!-- Structural Input -->
      <div class="space-y-2">
        <h2 class="sidebar-heading">Structural Input <span class="font-normal text-neutral-500">(active set)</span></h2>
        <div class="space-y-1">
          <p class="sidebar-label">Topology file</p>
          <div class="flex gap-1">
            <Input size="sm" value={basename(topologyPath) || '—'} disabled className="min-w-0 flex-1" />
            <Button size="sm" variant="outline" onclick={pickTopologyFile}>Browse</Button>
            <Button
              size="sm"
              variant="outline"
              onclick={doAnalyzeTopology}
              disabled={!topologyPath || topoLoading}
              title="Topology info"
              className="px-2"
            >
              {#if topoLoading}
                <Spinner className="h-3.5 w-3.5" />
              {:else}
                <Protein className="size-3.5" title="Topology info" />
              {/if}
            </Button>
          </div>
        </div>

        <div class="space-y-1">
          <div class="flex items-center justify-between">
            <p class="sidebar-label">Trajectory files</p>
            <div class="flex items-center gap-1">
              {#if trajectoryFiles.length > 0}
                <Button
                  size="sm"
                  variant="outline"
                  onclick={assignProtocolTimesToTrajectories}
                  title="Fill Time (ns) from the GateWizard default protocol (step0_minimization … step7_production)"
                >
                  Protocol times
                </Button>
              {/if}
              <Button size="sm" variant="outline" onclick={addTrajectoryFile}>+ Add</Button>
            </div>
          </div>
          {#if trajectoryFiles.length === 0}
            <p class="sidebar-hint">No trajectory files selected.</p>
          {:else}
            <div class="space-y-0.5">
              <div class="flex items-center gap-1 px-1.5 text-[10px] text-neutral-500">
                <span class="min-w-0 flex-1">File</span>
                <span class="w-16 shrink-0 text-center">Time</span>
                <span class="w-12 shrink-0 text-center" title="Use every Nth frame">Stride</span>
                <span class="w-4 shrink-0"></span>
              </div>
              {#each trajectoryFiles as file, i (file.path)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  ondragover={(e) => onDragOver(e, i)}
                  ondrop={(e) => onDropTrajectory(e, i)}
                  class="flex items-center gap-1 rounded border border-neutral-200 px-1.5 py-1 transition-opacity dark:border-neutral-800
                    {dragIdx === i ? 'opacity-40' : ''}
                    {dragOverIdx === i && dragIdx !== i ? 'border-amber-500 bg-amber-500/10' : ''}"
                >
                  <span
                    draggable="true"
                    ondragstart={() => onDragStart(i)}
                    ondragend={onDragEnd}
                    class="shrink-0 cursor-grab text-neutral-600 select-none active:cursor-grabbing"
                    title="Drag to reorder">⠿</span
                  >
                  <span class="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-300" title={file.path}
                    >{basename(file.path)}</span
                  >
                  <Input
                    size="sm"
                    blurOnEnter
                    type="number"
                    min="0"
                    step="0.001"
                    placeholder="0"
                    bind:value={trajectoryFiles[i].timeNs}
                    className="w-16 shrink-0"
                  />
                  <span class="sidebar-label shrink-0">ns</span>
                  <Input
                    size="sm"
                    blurOnEnter
                    type="number"
                    min="1"
                    max="999"
                    step="1"
                    placeholder="1"
                    bind:value={trajectoryFiles[i].stride}
                    className="w-12 shrink-0 text-center tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    title="Use every Nth frame (1–999)"
                  />
                  <button
                    class="shrink-0 px-1 text-red-500 hover:text-red-400"
                    onclick={() => removeTrajectory(i)}
                    title="Remove">✕</button
                  >
                </div>
              {/each}
            </div>
          {/if}
          <p class="sidebar-hint">
            Stride loads and analyzes every Nth frame only (e.g. 10 ≈ 10× fewer frames). Applies per file when trajectories are concatenated.
          </p>
        </div>
      </div>

      <Divider />

      <!-- Structural Options -->
      <div class="space-y-2">
        <h2 class="sidebar-heading">Structural Options</h2>
        <Select
          size="sm"
          className="w-full"
          value={structuralType}
          onchange={(e) => onStructuralTypeChange(e.currentTarget.value)}
        >
          <option value="rmsd">RMSD</option>
          <option value="rmsf">RMSF</option>
          <option value="distance">Distance</option>
          <option value="radius_of_gyration">Radius of Gyration</option>
          <option value="membrane_thickness">Membrane Thickness</option>
          <option value="area_per_lipid">Area per Lipid</option>
        </Select>

        {#if isBilayerType(structuralType)}
          <div class="space-y-2">
            <div class="flex items-center justify-between gap-2">
              <div class="flex min-w-0 items-center gap-1">
                <p class="sidebar-label">Headgroup atoms</p>
                <button
                  type="button"
                  class="inline-flex size-6 shrink-0 items-center justify-center rounded text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200
                    {bilayerAdvancedOpen
                    ? 'bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100'
                    : ''}"
                  onclick={() => (bilayerAdvancedOpen = !bilayerAdvancedOpen)}
                  aria-expanded={bilayerAdvancedOpen}
                  aria-label="Advanced headgroup settings"
                  title="Advanced headgroup settings"
                >
                  <span class="text-sm leading-none" aria-hidden="true">⚙</span>
                </button>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onclick={refreshHeadgroupAtoms}
                disabled={!topologyPath || headgroupDetecting}
              >
                {headgroupDetecting ? 'Detecting…' : 'Refresh'}
              </Button>
            </div>

            {#if headgroupDetecting}
              <div class="flex items-center gap-2 rounded border p-2 dark:border-neutral-800">
                <Spinner />
                <span class="sidebar-hint">Detecting…</span>
              </div>
            {:else if lipidHeadgroupAtoms.length === 0}
              <p class="sidebar-hint">
                {#if headgroupDetectAttempted}
                  None detected — open ⚙ to add atom names.
                {:else if !topologyPath}
                  Select a topology file, then click Refresh.
                {:else}
                  Click Refresh after loading topology and trajectory.
                {/if}
              </p>
            {:else}
              <div
                class="max-h-36 space-y-1 overflow-y-auto rounded border p-2 dark:border-neutral-800"
              >
                {#each lipidHeadgroupAtoms as atom (atom.name)}
                  {@const checked = atom.enabled}
                  <label class="flex items-center gap-2">
                    <Checkbox
                      name={`headgroup-${atom.name}`}
                      {checked}
                      onchange={(e) => toggleHeadgroupAtom(atom.name, e.currentTarget.checked)}
                    />
                    <span class="font-mono text-neutral-800 dark:text-neutral-300">{atom.name}</span>
                    {#if atom.atomCount > 0}
                      <span class="text-neutral-500 dark:text-neutral-600"
                        >({atom.atomCount.toLocaleString()})</span
                      >
                    {/if}
                  </label>
                {/each}
              </div>
            {/if}

            {#if bilayerAdvancedOpen}
              <div class="space-y-2 rounded border border-neutral-200 p-2 dark:border-neutral-800">
                <p class="sidebar-hint">Manual atom names, leaflet options, and thickness grid.</p>
                <div class="flex gap-1">
                  <Input
                    size="sm"
                    bind:value={manualHeadgroupName}
                    placeholder="Add atom name"
                    className="min-w-0 flex-1"
                    onkeydown={(e) => e.key === 'Enter' && addManualHeadgroupName()}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onclick={addManualHeadgroupName}
                    disabled={!manualHeadgroupName.trim()}
                  >
                    Add
                  </Button>
                </div>

                {#if lipidHeadgroupAtoms.length > 0}
                  <div class="space-y-1">
                    {#each lipidHeadgroupAtoms as atom (atom.name)}
                      <div class="flex items-center justify-between gap-2 text-xs">
                        <span class="font-mono text-neutral-500">{atom.name}</span>
                        <button
                          type="button"
                          class="text-neutral-600 hover:text-red-400"
                          onclick={() => removeHeadgroupAtom(atom.name)}>Remove</button
                        >
                      </div>
                    {/each}
                  </div>
                {/if}

                {#if selection}
                  <p class="sidebar-hint">
                    Selection: <span class="font-mono text-neutral-500">{selection}</span>
                  </p>
                {/if}

                <Input
                  size="sm"
                  bind:value={leafletLipidSel}
                  placeholder="Leaflet assignment (optional)"
                  className="w-full"
                />

                {#if structuralType === 'membrane_thickness'}
                  <Input
                    size="sm"
                    bind:value={leafletFilterSel}
                    placeholder="Leaflet filter (optional)"
                    className="w-full"
                  />
                  <div class="flex items-center gap-2">
                    <span class="sidebar-label shrink-0">Grid bins</span>
                    <Input size="sm" type="number" min="1" step="1" bind:value={nBins} className="w-20" />
                  </div>
                  <label class="flex items-center gap-2">
                    <Checkbox name="interpolate-thickness" bind:checked={interpolate} />
                    <span class="sidebar-label">Interpolate missing grid values</span>
                  </label>
                {/if}
              </div>
            {/if}
          </div>
        {:else}
          <!-- Selection 1 row with count + help -->
          <div class="flex gap-1">
            <Input
              size="sm"
              bind:value={selection}
              placeholder={structuralType === 'distance' ? 'Atom group 1' : 'MDAnalysis selection'}
              className="min-w-0 flex-1"
            />
            <button
              type="button"
              class="shrink-0 rounded border border-neutral-700 px-2 text-xs text-neutral-400 hover:text-neutral-200 disabled:opacity-50"
              onclick={() => countSelectionAtoms('selection')}
              disabled={selectionCountLoading || !selection.trim()}
              title="Count atoms in selection">#</button
            >
            <button
              type="button"
              class="shrink-0 rounded border border-neutral-700 px-2 text-neutral-400 hover:text-neutral-200"
              onclick={() => (showSelectionHelp = true)}
              title="Selection syntax help">?</button
            >
          </div>
          {#if selectionAtomCount != null}
            <p class="sidebar-hint">
              {selectionAtomCount.toLocaleString()} atom{selectionAtomCount === 1 ? '' : 's'} selected
            </p>
          {/if}
          {#if selectionCountError}
            <p class="sidebar-hint text-amber-600 dark:text-amber-400">{selectionCountError}</p>
          {/if}
        {/if}

        {#if structuralType === 'distance'}
          <div class="flex gap-1">
            <Input
              size="sm"
              bind:value={selection2}
              placeholder="Atom group 2"
              className="min-w-0 flex-1"
            />
            <button
              type="button"
              class="shrink-0 rounded border border-neutral-700 px-2 text-xs text-neutral-400 hover:text-neutral-200 disabled:opacity-50"
              onclick={() => countSelectionAtoms('selection2')}
              disabled={selectionCountLoading || !selection2.trim()}
              title="Count atoms in selection">#</button
            >
          </div>
          {#if selection2AtomCount != null}
            <p class="sidebar-hint">
              {selection2AtomCount.toLocaleString()} atom{selection2AtomCount === 1 ? '' : 's'} selected (group 2)
            </p>
          {/if}
        {/if}

        {#if structuralType === 'rmsd'}
          <div class="flex items-center gap-2">
            <span class="sidebar-label shrink-0">Ref. frame</span>
            <Input size="sm" type="number" min="0" bind:value={referenceFrame} className="w-20" />
          </div>
          <label class="flex items-center gap-2">
            <Checkbox name="align-rmsd" bind:checked={align} />
            <span class="sidebar-label">Align before RMSD</span>
          </label>
        {/if}

        {#if structuralType === 'rmsf'}
          <div class="space-y-1">
            <p class="sidebar-label">X axis type</p>
            <Select size="sm" className="w-full" bind:value={rmsfXaxisType}>
              <option value="residue_number">Residue number</option>
              <option value="residue_type_number">Residue name + number</option>
              <option value="atom_index">Atom index</option>
            </Select>
          </div>
        {/if}
      </div>
    {:else}
      <!-- Energetic Input -->
      <div class="space-y-2">
        <h2 class="sidebar-heading">Energetic Input <span class="font-normal text-neutral-500">(active set)</span></h2>
        <div class="space-y-1">
          <p class="sidebar-label">MD Engine</p>
          <Select size="sm" className="w-full" bind:value={energeticEngine}>
            <option value="namd">NAMD</option>
            <option value="openmm">OpenMM</option>
            <option value="gromacs">GROMACS</option>
            <option value="amber">Amber</option>
          </Select>
        </div>
        <div class="flex items-center justify-between">
          <p class="sidebar-label">
            {energeticEngine === 'amber'
              ? 'Amber mdout files'
              : `${{ namd: 'NAMD', openmm: 'OpenMM', gromacs: 'GROMACS' }[energeticEngine]} log files`}
          </p>
          <div class="flex items-center gap-1">
            {#if logFiles.length > 0}
              <Button
                size="sm"
                variant="outline"
                onclick={assignProtocolTimesToLogs}
                title="Fill Time (ns) from the GateWizard default protocol (step0_minimization … step7_production)"
              >
                Protocol times
              </Button>
            {/if}
            <Button size="sm" variant="outline" onclick={addLogFile}>+ Add</Button>
          </div>
        </div>

        {#if logFiles.length === 0}
          <p class="sidebar-hint">
            {energeticEngine === 'amber'
              ? 'No mdout files selected (e.g. step1_equilibration.mdout).'
              : 'No log files selected.'}
          </p>
        {:else}
          <div class="space-y-0.5">
            <div class="flex items-center gap-1 px-1.5 text-[10px] text-neutral-500">
              <span class="min-w-0 flex-1">File</span>
              <span class="w-16 shrink-0 text-center">Time</span>
              <span class="w-12 shrink-0 text-center" title="Subsample every Nth point">Stride</span>
              <span class="w-4 shrink-0"></span>
            </div>
            {#each logFiles as file, i (file.path)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                ondragover={(e) => onDragOver(e, i)}
                ondrop={(e) => onDropLog(e, i)}
                class="flex items-center gap-1 rounded border border-neutral-200 px-1.5 py-1 transition-opacity dark:border-neutral-800
                  {dragIdx === i ? 'opacity-40' : ''}
                  {dragOverIdx === i && dragIdx !== i ? 'border-amber-500 bg-amber-500/10' : ''}"
              >
                <span
                  draggable="true"
                  ondragstart={() => onDragStart(i)}
                  ondragend={onDragEnd}
                  class="shrink-0 cursor-grab text-neutral-600 select-none active:cursor-grabbing"
                  title="Drag to reorder">⠿</span
                >
                <span class="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-300" title={file.path}
                  >{basename(file.path)}</span
                >
                <Input
                  size="sm"
                  blurOnEnter
                  type="number"
                  min="0"
                  step="0.001"
                  placeholder="0"
                  bind:value={logFiles[i].timeNs}
                  className="w-16 shrink-0"
                />
                <span class="sidebar-label shrink-0">ns</span>
                <Input
                  size="sm"
                  blurOnEnter
                  type="number"
                  min="1"
                  max="999"
                  step="1"
                  placeholder="1"
                  bind:value={logFiles[i].stride}
                  className="w-12 shrink-0 text-center tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  title="Subsample every Nth log point (1–999)"
                />
                <button
                  class="shrink-0 px-1 text-red-500 hover:text-red-400"
                  onclick={() => removeLog(i)}
                  title="Remove">✕</button
                >
              </div>
            {/each}
          </div>
        {/if}

        <div class="flex gap-1">
          <Button
            variant="outline"
            className="min-w-0 flex-1"
            onclick={() => detectEnergeticColumns()}
            disabled={detectingProperties || running || logFiles.length === 0}
          >
            {#if detectingProperties}
              <Spinner className="mr-1" />Detecting…
            {:else}
              Detect Properties
            {/if}
          </Button>
          {#if analysisSets.length > 1}
            <Button
              variant="outline"
              className="shrink-0"
              onclick={() => detectEnergeticColumnsAllSets()}
              disabled={detectingProperties || running}
              title="Detect properties on every set that has log files"
            >
              All sets
            </Button>
          {/if}
        </div>
        <p class="sidebar-hint">
          Detect only reads log headers (does not run analysis). Adding logs auto-detects for the active set.
        </p>
      </div>

      <Divider />

      <!-- Energetic Options -->
      <div class="space-y-2">
        <h2 class="sidebar-heading">Energetic Options <span class="font-normal text-neutral-500">(active set)</span></h2>
        <div class="grid grid-cols-2 gap-x-2 gap-y-1.5">
          <div>
            <p class="sidebar-label mb-0.5">Time</p>
            <Select size="sm" bind:value={timeUnits} className="w-full">
              <option value="ns">ns</option>
              <option value="ps">ps</option>
              <option value="µs">µs</option>
            </Select>
          </div>
          <div>
            <p class="sidebar-label mb-0.5">Energy</p>
            <Select size="sm" bind:value={energyUnits} className="w-full">
              <option value="kcal/mol">kcal/mol</option>
              <option value="kJ/mol">kJ/mol</option>
            </Select>
          </div>
          <div>
            <p class="sidebar-label mb-0.5">Pressure</p>
            <Select size="sm" bind:value={pressureUnits} className="w-full">
              <option value="atm">atm</option>
              <option value="bar">bar</option>
              <option value="kPa">kPa</option>
              <option value="MPa">MPa</option>
            </Select>
          </div>
          <div>
            <p class="sidebar-label mb-0.5">Temperature</p>
            <Select size="sm" bind:value={temperatureUnits} className="w-full">
              <option value="K">K</option>
              <option value="°C">°C</option>
              <option value="°F">°F</option>
            </Select>
          </div>
          <div class="col-span-2">
            <p class="sidebar-label mb-0.5">Volume</p>
            <Select size="sm" bind:value={volumeUnits} className="w-full">
              <option value="Å³">Å³</option>
              <option value="nm³">nm³</option>
              <option value="mL">mL</option>
              <option value="L">L</option>
            </Select>
          </div>
        </div>

        <div class="sidebar-panel space-y-1 p-2">
          <p class="sidebar-subheading">Properties</p>
          {#if availableProperties.length === 0}
            <p class="sidebar-hint">Detect properties after adding log files.</p>
          {:else}
            {#each availableProperties as prop (prop)}
              {@const checked = selectedProperties.includes(prop)}
              <label class="flex items-center gap-2">
                <Checkbox
                  name={`prop-${prop}`}
                  {checked}
                  onchange={(e) => toggleProperty(prop, e.currentTarget.checked)}
                />
                <span>{prop}</span>
              </label>
            {/each}
          {/if}
        </div>
      </div>
    {/if}

    <Divider />

    <!-- ===== PLOT SETTINGS (collapsible) ===== -->
    <div class="space-y-2">
      <button
        class="sidebar-heading flex w-full items-center justify-between hover:text-neutral-700 dark:hover:text-neutral-200"
        onclick={() => (plotSettingsOpen = !plotSettingsOpen)}
      >
        <span>⚙ Plot Settings</span>
        <span class="sidebar-hint">{plotSettingsOpen ? '▲' : '▼'}</span>
      </button>

      {#if plotSettingsOpen}
        <div class="sidebar-panel space-y-2 p-2">
          {#if mode === 'energetic'}
            <div>
              <p class="sidebar-label mb-0.5">Layout</p>
              <Select size="sm" bind:value={energeticLayout} className="w-full">
                <option value="grid">Separate panels</option>
                <option value="overlay">Overlay</option>
              </Select>
            </div>
            <div>
              <p class="sidebar-label mb-0.5">Focused panel</p>
              <Select
                size="sm"
                value={focusedPanelKey || selectedProperties[0] || ''}
                onchange={(e) => focusPanel(e.currentTarget.value)}
                className="w-full"
              >
                {#each selectedProperties as prop (prop)}
                  <option value={prop}>{prop}</option>
                {/each}
              </Select>
            </div>
            <label class="flex items-center gap-2">
              <Checkbox name="sync-x" bind:checked={ePlotGlobal.syncX} />
              <span class="sidebar-label">Sync X limits across panels</span>
            </label>
            {#if focusedPanelKey || selectedProperties[0]}
              {@const pk = focusedPanelKey || selectedProperties[0]}
              {@const panelPlaceholderTitle = pk}
              {@const panelPlaceholderY = energeticPropYLabel(pk)}
              <div>
                <p class="sidebar-label mb-0.5">Panel title</p>
                <Input
                  size="sm"
                  value={ePlotPanels[pk]?.title ?? ''}
                  placeholder={panelPlaceholderTitle}
                  className="w-full"
                  oninput={(e) => {
                    ensureEPlotPanel(pk)
                    ePlotPanels = {
                      ...ePlotPanels,
                      [pk]: { ...ePlotPanels[pk], title: e.currentTarget.value }
                    }
                  }}
                />
              </div>
              <div>
                <p class="sidebar-label mb-0.5">Y label</p>
                <Input
                  size="sm"
                  value={ePlotPanels[pk]?.ylabel ?? ''}
                  placeholder={panelPlaceholderY}
                  className="w-full"
                  oninput={(e) => {
                    ensureEPlotPanel(pk)
                    ePlotPanels = {
                      ...ePlotPanels,
                      [pk]: { ...ePlotPanels[pk], ylabel: e.currentTarget.value }
                    }
                  }}
                />
              </div>
              <div>
                <p class="sidebar-label mb-0.5">Line color</p>
                <div class="flex items-center gap-1">
                  <input
                    type="color"
                    bind:value={ePlotPanels[pk].lineColor}
                    class="h-7 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                  />
                  <Input
                    size="sm"
                    bind:value={ePlotPanels[pk].lineColor}
                    className="min-w-0 flex-1 font-mono"
                  />
                </div>
              </div>
              <div>
                <p class="sidebar-label mb-0.5">X min / max</p>
                <div class="flex gap-1">
                  <Input size="sm" bind:value={ePlotPanels[pk].xMin} placeholder="auto" className="w-full" />
                  <Input size="sm" bind:value={ePlotPanels[pk].xMax} placeholder="auto" className="w-full" />
                </div>
              </div>
              <div>
                <p class="sidebar-label mb-0.5">Y min / max</p>
                <div class="flex gap-1">
                  <Input size="sm" bind:value={ePlotPanels[pk].yMin} placeholder="auto" className="w-full" />
                  <Input size="sm" bind:value={ePlotPanels[pk].yMax} placeholder="auto" className="w-full" />
                </div>
              </div>
            {/if}
            <div>
              <p class="sidebar-label mb-0.5">Global title</p>
              <Input
                size="sm"
                value={ePlotGlobal.title}
                placeholder={chartTitle || 'Energetic Analysis'}
                className="w-full"
                oninput={(e) => {
                  ePlotGlobal = { ...ePlotGlobal, title: e.currentTarget.value }
                }}
              />
            </div>
            <div class="grid grid-cols-2 gap-1">
              <div>
                <p class="sidebar-label mb-0.5">Plot bg</p>
                <Input size="sm" bind:value={ePlotGlobal.plotBg} className="w-full font-mono" />
              </div>
              <div>
                <p class="sidebar-label mb-0.5">Text color</p>
                <Input size="sm" bind:value={ePlotGlobal.textColor} className="w-full font-mono" />
              </div>
            </div>
            <label class="flex items-center gap-2">
              <Checkbox name="show-grid-global" bind:checked={ePlotGlobal.showGrid} />
              <span class="sidebar-label">Show grid</span>
            </label>
            <div>
              <p class="sidebar-label mb-0.5">Export DPI (publication PNG)</p>
              <Select size="sm" bind:value={ePlotGlobal.dpi} className="w-full">
                <option value="150">150 dpi</option>
                <option value="300">300 dpi (print)</option>
                <option value="600">600 dpi</option>
              </Select>
            </div>
          {/if}
          <div class="grid grid-cols-2 gap-1">
            {#if mode === 'structural' && (activeStructRes?.lastAnalysisHasTimeX ?? false)}
              <div>
                <p class="sidebar-label mb-0.5">X units</p>
                <Select size="sm" bind:value={ps.xUnit} className="w-full">
                  <option value="ns">ns</option>
                  <option value="ps">ps</option>
                  <option value="µs">µs</option>
                </Select>
              </div>
            {/if}
            {#if mode === 'structural'}
              <div>
                <p class="sidebar-label mb-0.5">Y units</p>
                <Select size="sm" bind:value={ps.yUnit} className="w-full">
                  {#if structuralType === 'area_per_lipid'}
                    <option value="Å²">Å²</option>
                    <option value="nm²">nm²</option>
                  {:else}
                    <option value="Å">Å</option>
                    <option value="nm">nm</option>
                  {/if}
                </Select>
              </div>
            {/if}
          </div>

          {#if mode === 'structural' && structuralType === 'rmsf' && rmsfXaxisType === 'residue_type_number'}
            <div>
              <p class="sidebar-label mb-0.5">Residue code format</p>
              <Select size="sm" bind:value={ps.residueCodeFormat} className="w-full">
                <option value="three">Three-letter (ALA123)</option>
                <option value="one">One-letter (A123)</option>
              </Select>
            </div>
          {/if}

          <!-- Axis limits (structural) -->
          {#if mode === 'structural'}
          <div>
            <p class="sidebar-label mb-0.5">X min / max</p>
            <div class="flex gap-1">
              <Input size="sm" bind:value={ps.xMin} placeholder="auto" className="w-full" />
              <Input size="sm" bind:value={ps.xMax} placeholder="auto" className="w-full" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-1">
            <div>
              <p class="sidebar-label mb-0.5">X tick labels</p>
              <Input
                size="sm"
                type="number"
                min="2"
                max="20"
                step="1"
                bind:value={ps.xTickCount}
                className="w-full"
              />
            </div>
            <div>
              <p class="sidebar-label mb-0.5">Y tick labels</p>
              <Input
                size="sm"
                type="number"
                min="2"
                max="20"
                step="1"
                bind:value={ps.yTickCount}
                className="w-full"
              />
            </div>
          </div>
          <div>
            <p class="sidebar-label mb-0.5">Y min / max</p>
            <div class="flex gap-1">
              <Input size="sm" bind:value={ps.yMin} placeholder="auto" className="w-full" />
              <Input size="sm" bind:value={ps.yMax} placeholder="auto" className="w-full" />
            </div>
          </div>
          {/if}

          {#if mode === 'structural'}
          <div class="grid grid-cols-2 gap-1">
            <div>
              <p class="sidebar-label mb-0.5">Line color</p>
              <div class="flex items-center gap-1">
                <input
                  type="color"
                  bind:value={ps.lineColor}
                  class="h-7 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                  oninput={() => bumpPlotData()}
                />
                <Input
                  size="sm"
                  bind:value={ps.lineColor}
                  className="min-w-0 flex-1 font-mono"
                  onchange={() => bumpPlotData()}
                />
              </div>
            </div>
            <div>
              <p class="sidebar-label mb-0.5">Plot bg</p>
              <div class="flex items-center gap-1">
                <input
                  type="color"
                  bind:value={ps.plotBg}
                  class="h-7 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                />
                <Input size="sm" bind:value={ps.plotBg} className="min-w-0 flex-1 font-mono" />
              </div>
            </div>
            <div>
              <p class="sidebar-label mb-0.5">Text/axes color</p>
              <div class="flex items-center gap-1">
                <input
                  type="color"
                  bind:value={ps.textColor}
                  class="h-7 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                />
                <Input size="sm" bind:value={ps.textColor} className="min-w-0 flex-1 font-mono" />
              </div>
            </div>
            <div class="flex items-end pb-1">
              <label class="flex items-center gap-2">
                <Checkbox name="show-grid" bind:checked={ps.showGrid} />
                <span class="sidebar-label">Show grid</span>
              </label>
            </div>
          </div>
          {#if structuralType === 'area_per_lipid'}
            <div class="space-y-1 rounded border border-neutral-800 p-2">
              <p class="sidebar-label">Area per lipid series styles</p>
              <p class="sidebar-hint">
                Mean uses the plot line color. Set upper/lower colors and marker spacing independently.
              </p>
              <div class="grid grid-cols-2 gap-1">
                <div>
                  <p class="sidebar-label mb-0.5">Mean line</p>
                  <Select
                    size="sm"
                    className="w-full"
                    value={ps.aplMeanLineStyle || 'solid'}
                    onchange={(e) => {
                      ps.aplMeanLineStyle = /** @type {HTMLSelectElement} */ (e.currentTarget).value
                      bumpPlotData()
                    }}
                  >
                    <option value="solid">Solid</option>
                    <option value="dashed">Dashed</option>
                    <option value="dotted">Dotted</option>
                    <option value="dashdot">Dash-dot</option>
                  </Select>
                </div>
                <div>
                  <p class="sidebar-label mb-0.5">Mean marker</p>
                  <Select
                    size="sm"
                    className="w-full"
                    value={ps.aplMeanMarker || 'none'}
                    onchange={(e) => {
                      ps.aplMeanMarker = /** @type {HTMLSelectElement} */ (e.currentTarget).value
                      bumpPlotData()
                    }}
                  >
                    <option value="none">None</option>
                    <option value="circle">Circle</option>
                    <option value="square">Square</option>
                    <option value="triangle">Triangle</option>
                    <option value="cross">Cross</option>
                  </Select>
                </div>
                <div class="col-span-2">
                  <p class="sidebar-label mb-0.5">Mean marker every N points</p>
                  <Input
                    size="sm"
                    type="number"
                    min="1"
                    max="9999"
                    step="1"
                    bind:value={ps.aplMeanMarkerEvery}
                    className="w-full"
                    onchange={() => bumpPlotData()}
                  />
                </div>
                <div>
                  <p class="sidebar-label mb-0.5">Upper leaflet line</p>
                  <Select
                    size="sm"
                    className="w-full"
                    value={ps.aplUpperLineStyle || 'dashed'}
                    onchange={(e) => {
                      ps.aplUpperLineStyle = /** @type {HTMLSelectElement} */ (e.currentTarget).value
                      bumpPlotData()
                    }}
                  >
                    <option value="solid">Solid</option>
                    <option value="dashed">Dashed</option>
                    <option value="dotted">Dotted</option>
                    <option value="dashdot">Dash-dot</option>
                  </Select>
                </div>
                <div>
                  <p class="sidebar-label mb-0.5">Upper marker</p>
                  <Select
                    size="sm"
                    className="w-full"
                    value={ps.aplUpperMarker || 'none'}
                    onchange={(e) => {
                      ps.aplUpperMarker = /** @type {HTMLSelectElement} */ (e.currentTarget).value
                      bumpPlotData()
                    }}
                  >
                    <option value="none">None</option>
                    <option value="circle">Circle</option>
                    <option value="square">Square</option>
                    <option value="triangle">Triangle</option>
                    <option value="cross">Cross</option>
                  </Select>
                </div>
                <div>
                  <p class="sidebar-label mb-0.5">Upper color</p>
                  <div class="flex items-center gap-1">
                    <input
                      type="color"
                      value={ps.aplUpperColor || ps.lineColor || '#22c55e'}
                      class="h-7 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                      oninput={(e) => {
                        ps.aplUpperColor = e.currentTarget.value
                        bumpPlotData()
                      }}
                    />
                    <Input
                      size="sm"
                      value={ps.aplUpperColor || ''}
                      placeholder={ps.lineColor || '#f59e0b'}
                      className="min-w-0 flex-1 font-mono"
                      oninput={(e) => {
                        ps.aplUpperColor = e.currentTarget.value
                        bumpPlotData()
                      }}
                    />
                  </div>
                </div>
                <div>
                  <p class="sidebar-label mb-0.5">Upper marker every N</p>
                  <Input
                    size="sm"
                    type="number"
                    min="1"
                    max="9999"
                    step="1"
                    bind:value={ps.aplUpperMarkerEvery}
                    className="w-full"
                    onchange={() => bumpPlotData()}
                  />
                </div>
                <div>
                  <p class="sidebar-label mb-0.5">Lower leaflet line</p>
                  <Select
                    size="sm"
                    className="w-full"
                    value={ps.aplLowerLineStyle || 'dotted'}
                    onchange={(e) => {
                      ps.aplLowerLineStyle = /** @type {HTMLSelectElement} */ (e.currentTarget).value
                      bumpPlotData()
                    }}
                  >
                    <option value="solid">Solid</option>
                    <option value="dashed">Dashed</option>
                    <option value="dotted">Dotted</option>
                    <option value="dashdot">Dash-dot</option>
                  </Select>
                </div>
                <div>
                  <p class="sidebar-label mb-0.5">Lower marker</p>
                  <Select
                    size="sm"
                    className="w-full"
                    value={ps.aplLowerMarker || 'none'}
                    onchange={(e) => {
                      ps.aplLowerMarker = /** @type {HTMLSelectElement} */ (e.currentTarget).value
                      bumpPlotData()
                    }}
                  >
                    <option value="none">None</option>
                    <option value="circle">Circle</option>
                    <option value="square">Square</option>
                    <option value="triangle">Triangle</option>
                    <option value="cross">Cross</option>
                  </Select>
                </div>
                <div>
                  <p class="sidebar-label mb-0.5">Lower color</p>
                  <div class="flex items-center gap-1">
                    <input
                      type="color"
                      value={ps.aplLowerColor || ps.lineColor || '#38bdf8'}
                      class="h-7 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                      oninput={(e) => {
                        ps.aplLowerColor = e.currentTarget.value
                        bumpPlotData()
                      }}
                    />
                    <Input
                      size="sm"
                      value={ps.aplLowerColor || ''}
                      placeholder={ps.lineColor || '#f59e0b'}
                      className="min-w-0 flex-1 font-mono"
                      oninput={(e) => {
                        ps.aplLowerColor = e.currentTarget.value
                        bumpPlotData()
                      }}
                    />
                  </div>
                </div>
                <div>
                  <p class="sidebar-label mb-0.5">Lower marker every N</p>
                  <Input
                    size="sm"
                    type="number"
                    min="1"
                    max="9999"
                    step="1"
                    bind:value={ps.aplLowerMarkerEvery}
                    className="w-full"
                    onchange={() => bumpPlotData()}
                  />
                </div>
                <div>
                  <p class="sidebar-label mb-0.5">Marker size</p>
                  <Input
                    size="sm"
                    type="number"
                    min="1"
                    max="10"
                    step="0.5"
                    bind:value={ps.aplMarkerSize}
                    className="w-full"
                    onchange={() => bumpPlotData()}
                  />
                </div>
                <div>
                  <p class="sidebar-label mb-0.5">Line width</p>
                  <Input
                    size="sm"
                    type="number"
                    min="1"
                    max="6"
                    step="0.5"
                    bind:value={ps.lineWidth}
                    className="w-full"
                    onchange={() => bumpPlotData()}
                  />
                </div>
              </div>
            </div>
            <p class="sidebar-hint">
              A flat mean APL line is expected when the lateral box is fixed (e.g. NVT): Voronoi areas
              sum to L<sub>x</sub>·L<sub>y</sub>, so mean ≈ box area / n<sub>lipids</sub>. Leaflets can still
              fluctuate. In NPT/variable-area ensembles the mean should vary with the box. Check the
              backend log for box area vs mean APL diagnostics.
            </p>
          {/if}
          {/if}

          {#if mode === 'structural'}
            <label class="flex items-center gap-2">
              <Checkbox name="show-selection-subtitle" bind:checked={ps.showSelectionSubtitle} />
              <span class="sidebar-label">Show selection on plot</span>
            </label>
          {/if}

          <!-- Aspect ratio + transparent bg + DPI + font (structural) -->
          {#if mode === 'structural'}
          <div class="grid grid-cols-2 gap-1">
            <div>
              <p class="sidebar-label mb-0.5">Aspect ratio (W/H)</p>
              <Input
                size="sm"
                type="number"
                min="0.5"
                max="10"
                step="0.1"
                bind:value={ps.aspectRatio}
                className="w-full"
              />
            </div>
            <div>
              <p class="sidebar-label mb-0.5">Export DPI</p>
              <Select size="sm" bind:value={ps.dpi} className="w-full">
                <option value="72">72 dpi (screen)</option>
                <option value="96">96 dpi</option>
                <option value="150">150 dpi</option>
                <option value="300">300 dpi (print)</option>
                <option value="600">600 dpi (high-res)</option>
              </Select>
            </div>
            <div class="flex items-end pb-1">
              <label class="flex items-center gap-2">
                <Checkbox name="transparent-bg" bind:checked={ps.transparentBg} />
                <span class="sidebar-label">Transparent bg</span>
              </label>
            </div>
            <div>
              <p class="sidebar-label mb-0.5">Font</p>
              <Select size="sm" bind:value={ps.fontFamily} className="w-full">
                <option value="Roboto, sans-serif">Roboto</option>
                <option value="sans-serif">Sans-serif</option>
                <option value="serif">Serif</option>
                <option value="monospace">Monospace</option>
                <option value="Arial, sans-serif">Arial</option>
                <option value="Georgia, serif">Georgia</option>
                <option value="'Times New Roman', serif">Times New Roman</option>
                <option value="'Courier New', monospace">Courier New</option>
                <option value="Helvetica, sans-serif">Helvetica</option>
              </Select>
            </div>
          </div>
          {/if}

          {#if mode === 'structural'}
          <!-- Legend position -->
          <div>
            <p class="sidebar-label mb-0.5">Legend position</p>
            <Select size="sm" bind:value={ps.legendPosition} className="w-full">
              <option value="bottom">Below chart</option>
              <option value="top-left">Inside — top left</option>
              <option value="top-right">Inside — top right</option>
              <option value="bottom-left">Inside — bottom left</option>
              <option value="bottom-right">Inside — bottom right</option>
              <option value="none">Hidden</option>
            </Select>
          </div>
          {/if}

          {#if mode === 'structural'}
          <!-- Margin extra (for long tick labels) -->
          <div class="grid grid-cols-2 gap-1">
            <div>
              <p class="sidebar-label mb-0.5">Extra left margin</p>
              <Input
                size="sm"
                type="number"
                min="0"
                max="120"
                step="5"
                bind:value={ps.extraLeftMargin}
                className="w-full"
                placeholder="0"
              />
            </div>
            <div>
              <p class="sidebar-label mb-0.5">Extra bottom margin</p>
              <Input
                size="sm"
                type="number"
                min="0"
                max="80"
                step="5"
                bind:value={ps.extraBottomMargin}
                className="w-full"
                placeholder="0"
              />
            </div>
          </div>
          {/if}

          <!-- Actions -->
          <div class="flex flex-wrap gap-1 pt-1">
            <Button
              size="sm"
              variant="ghost"
              className="flex-1"
              onclick={() => {
                if (mode === 'structural') {
                  sPlots[structuralType] = { ...structDefaults }
                } else {
                  ePlotGlobal = { ...energGlobalDefaults, ...energPanelShell }
                  ePlotPanels = {}
                  for (const p of selectedProperties) ensureEPlotPanel(p)
                  statsRange = null
                  panelRangeStats = {}
                }
              }}>Reset</Button
            >
          </div>
        </div>
      {/if}
    </div>

    <Divider />

    <div class="space-y-2">
      <h2 class="sidebar-heading">Output folder</h2>
      <div class="space-y-1">
        <Input
          type="text"
          size="sm"
          bind:value={outputFolderName}
          className="w-full"
          placeholder="04_analysis"
        />
        <p
          class="rounded-md border border-neutral-200 p-2 wrap-break-word sidebar-label dark:border-neutral-800"
        >
          {#if outputDir}
            {outputDir}
          {:else if workingDir}
            Files will be written under the working directory
          {:else}
            Set a working directory in the top bar
          {/if}
        </p>
      </div>
    </div>

    {#if workingDir === ''}
      <p class="gw-notice gw-notice-warning">
        Set a <strong>Working Directory</strong> in the top bar to write analysis output.
      </p>
    {/if}

    {#if analysisStatus.progress.active && runProgressStages.length > 0}
      <div class="space-y-2 rounded-md border border-neutral-200 p-2 dark:border-neutral-700">
        <div class="flex items-center justify-between gap-2">
          <p class="sidebar-label">
            Running set {analysisStatus.progress.current}/{analysisStatus.progress.total}
            {#if analysisStatus.progress.label}
              — {analysisStatus.progress.label}
            {/if}
          </p>
          <Spinner />
        </div>
        <div class="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          <div
            class="h-full rounded-full bg-amber-500 transition-all duration-300"
            style={`width: ${Math.round((analysisProgressDoneCount / Math.max(runProgressStages.length, 1)) * 100)}%`}
          ></div>
        </div>
        <div class="space-y-0.5">
          {#each runProgressStages as stage (stage.id)}
            <div class="flex items-center gap-2 text-[11px] text-neutral-600 dark:text-neutral-400">
              <span class="w-4 shrink-0 text-center">
                {#if stage.status === 'running'}
                  <Spinner className="inline-block size-3" />
                {:else if stage.status === 'done'}
                  <span class="text-emerald-600 dark:text-emerald-400">✓</span>
                {:else if stage.status === 'error'}
                  <span class="text-red-600 dark:text-red-400">✕</span>
                {:else}
                  <span class="text-neutral-400">○</span>
                {/if}
              </span>
              <span class="truncate">{stage.label}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if analysisSets.length > 1}
      <div class="relative w-full" bind:this={runAnalysisMenuEl}>
        <div class="flex w-full">
          <Button
            className="min-w-0 flex-1 rounded-r-none border-r-0"
            onclick={() => {
              runAnalysisMenuOpen = false
              runAnalysis(runAnalysisScope)
            }}
            disabled={running || !canRunAnalysis}
          >
            {#if running}
              <Spinner className="mr-1" />Running...
            {:else}
              {runAnalysisButtonLabel()}
            {/if}
          </Button>
          <button
            type="button"
            class="inline-flex shrink-0 items-center justify-center rounded-r-lg border border-neutral-300 bg-neutral-800 px-2.5 text-sm text-neutral-100 transition-colors hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 disabled:pointer-events-none disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-50 dark:text-neutral-900 dark:hover:bg-neutral-200 dark:focus-visible:ring-neutral-600"
            disabled={running || !canRunAnalysis}
            aria-label="Choose run scope"
            aria-expanded={runAnalysisMenuOpen}
            onclick={() => (runAnalysisMenuOpen = !runAnalysisMenuOpen)}
          >
            <svg viewBox="0 0 10 6" class="size-2.5 fill-current opacity-80" aria-hidden="true">
              <path d="M0 0l5 6 5-6z" />
            </svg>
          </button>
        </div>
        {#if runAnalysisMenuOpen}
          <div
            class="absolute bottom-full left-0 right-0 z-20 mb-1 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
            role="menu"
          >
            <button
              type="button"
              role="menuitem"
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
              onclick={() => {
                runAnalysisScope = 'current'
                runAnalysisMenuOpen = false
              }}
            >
              <span class="w-4 shrink-0 text-center text-xs">{runAnalysisScope === 'current' ? '✓' : ''}</span>
              <span>Current set</span>
            </button>
            <button
              type="button"
              role="menuitem"
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
              onclick={() => {
                runAnalysisScope = 'all'
                runAnalysisMenuOpen = false
              }}
            >
              <span class="w-4 shrink-0 text-center text-xs">{runAnalysisScope === 'all' ? '✓' : ''}</span>
              <span>All sets ({analysisSets.length})</span>
            </button>
          </div>
        {/if}
      </div>
    {:else}
      <Button className="w-full" onclick={() => runAnalysis('current')} disabled={running || !canRunAnalysis}>
        {#if running}
          <Spinner className="mr-1" />Running...
        {:else}
          Run Analysis
        {/if}
      </Button>
    {/if}

    {#if analysisActionNotice}
      <p class="gw-notice gw-notice-success text-[11px] leading-snug">{analysisActionNotice}</p>
    {/if}

    <div class="space-y-1">
      <p class="sidebar-label">Export chart</p>
      <div class="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="outline"
          className="min-w-0 flex-1"
          onclick={exportCsv}
          disabled={displaySeries.length === 0}
        >
          CSV
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="min-w-0 flex-1"
          onclick={exportSvg}
          disabled={!svgEl}
        >
          SVG
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="min-w-0 flex-1"
          onclick={exportPng}
          disabled={!svgEl}
        >
          PNG
        </Button>
        {#if mode === 'energetic'}
          <Button
            size="sm"
            variant="outline"
            className="min-w-0 flex-1"
            onclick={exportPublicationPng}
            disabled={rawSeries.length === 0}
          >
            Pub PNG
          </Button>
        {/if}
      </div>
    </div>

    <Button className="w-full" variant="ghost" onclick={onClear}>Clear</Button>
  </aside>

  <!-- ===== CHART AREA ===== -->
  <div
    class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    style={paneBackgroundStyle}
  >
    <h1 class="m-4 mb-2 text-xl font-semibold">{displayTitle || 'Analysis'}</h1>

    {#if lastError}
      <div class="gw-notice gw-notice-error mx-4 mb-3 select-text">
        <div class="flex items-start gap-2">
          <pre class="min-w-0 flex-1 whitespace-pre-wrap font-mono text-[11px] leading-snug">{lastError}</pre>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onclick={() => copyAnalysisError(lastError)}
            title="Copy error to clipboard"
          >
            Copy
          </Button>
        </div>
      </div>
    {/if}

    {#if (mode === 'structural' ? chartView.mode === 'empty' : energeticChartIsEmpty)}
      <p
        class="mx-4 mb-4 flex flex-1 items-center justify-center rounded-lg border border-dashed border-neutral-300 text-neutral-500 dark:border-neutral-800 dark:text-neutral-700"
      >
        {#if mode === 'energetic' && energeticMultiSetSession && visibleCompareSets.length === 0 && analysisSets.some((s) => s.energeticResult)}
          No sets checked — mark a set to show it on the chart.
        {:else if mode === 'structural' && analysisSets.length > 1 && visibleCompareSets.length === 0 && analysisSets.some((s) => structuralSetHasPlottableResult(s, structuralType))}
          No sets checked — mark a set to show it on the chart.
        {:else if hasSavedResultMetadata}
          Results are saved but plot data is missing. Reload the session or re-run analysis.
        {:else}
          Run an analysis to see results.
        {/if}
      </p>
    {:else}
      <div class="mx-4 mb-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {#if (mode === 'structural' ? chartView.series.length > 0 : energeticPanels.length > 0 || displaySeries.length > 0)}
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-xs text-neutral-400">Tools:</span>
            <Button
              size="sm"
              variant={chartInteractionMode === 'pan' ? 'default' : 'outline'}
              onclick={() => (chartInteractionMode = 'pan')}>Pan</Button
            >
            <Button
              size="sm"
              variant={chartInteractionMode === 'boxZoom' ? 'default' : 'outline'}
              onclick={() => (chartInteractionMode = 'boxZoom')}>Box zoom</Button
            >
            <Button
              size="sm"
              variant={chartInteractionMode === 'rangeSelect' ? 'default' : 'outline'}
              onclick={() => (chartInteractionMode = 'rangeSelect')}>Range stats</Button
            >
            <Button size="sm" variant="outline" onclick={resetChartView}>Reset</Button>
            {#if hasChartTimeAxis && (chartInteractionMode === 'rangeSelect' || statsRange)}
              <span class="text-xs text-neutral-400">Range ({chartTimeUnitLabel}):</span>
              <Input
                size="sm"
                type="number"
                step="any"
                bind:value={statsRangeStartInput}
                className="w-20"
                onkeydown={(e) => e.key === 'Enter' && applyStatsRangeFromInputs()}
              />
              <span class="text-xs text-neutral-500">–</span>
              <Input
                size="sm"
                type="number"
                step="any"
                bind:value={statsRangeEndInput}
                className="w-20"
                onkeydown={(e) => e.key === 'Enter' && applyStatsRangeFromInputs()}
              />
              <Button size="sm" variant="outline" onclick={applyStatsRangeFromInputs}>Apply</Button>
              {#if statsRange}
                <Button size="sm" variant="ghost" onclick={clearStatsRange}>Clear range</Button>
              {/if}
            {/if}
            {#if chartInteractionMode === 'rangeSelect' && hasChartTimeAxis}
              <span class="text-xs text-neutral-500">Drag on chart; drag band edges to adjust.</span>
            {/if}
          </div>
        {/if}

        {#key `${compareLayout}-${energeticCompareLayout}-${plotDataRevision}-${structuralType}-${mode}-${chartView.mode}-${chartView.series.length}-${energeticLayout}-${compareEnergeticProperties.join('|')}`}
        {#if mode === 'structural' && chartView.mode === 'grid'}
          <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {#each chartView.panels as panel (panel.key)}
              <div class="rounded-lg border border-neutral-800 p-2">
                <p class="mb-1 text-xs font-medium text-neutral-300">{panel.title}</p>
                <LineChart
                  series={panel.series}
                  xLabel={displayXLabel}
                  yLabel={displayYLabel}
                  plotBg={ps.plotBg}
                  tickColor={ps.textColor}
                  labelColor={ps.textColor}
                  axisColor={ps.textColor}
                  gridColor={ps.textColor + '40'}
                  showGrid={ps.showGrid}
                  aspectRatio={Number(ps.aspectRatio) || 2.5}
                  transparentBg={ps.transparentBg}
                  fontFamily={ps.fontFamily || 'Roboto, sans-serif'}
                  chartTitle={panel.title}
                  xTickLabels={displayXTickLabels}
                  xTicks={Number(ps.xTickCount) || 5}
                  yTicks={Number(ps.yTickCount) || 5}
                  extraLeftMargin={Number(ps.extraLeftMargin) || 0}
                  extraBottomMargin={Number(ps.extraBottomMargin) || 0}
                  legendPosition={ps.legendPosition || 'top-left'}
                  xMinOverride={xMinO}
                  xMaxOverride={xMaxO}
                  yMinOverride={yMinO}
                  yMaxOverride={yMaxO}
                  interactionMode={hasChartTimeAxis ? chartInteractionMode : 'pan'}
                  statsRange={hasChartTimeAxis ? statsRange : null}
                  onAxisRange={applyStructAxisRange}
                  onStatsRange={handleStatsRange}
                />
              </div>
            {/each}
          </div>
        {:else if mode === 'structural'}
          <LineChart
            series={chartView.series}
            xLabel={displayXLabel}
            yLabel={displayYLabel}
            plotBg={ps.plotBg}
            tickColor={ps.textColor}
            labelColor={ps.textColor}
            axisColor={ps.textColor}
            gridColor={ps.textColor + '40'}
            showGrid={ps.showGrid}
            aspectRatio={Number(ps.aspectRatio) || 2.5}
            transparentBg={ps.transparentBg}
            fontFamily={ps.fontFamily || 'Roboto, sans-serif'}
            chartTitle={displayTitle}
            chartSubtitle={displaySubtitle}
            xTickLabels={displayXTickLabels}
            xTicks={Number(ps.xTickCount) || 5}
            yTicks={Number(ps.yTickCount) || 5}
            extraLeftMargin={Number(ps.extraLeftMargin) || 0}
            extraBottomMargin={Number(ps.extraBottomMargin) || 0}
            legendPosition={ps.legendPosition || 'top-left'}
            xMinOverride={xMinO}
            xMaxOverride={xMaxO}
            yMinOverride={yMinO}
            yMaxOverride={yMaxO}
            interactionMode={hasChartTimeAxis ? chartInteractionMode : 'pan'}
            statsRange={hasChartTimeAxis ? statsRange : null}
            onAxisRange={applyStructAxisRange}
            onStatsRange={handleStatsRange}
            bind:svgEl
          />
        {:else if mode === 'energetic'}
          {#if energeticPanels.length === 1}
            {@const panel = energeticPanels[0]}
            {@const pk =
              panel.key === '__compare__' || panel.key === '__overlay__'
                ? focusedPanelKey || selectedProperties[0] || panel.key
                : panel.key}
            {@const pset = ePlotPanels[pk] ?? defaultPanelSettings()}
            {@const xMinP =
              pset.xMin !== '' && Number.isFinite(Number(pset.xMin)) ? Number(pset.xMin) : null}
            {@const xMaxP =
              pset.xMax !== '' && Number.isFinite(Number(pset.xMax)) ? Number(pset.xMax) : null}
            {@const yMinP =
              pset.yMin !== '' && Number.isFinite(Number(pset.yMin)) ? Number(pset.yMin) : null}
            {@const yMaxP =
              pset.yMax !== '' && Number.isFinite(Number(pset.yMax)) ? Number(pset.yMax) : null}
            <LineChart
              series={panel.series}
              xLabel={displayXLabel}
              yLabel={energeticPanelYLabel(panel, pset)}
              plotBg={ePlotGlobal.plotBg}
              tickColor={ePlotGlobal.textColor}
              labelColor={ePlotGlobal.textColor}
              axisColor={ePlotGlobal.textColor}
              gridColor={(ePlotGlobal.gridColor || ePlotGlobal.textColor) + '40'}
              showGrid={ePlotGlobal.showGrid !== false}
              aspectRatio={Number(energPanelShell.aspectRatio) || 2.5}
              fontFamily={ePlotGlobal.fontFamily || 'Roboto, sans-serif'}
              chartTitle={energeticPanelChartTitle(panel, pset)}
              xTicks={Number(energPanelShell.xTickCount) || 5}
              yTicks={Number(energPanelShell.yTickCount) || 5}
              extraLeftMargin={Number(energPanelShell.extraLeftMargin) || 0}
              legendPosition={energPanelShell.legendPosition || 'top-left'}
              xMinOverride={xMinP}
              xMaxOverride={xMaxP}
              yMinOverride={yMinP}
              yMaxOverride={yMaxP}
              interactionMode={chartInteractionMode}
              statsRange={statsRange}
              onAxisRange={(r) => applyPanelAxisRange(pk, r)}
              onStatsRange={handleStatsRange}
              bind:svgEl
            />
          {:else}
            <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {#each energeticPanels as panel (panel.key)}
                {@const pk = panel.key}
                {@const pset = ePlotPanels[pk] ?? defaultPanelSettings()}
                {@const propKey =
                  panel.series?.[0]?.baseName ||
                  (selectedProperties.includes(pk) ? pk : focusedPanelKey || selectedProperties[0] || '')}
                {@const propPset = propKey ? ePlotPanels[propKey] ?? defaultPanelSettings() : pset}
                {@const xMinP =
                  pset.xMin !== '' && Number.isFinite(Number(pset.xMin))
                    ? Number(pset.xMin)
                    : propPset.xMin !== '' && Number.isFinite(Number(propPset.xMin))
                      ? Number(propPset.xMin)
                      : null}
                {@const xMaxP =
                  pset.xMax !== '' && Number.isFinite(Number(pset.xMax))
                    ? Number(pset.xMax)
                    : propPset.xMax !== '' && Number.isFinite(Number(propPset.xMax))
                      ? Number(propPset.xMax)
                      : null}
                {@const yMinP =
                  pset.yMin !== '' && Number.isFinite(Number(pset.yMin))
                    ? Number(pset.yMin)
                    : propPset.yMin !== '' && Number.isFinite(Number(propPset.yMin))
                      ? Number(propPset.yMin)
                      : null}
                {@const yMaxP =
                  pset.yMax !== '' && Number.isFinite(Number(pset.yMax))
                    ? Number(pset.yMax)
                    : propPset.yMax !== '' && Number.isFinite(Number(propPset.yMax))
                      ? Number(propPset.yMax)
                      : null}
                {@const yLabelResolved = energeticPanelYLabel(panel, {
                  ...propPset,
                  ylabel: pset.ylabel || propPset.ylabel
                })}
                {@const titleResolved = energeticPanelChartTitle(panel, {
                  ...pset,
                  title: pset.title || (propKey === pk ? propPset.title : '')
                })}
                <div
                  class={`rounded-lg border p-2 ${focusedPanelKey === pk || focusedPanelKey === propKey ? 'border-amber-500/60' : 'border-neutral-800'}`}
                  role="button"
                  tabindex="0"
                  onclick={() => focusPanel(propKey || pk)}
                  onkeydown={(e) => e.key === 'Enter' && focusPanel(propKey || pk)}
                >
                  <LineChart
                    series={panel.series}
                    xLabel={displayXLabel}
                    yLabel={yLabelResolved}
                    plotBg={ePlotGlobal.plotBg}
                    tickColor={ePlotGlobal.textColor}
                    labelColor={ePlotGlobal.textColor}
                    axisColor={ePlotGlobal.textColor}
                    gridColor={(ePlotGlobal.gridColor || ePlotGlobal.textColor) + '40'}
                    showGrid={ePlotGlobal.showGrid !== false}
                    aspectRatio={Number(energPanelShell.aspectRatio) || 2.5}
                    fontFamily={ePlotGlobal.fontFamily || 'Roboto, sans-serif'}
                    chartTitle={titleResolved}
                    xTicks={Number(energPanelShell.xTickCount) || 5}
                    yTicks={Number(energPanelShell.yTickCount) || 5}
                    extraLeftMargin={Number(energPanelShell.extraLeftMargin) || 0}
                    legendPosition={energPanelShell.legendPosition || 'top-left'}
                    xMinOverride={xMinP}
                    xMaxOverride={xMaxP}
                    yMinOverride={yMinP}
                    yMaxOverride={yMaxP}
                    interactionMode={chartInteractionMode}
                    statsRange={statsRange}
                    onAxisRange={(r) => applyPanelAxisRange(pk, r)}
                    onStatsRange={handleStatsRange}
                  />
                </div>
              {/each}
            </div>
          {/if}
        {/if}
        {/key}

        {#if chartStatsRows.some((row) => row.stats && row.stats.count > 0)}
          <div class="rounded-md border border-neutral-200 dark:border-neutral-800">
            {#if statsRange && hasChartTimeAxis}
              <p class="border-b border-neutral-200 px-2 py-1 text-[10px] text-neutral-500 dark:border-neutral-800">
                Range [{Math.min(statsRange.t0, statsRange.t1).toFixed(3)} –
                {Math.max(statsRange.t0, statsRange.t1).toFixed(3)} {chartTimeUnitLabel}]
              </p>
            {/if}
            <div class="overflow-x-auto">
              <table class="w-full min-w-[28rem] border-collapse text-[11px] tabular-nums">
                <thead>
                  <tr class="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
                    <th class="px-2 py-1 font-medium">Set</th>
                    <th class="px-2 py-1 font-medium">Mean</th>
                    <th class="px-2 py-1 font-medium">Std</th>
                    <th class="px-2 py-1 font-medium">Min</th>
                    <th class="px-2 py-1 font-medium">Max</th>
                  </tr>
                </thead>
                <tbody>
                  {#each chartStatsRows as row (row.name)}
                    {#if row.stats && row.stats.count > 0}
                      <tr class="border-b border-neutral-200/70 last:border-0 dark:border-neutral-800/70">
                        <td class="px-2 py-1">
                          <span class="inline-flex items-center gap-1.5">
                            <span
                              class="inline-block h-2 w-2 shrink-0 rounded-full"
                              style={`background:${row.color}`}
                            ></span>
                            <span class="truncate text-neutral-300">{row.name}</span>
                          </span>
                        </td>
                        <td class="px-2 py-1">{Number(row.stats.mean).toFixed(4)}</td>
                        <td class="px-2 py-1">{Number(row.stats.std).toFixed(4)}</td>
                        <td class="px-2 py-1">{Number(row.stats.min).toFixed(4)}</td>
                        <td class="px-2 py-1">{Number(row.stats.max).toFixed(4)}</td>
                      </tr>
                    {/if}
                  {/each}
                </tbody>
              </table>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
