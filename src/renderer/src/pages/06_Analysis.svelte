<script>
  import { tick, untrack } from 'svelte'
  import { flip } from 'svelte/animate'
  import Beaker from '../components/icons/Beaker.svelte'
  import Protein from '../components/icons/Protein.svelte'
  import TopologyInfoModal from '../components/TopologyInfoModal.svelte'
  import OutputPathFields from '../components/OutputPathFields.svelte'
  import ResizableSidePanel from '../components/ResizableSidePanel.svelte'
  import { requestSidePanelExpand } from '../lib/pageSidePanelStore.svelte.js'
  import Button from '../components/ui/Button.svelte'
  import Checkbox from '../components/ui/Checkbox.svelte'
  import Divider from '../components/ui/Divider.svelte'
  import { analysisStatus, logEvent } from '../lib/pageStatus.svelte.js'
  import { defaultPeptideExcludeSelection, peptideOrProteinSelection } from '../lib/peptideResidues.js'
  import { liveReorderAtMidpoint, LIST_REORDER_FLIP } from '../lib/liveListReorder.js'
  import Input from '../components/ui/Input.svelte'
  import Select from '../components/ui/Select.svelte'
  import Spinner from '../components/ui/Spinner.svelte'
  import LineChart from '../components/LineChart.svelte'
  import AnalysisGridCell from '../components/AnalysisGridCell.svelte'
  import ChartLegend from '../components/ChartLegend.svelte'
  import OrderedSetChips from '../components/OrderedSetChips.svelte'
  import ColorInput from '../components/ui/ColorInput.svelte'
  import Layers from '../components/icons/Layers.svelte'
  import Grid2x2Plus from '../components/icons/Grid2x2Plus.svelte'
  import Gear from '../components/icons/Gear.svelte'
  import ChevronDown from '../components/icons/ChevronDown.svelte'
  import {
    analyzeTopology,
    countAnalysisSelection,
    detectLipidHeadgroups,
    ensureOutputFolder,
    getEnergeticProperties,
    getFatslimStatus,
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
    aplMethodUsesExcludeCutoff,
    createAnalysisSet,
    defaultSelectionForStructuralType,
    duplicateAnalysisSet,
    assignCsvStems,
    aplRoleIsVisible,
    aplSeriesColor,
    aplSeriesLabel,
    extraSeriesRole,
    getSetStructuralResult,
    getSetStructuralResultTypes,
    isBilayerStructuralType,
    looksLikeBilayerHeadgroupSelection,
    looksLikeProteinSelection,
    normalizeAplMethod,
    normalizeAnalysisFileRow,
    normalizeAnalysisSetStructuralResults,
    newSetId,
    resolveStructuralTypeSelection,
    setHasResult,
    STRUCTURAL_TYPE_GROUPS,
    STRUCTURAL_TYPE_TITLES as STRUCTURAL_TYPE_TITLE_MAP,
    structuralMeanY,
    structuralResultNeedsCsvHydration,
    structuralSetHasPlottableResult
  } from '../lib/analysisSets.js'
  import {
    navigateToAnalysisOption,
    rankAnalysisOptions,
    ANALYSIS_OPTIONS_CATALOG
  } from '../lib/analysisOptionsCatalog.js'
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
  import {
    normalizeResidueMappingGroups,
    parseResidueMappingText,
    remapResidueTypeLabels,
    remapResidsToOriginal,
    serializeResidueMappingGroups,
    topologyResidsFromRmsfResult
  } from '../lib/residueMapping.js'
  import {
    defaultGridLayout,
    ensureGridCellsForSets,
    autoFillEnergeticGrid,
    autoFillEnergeticGridBySet,
    ensureEnergeticGridCells,
    normalizeGridLayout,
    normalizeReferenceLines,
    emptyReferenceLine,
    normalizeReferenceBands,
    emptyReferenceBand,
    coerceReferenceBandBound,
    finalizeReferenceBands,
    cellLabelVisibility,
    cellShowsLegend,
    mosaicRows,
    autoFillGridLayout,
    normalizeIdList,
    resizeGridCells,
    concatInSetIdOrder,
    figureLegendItems,
    seedManualLegendItemsFromSeries,
    normalizeManualLegendItems,
    LEGEND_MARKERS,
    moveIdInList,
    outsideLegendAlignClasses,
    estimateOutsideLegendNaturalBox,
    gridSpecSlices,
    syncOrderedIds,
    visibleSetIds,
    gridCellEmptyReason,
    cellOverride,
    mergeCellPlotSettings,
    guiSvgFontToMpl,
    patchCellPlotOverride,
    clearCellPlotKeysFromOverrides,
    CELL_PLOT_KEYS,
    ENERGETIC_CELL_PLOT_KEYS,
    strokeDashForStyle,
    lineChartAxisProps,
    plotSpecAxisChrome,
    lineChartExtraMarginProps,
    plotSpecExtraMargins,
    lineChartPanelLetterProps,
    plotSpecPanelLetter,
    mosaicPanelLetterPadStyle,
    outsidePanelLetterBadge,
    activeGridCells,
    clampCellCount,
    resolveCellCountOnResize,
    gridCapacity
  } from '../lib/analysisGridLayout.js'
  import {
    applyPlotSourcesToResult,
    capturePlotSourceFiles
  } from '../lib/analysisPlotSources.js'
  import {
    energeticEnginesToTry,
    inferEnergeticEngineFromLogText,
    remapEnergeticSeries,
    remapPropertyList,
    seriesMatchesProperty,
    setHasEnergeticProperty,
    unionEnergeticProperties
  } from '../lib/energeticProperties.js'
  import { themeState } from '../lib/theme.svelte.js'
  import { themeBackgroundHex } from '../lib/viewerSettings.svelte.js'

  /** @type {{ workingDir?: string, pageActive?: boolean }} */
  let { workingDir = '', pageActive = true } = $props()

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
  let selection = $state(`${peptideOrProteinSelection()} and backbone`)
  let selection2 = $state(`${peptideOrProteinSelection()} and resid 50`)
  /** @type {number | null} */
  let selectionAtomCount = $state(null)
  /** @type {number | null} */
  let selection2AtomCount = $state(null)
  let selectionCountLoading = $state(false)
  let selectionCountError = $state('')
  let referenceFrame = $state('0')
  let referenceStructurePath = $state('')
  let align = $state(true)
  let rmsfXaxisType = $state('residue_number')
  /**
   * One or more prep renum maps, each applied to selected analysis sets.
   * @type {Array<{
   *   id: string,
   *   path: string,
   *   enabled: boolean,
   *   setIds: string[],
   *   map: Map<number, number>,
   *   error: string,
   *   usefulCount: number
   * }>}
   */
  let residueMappingGroups = $state([])
  let leafletLipidSel = $state('')
  let leafletFilterSel = $state('')
  let nBins = $state('1')
  /** Non-lipid atoms for protein/peptide-aware APL (empty = no exclusion). */
  let excludeSel = $state(defaultPeptideExcludeSelection())
  let excludeCutoff = $state(APL_METHOD_DEFAULTS.excludeCutoff)
  let excludeDim = $state(APL_METHOD_DEFAULTS.excludeDim)
  let aplMethod = $state(APL_METHOD_DEFAULTS.aplMethod)
  let fatslimNthreads = $state(APL_METHOD_DEFAULTS.fatslimNthreads)
  let fatslimJobs = $state(APL_METHOD_DEFAULTS.fatslimJobs)
  /** @type {boolean | null} null = not checked / checking */
  let fatslimAvailable = $state(/** @type {boolean | null} */ (null))
  let fatslimStatusChecking = $state(false)
  let gridmatN = $state(APL_METHOD_DEFAULTS.gridmatN)
  let gridmatPrecision = $state(APL_METHOD_DEFAULTS.gridmatPrecision)
  let gridmatMdJobs = $state(APL_METHOD_DEFAULTS.gridmatMdJobs)
  let vtmcNSamples = $state(APL_METHOD_DEFAULTS.vtmcNSamples)
  let vtmcProteinRadius = $state(APL_METHOD_DEFAULTS.vtmcProteinRadius)
  const aplMethodHint = $derived(
    APL_METHODS.find((item) => item.id === aplMethod)?.hint || ''
  )
  const showAplExcludeCutoff = $derived(aplMethodUsesExcludeCutoff(aplMethod))

  $effect(() => {
    if (structuralType !== 'area_per_lipid' || normalizeAplMethod(aplMethod) !== 'fatslim') {
      return
    }
    let cancelled = false
    fatslimStatusChecking = true
    getFatslimStatus()
      .then((res) => {
        if (cancelled) return
        fatslimAvailable = Boolean(res?.available)
      })
      .catch(() => {
        if (cancelled) return
        fatslimAvailable = false
      })
      .finally(() => {
        if (!cancelled) fatslimStatusChecking = false
      })
    return () => {
      cancelled = true
    }
  })

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
  /** Custom mosaic + overlay series order (session-persisted). */
  let gridLayout = $state(defaultGridLayout())
  let plotLayoutOptionsOpen = $state(false)
  /** Bound to the right options panel; true when dragged to the thin rail. */
  let plotLayoutOptionsCollapsed = $state(false)
  let plotSettingsAdvancedOpen = $state(false)
  /** Collapsible Plot Settings sections (Limits + Appearance default open). */
  let plotSectionOpen = $state({
    limits: true,
    appearance: true,
    series: false,
    legend: false,
    typography: false,
    margins: false,
    advanced: false
  })
  let optionsSearchQuery = $state('')
  let optionsSearchOpen = $state(false)
  let optionsSearchHighlightId = $state(/** @type {string | null} */ (null))
  let optionsSearchHighlightTimer = $state(/** @type {ReturnType<typeof setTimeout> | null} */ (null))
  /** Mosaic cell selected for per-cell plot settings (0-based). */
  let selectedGridCell = $state(0)
  /** Which mosaic cell has the sets/order popover open (`null` = closed). */
  let gridCellEditorOpen = $state(/** @type {number | null} */ (null))
  /** Wheel/box-zoom window; not the Plot Settings min/max fields. */
  let structViewRange = $state(
    /** @type {{ xMin: number, xMax: number, yMin: number, yMax: number } | null} */ (null)
  )
  /** @type {Record<string, { xMin: number, xMax: number, yMin: number, yMax: number }>} */
  let energViewRangeByKey = $state({})
  let resetMenuOpen = $state(false)
  let resetMenuWrapEl = $state(/** @type {HTMLElement | null} */ (null))
  /** Energetic overlay vs custom mosaic (session-persisted). */
  let energeticCompareLayout = $state(
    /** @type {import('../lib/analysisSession.js').EnergeticCompareLayout} */ ('grid')
  )
  let energeticGridLayout = $state(defaultGridLayout())
  /** Used only when loading old sessions that have no energeticGridLayout. */
  let energeticGridFill = $state(
    /** @type {import('../lib/analysisSession.js').EnergeticGridFill} */ ('by_property')
  )
  /**
   * Energetic chart snapshot — parallel to structural chartView.
   * @type {{ mode: 'empty' | 'overlay' | 'grid', series: object[], panels: object[] }}
   */
  let energeticChartView = $state({ mode: 'empty', series: [], panels: [] })
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
  /** @type {'current' | 'all' | 'selected'} */
  let runAnalysisScope = $state('current')
  /** Set ids to run when scope is `selected`. */
  let runAnalysisSelectedIds = $state(/** @type {string[]} */ ([]))
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
    const ids = new Set(analysisSets.map((s) => s.id))
    const next = runAnalysisSelectedIds.filter((id) => ids.has(id))
    if (next.length !== runAnalysisSelectedIds.length) {
      runAnalysisSelectedIds = next
    }
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

  function bumpPlotData(changedSetIds) {
    plotDataRevision += 1
    syncChartViewFromSets(changedSetIds)
    syncEnergeticChartViewFromSets()
    syncEnergeticGeom()
  }

  /**
   * Flush pending UI without hanging forever if an $effect loop never settles.
   * @param {number} [ms]
   */
  function flushUi(ms = 50) {
    return Promise.race([
      tick(),
      new Promise((resolve) => setTimeout(resolve, ms))
    ])
  }

  /**
   * Snapshot chart series/panels from analysisSets into plain chartView state.
   * Must be called after any load/store/visibility/layout change.
   * @param {string[] | undefined} changedSetIds when set, reuse other grid panels' series arrays
   */
  function syncChartViewFromSets(changedSetIds) {
    if (mode !== 'structural') {
      return
    }
    try {
      const type = structuralType
      const layout = compareLayout
      const setsPlain = analysisSets
      const byId = new Map(setsPlain.map((s) => [s.id, s]))
      const allIds = setsPlain.map((s) => s.id)
      const changed = changedSetIds == null ? null : new Set(changedSetIds)

      const seriesBySetId = {}
      for (const set of setsPlain) {
        const res = getSetStructuralResult(normalizeAnalysisSetStructuralResults(set), type)
        if (!res) continue
        seriesBySetId[set.id] = buildStructuralSeries(set, res, { prefixSetName: false })
      }

      const seriesForIds = (ids, prefixIfMulti) => {
        const ordered = ids.filter((id) => byId.has(id))
        const prefix = prefixIfMulti && ordered.length > 1
        const chunks = {}
        for (const id of ordered) {
          const raw = seriesBySetId[id]
          if (!raw?.length) continue
          const set = byId.get(id)
          chunks[id] = prefix
            ? buildStructuralSeries(set, getSetStructuralResult(normalizeAnalysisSetStructuralResults(set), type), {
                prefixSetName: true
              })
            : raw
        }
        return concatInSetIdOrder(ordered, chunks)
      }

      if (layout === 'grid') {
        const cells = activeGridCells(gridLayout)
        const prevPanels = chartView.panels || []
        const panels = cells.map((cell, i) => {
          const ids = cell.setIds || []
          const visibleIds = visibleSetIds(ids, setsPlain)
          const prev = prevPanels[i]
          const sameIds =
            prev &&
            Array.isArray(prev.setIds) &&
            prev.setIds.length === ids.length &&
            prev.setIds.every((id, j) => id === ids[j])
          const sameVisible =
            prev &&
            Array.isArray(prev.visibleSetIds) &&
            prev.visibleSetIds.length === visibleIds.length &&
            prev.visibleSetIds.every((id, j) => id === visibleIds[j])
          if (changed && sameIds && sameVisible && !ids.some((id) => changed.has(id))) {
            return prev
          }
          const series = seriesForIds(visibleIds, true)
          const names = visibleIds
            .map((id) => {
              const set = byId.get(id)
              return set ? setLegendName(set) : ''
            })
            .filter(Boolean)
          const title = String(cell.title || '').trim() || names.join(', ')
          const emptyReason = gridCellEmptyReason(ids, visibleIds, series.length)
          return {
            key: `cell-${i}`,
            cellIndex: i,
            title: title || `Panel ${i + 1}`,
            series,
            setIds: ids,
            visibleSetIds: visibleIds,
            empty: series.length === 0,
            emptyReason
          }
        })
        chartView = {
          mode: 'grid',
          series: panels.flatMap((p) => p.series),
          panels
        }
        return
      }

      const overlayIds = syncOrderedIds(gridLayout.overlaySetIds, allIds)
      const visibleIds = overlayIds.filter((id) => {
        const set = byId.get(id)
        return set && set.visible && structuralSetHasPlottableResult(set, type)
      })
      if (visibleIds.length === 0) {
        chartView = { mode: 'empty', series: [], panels: [] }
        return
      }
      const series = seriesForIds(visibleIds, true)
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
   * Snapshot energetic overlay/grid from analysisSets into energeticChartView.
   */
  function syncEnergeticChartViewFromSets() {
    if (mode !== 'energetic') return
    try {
      const setsPlain = analysisSets
      const byId = new Map(setsPlain.map((s) => [s.id, s]))
      const allIds = setsPlain.map((s) => s.id)
      const props = compareEnergeticProperties
      const seriesFor = (setIds, propertyKeys, nameMode) => {
        const visibleIds = visibleSetIds(setIds, setsPlain).filter((id) => {
          const set = byId.get(id)
          return set && energeticResultHasPlotData(set.energeticResult)
        })
          const keys = normalizeIdList(propertyKeys)
        return visibleIds.flatMap((id) =>
          seriesFromEnergeticSet(byId.get(id), keys, {
            maxPoints: DEFAULT_CHART_MAX_POINTS,
            colorBySet: visibleIds.length > 1,
            nameMode
          })
        )
      }

      if (energeticCompareLayout === 'grid') {
        const cells = activeGridCells(energeticGridLayout)
        const panels = cells.map((cell, i) => {
          const ids = cell.setIds || []
          const cellProps =
            (cell.propertyKeys || []).length > 0
              ? cell.propertyKeys
              : props.filter((p) =>
                  ids.some((id) => setHasEnergeticProperty(byId.get(id), p))
                )
          const visibleIds = visibleSetIds(ids, setsPlain)
          const multiSet = visibleIds.length > 1
          const multiProp = cellProps.length > 1
          const nameMode = multiSet && multiProp ? 'set_prop' : multiSet ? 'set' : 'prop'
          const series = seriesFor(ids, cellProps, nameMode)
          const title =
            String(cell.title || '').trim() ||
            (cellProps.length === 1 ? cellProps[0] : cellProps.join(', ')) ||
            visibleIds
              .map((id) => {
                const set = byId.get(id)
                return set ? setLegendName(set) : ''
              })
              .filter(Boolean)
              .join(', ')
          return {
            key: `energ-cell-${i}`,
            cellIndex: i,
            title: title || `Panel ${i + 1}`,
            series,
            setIds: ids,
            propertyKeys: cellProps,
            visibleSetIds: visibleIds,
            empty: series.length === 0,
            emptyReason: gridCellEmptyReason(ids, visibleIds, series.length)
          }
        })
        energeticChartView = {
          mode: 'grid',
          series: panels.flatMap((p) => p.series),
          panels
        }
        return
      }

      const overlayIds = syncOrderedIds(energeticGridLayout.overlaySetIds, allIds)
      const visibleIds = overlayIds.filter((id) => {
        const set = byId.get(id)
        return set && set.visible && energeticResultHasPlotData(set.energeticResult)
      })
      if (visibleIds.length === 0 || props.length === 0) {
        energeticChartView = { mode: 'empty', series: [], panels: [] }
        return
      }
      const nameMode =
        visibleIds.length > 1 && props.length > 1
          ? 'set_prop'
          : visibleIds.length > 1
            ? 'set'
            : 'prop'
      const series = seriesFor(visibleIds, props, nameMode)
      energeticChartView = { mode: series.length ? 'overlay' : 'empty', series, panels: [] }
    } catch (err) {
      logEvent(
        'error',
        'analysis',
        'Failed to rebuild energetic chart view',
        err instanceof Error ? err.message : String(err)
      )
      energeticChartView = { mode: 'empty', series: [], panels: [] }
    }
  }

  function analysisSetIds() {
    return analysisSets.map((s) => s.id)
  }

  function syncSetsIntoGridLayout() {
    gridLayout = ensureGridCellsForSets(gridLayout, analysisSetIds())
    syncSetsIntoEnergeticGridLayout()
  }

  /** Layout chrome (gap, ticks, legend placement) — live, no chart remount. */
  function patchGridChrome(partial) {
    if (mode === 'energetic') {
      patchEnergeticGridChrome(partial)
      return
    }
    gridLayout = normalizeGridLayout({ ...gridLayout, ...partial })
    markSessionDirty()
  }

  function toggleLayoutOptionsPanel() {
    if (!plotLayoutOptionsOpen) {
      plotLayoutOptionsOpen = true
      plotLayoutOptionsCollapsed = false
      queueMicrotask(() => requestSidePanelExpand('analysis-grid'))
      return
    }
    if (plotLayoutOptionsCollapsed) {
      plotLayoutOptionsCollapsed = false
      requestSidePanelExpand('analysis-grid')
      return
    }
    plotLayoutOptionsOpen = false
  }

  /** Outside-strip font/swatch: mosaic override, else plot settings. */
  function outsideLegendFontSize(layout) {
    const n = Number(layout?.legendFontSize)
    if (Number.isFinite(n) && n > 0) return n
    return Number(ps.legendFontSize) || Number(ePlotGlobal.legendFontSize) || 10
  }

  function outsideLegendSwatchSize(layout) {
    const n = Number(layout?.legendSwatchSize)
    if (Number.isFinite(n) && n > 0) return n
    return Number(ps.legendSwatchSize) || Number(ePlotGlobal.legendSwatchSize) || 12
  }

  function outsideLegendSwatchWidth(layout) {
    const n = Number(layout?.legendSwatchWidth)
    if (Number.isFinite(n) && n > 0) return n
    return outsideLegendSwatchSize(layout)
  }

  function outsideLegendSwatchHeight(layout) {
    const n = Number(layout?.legendSwatchHeight)
    if (Number.isFinite(n) && n > 0) return n
    return outsideLegendSwatchSize(layout)
  }

  /** Shared ChartLegend chrome props for the outside strip. */
  function outsideLegendTitleFontSize(layout) {
    const n = Number(layout?.legendTitleFontSize)
    if (Number.isFinite(n) && n > 0) return n
    return outsideLegendFontSize(layout)
  }

  function outsideLegendTitleGap(layout) {
    const raw = layout?.legendTitleGap
    if (raw == null || raw === '') return 8
    const n = Number(raw)
    return Number.isFinite(n) ? Math.max(0, n) : 8
  }

  /** Natural outer box size for the current outside legend (seeds auto → fixed). */
  function outsideLegendNaturalBox(layout = activeMosaicLayout) {
    return estimateOutsideLegendNaturalBox({
      series: outsideLegendSeries,
      columns: Number(layout?.legendColumns) || 1,
      title: layout?.legendTitle || '',
      fontSize: outsideLegendFontSize(layout),
      titleFontSize: outsideLegendTitleFontSize(layout),
      titleGap: outsideLegendTitleGap(layout),
      swatchWidth: outsideLegendSwatchWidth(layout),
      swatchHeight: outsideLegendSwatchHeight(layout),
      boxPadding:
        layout?.legendBoxPadding == null || layout?.legendBoxPadding === ''
          ? 8
          : Number(layout.legendBoxPadding) || 0,
      boxBorderWidth: Math.max(0, Number(layout?.legendBoxBorderWidth) || 0)
    })
  }

  /** Shared ChartLegend chrome props for the outside strip. */
  function outsideLegendChrome(layout) {
    const padRaw = layout?.legendBoxPadding
    const pad =
      padRaw == null || padRaw === ''
        ? 8
        : Math.max(0, Number(padRaw) || 0)
    return {
      fontSize: outsideLegendFontSize(layout),
      titleFontSize: outsideLegendTitleFontSize(layout),
      titleGap: outsideLegendTitleGap(layout),
      swatchSize: outsideLegendSwatchSize(layout),
      swatchWidth: outsideLegendSwatchWidth(layout),
      swatchHeight: outsideLegendSwatchHeight(layout),
      swatchRound: layout?.legendSwatchRound !== false,
      boxRound: layout?.legendBoxRound !== false,
      boxBorderColor: String(layout?.legendBoxBorderColor || ''),
      boxBorderWidth: Math.max(0, Number(layout?.legendBoxBorderWidth) || 0),
      boxPadding: pad,
      boxMinWidth: Math.max(0, Number(layout?.legendBoxMinWidth) || 0),
      boxMinHeight: Math.max(0, Number(layout?.legendBoxMinHeight) || 0)
    }
  }

  /**
   * Commit box width/height. When leaving auto, seed from the current natural
   * legend size (font + labels + swatches) so the spinner does not jump to a tiny value.
   * @param {'legendBoxMinWidth' | 'legendBoxMinHeight'} key
   * @param {string} raw
   * @param {'input' | 'focus'} [reason]
   */
  function commitLegendBoxDim(key, raw, reason = 'input') {
    const trimmed = String(raw ?? '').trim()
    const prev = String(activeMosaicLayout?.[key] ?? '').trim()
    if (trimmed === '') {
      patchGridChrome({ [key]: '' })
      return
    }
    const n = Number(trimmed)
    if (!Number.isFinite(n) || n <= 0) {
      patchGridChrome({ [key]: '' })
      return
    }
    if (!prev) {
      const nat = outsideLegendNaturalBox(activeMosaicLayout)
      const seed = key === 'legendBoxMinWidth' ? nat.width : nat.height
      // Focus on empty field → fill natural size. Tiny first spinner step → bump to natural.
      if (reason === 'focus' || n < seed * 0.5) {
        patchGridChrome({ [key]: String(seed) })
        return
      }
    }
    patchGridChrome({ [key]: String(Math.round(n)) })
  }

  /**
   * Switch Entries → Manual; seed from unique mosaic colors when empty.
   * @param {string} value
   */
  function setLegendEntriesMode(value) {
    const layout = activeMosaicLayout
    const next = String(value || 'sets')
    if (next === 'manual') {
      const existing = normalizeManualLegendItems(layout.legendManualItems)
      if (existing.length) {
        patchGridChrome({ legendEntries: 'manual' })
        return
      }
      const series = mode === 'energetic' ? energeticChartView.series : chartView.series
      patchGridChrome({
        legendEntries: 'manual',
        legendManualItems: seedManualLegendItemsFromSeries(series)
      })
      return
    }
    patchGridChrome({ legendEntries: next })
  }

  /**
   * @param {number} index
   * @param {Record<string, unknown>} partial
   */
  function patchManualLegendItem(index, partial) {
    const layout = activeMosaicLayout
    const items = normalizeManualLegendItems(layout.legendManualItems).map((row, i) =>
      i === index ? { ...row, ...partial } : row
    )
    patchGridChrome({ legendManualItems: items, legendEntries: 'manual' })
  }

  function addManualLegendItem() {
    const layout = activeMosaicLayout
    const items = normalizeManualLegendItems(layout.legendManualItems)
    const n = items.length + 1
    items.push({
      id: `leg-${Date.now().toString(36)}-${n}`,
      label: `Series ${n}`,
      color: '#f59e0b',
      marker: 'none',
      markerSize: 8,
      visible: true
    })
    patchGridChrome({ legendManualItems: items, legendEntries: 'manual' })
  }

  /** @param {number} index */
  function removeManualLegendItem(index) {
    const layout = activeMosaicLayout
    const items = normalizeManualLegendItems(layout.legendManualItems).filter((_, i) => i !== index)
    patchGridChrome({ legendManualItems: items, legendEntries: 'manual' })
  }

  /**
   * @param {number} index
   * @param {-1 | 1} dir
   */
  function moveManualLegendItem(index, dir) {
    const layout = activeMosaicLayout
    const ids = normalizeManualLegendItems(layout.legendManualItems).map((r) => r.id)
    const order = moveIdInList(ids, index, dir)
    const byId = new Map(normalizeManualLegendItems(layout.legendManualItems).map((r) => [r.id, r]))
    const items = order.map((id) => byId.get(id)).filter(Boolean)
    patchGridChrome({ legendManualItems: items, legendEntries: 'manual' })
  }

  function reseedManualLegendFromMosaic() {
    const series = mode === 'energetic' ? energeticChartView.series : chartView.series
    patchGridChrome({
      legendEntries: 'manual',
      legendManualItems: seedManualLegendItemsFromSeries(series)
    })
  }

  function setGridColsRows(cols, rows) {
    if (mode === 'energetic') {
      setEnergeticGridColsRows(cols, rows)
      return
    }
    const nextCols = Math.max(1, Math.min(8, Math.round(Number(cols) || gridLayout.cols)))
    const nextRows = Math.max(1, Math.min(16, Math.round(Number(rows) || gridLayout.rows)))
    const cellCount = resolveCellCountOnResize(
      gridLayout.cellCount,
      gridLayout.cols,
      gridLayout.rows,
      nextCols,
      nextRows
    )
    let next = normalizeGridLayout({
      ...gridLayout,
      cols: nextCols,
      rows: nextRows,
      cellCount,
      cells: resizeGridCells(gridLayout.cells, nextCols, nextRows)
    })
    if (!next.edited) next = autoFillGridLayout(next, analysisSetIds())
    gridLayout = next
    const n = clampCellCount(next.cellCount, next.cols, next.rows)
    if (selectedGridCell >= n) selectedGridCell = n - 1
    if (gridCellEditorOpen != null && gridCellEditorOpen >= n) gridCellEditorOpen = null
    markSessionDirty()
    bumpPlotData()
  }

  function addGridColumn() {
    setGridColsRows((Number(activeMosaicLayout.cols) || 1) + 1, activeMosaicLayout.rows)
  }

  function removeGridColumn() {
    setGridColsRows((Number(activeMosaicLayout.cols) || 1) - 1, activeMosaicLayout.rows)
  }

  function addGridRow() {
    setGridColsRows(activeMosaicLayout.cols, (Number(activeMosaicLayout.rows) || 1) + 1)
  }

  function removeGridRow() {
    setGridColsRows(activeMosaicLayout.cols, (Number(activeMosaicLayout.rows) || 1) - 1)
  }

  /** Tick step from plot settings (empty = use tick count). */
  function plotTickStep(axis) {
    return axis === 'x' ? ps.xTickStep : ps.yTickStep
  }

  function setOverlaySetIds(ids) {
    if (mode === 'energetic') {
      setEnergeticOverlaySetIds(ids)
      return
    }
    const nextIds = syncOrderedIds(ids, analysisSetIds())
    if (
      nextIds.length === (gridLayout.overlaySetIds || []).length &&
      nextIds.every((id, i) => id === gridLayout.overlaySetIds[i])
    ) {
      return
    }
    gridLayout = normalizeGridLayout({ ...gridLayout, overlaySetIds: nextIds })
    markSessionDirty()
    bumpPlotData()
  }

  function setCellSetIds(index, ids) {
    const prev = gridLayout.cells?.[index]?.setIds || []
    const nextIds = ids
    if (
      prev.length === nextIds.length &&
      prev.every((id, i) => id === nextIds[i])
    ) {
      return
    }
    const cells = (gridLayout.cells || []).map((c, i) =>
      i === index ? { ...c, setIds: ids } : c
    )
    gridLayout = normalizeGridLayout({ ...gridLayout, cells, edited: true })
    markSessionDirty()
    bumpPlotData()
  }

  function setCellTitle(index, title) {
    const cells = (gridLayout.cells || []).map((c, i) =>
      i === index ? { ...c, title } : c
    )
    gridLayout = normalizeGridLayout({ ...gridLayout, cells, edited: true })
    if (chartView.panels[index]) {
      const ids = chartView.panels[index].setIds || []
      const names = ids
        .map((id) => {
          const set = analysisSets.find((s) => s.id === id)
          return set ? setLegendName(set) : ''
        })
        .filter(Boolean)
      chartView.panels[index].title = String(title || '').trim() || names.join(', ') || `Panel ${index + 1}`
    }
    markSessionDirty()
  }

  function resetGridToAuto() {
    if (mode === 'energetic') {
      resetEnergeticGridToAuto()
      return
    }
    const ids = analysisSetIds()
    const cols = gridLayout.cols || 2
    const rows = Math.max(1, Math.ceil(Math.max(ids.length, 1) / cols))
    gridLayout = autoFillGridLayout({ ...gridLayout, cols, rows, edited: false }, ids)
    markSessionDirty()
    bumpPlotData()
  }

  function energeticPropertyKeys() {
    const union = unionEnergeticProperties(analysisSets)
    return union.length ? union : remapPropertyList(availableProperties)
  }

  function syncSetsIntoEnergeticGridLayout() {
    energeticGridLayout = ensureEnergeticGridCells(
      energeticGridLayout,
      analysisSetIds(),
      energeticPropertyKeys(),
      energeticGridFill
    )
  }

  function patchEnergeticGridChrome(partial) {
    energeticGridLayout = normalizeGridLayout({ ...energeticGridLayout, ...partial })
    markSessionDirty()
  }

  function setEnergeticGridColsRows(cols, rows) {
    const nextCols = Math.max(1, Math.min(8, Math.round(Number(cols) || energeticGridLayout.cols)))
    const nextRows = Math.max(1, Math.min(16, Math.round(Number(rows) || energeticGridLayout.rows)))
    const cellCount = resolveCellCountOnResize(
      energeticGridLayout.cellCount,
      energeticGridLayout.cols,
      energeticGridLayout.rows,
      nextCols,
      nextRows
    )
    let next = normalizeGridLayout({
      ...energeticGridLayout,
      cols: nextCols,
      rows: nextRows,
      cellCount,
      cells: resizeGridCells(energeticGridLayout.cells, nextCols, nextRows)
    })
    if (!next.edited) {
      next =
        energeticGridFill === 'by_set'
          ? autoFillEnergeticGridBySet(next, analysisSetIds(), energeticPropertyKeys())
          : autoFillEnergeticGrid(next, analysisSetIds(), energeticPropertyKeys())
    }
    energeticGridLayout = next
    const n = clampCellCount(next.cellCount, next.cols, next.rows)
    if (selectedGridCell >= n) selectedGridCell = n - 1
    if (gridCellEditorOpen != null && gridCellEditorOpen >= n) gridCellEditorOpen = null
    markSessionDirty()
    bumpPlotData()
  }

  /** @param {number|string} raw */
  function setActiveGridCellCount(raw) {
    if (mode === 'energetic') {
      const cellCount = clampCellCount(raw, energeticGridLayout.cols, energeticGridLayout.rows)
      energeticGridLayout = normalizeGridLayout({
        ...energeticGridLayout,
        cellCount,
        edited: true
      })
      if (selectedGridCell >= cellCount) selectedGridCell = cellCount - 1
      if (gridCellEditorOpen != null && gridCellEditorOpen >= cellCount) gridCellEditorOpen = null
      markSessionDirty()
      bumpPlotData()
      return
    }
    const cellCount = clampCellCount(raw, gridLayout.cols, gridLayout.rows)
    gridLayout = normalizeGridLayout({
      ...gridLayout,
      cellCount,
      edited: true
    })
    if (selectedGridCell >= cellCount) selectedGridCell = cellCount - 1
    if (gridCellEditorOpen != null && gridCellEditorOpen >= cellCount) gridCellEditorOpen = null
    markSessionDirty()
    bumpPlotData()
  }

  function addEnergeticGridColumn() {
    setEnergeticGridColsRows((Number(energeticGridLayout.cols) || 1) + 1, energeticGridLayout.rows)
  }
  function removeEnergeticGridColumn() {
    setEnergeticGridColsRows((Number(energeticGridLayout.cols) || 1) - 1, energeticGridLayout.rows)
  }
  function addEnergeticGridRow() {
    setEnergeticGridColsRows(energeticGridLayout.cols, (Number(energeticGridLayout.rows) || 1) + 1)
  }
  function removeEnergeticGridRow() {
    setEnergeticGridColsRows(energeticGridLayout.cols, (Number(energeticGridLayout.rows) || 1) - 1)
  }

  function setEnergeticOverlaySetIds(ids) {
    const nextIds = syncOrderedIds(ids, analysisSetIds())
    if (
      nextIds.length === (energeticGridLayout.overlaySetIds || []).length &&
      nextIds.every((id, i) => id === energeticGridLayout.overlaySetIds[i])
    ) {
      return
    }
    energeticGridLayout = normalizeGridLayout({
      ...energeticGridLayout,
      overlaySetIds: nextIds
    })
    markSessionDirty()
    bumpPlotData()
  }

  function setEnergeticCellSetIds(index, ids) {
    const cells = (energeticGridLayout.cells || []).map((c, i) =>
      i === index ? { ...c, setIds: ids } : c
    )
    energeticGridLayout = normalizeGridLayout({
      ...energeticGridLayout,
      cells,
      edited: true
    })
    energeticGridFill = 'by_property'
    markSessionDirty()
    bumpPlotData()
  }

  function setEnergeticCellPropertyKeys(index, keys) {
    const cells = (energeticGridLayout.cells || []).map((c, i) =>
      i === index ? { ...c, propertyKeys: keys } : c
    )
    energeticGridLayout = normalizeGridLayout({
      ...energeticGridLayout,
      cells,
      edited: true
    })
    energeticGridFill = 'by_property'
    markSessionDirty()
    bumpPlotData()
  }

  function setEnergeticCellTitle(index, title) {
    const cells = (energeticGridLayout.cells || []).map((c, i) =>
      i === index ? { ...c, title } : c
    )
    energeticGridLayout = normalizeGridLayout({
      ...energeticGridLayout,
      cells,
      edited: true
    })
    if (energeticChartView.panels[index]) {
      energeticChartView.panels[index].title =
        String(title || '').trim() || energeticChartView.panels[index].title
    }
    markSessionDirty()
  }

  function resetEnergeticGridToAuto() {
    const ids = analysisSetIds()
    const props = energeticPropertyKeys()
    const cols = energeticGridLayout.cols || 2
    const rows = Math.max(1, Math.ceil(Math.max(props.length, 1) / cols))
    energeticGridFill = 'by_property'
    energeticGridLayout = autoFillEnergeticGrid(
      { ...energeticGridLayout, cols, rows, edited: false },
      ids,
      props
    )
    markSessionDirty()
    bumpPlotData()
  }

  function patchReferenceLines(next) {
    const lines = normalizeReferenceLines(next)
    if (mode === 'energetic') {
      ePlotGlobal = { ...ePlotGlobal, referenceLines: lines }
      markSessionDirty()
      return
    }
    patchStructuralPlot({ referenceLines: lines })
  }

  function patchReferenceBands(next) {
    const bands = normalizeReferenceBands(next)
    if (mode === 'energetic') {
      ePlotGlobal = { ...ePlotGlobal, referenceBands: bands }
      markSessionDirty()
      return
    }
    patchStructuralPlot({ referenceBands: bands })
  }

  /** @param {unknown} raw */
  function publicationReferenceLines(raw) {
    return normalizeReferenceLines(raw).map((line) => ({
      axis: line.axis,
      value: line.value,
      color: line.color,
      width: line.width,
      style: line.style,
      label: line.label,
      opacity: line.opacity,
      z_order: line.zOrder
    }))
  }

  /** @param {unknown} raw */
  function publicationReferenceBands(raw) {
    return finalizeReferenceBands(raw).map((band) => ({
      axis: band.axis,
      min: band.min,
      max: band.max,
      color: band.color,
      opacity: band.opacity,
      z_order: band.zOrder,
      border: band.border,
      border_color: band.borderColor,
      border_width: band.borderWidth,
      border_style: band.borderStyle,
      label: band.label
    }))
  }

  /** Display names matching the Structural Options dropdown. */
  const STRUCTURAL_TYPE_TITLES = STRUCTURAL_TYPE_TITLE_MAP

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
    let lineStyle = sp.lineStyle || 'solid'
    let marker = 'none'
    let markerEvery = 1
    if (isApl) {
      if (role === 'mean') {
        lineStyle = sp.aplMeanLineStyle || sp.lineStyle || 'solid'
        marker = sp.aplMeanMarker || 'none'
        markerEvery = Math.max(1, Math.floor(Number(sp.aplMeanMarkerEvery) || 10))
      } else if (role === 'upper' || role === 'lower') {
        color = aplSeriesColor(set, role)
        lineStyle =
          role === 'upper' ? sp.aplUpperLineStyle || 'dashed' : sp.aplLowerLineStyle || 'dotted'
        marker =
          role === 'upper' ? sp.aplUpperMarker || 'none' : sp.aplLowerMarker || 'none'
        markerEvery = Math.max(
          1,
          Math.floor(
            Number(role === 'upper' ? sp.aplUpperMarkerEvery : sp.aplLowerMarkerEvery) || 10
          )
        )
      } else {
        lineStyle = sp.lineStyle || 'dashed'
        markerEvery = 10
      }
    }
    return {
      name,
      color,
      lineStyle,
      strokeDasharray: strokeDashForStyle(lineStyle, Number(sp.lineWidth) || 2),
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
    // Drop cached series copies so grid cells pick up new set colors.
    cellLineCache = new WeakMap()
    const lists = [chartView.series, ...chartView.panels.map((p) => p.series)]
    if (lists.some((list) => list.some((s) => !s.setId))) {
      syncChartViewFromSets()
      return
    }
    const type = structuralType
    const overlayPrefix =
      chartView.mode !== 'grid' &&
      analysisSets.filter((s) => s.visible && structuralSetHasPlottableResult(s, type)).length > 1
    for (const series of chartView.series) {
      const set = analysisSets.find((s) => s.id === series.setId)
      if (!set) continue
      Object.assign(
        series,
        structuralSeriesAppearance(set, series.seriesRole || 'mean', {
          prefixSetName: overlayPrefix,
          extraName: series.extraName || '',
          type
        })
      )
    }
    for (const panel of chartView.panels) {
      const ids = panel.setIds || []
      const names = ids
        .map((id) => {
          const set = analysisSets.find((s) => s.id === id)
          return set ? setLegendName(set) : ''
        })
        .filter(Boolean)
      const cell = gridLayout.cells?.[panel.cellIndex]
      panel.title = String(cell?.title || '').trim() || names.join(', ') || panel.title
      const prefix = ids.length > 1
      for (const series of panel.series) {
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
    }
    // New array identities so Svelte/LineChart see the color change.
    chartView = {
      ...chartView,
      series: chartView.series.map((s) => ({ ...s })),
      panels: chartView.panels.map((p) => ({
        ...p,
        series: (p.series || []).map((s) => ({ ...s }))
      }))
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
    const viewed = applyPlotSourcesToResult(res, set.trajectoryFiles, {
      timeX: res.lastAnalysisHasTimeX === true,
      coordinateOnly: true
    })
    const sp = sPlots[type] || structDefaults
    const xUnit = sp.xUnit || 'ns'
    const yUnit = sp.yUnit || 'Å'
    let xs = viewed.lastAnalysisHasTimeX
      ? convertX(viewed.rawX, 'ns', xUnit)
      : [...(viewed.rawX || [])]
    if (type === 'rmsf' && rmsfXaxisType === 'residue_number') {
      xs = remapRmsfResidueNumbers(viewed, set.id)
    }
    const prefix = opts.prefixSetName === true
    /** @type {Array<{ name: string, x: number[], y: number[], color?: string, strokeDasharray?: string, strokeWidth?: number, marker?: string, markerSize?: number, markerEvery?: number, seriesRole?: string, setId?: string, key?: string, extraName?: string }>} */
    const out = []
    const meanY = structuralMeanY(viewed)
    const includeMean =
      type !== 'area_per_lipid' || aplRoleIsVisible(sp, 'mean')
    if (meanY.length > 0 && includeMean) {
      out.push({
        ...structuralSeriesAppearance(set, 'mean', { prefixSetName: prefix, type }),
        x: xs,
        y: convertStructY(meanY, yUnit, type),
        seriesRole: 'mean',
        setId: set.id,
        key: `${set.id}:mean`
      })
    }
    for (const s of viewed.extraSeries || []) {
      if (!Array.isArray(s.rawY) || s.rawY.length === 0) continue
      const role = extraSeriesRole(s)
      if (type === 'area_per_lipid' && !aplRoleIsVisible(sp, role)) continue
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
   * First enabled mapping group that targets this analysis set.
   * @param {string} setId
   * @returns {{ map: Map<number, number>, force: boolean } | null}
   */
  function residueMappingForSet(setId) {
    for (const g of residueMappingGroups) {
      if (!g.enabled || !g.map?.size) continue
      if (!g.setIds.includes(setId)) continue
      // Never force: already-original / previously remapped axes must not be remapped again.
      return { map: g.map, force: false }
    }
    return null
  }

  /**
   * Remap GateWizard (renumbered) RMSF residue numbers → original PDB ids for a set.
   * Uses topology `resids` when present; never writes remapped ids back into storage.
   * @param {{ resids?: number[], rawX?: number[], xLabels?: string[] }} res
   * @param {string} [setId]
   * @returns {number[]}
   */
  function remapRmsfResidueNumbers(res, setId = '') {
    const topology = topologyResidsFromRmsfResult(res, 'residue_number')
    const fallback = topology.length ? topology : [...(res.rawX || [])]
    const hit = setId ? residueMappingForSet(setId) : null
    if (!hit) return fallback
    return remapResidsToOriginal(topology.length ? topology : fallback, hit.map, {
      force: hit.force
    })
  }

  /**
   * @param {{ resids?: number[], rawX?: number[], xLabels?: string[] }} res
   * @param {string} [setId]
   * @returns {string[]}
   */
  function remapRmsfXLabels(res, setId = '') {
    const labels = res?.xLabels || []
    if (!labels.length) return []
    const hit = setId ? residueMappingForSet(setId) : null
    if (!hit) return [...labels]
    const topology = topologyResidsFromRmsfResult(res, rmsfXaxisType)
    return remapResidueTypeLabels(labels, topology, hit.map, { force: hit.force })
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
      // Stable CSV columns: topology residue ids (never display-remapped).
      // Remap to original PDB numbers only when building chart series.
      let xs = res.rawX || []
      if (type === 'rmsf') {
        const topology = topologyResidsFromRmsfResult(res, 'residue_number')
        if (topology.length) xs = topology
      }
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
      session.energeticCompareLayout ?? 'grid'
    )
    energeticGridFill = session.energeticGridFill === 'by_set' ? 'by_set' : 'by_property'
    outputFolderName = session.outputFolderName || defaultAnalysisFolderName('')
    sessionName = String(session.sessionName || '').trim()
    residueMappingGroups = normalizeResidueMappingGroups(session.residueMappingGroups, {
      residueMappingPath: session.residueMappingPath,
      useOriginalResidueNumbers: session.useOriginalResidueNumbers,
      setIds: (session.sets || []).map((s) => s.id)
    }).map((g) => ({
      ...g,
      map: new Map(),
      error: '',
      usefulCount: 0
    }))
    analysisSets = assignCsvStems(
      (session.sets || []).map((s) => normalizeAnalysisSetStructuralResults(s))
    ).map((s) => {
      if (!s.energeticResult?.rawSeries?.length && !s.energeticOptions) return s
      return {
        ...s,
        energeticResult: s.energeticResult
          ? {
              ...s.energeticResult,
              rawSeries: remapEnergeticSeries(s.energeticResult.rawSeries),
              selectedProperties: remapPropertyList(s.energeticResult.selectedProperties)
            }
          : s.energeticResult,
        energeticOptions: s.energeticOptions
          ? {
              ...s.energeticOptions,
              availableProperties: remapPropertyList(s.energeticOptions.availableProperties),
              selectedProperties: remapPropertyList(s.energeticOptions.selectedProperties)
            }
          : s.energeticOptions
      }
    })
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
    gridLayout = ensureGridCellsForSets(
      session.gridLayout ? normalizeGridLayout(session.gridLayout) : defaultGridLayout(),
      analysisSets.map((s) => s.id)
    )
    energeticGridLayout = ensureEnergeticGridCells(
      session.energeticGridLayout
        ? normalizeGridLayout(session.energeticGridLayout)
        : defaultGridLayout(),
      analysisSets.map((s) => s.id),
      unionEnergeticProperties(analysisSets),
      energeticGridFill
    )
    // Mosaic used to own tick spacing. Copy X only onto time-like plots —
    // never onto RMSF (residue/atom axis); a step like "50" would ignore Tick count.
    const gridXStep = String(gridLayout.xTickStep || '').trim()
    if (gridXStep) {
      const skipGridXStep = new Set(['rmsf'])
      sPlots = Object.fromEntries(
        Object.entries(sPlots).map(([type, plot]) => [
          type,
          skipGridXStep.has(type) || String(plot.xTickStep || '').trim()
            ? plot
            : { ...plot, xTickStep: gridXStep }
        ])
      )
    }
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
      await flushUi(50)
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
      const prevSuppressDirty = suppressSessionDirty
      suppressSessionDirty = true
      try {
        applyAnalysisSession(session)
        applyOutputLocationFromSessionDir(sessionDir)
        await hydrateResidueMappingGroups({ quiet: true })
        if (!hydratedAny) {
          await hydratePlotDataFromOutputFolder([sessionDir])
        }
        if (mode === 'energetic') {
          rebuildEnergeticViewAfterLoad()
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
            bumpPlotData()
          }
        } else {
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
            bumpPlotData()
          }
        }
        persistActiveSetFields()
        rememberSessionSaveFingerprint()
      } finally {
        suppressSessionDirty = prevSuppressDirty
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

  /**
   * Collapse MDAnalysis format dumps and Amber-restart noise into a short line.
   * @param {string} msg
   */
  function shortenAnalysisError(msg) {
    const raw = String(msg || '').trim()
    if (!raw) return raw
    const lower = raw.toLowerCase()
    if (
      lower.includes('rst7') ||
      lower.includes("format 'rst7'") ||
      lower.includes('unknown coordinate trajectory format')
    ) {
      const fileMatch = raw.match(/['"]([^'"]+\.rst7)['"]/i)
      const name = fileMatch ? fileMatch[1].split(/[/\\]/).pop() : '.rst7'
      return (
        `${name} is an Amber restart, not an MD trajectory. Remove it from Trajectories ` +
        'and add production .dcd/.xtc/.trr/.nc files. For RMSD vs a start structure, use Reference PDB.'
      )
    }
    // Drop the long "The FORMATs dict_keys([...]) are implemented..." dump.
    const cut = raw.search(/\n\s*The FORMATs\b|\bdict_keys\(\[/i)
    let out = cut > 0 ? raw.slice(0, cut).trim() : raw
    if (out.length > 420) out = `${out.slice(0, 400).trim()}…`
    return out.replace(/\s+/g, ' ')
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
    lineStyle: 'solid',
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
    extraRightMargin: '0',
    extraTopMargin: '0',
    extraBottomMargin: '0',
    tickLabelGap: '8',
    tickLength: '4',
    tickWidth: '1',
    spineWidth: '1',
    showTicks: true,
    spineLeft: true,
    spineBottom: true,
    spineTop: false,
    spineRight: false,
    gridColor: '',
    legendPosition: 'top-left',
    legendSwatchSize: '12',
    legendFontSize: '10',
    axisFontSize: '12',
    axisFontBold: false,
    titleFontSize: '13',
    xTickCount: '5',
    yTickCount: '5',
    /** Empty = auto tick decimals; 0–8 = fixed places on axis ticks */
    xTickDecimals: '',
    yTickDecimals: '',
    /** Optional data-unit spacing; empty uses tick count. */
    xTickStep: '',
    yTickStep: '',
    residueCodeFormat: 'three',
    /** Show atom/residue selection under the plot title */
    showSelectionSubtitle: true,
    // Area-per-lipid series styling
    aplMeanLineStyle: 'solid',
    aplUpperLineStyle: 'dashed',
    aplLowerLineStyle: 'dotted',
    aplShowMean: true,
    aplShowUpper: true,
    aplShowLower: true,
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
    aplLowerMarkerEvery: '10',
    /** Horizontal/vertical experimental markers for this analysis type */
    referenceLines: [],
    /** Horizontal/vertical shaded bands for this analysis type */
    referenceBands: []
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
    extraLeftMargin: '0',
    extraRightMargin: '0',
    extraTopMargin: '0',
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
    axisFontBold: false,
    titleFontSize: '13',
    xTickCount: '5',
    yTickCount: '5',
    xTickDecimals: '',
    yTickDecimals: '',
    extraLeftMargin: '0',
    extraRightMargin: '0',
    extraTopMargin: '0',
    extraBottomMargin: '0',
    residueCodeFormat: 'three',
    tickLength: '4',
    tickWidth: '1',
    spineWidth: '1',
    showTicks: true,
    spineLeft: true,
    spineBottom: true,
    spineTop: false,
    spineRight: false
  }
  let ePlotGlobal = $state({ ...energGlobalDefaults, ...energPanelShell })
  /** @type {Record<string, ReturnType<typeof defaultPanelSettings>>} */
  let ePlotPanels = $state({})
  /** @type {'none' | 'pan' | 'boxZoom' | 'rangeSelect'} */
  let chartInteractionMode = $state(/** @type {'none' | 'pan' | 'boxZoom' | 'rangeSelect'} */ ('none'))
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
        parts.push(aplMethodLabel(methodId).replace(/\s*\(default[^)]*\)$/i, ''))
        if ((exclude || '').trim()) {
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

  // Derived: active plot settings for the open tab
  const ps = $derived(mode === 'structural' ? sPlots[structuralType] : ePlotGlobal)
  const gridPlotApplyCell = $derived(
    mode === 'structural'
      ? compareLayout === 'grid' && gridLayout.plotApplyScope === 'cell'
      : energeticCompareLayout === 'grid' && energeticGridLayout.plotApplyScope === 'cell'
  )
  const plotEdit = $derived(
    gridPlotApplyCell
      ? mergeCellPlotSettings(
          ps,
          cellOverride(mode === 'energetic' ? energeticGridLayout : gridLayout, selectedGridCell),
          mode === 'energetic' ? ENERGETIC_CELL_PLOT_KEYS : CELL_PLOT_KEYS
        )
      : ps
  )
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
    const runningNow = running
    const modeNow = mode
    const typeNow = mode === 'structural' ? structuralType : 'energetic'
    const resultNow =
      mode === 'structural'
        ? activeStructRes !== null || showStructuralSetOverlay
        : chartSeries.length > 0 || isCompareOverlay
    const errorNow = lastError || ''
    untrack(() => {
      if (
        analysisStatus.running === runningNow &&
        analysisStatus.mode === modeNow &&
        analysisStatus.analysisType === typeNow &&
        analysisStatus.resultAvailable === resultNow &&
        analysisStatus.error === errorNow
      ) {
        return
      }
      analysisStatus.running = runningNow
      analysisStatus.mode = modeNow
      analysisStatus.analysisType = typeNow
      analysisStatus.resultAvailable = resultNow
      analysisStatus.error = errorNow
    })
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
      gridLayout,
      energeticGridLayout,
      structuralType,
      selection,
      selection2,
      selectedProperties,
      availableProperties,
      residueMappingGroups: serializeResidueMappingGroups(residueMappingGroups),
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
      if (sessionActionNotice) sessionActionNotice = ''
    }
    if (sessionSavedClean) sessionSavedClean = false
  }

  /** Snapshot of the UI fields that belong to the current structural type. */
  function snapshotCurrentTypeSelection() {
    return {
      selection,
      selection2,
      referenceFrame,
      referenceStructurePath,
      align,
      rmsfXaxisType,
      leafletLipidSel,
      leafletFilterSel,
      nBins,
      interpolate,
      excludeSel,
      excludeCutoff,
      excludeDim,
      aplMethod,
      fatslimNthreads,
      fatslimJobs,
      gridmatN,
      gridmatPrecision,
      gridmatMdJobs,
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
    if (snap.referenceStructurePath != null)
      referenceStructurePath = String(snap.referenceStructurePath)
    if (snap.align != null) align = Boolean(snap.align)
    if (snap.rmsfXaxisType != null) rmsfXaxisType = snap.rmsfXaxisType
    leafletLipidSel = snap.leafletLipidSel ?? ''
    leafletFilterSel = snap.leafletFilterSel ?? ''
    if (snap.nBins != null) nBins = String(snap.nBins)
    if (snap.interpolate != null) interpolate = Boolean(snap.interpolate)
    excludeSel = snap.excludeSel ?? defaultPeptideExcludeSelection()
    excludeCutoff =
      snap.excludeCutoff != null ? String(snap.excludeCutoff) : APL_METHOD_DEFAULTS.excludeCutoff
    excludeDim =
      snap.excludeDim != null ? String(snap.excludeDim) : APL_METHOD_DEFAULTS.excludeDim
    aplMethod = normalizeAplMethod(snap.aplMethod)
    fatslimNthreads =
      snap.fatslimNthreads != null
        ? String(snap.fatslimNthreads)
        : APL_METHOD_DEFAULTS.fatslimNthreads
    fatslimJobs =
      snap.fatslimJobs != null ? String(snap.fatslimJobs) : APL_METHOD_DEFAULTS.fatslimJobs
    gridmatN = snap.gridmatN != null ? String(snap.gridmatN) : APL_METHOD_DEFAULTS.gridmatN
    gridmatPrecision =
      snap.gridmatPrecision != null ? String(snap.gridmatPrecision) : APL_METHOD_DEFAULTS.gridmatPrecision
    gridmatMdJobs =
      snap.gridmatMdJobs != null ? String(snap.gridmatMdJobs) : APL_METHOD_DEFAULTS.gridmatMdJobs
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
    // Numeric residue / atom axes: never reuse another set's string labels.
    // Shared active-set labels made GateWizard panels show Charmm resids (21…507)
    // and looked like X min/max only applied on the first grid row.
    if (rmsfXaxisType === 'residue_number' || rmsfXaxisType === 'atom_index') return []
    if (rmsfXaxisType !== 'residue_type_number') return activeXLabels
    const activeId = activeSetId || ''
    const labels = activeStructRes ? remapRmsfXLabels(activeStructRes, activeId) : activeXLabels
    if (ps.residueCodeFormat !== 'one') return labels
    return labels.map(toOneLetterResidueLabel)
  })

  /**
   * Per-panel RMSF name labels (ALA21) for grid cells — first set in the cell.
   * @param {{ setIds?: string[], visibleSetIds?: string[] }} panel
   */
  function rmsfXTickLabelsForPanel(panel) {
    if (structuralType !== 'rmsf') return displayXTickLabels
    if (rmsfXaxisType === 'residue_number' || rmsfXaxisType === 'atom_index') return []
    const ids = panel.visibleSetIds?.length
      ? panel.visibleSetIds
      : panel.setIds || []
    for (const id of ids) {
      const set = analysisSets.find((s) => s.id === id)
      const res = resultForSetAndType(set, 'rmsf')
      const labels = res ? remapRmsfXLabels(res, id) : []
      if (Array.isArray(labels) && labels.length) {
        return ps.residueCodeFormat === 'one'
          ? labels.map(toOneLetterResidueLabel)
          : labels
      }
    }
    return displayXTickLabels
  }
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
  const showCompareLayoutControl = $derived(
    analysisSets.length > 1 || (mode === 'structural' && compareLayout === 'grid')
  )
  const gridChipSets = $derived(
    analysisSets.map((s) => ({
      id: s.id,
      label: s.label,
      legendLabel: s.legendLabel
    }))
  )
  const structuralMosaic = $derived(
    mosaicRows(
      chartView.panels,
      gridLayout.cols,
      /** @type {'start' | 'center' | 'end'} */ (gridLayout.lastRowAlign)
    )
  )
  const energeticMosaic = $derived(
    mosaicRows(
      energeticChartView.panels,
      energeticGridLayout.cols,
      /** @type {'start' | 'center' | 'end'} */ (energeticGridLayout.lastRowAlign)
    )
  )
  const activeMosaicLayout = $derived(mode === 'energetic' ? energeticGridLayout : gridLayout)
  /** Plot settings / this-cell merge for Plot bg controls */
  const scopedPlotSettings = $derived.by(() => {
    if (!gridPlotApplyCell) return mode === 'energetic' ? ePlotGlobal : ps
    return cellPlotSettings(selectedGridCell)
  })
  const scopedPlotBgCustomized = $derived(Boolean(scopedPlotSettings.plotBgCustomized))
  const scopedPlotBgValue = $derived(
    scopedPlotBgCustomized ? String(scopedPlotSettings.plotBg || '') : ''
  )
  const scopedPlotBgDisplay = $derived(
    scopedPlotBgCustomized && scopedPlotBgValue
      ? scopedPlotBgValue
      : mode === 'energetic'
        ? resolvedEnergColors.plotBg
        : resolvedStructColors.plotBg
  )
  const toolbarIsGrid = $derived(
    mode === 'energetic' ? energeticCompareLayout === 'grid' : compareLayout === 'grid'
  )
  const gridCellAspect = $derived(
    Number(activeMosaicLayout.aspectRatio) > 0
      ? Number(activeMosaicLayout.aspectRatio)
      : Number(ps.aspectRatio) || Number(energPanelShell.aspectRatio) || 2.5
  )
  const outsideLegendSeries = $derived.by(() => {
    const layout = mode === 'energetic' ? energeticGridLayout : gridLayout
    const series = mode === 'energetic' ? energeticChartView.series : chartView.series
    if (layout.legendMode !== 'outside') return []
    /** @type {Record<string, string>} */
    const setNames = {}
    /** @type {Record<string, string>} */
    const setColors = {}
    for (const s of analysisSets) {
      setNames[s.id] = setLegendName(s)
      setColors[s.id] = s.color
    }
    return figureLegendItems(series, layout, { setNames, setColors })
  })
  const overlayChartLegendPosition = $derived.by(() => {
    const modeLeg = activeMosaicLayout.legendMode
    if (modeLeg === 'outside' || modeLeg === 'none') return 'none'
    if (mode === 'energetic') {
      return ePlotGlobal.legendPosition || energPanelShell.legendPosition || 'top-left'
    }
    return ps.legendPosition || 'top-left'
  })
  const structReferenceLines = $derived(normalizeReferenceLines(ps.referenceLines))
  const structReferenceBands = $derived(normalizeReferenceBands(ps.referenceBands))
  /** Complete bands only — avoid treating a cleared field as 0 while typing. */
  const structReferenceBandsDraw = $derived(finalizeReferenceBands(ps.referenceBands))
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
   * Checkboxes are visibility-only. A checked name plots on every set that has it
   * (union / canonical match — not an intersection of exact strings).
   */
  const compareEnergeticProperties = $derived.by(() => {
    if (mode !== 'energetic') return selectedProperties
    if (selectedProperties.length === 0) return []
    if (energeticMultiSetSession && visibleCompareSets.length === 0) return []
    const sets = energeticMultiSetSession ? visibleCompareSets : analysisSets.filter((s) => s.id === activeSetId)
    return remapPropertyList(selectedProperties).filter((prop) =>
      sets.some((set) => setHasEnergeticProperty(set, prop))
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
    const res = applyPlotSourcesToResult(set.energeticResult, set.energeticOptions?.logFiles, {
      timeX: true,
      coordinateOnly: false
    })
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
      const s = res.rawSeries.find((r) => seriesMatchesProperty(r, prop))
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
    const colorBySet = optsColorBySet(s)
    const color = colorBySet
      ? set?.color
      : ePlotPanels[s.baseName]?.lineColor || set?.color
    const lineStyle = ePlotGlobal.lineStyle || 'solid'
    return {
      name,
      color: color || '#f59e0b',
      strokeWidth: Number(ePlotGlobal.lineWidth) || 2,
      strokeDasharray: strokeDashForStyle(lineStyle, Number(ePlotGlobal.lineWidth) || 2),
      lineStyle
    }
  }

  function energeticNameMode() {
    if (energeticCompareLayout === 'overlay') {
      if (!energeticMultiSetSession) return selectedProperties.length > 1 ? 'prop' : 'prop'
      return selectedProperties.length > 1 ? 'set_prop' : 'set'
    }
    return energeticGridFill === 'by_set' ? 'prop' : 'set'
  }

  function optsColorBySet(s) {
    if (energeticCompareLayout === 'overlay') return energeticMultiSetSession
    const cell = energeticChartView.panels.find((p) =>
      (p.series || []).some((row) => row.key === s.key)
    )
    return (cell?.visibleSetIds || []).length > 1
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
    const visible = rawSeries.filter((s) =>
      selectedProperties.some((p) => seriesMatchesProperty(s, p))
    )
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
      const s = set.energeticResult?.rawSeries?.find((r) => seriesMatchesProperty(r, baseName))
      if (!s) continue
      const tUnit = getTargetUnit(s.unit)
      return tUnit ? `${baseName} (${tUnit})` : baseName
    }
    const local = rawSeries.find((r) => seriesMatchesProperty(r, baseName))
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
    const source = energeticChartView.series.length ? energeticChartView.series : energeticGeom
    return source.map((s) => {
      const set = analysisSets.find((x) => x.id === s.setId)
      const nameMode =
        s.nameMode ||
        (energeticCompareLayout === 'overlay' && energeticMultiSetSession && selectedProperties.length > 1
          ? 'set_prop'
          : energeticNameMode())
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
    if (energeticCompareLayout === 'grid') {
      return energeticChartView.panels || []
    }
    if (displaySeries.length === 0) return []
    return [
      {
        key: '__overlay__',
        title: displayTitle || chartTitle || 'Energetic Analysis',
        series: displaySeries
      }
    ]
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
    if (range.xMin == null && range.xMax == null && range.yMin == null && range.yMax == null) {
      if (!energViewRangeByKey[key]) return
      const next = { ...energViewRangeByKey }
      delete next[key]
      energViewRangeByKey = next
      return
    }
    const view = {
      xMin: range.xMin,
      xMax: range.xMax,
      yMin: range.yMin,
      yMax: range.yMax
    }
    if (ePlotGlobal.syncX !== false && range.xMin != null && range.xMax != null) {
      const next = { ...energViewRangeByKey }
      for (const k of Object.keys(ePlotPanels)) {
        const prev = next[k]
        next[k] = {
          xMin: range.xMin,
          xMax: range.xMax,
          yMin: prev?.yMin ?? range.yMin,
          yMax: prev?.yMax ?? range.yMax
        }
      }
      next[key] = view
      energViewRangeByKey = next
      return
    }
    energViewRangeByKey = { ...energViewRangeByKey, [key]: view }
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
    if (mode === 'structural' || energeticCompareLayout === 'overlay') {
      panelRangeStats = computeMultiSeriesStats(displaySeries, t0, t1)
      return
    }
    const panel =
      energeticPanels.find((p) => p.cellIndex === selectedGridCell) ?? energeticPanels[0]
    if (panel) {
      panelRangeStats = computeMultiSeriesStats(panel.series, t0, t1)
    }
  }

  function applyStructAxisRange(range) {
    if (range.xMin == null && range.xMax == null && range.yMin == null && range.yMax == null) {
      structViewRange = null
      return
    }
    structViewRange = {
      xMin: range.xMin,
      xMax: range.xMax,
      yMin: range.yMin,
      yMax: range.yMax
    }
  }

  function clearChartViewRange() {
    structViewRange = null
    energViewRangeByKey = {}
  }

  function resetChartView() {
    chartInteractionMode = 'none'
    statsRange = null
    panelRangeStats = {}
    statsRangeStartInput = ''
    statsRangeEndInput = ''
    clearChartViewRange()
    resetMenuOpen = false
  }

  function resetChartViewAndLimits() {
    resetChartView()
    if (mode === 'structural') {
      const type = structuralType
      const prev = sPlots[type]
      const plot = { ...prev, xMin: '', xMax: '', yMin: '', yMax: '' }
      if (
        prev &&
        prev.xMin === '' &&
        prev.xMax === '' &&
        prev.yMin === '' &&
        prev.yMax === ''
      ) {
        return
      }
      sPlots = { ...sPlots, [type]: plot }
    } else {
      ePlotGlobal = { ...ePlotGlobal, xMin: '', xMax: '', yMin: '', yMax: '' }
      const next = { ...ePlotPanels }
      for (const k of Object.keys(next)) {
        next[k] = { ...next[k], xMin: '', xMax: '', yMin: '', yMax: '' }
      }
      ePlotPanels = next
      if (gridPlotApplyCell) {
        energeticGridLayout = clearCellPlotKeysFromOverrides(energeticGridLayout, [
          'yMin',
          'yMax'
        ])
      }
    }
  }

  $effect(() => {
    if (!resetMenuOpen) return
    /** @param {PointerEvent} e */
    function onPointerDown(e) {
      const t = e.target
      if (resetMenuWrapEl && t instanceof Node && resetMenuWrapEl.contains(t)) return
      resetMenuOpen = false
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  })

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
      referenceStructurePath,
      align,
      rmsfXaxisType,
      leafletLipidSel,
      leafletFilterSel,
      nBins,
      interpolate,
      excludeSel,
      excludeCutoff,
      excludeDim,
      aplMethod,
      fatslimNthreads,
      fatslimJobs,
      gridmatN,
      gridmatPrecision,
      gridmatMdJobs,
      vtmcNSamples,
      vtmcProteinRadius,
      selectionsByType
    }
  }

  function captureEnergeticOptions() {
    return {
      energeticEngine,
      logFiles: (logFiles || []).map(normalizeAnalysisFileRow),
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
    referenceStructurePath = String(opts.referenceStructurePath || snap.referenceStructurePath || '')
    // Prefer explicit flat fields when they match the active type and are usable
    // (keeps session loads / persist round-trips exact).
    if (opts.structuralType === type && typeof opts.selection === 'string') {
      const flatOk =
        !isBilayerType(type) ||
        (!looksLikeProteinSelection(opts.selection) && Boolean(opts.selection.trim()))
      if (flatOk) {
        selection = opts.selection
        selection2 = opts.selection2
        if (opts.referenceFrame != null) referenceFrame = String(opts.referenceFrame)
        if (opts.referenceStructurePath != null)
          referenceStructurePath = String(opts.referenceStructurePath)
        align = opts.align
        rmsfXaxisType = opts.rmsfXaxisType
        leafletLipidSel = opts.leafletLipidSel
        leafletFilterSel = opts.leafletFilterSel
        nBins = opts.nBins != null ? String(opts.nBins) : nBins
        interpolate = opts.interpolate
        excludeSel = opts.excludeSel ?? defaultPeptideExcludeSelection()
        excludeCutoff =
          opts.excludeCutoff != null ? String(opts.excludeCutoff) : APL_METHOD_DEFAULTS.excludeCutoff
        excludeDim =
          opts.excludeDim != null ? String(opts.excludeDim) : APL_METHOD_DEFAULTS.excludeDim
        aplMethod = normalizeAplMethod(opts.aplMethod)
        fatslimNthreads =
          opts.fatslimNthreads != null
            ? String(opts.fatslimNthreads)
            : APL_METHOD_DEFAULTS.fatslimNthreads
        fatslimJobs =
          opts.fatslimJobs != null ? String(opts.fatslimJobs) : APL_METHOD_DEFAULTS.fatslimJobs
        gridmatN = opts.gridmatN != null ? String(opts.gridmatN) : APL_METHOD_DEFAULTS.gridmatN
        gridmatPrecision =
          opts.gridmatPrecision != null
            ? String(opts.gridmatPrecision)
            : APL_METHOD_DEFAULTS.gridmatPrecision
        gridmatMdJobs =
          opts.gridmatMdJobs != null
            ? String(opts.gridmatMdJobs)
            : APL_METHOD_DEFAULTS.gridmatMdJobs
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
    const o = opts || defaultEnergeticOptionsFallback()
    energeticEngine = o.energeticEngine || 'namd'
    logFiles = (o.logFiles || []).map(normalizeAnalysisFileRow)
    availableProperties = [...(o.availableProperties || [])]
    selectedProperties = [...(o.selectedProperties || [])]
    timeUnits = o.timeUnits || 'ns'
    energyUnits = o.energyUnits || 'kcal/mol'
    pressureUnits = o.pressureUnits || 'atm'
    temperatureUnits = o.temperatureUnits || 'K'
    volumeUnits = o.volumeUnits || 'Å³'
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
    const allNames = remapPropertyList(rawSeries.map((s) => s.baseName).filter(Boolean))
    if (allNames.length) {
      availableProperties = [...new Set([...remapPropertyList(availableProperties), ...allNames])]
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
    availableProperties = remapPropertyList(availableProperties)
    selectedProperties = remapPropertyList(selectedProperties)
    applyEnergeticResultToView(set.energeticResult)
    for (const p of selectedProperties) ensureEPlotPanel(p)
    focusedPanelKey = selectedProperties[0] ?? focusedPanelKey
    syncSetsIntoEnergeticGridLayout()
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
            trajectoryFiles: (trajectoryFiles || []).map(normalizeAnalysisFileRow),
            structuralOptions: captureStructuralOptions(),
            energeticOptions: captureEnergeticOptions()
          }
        : s
    )
  }

  /**
   * Push the sidebar APL method (+ related params) onto the given sets so a batch
   * run cannot silently use each set's older saved method.
   * @param {string[]} setIds
   */
  function stampAplOptionsOntoSets(setIds) {
    if (mode !== 'structural' || structuralType !== 'area_per_lipid') return
    const ids = new Set((setIds || []).map((id) => String(id)).filter(Boolean))
    if (!ids.size) return
    const method = normalizeAplMethod(aplMethod)
    const patch = {
      aplMethod: method,
      excludeSel,
      excludeCutoff,
      excludeDim,
      fatslimNthreads,
      fatslimJobs,
      gridmatN,
      gridmatPrecision,
      gridmatMdJobs,
      vtmcNSamples,
      vtmcProteinRadius
    }
    analysisSets = analysisSets.map((s) => {
      if (!ids.has(s.id)) return s
      const byType = { ...(s.structuralOptions?.selectionsByType || {}) }
      const prev = byType.area_per_lipid || {}
      byType.area_per_lipid = { ...prev, ...patch }
      return {
        ...s,
        structuralOptions: {
          ...s.structuralOptions,
          ...patch,
          structuralType: s.structuralOptions?.structuralType || structuralType,
          selectionsByType: byType
        }
      }
    })
    markSessionDirty()
  }

  /** Apply sidebar APL options to every analysis set (no run). */
  function applyAplMethodToAllSets() {
    persistActiveSetFields()
    stampAplOptionsOntoSets(analysisSets.map((s) => s.id))
  }

  /**
   * Copy the current structural type's selection snapshot onto every set (no run).
   * Does not change topology/trajectories.
   * @param {string[]} setIds
   */
  function stampTypeSelectionOntoSets(setIds) {
    if (mode !== 'structural') return
    const ids = new Set((setIds || []).map((id) => String(id)).filter(Boolean))
    if (!ids.size) return
    const type = structuralType
    const snap = snapshotCurrentTypeSelection()
    analysisSets = analysisSets.map((s) => {
      if (!ids.has(s.id)) return s
      const byType = { ...(s.structuralOptions?.selectionsByType || {}) }
      byType[type] = { ...(byType[type] || {}), ...snap }
      const activeType = s.structuralOptions?.structuralType || type
      const flat =
        activeType === type
          ? {
              selection: snap.selection,
              selection2: snap.selection2,
              referenceFrame: snap.referenceFrame,
              referenceStructurePath: snap.referenceStructurePath,
              align: snap.align,
              rmsfXaxisType: snap.rmsfXaxisType,
              leafletLipidSel: snap.leafletLipidSel,
              leafletFilterSel: snap.leafletFilterSel,
              nBins: snap.nBins,
              interpolate: snap.interpolate,
              excludeSel: snap.excludeSel,
              excludeCutoff: snap.excludeCutoff,
              excludeDim: snap.excludeDim,
              aplMethod: snap.aplMethod,
              fatslimNthreads: snap.fatslimNthreads,
              fatslimJobs: snap.fatslimJobs,
              gridmatN: snap.gridmatN,
              gridmatPrecision: snap.gridmatPrecision,
              gridmatMdJobs: snap.gridmatMdJobs,
              vtmcNSamples: snap.vtmcNSamples,
              vtmcProteinRadius: snap.vtmcProteinRadius
            }
          : {}
      return {
        ...s,
        structuralOptions: {
          ...s.structuralOptions,
          ...flat,
          structuralType: activeType,
          selectionsByType: byType
        }
      }
    })
    markSessionDirty()
  }

  /** Apply current type selection to every analysis set (no run). */
  function applyTypeSelectionToAllSets() {
    persistActiveSetFields()
    stampTypeSelectionOntoSets(analysisSets.map((s) => s.id))
  }

  const optionsSearchHits = $derived.by(() =>
    rankAnalysisOptions(optionsSearchQuery, {
      mode,
      structuralType,
      catalog: ANALYSIS_OPTIONS_CATALOG
    })
  )

  /**
   * @param {import('../lib/analysisOptionsCatalog.js').AnalysisOptionEntry} entry
   */
  async function onPickAnalysisOption(entry) {
    optionsSearchOpen = false
    optionsSearchQuery = entry.label
    await navigateToAnalysisOption(entry, {
      mode,
      structuralType,
      setMode: (m) => onModeChange(m),
      setStructuralType: (t) => onStructuralTypeChange(t),
      openPlotSettings: () => {
        plotSettingsOpen = true
      },
      openPlotSection: (sectionId) => {
        if (sectionId && sectionId in plotSectionOpen) {
          setPlotSectionOpen(/** @type {keyof typeof plotSectionOpen} */ (sectionId), true)
        }
      },
      openStructuralOptions: () => {},
      openGridOptions: () => {
        plotLayoutOptionsOpen = true
        plotLayoutOptionsCollapsed = false
      },
      expandPanel: (panel) => requestSidePanelExpand(panel),
      pulseOption: (id) => pulseOptionHighlight(id)
    })
  }

  /** @param {string} optionId */
  function pulseOptionHighlight(optionId) {
    const id = String(optionId || '').trim()
    if (!id) return
    if (optionsSearchHighlightTimer) clearTimeout(optionsSearchHighlightTimer)
    optionsSearchHighlightId = id

    /** @param {HTMLElement} el */
    function scrollOptionIntoView(el) {
      const scroller =
        el.closest('.overflow-y-auto') ||
        el.closest('.overflow-y-scroll') ||
        el.closest('[class*="overflow-y-auto"]')
      if (scroller instanceof HTMLElement) {
        const er = el.getBoundingClientRect()
        const sr = scroller.getBoundingClientRect()
        // Keep the pulse well inside the panel (not clipped at the edge).
        const pad = Math.max(72, Math.min(140, sr.height * 0.28))
        const nextTop = er.top - sr.top + scroller.scrollTop - pad
        scroller.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' })
        return
      }
      el.scrollIntoView({ block: 'center', behavior: 'smooth', inline: 'nearest' })
    }

    let attempts = 0
    const tryFocus = () => {
      const el = document.querySelector(`[data-option-id="${CSS.escape(id)}"]`)
      if (el instanceof HTMLElement) {
        scrollOptionIntoView(el)
        return
      }
      attempts += 1
      if (attempts < 8) setTimeout(tryFocus, 50)
    }
    queueMicrotask(tryFocus)

    optionsSearchHighlightTimer = setTimeout(() => {
      optionsSearchHighlightId = null
      optionsSearchHighlightTimer = null
    }, 1600)
  }

  /** @param {keyof typeof plotSectionOpen} key */
  function togglePlotSection(key) {
    const next = !plotSectionOpen[key]
    plotSectionOpen = { ...plotSectionOpen, [key]: next }
    if (key === 'advanced') plotSettingsAdvancedOpen = next
  }

  /**
   * @param {keyof typeof plotSectionOpen} key
   * @param {boolean} open
   */
  function setPlotSectionOpen(key, open) {
    plotSectionOpen = { ...plotSectionOpen, [key]: open }
    if (key === 'advanced') plotSettingsAdvancedOpen = open
  }

  /** In-chart legend controls (vs Grid outside strip / none). */
  const showInChartLegendControls = $derived.by(() => {
    const lm = activeMosaicLayout?.legendMode
    if (lm === 'outside' || lm === 'none') return false
    if (!toolbarIsGrid) return true
    return lm === 'each' || lm === 'one'
  })

  /**
   * Stored APL method label for a set (for list badges).
   * @param {import('../lib/analysisSets.js').AnalysisSet} set
   */
  function aplMethodBadgeForSet(set) {
    const opts = set?.structuralOptions
    const snap = opts?.selectionsByType?.area_per_lipid
    const raw = snap?.aplMethod ?? opts?.aplMethod
    const id = normalizeAplMethod(raw)
    return aplMethodLabel(id).replace(/\s*\(default[^)]*\)$/i, '')
  }

  function loadActiveSetFields() {
    const set = analysisSets.find((s) => s.id === activeSetId)
    if (!set) return
    const prevSuppressDirty = suppressSessionDirty
    suppressSessionDirty = true
    try {
      topologyPath = set.topologyPath
      trajectoryFiles = (set.trajectoryFiles || []).map(normalizeAnalysisFileRow)
      applyStructuralOptions(set.structuralOptions)
      applyEnergeticOptions(set.energeticOptions || defaultEnergeticOptionsFallback())
      // outputFolderName is session-level — never reset when switching/adding sets
      headgroupDetectAttempted = lipidHeadgroupAtoms.length > 0
      if (set.structuralResult || set.structuralResults) {
        rebuildStructResultsFromSets()
      }
      if (mode === 'energetic') {
        applyEnergeticResultToView(set.energeticResult)
      }
    } finally {
      suppressSessionDirty = prevSuppressDirty
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
    if (mode === 'energetic') {
      cellLineCache = new WeakMap()
      syncEnergeticChartViewFromSets()
      return
    }
    applyChartAppearance()
  }

  function patchStructuralPlot(patch) {
    const type = structuralType
    sPlots = { ...sPlots, [type]: { ...sPlots[type], ...patch } }
  }

  /**
   * Show or hide Average / Upper / Lower on the APL plot (CSV is unchanged).
   * @param {'mean' | 'upper' | 'lower'} role
   * @param {boolean} visible
   */
  function setAplSeriesVisible(role, visible) {
    const key =
      role === 'upper' ? 'aplShowUpper' : role === 'lower' ? 'aplShowLower' : 'aplShowMean'
    markSessionDirty()
    patchStructuralPlot({ [key]: Boolean(visible) })
    syncChartViewFromSets()
  }

  /**
   * Plot-settings fields that can target every mosaic cell or only the selected one.
   * @param {Record<string, unknown>} patch
   */
  function setPlotField(patch) {
    markSessionDirty()
    const globalOnly = {}
    const rest = { ...patch }
    for (const key of ['xTickStep', 'yTickStep', 'xTickCount', 'yTickCount', 'xTickDecimals', 'yTickDecimals', 'xMin', 'xMax']) {
      if (key in rest) {
        globalOnly[key] = rest[key]
        delete rest[key]
      }
    }
    if (Object.keys(globalOnly).length) {
      if (mode === 'energetic') ePlotGlobal = { ...ePlotGlobal, ...globalOnly }
      else patchStructuralPlot(globalOnly)
    }
    if (Object.keys(rest).length === 0) return
    if (mode === 'energetic') {
      if (gridPlotApplyCell) {
        const n = clampCellCount(
          energeticGridLayout.cellCount,
          energeticGridLayout.cols,
          energeticGridLayout.rows
        )
        const idx = Math.max(0, Math.min(n - 1, selectedGridCell))
        energeticGridLayout = patchCellPlotOverride(energeticGridLayout, idx, rest)
      } else {
        ePlotGlobal = { ...ePlotGlobal, ...rest }
        if (energeticCompareLayout === 'grid') {
          energeticGridLayout = clearCellPlotKeysFromOverrides(
            energeticGridLayout,
            Object.keys(rest)
          )
        }
      }
      if ('lineWidth' in rest || 'lineStyle' in rest) {
        cellLineCache = new WeakMap()
        syncEnergeticChartViewFromSets()
      }
      return
    }
    if (gridPlotApplyCell) {
      const n = clampCellCount(gridLayout.cellCount, gridLayout.cols, gridLayout.rows)
      const idx = Math.max(0, Math.min(n - 1, selectedGridCell))
      gridLayout = patchCellPlotOverride(gridLayout, idx, rest)
    } else {
      patchStructuralPlot(rest)
      if (compareLayout === 'grid') {
        gridLayout = clearCellPlotKeysFromOverrides(gridLayout, Object.keys(rest))
      }
    }
    if ('lineWidth' in rest || 'lineStyle' in rest) {
      cellLineCache = new WeakMap()
      applyChartAppearance()
    }
  }

  /** @param {object} plotSettings */
  function plotGridColor(plotSettings, textColor) {
    const c = String(plotSettings?.gridColor || '').trim()
    return c || `${textColor}40`
  }

  /** @param {number} cellIndex */
  function cellPlotSettings(cellIndex) {
    if (mode === 'energetic') {
      return mergeCellPlotSettings(
        ePlotGlobal,
        cellOverride(energeticGridLayout, cellIndex),
        ENERGETIC_CELL_PLOT_KEYS
      )
    }
    return mergeCellPlotSettings(ps, cellOverride(gridLayout, cellIndex))
  }

  /** @type {WeakMap<object[], { width: number, style: string, type: string, colors: string, out: object[] }>} */
  let cellLineCache = new WeakMap()

  /**
   * Apply per-cell line width/style on top of the type-level series appearance.
   * @param {Array<object>} series
   * @param {object} cps
   * @param {string} type
   */
  function seriesWithCellLine(series, cps, type) {
    const list = series || []
    const width = Number(cps.lineWidth) || 2
    const style = cps.lineStyle || 'solid'
    const colors = list.map((s) => String(s?.color || '')).join('\0')
    const hit = list.length ? cellLineCache.get(list) : null
    if (
      hit &&
      hit.width === width &&
      hit.style === style &&
      hit.type === type &&
      hit.colors === colors
    ) {
      return hit.out
    }
    const out = list.map((s) => {
      const keepRoleDash =
        type === 'area_per_lipid' && (s.seriesRole === 'upper' || s.seriesRole === 'lower')
      return {
        ...s,
        strokeWidth: width,
        strokeDasharray: strokeDashForStyle(keepRoleDash ? s.lineStyle || style : style, width),
        ...(keepRoleDash ? {} : { lineStyle: style })
      }
    })
    if (list.length) cellLineCache.set(list, { width, style, type, colors, out })
    return out
  }

  function setStructuralPlotBg(hex) {
    const raw = String(hex || '').trim()
    if (!raw) {
      setPlotField({ plotBg: '', plotBgCustomized: false })
      return
    }
    setPlotField({
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
    setPlotField({ plotBg: '', plotBgCustomized: false })
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
    if (!raw) {
      setPlotField({ plotBg: '', plotBgCustomized: false })
      return
    }
    setPlotField({
      plotBg: normalizeHexColor(raw, raw),
      plotBgCustomized: true
    })
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
          ...(plotSettings.structural[type] || {}),
          referenceLines: normalizeReferenceLines(
            plotSettings.structural[type]?.referenceLines ?? next[type].referenceLines
          ),
          referenceBands: normalizeReferenceBands(
            plotSettings.structural[type]?.referenceBands ?? next[type].referenceBands
          )
        })
      }
      sPlots = next
    }
    if (plotSettings.energeticGlobal && typeof plotSettings.energeticGlobal === 'object') {
      ePlotGlobal = hydratePlotColorFlags({
        ...energGlobalDefaults,
        ...energPanelShell,
        ...plotSettings.energeticGlobal,
        referenceLines: normalizeReferenceLines(
          plotSettings.energeticGlobal.referenceLines ?? []
        ),
        referenceBands: normalizeReferenceBands(
          plotSettings.energeticGlobal.referenceBands ?? []
        )
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
    void referenceStructurePath
    void align
    void rmsfXaxisType
    void residueMappingGroups
    void leafletLipidSel
    void leafletFilterSel
    void nBins
    void excludeSel
    void excludeCutoff
    void excludeDim
    void aplMethod
    void fatslimNthreads
    void fatslimJobs
    void gridmatN
    void gridmatPrecision
    void gridmatMdJobs
    void vtmcNSamples
    void vtmcProteinRadius
    void interpolate
    void lipidHeadgroupAtoms
    void energeticEngine
    void logFiles
    void selectedProperties
    void sessionName
    void outputFolderName
    if (loadingSession || suppressSessionDirty) return
    markSessionDirty()
  })

  function onModeChange(/** @type {'structural' | 'energetic'} */ next) {
    if (next === mode) return
    clearAnalysisActionNotice()
    lastError = ''
    persistActiveSetFields()
    mode = next
    clearChartViewRange()
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
    markSessionDirty()
    const id = newSetId()
    analysisSets = [...analysisSets, createAnalysisSet(analysisSets.length, id, analysisSets)]
    syncSetsIntoGridLayout()
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
    syncSetsIntoGridLayout()
    activeSetId = copy.id
    loadActiveSetFields()
  }

  function removeAnalysisSet(id) {
    if (analysisSets.length <= 1) return
    markSessionDirty()
    analysisSets = analysisSets.filter((s) => s.id !== id)
    syncSetsIntoGridLayout()
    if (activeSetId === id) {
      activeSetId = analysisSets[0].id
      loadActiveSetFields()
    }
  }

  function toggleSetVisible(id, visible) {
    analysisSets = analysisSets.map((s) => (s.id === id ? { ...s, visible } : s))
    bumpPlotData()
  }

  /** Commit set-list order to overlay layouts + charts (after live drag). */
  function commitAnalysisSetOrder() {
    markSessionDirty()
    const ids = analysisSets.map((s) => s.id)
    syncSetsIntoGridLayout()
    gridLayout = normalizeGridLayout({ ...gridLayout, overlaySetIds: ids })
    energeticGridLayout = normalizeGridLayout({
      ...energeticGridLayout,
      overlaySetIds: ids
    })
    bumpPlotData()
  }

  function onSetDragStart(index, e) {
    const set = analysisSets[index]
    if (!set) return
    setDragId = set.id
    setDragOrderDirty = false
    if (e?.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', set.id)
    }
  }

  function onSetDragOver(e, index) {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    if (!setDragId) return
    const from = analysisSets.findIndex((s) => s.id === setDragId)
    if (from < 0 || from === index) return
    // Only move when the pointer crosses the row midpoint (avoids flicker).
    const el = /** @type {HTMLElement} */ (e.currentTarget)
    const rect = el.getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    if (from < index && e.clientY < midY) return
    if (from > index && e.clientY > midY) return
    const next = [...analysisSets]
    const [item] = next.splice(from, 1)
    next.splice(index, 0, item)
    analysisSets = next
    setDragOrderDirty = true
  }

  function onSetDragEnd() {
    if (setDragOrderDirty) commitAnalysisSetOrder()
    setDragId = null
    setDragOrderDirty = false
  }

  function onDropAnalysisSet(e) {
    e.preventDefault()
    onSetDragEnd()
  }

  /** @param {'overlay' | 'grid'} layout */
  function setActiveCompareLayout(layout) {
    if (mode === 'energetic') {
      setEnergeticCompareLayout(layout)
      return
    }
    setCompareLayout(layout)
  }

  /** @param {'overlay' | 'grid'} layout */
  function setCompareLayout(layout) {
    compareLayout = layout === 'grid' ? 'grid' : 'overlay'
    if (compareLayout !== 'grid') gridCellEditorOpen = null
    if (compareLayout === 'grid' && !gridLayout.edited) {
      gridLayout = autoFillGridLayout(gridLayout, analysisSetIds())
    }
    bumpPlotData()
  }

  /** @param {import('../lib/analysisSession.js').EnergeticCompareLayout | string} layout */
  function setEnergeticCompareLayout(layout) {
    energeticCompareLayout = normalizeEnergeticCompareLayout(layout)
    if (energeticCompareLayout !== 'grid') gridCellEditorOpen = null
    if (energeticCompareLayout === 'grid' && !energeticGridLayout.edited) {
      energeticGridLayout =
        energeticGridFill === 'by_set'
          ? autoFillEnergeticGridBySet(
              energeticGridLayout,
              analysisSetIds(),
              energeticPropertyKeys()
            )
          : autoFillEnergeticGrid(energeticGridLayout, analysisSetIds(), energeticPropertyKeys())
    }
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
    bumpPlotData([activeSetId])
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
    } else {
      await ensureNonBilayerSelectionReady()
    }

    const result = await runStructuralAnalysis(
      {
        topologyPath,
        trajectoryPaths: trajectoryFiles.map((f) => f.path),
        analysisType: structuralType,
        selection,
        selection2,
        referenceFrame: Number(referenceFrame || 0),
        referenceStructure: referenceStructurePath.trim() || null,
        align,
        fileTimes: makeFileTimes(trajectoryFiles),
        fileStrides: makeFileStrides(trajectoryFiles),
        rmsfXaxisType: rmsfXaxisType,
        leafletLipidSel: leafletLipidSel.trim() || null,
        leafletFilterSel: leafletFilterSel.trim() || null,
        nBins: Number(nBins) || 1,
        interpolate,
        excludeSel:
          structuralType === 'area_per_lipid' ? excludeSel.trim() || null : null,
        excludeCutoff:
          structuralType === 'area_per_lipid'
            ? Math.max(0, Number(excludeCutoff) || 0)
            : undefined,
        excludeDim:
          structuralType === 'area_per_lipid'
            ? Number(excludeDim) === 1
              ? 1
              : 3
            : undefined,
        aplMethod: structuralType === 'area_per_lipid' ? aplMethod : undefined,
        fatslimNthreads:
          structuralType === 'area_per_lipid'
            ? (() => {
                const n = Math.trunc(Number(fatslimNthreads))
                return Number.isFinite(n) ? n : 1
              })()
            : undefined,
        fatslimJobs:
          structuralType === 'area_per_lipid'
            ? Math.max(1, Math.trunc(Number(fatslimJobs)) || 1)
            : undefined,
        gridmatN:
          structuralType === 'area_per_lipid'
            ? Math.max(2, Number(gridmatN) || 20)
            : undefined,
        gridmatPrecision:
          structuralType === 'area_per_lipid'
            ? Math.max(0.1, Number(gridmatPrecision) || 13)
            : undefined,
        gridmatMdJobs:
          structuralType === 'area_per_lipid'
            ? Math.max(1, Math.trunc(Number(gridmatMdJobs)) || 8)
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
      resids: result.resids || (structuralType === 'rmsf' ? result.x : null),
      resnames: result.resnames || null,
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
      lastAnalysisHasTimeX: xLabelsResult.length === 0,
      sourceFiles:
        xLabelsResult.length === 0
          ? capturePlotSourceFiles(result.x || [], trajectoryFiles, { coordinateOnly: true })
          : null
    })
  }

  /**
   * Detect native log properties for the active set. Tries the stored engine first,
   * then sniffs the log and the other engines. Returns native names (API labels).
   * @returns {Promise<{ engine: string, properties: string[] }>}
   */
  async function detectNativePropertiesForActiveSet() {
    const paths = logFiles.map((f) => f.path)
    if (paths.length === 0) return { engine: energeticEngine, properties: [] }
    let sniff = ''
    try {
      const text = await window.api.readText(paths[0])
      sniff = inferEnergeticEngineFromLogText(text)
    } catch {
      sniff = ''
    }
    const preferred = sniff || energeticEngine
    let lastErrorMsg = ''
    for (const engine of energeticEnginesToTry(preferred)) {
      try {
        const { properties } = await getEnergeticProperties({
          logPaths: paths,
          fileTimes: makeFileTimes(logFiles),
          engine
        })
        if ((properties || []).length > 0) {
          energeticEngine = engine
          return { engine, properties: properties || [] }
        }
      } catch (error) {
        lastErrorMsg = error instanceof Error ? error.message : String(error)
      }
    }
    throw new Error(lastErrorMsg || 'Could not detect energetic properties for this set.')
  }

  async function runEnergeticForActiveSet() {
    const setLabel = analysisSets.find((s) => s.id === activeSetId)?.label ?? 'Set'
    if (logFiles.length === 0) throw new Error(`Set "${setLabel}": add at least one log file.`)
    const detected = await detectNativePropertiesForActiveSet()
    const propsToAnalyze = detected.properties
    if (propsToAnalyze.length === 0) {
      throw new Error(`Set "${setLabel}": no energetic properties found in the log files.`)
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
        engine: detected.engine
      },
      analysisRunOpts()
    )

    const engineLabels = { namd: 'NAMD', openmm: 'OpenMM', gromacs: 'GROMACS', amber: 'Amber' }
    const rawSeriesLocal = remapEnergeticSeries(
      (result.series || []).map((s) => ({
        baseName: s.name,
        nativeName: s.name,
        unit: s.unit || '',
        y: s.y || [],
        key: s.key
      }))
    )
    const analyzedNames = rawSeriesLocal.map((s) => s.baseName).filter(Boolean)
    const priorSelected = remapPropertyList(selectedProperties)
    availableProperties = [...new Set([...remapPropertyList(availableProperties), ...analyzedNames])]
    selectedProperties = priorSelected.filter((p) => analyzedNames.includes(p))
    if (selectedProperties.length === 0) selectedProperties = [...analyzedNames]

    storeEnergeticResult({
      rawX: result.x || [],
      rawXTimeUnit: timeUnits,
      rawSeries: rawSeriesLocal,
      chartTitle: `${engineLabels[detected.engine] || detected.engine.toUpperCase()} Energetic Analysis`,
      chartXLabel: result.x_label || 'Time',
      selectedProperties: [...selectedProperties],
      energeticEngine: detected.engine,
      statistics: result.statistics || {},
      sourceFiles: capturePlotSourceFiles(result.x || [], logFiles, { coordinateOnly: false })
    })

    for (const s of rawSeriesLocal) {
      ensureEPlotPanel(s.baseName)
    }
    focusedPanelKey = selectedProperties[0] ?? ''
    availableProperties = unionEnergeticProperties(analysisSets)
    syncSetsIntoEnergeticGridLayout()
  }

  function energeticPlotPanelSettingsKey(panel) {
    if (panel.key === '__compare__' || panel.key === '__overlay__') {
      return focusedPanelKey || selectedProperties[0] || panel.key
    }
    return (
      panel.series?.[0]?.baseName ||
      (selectedProperties.includes(panel.key) ? panel.key : focusedPanelKey || selectedProperties[0] || panel.key)
    )
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
    const idx = Number.isFinite(panel?.cellIndex) ? panel.cellIndex : null
    const cps = idx != null ? cellPlotSettings(idx) : ePlotGlobal
    const series = (panel.series || []).filter((s) => (s.y?.length ?? 0) > 0)
    const ext = dataExtentsFromSeries(series)
    if (!ext) return { xlim: null, ylim: null }
    const xMinStr = ePlotGlobal.xMin
    const xMaxStr = ePlotGlobal.xMax
    const yMinStr = cps.yMin !== '' && cps.yMin != null ? cps.yMin : ePlotGlobal.yMin
    const yMaxStr = cps.yMax !== '' && cps.yMax != null ? cps.yMax : ePlotGlobal.yMax
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
      title: displayTitle || ePlotGlobal.title || 'Energetic Analysis',
      ...plotSpecAxisChrome(ePlotGlobal),
      ...plotSpecExtraMargins(ePlotGlobal)
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
        color: s.color,
        linewidth: Number(s.strokeWidth) || Number(ePlotGlobal.lineWidth) || 1.5,
        linestyle: s.lineStyle || ePlotGlobal.lineStyle || 'solid'
      }))
  }

  function buildEnergeticPlotPayload() {
    const refs = publicationReferenceLines(ePlotGlobal.referenceLines)
    const bands = publicationReferenceBands(ePlotGlobal.referenceBands)
    const lineColors = ['#f59e0b', '#22c55e', '#38bdf8', '#f87171', '#a78bfa', '#f472b6']
    const panels = energeticPanels
    const allDataSeries = panels.flatMap((panel) => seriesToPublicationData(panel.series))

    if (
      energeticCompareLayout === 'grid' &&
      panels.length > 0 &&
      allDataSeries.length > 0
    ) {
      const plotPanels = panels
        .map((panel, i) => {
          const series = seriesToPublicationData(panel.series)
          if (series.length === 0) return null
          const idx = Number.isFinite(panel.cellIndex) ? panel.cellIndex : i
          const cps = cellPlotSettings(idx)
          const ylabel = energeticPanelYLabel(panel, { ylabel: cps.yLabel })
          const title = String(panel.title || '').trim() || energeticPanelChartTitle(panel, cps)
          const { xlim, ylim } = energeticPublicationLimits(panel)
          const labels = cellLabelVisibility(energeticGridLayout, idx)
          const loc =
            cps.legendPosition === 'top-right'
              ? 'upper right'
              : cps.legendPosition === 'bottom-left'
                ? 'lower left'
                : cps.legendPosition === 'bottom-right'
                  ? 'lower right'
                  : 'upper left'
          return {
            key: panel.key,
            name: title,
            title,
            ylabel,
            series_keys: series.map((s) => s.key),
            line_color: series[0]?.color || lineColors[0],
            linewidth: Number(cps.lineWidth) || Number(ePlotGlobal.lineWidth) || 1.5,
            linestyle: cps.lineStyle || ePlotGlobal.lineStyle || 'solid',
            xlim,
            ylim,
            show_xlabel: labels.showXLabel,
            show_ylabel: labels.showYLabel,
            show_ticks: ePlotGlobal.showTicks !== false,
            show_xticklabels: labels.showXTickLabels,
            show_yticklabels: labels.showYTickLabels,
            show_legend: cellShowsLegend(energeticGridLayout, idx) && cps.legendPosition !== 'none',
            show_grid: cps.showGrid !== false,
            legend_loc: loc,
            legend_fontsize: guiSvgFontToMpl(cps.legendFontSize, 8),
            ...plotSpecPanelLetter(
              energeticGridLayout,
              idx,
              Number(cps.titleFontSize) || Number(ePlotGlobal.titleFontSize) || 13
            )
          }
        })
        .filter(Boolean)

      if (plotPanels.length > 0) {
        const cols = Math.max(1, Number(energeticGridLayout.cols) || 2)
        const n = plotPanels.length
        const { rows } = gridSpecSlices(n, cols, energeticGridLayout.lastRowAlign)
        const aspect = gridCellAspect
        const cellW = 3.6
        let figW = Math.max(6, cols * cellW)
        let figH = Math.max(3, rows * (cellW / Math.max(0.4, aspect)))
        if (energeticGridLayout.legendMode === 'outside') {
          if (
            energeticGridLayout.legendOutside === 'top' ||
            energeticGridLayout.legendOutside === 'bottom'
          ) {
            figH += 0.75
          } else {
            figW += 2.1
          }
        }
        if (energeticGridLayout.panelLetterShow) {
          figW += 0.35
          figH += 0.2
        }
        const gapFrac = Math.max(
          0.28,
          Math.min(0.55, 0.14 + (Number(energeticGridLayout.gapPx) || 16) / 50)
        )
        return {
          data: {
            x: allDataSeries[0]?.x || [],
            series: allDataSeries
          },
          plotSpec: {
            version: 1,
            layout: 'grid',
            cols,
            rows,
            last_row_align:
              energeticGridLayout.lastRowAlign === 'center' ||
              energeticGridLayout.lastRowAlign === 'end'
                ? energeticGridLayout.lastRowAlign
                : 'start',
            wspace: gapFrac,
            hspace: gapFrac,
            cell_aspect: aspect,
            sync_x: ePlotGlobal.syncX !== false,
            legend: {
              mode: energeticGridLayout.legendMode,
              cell: Number(energeticGridLayout.legendCell) || 0,
              loc: energeticGridLayout.legendOutside,
              align: energeticGridLayout.legendOutsideAlign || 'center',
              entries: energeticGridLayout.legendEntries,
              fontsize: guiSvgFontToMpl(outsideLegendFontSize(energeticGridLayout), 8),
              title_fontsize: guiSvgFontToMpl(
                outsideLegendTitleFontSize(energeticGridLayout),
                8
              ),
              title_gap: outsideLegendTitleGap(energeticGridLayout),
              ncol: Number(energeticGridLayout.legendColumns) || 1,
              title: energeticGridLayout.legendTitle || '',
              swatch_width: outsideLegendSwatchWidth(energeticGridLayout),
              swatch_height: outsideLegendSwatchHeight(energeticGridLayout),
              swatch_round: energeticGridLayout.legendSwatchRound !== false,
              box_round: energeticGridLayout.legendBoxRound !== false,
              border_color: String(energeticGridLayout.legendBoxBorderColor || ''),
              border_width: Math.max(0, Number(energeticGridLayout.legendBoxBorderWidth) || 0),
              manual_items:
                energeticGridLayout.legendEntries === 'manual'
                  ? normalizeManualLegendItems(energeticGridLayout.legendManualItems)
                      .filter((m) => m.visible)
                      .map((m) => ({
                        id: m.id,
                        label: m.label,
                        color: m.color,
                        marker: m.marker,
                        marker_size: m.markerSize
                      }))
                  : []
            },
            reference_lines: refs,
            reference_bands: bands,
            global: {
              ...energeticPublicationGlobalStyle(),
              figsize: [figW, figH]
            },
            panels: plotPanels
          }
        }
      }
    }

    if (panels.length > 0 && allDataSeries.length > 0) {
      const panel = panels[0]
      const { xlim, ylim } = energeticPublicationLimits(panel)
      const ylabel = energeticPanelYLabel(panel, ePlotGlobal)
      const title = energeticPanelChartTitle(panel, ePlotGlobal)
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
          reference_lines: refs,
          reference_bands: bands,
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
            line_color: s.color || lineColors[i % lineColors.length],
            linewidth: Number(s.linewidth) || Number(ePlotGlobal.lineWidth) || 1.5,
            linestyle: s.linestyle || ePlotGlobal.lineStyle || 'solid',
            ...(i === 0
              ? plotSpecPanelLetter(
                  energeticGridLayout,
                  0,
                  Number(ePlotGlobal.titleFontSize) || 13
                )
              : {})
          }))
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
        layout: energeticCompareLayout === 'grid' ? 'grid' : 'overlay',
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

  // Axis overrides: wheel/box-zoom (`structViewRange`) sits on top of Plot Settings min/max.
  const xMinO = $derived(
    structViewRange != null
      ? structViewRange.xMin
      : ps.xMin !== '' && Number.isFinite(Number(ps.xMin))
        ? Number(ps.xMin)
        : null
  )
  const xMaxO = $derived(
    structViewRange != null
      ? structViewRange.xMax
      : ps.xMax !== '' && Number.isFinite(Number(ps.xMax))
        ? Number(ps.xMax)
        : null
  )
  const yMinO = $derived(
    structViewRange != null
      ? structViewRange.yMin
      : ps.yMin !== '' && Number.isFinite(Number(ps.yMin))
        ? Number(ps.yMin)
        : null
  )
  const yMaxO = $derived(
    structViewRange != null
      ? structViewRange.yMax
      : ps.yMax !== '' && Number.isFinite(Number(ps.yMax))
        ? Number(ps.yMax)
        : null
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
        companionStructure: referenceStructurePath.trim() || null,
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

  async function pickReferenceStructure() {
    const result = await window.api.openFileDialog(
      'Select RMSD reference structure',
      [{ name: 'Structure', extensions: ['pdb', 'gro', 'ent'] }],
      workingDir || undefined
    )
    if (result.canceled || !result.filePath) return
    referenceStructurePath = result.filePath
    persistActiveSetFields()
  }

  /**
   * @param {string} path
   * @returns {Promise<{ map: Map<number, number>, usefulCount: number, error: string }>}
   */
  async function parseResidueMappingPath(path) {
    const text = await window.api.readText(path)
    const map = parseResidueMappingText(text, { path })
    if (!map.size) {
      throw new Error('No residue pairs found (expected ORIGINAL … FINAL columns).')
    }
    const usefulCount = [...map.entries()].filter(([a, b]) => a !== b).length
    const error = usefulCount
      ? ''
      : 'Identity map (ids unchanged). For PDB originals (e.g. 21→2) use *_gatewizard_residue_mapping.txt from capping.'
    return { map, usefulCount, error }
  }

  /** @param {{ quiet?: boolean }} [opts] */
  async function hydrateResidueMappingGroups(opts = {}) {
    if (!residueMappingGroups.length) {
      bumpPlotData()
      return
    }
    const next = []
    for (const g of residueMappingGroups) {
      try {
        const parsed = await parseResidueMappingPath(g.path)
        next.push({
          ...g,
          map: parsed.map,
          usefulCount: parsed.usefulCount,
          error: parsed.error
        })
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        if (!opts.quiet) lastError = `Residue mapping (${basename(g.path)}): ${msg}`
        next.push({ ...g, map: new Map(), usefulCount: 0, error: msg })
      }
    }
    residueMappingGroups = next
    bumpPlotData()
  }

  function newResidueMappingGroupId() {
    return `rmap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  }

  async function addResidueMappingFiles() {
    const result = await window.api.openFilesDialog(
      'Add residue renumbering map(s)',
      [
        { name: 'Residue renum / mapping', extensions: ['txt'] },
        { name: 'All files', extensions: ['*'] }
      ],
      workingDir || undefined
    )
    if (result.canceled || !result.filePaths?.length) return
    const existing = new Set(residueMappingGroups.map((g) => g.path))
    const defaultSetIds = activeSetId ? [activeSetId] : analysisSets.slice(0, 1).map((s) => s.id)
    /** @type {typeof residueMappingGroups} */
    const added = []
    for (const filePath of result.filePaths) {
      if (existing.has(filePath)) continue
      try {
        const parsed = await parseResidueMappingPath(filePath)
        added.push({
          id: newResidueMappingGroupId(),
          path: filePath,
          enabled: parsed.usefulCount > 0,
          setIds: [...defaultSetIds],
          map: parsed.map,
          usefulCount: parsed.usefulCount,
          error: parsed.error
        })
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        added.push({
          id: newResidueMappingGroupId(),
          path: filePath,
          enabled: false,
          setIds: [...defaultSetIds],
          map: new Map(),
          usefulCount: 0,
          error: msg
        })
        lastError = `Residue mapping (${basename(filePath)}): ${msg}`
      }
    }
    if (!added.length) return
    residueMappingGroups = [...residueMappingGroups, ...added]
    bumpPlotData()
    markSessionDirty()
  }

  /** @param {string} groupId */
  function removeResidueMappingGroup(groupId) {
    residueMappingGroups = residueMappingGroups.filter((g) => g.id !== groupId)
    bumpPlotData()
    markSessionDirty()
  }

  /**
   * @param {string} groupId
   * @param {Partial<{ enabled: boolean, setIds: string[] }>} patch
   */
  function patchResidueMappingGroup(groupId, patch) {
    residueMappingGroups = residueMappingGroups.map((g) =>
      g.id === groupId ? { ...g, ...patch } : g
    )
    bumpPlotData()
    markSessionDirty()
  }

  /**
   * @param {string} groupId
   * @param {string} setId
   * @param {boolean} checked
   */
  function toggleResidueMappingSet(groupId, setId, checked) {
    const g = residueMappingGroups.find((x) => x.id === groupId)
    if (!g) return
    const setIds = checked
      ? [...new Set([...g.setIds, setId])]
      : g.setIds.filter((id) => id !== setId)
    patchResidueMappingGroup(groupId, { setIds })
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
    persistActiveSetFields()
    bumpPlotData()
  }

  /** @param {number} index @param {string} value */
  function setTrajectoryTimeNs(index, value) {
    const next = String(value ?? '')
    if (String(trajectoryFiles[index]?.timeNs ?? '') === next) return
    trajectoryFiles = trajectoryFiles.map((f, i) => (i === index ? { ...f, timeNs: next } : f))
    persistActiveSetFields()
    bumpPlotData()
  }

  function removeLog(index) {
    logFiles = logFiles.filter((_, i) => i !== index)
    persistActiveSetFields()
    bumpPlotData()
  }

  /** @param {number} index @param {string} value */
  function setLogTimeNs(index, value) {
    const next = String(value ?? '')
    if (String(logFiles[index]?.timeNs ?? '') === next) return
    logFiles = logFiles.map((f, i) => (i === index ? { ...f, timeNs: next } : f))
    persistActiveSetFields()
    bumpPlotData()
  }

  function assignProtocolTimesToTrajectories() {
    const { files, matched, unmatched } = assignProtocolStageTimes(trajectoryFiles)
    trajectoryFiles = files
    persistActiveSetFields()
    bumpPlotData()
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
    bumpPlotData()
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
      await applyStructuralTypeChange(nextType)
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
    clearChartViewRange()

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
          referenceStructurePath: s.structuralOptions.referenceStructurePath,
          align: s.structuralOptions.align,
          rmsfXaxisType: s.structuralOptions.rmsfXaxisType,
          leafletLipidSel: s.structuralOptions.leafletLipidSel,
          leafletFilterSel: s.structuralOptions.leafletFilterSel,
          nBins: s.structuralOptions.nBins,
          interpolate: s.structuralOptions.interpolate,
          excludeSel: s.structuralOptions.excludeSel,
          excludeCutoff: s.structuralOptions.excludeCutoff,
          excludeDim: s.structuralOptions.excludeDim,
          aplMethod: s.structuralOptions.aplMethod,
          fatslimNthreads: s.structuralOptions.fatslimNthreads,
          fatslimJobs: s.structuralOptions.fatslimJobs,
          gridmatN: s.structuralOptions.gridmatN,
          gridmatPrecision: s.structuralOptions.gridmatPrecision,
          gridmatMdJobs: s.structuralOptions.gridmatMdJobs,
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
          referenceStructurePath:
            nextSnap.referenceStructurePath ?? s.structuralOptions.referenceStructurePath ?? '',
          align: nextSnap.align ?? s.structuralOptions.align,
          rmsfXaxisType: nextSnap.rmsfXaxisType ?? s.structuralOptions.rmsfXaxisType,
          leafletLipidSel: nextSnap.leafletLipidSel ?? '',
          leafletFilterSel: nextSnap.leafletFilterSel ?? '',
          nBins: nextSnap.nBins ?? s.structuralOptions.nBins,
          interpolate: nextSnap.interpolate ?? s.structuralOptions.interpolate,
          excludeSel: nextSnap.excludeSel ?? s.structuralOptions.excludeSel ?? defaultPeptideExcludeSelection(),
          excludeCutoff:
            nextSnap.excludeCutoff ??
            s.structuralOptions.excludeCutoff ??
            APL_METHOD_DEFAULTS.excludeCutoff,
          excludeDim:
            nextSnap.excludeDim ?? s.structuralOptions.excludeDim ?? APL_METHOD_DEFAULTS.excludeDim,
          aplMethod: normalizeAplMethod(nextSnap.aplMethod ?? s.structuralOptions.aplMethod),
          fatslimNthreads:
            nextSnap.fatslimNthreads ??
            s.structuralOptions.fatslimNthreads ??
            APL_METHOD_DEFAULTS.fatslimNthreads,
          fatslimJobs:
            nextSnap.fatslimJobs ??
            s.structuralOptions.fatslimJobs ??
            APL_METHOD_DEFAULTS.fatslimJobs,
          gridmatN: nextSnap.gridmatN ?? s.structuralOptions.gridmatN ?? APL_METHOD_DEFAULTS.gridmatN,
          gridmatPrecision:
            nextSnap.gridmatPrecision ??
            s.structuralOptions.gridmatPrecision ??
            APL_METHOD_DEFAULTS.gridmatPrecision,
          gridmatMdJobs:
            nextSnap.gridmatMdJobs ??
            s.structuralOptions.gridmatMdJobs ??
            APL_METHOD_DEFAULTS.gridmatMdJobs,
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
        (lipidHeadgroupAtoms.length === 0 && !looksLikeBilayerHeadgroupSelection(selection))
      if (needsDetect && topologyPath) {
        await refreshHeadgroupAtoms()
      } else if (lipidHeadgroupAtoms.length > 0) {
        syncHeadgroupSelection()
      }
    } else {
      headgroupDetectAttempted = false
    }

    persistActiveSetFields()
    const needsCsv = analysisSets.some((s) => {
      const res = resultForSetAndType(s, nextType)
      return res != null && structuralResultNeedsCsvHydration(res)
    })
    if (needsCsv) await hydratePlotDataFromOutputFolder()
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

  /**
   * Count selection on topology (+ companion PDB) before loading trajectories.
   * Fails fast when the default protein selection is used on lipid-only systems.
   */
  async function ensureNonBilayerSelectionReady() {
    if (isBilayerType(structuralType)) return
    const sel = selection.trim()
    if (!sel) throw new Error('Enter an atom selection for this analysis.')
    if (!topologyPath) return
    const result = await countAnalysisSelection({
      topologyPath,
      // Empty traj list → topology/companion only (do not open DCDs).
      trajectoryPaths: [],
      companionStructure: referenceStructurePath.trim() || null,
      selection: sel,
      selection2:
        structuralType === 'distance' && selection2.trim() ? selection2.trim() : null
    })
    selectionAtomCount = result.count
    if (structuralType === 'distance') {
      selection2AtomCount = result.count2 ?? null
    }
    if (result.count === 0) {
      const lipidHint = looksLikeProteinSelection(sel)
        ? ' For lipid-only systems use a lipid selection (e.g. name P31 or resname PC), not a protein selection.'
        : ''
      throw new Error(`Selection ${JSON.stringify(sel)} matched 0 atoms.${lipidHint}`)
    }
    if (structuralType === 'distance' && (result.count2 ?? 0) === 0) {
      throw new Error(
        `Second selection ${JSON.stringify(selection2.trim())} matched 0 atoms.`
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

  // ---- Drag-to-reorder: logs (highlight drop target) ----
  let dragIdx = $state(-1)
  let dragOverIdx = $state(-1)

  // ---- Drag-to-reorder: trajectories (live move; sky style ≠ amber sets) ----
  /** @type {string | null} */
  let trajDragPath = $state(null)
  let trajDragOrderDirty = $state(false)

  // ---- Simulation sets list ----
  let setsListCollapsed = $state(false)
  /** @type {string | null} */
  let setDragId = $state(null)
  let setDragOrderDirty = $state(false)

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

  function onTrajDragStart(index, e) {
    const row = trajectoryFiles[index]
    if (!row?.path) return
    trajDragPath = row.path
    trajDragOrderDirty = false
    if (e?.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', row.path)
    }
  }

  function onTrajDragOver(e, index) {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    if (!trajDragPath) return
    const from = trajectoryFiles.findIndex((f) => f.path === trajDragPath)
    const next = liveReorderAtMidpoint(
      trajectoryFiles,
      from,
      index,
      e.clientY,
      /** @type {Element} */ (e.currentTarget)
    )
    if (!next) return
    trajectoryFiles = next
    trajDragOrderDirty = true
  }

  function clearStructuralResultsAfterTrajReorder() {
    structResults = {
      rmsd: null,
      rmsf: null,
      distance: null,
      radius_of_gyration: null,
      area_per_lipid: null,
      membrane_thickness: null
    }
  }

  function onTrajDragEnd() {
    if (trajDragOrderDirty) {
      markSessionDirty()
      clearStructuralResultsAfterTrajReorder()
    }
    trajDragPath = null
    trajDragOrderDirty = false
  }

  function onDropTrajectory(e) {
    e.preventDefault()
    onTrajDragEnd()
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
    selection = `${peptideOrProteinSelection()} and backbone`
    selection2 = `${peptideOrProteinSelection()} and resid 50`
    selectionAtomCount = null
    selection2AtomCount = null
    selectionCountError = ''
    referenceFrame = '0'
    referenceStructurePath = ''
    align = true
    rmsfXaxisType = 'residue_number'
    residueMappingGroups = []
    leafletLipidSel = ''
    leafletFilterSel = ''
    nBins = '1'
    interpolate = false
    excludeSel = defaultPeptideExcludeSelection()
    excludeCutoff = APL_METHOD_DEFAULTS.excludeCutoff
    excludeDim = APL_METHOD_DEFAULTS.excludeDim
    aplMethod = APL_METHOD_DEFAULTS.aplMethod
    fatslimNthreads = APL_METHOD_DEFAULTS.fatslimNthreads
    fatslimJobs = APL_METHOD_DEFAULTS.fatslimJobs
    gridmatN = APL_METHOD_DEFAULTS.gridmatN
    gridmatPrecision = APL_METHOD_DEFAULTS.gridmatPrecision
    gridmatMdJobs = APL_METHOD_DEFAULTS.gridmatMdJobs
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
    gridLayout = defaultGridLayout()
    energeticCompareLayout = 'grid'
    energeticGridLayout = defaultGridLayout()
    energeticGridFill = 'by_property'
    energeticChartView = { mode: 'empty', series: [], panels: [] }
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
    chartInteractionMode = 'none'
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
    runAnalysisSelectedIds = []
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
      availableProperties = remapPropertyList(properties || [])
      if (selectAll || selectedProperties.length === 0) {
        selectedProperties = [...availableProperties]
      } else {
        selectedProperties = remapPropertyList(selectedProperties).filter((p) =>
          availableProperties.includes(p)
        )
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
          availableProperties = remapPropertyList(properties || [])
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

  /** @param {'current' | 'all' | 'selected'} [scope] */
  async function runAnalysis(scope = runAnalysisScope) {
    if (scope === 'all' && analysisSets.length > 1) {
      await runAnalysisOnSets(analysisSets)
      return
    }
    if (scope === 'selected' && analysisSets.length > 1) {
      const chosen = analysisSets.filter((set) => runAnalysisSelectedIds.includes(set.id))
      if (chosen.length === 0) {
        lastError = 'Select at least one set in Run Analysis options.'
        return
      }
      await runAnalysisOnSets(chosen)
      return
    }
    await runAnalysisCurrentSet()
  }

  async function runAnalysisCurrentSet() {
    resetAnalysisProgress()
    startAnalysisAbort()
    let cancelled = false
    let runOk = false
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
      runOk = true
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
    // Do not auto-save after a failed run — saveAnalysisSessionToOutputFolder
    // calls showSessionActionNotice which clears lastError and hides the message.
    if (cancelled || !runOk) return
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

  /**
   * @param {import('../lib/analysisSets.js').AnalysisSet[]} sets
   */
  async function runAnalysisOnSets(sets) {
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
    const runnable = sets.filter((set) => {
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
    // Batch APL: one method for the whole job — sidebar wins over each set's older save.
    if (mode === 'structural' && runStructuralType === 'area_per_lipid') {
      stampAplOptionsOntoSets(runnable.map((s) => s.id))
    }
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
        const aplTag =
          mode === 'structural' && runStructuralType === 'area_per_lipid'
            ? ` · ${normalizeAplMethod(aplMethod)}`
            : ''
        setAnalysisProgress(i + 1, total, `${set.label} (${typeLabel}${aplTag})`)
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
          const msg = shortenAnalysisError(
            error instanceof Error ? error.message : String(error)
          )
          errors.push(`${set.label}: ${msg}`)
          runProgressStages = runProgressStages.map((stage, idx) =>
            idx === i ? { ...stage, status: 'error' } : stage
          )
        }
      }
      if (analysisAbort?.signal.aborted && !lastError) {
        lastError = 'Analysis cancelled'
      } else if (errors.length > 0) {
        const skipNote = skipped.length ? `\nSkipped ${skipped.length}: ${skipped.join('; ')}.` : ''
        lastError =
          errors.length === total
            ? errors.join('\n')
            : `Completed ${completed}/${total} sets.\n${errors.join('\n')}${skipNote}`
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

  function runAnalysisSelectedCount() {
    const ids = new Set(analysisSets.map((s) => s.id))
    return runAnalysisSelectedIds.filter((id) => ids.has(id)).length
  }

  function toggleRunAnalysisSelectedSet(id, checked) {
    runAnalysisScope = 'selected'
    if (checked) {
      if (!runAnalysisSelectedIds.includes(id)) {
        runAnalysisSelectedIds = [...runAnalysisSelectedIds, id]
      }
      return
    }
    runAnalysisSelectedIds = runAnalysisSelectedIds.filter((x) => x !== id)
  }

  function chooseRunAnalysisSelectedScope() {
    runAnalysisScope = 'selected'
    if (runAnalysisSelectedIds.length === 0 && activeSetId) {
      runAnalysisSelectedIds = [activeSetId]
    }
  }

  function runAnalysisButtonLabel() {
    if (running) return null
    if (analysisSets.length > 1 && runAnalysisScope === 'all') {
      return `Run Analysis (all ${analysisSets.length} sets)`
    }
    if (analysisSets.length > 1 && runAnalysisScope === 'selected') {
      const n = runAnalysisSelectedCount()
      return n > 0 ? `Run Analysis (${n} selected)` : 'Run Analysis (select sets)'
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

  /** Match LineChart axis overrides for publication PNG/PDF. */
  function publicationXlimFromExtents(ext) {
    const xMinEff = xMinO != null ? xMinO : ext.xMin
    const xMaxEff = xMaxO != null ? xMaxO : ext.xMax
    return [Math.min(xMinEff, xMaxEff), Math.max(xMinEff, xMaxEff)]
  }

  /** Match LineChart y-axis overrides for publication PNG/PDF. */
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
  function uniquifySvgClipIds(svg, index) {
    const paths = [...svg.querySelectorAll('clipPath[id]')]
    paths.forEach((el, j) => {
      const oldId = el.getAttribute('id')
      if (!oldId) return
      const next = `plot-clip-export-${index}-${j}`
      el.setAttribute('id', next)
      const prev = `url(#${oldId})`
      svg.querySelectorAll('[clip-path]').forEach((node) => {
        const val = node.getAttribute('clip-path') || ''
        if (val.includes(`#${oldId}`)) node.setAttribute('clip-path', `url(#${next})`)
        else if (val === prev) node.setAttribute('clip-path', `url(#${next})`)
      })
    })
    return svg
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
    const clone = /** @type {SVGSVGElement} */ (svg.cloneNode(true))
    clone.setAttribute('width', String(svgW))
    clone.setAttribute('height', String(svgH))
    uniquifySvgClipIds(clone, index)
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
   * Union of mosaic root + outside panel-letter badges (letters can hang in the gutter).
   * @param {HTMLElement} root
   */
  function mosaicExportFrame(root) {
    const wrap = root.getBoundingClientRect()
    let left = wrap.left
    let top = wrap.top
    let right = wrap.right
    let bottom = wrap.bottom
    for (const el of root.querySelectorAll('[data-chart-export="panel-letter"]')) {
      const r = el.getBoundingClientRect()
      if (r.width < 1 && r.height < 1) continue
      left = Math.min(left, r.left)
      top = Math.min(top, r.top)
      right = Math.max(right, r.right)
      bottom = Math.max(bottom, r.bottom)
    }
    // Small safety margin so glyph ink is not clipped at the canvas edge.
    const pad = 2
    left -= pad
    top -= pad
    right += pad
    bottom += pad
    return {
      left,
      top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top)
    }
  }

  /**
   * Draw every SVG in a mosaic wrapper onto one canvas (layout matches the screen).
   * Also paints outside panel-letter badges (HTML), which SVGs alone omit.
   * @param {HTMLElement} root
   */
  async function rasterizeMosaicToPng(root) {
    const svgs = [...root.querySelectorAll('svg')].filter((el) => !el.closest('[data-grid-cell-chrome]'))
    if (svgs.length === 0) throw new Error('Mosaic has no charts to export')
    const frame = mosaicExportFrame(root)
    const dpi = Math.max(
      72,
      Math.min(600, Number(mode === 'energetic' ? ePlotGlobal.dpi : ps.dpi) || 150)
    )
    const pixelScale = dpi / 96
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(frame.width * pixelScale))
    canvas.height = Math.max(1, Math.round(frame.height * pixelScale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not create canvas for PNG export')
    const transparent = Boolean(mode === 'energetic' ? ePlotGlobal.transparentBg : ps.transparentBg)
    if (!transparent) {
      ctx.fillStyle =
        mode === 'energetic'
          ? energeticGridLayout.figureBg || resolvedEnergColors.plotBg
          : gridLayout.figureBg || displayPlotBg
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    for (let i = 0; i < svgs.length; i++) {
      const svg = svgs[i]
      const r = svg.getBoundingClientRect()
      const base64 = await rasterizeChartSvgToPng(svg, i)
      const img = new Image()
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = (e) => reject(new Error('Mosaic tile failed to load: ' + String(e)))
        img.src = `data:image/png;base64,${base64}`
      })
      ctx.drawImage(
        img,
        (r.left - frame.left) * pixelScale,
        (r.top - frame.top) * pixelScale,
        r.width * pixelScale,
        r.height * pixelScale
      )
    }
    paintMosaicPanelLetters(ctx, root, frame, pixelScale)
    return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {HTMLElement} root
   * @param {{ left: number, top: number }} frame
   * @param {number} pixelScale
   */
  function paintMosaicPanelLetters(ctx, root, frame, pixelScale) {
    const letters = [...root.querySelectorAll('[data-chart-export="panel-letter"]')]
    for (const el of letters) {
      const text = String(el.textContent || '').trim()
      if (!text) continue
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      const fontSize = Math.max(8, parseFloat(cs.fontSize) || 16) * pixelScale
      const weight = cs.fontWeight || '700'
      const family = cs.fontFamily || 'Roboto, sans-serif'
      const color = cs.color || '#111'
      const padX = 3 * pixelScale
      const padY = 1.5 * pixelScale
      const x = (r.left - frame.left) * pixelScale
      const y = (r.top - frame.top) * pixelScale
      const w = Math.max(r.width * pixelScale, fontSize * 0.7)
      const h = Math.max(r.height * pixelScale, fontSize * 1.05)
      const bg = cs.backgroundColor
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        ctx.fillStyle = bg
        ctx.beginPath()
        const rad = 2 * pixelScale
        ctx.roundRect?.(x - padX * 0.2, y - padY * 0.2, w + padX * 0.4, h + padY * 0.4, rad)
        if (ctx.roundRect) ctx.fill()
        else ctx.fillRect(x, y, w, h)
      }
      ctx.fillStyle = color
      ctx.font = `${weight} ${fontSize}px ${family}`
      ctx.textBaseline = 'top'
      ctx.fillText(text, x + padX * 0.15, y + padY * 0.1)
    }
  }

  /**
   * @param {HTMLElement} root
   */
  function composeMosaicSvg(root) {
    const svgs = [...root.querySelectorAll('svg')].filter((el) => !el.closest('[data-grid-cell-chrome]'))
    const frame = mosaicExportFrame(root)
    const w = Math.max(1, Math.round(frame.width))
    const h = Math.max(1, Math.round(frame.height))
    const bg =
      (mode === 'energetic' ? ePlotGlobal.transparentBg : ps.transparentBg)
        ? 'none'
        : mode === 'energetic'
          ? energeticGridLayout.figureBg || resolvedEnergColors.plotBg
          : gridLayout.figureBg || displayPlotBg
    const parts = svgs.map((svg, i) => {
      const r = svg.getBoundingClientRect()
      const clone = /** @type {SVGSVGElement} */ (svg.cloneNode(true))
      uniquifySvgClipIds(clone, i)
      clone.setAttribute('x', String(Math.round(r.left - frame.left)))
      clone.setAttribute('y', String(Math.round(r.top - frame.top)))
      clone.setAttribute('width', String(Math.round(r.width)))
      clone.setAttribute('height', String(Math.round(r.height)))
      clone.removeAttribute('class')
      return new XMLSerializer().serializeToString(clone)
    })
    const letterParts = [...root.querySelectorAll('[data-chart-export="panel-letter"]')].map((el) => {
      const text = String(el.textContent || '').trim()
      if (!text) return ''
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      const fontSize = Math.max(8, parseFloat(cs.fontSize) || 16)
      const weight = cs.fontWeight || '700'
      const family = (cs.fontFamily || 'Roboto, sans-serif').replace(/"/g, "'")
      const color = cs.color || '#111'
      const x = Math.round(r.left - frame.left)
      const y = Math.round(r.top - frame.top + fontSize * 0.85)
      const bgc = cs.backgroundColor
      let bgRect = ''
      if (bgc && bgc !== 'rgba(0, 0, 0, 0)' && bgc !== 'transparent') {
        bgRect = `<rect x="${x - 2}" y="${Math.round(r.top - frame.top) - 1}" width="${Math.max(Math.round(r.width) + 4, Math.round(fontSize))}" height="${Math.max(Math.round(r.height) + 2, Math.round(fontSize * 1.1))}" rx="2" fill="${bgc}"/>`
      }
      return `${bgRect}<text x="${x}" y="${y}" font-size="${fontSize}" font-weight="${weight}" font-family="${family}" fill="${color}">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`
    })
    return (
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      (bg !== 'none' ? `<rect width="100%" height="100%" fill="${bg}"/>` : '') +
      parts.join('') +
      letterParts.join('') +
      `</svg>`
    )
  }

  function chartMosaicRoot() {
    if (!toolbarIsGrid) return null
    return plotExportRoot?.querySelector('[data-chart-mosaic]') || null
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
          energeticGridFill,
          outputFolderName: folderName,
          sessionName,
          activeSetId,
          sets: slimSetsForSessionSave(analysisSets, 'all'),
          gridLayout: clonePlainAnalysisData(gridLayout),
          energeticGridLayout: clonePlainAnalysisData(energeticGridLayout),
          residueMappingGroups: serializeResidueMappingGroups(residueMappingGroups),
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
        await tick()
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
        const mosaic = chartMosaicRoot()
        if (mosaic) {
          const filePath = await resolveExportPath(
            `${exportFileStem()}.svg`,
            'Export SVG — the on-screen mosaic is saved as one .svg',
            [{ name: 'SVG', extensions: ['svg'] }]
          )
          if (!filePath) return
          await window.api.writeText(filePath, composeMosaicSvg(mosaic))
          showAnalysisActionNotice(`Exported SVG to ${filePath}`)
          logEvent('info', 'analysis', 'Exported SVG', filePath)
          return
        }
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
    const refs = publicationReferenceLines(ps.referenceLines)
    const bands = publicationReferenceBands(ps.referenceBands)
    const lineColors = ['#f59e0b', '#22c55e', '#38bdf8', '#f87171', '#a78bfa', '#f472b6']
    const toDataSeries = (s) => {
      const set = analysisSets.find((x) => x.id === s.setId)
      return {
        key: s.key || s.name,
        name: s.name,
        unit: '',
        y: s.y,
        x: s.x,
        color: s.color,
        set_id: s.setId,
        set_name: set ? setLegendName(set) : s.name,
        series_role: s.seriesRole,
        linewidth: Number(s.strokeWidth) || Number(ps.lineWidth) || 1.5,
        linestyle: s.lineStyle || ps.lineStyle || 'solid'
      }
    }

    if (chartView.mode === 'grid' && chartView.panels.length > 0) {
      const plotPanels = chartView.panels.filter((p) => (p.series || []).some((s) => (s.y?.length ?? 0) > 0))
      const allSeries = plotPanels.flatMap((p) => (p.series || []).filter((s) => (s.y?.length ?? 0) > 0))
      if (plotPanels.length === 0 || allSeries.length === 0) {
        // fall through to overlay path
      } else {
        const cols = Math.max(1, Number(gridLayout.cols) || 2)
        const n = plotPanels.length
        const { rows } = gridSpecSlices(n, cols, gridLayout.lastRowAlign)
        const aspect = gridCellAspect
        const cellW = 3.6
        let figW = Math.max(6, cols * cellW)
        let figH = Math.max(3, rows * (cellW / Math.max(0.4, aspect)))
        if (gridLayout.legendMode === 'outside') {
          if (gridLayout.legendOutside === 'top' || gridLayout.legendOutside === 'bottom') figH += 0.75
          else figW += 2.1
        }
        if (gridLayout.panelLetterShow) {
          figW += 0.35
          figH += 0.2
        }
        const gapFrac = Math.max(
          0.28,
          Math.min(0.55, 0.14 + (Number(gridLayout.gapPx) || 16) / 50)
        )
        const origIndex = (panel) =>
          Number.isFinite(panel.cellIndex) ? panel.cellIndex : chartView.panels.indexOf(panel)
        return {
          data: {
            x: allSeries[0]?.x || [],
            series: allSeries.map(toDataSeries)
          },
          plotSpec: {
            version: 1,
            layout: 'grid',
            cols,
            rows,
            last_row_align:
              gridLayout.lastRowAlign === 'center' || gridLayout.lastRowAlign === 'end'
                ? gridLayout.lastRowAlign
                : 'start',
            wspace: gapFrac,
            hspace: gapFrac,
            cell_aspect: aspect,
            sync_x: xMinO != null || xMaxO != null,
            legend: {
              mode: gridLayout.legendMode,
              cell: Number(gridLayout.legendCell) || 0,
              loc: gridLayout.legendOutside,
              align: gridLayout.legendOutsideAlign || 'center',
              entries: gridLayout.legendEntries,
              fontsize: guiSvgFontToMpl(outsideLegendFontSize(gridLayout), 8),
              title_fontsize: guiSvgFontToMpl(outsideLegendTitleFontSize(gridLayout), 8),
              title_gap: outsideLegendTitleGap(gridLayout),
              ncol: Number(gridLayout.legendColumns) || 1,
              title: gridLayout.legendTitle || '',
              swatch_width: outsideLegendSwatchWidth(gridLayout),
              swatch_height: outsideLegendSwatchHeight(gridLayout),
              swatch_round: gridLayout.legendSwatchRound !== false,
              box_round: gridLayout.legendBoxRound !== false,
              border_color: String(gridLayout.legendBoxBorderColor || ''),
              border_width: Math.max(0, Number(gridLayout.legendBoxBorderWidth) || 0),
              manual_items:
                gridLayout.legendEntries === 'manual'
                  ? normalizeManualLegendItems(gridLayout.legendManualItems)
                      .filter((m) => m.visible)
                      .map((m) => ({
                        id: m.id,
                        label: m.label,
                        color: m.color,
                        marker: m.marker,
                        marker_size: m.markerSize
                      }))
                  : []
            },
            reference_lines: refs,
            reference_bands: bands,
            global: {
              plot_bg: gridLayout.cellBg || resolvedStructColors.plotBg,
              fig_bg: gridLayout.figureBg || resolvedStructColors.plotBg,
              text_color: resolvedStructColors.textColor,
              grid_color: String(ps.gridColor || '').trim() || resolvedStructColors.textColor,
              show_grid: ps.showGrid !== false,
              figsize: [figW, figH],
              dpi: Number(ps.dpi) || 300,
              font_family: ps.fontFamily || 'Roboto, sans-serif',
              xlabel: displayXLabel,
              ylabel: displayYLabel,
              title: displayTitle || 'Structural Analysis',
              xlim:
                xMinO != null || xMaxO != null
                  ? publicationXlimFromExtents(
                      dataExtentsFromSeries(allSeries) || { xMin: 0, xMax: 1, yMin: 0, yMax: 1 }
                    )
                  : null,
              ylim: null,
              ...plotSpecAxisChrome(ps),
              ...plotSpecExtraMargins(ps)
            },
            panels: plotPanels.map((panel, i) => {
              const series = (panel.series || []).filter((s) => (s.y?.length ?? 0) > 0)
              const ext = dataExtentsFromSeries(series)
              const idx = origIndex(panel)
              const labels = cellLabelVisibility(gridLayout, idx)
              const cps = mergeCellPlotSettings(ps, cellOverride(gridLayout, idx))
              const loc =
                cps.legendPosition === 'top-right'
                  ? 'upper right'
                  : cps.legendPosition === 'bottom-left'
                    ? 'lower left'
                    : cps.legendPosition === 'bottom-right'
                      ? 'lower right'
                      : 'upper left'
              return {
                key: panel.key,
                name: panel.title,
                title: panel.title,
                ylabel: displayYLabel,
                series_keys: series.map((s) => s.key || s.name),
                line_color: series[0]?.color || lineColors[i % lineColors.length],
                xlim: ext ? publicationXlimFromExtents(ext) : null,
                ylim: ext ? publicationYlimFromExtents(ext) : null,
                show_xlabel: labels.showXLabel,
                show_ylabel: labels.showYLabel,
                show_ticks: ps.showTicks !== false,
                show_xticklabels: labels.showXTickLabels,
                show_yticklabels: labels.showYTickLabels,
                show_legend: cellShowsLegend(gridLayout, idx) && cps.legendPosition !== 'none',
                show_grid: cps.showGrid !== false,
                linewidth: Number(cps.lineWidth) || 1.5,
                linestyle: cps.lineStyle || 'solid',
                legend_loc: loc,
                legend_fontsize: guiSvgFontToMpl(cps.legendFontSize, 8),
                ...plotSpecPanelLetter(
                  gridLayout,
                  idx,
                  Number(cps.titleFontSize) || Number(ps.titleFontSize) || 13
                )
              }
            })
          }
        }
      }
    }

    const shown = publicationSeries()
    const globalExt = dataExtentsFromSeries(shown)
    const overlayXlim = globalExt ? publicationXlimFromExtents(globalExt) : null
    const overlayYlim = globalExt ? publicationYlimFromExtents(globalExt) : null
    return {
      data: {
        x: shown[0]?.x || [],
        series: shown.map(toDataSeries)
      },
      plotSpec: {
        version: 1,
        layout: 'overlay',
        cols: 2,
        sync_x: true,
        reference_lines: refs,
        reference_bands: bands,
        global: {
          plot_bg: resolvedStructColors.plotBg,
          fig_bg: resolvedStructColors.plotBg,
          text_color: resolvedStructColors.textColor,
          grid_color: String(ps.gridColor || '').trim() || resolvedStructColors.textColor,
          show_grid: ps.showGrid !== false,
          figsize: [10, 6],
          dpi: Number(ps.dpi) || 300,
          font_family: ps.fontFamily || 'Roboto, sans-serif',
          xlabel: displayXLabel,
          ylabel: displayYLabel,
          title: displayTitle || 'Structural Analysis',
          xlim: overlayXlim,
          ylim: overlayYlim,
          ...plotSpecAxisChrome(ps),
          ...plotSpecExtraMargins(ps)
        },
        panels: shown.map((s, i) => ({
          key: s.key || s.name,
          name: s.name,
          title: s.name,
          ylabel: displayYLabel,
          line_color: s.color || lineColors[i % lineColors.length],
          linewidth: Number(s.strokeWidth) || Number(ps.lineWidth) || 1.5,
          linestyle: s.lineStyle || ps.lineStyle || 'solid',
          xlim: overlayXlim,
          ylim: overlayYlim,
          ...(i === 0
            ? plotSpecPanelLetter(gridLayout, 0, Number(ps.titleFontSize) || 13)
            : {})
        }))
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
        await tick()
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
        const mosaic = chartMosaicRoot()
        if (mosaic) {
          const filePath = await resolveExportPath(
            `${exportFileStem()}.png`,
            'Export PNG — the on-screen mosaic is saved as one .png',
            [{ name: 'PNG', extensions: ['png'] }]
          )
          if (!filePath) return
          const base64 = await rasterizeMosaicToPng(mosaic)
          await window.api.writeBinary(filePath, base64)
          showAnalysisActionNotice(`Exported PNG to ${filePath}`)
          logEvent('info', 'analysis', 'Exported PNG', filePath)
          return
        }
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

{#snippet structuralGridCell(panel)}
  {@const idx = panel.cellIndex ?? 0}
  {@const cps = cellPlotSettings(idx)}
  {@const cellXMin =
    structViewRange != null
      ? structViewRange.xMin
      : cps.xMin !== '' && Number.isFinite(Number(cps.xMin))
        ? Number(cps.xMin)
        : null}
  {@const cellXMax =
    structViewRange != null
      ? structViewRange.xMax
      : cps.xMax !== '' && Number.isFinite(Number(cps.xMax))
        ? Number(cps.xMax)
        : null}
  {@const cellYMin =
    structViewRange != null
      ? structViewRange.yMin
      : cps.yMin !== '' && Number.isFinite(Number(cps.yMin))
        ? Number(cps.yMin)
        : null}
  {@const cellYMax =
    structViewRange != null
      ? structViewRange.yMax
      : cps.yMax !== '' && Number.isFinite(Number(cps.yMax))
        ? Number(cps.yMax)
        : null}
  <AnalysisGridCell
    {panel}
    {gridLayout}
    {gridCellAspect}
    selected={gridPlotApplyCell && selectedGridCell === idx}
    {cps}
    series={panel.empty ? [] : seriesWithCellLine(panel.series, cps, structuralType)}
    {displayXLabel}
    {displayYLabel}
    displayXTickLabels={rmsfXTickLabelsForPanel(panel)}
    {resolvedStructColors}
    {ps}
    {plotEdit}
    xMinO={cellXMin}
    xMaxO={cellXMax}
    yMinO={cellYMin}
    yMaxO={cellYMax}
    {hasChartTimeAxis}
    {chartInteractionMode}
    {statsRange}
    xTickStep={plotTickStep('x')}
    yTickStep={plotTickStep('y')}
    {structReferenceLines}
    structReferenceBands={structReferenceBandsDraw}
    editing={gridCellEditorOpen === idx}
    cellTitle={gridLayout.cells?.[idx]?.title || ''}
    cellSetIds={gridLayout.cells?.[idx]?.setIds || []}
    sets={gridChipSets}
    onSelectCell={(i) => {
      selectedGridCell = i
      if (gridCellEditorOpen != null && gridCellEditorOpen !== i) gridCellEditorOpen = null
    }}
    onEditCell={() => {
      selectedGridCell = idx
      gridCellEditorOpen = gridCellEditorOpen === idx ? null : idx
    }}
    onCloseEditor={() => (gridCellEditorOpen = null)}
    onCellSetIds={(ids) => setCellSetIds(idx, ids)}
    onCellTitle={(title) => setCellTitle(idx, title)}
    onAxisRange={applyStructAxisRange}
    onStatsRange={handleStatsRange}
  />
{/snippet}

{#snippet energeticGridCell(panel)}
  {@const idx = panel.cellIndex ?? 0}
  {@const cps = cellPlotSettings(idx)}
  {@const view = energViewRangeByKey[String(idx)]}
  {@const xMinE =
    view?.xMin ??
    (ePlotGlobal.xMin !== '' && Number.isFinite(Number(ePlotGlobal.xMin))
      ? Number(ePlotGlobal.xMin)
      : null)}
  {@const xMaxE =
    view?.xMax ??
    (ePlotGlobal.xMax !== '' && Number.isFinite(Number(ePlotGlobal.xMax))
      ? Number(ePlotGlobal.xMax)
      : null)}
  {@const yMinE =
    view?.yMin ??
    (cps.yMin !== '' && Number.isFinite(Number(cps.yMin)) ? Number(cps.yMin) : null)}
  {@const yMaxE =
    view?.yMax ??
    (cps.yMax !== '' && Number.isFinite(Number(cps.yMax)) ? Number(cps.yMax) : null)}
  {@const yLabel = String(cps.yLabel || '').trim() || energeticPanelYLabel(panel, cps)}
  <AnalysisGridCell
    {panel}
    gridLayout={energeticGridLayout}
    {gridCellAspect}
    selected={gridPlotApplyCell && selectedGridCell === idx}
    {cps}
    series={panel.empty ? [] : seriesWithCellLine(panel.series, cps, 'energetic')}
    {displayXLabel}
    displayYLabel={yLabel}
    {displayXTickLabels}
    resolvedStructColors={resolvedEnergColors}
    ps={ePlotGlobal}
    plotEdit={cps}
    xMinO={xMinE}
    xMaxO={xMaxE}
    yMinO={yMinE}
    yMaxO={yMaxE}
    hasChartTimeAxis={true}
    {chartInteractionMode}
    {statsRange}
    xTickStep={ePlotGlobal.xTickStep || ''}
    yTickStep={ePlotGlobal.yTickStep || ''}
    {structReferenceLines}
    structReferenceBands={structReferenceBandsDraw}
    editing={gridCellEditorOpen === idx}
    cellTitle={energeticGridLayout.cells?.[idx]?.title || ''}
    cellSetIds={energeticGridLayout.cells?.[idx]?.setIds || []}
    propertyKeys={energeticGridLayout.cells?.[idx]?.propertyKeys || []}
    availableProperties={energeticPropertyKeys()}
    sets={gridChipSets}
    onSelectCell={(i) => {
      selectedGridCell = i
      if (gridCellEditorOpen != null && gridCellEditorOpen !== i) gridCellEditorOpen = null
    }}
    onEditCell={() => {
      selectedGridCell = idx
      gridCellEditorOpen = gridCellEditorOpen === idx ? null : idx
    }}
    onCloseEditor={() => (gridCellEditorOpen = null)}
    onCellSetIds={(ids) => setEnergeticCellSetIds(idx, ids)}
    onCellTitle={(title) => setEnergeticCellTitle(idx, title)}
    onCellPropertyKeys={(keys) => setEnergeticCellPropertyKeys(idx, keys)}
    onAxisRange={(r) => applyPanelAxisRange(String(idx), r)}
    onStatsRange={handleStatsRange}
  />
{/snippet}

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
  <ResizableSidePanel
    storageKey="analysis"
    className="space-y-4 overflow-x-clip overflow-y-auto p-4 text-xs select-none"
  >
    <div class="space-y-2">
      <h2 class="sidebar-heading">Analysis</h2>
      <div class="relative">
        <Input
          size="sm"
          value={optionsSearchQuery}
          placeholder="Search options…"
          className="w-full"
          aria-label="Search analysis options"
          oninput={(e) => {
            optionsSearchQuery = e.currentTarget.value
            optionsSearchOpen = true
          }}
          onfocus={() => {
            if (optionsSearchQuery.trim()) optionsSearchOpen = true
          }}
          onkeydown={(e) => {
            if (e.key === 'Escape') {
              optionsSearchOpen = false
              e.currentTarget.blur()
            } else if (e.key === 'Enter' && optionsSearchHits[0]) {
              e.preventDefault()
              void onPickAnalysisOption(optionsSearchHits[0])
            }
          }}
        />
        {#if optionsSearchOpen && optionsSearchQuery.trim() && optionsSearchHits.length > 0}
          <ul
            class="absolute z-30 mt-0.5 max-h-48 w-full overflow-y-auto rounded-md border border-neutral-300 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
            role="listbox"
          >
            {#each optionsSearchHits as hit (hit.id)}
              <li>
                <button
                  type="button"
                  class="flex w-full flex-col items-start px-2 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  role="option"
                  aria-selected="false"
                  onclick={() => void onPickAnalysisOption(hit)}
                >
                  <span class="text-[11px] font-medium text-neutral-800 dark:text-neutral-100"
                    >{hit.label}</span
                  >
                  <span class="text-[10px] text-neutral-500"
                    >{hit.panel === 'analysis-grid' ? 'Grid options' : 'Left panel'}{#if hit.sectionId}
                      · {hit.sectionId}{/if}</span
                  >
                </button>
              </li>
            {/each}
          </ul>
        {:else if optionsSearchOpen && optionsSearchQuery.trim()}
          <p
            class="absolute z-30 mt-0.5 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-[11px] text-neutral-500 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
          >
            No matching options
          </p>
        {/if}
      </div>
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
      <div class="flex items-center justify-between gap-2">
        <h2
          class="sidebar-heading"
          title="Own files, options, and results per set. Drag ⠿ to reorder."
        >
          Simulation sets
        </h2>
        <Button
          size="sm"
          variant="ghost"
          className="px-1.5 text-[11px]"
          onclick={() => (setsListCollapsed = !setsListCollapsed)}
          title={setsListCollapsed ? 'Expand set list' : 'Collapse set list'}
        >
          {setsListCollapsed ? '▸ Expand' : '▾ Collapse'}
        </Button>
      </div>
      {#if setsListCollapsed}
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-md border border-neutral-200 px-2 py-1.5 text-left text-xs text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800/50"
          onclick={() => (setsListCollapsed = false)}
          title="Expand set list"
        >
          <span class="font-medium">{analysisSets.length} set{analysisSets.length === 1 ? '' : 's'}</span>
          <span class="min-w-0 flex-1 truncate text-neutral-500">
            {analysisSets.map((s) => s.label).join(', ')}
          </span>
          <span class="shrink-0 text-neutral-500">▸</span>
        </button>
      {:else}
        <div class="max-h-64 space-y-1 overflow-y-auto pr-0.5">
          {#each analysisSets as set, i (set.id)}
            {@const isActive = activeSetId === set.id}
            {@const isDragging = setDragId === set.id}
            <div
              role="listitem"
              animate:flip={LIST_REORDER_FLIP}
              ondragover={(e) => onSetDragOver(e, i)}
              ondrop={onDropAnalysisSet}
              class={`relative flex items-center gap-1.5 rounded-md border px-1.5 py-1 transition-[opacity,box-shadow,border-color,background-color] duration-150 ${
                isActive
                  ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-500/30 dark:border-amber-500/80 dark:bg-amber-500/15 dark:ring-amber-500/40'
                  : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:border-neutral-600 dark:hover:bg-neutral-800/50'
              } ${
                isDragging
                  ? 'z-10 border-amber-400 bg-amber-100/90 opacity-95 shadow-md ring-2 ring-amber-400/70 dark:border-amber-400/80 dark:bg-amber-500/25'
                  : ''
              }`}
            >
              <span
                role="button"
                tabindex="0"
                draggable="true"
                ondragstart={(e) => onSetDragStart(i, e)}
                ondragend={onSetDragEnd}
                class="shrink-0 cursor-grab text-neutral-500 select-none active:cursor-grabbing"
                title="Drag to reorder"
                >⠿</span
              >
              {#if isActive}
                <span
                  class="h-2 w-2 shrink-0 rounded-full"
                  style={`background:${set.color}`}
                  aria-hidden="true"
                ></span>
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <Input
                    size="sm"
                    blurOnEnter
                    value={set.label}
                    oninput={(e) => updateSetLabel(set.id, e.currentTarget.value)}
                    onblur={applyChartAppearance}
                    className="min-w-0 w-full border-amber-300/60 bg-white dark:border-amber-500/40 dark:bg-neutral-950"
                    onclick={(e) => e.stopPropagation()}
                  />
                  {#if mode === 'structural' && structuralType === 'area_per_lipid'}
                    <span
                      class="truncate text-[10px] leading-tight text-neutral-500 dark:text-neutral-400"
                      title={`APL method: ${aplMethodLabel(aplMethod).replace(/\s*\(default[^)]*\)$/i, '')}`}
                      >{aplMethodLabel(aplMethod).replace(/\s*\(default[^)]*\)$/i, '')}</span
                    >
                  {/if}
                </div>
              {:else}
                <button
                  type="button"
                  class="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-neutral-800 transition-colors hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
                  onclick={() => selectAnalysisSet(set.id)}
                  title={mode === 'structural' ? set.topologyPath || 'No topology' : `${set.energeticOptions?.logFiles?.length ?? 0} log file(s)`}
                >
                  <span
                    class="mr-1 inline-block h-2 w-2 shrink-0 rounded-full align-middle"
                    style={`background:${set.color}`}
                    aria-hidden="true"
                  ></span>
                  {set.label}
                  {#if mode === 'structural' && structuralType === 'area_per_lipid'}
                    <span
                      class="ml-1 text-[10px] text-neutral-500 dark:text-neutral-400"
                      title={`APL method: ${aplMethodBadgeForSet(set)}`}
                      >· {aplMethodBadgeForSet(set)}</span
                    >
                  {/if}
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
                title="Show in chart"
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
        <div class="flex flex-wrap gap-1">
          <Button size="sm" variant="outline" onclick={addAnalysisSet} title="Add set"
            >+ Add set</Button
          >
          <Button
            size="sm"
            variant="outline"
            onclick={duplicateActiveSet}
            title="Duplicate active set"
            >⧉ Duplicate</Button
          >
        </div>
      {/if}
      {#if mode === 'energetic' && selectedProperties.length > 0 && compareEnergeticProperties.length === 0 && visibleCompareSets.length > 0}
        <p class="sidebar-hint text-amber-600 dark:text-amber-400">
          Checked properties were not found on the visible sets. Run analysis to detect each set’s log properties.
        </p>
      {/if}
    </div>

    <Divider />

    {#if mode === 'structural'}
      <!-- Structural Input -->
      <div class="space-y-2">
        <h2 class="sidebar-heading">Structural Input <span class="font-normal text-neutral-500">(active set)</span></h2>
        <div class="space-y-1">
          <p class="sidebar-label">Topology file</p>
          <div class="flex gap-1">
            <span class="min-w-0 flex-1" title={topologyPath || undefined}>
              <Input
                size="sm"
                value={basename(topologyPath) || '—'}
                disabled
                title={topologyPath || undefined}
                className="w-full"
              />
            </span>
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
                <span
                  class="w-12 shrink-0 text-center"
                  title="Every Nth frame (e.g. 10 ≈ 10× fewer). Per file when concatenated."
                >Stride</span>
                <span class="w-4 shrink-0"></span>
              </div>
              {#each trajectoryFiles as file, i (file.path)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  animate:flip={LIST_REORDER_FLIP}
                  ondragover={(e) => onTrajDragOver(e, i)}
                  ondrop={onDropTrajectory}
                  class="relative flex items-center gap-1 rounded border border-neutral-200 px-1.5 py-1 transition-[opacity,box-shadow,border-color,background-color] duration-150 dark:border-neutral-800
                    {trajDragPath === file.path
                      ? 'z-10 border-dashed border-sky-500 bg-sky-500/15 opacity-95 shadow-md dark:border-sky-400 dark:bg-sky-500/20'
                      : ''}"
                >
                  <span
                    role="button"
                    tabindex="0"
                    draggable="true"
                    ondragstart={(e) => onTrajDragStart(i, e)}
                    ondragend={onTrajDragEnd}
                    class="shrink-0 cursor-grab text-sky-700/80 select-none active:cursor-grabbing dark:text-sky-400/90"
                    title="Drag to reorder"
                    >⠿</span
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
                    value={trajectoryFiles[i].timeNs}
                    oninput={(e) =>
                      setTrajectoryTimeNs(i, /** @type {HTMLInputElement} */ (e.currentTarget).value)
                    }
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
          {#if trajectoryFiles.some((f) => /\.(pdb|ent|gro)$/i.test(f.path))}
            <p class="sidebar-hint text-amber-600 dark:text-amber-400">
              A PDB/GRO in this list is ignored for thickness and area-per-lipid (those files have no periodic box). For RMSD vs a starting structure, use <span class="font-medium">Reference PDB</span> instead of listing it as a trajectory.
            </p>
          {/if}
          {#if trajectoryFiles.some((f) => /\.(rst7|restrt|inpcrd)$/i.test(f.path))}
            <p class="sidebar-hint text-amber-600 dark:text-amber-400">
              Amber <span class="font-medium">.rst7 / .inpcrd</span> files are restarts, not trajectories — they are skipped. Add production .dcd/.xtc/.trr/.nc files. For RMSD vs a start structure, use <span class="font-medium">Reference PDB</span>.
            </p>
          {/if}
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
        <div
          data-option-id="structural-type"
          class={optionsSearchHighlightId === 'structural-type' ? 'option-pulse-highlight rounded' : ''}
        >
          <Select
            size="sm"
            className="w-full"
            value={structuralType}
            disabled={structuralTypeChanging || headgroupDetecting}
            onchange={(e) => onStructuralTypeChange(e.currentTarget.value)}
          >
            {#each STRUCTURAL_TYPE_GROUPS as group (group.id)}
              <optgroup label={group.label}>
                {#each group.types as type (type)}
                  <option value={type}>{STRUCTURAL_TYPE_TITLES[type] || type}</option>
                {/each}
              </optgroup>
            {/each}
          </Select>
        </div>

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
                <p
                  class="sidebar-label"
                  title={aplMethodHint || undefined}
                >
                  APL method
                </p>
                <p class="sidebar-hint">
                  Used for this set. Run all / selected applies this method to every set in the
                  batch.
                </p>
                <div
                  class={optionsSearchHighlightId === 'apl-method' ? 'option-pulse-highlight rounded' : ''}
                  data-option-id="apl-method"
                >
                <Select
                  size="sm"
                  bind:value={aplMethod}
                  className="w-full"
                  title={aplMethodHint || undefined}
                >
                  {#each APL_METHODS as method (method.id)}
                    <option value={method.id} title={method.hint}>{method.label}</option>
                  {/each}
                </Select>
                </div>
                {#if analysisSets.length > 1}
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onclick={applyAplMethodToAllSets}
                    title="Copy the sidebar APL method and related options onto every set without running"
                    >Apply to all sets</Button
                  >
                {/if}
                {#if aplMethod === 'fatslim'}
                  {#if fatslimStatusChecking}
                    <p class="sidebar-hint text-[11px] leading-snug">Checking FATSLiM…</p>
                  {:else if fatslimAvailable === false}
                    <p class="gw-notice gw-notice-warning text-[11px] leading-snug">
                      FATSLiM not found. Clone the
                      <code class="text-[10px]">gatewizard</code>
                      API repo (not this GUI install), run
                      <code class="text-[10px]">bash scripts/install_fatslim_env.sh</code>
                      in WSL/Linux, then set
                      <code class="text-[10px]">GATEWIZARD_FATSLIM</code>
                      (see API
                      <code class="text-[10px]">docs/analysis.md</code>).
                    </p>
                  {/if}
                  <div class="flex items-center gap-2">
                    <span
                      class="sidebar-label shrink-0"
                      title="FATSLiM --nthreads per process. Use -1 for all CPUs. Prefer 1–4 when Jobs > 1."
                    >Threads</span
                    >
                    <Input
                      size="sm"
                      type="number"
                      min="-1"
                      step="1"
                      bind:value={fatslimNthreads}
                      className="w-20"
                      title="FATSLiM --nthreads per process. Use -1 for all CPUs. Prefer 1–4 when Jobs > 1."
                    />
                  </div>
                  <div class="flex items-center gap-2">
                    <span
                      class="sidebar-label shrink-0"
                      title="Parallel frame chunks (--begin-frame / --end-frame). Raise for long trajectories."
                    >Jobs</span
                    >
                    <Input
                      size="sm"
                      type="number"
                      min="1"
                      step="1"
                      bind:value={fatslimJobs}
                      className="w-20"
                      title="Parallel frame chunks (--begin-frame / --end-frame). Raise for long trajectories."
                    />
                  </div>
                  <p class="sidebar-hint text-[11px] leading-snug">
                    Prefer small Threads (1–4) with more Jobs for better wall-clock performance,
                    rather than one job with all CPUs.
                  </p>
                {:else if aplMethod === 'lipyphilic'}
                  <p class="gw-notice gw-notice-warning text-[11px] leading-snug">
                    Official lipyphilic AreaPerLipid. Use exclude atoms + cutoff/dim below
                    (docs example: 10 Å, 3D). Protein exclude needs the git lipyphilic pin in
                    <code class="text-[10px]">backend/requirements.txt</code>
                    (PR #164). Prefer FATSLiM (default) for occupants.
                  </p>
                {:else if aplMethod === 'evapl'}
                  <p class="gw-notice gw-notice-warning text-[11px] leading-snug">
                    EVAPL is experimental and not yet validated. Prefer FATSLiM (default) for
                    production comparisons.
                  </p>
                {/if}

                <p
                  class="sidebar-label"
                  title={aplMethod === 'fatslim'
                    ? 'Non-lipid atoms mapped to FATSLiM --interacting-group (protein group in NDX). Leave empty for bilayer-only.'
                    : aplMethod === 'evapl'
                      ? 'Non-lipid atoms that reduce lipid-accessible area (protein, peptide, DNA, ligands, …). Only atoms in the leaflet headgroup Z-range are used.'
                      : aplMethod === 'lipyphilic'
                        ? 'Non-lipid atoms for AreaPerLipid exclude_sel. Requires lipyphilic with PR #164 (git install) when non-empty; otherwise the run errors.'
                        : 'Non-lipid atoms that reduce lipid-accessible area (protein, peptide, DNA, ligands, …). Leave empty for none.'}
                >
                  Exclude atoms
                </p>
                <Input
                  size="sm"
                  bind:value={excludeSel}
                  placeholder="empty = none"
                  className="w-full"
                  title={aplMethod === 'fatslim'
                    ? 'Non-lipid atoms mapped to FATSLiM --interacting-group (protein group in NDX). Leave empty for bilayer-only.'
                    : aplMethod === 'evapl'
                      ? 'Non-lipid atoms that reduce lipid-accessible area (protein, peptide, DNA, ligands, …). Only atoms in the leaflet headgroup Z-range are used.'
                      : aplMethod === 'lipyphilic'
                        ? 'Non-lipid atoms for AreaPerLipid exclude_sel. Requires lipyphilic with PR #164 (git install) when non-empty; otherwise the run errors.'
                        : 'Non-lipid atoms that reduce lipid-accessible area (protein, peptide, DNA, ligands, …). Leave empty for none.'}
                />

                {#if showAplExcludeCutoff}
                  <div class="flex items-center gap-2">
                    <span
                      class="sidebar-label shrink-0"
                      title="Only exclude atoms within this distance of the leaflet are included. 0 = use all exclude atoms. LiPyphilic docs example uses 10 Å."
                    >Exclude cutoff (Å)</span
                    >
                    <Input
                      size="sm"
                      type="number"
                      min="0"
                      step="1"
                      bind:value={excludeCutoff}
                      className="w-20"
                      title="Only exclude atoms within this distance of the leaflet are included. 0 = use all exclude atoms. LiPyphilic docs example uses 10 Å."
                    />
                  </div>
                  <div class="flex items-center gap-2">
                    <span
                      class="sidebar-label shrink-0"
                      title="How exclude_cutoff is measured: 3 = 3D distance to leaflet atoms; 1 = |z − leaflet midplane|."
                    >Cutoff dim</span
                    >
                    <Select
                      size="sm"
                      bind:value={excludeDim}
                      className="min-w-0 flex-1"
                      title="How exclude_cutoff is measured: 3 = 3D distance to leaflet atoms; 1 = |z − leaflet midplane|."
                    >
                      <option value="3">3D distance</option>
                      <option value="1">Z to midplane</option>
                    </Select>
                  </div>
                {:else if aplMethod === 'evapl'}
                  <p class="sidebar-hint text-[11px] leading-snug">
                    EVAPL ignores cutoff/dim — exclude atoms are taken from the leaflet headgroup
                    Z-range.
                  </p>
                {:else if aplMethod === 'fatslim'}
                  <p class="sidebar-hint text-[11px] leading-snug">
                    FATSLiM ignores cutoff/dim — exclude atoms are passed as the interacting
                    group (NDX).
                  </p>
                {:else if aplMethod === 'gridmat' || aplMethod === 'gridmat_md'}
                  <p class="sidebar-hint text-[11px] leading-snug">
                    GridMAT ignores exclude cutoff/dim — protein proximity uses the precision
                    (Å) control
                    {aplMethod === 'gridmat_md' ? ' in the .pl param file' : ''}.
                  </p>
                {/if}

                {#if aplMethod === 'gridmat'}
                  <p class="gw-notice gw-notice-warning text-[11px] leading-snug">
                    Experimental GateWizard reimplementation (not bit-identical to GridMAT-MD.pl).
                    Prefer <strong>GridMAT-MD.pl (external)</strong> for the original tool.
                  </p>
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

                {#if aplMethod === 'gridmat_md'}
                  <p class="gw-notice gw-notice-info text-[11px] leading-snug">
                    Original Perl GridMAT-MD.pl. Set
                    <code class="text-[10px]">GATEWIZARD_GRIDMAT_MD</code>
                    to the script path (gatewizard
                    <code class="text-[10px]">scripts/install_gridmat_md.sh</code>).
                  </p>
                  <div class="flex items-center gap-2">
                    <span class="sidebar-label shrink-0">Grid points</span>
                    <Input
                      size="sm"
                      type="number"
                      min="2"
                      step="1"
                      bind:value={gridmatN}
                      className="w-20"
                      title="GridMAT-MD.pl grid points (default 20)"
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
                      title="GridMAT-MD.pl precision in Å (default 13 = 1.3 nm)"
                    />
                  </div>
                  <div class="flex items-center gap-2">
                    <span
                      class="sidebar-label shrink-0"
                      title="Parallel perl jobs (one frame each). Raise for long trajectories."
                    >Jobs</span
                    >
                    <Input
                      size="sm"
                      type="number"
                      min="1"
                      step="1"
                      bind:value={gridmatMdJobs}
                      className="w-20"
                      title="Parallel perl jobs (one frame each). Raise for long trajectories."
                    />
                  </div>
                {/if}

                {#if aplMethod === 'vtmc'}
                  <p class="gw-notice gw-notice-warning text-[11px] leading-snug">
                    GateWizard (GW) reimplementation of Mori et al. VTMC — experimental; not yet
                    validated against the original binary.
                  </p>
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
          <div
            class="flex gap-1 {optionsSearchHighlightId === 'selection' ? 'option-pulse-highlight rounded' : ''}"
            data-option-id="selection"
          >
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

        {#if analysisSets.length > 1}
          <div
            class="space-y-1 {optionsSearchHighlightId === 'apply-selection-all' ||
            optionsSearchHighlightId === 'selection'
              ? 'option-pulse-highlight'
              : ''}"
            data-option-id="apply-selection-all"
          >
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onclick={applyTypeSelectionToAllSets}
              title="Copies this analysis type’s selection onto every set (does not run)."
              >Apply to all sets</Button
            >
            <p class="sidebar-hint">
              Copies this analysis type’s selection onto every set (does not run).
            </p>
          </div>
        {/if}

        {#if structuralType === 'rmsd' || structuralType === 'radius_of_gyration'}
          <div class="space-y-1">
            <p class="sidebar-label">
              {structuralType === 'rmsd' ? 'Reference PDB (optional)' : 'Companion / Reference PDB (optional)'}
            </p>
            <div class="flex gap-1">
              <span
                class="min-w-0 flex-1"
                title={referenceStructurePath ||
                  (structuralType === 'rmsd'
                    ? 'Not set — uses Ref. frame'
                    : 'Not set — uses topology companion if needed')}
              >
                <Input
                  size="sm"
                  value={basename(referenceStructurePath) || '—'}
                  disabled
                  className="w-full"
                  title={referenceStructurePath ||
                    (structuralType === 'rmsd'
                      ? 'Not set — uses Ref. frame'
                      : 'Not set — uses topology companion if needed')}
                />
              </span>
              <Button size="sm" variant="outline" onclick={pickReferenceStructure}>Select</Button>
              {#if referenceStructurePath}
                <button
                  type="button"
                  class="shrink-0 px-1 text-red-500 hover:text-red-400"
                  onclick={() => {
                    referenceStructurePath = ''
                    persistActiveSetFields()
                  }}
                  title="Clear reference PDB">✕</button
                >
              {/if}
            </div>
            {#if structuralType === 'rmsd'}
              <p class="sidebar-hint">
                Starting structure for RMSD instead of Ref. frame. Do not add this file to Trajectories — extra PDBs break membrane thickness (no unit cell).
              </p>
            {:else}
              <p class="sidebar-hint">
                Same field as RMSD. For PSF/PRMTOP topologies, used as companion coordinates when validating the selection (Rg itself does not need a reference frame). Prefer production .dcd/.xtc in Trajectories — not .rst7.
              </p>
            {/if}
          </div>
        {/if}

        {#if structuralType === 'rmsd'}
          <div class="flex items-center gap-2">
            <span class="sidebar-label shrink-0">Ref. frame</span>
            <Input
              size="sm"
              type="number"
              min="0"
              bind:value={referenceFrame}
              disabled={Boolean(referenceStructurePath)}
              className="w-20"
              title={referenceStructurePath ? 'Ignored when a reference PDB is set' : 'Frame index in the concatenated trajectories'}
            />
          </div>
          <label class="flex items-center gap-2">
            <Checkbox name="align-rmsd" bind:checked={align} />
            <span class="sidebar-label">Align before RMSD</span>
          </label>
        {/if}

        {#if structuralType === 'rmsf'}
          <div class="space-y-1">
            <p
              class="sidebar-label"
              title="Re-run after changing. Plot Settings → Ticks = label count."
            >
              X axis type
            </p>
            <Select
              size="sm"
              className="w-full"
              value={rmsfXaxisType}
              title="Re-run after changing. Plot Settings → Ticks = label count."
              onchange={(e) => {
                rmsfXaxisType = /** @type {HTMLSelectElement} */ (e.currentTarget).value
                // Residue/atom axes should use Tick count, not a leftover time X step.
                setPlotField({ xTickStep: '' })
                persistActiveSetFields()
              }}
            >
              <option value="residue_number">Residue number</option>
              <option value="residue_type_number">Residue name + number</option>
              <option value="atom_index">Atom index</option>
            </Select>
          </div>
          <label
            class="flex items-center gap-2"
            title="Unwrap + align polymer before RMSF (membrane-centered Fix-PBC). Off = raw coords."
          >
            <Checkbox name="align-rmsf" bind:checked={align} />
            <span class="sidebar-label">Prepare protein (unwrap + align)</span>
          </label>
          <div class="space-y-1">
            <div class="flex items-center justify-between gap-1">
              <p
                class="sidebar-label"
                title="Prep files: *_protonated_renum.txt (pdb4amber) or *_gatewizard_residue_mapping.txt (written when ACE/NME capping runs in Preparation). Assign each file to the sets that should use original PDB residue numbers."
              >
                Residue mapping (original PDB)
              </p>
              <Button size="sm" variant="outline" onclick={addResidueMappingFiles}>+ Add</Button>
            </div>
            {#if residueMappingGroups.length === 0}
              <p class="sidebar-hint">
                Optional. Add one or more renum files and tick which sets they apply to (e.g. GateWizard only — leave Charmm unchecked).
              </p>
            {:else}
              <div class="space-y-2">
                {#each residueMappingGroups as group (group.id)}
                  <div class="rounded border border-neutral-700/80 p-1.5 space-y-1">
                    <div class="flex items-center gap-1">
                      <label
                        class="flex min-w-0 flex-1 items-center gap-1.5"
                        title={group.path}
                      >
                        <Checkbox
                          size="sm"
                          name={`rmap-en-${group.id}`}
                          checked={group.enabled}
                          disabled={!group.map.size}
                          onchange={(e) =>
                            patchResidueMappingGroup(group.id, {
                              enabled: /** @type {HTMLInputElement} */ (e.currentTarget).checked
                            })}
                        />
                        <span class="truncate text-[11px] leading-tight" title={group.path}
                          >{basename(group.path)}</span
                        >
                      </label>
                      <button
                        type="button"
                        class="shrink-0 px-1 text-red-500 hover:text-red-400"
                        onclick={() => removeResidueMappingGroup(group.id)}
                        title="Remove this mapping file">✕</button
                      >
                    </div>
                    {#if group.error}
                      <p class="sidebar-hint text-amber-400">{group.error}</p>
                    {:else}
                      <p class="sidebar-hint leading-tight">
                        {group.usefulCount || group.map.size} pair{(group.usefulCount || group.map.size) === 1
                          ? ''
                          : 's'}
                        · apply to ({group.setIds.length}/{analysisSets.length}):
                      </p>
                    {/if}
                    <div
                      class="max-h-24 space-y-0 overflow-y-auto overscroll-contain rounded border border-neutral-800/80 px-1 py-0.5 dark:border-neutral-800"
                      title="Scroll for more sets"
                    >
                      {#each analysisSets as set (set.id)}
                        <label
                          class="flex min-h-0 items-center gap-1 py-px text-[10px] leading-tight text-neutral-300"
                        >
                          <Checkbox
                            size="sm"
                            name={`rmap-${group.id}-${set.id}`}
                            checked={group.setIds.includes(set.id)}
                            onchange={(e) =>
                              toggleResidueMappingSet(
                                group.id,
                                set.id,
                                /** @type {HTMLInputElement} */ (e.currentTarget).checked
                              )}
                          />
                          <span class="min-w-0 truncate" title={set.legendLabel || set.label}
                            >{set.legendLabel || set.label}</span
                          >
                        </label>
                      {/each}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
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
                  value={logFiles[i].timeNs}
                  oninput={(e) =>
                    setLogTimeNs(i, /** @type {HTMLInputElement} */ (e.currentTarget).value)
                  }
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
        type="button"
        class="sidebar-heading flex w-full items-center justify-between gap-2 hover:text-neutral-700 dark:hover:text-neutral-200"
        aria-expanded={plotSettingsOpen}
        onclick={() => (plotSettingsOpen = !plotSettingsOpen)}
      >
        <span>⚙ Plot Settings</span>
        <ChevronDown
          className="plot-settings-section-chevron {plotSettingsOpen ? '' : 'is-collapsed'}"
        />
      </button>

      {#if plotSettingsOpen}
        <div class="plot-settings-accordion">
          <!-- 1. Figure strip (always visible card) -->
          <div class="plot-settings-section">
            <div class="plot-settings-section-static">
              <p class="plot-settings-section-title">Figure</p>
            {#if toolbarIsGrid}
              <div>
                <p class="sidebar-label mb-0.5">Apply settings</p>
                <div class="flex gap-1">
                  <Button
                    size="sm"
                    variant={activeMosaicLayout.plotApplyScope !== 'cell' ? 'default' : 'outline'}
                    className="flex-1"
                    onclick={() => patchGridChrome({ plotApplyScope: 'all' })}>All cells</Button
                  >
                  <Button
                    size="sm"
                    variant={activeMosaicLayout.plotApplyScope === 'cell' ? 'default' : 'outline'}
                    className="flex-1"
                    onclick={() => patchGridChrome({ plotApplyScope: 'cell' })}
                    >This cell ({selectedGridCell + 1})</Button
                  >
                </div>
                <p class="sidebar-hint">
                  {activeMosaicLayout.plotApplyScope === 'cell'
                    ? 'Applies to the selected square (click a plot to choose it).'
                    : 'Applies to every square.'}
                </p>
              </div>
            {/if}
            {#if mode === 'structural'}
              <div
                class={optionsSearchHighlightId === 'plot-title' ? 'option-pulse-highlight rounded' : ''}
                data-option-id="plot-title"
              >
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
              </div>
              {#if activeAnalysisSet}
                <div
                  class={optionsSearchHighlightId === 'legend-label' ? 'option-pulse-highlight rounded' : ''}
                  data-option-id="legend-label"
                >
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
                </div>
              {/if}
            {/if}
            {#if mode === 'energetic'}
              <div
                class={optionsSearchHighlightId === 'plot-title' ? 'option-pulse-highlight rounded' : ''}
                data-option-id="plot-title"
              >
                <p class="sidebar-label mb-0.5">Title</p>
                <Input
                  size="sm"
                  value={ePlotGlobal.title}
                  placeholder={chartTitle || 'Energetic Analysis'}
                  className="w-full"
                  oninput={(e) => {
                    ePlotGlobal = { ...ePlotGlobal, title: e.currentTarget.value }
                    markSessionDirty()
                  }}
                />
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
          </div>
          </div>

          <!-- 2. Limits & ticks -->
          <div class="plot-settings-section" class:is-open={plotSectionOpen.limits}>
            <button
              type="button"
              class="plot-settings-section-header"
              aria-expanded={plotSectionOpen.limits}
              onclick={() => togglePlotSection('limits')}
            >
              <span class="plot-settings-section-title">Limits & ticks</span>
              <ChevronDown
                className="plot-settings-section-chevron {plotSectionOpen.limits ? '' : 'is-collapsed'}"
              />
            </button>
            {#if plotSectionOpen.limits}
              <div class="plot-settings-section-body">
                <div
                  class="min-w-0 space-y-1 {optionsSearchHighlightId === 'x-limits' ||
                  optionsSearchHighlightId === 'y-limits'
                    ? 'option-pulse-highlight rounded p-1'
                    : ''}"
                >
                  <div
                    class="grid min-w-0 grid-cols-[1.15rem_minmax(0,1.35fr)_minmax(0,1.35fr)_2.35rem_2.85rem] items-end gap-1"
                    data-option-id="x-limits"
                  >
                    <p class="sidebar-label pb-1.5">X</p>
                    <div class="min-w-0">
                      <p class="sidebar-label mb-0.5">Min</p>
                      <Input
                        size="sm"
                        value={ps.xMin}
                        placeholder="auto"
                        className="w-full min-w-0"
                        oninput={(e) => {
                          structViewRange = null
                          setPlotField({
                            xMin: /** @type {HTMLInputElement} */ (e.currentTarget).value
                          })
                        }}
                      />
                    </div>
                    <div class="min-w-0">
                      <p class="sidebar-label mb-0.5">Max</p>
                      <Input
                        size="sm"
                        value={ps.xMax}
                        placeholder="auto"
                        className="w-full min-w-0"
                        oninput={(e) => {
                          structViewRange = null
                          setPlotField({
                            xMax: /** @type {HTMLInputElement} */ (e.currentTarget).value
                          })
                        }}
                      />
                    </div>
                    <div class="min-w-0">
                      <p class="sidebar-label mb-0.5">Ticks</p>
                      <Input
                        size="sm"
                        type="number"
                        min="2"
                        max="20"
                        step="1"
                        value={ps.xTickCount}
                        className="w-full min-w-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        title="Number of X tick marks. Clears X tick step so count is used."
                        oninput={(e) =>
                          setPlotField({
                            xTickCount: /** @type {HTMLInputElement} */ (e.currentTarget).value,
                            xTickStep: ''
                          })
                        }
                      />
                    </div>
                    <div class="min-w-0">
                      <p class="sidebar-label mb-0.5">Dec.</p>
                      <Input
                        size="sm"
                        type="number"
                        min="0"
                        max="8"
                        step="1"
                        value={ps.xTickDecimals}
                        placeholder="auto"
                        className="w-full min-w-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        title="X tick decimal places. Empty = auto."
                        oninput={(e) =>
                          setPlotField({
                            xTickDecimals: /** @type {HTMLInputElement} */ (e.currentTarget).value
                          })
                        }
                      />
                    </div>
                  </div>
                  <div
                    class="grid min-w-0 grid-cols-[1.15rem_minmax(0,1.35fr)_minmax(0,1.35fr)_2.35rem_2.85rem] items-end gap-1"
                    data-option-id="y-limits"
                  >
                    <p class="sidebar-label pb-1.5">Y</p>
                    <div class="min-w-0">
                      <p class="sidebar-label mb-0.5">Min</p>
                      <Input
                        size="sm"
                        value={mode === 'energetic' ? plotEdit.yMin ?? '' : ps.yMin}
                        placeholder="auto"
                        className="w-full min-w-0"
                        oninput={(e) => {
                          const v = /** @type {HTMLInputElement} */ (e.currentTarget).value
                          if (mode === 'energetic') setPlotField({ yMin: v })
                          else {
                            structViewRange = null
                            setPlotField({ yMin: v })
                          }
                        }}
                      />
                    </div>
                    <div class="min-w-0">
                      <p class="sidebar-label mb-0.5">Max</p>
                      <Input
                        size="sm"
                        value={mode === 'energetic' ? plotEdit.yMax ?? '' : ps.yMax}
                        placeholder="auto"
                        className="w-full min-w-0"
                        oninput={(e) => {
                          const v = /** @type {HTMLInputElement} */ (e.currentTarget).value
                          if (mode === 'energetic') setPlotField({ yMax: v })
                          else {
                            structViewRange = null
                            setPlotField({ yMax: v })
                          }
                        }}
                      />
                    </div>
                    <div class="min-w-0">
                      <p class="sidebar-label mb-0.5">Ticks</p>
                      <Input
                        size="sm"
                        type="number"
                        min="2"
                        max="20"
                        step="1"
                        value={ps.yTickCount}
                        className="w-full min-w-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        title="Number of Y tick marks. Clears Y tick step so count is used."
                        oninput={(e) =>
                          setPlotField({
                            yTickCount: /** @type {HTMLInputElement} */ (e.currentTarget).value,
                            yTickStep: ''
                          })
                        }
                      />
                    </div>
                    <div class="min-w-0">
                      <p class="sidebar-label mb-0.5">Dec.</p>
                      <Input
                        size="sm"
                        type="number"
                        min="0"
                        max="8"
                        step="1"
                        value={ps.yTickDecimals}
                        placeholder="auto"
                        className="w-full min-w-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        title="Y tick decimal places. Empty = auto."
                        oninput={(e) =>
                          setPlotField({
                            yTickDecimals: /** @type {HTMLInputElement} */ (e.currentTarget).value
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
                <div class="grid grid-cols-2 gap-1">
                  <div
                    class={optionsSearchHighlightId === 'x-tick-step' ? 'option-pulse-highlight rounded p-0.5' : ''}
                    data-option-id="x-tick-step"
                  >
                    <p class="sidebar-label mb-0.5">X tick step</p>
                    <Input
                      size="sm"
                      type="number"
                      min="0"
                      step="any"
                      value={ps.xTickStep || ''}
                      placeholder="count"
                      className="w-full"
                      title="Spacing in X units. Empty uses tick count."
                      oninput={(e) =>
                        setPlotField({
                          xTickStep: /** @type {HTMLInputElement} */ (e.currentTarget).value
                        })
                      }
                    />
                  </div>
                  <div
                    class={optionsSearchHighlightId === 'y-tick-step' ? 'option-pulse-highlight rounded p-0.5' : ''}
                    data-option-id="y-tick-step"
                  >
                    <p class="sidebar-label mb-0.5">Y tick step</p>
                    <Input
                      size="sm"
                      type="number"
                      min="0"
                      step="any"
                      value={ps.yTickStep || ''}
                      placeholder="count"
                      className="w-full"
                      title="Spacing in Y units. Empty uses tick count."
                      oninput={(e) =>
                        setPlotField({
                          yTickStep: /** @type {HTMLInputElement} */ (e.currentTarget).value
                        })
                      }
                    />
                  </div>
                </div>
                {#if mode === 'energetic' && energeticCompareLayout === 'grid'}
                  <label
                    class="flex items-center gap-2 {optionsSearchHighlightId === 'sync-x-limits'
                      ? 'option-pulse-highlight rounded p-1'
                      : ''}"
                    data-option-id="sync-x-limits"
                  >
                    <Checkbox name="sync-x" bind:checked={ePlotGlobal.syncX} />
                    <span class="sidebar-label">Sync X limits across panels</span>
                  </label>
                {/if}
                <div class="min-w-0 space-y-1">
                  <div class="flex items-center justify-between">
                    <p class="sidebar-label">Reference lines</p>
                    <Button
                      size="sm"
                      variant="ghost"
                      onclick={() =>
                        patchReferenceLines([
                          ...(ps.referenceLines || []),
                          emptyReferenceLine()
                        ])
                      }>+ Add</Button
                    >
                  </div>
                  {#each structReferenceLines as line, ri (`ref-${ri}`)}
                    <div class="min-w-0 space-y-1 rounded-md border border-neutral-800 p-1.5">
                      <div class="flex min-w-0 items-center gap-1">
                        <Select
                          size="sm"
                          className="w-12 shrink-0"
                          value={line.axis}
                          onchange={(e) => {
                            const next = [...structReferenceLines]
                            next[ri] = {
                              ...next[ri],
                              axis: /** @type {HTMLSelectElement} */ (e.currentTarget).value
                            }
                            patchReferenceLines(next)
                          }}
                        >
                          <option value="y">Y</option>
                          <option value="x">X</option>
                        </Select>
                        <Input
                          size="sm"
                          type="number"
                          step="any"
                          value={line.value}
                          className="min-w-0 flex-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          title="Value"
                          oninput={(e) => {
                            const next = [...structReferenceLines]
                            next[ri] = {
                              ...next[ri],
                              value: Number(/** @type {HTMLInputElement} */ (e.currentTarget).value)
                            }
                            patchReferenceLines(next)
                          }}
                        />
                        <ColorInput
                          size="sm"
                          className="shrink-0"
                          value={line.color}
                          oninput={(e) => {
                            const next = [...structReferenceLines]
                            next[ri] = {
                              ...next[ri],
                              color: /** @type {HTMLInputElement} */ (e.currentTarget).value
                            }
                            patchReferenceLines(next)
                          }}
                        />
                        <Input
                          size="sm"
                          type="number"
                          min="0.4"
                          max="6"
                          step="0.1"
                          value={line.width}
                          className="w-10 shrink-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          title="Width"
                          oninput={(e) => {
                            const next = [...structReferenceLines]
                            next[ri] = {
                              ...next[ri],
                              width: Number(/** @type {HTMLInputElement} */ (e.currentTarget).value)
                            }
                            patchReferenceLines(next)
                          }}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="shrink-0 px-1.5"
                          onclick={() =>
                            patchReferenceLines(structReferenceLines.filter((_, j) => j !== ri))
                          }>✕</Button
                        >
                      </div>
                      <div class="flex min-w-0 items-center gap-1">
                        <Select
                          size="sm"
                          className="w-[4.5rem] shrink-0"
                          value={line.style}
                          title="Line style"
                          onchange={(e) => {
                            const next = [...structReferenceLines]
                            next[ri] = {
                              ...next[ri],
                              style: /** @type {HTMLSelectElement} */ (e.currentTarget).value
                            }
                            patchReferenceLines(next)
                          }}
                        >
                          <option value="solid">Solid</option>
                          <option value="dashed">Dash</option>
                          <option value="dotted">Dot</option>
                          <option value="dashdot">Dash·</option>
                        </Select>
                        <Select
                          size="sm"
                          className="w-[3.75rem] shrink-0"
                          value={line.zOrder || 'back'}
                          title="Draw behind or in front of data"
                          onchange={(e) => {
                            const next = [...structReferenceLines]
                            next[ri] = {
                              ...next[ri],
                              zOrder: /** @type {HTMLSelectElement} */ (e.currentTarget).value
                            }
                            patchReferenceLines(next)
                          }}
                        >
                          <option value="back">Back</option>
                          <option value="forward">Front</option>
                        </Select>
                        <Input
                          size="sm"
                          type="number"
                          min="0"
                          max="1"
                          step="0.05"
                          value={line.opacity}
                          className="w-11 shrink-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          title="Opacity (0–1)"
                          oninput={(e) => {
                            const next = [...structReferenceLines]
                            next[ri] = {
                              ...next[ri],
                              opacity: Number(/** @type {HTMLInputElement} */ (e.currentTarget).value)
                            }
                            patchReferenceLines(next)
                          }}
                        />
                        <Input
                          size="sm"
                          value={line.label}
                          placeholder="Label"
                          className="min-w-0 flex-1"
                          title="Label"
                          oninput={(e) => {
                            const next = [...structReferenceLines]
                            next[ri] = {
                              ...next[ri],
                              label: /** @type {HTMLInputElement} */ (e.currentTarget).value
                            }
                            patchReferenceLines(next)
                          }}
                        />
                      </div>
                    </div>
                  {/each}
                </div>
                <div class="min-w-0 space-y-1">
                  <div class="flex items-center justify-between">
                    <p class="sidebar-label">Reference bands</p>
                    <Button
                      size="sm"
                      variant="ghost"
                      onclick={() =>
                        patchReferenceBands([...(ps.referenceBands || []), emptyReferenceBand()])
                      }>+ Add</Button
                    >
                  </div>
                  {#each structReferenceBands as band, bi (`refband-${bi}`)}
                    <div class="min-w-0 space-y-1 rounded-md border border-neutral-800 p-1.5">
                      <div class="flex min-w-0 items-center gap-1">
                        <Select
                          size="sm"
                          className="w-12 shrink-0"
                          value={band.axis}
                          title="Horizontal (Y range) or vertical (X range)"
                          onchange={(e) => {
                            const next = [...structReferenceBands]
                            next[bi] = {
                              ...next[bi],
                              axis: /** @type {HTMLSelectElement} */ (e.currentTarget).value
                            }
                            patchReferenceBands(next)
                          }}
                        >
                          <option value="y">Y</option>
                          <option value="x">X</option>
                        </Select>
                        <Input
                          size="sm"
                          type="number"
                          step="any"
                          value={band.min}
                          className="min-w-0 flex-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          title={band.axis === 'x' ? 'X min' : 'Y min'}
                          oninput={(e) => {
                            const next = [...structReferenceBands]
                            next[bi] = {
                              ...next[bi],
                              min: coerceReferenceBandBound(
                                /** @type {HTMLInputElement} */ (e.currentTarget).value
                              )
                            }
                            patchReferenceBands(next)
                          }}
                        />
                        <Input
                          size="sm"
                          type="number"
                          step="any"
                          value={band.max}
                          className="min-w-0 flex-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          title={band.axis === 'x' ? 'X max' : 'Y max'}
                          oninput={(e) => {
                            const next = [...structReferenceBands]
                            next[bi] = {
                              ...next[bi],
                              max: coerceReferenceBandBound(
                                /** @type {HTMLInputElement} */ (e.currentTarget).value
                              )
                            }
                            patchReferenceBands(next)
                          }}
                        />
                        <ColorInput
                          size="sm"
                          className="shrink-0"
                          value={band.color}
                          oninput={(e) => {
                            const next = [...structReferenceBands]
                            next[bi] = {
                              ...next[bi],
                              color: /** @type {HTMLInputElement} */ (e.currentTarget).value
                            }
                            patchReferenceBands(next)
                          }}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="shrink-0 px-1.5"
                          onclick={() =>
                            patchReferenceBands(structReferenceBands.filter((_, j) => j !== bi))
                          }>✕</Button
                        >
                      </div>
                      <div class="flex min-w-0 items-center gap-1">
                        <Select
                          size="sm"
                          className="w-[5.5rem] shrink-0"
                          value={band.zOrder || 'back'}
                          title="Draw behind or in front of data"
                          onchange={(e) => {
                            const next = [...structReferenceBands]
                            next[bi] = {
                              ...next[bi],
                              zOrder: /** @type {HTMLSelectElement} */ (e.currentTarget).value
                            }
                            patchReferenceBands(next)
                          }}
                        >
                          <option value="back">Back</option>
                          <option value="forward">Front</option>
                        </Select>
                        <Input
                          size="sm"
                          type="number"
                          min="0"
                          max="1"
                          step="0.05"
                          value={band.opacity}
                          className="w-12 shrink-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          title="Fill opacity (0–1)"
                          oninput={(e) => {
                            const next = [...structReferenceBands]
                            next[bi] = {
                              ...next[bi],
                              opacity: Number(/** @type {HTMLInputElement} */ (e.currentTarget).value)
                            }
                            patchReferenceBands(next)
                          }}
                        />
                        <label
                          class="flex shrink-0 items-center gap-1 text-[10px] text-neutral-400"
                          title="Draw border around the band"
                        >
                          <Checkbox
                            checked={!!band.border}
                            onchange={(e) => {
                              const next = [...structReferenceBands]
                              next[bi] = {
                                ...next[bi],
                                border: /** @type {HTMLInputElement} */ (e.currentTarget).checked
                              }
                              patchReferenceBands(next)
                            }}
                          />
                          Border
                        </label>
                        <Input
                          size="sm"
                          value={band.label}
                          placeholder="Label"
                          className="min-w-0 flex-1"
                          oninput={(e) => {
                            const next = [...structReferenceBands]
                            next[bi] = {
                              ...next[bi],
                              label: /** @type {HTMLInputElement} */ (e.currentTarget).value
                            }
                            patchReferenceBands(next)
                          }}
                        />
                      </div>
                      {#if band.border}
                        <div class="flex min-w-0 items-center gap-1">
                          <ColorInput
                            size="sm"
                            className="shrink-0"
                            value={band.borderColor || band.color}
                            title="Border color"
                            oninput={(e) => {
                              const next = [...structReferenceBands]
                              next[bi] = {
                                ...next[bi],
                                borderColor: /** @type {HTMLInputElement} */ (e.currentTarget).value
                              }
                              patchReferenceBands(next)
                            }}
                          />
                          <Input
                            size="sm"
                            type="number"
                            min="0.4"
                            max="6"
                            step="0.1"
                            value={band.borderWidth}
                            className="w-10 shrink-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            title="Border width"
                            oninput={(e) => {
                              const next = [...structReferenceBands]
                              next[bi] = {
                                ...next[bi],
                                borderWidth: Number(
                                  /** @type {HTMLInputElement} */ (e.currentTarget).value
                                )
                              }
                              patchReferenceBands(next)
                            }}
                          />
                          <Select
                            size="sm"
                            className="min-w-0 flex-1"
                            value={band.borderStyle || 'solid'}
                            onchange={(e) => {
                              const next = [...structReferenceBands]
                              next[bi] = {
                                ...next[bi],
                                borderStyle: /** @type {HTMLSelectElement} */ (e.currentTarget).value
                              }
                              patchReferenceBands(next)
                            }}
                          >
                            <option value="solid">Solid</option>
                            <option value="dashed">Dashed</option>
                            <option value="dotted">Dotted</option>
                            <option value="dashdot">Dash-dot</option>
                          </Select>
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
          </div>

          <!-- 3. Appearance -->
          <div class="plot-settings-section" class:is-open={plotSectionOpen.appearance}>
            <button
              type="button"
              class="plot-settings-section-header"
              aria-expanded={plotSectionOpen.appearance}
              onclick={() => togglePlotSection('appearance')}
            >
              <span class="plot-settings-section-title">Appearance</span>
              <ChevronDown
                className="plot-settings-section-chevron {plotSectionOpen.appearance
                  ? ''
                  : 'is-collapsed'}"
              />
            </button>
            {#if plotSectionOpen.appearance}
              <div class="plot-settings-section-body">
                <div class="grid grid-cols-2 gap-1">
                  {#if mode === 'structural'}
                    <div
                      class={optionsSearchHighlightId === 'line-color' ? 'option-pulse-highlight rounded p-0.5' : ''}
                      data-option-id="line-color"
                      title="Same color as the set. Area per lipid uses it for Average."
                    >
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
                    </div>
                    <div
                      class={optionsSearchHighlightId === 'plot-bg' ? 'option-pulse-highlight rounded p-0.5' : ''}
                      data-option-id="plot-bg"
                      title="Auto follows light/dark theme. With a custom grid, Apply settings scopes Plot bg."
                    >
                      <p class="sidebar-label mb-0.5">Plot bg</p>
                      <div class="flex items-center gap-1">
                        <input
                          type="color"
                          value={scopedPlotBgDisplay}
                          class="h-7 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                          oninput={(e) => setStructuralPlotBg(e.currentTarget.value)}
                        />
                        <Input
                          size="sm"
                          value={scopedPlotBgValue}
                          placeholder={resolvedStructColors.plotBg}
                          className="min-w-0 flex-1 font-mono"
                          oninput={(e) => setStructuralPlotBg(e.currentTarget.value)}
                        />
                      </div>
                      <div class="mt-0.5 flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!scopedPlotBgCustomized}
                          onclick={clearStructuralPlotBgCustom}
                        >Auto</Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onclick={applyStructuralPlotColorsToAllTypes}
                          title="Copy this plot's background and text colors to every structural analysis type"
                        >All types</Button>
                      </div>
                    </div>
                    <div
                      class="col-span-2 {optionsSearchHighlightId === 'text-color'
                        ? 'option-pulse-highlight rounded p-0.5'
                        : ''}"
                      data-option-id="text-color"
                    >
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
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!ps.textColorCustomized}
                          onclick={clearStructuralTextColorCustom}
                        >Auto</Button>
                      </div>
                    </div>
                  {:else if mode === 'energetic'}
                    {#if selectedProperties[0]}
                      {@const pk = selectedProperties[0]}
                      <div
                        class={optionsSearchHighlightId === 'line-color'
                          ? 'option-pulse-highlight rounded p-0.5'
                          : ''}
                        data-option-id="line-color"
                      >
                        <p class="sidebar-label mb-0.5">Line color ({pk})</p>
                        <div class="flex items-center gap-1">
                          <input
                            type="color"
                            value={ePlotPanels[pk]?.lineColor || '#f59e0b'}
                            class="h-7 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                            oninput={(e) => {
                              ensureEPlotPanel(pk)
                              markSessionDirty()
                              ePlotPanels = {
                                ...ePlotPanels,
                                [pk]: { ...ePlotPanels[pk], lineColor: e.currentTarget.value }
                              }
                              cellLineCache = new WeakMap()
                              syncEnergeticChartViewFromSets()
                            }}
                          />
                        </div>
                      </div>
                    {/if}
                    <div
                      class={optionsSearchHighlightId === 'plot-bg' ? 'option-pulse-highlight rounded p-0.5' : ''}
                      data-option-id="plot-bg"
                      title="Auto follows light/dark theme."
                    >
                      <p class="sidebar-label mb-0.5">Plot bg</p>
                      <div class="flex items-center gap-1">
                        <input
                          type="color"
                          value={scopedPlotBgDisplay}
                          class="h-7 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                          oninput={(e) => setEnergeticPlotBg(e.currentTarget.value)}
                        />
                        <Input
                          size="sm"
                          value={scopedPlotBgValue}
                          placeholder={resolvedEnergColors.plotBg}
                          className="min-w-0 flex-1 font-mono"
                          oninput={(e) => setEnergeticPlotBg(e.currentTarget.value)}
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!scopedPlotBgCustomized}
                        onclick={() => setEnergeticPlotBg('')}
                      >Auto</Button>
                    </div>
                    <div
                      class={optionsSearchHighlightId === 'text-color' ? 'option-pulse-highlight rounded p-0.5' : ''}
                      data-option-id="text-color"
                    >
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
                  {/if}
                </div>
                <div
                  class="flex flex-wrap items-end gap-2 {optionsSearchHighlightId === 'show-grid'
                    ? 'option-pulse-highlight rounded p-1'
                    : ''}"
                  data-option-id="show-grid"
                >
                  <label class="flex items-center gap-2">
                    <Checkbox
                      name="show-grid"
                      checked={plotEdit.showGrid !== false}
                      onchange={(e) => setPlotField({ showGrid: e.currentTarget.checked })}
                    />
                    <span class="sidebar-label">Show grid</span>
                  </label>
                  <div>
                    <p class="sidebar-label mb-0.5">Grid color</p>
                    <div class="flex items-center gap-1">
                      <input
                        type="color"
                        value={String(plotEdit.gridColor || '').trim() || (mode === 'energetic' ? resolvedEnergColors.textColor : resolvedStructColors.textColor)}
                        disabled={plotEdit.showGrid === false}
                        class="h-7 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0 disabled:opacity-40"
                        oninput={(e) => setPlotField({ gridColor: e.currentTarget.value })}
                        title="Background grid line color"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!String(plotEdit.gridColor || '').trim()}
                        onclick={() => setPlotField({ gridColor: '' })}
                      >Auto</Button>
                    </div>
                  </div>
                </div>
              </div>
            {/if}
          </div>

          <!-- 4. Series & lines -->
          <div class="plot-settings-section" class:is-open={plotSectionOpen.series}>
            <button
              type="button"
              class="plot-settings-section-header"
              aria-expanded={plotSectionOpen.series}
              onclick={() => togglePlotSection('series')}
            >
              <span class="plot-settings-section-title">Series & lines</span>
              <ChevronDown
                className="plot-settings-section-chevron {plotSectionOpen.series ? '' : 'is-collapsed'}"
              />
            </button>
            {#if plotSectionOpen.series}
              <div class="plot-settings-section-body">
                <div class="grid grid-cols-2 gap-1">
                  <div
                    class={optionsSearchHighlightId === 'line-width' ? 'option-pulse-highlight rounded p-0.5' : ''}
                    data-option-id="line-width"
                  >
                    <p class="sidebar-label mb-0.5">Line width</p>
                    <Input
                      size="sm"
                      type="number"
                      min="0.5"
                      max="12"
                      step="0.5"
                      value={plotEdit.lineWidth}
                      className="w-full"
                      oninput={(e) =>
                        setPlotField({
                          lineWidth: /** @type {HTMLInputElement} */ (e.currentTarget).value
                        })
                      }
                    />
                  </div>
                  <div
                    class={optionsSearchHighlightId === 'line-style' ? 'option-pulse-highlight rounded p-0.5' : ''}
                    data-option-id="line-style"
                  >
                    <p class="sidebar-label mb-0.5">Line style</p>
                    <Select
                      size="sm"
                      className="w-full"
                      value={plotEdit.lineStyle || 'solid'}
                      onchange={(e) =>
                        setPlotField({
                          lineStyle: /** @type {HTMLSelectElement} */ (e.currentTarget).value
                        })
                      }
                    >
                      <option value="solid">Solid</option>
                      <option value="dashed">Dashed</option>
                      <option value="dotted">Dotted</option>
                      <option value="dashdot">Dash-dot</option>
                    </Select>
                  </div>
                </div>
                {#if mode === 'structural' && structuralType === 'area_per_lipid'}
                  <div
                    class="space-y-1 rounded border border-neutral-800 p-2 {optionsSearchHighlightId === 'apl-series'
                      ? 'option-pulse-highlight'
                      : ''}"
                    data-option-id="apl-series"
                  >
                    <p class="sidebar-label">Area per lipid series (this set)</p>
                    <p class="sidebar-hint">
                      Uncheck a series to hide it on the plot. CSV still stores all three.
                    </p>
                    <div class="flex flex-wrap gap-x-3 gap-y-1">
                      <label class="flex items-center gap-1.5">
                        <Checkbox
                          name="apl-show-mean"
                          size="sm"
                          checked={ps.aplShowMean !== false}
                          onchange={(e) => setAplSeriesVisible('mean', e.currentTarget.checked)}
                        />
                        <span class="text-xs text-neutral-700 dark:text-neutral-300">Average</span>
                      </label>
                      <label class="flex items-center gap-1.5">
                        <Checkbox
                          name="apl-show-upper"
                          size="sm"
                          checked={ps.aplShowUpper !== false}
                          onchange={(e) => setAplSeriesVisible('upper', e.currentTarget.checked)}
                        />
                        <span class="text-xs text-neutral-700 dark:text-neutral-300">Upper leaflet</span>
                      </label>
                      <label class="flex items-center gap-1.5">
                        <Checkbox
                          name="apl-show-lower"
                          size="sm"
                          checked={ps.aplShowLower !== false}
                          onchange={(e) => setAplSeriesVisible('lower', e.currentTarget.checked)}
                        />
                        <span class="text-xs text-neutral-700 dark:text-neutral-300">Lower leaflet</span>
                      </label>
                    </div>
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
                    </div>
                  </div>
                {/if}
              </div>
            {/if}
          </div>

          <!-- 5. In-chart legend -->
          <div class="plot-settings-section" class:is-open={plotSectionOpen.legend}>
            <button
              type="button"
              class="plot-settings-section-header"
              aria-expanded={plotSectionOpen.legend}
              onclick={() => togglePlotSection('legend')}
            >
              <span class="plot-settings-section-title">In-chart legend</span>
              <ChevronDown
                className="plot-settings-section-chevron {plotSectionOpen.legend ? '' : 'is-collapsed'}"
              />
            </button>
            {#if plotSectionOpen.legend}
              <div class="plot-settings-section-body">
                {#if showInChartLegendControls}
                  <div
                    class={optionsSearchHighlightId === 'legend-position'
                      ? 'option-pulse-highlight rounded p-0.5'
                      : ''}
                    data-option-id="legend-position"
                  >
                    <p class="sidebar-label mb-0.5">Legend position</p>
                    <Select
                      size="sm"
                      value={plotEdit.legendPosition || 'top-left'}
                      className="w-full"
                      onchange={(e) =>
                        setPlotField({
                          legendPosition: /** @type {HTMLSelectElement} */ (e.currentTarget).value
                        })
                      }
                    >
                      <option value="bottom">Below chart</option>
                      <option value="top-left">Inside — top left</option>
                      <option value="top-right">Inside — top right</option>
                      <option value="bottom-left">Inside — bottom left</option>
                      <option value="bottom-right">Inside — bottom right</option>
                      <option value="none">Hidden</option>
                    </Select>
                  </div>
                  <div class="grid grid-cols-2 gap-1">
                    <div
                      class={optionsSearchHighlightId === 'legend-square'
                        ? 'option-pulse-highlight rounded p-0.5'
                        : ''}
                      data-option-id="legend-square"
                    >
                      <p class="sidebar-label mb-0.5">Legend square (px)</p>
                      <Input
                        size="sm"
                        type="number"
                        min="6"
                        max="48"
                        step="1"
                        value={plotEdit.legendSwatchSize}
                        className="w-full"
                        oninput={(e) =>
                          setPlotField({
                            legendSwatchSize: /** @type {HTMLInputElement} */ (e.currentTarget).value
                          })
                        }
                      />
                    </div>
                    <div
                      class={optionsSearchHighlightId === 'legend-font'
                        ? 'option-pulse-highlight rounded p-0.5'
                        : ''}
                      data-option-id="legend-font"
                    >
                      <p class="sidebar-label mb-0.5">Legend font (px)</p>
                      <Input
                        size="sm"
                        type="number"
                        min="1"
                        step="1"
                        value={plotEdit.legendFontSize}
                        className="w-full"
                        oninput={(e) =>
                          setPlotField({
                            legendFontSize: /** @type {HTMLInputElement} */ (e.currentTarget).value
                          })
                        }
                      />
                    </div>
                  </div>
                {:else}
                  <p class="sidebar-hint">Outside legend chrome is in Grid options.</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onclick={() => {
                      plotLayoutOptionsOpen = true
                      plotLayoutOptionsCollapsed = false
                      requestSidePanelExpand('analysis-grid')
                    }}
                  >Open Grid options</Button>
                {/if}
              </div>
            {/if}
          </div>

          <!-- 6. Typography -->
          <div class="plot-settings-section" class:is-open={plotSectionOpen.typography}>
            <button
              type="button"
              class="plot-settings-section-header"
              aria-expanded={plotSectionOpen.typography}
              onclick={() => togglePlotSection('typography')}
            >
              <span class="plot-settings-section-title">Typography</span>
              <ChevronDown
                className="plot-settings-section-chevron {plotSectionOpen.typography
                  ? ''
                  : 'is-collapsed'}"
              />
            </button>
            {#if plotSectionOpen.typography}
              <div class="plot-settings-section-body">
                <div class="grid grid-cols-2 gap-1">
                  <div
                    class={optionsSearchHighlightId === 'axis-font' ? 'option-pulse-highlight rounded p-0.5' : ''}
                    data-option-id="axis-font"
                  >
                    <p class="sidebar-label mb-0.5">Axis font (px)</p>
                    <Input
                      size="sm"
                      type="number"
                      min="7"
                      max="64"
                      step="1"
                      value={plotEdit.axisFontSize}
                      className="w-full"
                      oninput={(e) =>
                        setPlotField({
                          axisFontSize: /** @type {HTMLInputElement} */ (e.currentTarget).value
                        })
                      }
                    />
                    <label class="mt-1 flex items-center gap-1.5 text-[11px] text-neutral-600 dark:text-neutral-400">
                      <Checkbox
                        checked={plotEdit.axisFontBold === true}
                        onchange={(e) => setPlotField({ axisFontBold: e.currentTarget.checked })}
                      />
                      Bold
                    </label>
                  </div>
                  <div
                    class={optionsSearchHighlightId === 'title-font' ? 'option-pulse-highlight rounded p-0.5' : ''}
                    data-option-id="title-font"
                  >
                    <p class="sidebar-label mb-0.5">Title font (px)</p>
                    <Input
                      size="sm"
                      type="number"
                      min="8"
                      max="64"
                      step="1"
                      value={plotEdit.titleFontSize}
                      className="w-full"
                      oninput={(e) =>
                        setPlotField({
                          titleFontSize: /** @type {HTMLInputElement} */ (e.currentTarget).value
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            {/if}
          </div>

          <!-- 7. Margins & spines -->
          <div class="plot-settings-section" class:is-open={plotSectionOpen.margins}>
            <button
              type="button"
              class="plot-settings-section-header"
              aria-expanded={plotSectionOpen.margins}
              onclick={() => togglePlotSection('margins')}
            >
              <span class="plot-settings-section-title">Margins & spines</span>
              <ChevronDown
                className="plot-settings-section-chevron {plotSectionOpen.margins ? '' : 'is-collapsed'}"
              />
            </button>
            {#if plotSectionOpen.margins}
              <div class="plot-settings-section-body">
                <div
                  class="grid grid-cols-2 gap-1 {optionsSearchHighlightId === 'extra-margins'
                    ? 'option-pulse-highlight rounded p-1'
                    : ''}"
                  data-option-id="extra-margins"
                >
                  <div>
                    <p class="sidebar-label mb-0.5">Extra left margin</p>
                    <Input
                      size="sm"
                      type="number"
                      min="-80"
                      max="240"
                      step="1"
                      value={plotEdit.extraLeftMargin}
                      className="w-full"
                      placeholder="0"
                      title="0 is tight to the Y numbers. Negative pulls the plot left."
                      oninput={(e) =>
                        setPlotField({
                          extraLeftMargin: /** @type {HTMLInputElement} */ (e.currentTarget).value
                        })
                      }
                    />
                  </div>
                  <div>
                    <p class="sidebar-label mb-0.5">Extra right margin</p>
                    <Input
                      size="sm"
                      type="number"
                      min="-80"
                      max="240"
                      step="1"
                      value={plotEdit.extraRightMargin ?? '0'}
                      className="w-full"
                      placeholder="0"
                      oninput={(e) =>
                        setPlotField({
                          extraRightMargin: /** @type {HTMLInputElement} */ (e.currentTarget).value
                        })
                      }
                    />
                  </div>
                  <div>
                    <p class="sidebar-label mb-0.5">Extra top margin</p>
                    <Input
                      size="sm"
                      type="number"
                      min="-80"
                      max="240"
                      step="1"
                      value={plotEdit.extraTopMargin ?? '0'}
                      className="w-full"
                      placeholder="0"
                      oninput={(e) =>
                        setPlotField({
                          extraTopMargin: /** @type {HTMLInputElement} */ (e.currentTarget).value
                        })
                      }
                    />
                  </div>
                  <div>
                    <p class="sidebar-label mb-0.5">Extra bottom margin</p>
                    <Input
                      size="sm"
                      type="number"
                      min="-80"
                      max="240"
                      step="1"
                      value={plotEdit.extraBottomMargin}
                      className="w-full"
                      placeholder="0"
                      oninput={(e) =>
                        setPlotField({
                          extraBottomMargin: /** @type {HTMLInputElement} */ (e.currentTarget).value
                        })
                      }
                    />
                  </div>
                  <div>
                    <p class="sidebar-label mb-0.5">Tick number gap</p>
                    <Input
                      size="sm"
                      type="number"
                      min="0"
                      max="32"
                      step="1"
                      value={plotEdit.tickLabelGap ?? '8'}
                      className="w-full"
                      placeholder="8"
                      title="Space between tick marks and tick numbers"
                      oninput={(e) =>
                        setPlotField({
                          tickLabelGap: /** @type {HTMLInputElement} */ (e.currentTarget).value
                        })
                      }
                    />
                  </div>
                </div>
                <label
                  class="flex items-center gap-2 {optionsSearchHighlightId === 'tick-marks'
                    ? 'option-pulse-highlight rounded p-1'
                    : ''}"
                  data-option-id="tick-marks"
                >
                  <Checkbox
                    name="overlay-show-ticks"
                    checked={plotEdit.showTicks !== false}
                    onchange={(e) => setPlotField({ showTicks: e.currentTarget.checked })}
                  />
                  <span class="sidebar-label">Show tick marks</span>
                </label>
                <div class="grid grid-cols-2 gap-1">
                  <div>
                    <p class="sidebar-label mb-0.5">Tick length</p>
                    <Input
                      size="sm"
                      type="number"
                      min="0"
                      max="16"
                      step="1"
                      value={plotEdit.tickLength}
                      className="w-full"
                      oninput={(e) =>
                        setPlotField({
                          tickLength: /** @type {HTMLInputElement} */ (e.currentTarget).value
                        })
                      }
                    />
                  </div>
                  <div>
                    <p class="sidebar-label mb-0.5">Tick width</p>
                    <Input
                      size="sm"
                      type="number"
                      min="0.2"
                      max="8"
                      step="0.2"
                      value={plotEdit.tickWidth}
                      className="w-full"
                      oninput={(e) =>
                        setPlotField({
                          tickWidth: /** @type {HTMLInputElement} */ (e.currentTarget).value
                        })
                      }
                    />
                  </div>
                  <div>
                    <p class="sidebar-label mb-0.5">Axis line width</p>
                    <Input
                      size="sm"
                      type="number"
                      min="0.2"
                      max="8"
                      step="0.2"
                      value={plotEdit.spineWidth}
                      className="w-full"
                      oninput={(e) =>
                        setPlotField({
                          spineWidth: /** @type {HTMLInputElement} */ (e.currentTarget).value
                        })
                      }
                    />
                  </div>
                </div>
                <div
                  class={optionsSearchHighlightId === 'axis-box' ? 'option-pulse-highlight rounded p-1' : ''}
                  data-option-id="axis-box"
                >
                  <p class="sidebar-label mb-0.5">Axis box</p>
                  <div class="grid grid-cols-2 gap-x-2 gap-y-1">
                    <label class="flex items-center gap-2">
                      <Checkbox
                        name="overlay-spine-left"
                        checked={plotEdit.spineLeft !== false}
                        onchange={(e) => setPlotField({ spineLeft: e.currentTarget.checked })}
                      />
                      <span class="sidebar-label">Left</span>
                    </label>
                    <label class="flex items-center gap-2">
                      <Checkbox
                        name="overlay-spine-bottom"
                        checked={plotEdit.spineBottom !== false}
                        onchange={(e) => setPlotField({ spineBottom: e.currentTarget.checked })}
                      />
                      <span class="sidebar-label">Bottom</span>
                    </label>
                    <label class="flex items-center gap-2">
                      <Checkbox
                        name="overlay-spine-top"
                        checked={plotEdit.spineTop === true}
                        onchange={(e) => setPlotField({ spineTop: e.currentTarget.checked })}
                      />
                      <span class="sidebar-label">Top</span>
                    </label>
                    <label class="flex items-center gap-2">
                      <Checkbox
                        name="overlay-spine-right"
                        checked={plotEdit.spineRight === true}
                        onchange={(e) => setPlotField({ spineRight: e.currentTarget.checked })}
                      />
                      <span class="sidebar-label">Right</span>
                    </label>
                  </div>
                </div>
              </div>
            {/if}
          </div>

          <!-- 8. Advanced -->
          <div class="plot-settings-section" class:is-open={plotSectionOpen.advanced}>
            <button
              type="button"
              class="plot-settings-section-header"
              aria-expanded={plotSectionOpen.advanced}
              onclick={() => togglePlotSection('advanced')}
            >
              <Gear className="size-3.5 shrink-0 text-neutral-500" />
              <span class="plot-settings-section-title">Advanced</span>
              <ChevronDown
                className="plot-settings-section-chevron {plotSectionOpen.advanced ? '' : 'is-collapsed'}"
              />
            </button>
            {#if plotSectionOpen.advanced}
              <div class="plot-settings-section-body">
                {#if mode === 'structural'}
                  <label
                    class="flex items-center gap-2 {optionsSearchHighlightId === 'show-selection-subtitle'
                      ? 'option-pulse-highlight rounded p-1'
                      : ''}"
                    data-option-id="show-selection-subtitle"
                  >
                    <Checkbox name="show-selection-subtitle" bind:checked={ps.showSelectionSubtitle} />
                    <span class="sidebar-label">Show selection on plot</span>
                  </label>
                {/if}
                <div class="grid grid-cols-2 gap-1">
                  <div
                    class={optionsSearchHighlightId === 'aspect-ratio'
                      ? 'option-pulse-highlight rounded p-0.5'
                      : ''}
                    data-option-id="aspect-ratio"
                  >
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
                  <div
                    class={optionsSearchHighlightId === 'export-dpi'
                      ? 'option-pulse-highlight rounded p-0.5'
                      : ''}
                    data-option-id="export-dpi"
                  >
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
                  <div
                    class={optionsSearchHighlightId === 'font-family'
                      ? 'option-pulse-highlight rounded p-0.5'
                      : ''}
                    data-option-id="font-family"
                  >
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
                <div
                  class={optionsSearchHighlightId === 'reset-plot' ? 'option-pulse-highlight rounded p-1' : ''}
                  data-option-id="reset-plot"
                >
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full"
                    onclick={() => {
                      if (mode === 'structural') {
                        sPlots = {
                          ...sPlots,
                          [structuralType]: {
                            ...structDefaults,
                            ...(structuralType === 'area_per_lipid' ? { yUnit: 'Å²' } : {})
                          }
                        }
                        if (compareLayout === 'grid') {
                          gridLayout = clearCellPlotKeysFromOverrides(gridLayout, CELL_PLOT_KEYS)
                        }
                        bumpPlotData()
                      } else {
                        ePlotGlobal = { ...energGlobalDefaults, ...energPanelShell }
                        ePlotPanels = {}
                        if (energeticCompareLayout === 'grid') {
                          energeticGridLayout = clearCellPlotKeysFromOverrides(
                            energeticGridLayout,
                            ENERGETIC_CELL_PLOT_KEYS
                          )
                        }
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
            disabled={running || !canRunAnalysis || (runAnalysisScope === 'selected' && runAnalysisSelectedCount() === 0)}
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
            <button
              type="button"
              role="menuitem"
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
              onclick={() => chooseRunAnalysisSelectedScope()}
            >
              <span class="w-4 shrink-0 text-center text-xs">{runAnalysisScope === 'selected' ? '✓' : ''}</span>
              <span>Selected sets</span>
            </button>
            <div class="mx-2 my-1 border-t border-neutral-200 dark:border-neutral-700"></div>
            <p class="px-3 pb-1 text-[10px] text-neutral-500 dark:text-neutral-400">Choose sets to run</p>
            <div class="max-h-40 overflow-y-auto">
              {#each analysisSets as set (set.id)}
                <label
                  class="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
                >
                  <Checkbox
                    size="sm"
                    checked={runAnalysisSelectedIds.includes(set.id)}
                    onchange={(e) =>
                      toggleRunAnalysisSelectedSet(
                        set.id,
                        /** @type {HTMLInputElement} */ (e.currentTarget).checked
                      )}
                  />
                  <span class="min-w-0 truncate" title={set.label}>{set.label}</span>
                </label>
              {/each}
            </div>
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
  </ResizableSidePanel>

  <!-- ===== CHART AREA ===== -->
  <div
    class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    style={paneBackgroundStyle}
  >
    <h1 class="m-3 mb-1.5 text-lg font-semibold">{displayTitle || 'Analysis'}</h1>

    {#if lastError}
      <div
        class="gw-notice gw-notice-error mx-4 mb-3 flex max-h-36 shrink-0 flex-col overflow-hidden select-text"
        role="alert"
      >
        <div
          class="flex shrink-0 items-center justify-between gap-2 border-b border-red-900/30 pb-1.5 dark:border-red-400/20"
        >
          <p class="text-[11px] font-medium text-red-800 dark:text-red-200">
            Analysis error — scroll for details
          </p>
          <div class="flex shrink-0 items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              onclick={() => copyAnalysisError(lastError)}
              title="Copy error to clipboard"
            >
              Copy
            </Button>
            <button
              type="button"
              class="rounded px-1.5 py-0.5 text-sm text-red-700 hover:bg-red-950/20 dark:text-red-300"
              onclick={() => {
                lastError = ''
              }}
              title="Dismiss error"
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        </div>
        <pre
          class="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-snug pr-1"
          >{lastError}</pre
        >
      </div>
    {/if}

    {#if mode === 'structural' || mode === 'energetic'}
      <div class="mx-3 mb-1.5 space-y-1.5">
        <div class="relative z-10 flex flex-wrap items-center gap-1">
          <Button
            size="sm"
            variant={!toolbarIsGrid ? 'default' : 'outline'}
            className="gap-1 px-2"
            onclick={() => setActiveCompareLayout('overlay')}
            title="Overlay all sets on one plot"
          >
            <Layers className="size-3.5" />
            Overlay
          </Button>
          <Button
            size="sm"
            variant={toolbarIsGrid ? 'default' : 'outline'}
            className="gap-1 px-2"
            onclick={() => setActiveCompareLayout('grid')}
            title="Custom grid of plots"
          >
            <Grid2x2Plus className="size-3.5" />
            Grid
          </Button>
          {#if toolbarIsGrid}
            <span class="mx-1 h-4 w-px bg-neutral-700" aria-hidden="true"></span>
            <Button
              size="sm"
              variant="outline"
              className="px-2"
              disabled={(Number(activeMosaicLayout.cols) || 1) <= 1}
              onclick={removeGridColumn}
              title="Remove column"
            >− Col</Button>
            <Button
              size="sm"
              variant="outline"
              className="px-2"
              disabled={(Number(activeMosaicLayout.cols) || 1) >= 8}
              onclick={addGridColumn}
              title="Add column"
            >+ Col</Button>
            <Button
              size="sm"
              variant="outline"
              className="px-2"
              disabled={(Number(activeMosaicLayout.rows) || 1) <= 1}
              onclick={removeGridRow}
              title="Remove row"
            >− Row</Button>
            <Button
              size="sm"
              variant="outline"
              className="px-2"
              disabled={(Number(activeMosaicLayout.rows) || 1) >= 16}
              onclick={addGridRow}
              title="Add row"
            >+ Row</Button>
            <span class="px-1 text-[11px] text-neutral-500"
              >{activeMosaicLayout.cols}×{activeMosaicLayout.rows}{#if clampCellCount(activeMosaicLayout.cellCount, activeMosaicLayout.cols, activeMosaicLayout.rows) < gridCapacity(activeMosaicLayout.cols, activeMosaicLayout.rows)}
                · {clampCellCount(activeMosaicLayout.cellCount, activeMosaicLayout.cols, activeMosaicLayout.rows)}
              {/if}</span
            >
          {/if}
          <Button
            size="sm"
            variant={plotLayoutOptionsOpen ? 'default' : 'outline'}
            onclick={toggleLayoutOptionsPanel}
            title={toolbarIsGrid
              ? 'Show or hide the Grid options panel on the right'
              : 'Show or hide the Overlay options panel on the right'}
            >{toolbarIsGrid ? 'Grid options' : 'Overlay options'}</Button
          >
        </div>
      </div>
    {/if}

    {#if (mode === 'structural' ? chartView.mode === 'empty' : energeticChartIsEmpty)}
      <p
        class="mx-3 mb-3 flex flex-1 items-center justify-center rounded-lg border border-dashed border-neutral-300 text-neutral-500 dark:border-neutral-800 dark:text-neutral-700"
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
        class="relative mx-3 mb-3 flex min-h-0 flex-1 flex-col gap-2 overflow-x-auto overflow-y-auto"
        style="scrollbar-gutter: stable;"
        bind:this={plotExportRoot}
      >
        {#if plotViewBusy || structuralTypeChanging}
          <div
            class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-neutral-950/25"
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
        {#if (mode === 'structural' ? chartView.series.length > 0 : energeticPanels.length > 0 || displaySeries.length > 0)}
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-xs text-neutral-400">Tools:</span>
            <Button
              size="sm"
              variant={chartInteractionMode === 'pan' ? 'default' : 'outline'}
              title={chartInteractionMode === 'pan' ? 'Pan is on — click again to turn off' : 'Enable pan on plots'}
              onclick={() =>
                (chartInteractionMode = chartInteractionMode === 'pan' ? 'none' : 'pan')}>Pan</Button
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
            <div class="relative flex" bind:this={resetMenuWrapEl}>
              <Button
                size="sm"
                variant="outline"
                className="rounded-r-none"
                onclick={resetChartView}
                title="Undo zoom and pan. Plot Settings min/max stay."
              >Reset view</Button>
              <Button
                size="sm"
                variant="outline"
                className="rounded-l-none border-l-0 px-1.5"
                title="More reset options"
                aria-haspopup="menu"
                aria-expanded={resetMenuOpen}
                onclick={(e) => {
                  e.stopPropagation()
                  resetMenuOpen = !resetMenuOpen
                }}
              >
                <ChevronDown className="size-3.5" />
              </Button>
              {#if resetMenuOpen}
                <div
                  class="absolute top-full left-0 z-30 mt-1 min-w-[14rem] rounded-md border border-neutral-200 bg-white py-1 text-xs shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
                  role="menu"
                >
                  <button
                    type="button"
                    class="block w-full px-3 py-1.5 text-left text-neutral-800 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
                    role="menuitem"
                    onclick={resetChartView}
                  >
                    Reset view
                    <span class="mt-0.5 block text-[10px] font-normal text-neutral-500"
                      >Zoom and pan only</span
                    >
                  </button>
                  <button
                    type="button"
                    class="block w-full px-3 py-1.5 text-left text-neutral-800 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
                    role="menuitem"
                    onclick={resetChartViewAndLimits}
                  >
                    Reset view and axis limits
                    <span class="mt-0.5 block text-[10px] font-normal text-neutral-500"
                      >Also clear Plot Settings min/max</span
                    >
                  </button>
                </div>
              {/if}
            </div>
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

        {#if pageActive}
        {#if mode === 'structural' && chartView.mode === 'grid'}
          {@const outside = gridLayout.legendMode === 'outside'}
          {@const loc = gridLayout.legendOutside}
          {@const mosaicGap = `${Number(gridLayout.gapPx) || 0}px`}
          {@const stripAlign = outsideLegendAlignClasses(gridLayout)}
          {@const stripFlex = outside && (loc === 'left' || loc === 'right') ? stripAlign.wrapper : 'flex-col'}
          <div
            class={`flex min-w-0 ${stripFlex}`}
            data-chart-mosaic="1"
            style={`gap: ${mosaicGap}; ${gridLayout.figureBg ? `background: ${gridLayout.figureBg};` : ''} padding: 0.25rem; overflow-anchor: none; ${mosaicPanelLetterPadStyle(gridLayout)}`}
          >
            {#if outside && loc === 'top'}
              <ChartLegend
                className={stripAlign.self}
                series={outsideLegendSeries}
                columns={gridLayout.legendColumns}
                title={gridLayout.legendTitle}
                fontFamily={ps.fontFamily || 'Roboto, sans-serif'}
                {...outsideLegendChrome(gridLayout)}
                textColor={resolvedStructColors.textColor}
              />
            {/if}
            {#if outside && loc === 'left'}
              <ChartLegend
                series={outsideLegendSeries}
                columns={1}
                title={gridLayout.legendTitle}
                fontFamily={ps.fontFamily || 'Roboto, sans-serif'}
                {...outsideLegendChrome(gridLayout)}
                textColor={resolvedStructColors.textColor}
                boxed
              />
            {/if}
            <div class="flex min-w-0 w-full flex-col" style={`gap: ${mosaicGap}`}>
              {#each structuralMosaic.fullRows as row, ri (ri)}
                <div
                  class="grid min-w-0"
                  style={`grid-template-columns: repeat(${gridLayout.cols}, minmax(0, 1fr)); gap: ${mosaicGap}; align-content: start;`}
                >
                  {#each row as panel (panel.key)}
                    {@render structuralGridCell(panel)}
                  {/each}
                </div>
              {/each}
              {#if structuralMosaic.lastAlign}
                <div
                  class="flex {structuralMosaic.lastAlign === 'end'
                    ? 'justify-end'
                    : 'justify-center'}"
                  style={`gap: ${mosaicGap}`}
                >
                  {#each structuralMosaic.lastRow as panel (panel.key)}
                    <div
                      class="min-w-0"
                      style={`width: calc((100% - ${(gridLayout.cols - 1) * (Number(gridLayout.gapPx) || 0)}px) / ${gridLayout.cols})`}
                    >
                      {@render structuralGridCell(panel)}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
            {#if outside && loc === 'right'}
              <ChartLegend
                series={outsideLegendSeries}
                columns={1}
                title={gridLayout.legendTitle}
                fontFamily={ps.fontFamily || 'Roboto, sans-serif'}
                {...outsideLegendChrome(gridLayout)}
                textColor={resolvedStructColors.textColor}
                boxed
              />
            {/if}
            {#if outside && loc === 'bottom'}
              <ChartLegend
                className={stripAlign.self}
                series={outsideLegendSeries}
                columns={gridLayout.legendColumns}
                title={gridLayout.legendTitle}
                fontFamily={ps.fontFamily || 'Roboto, sans-serif'}
                {...outsideLegendChrome(gridLayout)}
                textColor={resolvedStructColors.textColor}
              />
            {/if}
          </div>
        {:else if mode === 'structural'}
          {@const outside = gridLayout.legendMode === 'outside'}
          {@const loc = gridLayout.legendOutside}
          {@const mosaicGap = `${Number(gridLayout.gapPx) || 0}px`}
          {@const stripAlign = outsideLegendAlignClasses(gridLayout)}
          {@const stripFlex = outside && (loc === 'left' || loc === 'right') ? stripAlign.wrapper : 'flex-col'}
          {@const overlayLetter = outsidePanelLetterBadge(
            gridLayout,
            0,
            Number(ps.titleFontSize) || 13,
            resolvedStructColors.textColor,
            ps.fontFamily || 'Roboto, sans-serif'
          )}
          <div
            class={`flex min-w-0 ${stripFlex}`}
            data-chart-export=""
            style={`gap: ${mosaicGap}; ${gridLayout.figureBg ? `background: ${gridLayout.figureBg};` : ''} overflow-anchor: none; ${mosaicPanelLetterPadStyle(gridLayout)}`}
          >
            {#if outside && loc === 'top'}
              <ChartLegend
                className={stripAlign.self}
                series={outsideLegendSeries}
                columns={gridLayout.legendColumns}
                title={gridLayout.legendTitle}
                fontFamily={ps.fontFamily || 'Roboto, sans-serif'}
                {...outsideLegendChrome(gridLayout)}
                textColor={resolvedStructColors.textColor}
              />
            {/if}
            {#if outside && loc === 'left'}
              <ChartLegend
                series={outsideLegendSeries}
                columns={1}
                title={gridLayout.legendTitle}
                fontFamily={ps.fontFamily || 'Roboto, sans-serif'}
                {...outsideLegendChrome(gridLayout)}
                textColor={resolvedStructColors.textColor}
                boxed
              />
            {/if}
            <div class="relative min-w-0 flex-1">
              {#if overlayLetter}
                <span
                  class="pointer-events-none absolute z-[15] select-none"
                  data-chart-export="panel-letter"
                  style={overlayLetter.style}
                  aria-hidden="true">{overlayLetter.letter}</span
                >
              {/if}
              <LineChart
                series={displaySeries}
                xLabel={displayXLabel}
                yLabel={displayYLabel}
                plotBg={resolvedStructColors.plotBg}
                tickColor={resolvedStructColors.textColor}
                labelColor={resolvedStructColors.textColor}
                axisColor={resolvedStructColors.textColor}
                gridColor={plotGridColor(ps, resolvedStructColors.textColor)}
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
                {...lineChartExtraMarginProps(ps)}
                tickLabelGap={Number(ps.tickLabelGap) || 8}
                legendPosition={overlayChartLegendPosition}
                legendSwatchSize={Number(ps.legendSwatchSize) || 12}
                legendFontSize={Number(ps.legendFontSize) || 10}
                axisFontSize={Number(ps.axisFontSize) || 12}
                axisFontBold={ps.axisFontBold === true}
                titleFontSize={Number(ps.titleFontSize) || 13}
                {...lineChartAxisProps(ps)}
                {...lineChartPanelLetterProps(gridLayout, 0, Number(ps.titleFontSize) || 13)}
                xTickStep={plotTickStep('x')}
                yTickStep={plotTickStep('y')}
                referenceLines={structReferenceLines}
                referenceBands={structReferenceBandsDraw}
                xMinOverride={xMinO}
                xMaxOverride={xMaxO}
                yMinOverride={yMinO}
                yMaxOverride={yMaxO}
                interactionMode={chartInteractionMode}
                statsRange={hasChartTimeAxis ? statsRange : null}
                onAxisRange={applyStructAxisRange}
                onStatsRange={handleStatsRange}
              />
            </div>
            {#if outside && loc === 'right'}
              <ChartLegend
                series={outsideLegendSeries}
                columns={1}
                title={gridLayout.legendTitle}
                fontFamily={ps.fontFamily || 'Roboto, sans-serif'}
                {...outsideLegendChrome(gridLayout)}
                textColor={resolvedStructColors.textColor}
                boxed
              />
            {/if}
            {#if outside && loc === 'bottom'}
              <ChartLegend
                className={stripAlign.self}
                series={outsideLegendSeries}
                columns={gridLayout.legendColumns}
                title={gridLayout.legendTitle}
                fontFamily={ps.fontFamily || 'Roboto, sans-serif'}
                {...outsideLegendChrome(gridLayout)}
                textColor={resolvedStructColors.textColor}
              />
            {/if}
          </div>
        {:else if mode === 'energetic' && energeticCompareLayout === 'grid'}
          {@const outside = energeticGridLayout.legendMode === 'outside'}
          {@const loc = energeticGridLayout.legendOutside}
          {@const mosaicGap = `${Number(energeticGridLayout.gapPx) || 0}px`}
          {@const stripAlign = outsideLegendAlignClasses(energeticGridLayout)}
          {@const stripFlex = outside && (loc === 'left' || loc === 'right') ? stripAlign.wrapper : 'flex-col'}
          <div
            class={`flex min-w-0 ${stripFlex}`}
            data-chart-mosaic="1"
            style={`gap: ${mosaicGap}; ${energeticGridLayout.figureBg ? `background: ${energeticGridLayout.figureBg};` : ''} padding: 0.25rem; overflow-anchor: none; ${mosaicPanelLetterPadStyle(energeticGridLayout)}`}
          >
            {#if outside && loc === 'top'}
              <ChartLegend
                className={stripAlign.self}
                series={outsideLegendSeries}
                columns={energeticGridLayout.legendColumns}
                title={energeticGridLayout.legendTitle}
                fontFamily={ePlotGlobal.fontFamily || 'Roboto, sans-serif'}
                {...outsideLegendChrome(energeticGridLayout)}
                textColor={resolvedEnergColors.textColor}
              />
            {/if}
            {#if outside && loc === 'left'}
              <ChartLegend
                series={outsideLegendSeries}
                columns={1}
                title={energeticGridLayout.legendTitle}
                fontFamily={ePlotGlobal.fontFamily || 'Roboto, sans-serif'}
                {...outsideLegendChrome(energeticGridLayout)}
                textColor={resolvedEnergColors.textColor}
                boxed
              />
            {/if}
            <div class="flex min-w-0 w-full flex-col" style={`gap: ${mosaicGap}`}>
              {#each energeticMosaic.fullRows as row, ri (ri)}
                <div
                  class="grid min-w-0"
                  style={`grid-template-columns: repeat(${energeticGridLayout.cols}, minmax(0, 1fr)); gap: ${mosaicGap}; align-content: start;`}
                >
                  {#each row as panel (panel.key)}
                    {@render energeticGridCell(panel)}
                  {/each}
                </div>
              {/each}
              {#if energeticMosaic.lastAlign}
                <div
                  class="flex {energeticMosaic.lastAlign === 'end'
                    ? 'justify-end'
                    : 'justify-center'}"
                  style={`gap: ${mosaicGap}`}
                >
                  {#each energeticMosaic.lastRow as panel (panel.key)}
                    <div
                      class="min-w-0"
                      style={`width: calc((100% - ${(energeticGridLayout.cols - 1) * (Number(energeticGridLayout.gapPx) || 0)}px) / ${energeticGridLayout.cols})`}
                    >
                      {@render energeticGridCell(panel)}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
            {#if outside && loc === 'right'}
              <ChartLegend
                series={outsideLegendSeries}
                columns={1}
                title={energeticGridLayout.legendTitle}
                fontFamily={ePlotGlobal.fontFamily || 'Roboto, sans-serif'}
                {...outsideLegendChrome(energeticGridLayout)}
                textColor={resolvedEnergColors.textColor}
                boxed
              />
            {/if}
            {#if outside && loc === 'bottom'}
              <ChartLegend
                className={stripAlign.self}
                series={outsideLegendSeries}
                columns={energeticGridLayout.legendColumns}
                title={energeticGridLayout.legendTitle}
                fontFamily={ePlotGlobal.fontFamily || 'Roboto, sans-serif'}
                {...outsideLegendChrome(energeticGridLayout)}
                textColor={resolvedEnergColors.textColor}
              />
            {/if}
          </div>
        {:else if mode === 'energetic'}
          {@const overlayView = energViewRangeByKey.__overlay__}
          {@const xMinP =
            overlayView?.xMin ??
            (ePlotGlobal.xMin !== '' && Number.isFinite(Number(ePlotGlobal.xMin))
              ? Number(ePlotGlobal.xMin)
              : null)}
          {@const xMaxP =
            overlayView?.xMax ??
            (ePlotGlobal.xMax !== '' && Number.isFinite(Number(ePlotGlobal.xMax))
              ? Number(ePlotGlobal.xMax)
              : null)}
          {@const yMinP =
            overlayView?.yMin ??
            (ePlotGlobal.yMin !== '' && Number.isFinite(Number(ePlotGlobal.yMin))
              ? Number(ePlotGlobal.yMin)
              : null)}
          {@const yMaxP =
            overlayView?.yMax ??
            (ePlotGlobal.yMax !== '' && Number.isFinite(Number(ePlotGlobal.yMax))
              ? Number(ePlotGlobal.yMax)
              : null)}
          {@const outside = energeticGridLayout.legendMode === 'outside'}
          {@const loc = energeticGridLayout.legendOutside}
          {@const mosaicGap = `${Number(energeticGridLayout.gapPx) || 0}px`}
          {@const stripAlign = outsideLegendAlignClasses(energeticGridLayout)}
          {@const stripFlex = outside && (loc === 'left' || loc === 'right') ? stripAlign.wrapper : 'flex-col'}
          {@const energOverlayLetter = outsidePanelLetterBadge(
            energeticGridLayout,
            0,
            Number(ePlotGlobal.titleFontSize) || 13,
            resolvedEnergColors.textColor,
            ePlotGlobal.fontFamily || 'Roboto, sans-serif'
          )}
          <div
            class={`flex min-w-0 ${stripFlex}`}
            data-chart-export=""
            style={`gap: ${mosaicGap}; ${energeticGridLayout.figureBg ? `background: ${energeticGridLayout.figureBg};` : ''} overflow-anchor: none; ${mosaicPanelLetterPadStyle(energeticGridLayout)}`}
          >
            {#if outside && loc === 'top'}
              <ChartLegend
                className={stripAlign.self}
                series={outsideLegendSeries}
                columns={energeticGridLayout.legendColumns}
                title={energeticGridLayout.legendTitle}
                fontFamily={ePlotGlobal.fontFamily || 'Roboto, sans-serif'}
                {...outsideLegendChrome(energeticGridLayout)}
                textColor={resolvedEnergColors.textColor}
              />
            {/if}
            {#if outside && loc === 'left'}
              <ChartLegend
                series={outsideLegendSeries}
                columns={1}
                title={energeticGridLayout.legendTitle}
                fontFamily={ePlotGlobal.fontFamily || 'Roboto, sans-serif'}
                {...outsideLegendChrome(energeticGridLayout)}
                textColor={resolvedEnergColors.textColor}
                boxed
              />
            {/if}
            <div class="relative min-w-0 flex-1">
              {#if energOverlayLetter}
                <span
                  class="pointer-events-none absolute z-[15] select-none"
                  data-chart-export="panel-letter"
                  style={energOverlayLetter.style}
                  aria-hidden="true">{energOverlayLetter.letter}</span
                >
              {/if}
              <LineChart
                series={displaySeries}
                xLabel={displayXLabel}
                yLabel={displayYLabel}
                plotBg={resolvedEnergColors.plotBg}
                tickColor={resolvedEnergColors.textColor}
                labelColor={resolvedEnergColors.textColor}
                axisColor={resolvedEnergColors.textColor}
                gridColor={plotGridColor(ePlotGlobal, resolvedEnergColors.textColor)}
                showGrid={ePlotGlobal.showGrid !== false}
                aspectRatio={Number(ePlotGlobal.aspectRatio) || Number(energPanelShell.aspectRatio) || 2.5}
                transparentBg={ePlotGlobal.transparentBg}
                fontFamily={ePlotGlobal.fontFamily || 'Roboto, sans-serif'}
                chartTitle={displayTitle}
                xTicks={Number(ePlotGlobal.xTickCount) || 5}
                yTicks={Number(ePlotGlobal.yTickCount) || 5}
                xTickDecimals={ePlotGlobal.xTickDecimals}
                yTickDecimals={ePlotGlobal.yTickDecimals}
                {...lineChartExtraMarginProps(ePlotGlobal)}
                tickLabelGap={Number(ePlotGlobal.tickLabelGap) || 8}
                legendPosition={overlayChartLegendPosition}
                legendSwatchSize={Number(ePlotGlobal.legendSwatchSize) || 12}
                legendFontSize={Number(ePlotGlobal.legendFontSize) || 10}
                axisFontSize={Number(ePlotGlobal.axisFontSize) || 12}
                axisFontBold={ePlotGlobal.axisFontBold === true}
                titleFontSize={Number(ePlotGlobal.titleFontSize) || 13}
                {...lineChartAxisProps(ePlotGlobal)}
                {...lineChartPanelLetterProps(
                  energeticGridLayout,
                  0,
                  Number(ePlotGlobal.titleFontSize) || 13
                )}
                xTickStep={ePlotGlobal.xTickStep || ''}
                yTickStep={ePlotGlobal.yTickStep || ''}
                referenceLines={structReferenceLines}
                referenceBands={structReferenceBandsDraw}
                xMinOverride={xMinP}
                xMaxOverride={xMaxP}
                yMinOverride={yMinP}
                yMaxOverride={yMaxP}
                interactionMode={chartInteractionMode}
                statsRange={statsRange}
                onAxisRange={(r) => applyPanelAxisRange('__overlay__', r)}
                onStatsRange={handleStatsRange}
              />
            </div>
            {#if outside && loc === 'right'}
              <ChartLegend
                series={outsideLegendSeries}
                columns={1}
                title={energeticGridLayout.legendTitle}
                fontFamily={ePlotGlobal.fontFamily || 'Roboto, sans-serif'}
                {...outsideLegendChrome(energeticGridLayout)}
                textColor={resolvedEnergColors.textColor}
                boxed
              />
            {/if}
            {#if outside && loc === 'bottom'}
              <ChartLegend
                className={stripAlign.self}
                series={outsideLegendSeries}
                columns={energeticGridLayout.legendColumns}
                title={energeticGridLayout.legendTitle}
                fontFamily={ePlotGlobal.fontFamily || 'Roboto, sans-serif'}
                {...outsideLegendChrome(energeticGridLayout)}
                textColor={resolvedEnergColors.textColor}
              />
            {/if}
          </div>
        {/if}
        {/if}

        {#if chartStatsRows.some((row) => row.stats && row.stats.count > 0)}
          <div class="rounded-md border border-neutral-200 dark:border-neutral-800">
            {#if statsRange && hasChartTimeAxis}
              <p class="border-b border-neutral-200 px-2 py-1 text-[10px] text-neutral-500 dark:border-neutral-800">
                Range [{Math.min(statsRange.t0, statsRange.t1).toFixed(3)} –
                {Math.max(statsRange.t0, statsRange.t1).toFixed(3)} {chartTimeUnitLabel}]
              </p>
            {/if}
            <div class="overflow-x-auto">
              <table class="w-full min-w-[28rem] border-collapse text-[11px] tabular-nums text-neutral-800 dark:text-neutral-200">
                <thead>
                  <tr class="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
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
                            <span class="truncate text-neutral-700 dark:text-neutral-300" title={row.name}>{row.name}</span>
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

  {#if plotLayoutOptionsOpen && (mode === 'structural' || mode === 'energetic')}
    <ResizableSidePanel
      side="right"
      storageKey="analysis-grid"
      defaultWidth={260}
      minWidth={200}
      bind:collapsed={plotLayoutOptionsCollapsed}
      className="flex min-h-0 min-w-0 flex-col overflow-x-clip overflow-y-auto border-l border-neutral-200 bg-white p-2.5 text-xs select-none dark:border-neutral-800 dark:bg-neutral-950"
    >
      <div class="mb-2 flex items-center justify-between gap-1">
        <h2 class="sidebar-heading mb-0">{toolbarIsGrid ? 'Grid options' : 'Overlay options'}</h2>
        <Button
          size="sm"
          variant="ghost"
          className="px-1.5"
          title="Hide panel"
          onclick={() => (plotLayoutOptionsOpen = false)}
          >✕</Button
        >
      </div>

      <div class="space-y-2.5">
        {#if !toolbarIsGrid && analysisSets.length > 1}
          <div class="space-y-1">
            <p class="sidebar-subheading">Draw order</p>
            <p class="sidebar-hint">Top of the list draws on top.</p>
            <div class="max-h-48 overflow-y-auto pr-0.5">
              <OrderedSetChips
                setIds={syncOrderedIds(
                  activeMosaicLayout.overlaySetIds,
                  analysisSets.map((s) => s.id)
                )}
                sets={gridChipSets}
                onchange={setOverlaySetIds}
              />
            </div>
          </div>
          <Divider />
        {/if}

        {#if !toolbarIsGrid}
          <div
            class="space-y-1 {optionsSearchHighlightId === 'grid-legend-mode'
              ? 'option-pulse-highlight rounded p-1'
              : ''}"
            data-option-id="grid-legend-mode"
          >
            <p class="sidebar-subheading">Legend</p>
            <p class="sidebar-hint">Outside uses the same strip options as Grid.</p>
            <label>
              <span class="sidebar-label mb-0 block">Placement</span>
              <Select
                size="sm"
                className="w-full"
                value={
                  activeMosaicLayout.legendMode === 'outside' ||
                  activeMosaicLayout.legendMode === 'none'
                    ? activeMosaicLayout.legendMode
                    : 'each'
                }
                onchange={(e) =>
                  patchGridChrome({
                    legendMode: /** @type {HTMLSelectElement} */ (e.currentTarget).value
                  })
                }
              >
                <option value="each">Inside plot</option>
                <option value="outside">Outside</option>
                <option value="none">None</option>
              </Select>
            </label>
          </div>
          <Divider />
        {/if}

        {#if toolbarIsGrid}
        <div class="space-y-1">
          <p class="sidebar-subheading">Layout</p>
          <div class="grid grid-cols-2 gap-1.5">
            <label title="Gap between cells (px)">
              <span class="sidebar-label mb-0 block">Gap</span>
              <Input
                size="sm"
                type="number"
                min="0"
                max="80"
                step="1"
                value={activeMosaicLayout.gapPx}
                className="w-full"
                oninput={(e) =>
                  patchGridChrome({
                    gapPx: /** @type {HTMLInputElement} */ (e.currentTarget).value
                  })
                }
              />
            </label>
            <label title="Cell aspect ratio (width/height)">
              <span class="sidebar-label mb-0 block">Aspect</span>
              <Input
                size="sm"
                type="number"
                min="0.4"
                max="5"
                step="0.1"
                value={activeMosaicLayout.aspectRatio}
                placeholder={String(ps.aspectRatio || '2.5')}
                className="w-full"
                oninput={(e) =>
                  patchGridChrome({
                    aspectRatio: /** @type {HTMLInputElement} */ (e.currentTarget).value
                  })
                }
              />
            </label>
            <label
              title={`Active cells in ${activeMosaicLayout.cols}×${activeMosaicLayout.rows} (max ${gridCapacity(activeMosaicLayout.cols, activeMosaicLayout.rows)})`}
            >
              <span class="sidebar-label mb-0 block">Cells</span>
              <Input
                size="sm"
                type="number"
                min="1"
                max={gridCapacity(activeMosaicLayout.cols, activeMosaicLayout.rows)}
                step="1"
                value={clampCellCount(
                  activeMosaicLayout.cellCount,
                  activeMosaicLayout.cols,
                  activeMosaicLayout.rows
                )}
                className="w-full"
                oninput={(e) =>
                  setActiveGridCellCount(/** @type {HTMLInputElement} */ (e.currentTarget).value)
                }
              />
            </label>
            <label title="Align last incomplete row">
              <span class="sidebar-label mb-0 block">Last row</span>
              <Select
                size="sm"
                className="w-full"
                value={activeMosaicLayout.lastRowAlign}
                onchange={(e) =>
                  patchGridChrome({
                    lastRowAlign: /** @type {HTMLSelectElement} */ (e.currentTarget).value
                  })
                }
              >
                <option value="start">Left</option>
                <option value="center">Center</option>
                <option value="end">Right</option>
              </Select>
            </label>
            <label
              class="col-span-2 {optionsSearchHighlightId === 'grid-legend-mode'
                ? 'option-pulse-highlight rounded p-0.5'
                : ''}"
              data-option-id="grid-legend-mode"
            >
              <span class="sidebar-label mb-0 block">Legend</span>
              <Select
                size="sm"
                className="w-full"
                value={activeMosaicLayout.legendMode}
                onchange={(e) =>
                  patchGridChrome({
                    legendMode: /** @type {HTMLSelectElement} */ (e.currentTarget).value
                  })
                }
              >
                <option value="each">Each cell</option>
                <option value="one">One cell</option>
                <option value="outside">Outside</option>
                <option value="none">None</option>
              </Select>
            </label>
          </div>
        </div>

        <Divider />

        <div class="space-y-1">
          <p class="sidebar-subheading">Axis labels</p>
          <div class="grid grid-cols-2 gap-1.5">
            <label>
              <span class="sidebar-label mb-0 block">X title</span>
              <Select
                size="sm"
                className="w-full"
                value={activeMosaicLayout.showXLabels}
                onchange={(e) =>
                  patchGridChrome({
                    showXLabels: /** @type {HTMLSelectElement} */ (e.currentTarget).value
                  })
                }
              >
                <option value="all">All</option>
                <option value="bottom">Bottom</option>
                <option value="none">None</option>
              </Select>
            </label>
            <label>
              <span class="sidebar-label mb-0 block">Y title</span>
              <Select
                size="sm"
                className="w-full"
                value={activeMosaicLayout.showYLabels}
                onchange={(e) =>
                  patchGridChrome({
                    showYLabels: /** @type {HTMLSelectElement} */ (e.currentTarget).value
                  })
                }
              >
                <option value="all">All</option>
                <option value="left">Left</option>
                <option value="none">None</option>
              </Select>
            </label>
            <label>
              <span class="sidebar-label mb-0 block">X ticks</span>
              <Select
                size="sm"
                className="w-full"
                value={activeMosaicLayout.showXTickLabels}
                onchange={(e) =>
                  patchGridChrome({
                    showXTickLabels: /** @type {HTMLSelectElement} */ (e.currentTarget).value
                  })
                }
              >
                <option value="all">All</option>
                <option value="bottom">Bottom</option>
                <option value="none">None</option>
              </Select>
            </label>
            <label>
              <span class="sidebar-label mb-0 block">Y ticks</span>
              <Select
                size="sm"
                className="w-full"
                value={activeMosaicLayout.showYTickLabels}
                onchange={(e) =>
                  patchGridChrome({
                    showYTickLabels: /** @type {HTMLSelectElement} */ (e.currentTarget).value
                  })
                }
              >
                <option value="all">All</option>
                <option value="left">Left</option>
                <option value="none">None</option>
              </Select>
            </label>
          </div>
        </div>
        {/if}

        {#if toolbarIsGrid && activeMosaicLayout.legendMode === 'one'}
          <Divider />
          <label class="block">
            <span class="sidebar-label mb-0 block">Legend cell</span>
            <Select
              size="sm"
              className="w-full"
              value={String(activeMosaicLayout.legendCell)}
              onchange={(e) =>
                patchGridChrome({
                  legendCell: Number(/** @type {HTMLSelectElement} */ (e.currentTarget).value)
                })
              }
            >
              {#each activeMosaicLayout.cells as cell, i (i)}
                <option value={String(i)}>Cell {i + 1}{cell.title ? ` · ${cell.title}` : ''}</option>
              {/each}
            </Select>
          </label>
        {/if}

        {#if activeMosaicLayout.legendMode === 'outside'}
          <Divider />
          <div
            class="space-y-2 {optionsSearchHighlightId === 'grid-outside-legend'
              ? 'option-pulse-highlight rounded p-1'
              : ''}"
            data-option-id="grid-outside-legend"
          >
            <p class="sidebar-subheading">Outside legend</p>

            <div class="space-y-1">
              <p class="sidebar-label mb-0">Placement</p>
              <div class="grid grid-cols-2 gap-1.5">
                <label>
                  <span class="sidebar-label mb-0 block">Side</span>
                  <Select
                    size="sm"
                    className="w-full"
                    value={activeMosaicLayout.legendOutside}
                    onchange={(e) =>
                      patchGridChrome({
                        legendOutside: /** @type {HTMLSelectElement} */ (e.currentTarget).value
                      })
                    }
                  >
                    <option value="bottom">Bottom</option>
                    <option value="top">Top</option>
                    <option value="right">Right</option>
                    <option value="left">Left</option>
                  </Select>
                </label>
                <label>
                  <span class="sidebar-label mb-0 block">Align</span>
                  <Select
                    size="sm"
                    className="w-full"
                    value={activeMosaicLayout.legendOutsideAlign || 'center'}
                    onchange={(e) =>
                      patchGridChrome({
                        legendOutsideAlign: /** @type {HTMLSelectElement} */ (e.currentTarget).value
                      })
                    }
                  >
                    <option value="start">Start</option>
                    <option value="center">Center</option>
                    <option value="end">End</option>
                  </Select>
                </label>
                <label>
                  <span class="sidebar-label mb-0 block">Entries</span>
                  <Select
                    size="sm"
                    className="w-full"
                    value={activeMosaicLayout.legendEntries}
                    onchange={(e) =>
                      setLegendEntriesMode(/** @type {HTMLSelectElement} */ (e.currentTarget).value)
                    }
                  >
                    <option value="sets">Sets</option>
                    <option value="roles">Roles</option>
                    <option value="both">Both</option>
                    <option value="manual">Manual</option>
                  </Select>
                </label>
                <label>
                  <span class="sidebar-label mb-0 block">Columns</span>
                  <Input
                    size="sm"
                    type="number"
                    min="1"
                    max="8"
                    step="1"
                    value={activeMosaicLayout.legendColumns}
                    className="w-full"
                    oninput={(e) =>
                      patchGridChrome({
                        legendColumns: /** @type {HTMLInputElement} */ (e.currentTarget).value
                      })
                    }
                  />
                </label>
                <label class="col-span-2">
                  <span class="sidebar-label mb-0 block">Title</span>
                  <Input
                    size="sm"
                    value={activeMosaicLayout.legendTitle}
                    className="w-full"
                    oninput={(e) =>
                      patchGridChrome({
                        legendTitle: /** @type {HTMLInputElement} */ (e.currentTarget).value
                      })
                    }
                  />
                </label>
                <label title="Legend label font size (px)">
                  <span class="sidebar-label mb-0 block">Font</span>
                  <Input
                    size="sm"
                    type="number"
                    min="1"
                    step="1"
                    value={activeMosaicLayout.legendFontSize ||
                      outsideLegendFontSize(activeMosaicLayout)}
                    className="w-full"
                    oninput={(e) =>
                      patchGridChrome({
                        legendFontSize: /** @type {HTMLInputElement} */ (e.currentTarget).value
                      })
                    }
                  />
                </label>
                <label title="Legend title font size (px); empty = same as label font">
                  <span class="sidebar-label mb-0 block">Title font</span>
                  <Input
                    size="sm"
                    type="number"
                    min="1"
                    step="1"
                    value={activeMosaicLayout.legendTitleFontSize ||
                      outsideLegendTitleFontSize(activeMosaicLayout)}
                    className="w-full"
                    oninput={(e) =>
                      patchGridChrome({
                        legendTitleFontSize: /** @type {HTMLInputElement} */ (e.currentTarget)
                          .value
                      })
                    }
                  />
                </label>
                <label
                  class="col-span-2"
                  title="Space between the title and the first legend labels (px)"
                >
                  <span class="sidebar-label mb-0 block">Title gap</span>
                  <Input
                    size="sm"
                    type="number"
                    min="0"
                    step="1"
                    value={activeMosaicLayout.legendTitleGap === '' ||
                    activeMosaicLayout.legendTitleGap == null
                      ? '8'
                      : activeMosaicLayout.legendTitleGap}
                    className="w-full"
                    oninput={(e) =>
                      patchGridChrome({
                        legendTitleGap: /** @type {HTMLInputElement} */ (e.currentTarget).value
                      })
                    }
                  />
                </label>
              </div>
            </div>

            <div class="space-y-1">
              <p class="sidebar-label mb-0">Color squares</p>
              <div class="grid grid-cols-2 gap-1.5">
                <label title="Square width (px)">
                  <span class="sidebar-label mb-0 block">Width</span>
                  <Input
                    size="sm"
                    type="number"
                    min="1"
                    step="1"
                    value={activeMosaicLayout.legendSwatchWidth ||
                      outsideLegendSwatchWidth(activeMosaicLayout)}
                    className="w-full"
                    oninput={(e) =>
                      patchGridChrome({
                        legendSwatchWidth: /** @type {HTMLInputElement} */ (e.currentTarget).value,
                        legendSwatchSize: /** @type {HTMLInputElement} */ (e.currentTarget).value
                      })
                    }
                  />
                </label>
                <label title="Square height (px)">
                  <span class="sidebar-label mb-0 block">Height</span>
                  <Input
                    size="sm"
                    type="number"
                    min="1"
                    step="1"
                    value={activeMosaicLayout.legendSwatchHeight ||
                      outsideLegendSwatchHeight(activeMosaicLayout)}
                    className="w-full"
                    oninput={(e) =>
                      patchGridChrome({
                        legendSwatchHeight: /** @type {HTMLInputElement} */ (e.currentTarget).value
                      })
                    }
                  />
                </label>
                <label class="col-span-2 flex items-center gap-1.5" title="Rounded color squares">
                  <Checkbox
                    size="sm"
                    name="legend-swatch-round"
                    checked={activeMosaicLayout.legendSwatchRound !== false}
                    onchange={(e) =>
                      patchGridChrome({
                        legendSwatchRound: /** @type {HTMLInputElement} */ (e.currentTarget).checked
                      })}
                  />
                  <span class="sidebar-label mb-0">Round squares</span>
                </label>
              </div>
            </div>

            <div class="space-y-1">
              <p class="sidebar-label mb-0">Legend frame</p>
              <div class="grid grid-cols-2 gap-1.5">
                <label title="Inner padding of the legend box (px)">
                  <span class="sidebar-label mb-0 block">Padding</span>
                  <Input
                    size="sm"
                    type="number"
                    min="0"
                    step="1"
                    value={activeMosaicLayout.legendBoxPadding || '8'}
                    className="w-full"
                    oninput={(e) =>
                      patchGridChrome({
                        legendBoxPadding: /** @type {HTMLInputElement} */ (e.currentTarget).value
                      })
                    }
                  />
                </label>
                <label
                  title="Outer legend box width (px). Empty = fit content; focusing an empty field seeds the current natural size."
                >
                  <span class="sidebar-label mb-0 block">Box width</span>
                  <Input
                    size="sm"
                    type="number"
                    min="1"
                    step="1"
                    value={activeMosaicLayout.legendBoxMinWidth || ''}
                    placeholder="auto"
                    className="w-full"
                    onfocus={(e) => {
                      if (!(activeMosaicLayout.legendBoxMinWidth || '').trim()) {
                        commitLegendBoxDim(
                          'legendBoxMinWidth',
                          /** @type {HTMLInputElement} */ (e.currentTarget).value || '1',
                          'focus'
                        )
                      }
                    }}
                    oninput={(e) =>
                      commitLegendBoxDim(
                        'legendBoxMinWidth',
                        /** @type {HTMLInputElement} */ (e.currentTarget).value,
                        'input'
                      )
                    }
                  />
                </label>
                <label
                  title="Outer legend box height (px). Empty = fit content; focusing an empty field seeds the current natural size."
                >
                  <span class="sidebar-label mb-0 block">Box height</span>
                  <Input
                    size="sm"
                    type="number"
                    min="1"
                    step="1"
                    value={activeMosaicLayout.legendBoxMinHeight || ''}
                    placeholder="auto"
                    className="w-full"
                    onfocus={(e) => {
                      if (!(activeMosaicLayout.legendBoxMinHeight || '').trim()) {
                        commitLegendBoxDim(
                          'legendBoxMinHeight',
                          /** @type {HTMLInputElement} */ (e.currentTarget).value || '1',
                          'focus'
                        )
                      }
                    }}
                    oninput={(e) =>
                      commitLegendBoxDim(
                        'legendBoxMinHeight',
                        /** @type {HTMLInputElement} */ (e.currentTarget).value,
                        'input'
                      )
                    }
                  />
                </label>
                <div class="col-span-2">
                  <span class="sidebar-label mb-0 block">Border color</span>
                  <div class="flex items-center gap-1">
                    <ColorInput
                      size="sm"
                      value={activeMosaicLayout.legendBoxBorderColor || '#a3a3a3'}
                      oninput={(e) =>
                        patchGridChrome({
                          legendBoxBorderColor: /** @type {HTMLInputElement} */ (e.currentTarget)
                            .value
                        })
                      }
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Use theme border color"
                      onclick={() => patchGridChrome({ legendBoxBorderColor: '' })}>Theme</Button
                    >
                  </div>
                </div>
                <label title="Border width (px); 0 = no border">
                  <span class="sidebar-label mb-0 block">Border width</span>
                  <Input
                    size="sm"
                    type="number"
                    min="0"
                    max="8"
                    step="1"
                    value={activeMosaicLayout.legendBoxBorderWidth ?? '1'}
                    className="w-full"
                    oninput={(e) =>
                      patchGridChrome({
                        legendBoxBorderWidth: /** @type {HTMLInputElement} */ (e.currentTarget)
                          .value
                      })
                    }
                  />
                </label>
                <label class="flex items-end gap-1.5 pb-1" title="Rounded legend box corners">
                  <Checkbox
                    size="sm"
                    name="legend-box-round"
                    checked={activeMosaicLayout.legendBoxRound !== false}
                    onchange={(e) =>
                      patchGridChrome({
                        legendBoxRound: /** @type {HTMLInputElement} */ (e.currentTarget).checked
                      })}
                  />
                  <span class="sidebar-label mb-0">Box round</span>
                </label>
              </div>
            </div>

            {#if activeMosaicLayout.legendEntries === 'manual'}
              <div
                class="space-y-1 rounded border border-neutral-200 bg-neutral-50/80 p-1.5 dark:border-neutral-700/80 dark:bg-neutral-950/40"
              >
                <div class="flex flex-wrap items-center justify-between gap-1">
                  <p class="sidebar-label mb-0">Manual entries</p>
                  <div class="flex flex-wrap gap-1">
                    <Button size="sm" variant="ghost" onclick={() => reseedManualLegendFromMosaic()}
                      >Seed</Button
                    >
                    <Button size="sm" variant="secondary" onclick={() => addManualLegendItem()}
                      >Add</Button
                    >
                  </div>
                </div>
                {#each normalizeManualLegendItems(activeMosaicLayout.legendManualItems) as item, i (item.id)}
                  <div
                    class="space-y-0.5 rounded border border-neutral-200 bg-white/80 p-1 dark:border-neutral-800 dark:bg-neutral-900/60"
                  >
                    <div class="flex items-center gap-1">
                      <ColorInput
                        size="sm"
                        value={item.color}
                        oninput={(e) =>
                          patchManualLegendItem(i, {
                            color: /** @type {HTMLInputElement} */ (e.currentTarget).value
                          })
                        }
                      />
                      <Input
                        size="sm"
                        value={item.label}
                        className="min-w-0 flex-1"
                        oninput={(e) =>
                          patchManualLegendItem(i, {
                            label: /** @type {HTMLInputElement} */ (e.currentTarget).value
                          })
                        }
                      />
                    </div>
                    <div class="flex flex-wrap items-center gap-0.5">
                      <Select
                        size="sm"
                        className="min-w-0 flex-1"
                        value={item.marker}
                        onchange={(e) =>
                          patchManualLegendItem(i, {
                            marker: /** @type {HTMLSelectElement} */ (e.currentTarget).value
                          })
                        }
                      >
                        {#each LEGEND_MARKERS as mk (mk)}
                          <option value={mk}>{mk}</option>
                        {/each}
                      </Select>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Move up"
                        disabled={i === 0}
                        onclick={() => moveManualLegendItem(i, -1)}>↑</Button
                      >
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Move down"
                        disabled={i >=
                          normalizeManualLegendItems(activeMosaicLayout.legendManualItems).length -
                            1}
                        onclick={() => moveManualLegendItem(i, 1)}>↓</Button
                      >
                      <Button
                        size="sm"
                        variant="ghost"
                        title={item.visible ? 'Hide' : 'Show'}
                        onclick={() => patchManualLegendItem(i, { visible: !item.visible })}
                        >{item.visible ? 'Hide' : 'Show'}</Button
                      >
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Remove"
                        onclick={() => removeManualLegendItem(i)}>✕</Button
                      >
                    </div>
                  </div>
                {:else}
                  <p class="sidebar-hint">No entries — Seed or Add.</p>
                {/each}
              </div>
            {/if}
          </div>
        {/if}

        {#if toolbarIsGrid || activeMosaicLayout.legendMode === 'outside'}
        <Divider />
        <div class="space-y-1">
          <p class="sidebar-subheading">Background</p>
          <div class="space-y-1.5">
            <div>
              <span class="sidebar-label mb-0 block">Figure</span>
              <div class="flex items-center gap-1">
                <ColorInput
                  size="sm"
                  value={activeMosaicLayout.figureBg || displayPlotBg}
                  oninput={(e) =>
                    patchGridChrome({
                      figureBg: /** @type {HTMLInputElement} */ (e.currentTarget).value
                    })
                  }
                />
                <Button size="sm" variant="ghost" onclick={() => patchGridChrome({ figureBg: '' })}
                  >Theme</Button
                >
              </div>
            </div>
            {#if toolbarIsGrid}
            <div>
              <span class="sidebar-label mb-0 block">Cell</span>
              <div class="flex items-center gap-1">
                <ColorInput
                  size="sm"
                  value={activeMosaicLayout.cellBg || displayPlotBg}
                  oninput={(e) =>
                    patchGridChrome({
                      cellBg: /** @type {HTMLInputElement} */ (e.currentTarget).value
                    })
                  }
                />
                <Button size="sm" variant="ghost" onclick={() => patchGridChrome({ cellBg: '' })}
                  >Theme</Button
                >
              </div>
            </div>
            <Button size="sm" variant="outline" className="w-full" onclick={resetGridToAuto}
              >Reset auto</Button
            >
            {/if}
          </div>
        </div>
        {/if}

        <div class="space-y-1">
          {#if toolbarIsGrid || activeMosaicLayout.legendMode === 'outside'}<Divider />{/if}
          <p class="sidebar-subheading">Panel letter</p>
          <p class="sidebar-hint">
            {toolbarIsGrid
              ? 'Outside placement keeps plot sizes; Apply to = every cell, or first of each row/column.'
              : 'Outside sits beside the plot with an optional letter background.'}
          </p>
          <label class="flex items-center gap-1.5">
            <Checkbox
              size="sm"
              name="panel-letter-show"
              checked={activeMosaicLayout.panelLetterShow === true}
              onchange={(e) =>
                patchGridChrome({
                  panelLetterShow: /** @type {HTMLInputElement} */ (e.currentTarget).checked
                })}
            />
            <span class="sidebar-label mb-0">Show letter</span>
          </label>
          {#if activeMosaicLayout.panelLetterShow}
            <div class="grid grid-cols-2 gap-1.5">
              <label title={toolbarIsGrid ? 'First cell letter (then B, C…)' : 'Letter on the plot'}>
                <span class="sidebar-label mb-0 block"
                  >{toolbarIsGrid ? 'Start' : 'Letter'}</span
                >
                <Input
                  size="sm"
                  value={activeMosaicLayout.panelLetterText || 'A'}
                  maxlength={4}
                  className="w-full"
                  oninput={(e) =>
                    patchGridChrome({
                      panelLetterText: /** @type {HTMLInputElement} */ (e.currentTarget).value
                    })
                  }
                />
              </label>
              {#if toolbarIsGrid}
                <label title="Which mosaic cells get a letter">
                  <span class="sidebar-label mb-0 block">Apply to</span>
                  <Select
                    size="sm"
                    className="w-full"
                    value={activeMosaicLayout.panelLetterScope || 'each'}
                    onchange={(e) =>
                      patchGridChrome({
                        panelLetterScope: /** @type {HTMLSelectElement} */ (e.currentTarget).value
                      })
                    }
                  >
                    <option value="each">Every cell</option>
                    <option value="row">First of each row</option>
                    <option value="col">First of each column</option>
                  </Select>
                </label>
              {/if}
              <label class="col-span-2" title="Outside sits beside the panel without reshaping plots">
                <span class="sidebar-label mb-0 block">Placement</span>
                <Select
                  size="sm"
                  className="w-full"
                  value={activeMosaicLayout.panelLetterPlacement || 'outside'}
                  onchange={(e) =>
                    patchGridChrome({
                      panelLetterPlacement: /** @type {HTMLSelectElement} */ (e.currentTarget).value
                    })
                  }
                >
                  <option value="outside">Outside panel</option>
                  <option value="inside">Inside plot</option>
                </Select>
              </label>
              <label>
                <span class="sidebar-label mb-0 block">Corner</span>
                <Select
                  size="sm"
                  className="w-full"
                  value={activeMosaicLayout.panelLetterPosition || 'outside-tl'}
                  onchange={(e) =>
                    patchGridChrome({
                      panelLetterPosition: /** @type {HTMLSelectElement} */ (e.currentTarget).value
                    })
                  }
                >
                  <option value="outside-tl">Top-left</option>
                  <option value="outside-tr">Top-right</option>
                  <option value="inside-tl">Inside · top-left</option>
                  <option value="inside-tr">Inside · top-right</option>
                </Select>
              </label>
              <label title="Badge behind outside letters">
                <span class="sidebar-label mb-0 block">Letter bg</span>
                <Select
                  size="sm"
                  className="w-full"
                  value={activeMosaicLayout.panelLetterBg || 'theme'}
                  onchange={(e) =>
                    patchGridChrome({
                      panelLetterBg: /** @type {HTMLSelectElement} */ (e.currentTarget).value
                    })
                  }
                >
                  <option value="theme">Theme</option>
                  <option value="white">White</option>
                  <option value="black">Black</option>
                  <option value="none">None</option>
                </Select>
              </label>
              <label title="Empty = slightly larger than title font">
                <span class="sidebar-label mb-0 block">Font size</span>
                <Input
                  size="sm"
                  type="number"
                  min="8"
                  max="48"
                  step="1"
                  value={activeMosaicLayout.panelLetterFontSize || ''}
                  placeholder="auto"
                  className="w-full"
                  oninput={(e) =>
                    patchGridChrome({
                      panelLetterFontSize: /** @type {HTMLInputElement} */ (e.currentTarget).value
                    })
                  }
                />
              </label>
              <label class="flex items-end gap-1.5 pb-1">
                <Checkbox
                  size="sm"
                  name="panel-letter-bold"
                  checked={activeMosaicLayout.panelLetterBold !== false}
                  onchange={(e) =>
                    patchGridChrome({
                      panelLetterBold: /** @type {HTMLInputElement} */ (e.currentTarget).checked
                    })}
                />
                <span class="sidebar-label mb-0">Bold</span>
              </label>
              <div class="col-span-2" title="Empty = same as plot text / tick color; uses plot font family">
                <span class="sidebar-label mb-0.5 block">Letter color</span>
                <div class="flex items-center gap-1">
                  <input
                    type="color"
                    value={activeMosaicLayout.panelLetterColor || displayTextColor}
                    class="h-7 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                    oninput={(e) =>
                      patchGridChrome({
                        panelLetterColor: normalizeHexColor(
                          /** @type {HTMLInputElement} */ (e.currentTarget).value,
                          /** @type {HTMLInputElement} */ (e.currentTarget).value
                        )
                      })
                    }
                  />
                  <Input
                    size="sm"
                    value={activeMosaicLayout.panelLetterColor || ''}
                    placeholder={displayTextColor}
                    className="min-w-0 flex-1 font-mono"
                    oninput={(e) =>
                      patchGridChrome({
                        panelLetterColor: /** @type {HTMLInputElement} */ (e.currentTarget).value
                      })
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!String(activeMosaicLayout.panelLetterColor || '').trim()}
                    onclick={() => patchGridChrome({ panelLetterColor: '' })}>Auto</Button
                  >
                </div>
              </div>
              <label title="Horizontal shift (px); negative = left">
                <span class="sidebar-label mb-0 block">Offset X</span>
                <Input
                  size="sm"
                  type="number"
                  min="-40"
                  max="40"
                  step="1"
                  value={activeMosaicLayout.panelLetterOffsetX ?? '0'}
                  className="w-full"
                  oninput={(e) =>
                    patchGridChrome({
                      panelLetterOffsetX: /** @type {HTMLInputElement} */ (e.currentTarget).value
                    })
                  }
                />
              </label>
              <label title="Vertical shift (px); negative = up">
                <span class="sidebar-label mb-0 block">Offset Y</span>
                <Input
                  size="sm"
                  type="number"
                  min="-40"
                  max="40"
                  step="1"
                  value={activeMosaicLayout.panelLetterOffsetY ?? '0'}
                  className="w-full"
                  oninput={(e) =>
                    patchGridChrome({
                      panelLetterOffsetY: /** @type {HTMLInputElement} */ (e.currentTarget).value
                    })
                  }
                />
              </label>
            </div>
          {/if}
        </div>
      </div>
    </ResizableSidePanel>
  {/if}
</div>
