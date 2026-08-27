<script>
  import { tick } from 'svelte'
  import Beaker from '../components/icons/Beaker.svelte'
  import Protein from '../components/icons/Protein.svelte'
  import TopologyInfoModal from '../components/TopologyInfoModal.svelte'
  import OutputPathFields from '../components/OutputPathFields.svelte'
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
    APL_METHOD_DEFAULTS,
    APL_METHODS,
    aplMethodLabel,
    createAnalysisSet,
    defaultSelectionForStructuralType,
    duplicateAnalysisSet,
    assignCsvStems,
    aplSeriesColor,
    aplSeriesLabel,
    extraSeriesRole,
    getSetStructuralResult,
    getSetStructuralResultTypes,
    isBilayerStructuralType,
    looksLikeBilayerHeadgroupSelection,
    looksLikeProteinSelection,
    normalizeAplMethod,
    normalizeAnalysisSetStructuralResults,
    newSetId,
    resolveStructuralTypeSelection,
    setHasResult,
    structuralMeanY,
    structuralSetHasPlottableResult
  } from '../lib/analysisSets.js'
  import { notifyJobFinishedIfUnfocused } from '../lib/jobNotifications.svelte.js'
  import {
    ANALYSIS_SESSION_FILENAME,
    clonePlainAnalysisData,
    deserializeAnalysisSession,
    formatAnalysisSessionIdentity,
    hydrateAnalysisSessionFromCsv,
    hydrateAnalysisSetsFromCsv,
    hydratePlotColorFlags,
    csvFileNameForAnalysisSet,
    csvFileNameForEnergeticSet,
    energeticResultHasPlotData,
    normalizeEnergeticCompareLayout,
    normalizeHexColor,
    resolvePlotColors,
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
    compactDirPath,
    defaultAnalysisFolderName,
    dirBasename,
    outputFolderPath,
    parentDirPath,
    uniqueDirList
  } from '../lib/outputFolders.js'
  import {
    assignProtocolStageTimes,
    defaultProtocolName,
    formatTrajectoryTimeNs
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
  /** @type {AbortController|null} */
  let analysisAbort = $state(null)
  /** Separate from analysis run — Detect Properties must not freeze the Run button. */
  let detectingProperties = $state(false)
  let outputFolderName = $state('')
  /** Parent directory for analysis output; defaults to the top-bar working directory. */
  let outputParentDir = $state('')
  /** Optional human label for the analysis session (saved in analysis_session.json). */
  let sessionName = $state('')
  /** Optional basename for CSV / SVG / PNG chart exports (no extension). Empty uses the chart title. */
  let exportFileName = $state('')

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

  const suggestedOutputFolderName = $derived(defaultAnalysisFolderName(topologyPath))
  const resolvedOutputParent = $derived((outputParentDir.trim() || workingDir).trim())
  const outputDir = $derived(outputFolderPath(resolvedOutputParent, resolveOutputFolderName()))

  const canRunAnalysis = $derived(resolvedOutputParent !== '')

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
  /** Non-lipid atoms for protein-aware APL (empty = no exclusion). */
  let excludeSel = $state('protein')
  let excludeCutoff = $state('30')
  let aplMethod = $state(APL_METHOD_DEFAULTS.aplMethod)
  let gridmatN = $state(APL_METHOD_DEFAULTS.gridmatN)
  let gridmatPrecision = $state(APL_METHOD_DEFAULTS.gridmatPrecision)
  let vtmcNSamples = $state(APL_METHOD_DEFAULTS.vtmcNSamples)
  let vtmcProteinRadius = $state(APL_METHOD_DEFAULTS.vtmcProteinRadius)
  const aplMethodHint = $derived(
    APL_METHODS.find((item) => item.id === aplMethod)?.hint || ''
  )
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
  /** Right-panel plot update overlay (mode/type/set/property changes). */
  let plotViewBusy = $state(false)
  let plotViewBusyLabel = $state('Updating plot…')
  let plotViewBusyGeneration = 0
  /** True while the Structural Options type dropdown is switching types. */
  let structuralTypeChanging = $state(false)
  /** Path waiting on in-app replace confirm (native confirm() crashes Electron/GTK on WSL). */
  let pendingReplaceSessionPath = $state('')
  /**
   * Explicit chart snapshot — avoids Svelte nested-proxy derived staleness after session load.
   * @type {{ mode: 'empty' | 'overlay' | 'grid', series: Array<{ name: string, x: number[], y: number[], color?: string }>, panels: Array<{ key: string, title: string, series: Array<{ name: string, x: number[], y: number[], color?: string }> }> }}
   */
  let chartView = $state({ mode: 'empty', series: [], panels: [] })
  /** Energetic x/y snapshot — appearance (name/color) is applied cheaply on top. */
  let energeticGeom = $state([])
  let statsRangeStartInput = $state('')
  let statsRangeEndInput = $state('')
  /** @type {'current' | 'all'} */
  let runAnalysisScope = $state('current')
  let runAnalysisMenuOpen = $state(false)
  /** @type {HTMLDivElement | null} */
  let runAnalysisMenuEl = $state(null)
  /** @type {'current' | 'all'} */
  let detectPropertiesScope = $state('current')
  let detectPropertiesMenuOpen = $state(false)
  /** @type {HTMLDivElement | null} */
  let detectPropertiesMenuEl = $state(null)
  let savingSession = $state(false)
  let loadingSession = $state(false)
  /** @type {'' | 'csv' | 'svg' | 'png' | 'pub'} */
  let exportingKind = $state('')
  const exportingChart = $derived(exportingKind !== '')
  /** @type {Array<{ session_path: string, output_dir: string, name: string, folder_name?: string, session_name?: string, saved_at: string, mode: string, set_count: number, analysis_summary: string }>} */
  let savedSessions = $state([])
  let selectedSessionPath = $state('')
  let sessionScanHint = $state('')
  let analysisActionNotice = $state('')
  /** @type {ReturnType<typeof setTimeout> | null} */
  let analysisActionNoticeTimer = null
  /** Shown under Saved analysis (session save/load), not at the panel footer. */
  let sessionActionNotice = $state('')
  /** @type {'success' | 'info'} */
  let sessionActionNoticeKind = $state('success')
  /** True after a successful session save until the user edits the session. */
  let sessionSavedClean = $state(false)
  /** Fingerprint of last successful save — used so “already saved” still works if dirty flags flap. */
  let lastSavedSessionFingerprint = ''
  /** Skip dirty-tracking while save/load rewrites set fields. */
  let suppressSessionDirty = false
  /** @type {ReturnType<typeof setTimeout> | null} */
  let sessionActionNoticeTimer = null
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
    if (!detectPropertiesMenuOpen) return
    const onDoc = (/** @type {PointerEvent} */ e) => {
      const el = detectPropertiesMenuEl
      if (el && e.target instanceof Node && !el.contains(e.target)) {
        detectPropertiesMenuOpen = false
      }
    }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  })

  $effect(() => {
    const roots = uniqueDirList(workingDir, outputParentDir)
    if (roots.length === 0) {
      savedSessions = []
      selectedSessionPath = ''
      sessionScanHint = ''
      return
    }
    void refreshSavedSessions()
  })

  async function refreshSavedSessions() {
    const roots = uniqueDirList(workingDir, outputParentDir)
    if (roots.length === 0) {
      savedSessions = []
      sessionScanHint = ''
      return
    }
    try {
      const lists = await Promise.all(
        roots.map((dir) =>
          scanAnalysisSessions(dir)
            .then((r) => r.sessions || [])
            .catch(() => [])
        )
      )
      const byPath = new Map()
      for (const session of lists.flat()) {
        if (session?.session_path && !byPath.has(session.session_path)) {
          byPath.set(session.session_path, session)
        }
      }
      savedSessions = [...byPath.values()].sort((a, b) =>
        String(b.saved_at || '').localeCompare(String(a.saved_at || ''))
      )
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
    syncEnergeticGeom()
  }

  /**
   * Show a blur/spinner overlay on the plot panel while a view rebuild runs.
   * Awaits a paint frame first so the overlay is visible before heavy work.
   * @param {string} label
   * @param {() => (void | Promise<void>)} work
   */
  async function withPlotViewBusy(label, work) {
    const gen = ++plotViewBusyGeneration
    plotViewBusyLabel = label || 'Updating plot…'
    plotViewBusy = true
    try {
      await tick()
      // Paint the overlay before sync chart rebuilds block the main thread.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      await work()
      await tick()
      // Keep overlay through LineChart remount / layout.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    } finally {
      if (gen === plotViewBusyGeneration) plotViewBusy = false
    }
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
            title: setLegendName(set),
            series: res
              ? buildStructuralSeries(set, res, { prefixSetName: false })
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
          prefixSetName: visible.length > 1
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

  /** Display names matching the Structural Options dropdown. */
  const STRUCTURAL_TYPE_TITLES = {
    rmsd: 'RMSD',
    rmsf: 'RMSF',
    distance: 'Distance',
    radius_of_gyration: 'Radius of Gyration',
    membrane_thickness: 'Membrane Thickness',
    area_per_lipid: 'Area per Lipid'
  }

  /** @param {string} [type] */
  function autoStructuralTitle(type = structuralType) {
    return STRUCTURAL_TYPE_TITLES[type] || String(type || 'Analysis').replace(/_/g, ' ')
  }

  /** Plot legend for a set: custom text, otherwise the set name. */
  function setLegendName(set) {
    const custom = String(set?.legendLabel ?? '').trim()
    if (custom) return custom
    return String(set?.label ?? '').trim() || 'Series'
  }

  /**
   * Names/colors/styles for a structural series. Does not touch x/y data.
   * @param {import('../lib/analysisSets.js').AnalysisSet} set
   * @param {'mean' | 'upper' | 'lower' | 'extra'} role
   * @param {{ prefixSetName?: boolean, extraName?: string, type?: string }} [opts]
   */
  function structuralSeriesAppearance(set, role, opts = {}) {
    const type = opts.type ?? structuralType
    const sp = sPlots[type] || structDefaults
    const isApl = type === 'area_per_lipid'
    const legend = setLegendName(set)
    const mainColor = String(set.color || '').trim() || '#f59e0b'
    const extraName = opts.extraName || 'Series'
    const label = !isApl ? legend : role === 'extra' ? extraName : aplSeriesLabel(set, role)
    const name = isApl && opts.prefixSetName ? `${legend} · ${label}` : label
    let color = mainColor
    let strokeDasharray = ''
    let marker = 'none'
    let markerEvery = 1
    if (isApl) {
      if (role === 'mean') {
        strokeDasharray = strokeDashForStyle(sp.aplMeanLineStyle)
        marker = sp.aplMeanMarker || 'none'
        markerEvery = Math.max(1, Math.floor(Number(sp.aplMeanMarkerEvery) || 10))
      } else if (role === 'upper' || role === 'lower') {
        color = aplSeriesColor(set, role)
        strokeDasharray = strokeDashForStyle(
          role === 'upper' ? sp.aplUpperLineStyle || 'dashed' : sp.aplLowerLineStyle || 'dotted'
        )
        marker =
          role === 'upper' ? sp.aplUpperMarker || 'none' : sp.aplLowerMarker || 'none'
        markerEvery = Math.max(
          1,
          Math.floor(
            Number(role === 'upper' ? sp.aplUpperMarkerEvery : sp.aplLowerMarkerEvery) || 10
          )
        )
      } else {
        strokeDasharray = strokeDashForStyle('dashed')
        markerEvery = 10
      }
    }
    return {
      name,
      color,
      strokeDasharray,
      strokeWidth: Number(sp.lineWidth) || 2,
      marker: isApl ? marker : 'none',
      markerSize: Number(sp.aplMarkerSize) || 3,
      markerEvery: isApl ? markerEvery : 1
    }
  }

  /**
   * Update legend/colors/line styles on the live chart without cloning x/y data.
   */
  function applyChartAppearance() {
    if (mode !== 'structural') return
    const lists = [chartView.series, ...chartView.panels.map((p) => p.series)]
    if (lists.some((list) => list.some((s) => !s.setId))) {
      syncChartViewFromSets()
      return
    }
    const type = structuralType
    const visibleCount = analysisSets.filter(
      (s) => s.visible && structuralSetHasPlottableResult(s, type)
    ).length
    const prefix = visibleCount > 1 && chartView.mode !== 'grid'
    for (const series of chartView.series) {
      const set = analysisSets.find((s) => s.id === series.setId)
      if (!set) continue
      Object.assign(
        series,
        structuralSeriesAppearance(set, series.seriesRole || 'mean', {
          prefixSetName: prefix,
          extraName: series.extraName || '',
          type
        })
      )
    }
    for (const panel of chartView.panels) {
      const panelSet = analysisSets.find((s) => s.id === panel.key)
      if (panelSet) panel.title = setLegendName(panelSet)
      for (const series of panel.series) {
        const set = analysisSets.find((s) => s.id === series.setId) || panelSet
        if (!set) continue
        Object.assign(
          series,
          structuralSeriesAppearance(set, series.seriesRole || 'mean', {
            prefixSetName: false,
            extraName: series.extraName || '',
            type
          })
        )
      }
    }
  }

  /**
   * Chart/CSV series builder that does not depend on overlay derived flags.
   * Legend is the set name (customizable). Analysis type belongs in the plot title.
   * @param {import('../lib/analysisSets.js').AnalysisSet} set
   * @param {import('../lib/analysisSets.js').StructuralSetResult} res
   * @param {{ prefixSetName?: boolean }} [opts]
   */
  function buildStructuralSeries(set, res, opts = {}) {
    if (!structuralResultHasPlotData(res)) return []
    const type = res.analysisType ?? structuralType
    const sp = sPlots[type] || structDefaults
    const xUnit = sp.xUnit || 'ns'
    const yUnit = sp.yUnit || 'Å'
    const xs = res.lastAnalysisHasTimeX ? convertX(res.rawX, 'ns', xUnit) : [...(res.rawX || [])]
    const prefix = opts.prefixSetName === true
    /** @type {Array<{ name: string, x: number[], y: number[], color?: string, strokeDasharray?: string, strokeWidth?: number, marker?: string, markerSize?: number, markerEvery?: number, seriesRole?: string, setId?: string, key?: string, extraName?: string }>} */
    const out = []
    const meanY = structuralMeanY(res)
    if (meanY.length > 0) {
      out.push({
        ...structuralSeriesAppearance(set, 'mean', { prefixSetName: prefix, type }),
        x: xs,
        y: convertStructY(meanY, yUnit, type),
        seriesRole: 'mean',
        setId: set.id,
        key: `${set.id}:mean`
      })
    }
    for (const s of res.extraSeries || []) {
      if (!Array.isArray(s.rawY) || s.rawY.length === 0) continue
      const role = extraSeriesRole(s)
      out.push({
        ...structuralSeriesAppearance(set, role === 'extra' ? 'extra' : role, {
          prefixSetName: prefix,
          extraName: s.name,
          type
        }),
        x: xs,
        y: convertStructY(s.rawY, yUnit, type),
        seriesRole: role,
        extraName: s.name,
        setId: set.id,
        key: `${set.id}:${role}:${s.name || ''}`
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
      // Persist every analyzed series — property checkboxes only control plot visibility.
      const res = set.energeticResult
      const xs = res.rawX || []
      /** @type {Array<{ name: string, x: number[], y: number[] }>} */
      const out = []
      for (const s of res.rawSeries || []) {
        if (!s?.baseName || !s?.y?.length) continue
        out.push({ name: s.baseName, x: xs, y: s.y })
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
    const setIndex = Math.max(0, analysisSets.findIndex((s) => s.id === set.id))
    if (csvMode === 'energetic') {
      return csvFileNameForEnergeticSet(set, setIndex)
    }
    return csvFileNameForAnalysisSet(set, type, setIndex)
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
    sessionName = String(session.sessionName || '').trim()
    analysisSets = assignCsvStems(
      (session.sets || []).map((s) => normalizeAnalysisSetStructuralResults(s))
    )
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
    applyPlotSettingsFromSession(session.plotSettings)
    warnMissingSessionPaths(session)
    // Energetic charts read live set data; rebuild so the open energetic tab shows
    // immediately without toggling Structural → Energetic.
    if (mode === 'energetic') {
      rebuildEnergeticViewAfterLoad()
    } else {
      bumpPlotData()
    }
    logEvent('info', 'analysis', 'Loaded analysis session', sessionAnalysisLabel(session))
    showSessionActionNotice(`Loaded ${sessionAnalysisLabel(session)}`)
  }

  /** @param {import('../lib/analysisSession.js').AnalysisSessionV1} session */
  function sessionAnalysisLabel(session) {
    const identity = formatAnalysisSessionIdentity(session)
    const date = session.savedAt ? new Date(session.savedAt).toLocaleString() : ''
    return `${identity} · ${session.mode} · ${session.sets.length} set(s)${date ? ` · ${date}` : ''}`
  }

  /**
   * @param {{ session_path: string, output_dir?: string, name: string, folder_name?: string, session_name?: string, mode: string, set_count: number, analysis_summary: string }} session
   */
  function formatSavedSessionOption(session) {
    const identity = formatAnalysisSessionIdentity({
      sessionName: session.session_name,
      folder_name: session.folder_name || session.name
    })
    const where = compactDirPath(session.output_dir || '', workingDir || outputParentDir)
    return where
      ? `${identity} · ${where} · ${session.mode} · ${session.set_count} set(s) · ${session.analysis_summary}`
      : `${identity} · ${session.mode} · ${session.set_count} set(s) · ${session.analysis_summary}`
  }

  const currentSessionIdentity = $derived(
    formatAnalysisSessionIdentity({
      sessionName,
      outputFolderName: outputFolderName || defaultAnalysisFolderName(topologyPath)
    })
  )

  const selectedSavedSession = $derived(
    savedSessions.find((s) => s.session_path === selectedSessionPath) ?? null
  )

  /** Point output path + folder name at the directory that holds this session file. */
  function applyOutputLocationFromSessionDir(sessionDir) {
    const folder = dirBasename(sessionDir)
    const parent = parentDirPath(sessionDir)
    if (folder) outputFolderName = folder
    if (parent) outputParentDir = parent
  }

  async function loadSelectedSavedSession() {
    if (!selectedSessionPath) return
    await requestLoadAnalysisSession(selectedSessionPath)
  }

  const sessionBusy = $derived(savingSession || loadingSession)

  function sessionHasLoadedPlots() {
    return (
      setsHavePlottableResults(analysisSets, mode) ||
      setsHavePlottableResults(analysisSets, 'energetic')
    )
  }

  /** Ask before replacing an open session; never use window.confirm (GTK crash on WSL). */
  async function requestLoadAnalysisSession(sessionPath) {
    if (!sessionPath) return
    if (sessionHasLoadedPlots()) {
      pendingReplaceSessionPath = sessionPath
      return
    }
    await loadAnalysisSessionFromPath(sessionPath)
  }

  function cancelReplaceSession() {
    pendingReplaceSessionPath = ''
  }

  function confirmReplaceSession() {
    const path = pendingReplaceSessionPath
    pendingReplaceSessionPath = ''
    if (path) void loadAnalysisSessionFromPath(path)
  }

  /** @param {string} sessionPath */
  async function loadAnalysisSessionFromPath(sessionPath) {
    loadingSession = true
    showSessionActionNotice('Loading session…', { kind: 'info', markClean: false })
    const gen = ++plotViewBusyGeneration
    plotViewBusyLabel = 'Loading session…'
    plotViewBusy = true
    try {
      await tick()
      const raw = await window.api.readJson(sessionPath)
      let session = deserializeAnalysisSession(raw)
      const sessionDir = sessionPath.replace(/\\/g, '/').replace(/\/[^/]+$/, '')
      // Only this session’s folder. The previous outputDir often still points at the
      // last job (e.g. OpenMM v2_confs) and would mix CSVs.
      session = await hydrateAnalysisSessionFromCsv(session, sessionDir, async (path) => {
        try {
          return await window.api.readText(path)
        } catch (err) {
          logEvent('warn', 'analysis', 'Failed to read analysis CSV', `${path}: ${err}`)
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
      applyOutputLocationFromSessionDir(sessionDir)
      if (!hydratedAny) {
        await hydratePlotDataFromOutputFolder([sessionDir])
      }
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
          analysisSets = analysisSets.map((s) => ({ ...s }))
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
          analysisSets = analysisSets.map((s) => ({ ...s }))
          await tick()
          bumpPlotData()
        }
      }
      suppressSessionDirty = true
      try {
        persistActiveSetFields()
        rememberSessionSaveFingerprint()
      } finally {
        suppressSessionDirty = false
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      logEvent('error', 'analysis', 'Failed to load analysis session', lastError)
      if (sessionActionNotice === 'Loading session…') sessionActionNotice = ''
    } finally {
      loadingSession = false
      if (gen === plotViewBusyGeneration) plotViewBusy = false
    }
  }

  async function browseAnalysisSessionFile() {
    const result = await window.api.openFileDialog(
      'Open Analysis Session',
      [{ name: 'Analysis session', extensions: ['json'] }],
      workingDir || outputParentDir || outputDir || undefined
    )
    if (result.canceled || !result.filePath) return
    await requestLoadAnalysisSession(result.filePath)
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
    /** When false, title follows the analysis type. Empty + customized hides the title. */
    titleCustomized: false,
    xLabel: '',
    yLabel: '',
    lineColor: '#f59e0b',
    lineWidth: '2',
    plotBg: '',
    textColor: '',
    plotBgCustomized: false,
    textColorCustomized: false,
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
    legendSwatchSize: '12',
    legendFontSize: '10',
    axisFontSize: '12',
    titleFontSize: '13',
    xTickCount: '5',
    yTickCount: '5',
    /** Empty = auto tick decimals; 0–8 = fixed places on axis ticks */
    xTickDecimals: '',
    yTickDecimals: '',
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
    plotBg: '',
    textColor: '',
    plotBgCustomized: false,
    textColorCustomized: false,
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
    xTickDecimals: '',
    yTickDecimals: '',
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
    legendSwatchSize: '12',
    legendFontSize: '10',
    axisFontSize: '12',
    titleFontSize: '13',
    xTickCount: '5',
    yTickCount: '5',
    xTickDecimals: '',
    yTickDecimals: '',
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
  function formatSelectionSubtitle(
    type,
    sel,
    sel2,
    leafletLipid,
    leafletFilter,
    exclude = '',
    method = ''
  ) {
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
      if (type === 'area_per_lipid') {
        const methodId = normalizeAplMethod(method)
        parts.push(aplMethodLabel(methodId).replace(/\s*\(default\)$/i, ''))
        if (methodId !== 'lipyphilic' && (exclude || '').trim()) {
          parts.push(`exclude: ${exclude.trim()}`)
        }
      }
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
  const resolvedStructColors = $derived(resolvePlotColors(ps, themeState.current))
  const resolvedEnergColors = $derived(resolvePlotColors(ePlotGlobal, themeState.current))
  const displayPlotBg = $derived(
    mode === 'structural' ? resolvedStructColors.plotBg : resolvedEnergColors.plotBg
  )
  const displayTextColor = $derived(
    mode === 'structural' ? resolvedStructColors.textColor : resolvedEnergColors.textColor
  )
  const activeAnalysisSet = $derived(
    analysisSets.find((s) => s.id === activeSetId) ?? analysisSets[0] ?? null
  )
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

  const isBilayerType = (type) => isBilayerStructuralType(type)

  /** Warning when bilayer analyses use a protein-like selection. */
  const bilayerSelectionWarning = $derived.by(() => {
    if (!isBilayerType(structuralType)) return ''
    const sel = selection.trim()
    if (!sel) return ''
    if (looksLikeProteinSelection(sel)) {
      return 'This selection looks like protein/backbone. Area per lipid and membrane thickness need lipid headgroup atoms (e.g. phosphates), not protein.'
    }
    if (!looksLikeBilayerHeadgroupSelection(sel) && lipidHeadgroupAtoms.length === 0) {
      return 'Selection may not be lipid headgroups. Prefer detected phosphate/headgroup atom names for reliable bilayer analysis.'
    }
    return ''
  })

  function clearSessionActionNoticeTimer() {
    if (sessionActionNoticeTimer != null) {
      clearTimeout(sessionActionNoticeTimer)
      sessionActionNoticeTimer = null
    }
  }

  /**
   * Stable summary of session content for “already saved?” checks.
   * Uses shapes/lengths rather than full plot arrays.
   */
  function computeSessionFingerprint() {
    return JSON.stringify({
      mode,
      sessionName: sessionName.trim(),
      outputFolderName: resolveOutputFolderName(),
      activeSetId,
      compareLayout,
      energeticCompareLayout,
      structuralType,
      selection,
      selection2,
      selectedProperties,
      availableProperties,
      plotSettings: {
        structural: Object.fromEntries(
          Object.entries(sPlots).map(([k, v]) => [
            k,
            {
              plotBg: v.plotBg || '',
              textColor: v.textColor || '',
              plotBgCustomized: Boolean(v.plotBgCustomized),
              textColorCustomized: Boolean(v.textColorCustomized)
            }
          ])
        ),
        energetic: {
          plotBg: ePlotGlobal.plotBg || '',
          textColor: ePlotGlobal.textColor || '',
          plotBgCustomized: Boolean(ePlotGlobal.plotBgCustomized),
          textColorCustomized: Boolean(ePlotGlobal.textColorCustomized)
        }
      },
      sets: analysisSets.map((s) => {
        const normalized = normalizeAnalysisSetStructuralResults(s)
        const types = getSetStructuralResultTypes(normalized)
        return {
          id: s.id,
          label: s.label,
          legendLabel: s.legendLabel || '',
          visible: s.visible,
          color: s.color,
          aplMeanLabel: s.aplMeanLabel || '',
          aplUpperLabel: s.aplUpperLabel || '',
          aplLowerLabel: s.aplLowerLabel || '',
          aplUpperColor: s.aplUpperColor || '',
          aplLowerColor: s.aplLowerColor || '',
          topologyPath: s.topologyPath,
          trajectoryFiles: s.trajectoryFiles,
          structuralOptions: s.structuralOptions,
          energeticOptions: s.energeticOptions,
          structTypes: types,
          structPoints: Object.fromEntries(
            types.map((t) => {
              const r = getSetStructuralResult(normalized, t)
              return [t, r?.rawX?.length ?? 0]
            })
          ),
          energeticProps: (s.energeticResult?.rawSeries || []).map((r) => ({
            name: r.baseName,
            n: r.y?.length ?? 0
          })),
          energeticSelected: s.energeticResult?.selectedProperties ?? [],
          energeticPoints: s.energeticResult?.rawX?.length ?? 0
        }
      })
    })
  }

  function rememberSessionSaveFingerprint() {
    lastSavedSessionFingerprint = computeSessionFingerprint()
    sessionSavedClean = true
  }

  function isSessionSaveUpToDate() {
    if (!lastSavedSessionFingerprint) return false
    try {
      return lastSavedSessionFingerprint === computeSessionFingerprint()
    } catch {
      return false
    }
  }

  function markSessionDirty() {
    if (suppressSessionDirty) return
    if (!sessionActionNotice && !sessionSavedClean && !lastSavedSessionFingerprint) return
    // A successful save is followed by UI flushes (folder name sync, persist).
    // Those must not wipe the confirmation or the fingerprint-based "already saved" state.
    if (lastSavedSessionFingerprint && isSessionSaveUpToDate()) return
    // Do not dismiss the transient “already saved” toast while its timer is running.
    const keepingAlreadySavedToast =
      sessionActionNoticeTimer != null &&
      sessionActionNotice.startsWith('Latest changes are already saved')
    if (!keepingAlreadySavedToast) {
      clearSessionActionNoticeTimer()
      sessionActionNotice = ''
    }
    sessionSavedClean = false
  }

  /** Snapshot of the UI fields that belong to the current structural type. */
  function snapshotCurrentTypeSelection() {
    return {
      selection,
      selection2,
      referenceFrame,
      align,
      rmsfXaxisType,
      leafletLipidSel,
      leafletFilterSel,
      nBins,
      interpolate,
      excludeSel,
      excludeCutoff,
      aplMethod,
      gridmatN,
      gridmatPrecision,
      vtmcNSamples,
      vtmcProteinRadius,
      lipidHeadgroupAtoms: lipidHeadgroupAtoms.map((a) => ({ ...a }))
    }
  }

  /**
   * Apply a per-type selection snapshot to page UI state.
   * @param {import('../lib/analysisSets.js').StructuralTypeSelection} snap
   * @param {string} type
   */
  function applyTypeSelectionSnapshot(snap, type) {
    const defaults = defaultSelectionForStructuralType(type)
    selection = snap.selection ?? defaults.selection
    selection2 = snap.selection2 ?? defaults.selection2
    if (snap.referenceFrame != null) referenceFrame = String(snap.referenceFrame)
    if (snap.align != null) align = Boolean(snap.align)
    if (snap.rmsfXaxisType != null) rmsfXaxisType = snap.rmsfXaxisType
    leafletLipidSel = snap.leafletLipidSel ?? ''
    leafletFilterSel = snap.leafletFilterSel ?? ''
    if (snap.nBins != null) nBins = String(snap.nBins)
    if (snap.interpolate != null) interpolate = Boolean(snap.interpolate)
    excludeSel = snap.excludeSel ?? 'protein'
    excludeCutoff = snap.excludeCutoff != null ? String(snap.excludeCutoff) : '30'
    aplMethod = normalizeAplMethod(snap.aplMethod)
    gridmatN = snap.gridmatN != null ? String(snap.gridmatN) : APL_METHOD_DEFAULTS.gridmatN
    gridmatPrecision =
      snap.gridmatPrecision != null ? String(snap.gridmatPrecision) : APL_METHOD_DEFAULTS.gridmatPrecision
    vtmcNSamples =
      snap.vtmcNSamples != null ? String(snap.vtmcNSamples) : APL_METHOD_DEFAULTS.vtmcNSamples
    vtmcProteinRadius =
      snap.vtmcProteinRadius != null
        ? String(snap.vtmcProteinRadius)
        : APL_METHOD_DEFAULTS.vtmcProteinRadius
    lipidHeadgroupAtoms = Array.isArray(snap.lipidHeadgroupAtoms)
      ? snap.lipidHeadgroupAtoms.map((a) => ({ ...a }))
      : []
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
   * Uses the Properties checkboxes (selectedProperties) only — empty means hide all plots.
   * In compare mode, restricted to props that exist in every visible set's result data.
   */
  const compareEnergeticProperties = $derived.by(() => {
    if (mode !== 'energetic') return selectedProperties
    // Unchecking every property must clear the chart (no fallback to all props).
    if (selectedProperties.length === 0) return []
    if (energeticMultiSetSession && visibleCompareSets.length === 0) return []
    if (!energeticMultiSetSession) return selectedProperties
    // Keep props that exist on every currently visible set.
    return selectedProperties.filter((prop) =>
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
    const visibleCount = analysisSets.filter(
      (s) => s.visible && structuralSetHasPlottableResult(s, structuralType)
    ).length
    return buildStructuralSeries(set, res, {
      prefixSetName: visibleCount > 1
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
    // Display conversion always follows live sidebar unit prefs (not stale per-set options).
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
      const xs = convertX(xSample, res.rawXTimeUnit, timeUnits)
      const ys = convertEnergeticYArr(ySample, s.unit)
      const tUnit = getTargetUnit(s.unit)
      const propLabel = tUnit ? `${prop} (${tUnit})` : prop
      const setName = setLegendName(set)
      const name =
        nameMode === 'set'
          ? setName
          : nameMode === 'set_prop'
            ? `${setName} · ${propLabel}`
            : propLabel
      out.push({
        name,
        baseName: prop,
        propLabel,
        x: xs,
        y: ys,
        key: `${set.id}:${prop}`,
        setId: set.id,
        color: colorBySet ? set.color : ePlotPanels[s.baseName]?.lineColor || set.color
      })
    }
    return out
  }

  /** @param {object} s @param {import('../lib/analysisSets.js').AnalysisSet | undefined} set @param {'set' | 'prop' | 'set_prop'} nameMode */
  function energeticSeriesAppearance(s, set, nameMode) {
    const setName = set ? setLegendName(set) : 'Series'
    const propLabel = s.propLabel || s.baseName || 'Series'
    const name =
      nameMode === 'set' ? setName : nameMode === 'set_prop' ? `${setName} · ${propLabel}` : propLabel
    const colorBySet = energeticMultiSetSession && energeticCompareLayout !== 'by_set'
    const color = colorBySet
      ? set?.color
      : ePlotPanels[s.baseName]?.lineColor || set?.color
    return { name, color: color || '#f59e0b' }
  }

  function energeticNameMode() {
    if (!energeticMultiSetSession) return 'prop'
    if (energeticCompareLayout === 'by_property') return 'set'
    if (energeticCompareLayout === 'by_set') return 'prop'
    return 'set_prop'
  }

  /** Heavy downsample/unit conversion for energetic plots. Call on data/unit/visibility changes only. */
  function syncEnergeticGeom() {
    if (mode !== 'energetic') {
      energeticGeom = []
      return
    }
    if (selectedProperties.length === 0 || compareEnergeticProperties.length === 0) {
      energeticGeom = []
      return
    }
    if (energeticMultiSetSession) {
      const visible = analysisSets.filter((s) => s.visible && s.energeticResult)
      energeticGeom = visible.flatMap((set) =>
        seriesFromEnergeticSet(set, compareEnergeticProperties, {
          maxPoints: DEFAULT_CHART_MAX_POINTS,
          colorBySet: false,
          nameMode: 'prop'
        })
      )
      return
    }
    const activeSet = analysisSets.find((s) => s.id === activeSetId)
    if (activeSet && energeticResultHasPlotData(activeSet.energeticResult)) {
      energeticGeom = seriesFromEnergeticSet(activeSet, compareEnergeticProperties, {
        maxPoints: DEFAULT_CHART_MAX_POINTS,
        colorBySet: false,
        nameMode: 'prop'
      })
      return
    }
    if (rawSeries.length === 0) {
      energeticGeom = []
      return
    }
    const visible = rawSeries.filter((s) => selectedProperties.includes(s.baseName))
    energeticGeom = visible.map((s) => {
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
        key: s.key || `${activeSetId}:${s.baseName}`,
        setId: activeSetId,
        baseName: s.baseName
      }
    })
  }

  /** Default Y-axis label for a property (name + units), never includes set label. */
  function energeticPropYLabel(baseName) {
    if (!baseName) return 'Value'
    for (const set of visibleCompareSets.length ? visibleCompareSets : analysisSets) {
      const s = set.energeticResult?.rawSeries?.find((r) => r.baseName === baseName)
      if (!s) continue
      const tUnit = getTargetUnit(s.unit)
      return tUnit ? `${baseName} (${tUnit})` : baseName
    }
    const local = rawSeries.find((r) => r.baseName === baseName)
    if (local) {
      const tUnit = getTargetUnit(local.unit)
      return tUnit ? `${baseName} (${tUnit})` : baseName
    }
    return baseName
  }

  /** Persist current energetic unit prefs onto every set so sessions stay aligned with the sidebar. */
  function syncEnergeticUnitPrefsToAllSets() {
    const units = {
      timeUnits,
      energyUnits,
      pressureUnits,
      temperatureUnits,
      volumeUnits
    }
    analysisSets = analysisSets.map((s) => ({
      ...s,
      energeticOptions: { ...s.energeticOptions, ...units }
    }))
  }

  function onEnergeticUnitChange() {
    syncEnergeticUnitPrefsToAllSets()
    persistActiveSetFields()
    bumpPlotData()
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
    if (mode === 'structural') {
      return chartView.series
    }
    const nameMode = energeticNameMode()
    return energeticGeom.map((s) => {
      const set = analysisSets.find((x) => x.id === s.setId)
      return { ...s, ...energeticSeriesAppearance(s, set, nameMode) }
    })
  })

  /**
   * Series used for the stats table — always mirrors what is currently plotted,
   * with unambiguous labels (set · property) so unchecking sets/props updates rows.
   */
  const statsSourceSeries = $derived.by(() => {
    if (mode === 'structural') return displaySeries
    return energeticGeom.map((s) => {
      const set = analysisSets.find((x) => x.id === s.setId)
      const appearance = energeticSeriesAppearance(
        s,
        set,
        energeticMultiSetSession ? 'set_prop' : 'prop'
      )
      return { ...s, ...appearance }
    })
  })

  const chartStatsRows = $derived.by(() => {
    if (statsSourceSeries.length === 0) return []
    const t0 = statsRange ? Math.min(statsRange.t0, statsRange.t1) : null
    const t1 = statsRange ? Math.max(statsRange.t0, statsRange.t1) : null
    return statsSourceSeries.map((s, i) => {
      // Always compute from converted display series so stats match selected units.
      const stats =
        t0 != null && t1 != null && hasChartTimeAxis
          ? computeSeriesStats(s, t0, t1)
          : computeSeriesStats(s)
      return {
        id: `${s.baseName || s.key || s.name || 'series'}-${i}`,
        name: s.name,
        color: s.color || '#f59e0b',
        stats
      }
    })
  })

  const energeticPanels = $derived.by(() => {
    if (mode !== 'energetic') return []
    // Multi-set session: panels always follow checked (visible) sets only.
    if (energeticMultiSetSession) {
      if (displaySeries.length === 0) return []
      if (energeticCompareLayout === 'overlay') {
        return [{ key: '__compare__', title: displayTitle || chartTitle, series: displaySeries }]
      }
      if (energeticCompareLayout === 'by_set') {
        return visibleCompareSets
          .map((set) => ({
            key: set.id,
            title: set.label,
            series: displaySeries.filter((s) => s.setId === set.id)
          }))
          .filter((p) => p.series.length > 0)
      }
      // by_property (default): one panel per property; each visible set keeps its own color
      return compareEnergeticProperties
        .map((prop) => ({
          key: prop,
          title: prop,
          series: displaySeries.filter((s) => s.baseName === prop)
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
    const active = analysisSets.find((s) => s.id === activeSetId)
    const selectionsByType = {
      ...(active?.structuralOptions?.selectionsByType || {})
    }
    selectionsByType[structuralType] = snapshotCurrentTypeSelection()
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
      interpolate,
      excludeSel,
      excludeCutoff,
      aplMethod,
      gridmatN,
      gridmatPrecision,
      vtmcNSamples,
      vtmcProteinRadius,
      selectionsByType
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
    const type = opts.structuralType || 'rmsd'
    structuralType = type
    const snap = resolveStructuralTypeSelection(opts, type)
    applyTypeSelectionSnapshot(snap, type)
    // Prefer explicit flat fields when they match the active type and are usable
    // (keeps session loads / persist round-trips exact).
    if (opts.structuralType === type && typeof opts.selection === 'string') {
      const flatOk =
        !isBilayerType(type) ||
        (!looksLikeProteinSelection(opts.selection) && Boolean(opts.selection.trim()))
      if (flatOk) {
        selection = opts.selection
        selection2 = opts.selection2
        referenceFrame = opts.referenceFrame
        align = opts.align
        rmsfXaxisType = opts.rmsfXaxisType
        leafletLipidSel = opts.leafletLipidSel
        leafletFilterSel = opts.leafletFilterSel
        nBins = opts.nBins
        interpolate = opts.interpolate
        excludeSel = opts.excludeSel ?? 'protein'
        excludeCutoff = opts.excludeCutoff != null ? String(opts.excludeCutoff) : '30'
        aplMethod = normalizeAplMethod(opts.aplMethod)
        gridmatN = opts.gridmatN != null ? String(opts.gridmatN) : APL_METHOD_DEFAULTS.gridmatN
        gridmatPrecision =
          opts.gridmatPrecision != null
            ? String(opts.gridmatPrecision)
            : APL_METHOD_DEFAULTS.gridmatPrecision
        vtmcNSamples =
          opts.vtmcNSamples != null ? String(opts.vtmcNSamples) : APL_METHOD_DEFAULTS.vtmcNSamples
        vtmcProteinRadius =
          opts.vtmcProteinRadius != null
            ? String(opts.vtmcProteinRadius)
            : APL_METHOD_DEFAULTS.vtmcProteinRadius
      }
    }
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
    // All series names stay available for checkboxes; selectedProperties is visibility only.
    const allNames = rawSeries.map((s) => s.baseName).filter(Boolean)
    if (allNames.length) {
      availableProperties = [...new Set([...availableProperties, ...allNames])]
    }
    const fromResult = res.selectedProperties?.length
      ? [...res.selectedProperties]
      : allNames
    if (fromResult.length && selectedProperties.length === 0) {
      selectedProperties = fromResult
    }
    for (const p of selectedProperties) ensureEPlotPanel(p)
    const first = rawSeries?.[0]?.key ?? res.selectedProperties?.[0]
    primaryStats = first && res.statistics ? res.statistics[first] || null : null
    if (mode === 'energetic') syncEnergeticGeom()
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
    // All analyzed series stay listed; selectedProperties restores visibility from the session.
    const allSeriesProps = [
      ...new Set(
        analysisSets.flatMap((s) =>
          (s.energeticResult?.rawSeries || []).map((r) => r.baseName).filter(Boolean)
        )
      )
    ]
    const fromOptions = [
      ...new Set(
        analysisSets.flatMap((s) => s.energeticOptions?.availableProperties || [])
      )
    ]
    availableProperties = [...new Set([...fromOptions, ...allSeriesProps, ...availableProperties])]
    const savedVisible = [
      ...new Set(
        analysisSets.flatMap((s) => {
          const res = s.energeticResult
          if (!res) return []
          if (res.selectedProperties?.length) return res.selectedProperties
          return (res.rawSeries || []).map((r) => r.baseName).filter(Boolean)
        })
      )
    ]
    if (savedVisible.length) {
      selectedProperties = savedVisible.filter(
        (p) =>
          !availableProperties.length ||
          availableProperties.includes(p) ||
          allSeriesProps.includes(p)
      )
      if (selectedProperties.length === 0) selectedProperties = [...savedVisible]
    } else if (allSeriesProps.length && selectedProperties.length === 0) {
      selectedProperties = [...allSeriesProps]
    }
    applyEnergeticResultToView(set.energeticResult)
    for (const p of selectedProperties) ensureEPlotPanel(p)
    focusedPanelKey = selectedProperties[0] ?? focusedPanelKey
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
    suppressSessionDirty = true
    try {
      topologyPath = set.topologyPath
      trajectoryFiles = [...set.trajectoryFiles]
      applyStructuralOptions(set.structuralOptions)
      applyEnergeticOptions(set.energeticOptions)
      // outputFolderName is session-level — never reset when switching/adding sets
      headgroupDetectAttempted = lipidHeadgroupAtoms.length > 0
      if (set.structuralResult || set.structuralResults) {
        rebuildStructResultsFromSets()
      }
      if (mode === 'energetic') {
        applyEnergeticResultToView(set.energeticResult)
      }
    } finally {
      suppressSessionDirty = false
    }
  }

  function updateSetLabel(id, label) {
    markSessionDirty()
    analysisSets = analysisSets.map((s) => (s.id === id ? { ...s, label } : s))
    applyChartAppearance()
  }

  function updateSetLegend(id, legendLabel) {
    markSessionDirty()
    analysisSets = analysisSets.map((s) => (s.id === id ? { ...s, legendLabel } : s))
    applyChartAppearance()
  }

  /**
   * @param {string} id
   * @param {Record<string, string>} patch
   */
  function patchAnalysisSet(id, patch) {
    markSessionDirty()
    analysisSets = analysisSets.map((s) => (s.id === id ? { ...s, ...patch } : s))
    applyChartAppearance()
  }

  function patchStructuralPlot(patch) {
    const type = structuralType
    sPlots = { ...sPlots, [type]: { ...sPlots[type], ...patch } }
  }

  function setStructuralPlotBg(hex) {
    const raw = String(hex || '').trim()
    markSessionDirty()
    if (!raw) {
      patchStructuralPlot({ plotBg: '', plotBgCustomized: false })
      return
    }
    patchStructuralPlot({
      plotBg: normalizeHexColor(raw, raw),
      plotBgCustomized: true
    })
  }

  function setStructuralTextColor(hex) {
    const raw = String(hex || '').trim()
    markSessionDirty()
    if (!raw) {
      patchStructuralPlot({ textColor: '', textColorCustomized: false })
      return
    }
    patchStructuralPlot({
      textColor: normalizeHexColor(raw, raw),
      textColorCustomized: true
    })
  }

  function clearStructuralPlotBgCustom() {
    markSessionDirty()
    patchStructuralPlot({ plotBg: '', plotBgCustomized: false })
  }

  function clearStructuralTextColorCustom() {
    markSessionDirty()
    patchStructuralPlot({ textColor: '', textColorCustomized: false })
  }

  function applyStructuralPlotColorsToAllTypes() {
    markSessionDirty()
    const colors = {
      plotBg: ps.plotBgCustomized ? ps.plotBg : '',
      textColor: ps.textColorCustomized ? ps.textColor : '',
      plotBgCustomized: Boolean(ps.plotBgCustomized),
      textColorCustomized: Boolean(ps.textColorCustomized)
    }
    sPlots = Object.fromEntries(
      Object.entries(sPlots).map(([k, v]) => [k, { ...v, ...colors }])
    )
  }

  function setEnergeticPlotBg(hex) {
    const raw = String(hex || '').trim()
    markSessionDirty()
    if (!raw) {
      ePlotGlobal = { ...ePlotGlobal, plotBg: '', plotBgCustomized: false }
      return
    }
    ePlotGlobal = {
      ...ePlotGlobal,
      plotBg: normalizeHexColor(raw, raw),
      plotBgCustomized: true
    }
  }

  function setEnergeticTextColor(hex) {
    const raw = String(hex || '').trim()
    markSessionDirty()
    if (!raw) {
      ePlotGlobal = { ...ePlotGlobal, textColor: '', textColorCustomized: false }
      return
    }
    ePlotGlobal = {
      ...ePlotGlobal,
      textColor: normalizeHexColor(raw, raw),
      textColorCustomized: true
    }
  }

  function emptyStructuralPlots() {
    return {
      rmsd: { ...structDefaults },
      rmsf: { ...structDefaults },
      distance: { ...structDefaults },
      radius_of_gyration: { ...structDefaults },
      area_per_lipid: { ...structDefaults, yUnit: 'Å²' },
      membrane_thickness: { ...structDefaults }
    }
  }

  /** @param {import('../lib/analysisSession.js').AnalysisSessionV1['plotSettings']} plotSettings */
  function applyPlotSettingsFromSession(plotSettings) {
    sPlots = emptyStructuralPlots()
    ePlotGlobal = { ...energGlobalDefaults, ...energPanelShell }
    ePlotPanels = {}
    if (!plotSettings || typeof plotSettings !== 'object') return
    if (plotSettings.structural && typeof plotSettings.structural === 'object') {
      const next = emptyStructuralPlots()
      for (const type of Object.keys(next)) {
        next[type] = hydratePlotColorFlags({
          ...next[type],
          ...(plotSettings.structural[type] || {})
        })
      }
      sPlots = next
    }
    if (plotSettings.energeticGlobal && typeof plotSettings.energeticGlobal === 'object') {
      ePlotGlobal = hydratePlotColorFlags({
        ...energGlobalDefaults,
        ...energPanelShell,
        ...plotSettings.energeticGlobal
      })
    }
    if (plotSettings.energeticPanels && typeof plotSettings.energeticPanels === 'object') {
      ePlotPanels = clonePlainAnalysisData(plotSettings.energeticPanels)
    }
  }

  function restoreAutoStructuralTitle() {
    patchStructuralPlot({ title: '', titleCustomized: false })
  }

  // Clear "session saved" notice once the user edits analysis inputs again.
  // Do not track analysisSets here — post-save CSV hydrate reassigns sets and would
  // clear the notice immediately.
  $effect(() => {
    void selection
    void selection2
    void structuralType
    void topologyPath
    void trajectoryFiles
    void mode
    void referenceFrame
    void align
    void rmsfXaxisType
    void leafletLipidSel
    void leafletFilterSel
    void nBins
    void excludeSel
    void excludeCutoff
    void aplMethod
    void gridmatN
    void gridmatPrecision
    void vtmcNSamples
    void vtmcProteinRadius
    void interpolate
    void lipidHeadgroupAtoms
    void energeticEngine
    void logFiles
    void selectedProperties
    void sessionName
    void outputFolderName
    markSessionDirty()
  })

  async function onModeChange(/** @type {'structural' | 'energetic'} */ next) {
    if (next === mode) return
    clearAnalysisActionNotice()
    lastError = ''
    await withPlotViewBusy(
      next === 'energetic' ? 'Switching to energetic…' : 'Switching to structural…',
      async () => {
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
    )
  }

  function selectAnalysisSet(id) {
    if (id === activeSetId) return
    persistActiveSetFields()
    activeSetId = id
    loadActiveSetFields()
  }

  function addAnalysisSet() {
    persistActiveSetFields()
    markSessionDirty()
    const id = newSetId()
    analysisSets = [...analysisSets, createAnalysisSet(analysisSets.length, id, analysisSets)]
    activeSetId = id
    loadActiveSetFields()
  }

  function duplicateActiveSet() {
    persistActiveSetFields()
    markSessionDirty()
    const current = analysisSets.find((s) => s.id === activeSetId)
    if (!current) return
    const copy = duplicateAnalysisSet(current, analysisSets.length, analysisSets)
    analysisSets = [...analysisSets, copy]
    activeSetId = copy.id
    loadActiveSetFields()
  }

  function removeAnalysisSet(id) {
    if (analysisSets.length <= 1) return
    markSessionDirty()
    analysisSets = analysisSets.filter((s) => s.id !== id)
    if (activeSetId === id) {
      activeSetId = analysisSets[0].id
      loadActiveSetFields()
    }
  }

  function toggleSetVisible(id, visible) {
    void withPlotViewBusy(visible ? 'Showing set…' : 'Hiding set…', async () => {
      analysisSets = analysisSets.map((s) => (s.id === id ? { ...s, visible } : s))
      bumpPlotData()
    })
  }

  /** @param {'overlay' | 'grid'} layout */
  function setCompareLayout(layout) {
    void withPlotViewBusy('Updating layout…', async () => {
      compareLayout = layout === 'grid' ? 'grid' : 'overlay'
      bumpPlotData()
    })
  }

  /** @param {import('../lib/analysisSession.js').EnergeticCompareLayout | string} layout */
  function setEnergeticCompareLayout(layout) {
    void withPlotViewBusy('Updating layout…', async () => {
      energeticCompareLayout = normalizeEnergeticCompareLayout(layout)
      bumpPlotData()
    })
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
    const setIndex = Math.max(0, analysisSets.findIndex((s) => s.id === activeSetId))
    const withCsv = {
      ...resultPayload,
      dataCsv:
        resultPayload.dataCsv || csvFileNameForEnergeticSet(set || { csvStem: 'set1' }, setIndex)
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
      await ensureBilayerSelectionReady()
    }

    const result = await runStructuralAnalysis(
      {
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
        interpolate,
        excludeSel:
          structuralType === 'area_per_lipid' && aplMethod !== 'lipyphilic'
            ? excludeSel.trim() || null
            : null,
        excludeCutoff:
          structuralType === 'area_per_lipid'
            ? Math.max(0, Number(excludeCutoff) || 0)
            : undefined,
        aplMethod: structuralType === 'area_per_lipid' ? aplMethod : undefined,
        gridmatN:
          structuralType === 'area_per_lipid'
            ? Math.max(2, Number(gridmatN) || 20)
            : undefined,
        gridmatPrecision:
          structuralType === 'area_per_lipid'
            ? Math.max(0.1, Number(gridmatPrecision) || 13)
            : undefined,
        vtmcNSamples:
          structuralType === 'area_per_lipid'
            ? Math.max(1000, Number(vtmcNSamples) || 50_000)
            : undefined,
        vtmcProteinRadius:
          structuralType === 'area_per_lipid'
            ? Math.max(0.1, Number(vtmcProteinRadius) || 1.7)
            : undefined,
      },
      analysisRunOpts()
    )

    const xLabelsResult = result.x_labels || []
    const extraSeries =
      structuralType === 'area_per_lipid'
        ? [
            { name: 'Upper leaflet', role: 'upper', rawY: result.mean_upper_leaflet || [] },
            { name: 'Lower leaflet', role: 'lower', rawY: result.mean_lower_leaflet || [] }
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
        leafletFilterSel,
        excludeSel,
        aplMethod
      ),
      lastAnalysisHasTimeX: xLabelsResult.length === 0
    })
  }

  async function runEnergeticForActiveSet() {
    const setLabel = analysisSets.find((s) => s.id === activeSetId)?.label ?? 'Set'
    if (logFiles.length === 0) throw new Error(`Set "${setLabel}": add at least one log file.`)
    // Analyze every detected property so CSV/session keep full data; checkboxes only control plots.
    const propsToAnalyze =
      availableProperties.length > 0 ? [...availableProperties] : [...selectedProperties]
    if (propsToAnalyze.length === 0) {
      throw new Error(
        `Set "${setLabel}": detect properties first (or select at least one property).`
      )
    }
    if (selectedProperties.length === 0) {
      selectedProperties = [...propsToAnalyze]
    }

    const result = await runEnergeticAnalysis(
      {
        logPaths: logFiles.map((f) => f.path),
        properties: propsToAnalyze,
        fileTimes: makeFileTimes(logFiles),
        fileStrides: makeFileStrides(logFiles),
        timeUnits,
        energyUnits,
        pressureUnits,
        temperatureUnits,
        volumeUnits,
        engine: energeticEngine
      },
      analysisRunOpts()
    )

    const engineLabels = { namd: 'NAMD', openmm: 'OpenMM', gromacs: 'GROMACS', amber: 'Amber' }
    const rawSeriesLocal = (result.series || []).map((s) => ({
      baseName: s.name,
      unit: s.unit || '',
      y: s.y || [],
      key: s.key
    }))
    const analyzedNames = rawSeriesLocal.map((s) => s.baseName).filter(Boolean)
    availableProperties = [...new Set([...availableProperties, ...analyzedNames])]
    // Keep visibility selection; drop names that were not returned.
    selectedProperties = selectedProperties.filter((p) => analyzedNames.includes(p))
    if (selectedProperties.length === 0) selectedProperties = [...analyzedNames]

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

  function energeticPlotPanelSettingsKey(panel) {
    if (panel.key === '__compare__' || panel.key === '__overlay__') {
      return focusedPanelKey || selectedProperties[0] || panel.key
    }
    const propKey =
      panel.series?.[0]?.baseName ||
      (selectedProperties.includes(panel.key) ? panel.key : focusedPanelKey || selectedProperties[0] || '')
    return energeticCompareLayout === 'by_property' ? panel.key : propKey || panel.key
  }

  function resolveEnergeticPanelPset(panel) {
    const pk = energeticPlotPanelSettingsKey(panel)
    const pset = ePlotPanels[pk] ?? defaultPanelSettings()
    const propKey =
      panel.series?.[0]?.baseName ||
      (selectedProperties.includes(panel.key) ? panel.key : focusedPanelKey || selectedProperties[0] || '')
    const propPset = propKey ? ePlotPanels[propKey] ?? defaultPanelSettings() : pset
    return { pk, pset, propPset, propKey }
  }

  function energeticPublicationLimits(panel) {
    const { pset, propPset } = resolveEnergeticPanelPset(panel)
    const series = (panel.series || []).filter((s) => (s.y?.length ?? 0) > 0)
    const ext = dataExtentsFromSeries(series)
    if (!ext) return { xlim: null, ylim: null }
    const xMinStr = pset.xMin !== '' ? pset.xMin : propPset.xMin
    const xMaxStr = pset.xMax !== '' ? pset.xMax : propPset.xMax
    const yMinStr = pset.yMin !== '' ? pset.yMin : propPset.yMin
    const yMaxStr = pset.yMax !== '' ? pset.yMax : propPset.yMax
    const xMinEff =
      xMinStr !== '' && Number.isFinite(Number(xMinStr)) ? Number(xMinStr) : ext.xMin
    const xMaxEff =
      xMaxStr !== '' && Number.isFinite(Number(xMaxStr)) ? Number(xMaxStr) : ext.xMax
    const yMinEff =
      yMinStr !== '' && Number.isFinite(Number(yMinStr)) ? Number(yMinStr) : ext.yMin
    const yMaxEff =
      yMaxStr !== '' && Number.isFinite(Number(yMaxStr)) ? Number(yMaxStr) : ext.yMax
    return {
      xlim: [Math.min(xMinEff, xMaxEff), Math.max(xMinEff, xMaxEff)],
      ylim: [Math.min(yMinEff, yMaxEff), Math.max(yMinEff, yMaxEff)]
    }
  }

  function energeticPublicationGlobalStyle() {
    return {
      time_units: timeUnits,
      energy_units: energyUnits,
      plot_bg: resolvedEnergColors.plotBg,
      fig_bg: resolvedEnergColors.plotBg,
      text_color: resolvedEnergColors.textColor,
      grid_color: ePlotGlobal.gridColor || '#262626',
      show_grid: ePlotGlobal.showGrid !== false,
      figsize: [10, 6],
      dpi: Number(ePlotGlobal.dpi) || 300,
      font_family: ePlotGlobal.fontFamily || 'Roboto, sans-serif',
      xlabel: displayXLabel,
      title: displayTitle || ePlotGlobal.title || 'Energetic Analysis'
    }
  }

  function seriesToPublicationData(series) {
    return (series || [])
      .filter((s) => (s.y?.length ?? 0) > 0)
      .map((s) => ({
        key: s.key || s.name,
        name: s.name,
        unit: s.propLabel || (s.baseName ? energeticPropYLabel(s.baseName) : '') || '',
        y: s.y,
        x: s.x,
        color: s.color
      }))
  }

  function buildEnergeticPlotPayload() {
    const panels = energeticPanels
    if (panels.length > 0) {
      const allDataSeries = panels.flatMap((panel) => seriesToPublicationData(panel.series))
      if (allDataSeries.length === 0) {
        // fall through to rawSeries fallback below
      } else {
        const layout = panels.length === 1 ? 'overlay' : 'grid'
        const lineColors = ['#f59e0b', '#22c55e', '#38bdf8', '#f87171', '#a78bfa', '#f472b6']

        if (layout === 'overlay') {
          const panel = panels[0]
          const { pset } = resolveEnergeticPanelPset(panel)
          const { xlim, ylim } = energeticPublicationLimits(panel)
          const ylabel = energeticPanelYLabel(panel, pset)
          const title = energeticPanelChartTitle(panel, pset)
          return {
            data: {
              x: allDataSeries[0]?.x || [],
              series: allDataSeries
            },
            plotSpec: {
              version: 1,
              layout: 'overlay',
              cols: 2,
              sync_x: false,
              global: {
                ...energeticPublicationGlobalStyle(),
                title,
                ylabel,
                xlim,
                ylim
              },
              panels: allDataSeries.map((s, i) => ({
                key: s.key,
                name: s.name,
                title: s.name,
                ylabel,
                line_color: s.color || lineColors[i % lineColors.length]
              }))
            }
          }
        }

        const plotPanels = panels
          .map((panel) => {
            const series = seriesToPublicationData(panel.series)
            if (series.length === 0) return null
            const { pset, propPset, propKey, pk } = resolveEnergeticPanelPset(panel)
            const ylabel = energeticPanelYLabel(panel, {
              ...propPset,
              ylabel: pset.ylabel || propPset.ylabel
            })
            const title = energeticPanelChartTitle(panel, {
              ...pset,
              title: pset.title || (propKey === pk ? propPset.title : '')
            })
            const { xlim, ylim } = energeticPublicationLimits(panel)
            return {
              key: panel.key,
              name: title,
              title,
              ylabel,
              series_keys: series.map((s) => s.key),
              line_color: series[0]?.color || lineColors[0],
              xlim,
              ylim
            }
          })
          .filter(Boolean)

        return {
          data: {
            x: allDataSeries[0]?.x || [],
            series: allDataSeries
          },
          plotSpec: {
            version: 1,
            layout: 'grid',
            cols: 2,
            sync_x: ePlotGlobal.syncX !== false,
            global: energeticPublicationGlobalStyle(),
            panels: plotPanels
          }
        }
      }
    }
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
        globalSettings: {
          ...ePlotGlobal,
          plotBg: resolvedEnergColors.plotBg,
          textColor: resolvedEnergColors.textColor
        },
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
    if (ps.titleCustomized) return String(ps.title || '').trim()
    return autoStructuralTitle(structuralType)
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

  // Root of on-screen charts — PNG/SVG collect every panel SVG from here.
  let plotExportRoot = $state(/** @type {HTMLElement | null} */ (null))

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
      const value = formatTrajectoryTimeNs(Number(item.timeNs))
      if (value != null && value > 0) {
        map[basename(item.path)] = value
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
      // Keep a custom session output name; only seed the default when still empty.
      if (!outputFolderName.trim()) {
        outputFolderName = defaultAnalysisFolderName(result.filePath)
      }
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
    if (nextType === structuralType || structuralTypeChanging) return
    structuralTypeChanging = true
    try {
      await withPlotViewBusy('Switching analysis type…', async () => {
        await applyStructuralTypeChange(nextType)
      })
    } finally {
      structuralTypeChanging = false
    }
  }

  /** @param {string} nextType */
  async function applyStructuralTypeChange(nextType) {
    const prevType = structuralType
    markSessionDirty()

    // Freeze the leaving type's selection before switching the active type in UI state.
    const prevSnapshot = snapshotCurrentTypeSelection()
    structuralType = nextType

    if (isBilayerType(prevType) && !isBilayerType(nextType)) {
      headgroupDetectGeneration += 1
    }

    // Hide stale chart immediately while the new type loads (CSV hydrate / headgroup detect).
    chartView = { mode: 'empty', series: [], panels: [] }
    plotDataRevision += 1

    // Persist per-set selections for the type we are leaving.
    analysisSets = analysisSets.map((s) => {
      const map = { ...(s.structuralOptions?.selectionsByType || {}) }
      if (s.id === activeSetId) {
        map[prevType] = prevSnapshot
      } else if (!map[prevType] && s.structuralOptions) {
        // Preserve whatever flat fields that set last had for the previous type.
        map[prevType] = {
          selection: s.structuralOptions.selection,
          selection2: s.structuralOptions.selection2,
          referenceFrame: s.structuralOptions.referenceFrame,
          align: s.structuralOptions.align,
          rmsfXaxisType: s.structuralOptions.rmsfXaxisType,
          leafletLipidSel: s.structuralOptions.leafletLipidSel,
          leafletFilterSel: s.structuralOptions.leafletFilterSel,
          nBins: s.structuralOptions.nBins,
          interpolate: s.structuralOptions.interpolate,
          excludeSel: s.structuralOptions.excludeSel,
          excludeCutoff: s.structuralOptions.excludeCutoff,
          aplMethod: s.structuralOptions.aplMethod,
          gridmatN: s.structuralOptions.gridmatN,
          gridmatPrecision: s.structuralOptions.gridmatPrecision,
          vtmcNSamples: s.structuralOptions.vtmcNSamples,
          vtmcProteinRadius: s.structuralOptions.vtmcProteinRadius,
          lipidHeadgroupAtoms: []
        }
      }
      const nextSnap = resolveStructuralTypeSelection(
        { ...s.structuralOptions, selectionsByType: map, structuralType: prevType },
        nextType
      )
      // First visit to a bilayer type: do not carry protein/RMSD selection forward.
      const nextSelection =
        isBilayerType(nextType) && looksLikeProteinSelection(nextSnap.selection)
          ? ''
          : nextSnap.selection
      return {
        ...s,
        structuralOptions: {
          ...s.structuralOptions,
          structuralType: nextType,
          selection: nextSelection,
          selection2: nextSnap.selection2,
          referenceFrame: nextSnap.referenceFrame ?? s.structuralOptions.referenceFrame,
          align: nextSnap.align ?? s.structuralOptions.align,
          rmsfXaxisType: nextSnap.rmsfXaxisType ?? s.structuralOptions.rmsfXaxisType,
          leafletLipidSel: nextSnap.leafletLipidSel ?? '',
          leafletFilterSel: nextSnap.leafletFilterSel ?? '',
          nBins: nextSnap.nBins ?? s.structuralOptions.nBins,
          interpolate: nextSnap.interpolate ?? s.structuralOptions.interpolate,
          excludeSel: nextSnap.excludeSel ?? s.structuralOptions.excludeSel ?? 'protein',
          excludeCutoff: nextSnap.excludeCutoff ?? s.structuralOptions.excludeCutoff ?? '30',
          aplMethod: normalizeAplMethod(nextSnap.aplMethod ?? s.structuralOptions.aplMethod),
          gridmatN: nextSnap.gridmatN ?? s.structuralOptions.gridmatN ?? APL_METHOD_DEFAULTS.gridmatN,
          gridmatPrecision:
            nextSnap.gridmatPrecision ??
            s.structuralOptions.gridmatPrecision ??
            APL_METHOD_DEFAULTS.gridmatPrecision,
          vtmcNSamples:
            nextSnap.vtmcNSamples ?? s.structuralOptions.vtmcNSamples ?? APL_METHOD_DEFAULTS.vtmcNSamples,
          vtmcProteinRadius:
            nextSnap.vtmcProteinRadius ??
            s.structuralOptions.vtmcProteinRadius ??
            APL_METHOD_DEFAULTS.vtmcProteinRadius,
          selectionsByType: {
            ...map,
            [nextType]: { ...nextSnap, selection: nextSelection }
          }
        }
      }
    })

    const active = analysisSets.find((s) => s.id === activeSetId)
    if (active) {
      applyTypeSelectionSnapshot(
        resolveStructuralTypeSelection(active.structuralOptions, nextType),
        nextType
      )
      // Keep UI selection empty when resolve still yielded protein for bilayer.
      if (isBilayerType(nextType) && looksLikeProteinSelection(selection)) {
        selection = ''
        lipidHeadgroupAtoms = []
      }
    }

    rebuildStructResultsFromSets()

    if (isBilayerType(nextType)) {
      headgroupDetectAttempted = false
      const needsDetect =
        !selection.trim() ||
        looksLikeProteinSelection(selection) ||
        lipidHeadgroupAtoms.length === 0
      if (needsDetect && topologyPath) {
        await refreshHeadgroupAtoms()
      } else if (lipidHeadgroupAtoms.length > 0) {
        syncHeadgroupSelection()
      }
    } else {
      headgroupDetectAttempted = false
    }

    persistActiveSetFields()
    await hydratePlotDataFromOutputFolder()
    bumpPlotData()
  }

  /**
   * Ensure the active set has a usable lipid headgroup selection before bilayer runs.
   * Auto-detects when empty or still carrying a protein/RMSD selection.
   */
  async function ensureBilayerSelectionReady() {
    if (!isBilayerType(structuralType)) return
    const needsDetect =
      !selection.trim() ||
      looksLikeProteinSelection(selection) ||
      (lipidHeadgroupAtoms.length === 0 && !looksLikeBilayerHeadgroupSelection(selection))
    if (needsDetect && topologyPath) {
      await refreshHeadgroupAtoms()
    }
    if (!selection.trim()) {
      throw new Error('Enable at least one phosphate/headgroup atom name.')
    }
    if (looksLikeProteinSelection(selection)) {
      throw new Error(
        'Bilayer analysis requires lipid headgroup atoms (e.g. phosphates), not a protein/backbone selection. Click Refresh under Headgroup atoms or pick phosphate names.'
      )
    }
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

  function clearAnalysisActionNotice() {
    if (analysisActionNoticeTimer) {
      clearTimeout(analysisActionNoticeTimer)
      analysisActionNoticeTimer = null
    }
    analysisActionNotice = ''
  }

  /** @param {string} message */
  function showAnalysisActionNotice(message) {
    clearAnalysisActionNotice()
    analysisActionNotice = message
    lastError = ''
    analysisActionNoticeTimer = setTimeout(() => {
      if (analysisActionNotice === message) analysisActionNotice = ''
      analysisActionNoticeTimer = null
    }, 8000)
  }

  /**
   * @param {string} message
   * @param {{ autoHideMs?: number, markClean?: boolean, kind?: 'success' | 'info' }} [opts]
   */
  function showSessionActionNotice(message, opts = {}) {
    clearSessionActionNoticeTimer()
    sessionActionNotice = message
    sessionActionNoticeKind = opts.kind === 'info' ? 'info' : 'success'
    if (opts.markClean !== false) sessionSavedClean = true
    lastError = ''
    const ms = opts.autoHideMs
    if (ms != null && ms > 0) {
      sessionActionNoticeTimer = setTimeout(() => {
        if (sessionActionNotice === message) sessionActionNotice = ''
        sessionActionNoticeTimer = null
      }, ms)
    }
  }

  function showSessionAlreadySavedNotice() {
    // Keep fingerprint; only refresh the toast.
    showSessionActionNotice('Latest changes are already saved.', {
      autoHideMs: 3500,
      markClean: true
    })
    sessionSavedClean = true
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
    plotViewBusyGeneration += 1
    plotViewBusy = false
    structuralTypeChanging = false
    mode = 'structural'
    running = false
    detectingProperties = false
    outputFolderName = ''
    sessionName = ''
    exportFileName = ''
    clearSessionActionNoticeTimer()
    sessionActionNotice = ''
    sessionSavedClean = false
    lastSavedSessionFingerprint = ''
    selectedSessionPath = ''
    clearAnalysisActionNotice()
    topologyPath = ''
    trajectoryFiles = []
    structuralType = 'rmsd'
    selection = 'protein and backbone'
    selection2 = 'protein and resid 50'
    selectionAtomCount = null
    selection2AtomCount = null
    selectionCountError = ''
    referenceFrame = '0'
    align = true
    rmsfXaxisType = 'residue_number'
    leafletLipidSel = ''
    leafletFilterSel = ''
    nBins = '1'
    interpolate = false
    excludeSel = 'protein'
    excludeCutoff = '30'
    aplMethod = APL_METHOD_DEFAULTS.aplMethod
    gridmatN = APL_METHOD_DEFAULTS.gridmatN
    gridmatPrecision = APL_METHOD_DEFAULTS.gridmatPrecision
    vtmcNSamples = APL_METHOD_DEFAULTS.vtmcNSamples
    vtmcProteinRadius = APL_METHOD_DEFAULTS.vtmcProteinRadius
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
    chartView = { mode: 'empty', series: [], panels: [] }
    plotDataRevision += 1
    runProgressStages = []
    runAnalysisScope = 'current'
    runAnalysisMenuOpen = false
    detectPropertiesScope = 'current'
    detectPropertiesMenuOpen = false
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
    bumpPlotData()
    if (uniqueDirList(workingDir, outputParentDir).length > 0) {
      void refreshSavedSessions()
    }
  }

  /** Detect properties for the remembered scope (current set vs all sets). */
  async function detectEnergeticProperties(scope = detectPropertiesScope) {
    detectPropertiesMenuOpen = false
    if (scope === 'all' && analysisSets.length > 1) {
      await detectEnergeticColumnsAllSets()
      return
    }
    await detectEnergeticColumns()
  }

  function detectPropertiesButtonLabel() {
    if (detectingProperties) return null
    if (analysisSets.length > 1 && detectPropertiesScope === 'all') {
      return `Detect Properties (all ${analysisSets.length} sets)`
    }
    return 'Detect Properties'
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
    void withPlotViewBusy(checked ? 'Showing property…' : 'Hiding property…', async () => {
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
    })
  }

  // ---- Run analysis ----
  function analysisRunOpts() {
    return {
      signal: analysisAbort?.signal,
      cancelledMessage: 'Analysis cancelled',
      cancelledName: 'AnalysisCancelled'
    }
  }

  function startAnalysisAbort() {
    analysisAbort?.abort()
    analysisAbort = new AbortController()
    return analysisAbort
  }

  function cancelAnalysis() {
    analysisAbort?.abort()
  }

  /** @param {unknown} error */
  function isAnalysisCancelled(error) {
    if (analysisAbort?.signal?.aborted) return true
    if (!(error instanceof Error)) return false
    if (
      error.name === 'AnalysisCancelled' ||
      error.name === 'AbortError' ||
      error.name === 'Cancelled'
    ) {
      return true
    }
    return /^Analysis cancelled$/i.test(error.message || '')
  }

  /**
   * Whether a set has the inputs needed to run the current analysis mode.
   * @param {import('../lib/analysisSets.js').AnalysisSet} set
   */
  function setHasAnalysisInputs(set) {
    if (mode === 'energetic') {
      return (set.energeticOptions?.logFiles || []).length > 0
    }
    return Boolean(set.topologyPath) && (set.trajectoryFiles || []).length > 0
  }

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
    startAnalysisAbort()
    let cancelled = false
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
      if (isAnalysisCancelled(error)) {
        lastError = 'Analysis cancelled'
        cancelled = true
      } else {
        lastError = error instanceof Error ? error.message : String(error)
      }
    } finally {
      // Unblock UI before save — session write must not keep "Running..." stuck.
      running = false
      analysisAbort = null
      resetAnalysisProgress()
    }
    if (cancelled) return
    try {
      await saveAnalysisCsvToOutputFolder()
      // Save both structural + energetic results present on sets (mixed sessions).
      await saveAnalysisSessionToOutputFolder()
      await hydratePlotDataFromOutputFolder()
      // Hydrate can rewrite set arrays — refresh fingerprint after it settles.
      rememberSessionSaveFingerprint()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      lastError = lastError || msg
      logEvent('error', 'analysis', 'Post-run save failed', msg)
    }
  }

  async function runAnalysisAllSets() {
    persistActiveSetFields()
    const runStructuralType = structuralType
    startAnalysisAbort()
    running = true
    lastError = ''
    statsRange = null
    panelRangeStats = {}
    syncOutputFolderName()
    const savedId = activeSetId
    /** @type {string[]} */
    const errors = []
    /** @type {string[]} */
    const skipped = []
    let completed = 0
    // Only run visible sets that already have the needed inputs. Hidden / empty
    // sets in between must not stop the batch from reaching later sets with data.
    const runnable = analysisSets.filter((set) => {
      if (!set.visible) {
        skipped.push(`${set.label}: hidden`)
        return false
      }
      if (!setHasAnalysisInputs(set)) {
        skipped.push(
          mode === 'energetic'
            ? `${set.label}: no log files`
            : `${set.label}: no topology/trajectories`
        )
        return false
      }
      return true
    })
    const total = runnable.length
    if (total === 0) {
      lastError =
        skipped.length > 0
          ? `No runnable sets. ${skipped.join('; ')}`
          : 'No sets available to run.'
      running = false
      analysisAbort = null
      resetAnalysisProgress()
      return
    }
    runProgressStages = runnable.map((set) => ({
      id: set.id,
      label: set.label,
      status: /** @type {'pending'} */ ('pending')
    }))
    try {
      for (let i = 0; i < runnable.length; i++) {
        if (analysisAbort?.signal.aborted) break
        const set = runnable[i]
        activeSetId = set.id
        loadActiveSetFields()
        structuralType = runStructuralType
        // Re-apply per-type selection for this set (do not keep another set's UI selection).
        {
          const loaded = analysisSets.find((s) => s.id === set.id)
          if (loaded) {
            applyTypeSelectionSnapshot(
              resolveStructuralTypeSelection(loaded.structuralOptions, runStructuralType),
              runStructuralType
            )
            if (
              isBilayerType(runStructuralType) &&
              looksLikeProteinSelection(selection)
            ) {
              selection = ''
              lipidHeadgroupAtoms = []
            }
          }
        }
        persistActiveSetFields()
        runProgressStages = runProgressStages.map((stage, idx) =>
          idx === i ? { ...stage, status: 'running' } : stage
        )
        const typeLabel = mode === 'structural' ? runStructuralType : 'energetic'
        setAnalysisProgress(i + 1, total, `${set.label} (${typeLabel})`)
        try {
          if (mode === 'structural' && isBilayerType(runStructuralType)) {
            await ensureBilayerSelectionReady()
          }
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
          if (isAnalysisCancelled(error)) {
            lastError = 'Analysis cancelled'
            runProgressStages = runProgressStages.map((stage, idx) =>
              idx === i && stage.status === 'running' ? { ...stage, status: 'error' } : stage
            )
            break
          }
          const msg = error instanceof Error ? error.message : String(error)
          errors.push(`${set.label}: ${msg}`)
          runProgressStages = runProgressStages.map((stage, idx) =>
            idx === i ? { ...stage, status: 'error' } : stage
          )
        }
      }
      if (analysisAbort?.signal.aborted && !lastError) {
        lastError = 'Analysis cancelled'
      } else if (errors.length > 0) {
        const skipNote = skipped.length ? ` Skipped ${skipped.length}: ${skipped.join('; ')}.` : ''
        lastError =
          errors.length === total
            ? errors[0]
            : `Completed ${completed}/${total} sets. ${errors.join(' ')}${skipNote}`
        if (completed > 0) {
          logEvent(
            'warn',
            'analysis',
            `Ran analysis on ${completed}/${total} sets; ${errors.length} failed.`
          )
        }
      } else {
        const skipNote = skipped.length ? ` Skipped ${skipped.length} (${skipped.join('; ')}).` : ''
        logEvent(
          'info',
          'analysis',
          `Ran analysis on ${completed} set(s).${skipNote}`
        )
        if (skipped.length && !lastError) {
          showAnalysisActionNotice(
            `Ran ${completed} set(s). Skipped ${skipped.length}: ${skipped.join('; ')}.`
          )
        }
      }
    } finally {
      activeSetId = savedId
      loadActiveSetFields()
      await hydratePlotDataFromOutputFolder()
      rememberSessionSaveFingerprint()
      running = false
      analysisAbort = null
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
    const title =
      displayTitle ||
      (mode === 'structural' ? autoStructuralTitle(structuralType) : '') ||
      chartTitle ||
      'analysis'
    return title.replace(/[^a-z0-9_\-]/gi, '_').toLowerCase()
  }

  /** Stem for CSV/SVG/PNG. Custom name keeps the user’s spelling; empty falls back to the chart title. */
  function exportFileStem() {
    const raw = exportFileName.trim().replace(/[/\\]/g, '_')
    if (!raw) return exportBaseName()
    return raw.replace(/\.(csv|svg|png)$/i, '').trim() || exportBaseName()
  }

  function slugExportLabel(label) {
    return String(label || '')
      .trim()
      .replace(/[/\\]/g, '_')
      .replace(/[^\w.\-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60)
  }

  /** On-screen LineChart SVGs (overlay = one, grid/panels = one per figure). */
  function visibleChartExports() {
    const root = plotExportRoot
    if (!root) return []
    return [...root.querySelectorAll('[data-chart-export]')]
      .map((el) => ({
        label: el.getAttribute('data-chart-export') || '',
        svg: /** @type {SVGSVGElement | null} */ (el.querySelector('svg'))
      }))
      .filter((item) => item.svg)
  }

  /** Wait for LineChart SVG mounts after {#key} remounts (avoids silent no-op export clicks). */
  async function collectVisibleChartExports(maxAttempts = 6) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await tick()
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
      const charts = visibleChartExports()
      if (charts.length > 0) return charts
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
    return []
  }

  /** @param {Array<{ x?: number[], y?: number[] }>} series */
  function dataExtentsFromSeries(series) {
    let xMin = Infinity
    let xMax = -Infinity
    let yMin = Infinity
    let yMax = -Infinity
    for (const s of series) {
      for (const x of s.x || []) {
        if (Number.isFinite(x)) {
          xMin = Math.min(xMin, x)
          xMax = Math.max(xMax, x)
        }
      }
      for (const y of s.y || []) {
        if (Number.isFinite(y)) {
          yMin = Math.min(yMin, y)
          yMax = Math.max(yMax, y)
        }
      }
    }
    if (!Number.isFinite(xMin) || !Number.isFinite(yMin)) return null
    const yPad = Math.max((yMax - yMin) * 0.05, 1e-9)
    return { xMin, xMax, yMin: yMin - yPad, yMax: yMax + yPad }
  }

  /** Match LineChart y-axis overrides; x uses full series range for publication. */
  function publicationYlimFromExtents(ext) {
    const yMinEff = yMinO != null ? yMinO : ext.yMin
    const yMaxEff = yMaxO != null ? yMaxO : ext.yMax
    return [Math.min(yMinEff, yMaxEff), Math.max(yMinEff, yMaxEff)]
  }

  function seriesForCsvExport() {
    if (mode === 'structural' && chartView.mode === 'grid' && chartView.panels.length > 0) {
      return chartView.panels.flatMap((panel) =>
        (panel.series || []).map((s) => ({
          ...s,
          name: panel.title ? `${panel.title} · ${s.name}` : s.name
        }))
      )
    }
    return displaySeries
  }

  const canExportOnscreenChart = $derived(
    mode === 'structural' ? chartView.series.length > 0 : energeticPanels.length > 0
  )

  function buildCsvContent(series) {
    if (series.length === 0) return null
    const header = ['x', ...series.map((s) => s.name)].join(',')
    const rows = series[0].x.map((xv, i) =>
      [xv, ...series.map((s) => s.y[i] ?? '')].join(',')
    )
    return [header, ...rows].join('\n')
  }

  function dirOfExportPath(filePath) {
    return String(filePath || '')
      .replace(/\\/g, '/')
      .replace(/\/[^/]+$/, '')
  }

  /**
   * @param {SVGSVGElement} svg
   * @param {number} index
   */
  async function rasterizeChartSvgToPng(svg, index = 0) {
    const vb = svg.viewBox?.baseVal
    const svgW = vb && vb.width > 0 ? vb.width : 900
    const svgH = vb && vb.height > 0 ? vb.height : 360
    const dpi = Math.max(
      72,
      Math.min(600, Number(mode === 'energetic' ? ePlotGlobal.dpi : ps.dpi) || 150)
    )
    const pixelScale = dpi / 96
    const clone = svg.cloneNode(true)
    clone.setAttribute('width', String(svgW))
    clone.setAttribute('height', String(svgH))
    const uniqueId = `plot-area-${Date.now()}-${index}`
    clone.querySelectorAll('[id="plot-area"]').forEach((el) => el.setAttribute('id', uniqueId))
    clone
      .querySelectorAll('[clip-path="url(#plot-area)"]')
      .forEach((el) => el.setAttribute('clip-path', `url(#${uniqueId})`))
    const svgData = new XMLSerializer().serializeToString(clone)
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
    if (!ctx) throw new Error('Could not create canvas for PNG export')
    const transparent = mode === 'structural' && ps.transparentBg
    if (!transparent) {
      ctx.fillStyle =
        mode === 'energetic' ? resolvedEnergColors.plotBg : displayPlotBg
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/png')
    return dataUrl.replace(/^data:image\/png;base64,/, '')
  }

  /**
   * @param {string[]} labels
   * @param {string} ext
   * @param {string} prompt
   */
  async function resolvePanelExportPaths(labels, ext, prompt) {
    const stem = exportFileStem()
    const used = new Set()
    const names =
      labels.length <= 1
        ? [`${stem}.${ext}`]
        : labels.map((label, i) => {
            let slug = slugExportLabel(label) || `panel${i + 1}`
            let name = slug
            let n = 2
            while (used.has(name)) name = `${slug}_${n++}`
            used.add(name)
            return `${stem}_${name}.${ext}`
          })
    const first = await resolveExportPath(names[0], prompt, [
      { name: ext.toUpperCase(), extensions: [ext] }
    ])
    if (!first) return null
    if (names.length === 1) return [first]
    const dir = dirOfExportPath(first)
    return names.map((name) => `${dir}/${name}`)
  }

  async function resolveExportPath(fileName, prompt, filters) {
    syncOutputFolderName()
    if (outputDir) {
      await ensureOutputFolder(resolvedOutputParent, resolveOutputFolderName())
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
      const { output_dir } = await ensureOutputFolder(resolvedOutputParent, folderName)
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

  /**
   * @param {{ manual?: boolean }} [opts] `manual: true` for the Save button (skip rewrite when clean).
   */
  async function saveAnalysisSessionToOutputFolder(opts = {}) {
    if (opts.manual) {
      // Align set snapshots with the sidebar before comparing fingerprints.
      suppressSessionDirty = true
      try {
        persistActiveSetFields()
      } finally {
        suppressSessionDirty = false
      }
      if (isSessionSaveUpToDate()) {
        showSessionAlreadySavedNotice()
        return true
      }
    }
    if (!canRunAnalysis) {
      lastError = 'Set a working directory or output path before saving.'
      return false
    }
    savingSession = true
    showSessionActionNotice('Saving session…', { kind: 'info', markClean: false })
    suppressSessionDirty = true
    let savedMessage = ''
    let savedOk = false
    try {
      syncResultsToSetsBeforeSave()
      analysisSets = assignCsvStems(analysisSets)
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
        const { output_dir } = await ensureOutputFolder(resolvedOutputParent, folderName)
        const session = serializeAnalysisSession({
          mode,
          compareLayout,
          energeticCompareLayout,
          outputFolderName: folderName,
          sessionName,
          activeSetId,
          sets: slimSetsForSessionSave(analysisSets, 'all'),
          plotSettings: {
            structural: clonePlainAnalysisData(sPlots),
            energeticGlobal: clonePlainAnalysisData(ePlotGlobal),
            energeticPanels: clonePlainAnalysisData(ePlotPanels)
          }
        })
        const filePath = `${output_dir}/${ANALYSIS_SESSION_FILENAME}`.replace(/\\/g, '/')
        await window.api.writeJson(filePath, session)
        const identity = formatAnalysisSessionIdentity({
          sessionName,
          outputFolderName: folderName
        })
        logEvent('info', 'analysis', 'Saved analysis session', `${identity} → ${filePath}`)
        selectedSessionPath = filePath
        lastError = ''
        await refreshSavedSessions()
        savedMessage = `Saved “${identity}” to ${filePath}`
        rememberSessionSaveFingerprint()
        showSessionActionNotice(savedMessage, { autoHideMs: 10000 })
        void notifyJobFinishedIfUnfocused({
          id: `analysis-session:${filePath}`,
          title: 'Analysis session saved',
          body: `Saved “${identity}” to ${filePath}`,
          sourcePage: 'analysis'
        })
        savedOk = true
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        logEvent('error', 'analysis', 'Failed to save analysis session', lastError)
        savedOk = false
      }
    } finally {
      suppressSessionDirty = false
      savingSession = false
      if (!savedOk && sessionActionNotice === 'Saving session…') {
        sessionActionNotice = ''
      }
    }
    if (savedOk && savedMessage) {
      await tick()
      if (!sessionActionNotice && isSessionSaveUpToDate()) {
        showSessionActionNotice(savedMessage, { autoHideMs: 10000 })
      }
    }
    return savedOk
  }

  /**
   * Show a spinner on the export button after the path is known (not during the save dialog).
   * @param {'' | 'csv' | 'svg' | 'png' | 'pub'} kind
   * @param {() => Promise<void>} fn
   */
  async function withChartExport(kind, fn) {
    if (exportingKind) return
    exportingKind = kind
    await tick()
    try {
      await fn()
    } finally {
      exportingKind = ''
    }
  }

  async function exportCsv() {
    const series = seriesForCsvExport()
    if (series.length === 0 || exportingKind) return
    const csv = buildCsvContent(series)
    if (!csv) return
    const filePath = await resolveExportPath(
      `${exportFileStem()}.csv`,
      'Export CSV — file will be saved as .csv',
      [{ name: 'CSV', extensions: ['csv'] }]
    )
    if (!filePath) return
    await withChartExport('csv', async () => {
      await window.api.writeText(filePath, csv)
      showAnalysisActionNotice(`Exported CSV to ${filePath}`)
      logEvent('info', 'analysis', 'Exported CSV', filePath)
    })
  }

  async function exportSvg() {
    if (exportingKind || !canExportOnscreenChart) return
    try {
      await withChartExport('svg', async () => {
        const charts = await collectVisibleChartExports()
        if (charts.length === 0) {
          showAnalysisActionNotice(
            'Chart not ready for export — wait for the plot to finish, then try again.'
          )
          return
        }
        const paths = await resolvePanelExportPaths(
          charts.map((c) => c.label),
          'svg',
          'Export SVG — each on-screen panel is saved as .svg'
        )
        if (!paths) return
        for (let i = 0; i < charts.length; i++) {
          const svgStr = '<?xml version="1.0" encoding="UTF-8"?>\n' + charts[i].svg.outerHTML
          await window.api.writeText(paths[i], svgStr)
        }
        const notice =
          paths.length === 1
            ? `Exported SVG to ${paths[0]}`
            : `Exported ${paths.length} SVGs to ${dirOfExportPath(paths[0])}`
        showAnalysisActionNotice(notice)
        logEvent('info', 'analysis', 'Exported SVG', paths.join(', '))
      })
    } catch (err) {
      lastError = 'SVG export failed: ' + (err instanceof Error ? err.message : String(err))
    }
  }

  function publicationSeries() {
    if (mode === 'structural' && chartView.mode === 'grid' && chartView.panels.length > 0) {
      return chartView.panels.flatMap((panel) =>
        (panel.series || [])
          .filter((s) => (s.y?.length ?? 0) > 0)
          .map((s) => ({
            ...s,
            name:
              panel.title && s.name && s.name !== panel.title
                ? `${panel.title} · ${s.name}`
                : panel.title || s.name
          }))
      )
    }
    return displaySeries.filter((s) => (s.y?.length ?? 0) > 0)
  }

  function buildStructuralPlotPayload() {
    const shown = publicationSeries()
    const layout = chartView.mode === 'grid' && shown.length > 1 ? 'grid' : 'overlay'
    const globalExt = dataExtentsFromSeries(shown)
    const overlayXlim = globalExt ? [globalExt.xMin, globalExt.xMax] : null
    const overlayYlim = globalExt ? publicationYlimFromExtents(globalExt) : null
    return {
      data: {
        x: shown[0]?.x || [],
        series: shown.map((s) => ({
          key: s.key || s.name,
          name: s.name,
          unit: '',
          y: s.y,
          x: s.x
        }))
      },
      plotSpec: {
        version: 1,
        layout,
        cols: 2,
        // Per-set grid panels can have different trajectory lengths — do not force one x window.
        sync_x: layout === 'overlay',
        global: {
          plot_bg: resolvedStructColors.plotBg,
          fig_bg: resolvedStructColors.plotBg,
          text_color: resolvedStructColors.textColor,
          grid_color: resolvedStructColors.textColor,
          show_grid: ps.showGrid !== false,
          figsize: [10, 6],
          dpi: Number(ps.dpi) || 300,
          font_family: ps.fontFamily || 'Roboto, sans-serif',
          xlabel: displayXLabel,
          ylabel: displayYLabel,
          title: displayTitle || 'Structural Analysis',
          xlim: layout === 'overlay' ? overlayXlim : null,
          ylim: layout === 'overlay' ? overlayYlim : null
        },
        panels: shown.map((s, i) => {
          const ext = dataExtentsFromSeries([s])
          // Overlay shares one axis: use combined extents so APL leaflets (etc.)
          // are not clipped to the first series (usually Mean).
          const xlim =
            layout === 'overlay' ? overlayXlim : ext ? [ext.xMin, ext.xMax] : null
          const ylim =
            layout === 'overlay'
              ? overlayYlim
              : ext
                ? publicationYlimFromExtents(ext)
                : overlayYlim
          return {
            key: s.key || s.name,
            name: s.name,
            title: s.name,
            ylabel: displayYLabel,
            line_color:
              s.color || ['#f59e0b', '#22c55e', '#38bdf8', '#f87171', '#a78bfa', '#f472b6'][i % 6],
            xlim,
            ylim
          }
        })
      }
    }
  }

  function buildPublicationPlotPayload() {
    return mode === 'energetic' ? buildEnergeticPlotPayload() : buildStructuralPlotPayload()
  }

  const canExportPublicationPng = $derived(
    mode === 'energetic'
      ? displaySeries.length > 0 || rawSeries.length > 0
      : displaySeries.length > 0
  )

  async function exportPublicationPng() {
    if (!canExportPublicationPng || exportingKind) return
    try {
      await withChartExport('pub', async () => {
        const filePath = await resolveExportPath(
          `${exportFileStem()}_publication.png`,
          'Export publication PNG (matplotlib / API style)',
          [{ name: 'PNG Image', extensions: ['png'] }]
        )
        if (!filePath) return
        const blob = await renderAnalysisPlot(buildPublicationPlotPayload())
        const buf = await blob.arrayBuffer()
        const bytes = new Uint8Array(buf)
        let binary = ''
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
        await window.api.writeBinary(filePath, btoa(binary))
        showAnalysisActionNotice(`Exported publication PNG to ${filePath}`)
        logEvent('info', 'analysis', 'Exported publication PNG', filePath)
      })
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  async function exportPng() {
    if (exportingKind || !canExportOnscreenChart) return
    try {
      await withChartExport('png', async () => {
        const charts = await collectVisibleChartExports()
        if (charts.length === 0) {
          showAnalysisActionNotice(
            'Chart not ready for export — wait for the plot to finish, then try again.'
          )
          return
        }
        const paths = await resolvePanelExportPaths(
          charts.map((c) => c.label),
          'png',
          'Export PNG — each on-screen panel is saved as .png'
        )
        if (!paths) return
        for (let i = 0; i < charts.length; i++) {
          const base64 = await rasterizeChartSvgToPng(charts[i].svg, i)
          await window.api.writeBinary(paths[i], base64)
        }
        const notice =
          paths.length === 1
            ? `Exported PNG to ${paths[0]}`
            : `Exported ${paths.length} PNGs to ${dirOfExportPath(paths[0])}`
        showAnalysisActionNotice(notice)
        logEvent('info', 'analysis', 'Exported PNG', paths.join(', '))
      })
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

{#if pendingReplaceSessionPath}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    onmousedown={cancelReplaceSession}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="mx-4 w-full max-w-sm rounded-lg border border-neutral-300 bg-white p-5 text-sm text-neutral-900 shadow-xl dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
      onmousedown={(e) => e.stopPropagation()}
    >
      <p class="font-semibold">Replace current session?</p>
      <p class="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
        The plots you have open will be replaced by the saved session. Unsaved changes in this view
        are not written to disk.
      </p>
      <div class="mt-4 flex gap-2">
        <Button size="sm" variant="outline" className="flex-1" onclick={cancelReplaceSession}>
          Cancel
        </Button>
        <Button size="sm" className="flex-1" onclick={confirmReplaceSession}>Replace</Button>
      </div>
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
              ? `${savedSessions.length} saved session${savedSessions.length === 1 ? '' : 's'} under the working directory and output path`
              : sessionScanHint === 'Scan failed'
                ? 'Could not scan for saved sessions'
                : 'No saved sessions under the working directory or output path'}
          >
            {sessionScanHint}
          </span>
        {/if}
      </div>
      <div class="space-y-1">
        <p class="sidebar-label">Session name</p>
        <Input
          type="text"
          size="sm"
          bind:value={sessionName}
          className="w-full"
          placeholder="e.g. POPC APL vs thickness"
          title="Optional label to identify this analysis (saved with the session; folder name stays separate)"
        />
        {#if currentSessionIdentity}
          <p class="sidebar-hint" title="Session name · output folder">
            Current: <span class="font-medium text-neutral-700 dark:text-neutral-300">{currentSessionIdentity}</span>
          </p>
        {/if}
      </div>
      {#if savedSessions.length > 0}
        <Select size="sm" className="w-full" bind:value={selectedSessionPath}>
          <option value="">Select a saved session…</option>
          {#each savedSessions as session (session.session_path)}
            <option value={session.session_path} title={session.output_dir || session.session_path}>
              {formatSavedSessionOption(session)}
            </option>
          {/each}
        </Select>
        {#if selectedSavedSession}
          <p
            class="rounded-md border border-neutral-200 p-2 wrap-break-word sidebar-label dark:border-neutral-800"
            title={selectedSavedSession.output_dir || selectedSavedSession.session_path}
          >
            {selectedSavedSession.output_dir || selectedSavedSession.session_path}
          </p>
        {:else}
          <p class="sidebar-hint">Select a session to see its folder path.</p>
        {/if}
      {/if}
      <div class="flex gap-1">
        <Button
          size="sm"
          variant="outline"
          className="min-w-0 flex-1"
          onclick={() => void saveAnalysisSessionToOutputFolder({ manual: true })}
          disabled={!canSaveSession || running || sessionBusy}
          title="Write analysis_session.json to the output folder"
        >
          {#if savingSession}
            <Spinner className="mr-1" />Saving…
          {:else}
            Save
          {/if}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="min-w-0 flex-1"
          onclick={loadSelectedSavedSession}
          disabled={!selectedSessionPath || running || sessionBusy}
        >
          {#if loadingSession}
            <Spinner className="mr-1" />Loading…
          {:else}
            Load
          {/if}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="min-w-0 flex-1"
          onclick={browseAnalysisSessionFile}
          disabled={running || sessionBusy}
        >
          Browse…
        </Button>
      </div>
      {#if sessionActionNotice}
        <p
          class="gw-notice text-[11px] leading-snug {sessionActionNoticeKind === 'info'
            ? 'gw-notice-info'
            : 'gw-notice-success'}"
        >
          {sessionActionNotice}
        </p>
      {/if}
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
                onblur={applyChartAppearance}
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
                    step="0.0001"
                    placeholder="0"
                    bind:value={trajectoryFiles[i].timeNs}
                    className="w-24 shrink-0 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    title="Time offset in ns (e.g. 200.1234 or 2000.1234)"
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
        <div class="flex items-center justify-between gap-2">
          <h2 class="sidebar-heading">Structural Options</h2>
          {#if structuralTypeChanging || headgroupDetecting}
            <span class="flex shrink-0 items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
              <Spinner className="size-3.5" />
              {structuralTypeChanging ? 'Switching…' : 'Detecting…'}
            </span>
          {/if}
        </div>
        <Select
          size="sm"
          className="w-full"
          value={structuralType}
          disabled={structuralTypeChanging || headgroupDetecting}
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
            {#if bilayerSelectionWarning}
              <p class="gw-notice gw-notice-warning text-[11px] leading-snug">
                {bilayerSelectionWarning}
              </p>
            {/if}
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

            {#if structuralType === 'area_per_lipid'}
              <div class="space-y-2">
                <p class="sidebar-label">APL method</p>
                <Select size="sm" bind:value={aplMethod} className="w-full">
                  {#each APL_METHODS as method (method.id)}
                    <option value={method.id}>{method.label}</option>
                  {/each}
                </Select>
                {#if aplMethod === 'lipyphilic'}
                  <p class="gw-notice gw-notice-warning text-[11px] leading-snug">
                    LiPyphilic is a pure-lipid box Voronoi. It ignores the protein, so APL is
                    inflated to box / lipids per leaflet. Use EVAPL (default) for
                    leaflets that contain protein, peptide, DNA, or other occupants.
                  </p>
                {:else if aplMethodHint}
                  <p class="sidebar-hint">{aplMethodHint}</p>
                {/if}

                {#if aplMethod !== 'lipyphilic'}
                  <Input
                    size="sm"
                    bind:value={excludeSel}
                    placeholder="Exclude selection (empty = none)"
                    className="w-full"
                    title="Non-lipid atoms that reduce lipid-accessible area (protein, peptide, DNA, ligands, …)"
                  />
                {/if}

                {#if aplMethod === 'evapl'}
                  <div class="flex items-center gap-2">
                    <span class="sidebar-label shrink-0">Exclude cutoff (Å)</span>
                    <Input
                      size="sm"
                      type="number"
                      min="0"
                      step="0.5"
                      bind:value={excludeCutoff}
                      className="w-20"
                      title="Only exclude atoms within this distance of the leaflet (default 30 Å)"
                    />
                  </div>
                {/if}

                {#if aplMethod === 'gridmat'}
                  <div class="flex items-center gap-2">
                    <span class="sidebar-label shrink-0">Grid points</span>
                    <Input
                      size="sm"
                      type="number"
                      min="2"
                      step="1"
                      bind:value={gridmatN}
                      className="w-20"
                      title="GridMAT points along the long box axis (default 20)"
                    />
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="sidebar-label shrink-0">Protein cutoff (Å)</span>
                    <Input
                      size="sm"
                      type="number"
                      min="0.1"
                      step="0.5"
                      bind:value={gridmatPrecision}
                      className="w-20"
                      title="GridMAT offending-atom proximity (default 13 Å)"
                    />
                  </div>
                {/if}

                {#if aplMethod === 'vtmc'}
                  <div class="flex items-center gap-2">
                    <span class="sidebar-label shrink-0">MC samples</span>
                    <Input
                      size="sm"
                      type="number"
                      min="1000"
                      step="1000"
                      bind:value={vtmcNSamples}
                      className="w-24"
                      title="Monte Carlo samples per leaflet (default 50000)"
                    />
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="sidebar-label shrink-0">Protein radius (Å)</span>
                    <Input
                      size="sm"
                      type="number"
                      min="0.1"
                      step="0.1"
                      bind:value={vtmcProteinRadius}
                      className="w-20"
                      title="Protein-atom disk radius (default 1.7 Å)"
                    />
                  </div>
                {/if}
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
                  step="0.0001"
                  placeholder="0"
                  bind:value={logFiles[i].timeNs}
                  className="w-24 shrink-0 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  title="Time offset in ns (e.g. 200.1234 or 2000.1234)"
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

        {#if analysisSets.length > 1}
          <div class="relative w-full" bind:this={detectPropertiesMenuEl}>
            <div class="flex w-full">
              <Button
                variant="outline"
                className="min-w-0 flex-1 rounded-r-none border-r-0"
                onclick={() => void detectEnergeticProperties(detectPropertiesScope)}
                disabled={detectingProperties || running || (detectPropertiesScope === 'current' && logFiles.length === 0)}
              >
                {#if detectingProperties}
                  <Spinner className="mr-1" />Detecting…
                {:else}
                  {detectPropertiesButtonLabel()}
                {/if}
              </Button>
              <button
                type="button"
                class="inline-flex shrink-0 items-center justify-center rounded-r-lg border border-neutral-300 bg-white px-2.5 text-sm text-neutral-900 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 disabled:pointer-events-none disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800 dark:focus-visible:ring-neutral-600"
                disabled={detectingProperties || running}
                aria-label="Choose detect scope"
                aria-expanded={detectPropertiesMenuOpen}
                onclick={() => (detectPropertiesMenuOpen = !detectPropertiesMenuOpen)}
              >
                <svg viewBox="0 0 10 6" class="size-2.5 fill-current opacity-80" aria-hidden="true">
                  <path d="M0 0l5 6 5-6z" />
                </svg>
              </button>
            </div>
            {#if detectPropertiesMenuOpen}
              <div
                class="absolute top-full left-0 right-0 z-20 mt-1 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
                role="menu"
              >
                <button
                  type="button"
                  role="menuitem"
                  class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
                  onclick={() => {
                    detectPropertiesScope = 'current'
                    detectPropertiesMenuOpen = false
                  }}
                >
                  <span class="w-4 shrink-0 text-center text-xs">{detectPropertiesScope === 'current' ? '✓' : ''}</span>
                  <span>Current set</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
                  onclick={() => {
                    detectPropertiesScope = 'all'
                    detectPropertiesMenuOpen = false
                  }}
                >
                  <span class="w-4 shrink-0 text-center text-xs">{detectPropertiesScope === 'all' ? '✓' : ''}</span>
                  <span>All sets ({analysisSets.length})</span>
                </button>
              </div>
            {/if}
          </div>
        {:else}
          <Button
            variant="outline"
            className="w-full"
            onclick={() => void detectEnergeticProperties('current')}
            disabled={detectingProperties || running || logFiles.length === 0}
          >
            {#if detectingProperties}
              <Spinner className="mr-1" />Detecting…
            {:else}
              Detect Properties
            {/if}
          </Button>
        {/if}
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
            <Select
              size="sm"
              bind:value={timeUnits}
              className="w-full"
              onchange={() => onEnergeticUnitChange()}
            >
              <option value="ns">ns</option>
              <option value="ps">ps</option>
              <option value="µs">µs</option>
            </Select>
          </div>
          <div>
            <p class="sidebar-label mb-0.5">Energy</p>
            <Select
              size="sm"
              bind:value={energyUnits}
              className="w-full"
              onchange={() => onEnergeticUnitChange()}
            >
              <option value="kcal/mol">kcal/mol</option>
              <option value="kJ/mol">kJ/mol</option>
            </Select>
          </div>
          <div>
            <p class="sidebar-label mb-0.5">Pressure</p>
            <Select
              size="sm"
              bind:value={pressureUnits}
              className="w-full"
              onchange={() => onEnergeticUnitChange()}
            >
              <option value="atm">atm</option>
              <option value="bar">bar</option>
              <option value="kPa">kPa</option>
              <option value="MPa">MPa</option>
            </Select>
          </div>
          <div>
            <p class="sidebar-label mb-0.5">Temperature</p>
            <Select
              size="sm"
              bind:value={temperatureUnits}
              className="w-full"
              onchange={() => onEnergeticUnitChange()}
            >
              <option value="K">K</option>
              <option value="°C">°C</option>
              <option value="°F">°F</option>
            </Select>
          </div>
          <div class="col-span-2">
            <p class="sidebar-label mb-0.5">Volume</p>
            <Select
              size="sm"
              bind:value={volumeUnits}
              className="w-full"
              onchange={() => onEnergeticUnitChange()}
            >
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
            <p class="sidebar-hint">
              Checkboxes show/hide plots only. Run analyzes all detected properties; CSV keeps the full data.
            </p>
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
          {#if mode === 'structural'}
            <div>
              <p class="sidebar-label mb-0.5">Title</p>
              <div class="flex gap-1">
                <Input
                  size="sm"
                  value={ps.titleCustomized ? ps.title : ''}
                  placeholder={
                    ps.titleCustomized && !String(ps.title || '').trim()
                      ? '(no title)'
                      : autoStructuralTitle(structuralType)
                  }
                  className="min-w-0 flex-1"
                  oninput={(e) =>
                    patchStructuralPlot({
                      title: e.currentTarget.value,
                      titleCustomized: true
                    })
                  }
                />
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!ps.titleCustomized}
                  onclick={restoreAutoStructuralTitle}
                  title="Restore the analysis-type title"
                >Auto</Button>
              </div>
              <p class="sidebar-hint">Follows the analysis type. Edit to customize, or clear to hide.</p>
            </div>
            {#if activeAnalysisSet}
              <div>
                <p class="sidebar-label mb-0.5">Legend (this set)</p>
                <Input
                  size="sm"
                  blurOnEnter
                  value={activeAnalysisSet.legendLabel ?? ''}
                  placeholder={activeAnalysisSet.label}
                  className="w-full"
                  oninput={(e) => updateSetLegend(activeAnalysisSet.id, e.currentTarget.value)}
                  onblur={applyChartAppearance}
                />
                <p class="sidebar-hint">Follows the set name. Empty restores it.</p>
              </div>
            {/if}
          {/if}
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
            <div class="grid grid-cols-2 gap-1">
              <div>
                <p class="sidebar-label mb-0.5">X tick labels</p>
                <Input
                  size="sm"
                  type="number"
                  min="2"
                  max="20"
                  step="1"
                  bind:value={ePlotGlobal.xTickCount}
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
                  bind:value={ePlotGlobal.yTickCount}
                  className="w-full"
                />
              </div>
              <div>
                <p class="sidebar-label mb-0.5">X decimals</p>
                <Input
                  size="sm"
                  type="number"
                  min="0"
                  max="8"
                  step="1"
                  bind:value={ePlotGlobal.xTickDecimals}
                  placeholder="auto"
                  className="w-full"
                  title="Decimal places on X axis ticks. Empty = auto."
                />
              </div>
              <div>
                <p class="sidebar-label mb-0.5">Y decimals</p>
                <Input
                  size="sm"
                  type="number"
                  min="0"
                  max="8"
                  step="1"
                  bind:value={ePlotGlobal.yTickDecimals}
                  placeholder="auto"
                  className="w-full"
                  title="Decimal places on Y axis ticks. Empty = auto."
                />
              </div>
            </div>
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
                <div class="flex items-center gap-1">
                  <input
                    type="color"
                    value={resolvedEnergColors.plotBg}
                    class="h-7 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                    oninput={(e) => setEnergeticPlotBg(e.currentTarget.value)}
                  />
                  <Input
                    size="sm"
                    value={ePlotGlobal.plotBgCustomized ? ePlotGlobal.plotBg : ''}
                    placeholder={resolvedEnergColors.plotBg}
                    className="min-w-0 flex-1 font-mono"
                    oninput={(e) => setEnergeticPlotBg(e.currentTarget.value)}
                  />
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!ePlotGlobal.plotBgCustomized}
                  onclick={() => {
                    markSessionDirty()
                    ePlotGlobal = { ...ePlotGlobal, plotBg: '', plotBgCustomized: false }
                  }}
                >Auto</Button>
              </div>
              <div>
                <p class="sidebar-label mb-0.5">Text color</p>
                <div class="flex items-center gap-1">
                  <input
                    type="color"
                    value={resolvedEnergColors.textColor}
                    class="h-7 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                    oninput={(e) => setEnergeticTextColor(e.currentTarget.value)}
                  />
                  <Input
                    size="sm"
                    value={ePlotGlobal.textColorCustomized ? ePlotGlobal.textColor : ''}
                    placeholder={resolvedEnergColors.textColor}
                    className="min-w-0 flex-1 font-mono"
                    oninput={(e) => setEnergeticTextColor(e.currentTarget.value)}
                  />
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!ePlotGlobal.textColorCustomized}
                  onclick={() => {
                    markSessionDirty()
                    ePlotGlobal = { ...ePlotGlobal, textColor: '', textColorCustomized: false }
                  }}
                >Auto</Button>
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
                <Select
                  size="sm"
                  bind:value={ps.xUnit}
                  className="w-full"
                  onchange={() => {
                    bumpPlotData()
                    persistActiveSetFields()
                  }}
                >
                  <option value="ns">ns</option>
                  <option value="ps">ps</option>
                  <option value="µs">µs</option>
                </Select>
              </div>
            {/if}
            {#if mode === 'structural'}
              <div>
                <p class="sidebar-label mb-0.5">Y units</p>
                <Select
                  size="sm"
                  bind:value={ps.yUnit}
                  className="w-full"
                  onchange={() => {
                    bumpPlotData()
                    persistActiveSetFields()
                  }}
                >
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
            <div>
              <p class="sidebar-label mb-0.5">X decimals</p>
              <Input
                size="sm"
                type="number"
                min="0"
                max="8"
                step="1"
                bind:value={ps.xTickDecimals}
                placeholder="auto"
                className="w-full"
                title="Decimal places on X axis ticks. Empty = auto."
              />
            </div>
            <div>
              <p class="sidebar-label mb-0.5">Y decimals</p>
              <Input
                size="sm"
                type="number"
                min="0"
                max="8"
                step="1"
                bind:value={ps.yTickDecimals}
                placeholder="auto"
                className="w-full"
                title="Decimal places on Y axis ticks. Empty = auto."
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
              <p class="sidebar-label mb-0.5">Line color (this set)</p>
              <div class="flex items-center gap-1">
                <input
                  type="color"
                  value={activeAnalysisSet?.color || '#f59e0b'}
                  class="h-7 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                  oninput={(e) => {
                    if (!activeAnalysisSet) return
                    patchAnalysisSet(activeAnalysisSet.id, { color: e.currentTarget.value })
                  }}
                />
                <Input
                  size="sm"
                  blurOnEnter
                  value={activeAnalysisSet?.color || ''}
                  className="min-w-0 flex-1 font-mono"
                  oninput={(e) => {
                    if (!activeAnalysisSet) return
                    patchAnalysisSet(activeAnalysisSet.id, { color: e.currentTarget.value })
                  }}
                  onblur={applyChartAppearance}
                />
              </div>
              <p class="sidebar-hint">Same color as the set. Area per lipid uses it for Average.</p>
            </div>
            <div>
              <p class="sidebar-label mb-0.5">Plot bg</p>
              <div class="flex items-center gap-1">
                <input
                  type="color"
                  value={resolvedStructColors.plotBg}
                  class="h-7 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                  oninput={(e) => setStructuralPlotBg(e.currentTarget.value)}
                />
                <Input
                  size="sm"
                  value={ps.plotBgCustomized ? ps.plotBg : ''}
                  placeholder={resolvedStructColors.plotBg}
                  className="min-w-0 flex-1 font-mono"
                  oninput={(e) => setStructuralPlotBg(e.currentTarget.value)}
                />
              </div>
              <div class="mt-0.5 flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!ps.plotBgCustomized}
                  onclick={clearStructuralPlotBgCustom}
                >Auto</Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onclick={applyStructuralPlotColorsToAllTypes}
                  title="Copy this plot's background and text colors to every structural analysis type"
                >All types</Button>
              </div>
              <p class="sidebar-hint">Auto follows light/dark theme.</p>
            </div>
            <div>
              <p class="sidebar-label mb-0.5">Text/axes color</p>
              <div class="flex items-center gap-1">
                <input
                  type="color"
                  value={resolvedStructColors.textColor}
                  class="h-7 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                  oninput={(e) => setStructuralTextColor(e.currentTarget.value)}
                />
                <Input
                  size="sm"
                  value={ps.textColorCustomized ? ps.textColor : ''}
                  placeholder={resolvedStructColors.textColor}
                  className="min-w-0 flex-1 font-mono"
                  oninput={(e) => setStructuralTextColor(e.currentTarget.value)}
                />
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={!ps.textColorCustomized}
                onclick={clearStructuralTextColorCustom}
              >Auto</Button>
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
              <p class="sidebar-label">Area per lipid series (this set)</p>
              <p class="sidebar-hint">
                Average uses the set color. Upper/lower colors and labels apply only to the selected set.
              </p>
              {#if activeAnalysisSet}
                <div class="col-span-2 grid grid-cols-1 gap-1">
                  <div>
                    <p class="sidebar-label mb-0.5">Average label</p>
                    <Input
                      size="sm"
                      blurOnEnter
                      value={activeAnalysisSet.aplMeanLabel ?? ''}
                      placeholder="Average"
                      className="w-full"
                      oninput={(e) =>
                        patchAnalysisSet(activeAnalysisSet.id, {
                          aplMeanLabel: e.currentTarget.value
                        })}
                      onblur={applyChartAppearance}
                    />
                  </div>
                  <div>
                    <p class="sidebar-label mb-0.5">Upper leaflet label</p>
                    <Input
                      size="sm"
                      blurOnEnter
                      value={activeAnalysisSet.aplUpperLabel ?? ''}
                      placeholder="Upper leaflet"
                      className="w-full"
                      oninput={(e) =>
                        patchAnalysisSet(activeAnalysisSet.id, {
                          aplUpperLabel: e.currentTarget.value
                        })}
                      onblur={applyChartAppearance}
                    />
                  </div>
                  <div>
                    <p class="sidebar-label mb-0.5">Lower leaflet label</p>
                    <Input
                      size="sm"
                      blurOnEnter
                      value={activeAnalysisSet.aplLowerLabel ?? ''}
                      placeholder="Lower leaflet"
                      className="w-full"
                      oninput={(e) =>
                        patchAnalysisSet(activeAnalysisSet.id, {
                          aplLowerLabel: e.currentTarget.value
                        })}
                      onblur={applyChartAppearance}
                    />
                  </div>
                </div>
              {/if}
              <div class="grid grid-cols-2 gap-1">
                <div>
                  <p class="sidebar-label mb-0.5">Average line</p>
                  <Select
                    size="sm"
                    className="w-full"
                    value={ps.aplMeanLineStyle || 'solid'}
                    onchange={(e) => {
                      ps.aplMeanLineStyle = /** @type {HTMLSelectElement} */ (e.currentTarget).value
                      applyChartAppearance()
                    }}
                  >
                    <option value="solid">Solid</option>
                    <option value="dashed">Dashed</option>
                    <option value="dotted">Dotted</option>
                    <option value="dashdot">Dash-dot</option>
                  </Select>
                </div>
                <div>
                  <p class="sidebar-label mb-0.5">Average marker</p>
                  <Select
                    size="sm"
                    className="w-full"
                    value={ps.aplMeanMarker || 'none'}
                    onchange={(e) => {
                      ps.aplMeanMarker = /** @type {HTMLSelectElement} */ (e.currentTarget).value
                      applyChartAppearance()
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
                  <p class="sidebar-label mb-0.5">Average marker every N points</p>
                  <Input
                    size="sm"
                    type="number"
                    min="1"
                    max="9999"
                    step="1"
                    bind:value={ps.aplMeanMarkerEvery}
                    className="w-full"
                    onchange={() => applyChartAppearance()}
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
                      applyChartAppearance()
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
                      applyChartAppearance()
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
                  <p class="sidebar-label mb-0.5">Upper color (this set)</p>
                  <div class="flex items-center gap-1">
                    <input
                      type="color"
                      value={activeAnalysisSet ? aplSeriesColor(activeAnalysisSet, 'upper') : '#f59e0b'}
                      class="h-7 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                      oninput={(e) => {
                        if (!activeAnalysisSet) return
                        patchAnalysisSet(activeAnalysisSet.id, {
                          aplUpperColor: e.currentTarget.value
                        })
                      }}
                    />
                    <Input
                      size="sm"
                      blurOnEnter
                      value={activeAnalysisSet?.aplUpperColor || ''}
                      placeholder={activeAnalysisSet?.color || '#f59e0b'}
                      className="min-w-0 flex-1 font-mono"
                      oninput={(e) => {
                        if (!activeAnalysisSet) return
                        patchAnalysisSet(activeAnalysisSet.id, {
                          aplUpperColor: e.currentTarget.value
                        })
                      }}
                      onblur={applyChartAppearance}
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
                    onchange={() => applyChartAppearance()}
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
                      applyChartAppearance()
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
                      applyChartAppearance()
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
                  <p class="sidebar-label mb-0.5">Lower color (this set)</p>
                  <div class="flex items-center gap-1">
                    <input
                      type="color"
                      value={activeAnalysisSet ? aplSeriesColor(activeAnalysisSet, 'lower') : '#f59e0b'}
                      class="h-7 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                      oninput={(e) => {
                        if (!activeAnalysisSet) return
                        patchAnalysisSet(activeAnalysisSet.id, {
                          aplLowerColor: e.currentTarget.value
                        })
                      }}
                    />
                    <Input
                      size="sm"
                      blurOnEnter
                      value={activeAnalysisSet?.aplLowerColor || ''}
                      placeholder={activeAnalysisSet?.color || '#f59e0b'}
                      className="min-w-0 flex-1 font-mono"
                      oninput={(e) => {
                        if (!activeAnalysisSet) return
                        patchAnalysisSet(activeAnalysisSet.id, {
                          aplLowerColor: e.currentTarget.value
                        })
                      }}
                      onblur={applyChartAppearance}
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
                    onchange={() => applyChartAppearance()}
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
                    onchange={() => applyChartAppearance()}
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
                    onchange={() => applyChartAppearance()}
                  />
                </div>
              </div>
            </div>
            <p class="sidebar-hint">
              With no exclude selection, a flat mean APL is expected when the lateral box is fixed
              (e.g. NVT): Voronoi areas sum to L<sub>x</sub>·L<sub>y</sub>, so mean ≈ box area /
              n<sub>lipids</sub>. With protein exclusion enabled, mean APL is reduced by the protein
              footprint. Leaflets can still fluctuate. Check the backend log for box vs mean APL
              diagnostics.
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
          <div class="grid grid-cols-2 gap-1">
            <div>
              <p class="sidebar-label mb-0.5">Legend square (px)</p>
              <Input
                size="sm"
                type="number"
                min="6"
                max="28"
                step="1"
                bind:value={ps.legendSwatchSize}
                className="w-full"
              />
            </div>
            <div>
              <p class="sidebar-label mb-0.5">Legend font (px)</p>
              <Input
                size="sm"
                type="number"
                min="7"
                max="22"
                step="1"
                bind:value={ps.legendFontSize}
                className="w-full"
              />
            </div>
            <div>
              <p class="sidebar-label mb-0.5">Axis font (px)</p>
              <Input
                size="sm"
                type="number"
                min="7"
                max="22"
                step="1"
                bind:value={ps.axisFontSize}
                className="w-full"
              />
            </div>
            <div>
              <p class="sidebar-label mb-0.5">Title font (px)</p>
              <Input
                size="sm"
                type="number"
                min="8"
                max="28"
                step="1"
                bind:value={ps.titleFontSize}
                className="w-full"
              />
            </div>
          </div>
          {/if}

          {#if mode === 'energetic'}
          <div class="grid grid-cols-2 gap-1">
            <div>
              <p class="sidebar-label mb-0.5">Legend square (px)</p>
              <Input
                size="sm"
                type="number"
                min="6"
                max="28"
                step="1"
                bind:value={ePlotGlobal.legendSwatchSize}
                className="w-full"
              />
            </div>
            <div>
              <p class="sidebar-label mb-0.5">Legend font (px)</p>
              <Input
                size="sm"
                type="number"
                min="7"
                max="22"
                step="1"
                bind:value={ePlotGlobal.legendFontSize}
                className="w-full"
              />
            </div>
            <div>
              <p class="sidebar-label mb-0.5">Axis font (px)</p>
              <Input
                size="sm"
                type="number"
                min="7"
                max="22"
                step="1"
                bind:value={ePlotGlobal.axisFontSize}
                className="w-full"
              />
            </div>
            <div>
              <p class="sidebar-label mb-0.5">Title font (px)</p>
              <Input
                size="sm"
                type="number"
                min="8"
                max="28"
                step="1"
                bind:value={ePlotGlobal.titleFontSize}
                className="w-full"
              />
            </div>
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
                  sPlots = {
                    ...sPlots,
                    [structuralType]: {
                      ...structDefaults,
                      ...(structuralType === 'area_per_lipid' ? { yUnit: 'Å²' } : {})
                    }
                  }
                  bumpPlotData()
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

    <OutputPathFields
      bind:parentDir={outputParentDir}
      bind:folderName={outputFolderName}
      workingDir={workingDir}
      folderPlaceholder={suggestedOutputFolderName}
      resolvedFolderName={resolveOutputFolderName()}
    />

    {#if resolvedOutputParent === ''}
      <p class="gw-notice gw-notice-warning">
        Set a <strong>Working Directory</strong> in the top bar, or browse an output path, to write analysis output.
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
          <div class="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="outline" onclick={cancelAnalysis}>Cancel</Button>
            <Spinner />
          </div>
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

    {#if running}
      <Button className="w-full" variant="outline" onclick={cancelAnalysis}>
        Cancel analysis
      </Button>
    {/if}

    <div class="space-y-1">
      <p class="sidebar-label">Export chart</p>
      <Input
        type="text"
        size="sm"
        bind:value={exportFileName}
        className="w-full"
        placeholder={exportBaseName()}
        disabled={exportingChart}
        title="File name for CSV, SVG, and PNG (without extension). Empty uses the chart title."
      />
      <div class="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="outline"
          className="min-w-0 flex-1"
          onclick={exportCsv}
          disabled={displaySeries.length === 0 || exportingChart}
          title="Export plotted series as CSV. Column names include the set when several sets are shown."
        >
          {#if exportingKind === 'csv'}
            <Spinner className="mr-1" />Saving…
          {:else}
            CSV
          {/if}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="min-w-0 flex-1"
          onclick={exportSvg}
          disabled={!canExportOnscreenChart || exportingChart}
          title="Save the on-screen chart as SVG. Separate panels become one file per panel (set name in the file name)."
        >
          {#if exportingKind === 'svg'}
            <Spinner className="mr-1" />Saving…
          {:else}
            SVG
          {/if}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="min-w-0 flex-1"
          onclick={exportPng}
          disabled={!canExportOnscreenChart || exportingChart}
          title="Save the on-screen chart as PNG. Separate panels become one file per panel (set name in the file name)."
        >
          {#if exportingKind === 'png'}
            <Spinner className="mr-1" />Saving…
          {:else}
            PNG
          {/if}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="min-w-0 flex-1"
          onclick={exportPublicationPng}
          disabled={!canExportPublicationPng || exportingChart}
          title="Matplotlib / API style. Includes every visible set in the legend."
        >
          {#if exportingKind === 'pub'}
            <Spinner className="mr-1" />Saving…
          {:else}
            Pub PNG
          {/if}
        </Button>
      </div>
    </div>

    {#if analysisActionNotice}
      <p class="gw-notice gw-notice-success text-[11px] leading-snug">{analysisActionNotice}</p>
    {/if}

    <Button className="w-full" variant="ghost" onclick={onClear}>Clear</Button>
  </aside>

  <!-- ===== CHART AREA ===== -->
  <div
    class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    style={paneBackgroundStyle}
  >
    {#if plotViewBusy || structuralTypeChanging}
      <div
        class="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-neutral-950/35"
        style="backdrop-filter:blur(1px)"
        aria-live="polite"
        aria-busy="true"
      >
        <div
          class="flex items-center gap-2 rounded-lg border border-neutral-600/50 bg-neutral-900/90 px-4 py-2 text-sm text-neutral-100 shadow-lg"
        >
          <Spinner className="size-5 text-blue-400" />
          <span>{plotViewBusyLabel}</span>
        </div>
      </div>
    {/if}
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
        {#if mode === 'energetic' && selectedProperties.length === 0 && analysisSets.some((s) => s.energeticResult)}
          No properties checked — mark a property to show it on the chart.
        {:else if mode === 'energetic' && energeticMultiSetSession && visibleCompareSets.length === 0 && analysisSets.some((s) => s.energeticResult)}
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
      <div
        class="mx-4 mb-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
        bind:this={plotExportRoot}
      >
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

        {#key `${compareLayout}-${energeticCompareLayout}-${plotDataRevision}-${structuralType}-${mode}-${chartView.mode}-${chartView.series.length}-${energeticLayout}-${energeticPanels.length}-${selectedProperties.join('|')}-${compareEnergeticProperties.join('|')}`}
        {#if mode === 'structural' && chartView.mode === 'grid'}
          <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {#each chartView.panels as panel (panel.key)}
              <div class="rounded-lg border border-neutral-800 p-2" data-chart-export={panel.title}>
                <LineChart
                  series={panel.series}
                  xLabel={displayXLabel}
                  yLabel={displayYLabel}
                  plotBg={resolvedStructColors.plotBg}
                  tickColor={resolvedStructColors.textColor}
                  labelColor={resolvedStructColors.textColor}
                  axisColor={resolvedStructColors.textColor}
                  gridColor={resolvedStructColors.textColor + '40'}
                  showGrid={ps.showGrid}
                  aspectRatio={Number(ps.aspectRatio) || 2.5}
                  transparentBg={ps.transparentBg}
                  fontFamily={ps.fontFamily || 'Roboto, sans-serif'}
                  chartTitle={panel.title}
                  chartSubtitle={displayTitle}
                  xTickLabels={displayXTickLabels}
                  xTicks={Number(ps.xTickCount) || 5}
                  yTicks={Number(ps.yTickCount) || 5}
                  xTickDecimals={ps.xTickDecimals}
                  yTickDecimals={ps.yTickDecimals}
                  extraLeftMargin={Number(ps.extraLeftMargin) || 0}
                  extraBottomMargin={Number(ps.extraBottomMargin) || 0}
                  legendPosition={ps.legendPosition || 'top-left'}
                  legendSwatchSize={Number(ps.legendSwatchSize) || 12}
                  legendFontSize={Number(ps.legendFontSize) || 10}
                  axisFontSize={Number(ps.axisFontSize) || 12}
                  titleFontSize={Number(ps.titleFontSize) || 13}
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
          <div data-chart-export="">
          <LineChart
            series={displaySeries}
            xLabel={displayXLabel}
            yLabel={displayYLabel}
            plotBg={resolvedStructColors.plotBg}
            tickColor={resolvedStructColors.textColor}
            labelColor={resolvedStructColors.textColor}
            axisColor={resolvedStructColors.textColor}
            gridColor={resolvedStructColors.textColor + '40'}
            showGrid={ps.showGrid}
            aspectRatio={Number(ps.aspectRatio) || 2.5}
            transparentBg={ps.transparentBg}
            fontFamily={ps.fontFamily || 'Roboto, sans-serif'}
            chartTitle={displayTitle}
            chartSubtitle={displaySubtitle}
            xTickLabels={displayXTickLabels}
            xTicks={Number(ps.xTickCount) || 5}
            yTicks={Number(ps.yTickCount) || 5}
            xTickDecimals={ps.xTickDecimals}
            yTickDecimals={ps.yTickDecimals}
            extraLeftMargin={Number(ps.extraLeftMargin) || 0}
            extraBottomMargin={Number(ps.extraBottomMargin) || 0}
            legendPosition={ps.legendPosition || 'top-left'}
            legendSwatchSize={Number(ps.legendSwatchSize) || 12}
            legendFontSize={Number(ps.legendFontSize) || 10}
            axisFontSize={Number(ps.axisFontSize) || 12}
            titleFontSize={Number(ps.titleFontSize) || 13}
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
            {@const titleResolved = energeticPanelChartTitle(panel, pset)}
            <div data-chart-export={titleResolved || panel.title || ''}>
            <LineChart
              series={panel.series}
              xLabel={displayXLabel}
              yLabel={energeticPanelYLabel(panel, pset)}
              plotBg={resolvedEnergColors.plotBg}
              tickColor={resolvedEnergColors.textColor}
              labelColor={resolvedEnergColors.textColor}
              axisColor={resolvedEnergColors.textColor}
              gridColor={(ePlotGlobal.gridColor || resolvedEnergColors.textColor) + '40'}
              showGrid={ePlotGlobal.showGrid !== false}
              aspectRatio={Number(energPanelShell.aspectRatio) || 2.5}
              fontFamily={ePlotGlobal.fontFamily || 'Roboto, sans-serif'}
              chartTitle={titleResolved}
              xTicks={Number(ePlotGlobal.xTickCount) || 5}
              yTicks={Number(ePlotGlobal.yTickCount) || 5}
              xTickDecimals={ePlotGlobal.xTickDecimals}
              yTickDecimals={ePlotGlobal.yTickDecimals}
              extraLeftMargin={Number(ePlotGlobal.extraLeftMargin) || 0}
              legendPosition={ePlotGlobal.legendPosition || energPanelShell.legendPosition || 'top-left'}
              legendSwatchSize={Number(ePlotGlobal.legendSwatchSize) || 12}
              legendFontSize={Number(ePlotGlobal.legendFontSize) || 10}
              axisFontSize={Number(ePlotGlobal.axisFontSize) || 12}
              titleFontSize={Number(ePlotGlobal.titleFontSize) || 13}
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
                  data-chart-export={titleResolved || panel.title || ''}
                  onclick={() => focusPanel(propKey || pk)}
                  onkeydown={(e) => e.key === 'Enter' && focusPanel(propKey || pk)}
                >
                  <LineChart
                    series={panel.series}
                    xLabel={displayXLabel}
                    yLabel={yLabelResolved}
                    plotBg={resolvedEnergColors.plotBg}
                    tickColor={resolvedEnergColors.textColor}
                    labelColor={resolvedEnergColors.textColor}
                    axisColor={resolvedEnergColors.textColor}
                    gridColor={(ePlotGlobal.gridColor || resolvedEnergColors.textColor) + '40'}
                    showGrid={ePlotGlobal.showGrid !== false}
                    aspectRatio={Number(energPanelShell.aspectRatio) || 2.5}
                    fontFamily={ePlotGlobal.fontFamily || 'Roboto, sans-serif'}
                    chartTitle={titleResolved}
                    xTicks={Number(ePlotGlobal.xTickCount) || 5}
                    yTicks={Number(ePlotGlobal.yTickCount) || 5}
                    xTickDecimals={ePlotGlobal.xTickDecimals}
                    yTickDecimals={ePlotGlobal.yTickDecimals}
                    extraLeftMargin={Number(ePlotGlobal.extraLeftMargin) || 0}
                    legendPosition={ePlotGlobal.legendPosition || energPanelShell.legendPosition || 'top-left'}
                    legendSwatchSize={Number(ePlotGlobal.legendSwatchSize) || 12}
                    legendFontSize={Number(ePlotGlobal.legendFontSize) || 10}
                    axisFontSize={Number(ePlotGlobal.axisFontSize) || 12}
                    titleFontSize={Number(ePlotGlobal.titleFontSize) || 13}
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
                    <th class="px-2 py-1 font-medium"
                      >{mode === 'energetic'
                        ? energeticMultiSetSession
                          ? 'Set · Property'
                          : 'Property'
                        : analysisSets.length > 1
                          ? 'Set'
                          : 'Series'}</th
                    >
                    <th class="px-2 py-1 font-medium">Mean</th>
                    <th class="px-2 py-1 font-medium">Std</th>
                    <th class="px-2 py-1 font-medium">Min</th>
                    <th class="px-2 py-1 font-medium">Max</th>
                  </tr>
                </thead>
                <tbody>
                  {#each chartStatsRows as row (row.id)}
                    {#if row.stats && row.stats.count > 0}
                      <tr class="border-b border-neutral-200/70 last:border-0 dark:border-neutral-800/70">
                        <td class="px-2 py-1">
                          <span class="inline-flex items-center gap-1.5">
                            <span
                              class="inline-block h-2 w-2 shrink-0 rounded-full"
                              style={`background:${row.color}`}
                            ></span>
                            <span class="truncate text-neutral-300" title={row.name}>{row.name}</span>
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
