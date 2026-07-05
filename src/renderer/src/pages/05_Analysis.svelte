<script>
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
    detectLipidHeadgroups,
    getEnergeticProperties,
    runEnergeticAnalysis,
    runStructuralAnalysis
  } from '../lib/backendApi'

  /** @type {{ workingDir?: string }} */
  let { workingDir = '' } = $props()

  let mode = $state('structural')
  let running = $state(false)

  // --- Structural state ---
  let topologyPath = $state('')
  /** @type {Array<{ path: string, timeNs: string }>} */
  let trajectoryFiles = $state([])
  let structuralType = $state('rmsd')
  let selection = $state('protein and backbone')
  let selection2 = $state('protein and resid 50')
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
  let manualHeadgroupName = $state('')
  let bilayerAdvancedOpen = $state(false)

  // --- Energetic state ---
  /** @type {Array<{ path: string, timeNs: string }>} */
  let logFiles = $state([])
  let energeticEngine = $state('namd') // 'namd' | 'openmm' | 'gromacs'
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
    fontFamily: 'sans-serif',
    extraLeftMargin: '0',
    extraBottomMargin: '0',
    legendPosition: 'bottom',
    xTickCount: '5',
    yTickCount: '5',
    residueCodeFormat: 'three'
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
    fontFamily: 'sans-serif',
    extraLeftMargin: '20',
    extraBottomMargin: '0',
    legendPosition: 'top-right',
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
  let ePlot = $state({ ...energDefaults })

  // Per-type stored structural results (null = not yet run for that type)
  /** @type {Record<string,{rawX:number[],rawY:number[],xLabels:string[],seriesName:string,primaryStats:any,chartXLabel:string,chartYLabel:string,chartTitle:string,lastAnalysisHasTimeX:boolean}|null>} */
  let structResults = $state({
    rmsd: null,
    rmsf: null,
    distance: null,
    radius_of_gyration: null,
    area_per_lipid: null,
    membrane_thickness: null
  })

  // Derived: active plot settings for current mode+type
  const ps = $derived(mode === 'structural' ? sPlots[structuralType] : ePlot)
  // Derived: active structural result for current type (null = not run yet)
  const activeStructRes = $derived(
    mode === 'structural' ? (structResults[structuralType] ?? null) : null
  )

  // ── Sync to shared status bar store ──
  $effect(() => {
    analysisStatus.running = running
    analysisStatus.mode = mode
    analysisStatus.analysisType = mode === 'structural' ? structuralType : 'energetic'
    analysisStatus.resultAvailable =
      mode === 'structural' ? activeStructRes !== null : chartSeries.length > 0
  })

  const BILAYER_TYPES = new Set(['area_per_lipid', 'membrane_thickness'])
  const isBilayerType = (type) => BILAYER_TYPES.has(type)
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

  // Build displayed chart series applying unit conversions
  const displaySeries = $derived.by(() => {
    if (mode === 'structural') {
      if (!activeStructRes) return []
      const sp = sPlots[structuralType]
      const xs = activeStructRes.lastAnalysisHasTimeX
        ? convertX(activeStructRes.rawX, 'ns', sp.xUnit)
        : activeStructRes.rawX
      const mainSeries = {
        name: activeStructRes.seriesName,
        x: xs,
        y: convertStructY(activeStructRes.rawY, sp.yUnit, structuralType),
        color: sp.lineColor
      }
      const extraColors = ['#3b82f6', '#22c55e']
      const extraSeries = (activeStructRes.extraSeries || []).map((s, i) => ({
        name: s.name,
        x: xs,
        y: convertStructY(s.rawY, sp.yUnit, structuralType),
        color: extraColors[i % extraColors.length]
      }))
      return [mainSeries, ...extraSeries]
    }
    // Energetic: filter by selectedProperties, full reactive unit conversion
    if (rawSeries.length === 0) return []
    const xs = convertX(rawX, rawXTimeUnit, timeUnits)
    const visible = rawSeries.filter((s) => selectedProperties.includes(s.baseName))
    return visible.map((s) => {
      const convertedY = convertEnergeticYArr(s.y, s.unit)
      const tUnit = getTargetUnit(s.unit)
      const displayName = tUnit ? `${s.baseName} (${tUnit})` : s.baseName
      return { name: displayName, x: xs, y: convertedY }
    })
  })

  const displayXLabel = $derived.by(() => {
    if (ps.xLabel) return ps.xLabel
    if (mode === 'energetic') return `${chartXLabel.replace(/\s*\(.*\)$/, '')} (${timeUnits})`
    if (!activeStructRes) return 'X'
    if (!activeStructRes.lastAnalysisHasTimeX) return activeStructRes.chartXLabel
    const sp = sPlots[structuralType]
    return activeStructRes.chartXLabel.includes('(')
      ? activeStructRes.chartXLabel.replace(/\(.*\)/, `(${sp.xUnit})`).trim()
      : `${activeStructRes.chartXLabel} (${sp.xUnit})`
  })
  const displayYLabel = $derived.by(() => {
    if (ps.yLabel) return ps.yLabel
    if (mode === 'energetic') {
      if (displaySeries.length === 1) return displaySeries[0].name
      return 'Value'
    }
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
  const displayTitle = $derived(
    ps.title || (mode === 'structural' ? (activeStructRes?.chartTitle ?? '') : chartTitle)
  )

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
    headgroupDetecting = true
    headgroupDetectAttempted = true
    try {
      const data = await detectLipidHeadgroups({
        topologyPath,
        trajectoryPaths: trajectoryFiles.map((f) => f.path)
      })
      applyHeadgroupDetection(data)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      headgroupDetecting = false
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
        map[basename(item.path)] = value
      }
    }
    return map
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
      ...result.filePaths.filter((p) => !existing.has(p)).map((p) => ({ path: p, timeNs: '' }))
    ]
    trajectoryFiles = sortByName(trajectoryFiles)
    if (isBilayerType(structuralType) && topologyPath) {
      await refreshHeadgroupAtoms()
    }
  }

  function removeTrajectory(index) {
    trajectoryFiles = trajectoryFiles.filter((_, i) => i !== index)
  }

  async function onStructuralTypeChange(nextType) {
    structuralType = nextType
    if (nextType === 'rmsf' && (!selection || selection === 'protein and backbone')) {
      selection = 'protein and name CA'
    } else if (isBilayerType(nextType)) {
      if (topologyPath) {
        await refreshHeadgroupAtoms()
      }
    }
  }

  async function addLogFile() {
    const engineLabels = { namd: 'NAMD', openmm: 'OpenMM', gromacs: 'GROMACS' }
    const engineLabel = engineLabels[energeticEngine] || 'Engine'
    const result = await window.api.openFilesDialog(
      `Add ${engineLabel} Log Files`,
      [{ name: 'Log Files', extensions: ['log', 'txt', 'csv'] }],
      workingDir || undefined
    )
    if (result.canceled) return
    const existing = new Set(logFiles.map((f) => f.path))
    logFiles = [
      ...logFiles,
      ...result.filePaths.filter((p) => !existing.has(p)).map((p) => ({ path: p, timeNs: '' }))
    ]
    logFiles = sortByName(logFiles)
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
    if (rawSeries.length > 0) runAnalysis()
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

  // ---- Energetic properties ----
  async function detectEnergeticColumns() {
    if (logFiles.length === 0) {
      alert('Add at least one log file first.')
      return
    }
    try {
      running = true
      lastError = ''
      const { properties } = await getEnergeticProperties({
        logPaths: logFiles.map((f) => f.path),
        fileTimes: makeFileTimes(logFiles),
        engine: energeticEngine
      })
      availableProperties = properties || []
      selectedProperties = [...availableProperties]
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    } finally {
      running = false
    }
  }

  function toggleProperty(prop, checked) {
    if (checked) {
      if (!selectedProperties.includes(prop)) selectedProperties = [...selectedProperties, prop]
    } else {
      selectedProperties = selectedProperties.filter((p) => p !== prop)
    }
  }

  // ---- Run analysis ----
  async function runAnalysis() {
    try {
      running = true
      lastError = ''
      if (mode === 'structural') {
        structResults[structuralType] = null // clear to show loading state
      } else {
        chartSeries = []
        rawSeries = []
        primaryStats = null
        rawX = []
        rawY = []
      }

      if (mode === 'structural') {
        if (!topologyPath) throw new Error('Select a topology file.')
        if (trajectoryFiles.length === 0) throw new Error('Add at least one trajectory file.')
        if (structuralType === 'distance' && (!selection || !selection2))
          throw new Error('Distance analysis requires two atom selections.')
        if (isBilayerType(structuralType) && !selection.trim())
          throw new Error('Enable at least one phosphate/headgroup atom name.')

        const result = await runStructuralAnalysis({
          topologyPath,
          trajectoryPaths: trajectoryFiles.map((f) => f.path),
          analysisType: structuralType,
          selection,
          selection2,
          referenceFrame: Number(referenceFrame || 0),
          align,
          fileTimes: makeFileTimes(trajectoryFiles),
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
        structResults[structuralType] = {
          rawX: result.x || [],
          rawY: result.y || [],
          xLabels: xLabelsResult,
          extraSeries,
          seriesName: result.series_name,
          primaryStats: result.stats || null,
          chartXLabel: result.x_label || 'X',
          chartYLabel: result.y_label || 'Y',
          chartTitle: `${(result.analysis_type || structuralType).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} Analysis`,
          lastAnalysisHasTimeX: xLabelsResult.length === 0
        }
      } else {
        if (logFiles.length === 0) throw new Error('Add at least one log file.')
        if (selectedProperties.length === 0) throw new Error('Select at least one property.')

        const result = await runEnergeticAnalysis({
          logPaths: logFiles.map((f) => f.path),
          properties: selectedProperties,
          fileTimes: makeFileTimes(logFiles),
          timeUnits,
          energyUnits,
          pressureUnits,
          temperatureUnits,
          volumeUnits,
          engine: energeticEngine
        })

        rawX = result.x || []
        rawY = result.series?.[0]?.y || []
        rawXTimeUnit = timeUnits // remember what unit the backend returned X in
        rawSeries = (result.series || []).map((s) => ({
          baseName: s.name,
          unit: s.unit || '',
          y: s.y || [],
          key: s.key
        }))
        // chartSeries kept in sync (used by empty check + CSV export headers)
        chartSeries = rawSeries.map((s) => ({
          name: s.unit ? `${s.baseName} (${s.unit})` : s.baseName,
          x: rawX,
          y: s.y
        }))
        chartTitle = `${{ namd: 'NAMD', openmm: 'OpenMM', gromacs: 'GROMACS' }[energeticEngine] || energeticEngine.toUpperCase()} Energetic Analysis`
        chartXLabel = result.x_label || 'Time'
        chartYLabel = 'Value'
        const first = result.series?.[0]?.key
        primaryStats = first && result.statistics ? result.statistics[first] || null : null
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    } finally {
      running = false
    }
  }

  // ---- Export ----
  function exportBaseName() {
    return (displayTitle || chartTitle || 'analysis').replace(/[^a-z0-9_\-]/gi, '_').toLowerCase()
  }

  async function exportCsv() {
    if (displaySeries.length === 0) return
    const suggestedName = exportBaseName() + '.csv'
    const defaultPath = workingDir ? `${workingDir}/${suggestedName}` : suggestedName
    const result = await window.api.saveFileDialog(
      'Export CSV — file will be saved as .csv',
      [{ name: 'CSV', extensions: ['csv'] }],
      defaultPath
    )
    if (result.canceled) return
    const header = ['x', ...displaySeries.map((s) => s.name)].join(',')
    const rows = displaySeries[0].x.map((xv, i) =>
      [xv, ...displaySeries.map((s) => s.y[i] ?? '')].join(',')
    )
    await window.api.writeText(result.filePath, [header, ...rows].join('\n'))
  }

  async function exportSvg() {
    if (!svgEl) return
    const suggestedName = exportBaseName() + '.svg'
    const defaultPath = workingDir ? `${workingDir}/${suggestedName}` : suggestedName
    const result = await window.api.saveFileDialog(
      'Export SVG — file will be saved as .svg',
      [{ name: 'SVG', extensions: ['svg'] }],
      defaultPath
    )
    if (result.canceled) return
    const svgStr = '<?xml version="1.0" encoding="UTF-8"?>\n' + svgEl.outerHTML
    await window.api.writeText(result.filePath, svgStr)
  }

  async function exportPng() {
    if (!svgEl) return
    try {
      const suggestedName = exportBaseName() + '.png'
      const defaultPath = workingDir ? `${workingDir}/${suggestedName}` : suggestedName
      const result = await window.api.saveFileDialog(
        'Export PNG — file will be saved as .png',
        [{ name: 'PNG Image', extensions: ['png'] }],
        defaultPath
      )
      if (result.canceled) return

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
      await window.api.writeBinary(result.filePath, base64)
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

<!-- Topology info modal -->
{#if showTopoInfo && topoInfo}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    onmousedown={() => (showTopoInfo = false)}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="mx-4 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border border-neutral-300 bg-white p-5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
      onmousedown={(e) => e.stopPropagation()}
    >
      <h2 class="mb-3 text-sm font-semibold">Topology Summary</h2>

      <!-- Totals -->
      <div class="mb-4 grid grid-cols-3 gap-2">
        <div class="rounded border border-neutral-200 p-2 text-center dark:border-neutral-800">
          <p class="text-neutral-500">Atoms</p>
          <p class="text-sm font-semibold">{topoInfo.n_atoms.toLocaleString()}</p>
        </div>
        <div class="rounded border border-neutral-200 p-2 text-center dark:border-neutral-800">
          <p class="text-neutral-500">Residues</p>
          <p class="text-sm font-semibold">{topoInfo.n_residues.toLocaleString()}</p>
        </div>
        <div class="rounded border border-neutral-200 p-2 text-center dark:border-neutral-800">
          <p class="text-neutral-500">Segments</p>
          <p class="text-sm font-semibold">{topoInfo.n_segments}</p>
        </div>
      </div>

      <!-- Category breakdown -->
      {#if topoInfo.categories && Object.keys(topoInfo.categories).length > 0}
        {@const catIcons = {
          Protein: '🧬',
          Nucleic: '🔵',
          Water: '💧',
          Ions: '⚡',
          Lipids: '🟡',
          Other: '◆'
        }}
        <p class="mb-1.5 font-medium">Molecule categories</p>
        <div class="mb-4 space-y-2">
          {#each Object.entries(topoInfo.categories) as [cat, info] (cat)}
            <div class="rounded border border-neutral-200 p-2 dark:border-neutral-800">
              <div class="mb-1 flex items-center justify-between">
                <span class="font-medium">{catIcons[cat] ?? '◆'} {cat}</span>
                <span class="text-neutral-400"
                  >{info.total_residues} residues · {info.total_atoms.toLocaleString()} atoms</span
                >
              </div>
              <p class="leading-relaxed text-neutral-500">
                {#each Object.entries(info.by_name).sort() as [rname, count] (rname)}
                  <span class="mr-2"><span class="text-neutral-300">{rname}</span> ×{count}</span>
                {/each}
              </p>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Segments table -->
      {#if topoInfo.segments.length > 1}
        <p class="mb-1 font-medium">Segments</p>
        <table class="mb-4 w-full">
          <thead>
            <tr class="border-b border-neutral-200 text-neutral-500 dark:border-neutral-800">
              <th class="pb-1 text-left">SegID</th>
              <th class="pb-1 text-right">Residues</th>
              <th class="pb-1 text-right">Atoms</th>
            </tr>
          </thead>
          <tbody>
            {#each topoInfo.segments as seg (seg.segid)}
              <tr class="border-b border-neutral-200/80 dark:border-neutral-800/50">
                <td class="py-0.5 text-neutral-300">{seg.segid}</td>
                <td class="py-0.5 text-right text-neutral-300">{seg.n_residues}</td>
                <td class="py-0.5 text-right text-neutral-300">{seg.n_atoms.toLocaleString()}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}

      {#if topoInfo.lipid_headgroup_atoms?.length}
        <p class="mb-1 font-medium">Phosphate / headgroup atom names</p>
        <p class="mb-2 leading-relaxed text-neutral-500">
          Detected in lipid residues. All names are enabled by default for bilayer analysis:
        </p>
        <div class="mb-4 flex flex-wrap gap-1">
          {#each topoInfo.lipid_headgroup_atoms as atom (atom.name)}
            <span class="rounded border border-amber-700/50 bg-amber-950/30 px-2 py-1 font-mono text-amber-200">
              {atom.name}
              <span class="text-amber-400/70">×{atom.atom_count}</span>
            </span>
          {/each}
        </div>
        {#if topoInfo.lipid_headgroup_selection}
          <p class="mb-4 font-mono text-neutral-400">{topoInfo.lipid_headgroup_selection}</p>
        {/if}
      {/if}

      <!-- Residue types -->
      <p class="mb-1 font-medium">All residue types ({topoInfo.residue_types.length})</p>
      <p class="leading-relaxed text-neutral-400">{topoInfo.residue_types.join('  ')}</p>

      <Button className="mt-4 w-full" onclick={() => (showTopoInfo = false)}>Close</Button>
    </div>
  </div>
{/if}

<div class="flex min-w-0 flex-1 divide-x divide-neutral-200 overflow-hidden select-none dark:divide-neutral-800">
  <!-- ===== SIDEBAR ===== -->
  <aside class="w-80 shrink-0 space-y-4 overflow-x-clip overflow-y-auto p-4 text-xs">
    <div class="space-y-2">
      <h2 class="sidebar-heading">Analysis Mode</h2>
      <Select size="sm" className="w-full" bind:value={mode}>
        <option value="structural">Structural</option>
        <option value="energetic">Energetic (Logs)</option>
      </Select>
    </div>

    <Divider />

    {#if mode === 'structural'}
      <!-- Structural Input -->
      <div class="space-y-2">
        <h2 class="sidebar-heading">Structural Input</h2>
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
            >
              {#if topoLoading}<Spinner className="h-3 w-3" />{:else}Info{/if}
            </Button>
          </div>
        </div>

        <div class="space-y-1">
          <div class="flex items-center justify-between">
            <p class="sidebar-label">Trajectory files</p>
            <Button size="sm" variant="outline" onclick={addTrajectoryFile}>+ Add</Button>
          </div>
          {#if trajectoryFiles.length === 0}
            <p class="sidebar-hint">No trajectory files selected.</p>
          {:else}
            <div class="space-y-0.5">
              {#each trajectoryFiles as file, i (file.path)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  draggable="true"
                  ondragstart={() => onDragStart(i)}
                  ondragover={(e) => onDragOver(e, i)}
                  ondrop={(e) => onDropTrajectory(e, i)}
                  ondragend={onDragEnd}
                  class="flex items-center gap-1 rounded border border-neutral-200 px-1.5 py-1 transition-opacity dark:border-neutral-800
                    {dragIdx === i ? 'opacity-40' : ''}
                    {dragOverIdx === i && dragIdx !== i ? 'border-amber-500 bg-amber-500/10' : ''}"
                >
                  <span
                    class="shrink-0 cursor-grab text-neutral-600 select-none"
                    title="Drag to reorder">⠿</span
                  >
                  <span class="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-300" title={file.path}
                    >{basename(file.path)}</span
                  >
                  <Input
                    size="sm"
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="0"
                    bind:value={trajectoryFiles[i].timeNs}
                    className="w-14 shrink-0"
                  />
                  <span class="sidebar-label shrink-0">ns</span>
                  <button
                    class="shrink-0 px-1 text-red-500 hover:text-red-400"
                    onclick={() => removeTrajectory(i)}
                    title="Remove">✕</button
                  >
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      <Divider />

      <!-- Structural Options -->
      <div class="space-y-2">
        <h2 class="sidebar-heading">Structural Options</h2>
        <Select
          size="sm"
          className="w-full"
          bind:value={structuralType}
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
              <p class="sidebar-label">Headgroup atoms</p>
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
                  None detected — use Advanced settings to add atom names.
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
                    <span class="font-mono text-neutral-300">{atom.name}</span>
                    {#if atom.atomCount > 0}
                      <span class="text-neutral-600">({atom.atomCount.toLocaleString()})</span>
                    {/if}
                  </label>
                {/each}
              </div>
            {/if}

            <button
              type="button"
              class="flex w-full items-center justify-between rounded border border-neutral-200 px-2 py-1.5 text-left hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-900"
              onclick={() => (bilayerAdvancedOpen = !bilayerAdvancedOpen)}
            >
              <span class="sidebar-subheading">Advanced settings</span>
              <span class="sidebar-hint">{bilayerAdvancedOpen ? '▲' : '▼'}</span>
            </button>

            {#if bilayerAdvancedOpen}
              <div class="space-y-2 rounded border p-2 dark:border-neutral-800">
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
          <!-- Selection 1 row with help button -->
          <div class="flex gap-1">
            <Input
              size="sm"
              bind:value={selection}
              placeholder={structuralType === 'distance' ? 'Atom group 1' : 'MDAnalysis selection'}
              className="min-w-0 flex-1"
            />
            <button
              class="shrink-0 rounded border border-neutral-700 px-2 text-neutral-400 hover:text-neutral-200"
              onclick={() => (showSelectionHelp = true)}
              title="Selection syntax help">?</button
            >
          </div>
        {/if}

        {#if structuralType === 'distance'}
          <Input size="sm" bind:value={selection2} placeholder="Atom group 2" className="w-full" />
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
        <h2 class="sidebar-heading">Energetic Input</h2>
        <div class="space-y-1">
          <p class="sidebar-label">MD Engine</p>
          <Select size="sm" className="w-full" bind:value={energeticEngine}>
            <option value="namd">NAMD</option>
            <option value="openmm">OpenMM</option>
            <option value="gromacs">GROMACS</option>
          </Select>
        </div>
        <div class="flex items-center justify-between">
          <p class="sidebar-label">
            {{ namd: 'NAMD', openmm: 'OpenMM', gromacs: 'GROMACS' }[energeticEngine]} log files
          </p>
          <Button size="sm" variant="outline" onclick={addLogFile}>+ Add</Button>
        </div>

        {#if logFiles.length === 0}
          <p class="sidebar-hint">No log files selected.</p>
        {:else}
          <div class="space-y-0.5">
            {#each logFiles as file, i (file.path)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                draggable="true"
                ondragstart={() => onDragStart(i)}
                ondragover={(e) => onDragOver(e, i)}
                ondrop={(e) => onDropLog(e, i)}
                ondragend={onDragEnd}
                class="flex items-center gap-1 rounded border border-neutral-200 px-1.5 py-1 transition-opacity dark:border-neutral-800
                  {dragIdx === i ? 'opacity-40' : ''}
                  {dragOverIdx === i && dragIdx !== i ? 'border-amber-500 bg-amber-500/10' : ''}"
              >
                <span
                  class="shrink-0 cursor-grab text-neutral-600 select-none"
                  title="Drag to reorder">⠿</span
                >
                <span class="min-w-0 flex-1 truncate text-neutral-300" title={file.path}
                  >{basename(file.path)}</span
                >
                <Input
                  size="sm"
                  type="number"
                  min="0"
                  step="0.1"
                  placeholder="0"
                  bind:value={logFiles[i].timeNs}
                  className="w-14 shrink-0"
                />
                <span class="sidebar-label shrink-0">ns</span>
                <button
                  class="shrink-0 px-1 text-red-500 hover:text-red-400"
                  onclick={() => removeLog(i)}
                  title="Remove">✕</button
                >
              </div>
            {/each}
          </div>
        {/if}

        <Button
          variant="outline"
          className="w-full"
          onclick={detectEnergeticColumns}
          disabled={running}
        >
          Detect Properties
        </Button>
      </div>

      <Divider />

      <!-- Energetic Options -->
      <div class="space-y-2">
        <h2 class="sidebar-heading">Energetic Options</h2>
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

          <!-- Axis limits -->
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

          <!-- Colors + transparency -->
          <div class="grid grid-cols-2 gap-1">
            <div>
              <p class="sidebar-label mb-0.5">Line color</p>
              <div class="flex items-center gap-1">
                <input
                  type="color"
                  bind:value={ps.lineColor}
                  class="h-7 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                />
                <Input size="sm" bind:value={ps.lineColor} className="min-w-0 flex-1 font-mono" />
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

          <!-- Aspect ratio + transparent bg + DPI + font -->
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

          <!-- Actions -->
          <div class="flex gap-1 pt-1">
            <Button
              size="sm"
              variant="ghost"
              className="flex-1"
              onclick={() => {
                mode === 'structural'
                  ? (sPlots[structuralType] = { ...structDefaults })
                  : (ePlot = { ...energDefaults })
              }}>Reset</Button
            >
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onclick={exportCsv}
              disabled={displaySeries.length === 0}>CSV</Button
            >
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onclick={exportSvg}
              disabled={!svgEl}>SVG</Button
            >
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onclick={exportPng}
              disabled={!svgEl}>PNG</Button
            >
          </div>
        </div>
      {/if}
    </div>

    <Divider />

    <Button className="w-full" onclick={runAnalysis} disabled={running}>
      {#if running}
        <Spinner className="mr-1" />Running...
      {:else}
        Run Analysis
      {/if}
    </Button>
  </aside>

  <!-- ===== CHART AREA ===== -->
  <div class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    <h1 class="m-4 text-xl font-semibold">{displayTitle || 'Analysis'}</h1>

    {#if lastError}
      <div class="mx-4 mb-3 rounded-md border border-red-700/50 bg-red-950/30 p-2 text-xs text-red-300">
        {lastError}
      </div>
    {/if}

    {#if displaySeries.length === 0}
      <p
        class="mx-4 mb-4 flex flex-1 items-center justify-center rounded-lg border border-dashed border-neutral-300 text-neutral-500 dark:border-neutral-800 dark:text-neutral-700"
      >
        Run an analysis to see results.
      </p>
    {:else}
      <div class="mx-4 mb-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        <LineChart
          series={displaySeries}
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
          fontFamily={ps.fontFamily || 'sans-serif'}
          chartTitle={displayTitle}
          xTickLabels={displayXTickLabels}
          xTicks={Number(ps.xTickCount) || 5}
          yTicks={Number(ps.yTickCount) || 5}
          extraLeftMargin={Number(ps.extraLeftMargin) || 0}
          extraBottomMargin={Number(ps.extraBottomMargin) || 0}
          legendPosition={ps.legendPosition || 'bottom'}
          xMinOverride={xMinO}
          xMaxOverride={xMaxO}
          yMinOverride={yMinO}
          yMaxOverride={yMaxO}
          bind:svgEl
        />

        {#if activePrimaryStats}
          <div class="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
            <div class="sidebar-panel p-2">
              <p class="sidebar-label">Mean</p>
              <p class="font-semibold">{Number(activePrimaryStats.mean).toFixed(4)}</p>
            </div>
            <div class="sidebar-panel p-2">
              <p class="sidebar-label">Std</p>
              <p class="font-semibold">{Number(activePrimaryStats.std).toFixed(4)}</p>
            </div>
            <div class="sidebar-panel p-2">
              <p class="sidebar-label">Min</p>
              <p class="font-semibold">{Number(activePrimaryStats.min).toFixed(4)}</p>
            </div>
            <div class="sidebar-panel p-2">
              <p class="sidebar-label">Max</p>
              <p class="font-semibold">{Number(activePrimaryStats.max).toFixed(4)}</p>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
