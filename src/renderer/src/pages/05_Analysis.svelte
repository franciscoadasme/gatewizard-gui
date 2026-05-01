<script>
  import Button from '../components/ui/Button.svelte'
  import Checkbox from '../components/ui/Checkbox.svelte'
  import Divider from '../components/ui/Divider.svelte'
  import Empty from '../components/ui/Empty.svelte'
  import Input from '../components/ui/Input.svelte'
  import Select from '../components/ui/Select.svelte'
  import Spinner from '../components/ui/Spinner.svelte'
  import LineChart from '../components/LineChart.svelte'
  import {
    analyzeTopology,
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

  // --- Energetic state ---
  /** @type {Array<{ path: string, timeNs: string }>} */
  let logFiles = $state([])
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
    fontFamily: 'sans-serif'
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
    fontFamily: 'sans-serif'
  }

  let sPlot = $state({ ...structDefaults })
  let ePlot = $state({ ...energDefaults })

  // Derived: active plot settings for current mode
  const ps = $derived(mode === 'structural' ? sPlot : ePlot)

  // Unit conversion helpers
  function convertX(xs, fromUnit, toUnit) {
    if (fromUnit === toUnit) return xs
    const factors = { ns: 1, ps: 1000, µs: 0.001 }
    const f = factors[toUnit] / factors[fromUnit]
    return xs.map((v) => v * f)
  }
  function convertStructY(ys, toUnit) {
    // API returns Å; convert to nm if needed
    if (toUnit === 'Å' || toUnit === '') return ys
    if (toUnit === 'nm') return ys.map((v) => v * 0.1)
    return ys
  }

  // Build displayed chart series applying unit conversions
  const displaySeries = $derived.by(() => {
    if (chartSeries.length === 0) return []
    if (mode === 'structural') {
      const xs = convertX(rawX, 'ns', sPlot.xUnit)
      const ys = convertStructY(rawY, sPlot.yUnit)
      return [{ ...chartSeries[0], x: xs, y: ys, color: sPlot.lineColor }]
    }
    // Energetic: only convert X
    const xs = convertX(rawX, 'ns', ePlot.xUnit)
    return chartSeries.map((s) => ({ ...s, x: xs }))
  })

  const displayXLabel = $derived(
    ps.xLabel ||
      (chartXLabel.includes('(')
        ? chartXLabel.replace(/\(.*\)/, `(${ps.xUnit})`).trim()
        : `${chartXLabel} (${ps.xUnit})`)
  )
  const displayYLabel = $derived(
    ps.yLabel ||
      (mode === 'structural' && sPlot.yUnit !== 'Å'
        ? chartYLabel.replace(/\(Å\)/, `(${sPlot.yUnit})`)
        : chartYLabel)
  )
  const displayTitle = $derived(ps.title || chartTitle)

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
  function basename(path) {
    return path.split(/[\\/]/).pop() || path
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
    if (!result.canceled) topologyPath = result.filePath
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
  }

  function removeTrajectory(index) {
    trajectoryFiles = trajectoryFiles.filter((_, i) => i !== index)
  }

  async function addLogFile() {
    const result = await window.api.openFilesDialog(
      'Add NAMD Log Files',
      [{ name: 'NAMD Logs', extensions: ['log'] }],
      workingDir || undefined
    )
    if (result.canceled) return
    const existing = new Set(logFiles.map((f) => f.path))
    logFiles = [
      ...logFiles,
      ...result.filePaths.filter((p) => !existing.has(p)).map((p) => ({ path: p, timeNs: '' }))
    ]
  }

  function removeLog(index) {
    logFiles = logFiles.filter((_, i) => i !== index)
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
        fileTimes: makeFileTimes(logFiles)
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
      chartSeries = []
      primaryStats = null
      rawX = []
      rawY = []

      if (mode === 'structural') {
        if (!topologyPath) throw new Error('Select a topology file.')
        if (trajectoryFiles.length === 0) throw new Error('Add at least one trajectory file.')
        if (structuralType === 'distance' && (!selection || !selection2))
          throw new Error('Distance analysis requires two atom selections.')

        const result = await runStructuralAnalysis({
          topologyPath,
          trajectoryPaths: trajectoryFiles.map((f) => f.path),
          analysisType: structuralType,
          selection,
          selection2,
          referenceFrame: Number(referenceFrame || 0),
          align,
          fileTimes: makeFileTimes(trajectoryFiles),
          rmsfXaxisType: rmsfXaxisType
        })

        rawX = result.x || []
        rawY = result.y || []
        chartSeries = [{ name: result.series_name, x: rawX, y: rawY }]
        chartTitle = `${(result.analysis_type || structuralType).toUpperCase()} Analysis`
        chartXLabel = result.x_label || 'X'
        chartYLabel = result.y_label || 'Y'
        primaryStats = result.stats || null
      } else {
        if (logFiles.length === 0) throw new Error('Add at least one NAMD log file.')
        if (selectedProperties.length === 0) throw new Error('Select at least one property.')

        const result = await runEnergeticAnalysis({
          logPaths: logFiles.map((f) => f.path),
          properties: selectedProperties,
          fileTimes: makeFileTimes(logFiles),
          timeUnits,
          energyUnits,
          pressureUnits,
          temperatureUnits,
          volumeUnits
        })

        rawX = result.x || []
        rawY = result.series?.[0]?.y || []
        chartSeries = (result.series || []).map((s) => ({
          name: `${s.name} (${s.unit || ''})`.replace(/ \(\)$/, ''),
          x: rawX,
          y: s.y || []
        }))
        chartTitle = 'NAMD Energetic Analysis'
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
      class="mx-4 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-900 p-5 text-xs"
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
      class="mx-4 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-900 p-5 text-xs"
      onmousedown={(e) => e.stopPropagation()}
    >
      <h2 class="mb-3 text-sm font-semibold">Topology Summary</h2>

      <!-- Totals -->
      <div class="mb-4 grid grid-cols-3 gap-2">
        <div class="rounded border border-neutral-800 p-2 text-center">
          <p class="text-neutral-500">Atoms</p>
          <p class="text-sm font-semibold">{topoInfo.n_atoms.toLocaleString()}</p>
        </div>
        <div class="rounded border border-neutral-800 p-2 text-center">
          <p class="text-neutral-500">Residues</p>
          <p class="text-sm font-semibold">{topoInfo.n_residues.toLocaleString()}</p>
        </div>
        <div class="rounded border border-neutral-800 p-2 text-center">
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
            <div class="rounded border border-neutral-800 p-2">
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
            <tr class="border-b border-neutral-800 text-neutral-500">
              <th class="pb-1 text-left">SegID</th>
              <th class="pb-1 text-right">Residues</th>
              <th class="pb-1 text-right">Atoms</th>
            </tr>
          </thead>
          <tbody>
            {#each topoInfo.segments as seg (seg.segid)}
              <tr class="border-b border-neutral-800/50">
                <td class="py-0.5 text-neutral-300">{seg.segid}</td>
                <td class="py-0.5 text-right text-neutral-300">{seg.n_residues}</td>
                <td class="py-0.5 text-right text-neutral-300">{seg.n_atoms.toLocaleString()}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}

      <!-- Residue types -->
      <p class="mb-1 font-medium">All residue types ({topoInfo.residue_types.length})</p>
      <p class="leading-relaxed text-neutral-400">{topoInfo.residue_types.join('  ')}</p>

      <Button className="mt-4 w-full" onclick={() => (showTopoInfo = false)}>Close</Button>
    </div>
  </div>
{/if}

<div class="flex min-w-0 flex-1 divide-x divide-neutral-800 select-none">
  <!-- ===== SIDEBAR ===== -->
  <aside class="w-80 space-y-3 overflow-x-clip overflow-y-auto p-4 text-xs">
    <div class="space-y-2">
      <h2 class="font-semibold">Analysis Mode</h2>
      <Select className="w-full" bind:value={mode}>
        <option value="structural">Structural</option>
        <option value="energetic">Energetic (NAMD Logs)</option>
      </Select>
    </div>

    <Divider />

    {#if mode === 'structural'}
      <!-- Structural Input -->
      <div class="space-y-2">
        <h2 class="font-semibold">Structural Input</h2>
        <div class="space-y-1">
          <p class="text-neutral-500">Topology file</p>
          <div class="flex gap-1">
            <Input value={basename(topologyPath) || '—'} disabled className="min-w-0 flex-1" />
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
            <p class="text-neutral-500">Trajectory files</p>
            <Button size="sm" variant="outline" onclick={addTrajectoryFile}>+ Add</Button>
          </div>
          {#if trajectoryFiles.length === 0}
            <p class="text-neutral-600">No trajectory files selected.</p>
          {:else}
            <div class="space-y-0.5">
              {#each trajectoryFiles as file, i (file.path)}
                <div
                  class="flex items-center gap-1 rounded border px-1.5 py-1 dark:border-neutral-800"
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
                    bind:value={trajectoryFiles[i].timeNs}
                    className="w-14 shrink-0"
                  />
                  <span class="shrink-0 text-neutral-500">ns</span>
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
        <h2 class="font-semibold">Structural Options</h2>
        <Select className="w-full" bind:value={structuralType}>
          <option value="rmsd">RMSD</option>
          <option value="rmsf">RMSF</option>
          <option value="distance">Distance</option>
          <option value="radius_of_gyration">Radius of Gyration</option>
        </Select>

        <!-- Selection 1 row with help button -->
        <div class="flex gap-1">
          <Input
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

        {#if structuralType === 'distance'}
          <Input bind:value={selection2} placeholder="Atom group 2" className="w-full" />
        {/if}

        {#if structuralType === 'rmsd'}
          <div class="flex items-center gap-2">
            <span class="shrink-0 text-neutral-500">Ref. frame</span>
            <Input size="sm" type="number" min="0" bind:value={referenceFrame} className="w-20" />
          </div>
          <label class="flex items-center gap-2">
            <Checkbox name="align-rmsd" bind:checked={align} />
            <span>Align before RMSD</span>
          </label>
        {/if}

        {#if structuralType === 'rmsf'}
          <div class="space-y-1">
            <p class="text-neutral-500">X axis type</p>
            <Select className="w-full" bind:value={rmsfXaxisType}>
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
        <h2 class="font-semibold">Energetic Input</h2>
        <div class="flex items-center justify-between">
          <p class="text-neutral-500">NAMD log files</p>
          <Button size="sm" variant="outline" onclick={addLogFile}>+ Add</Button>
        </div>

        {#if logFiles.length === 0}
          <p class="text-neutral-600">No log files selected.</p>
        {:else}
          <div class="space-y-0.5">
            {#each logFiles as file, i (file.path)}
              <div
                class="flex items-center gap-1 rounded border px-1.5 py-1 dark:border-neutral-800"
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
                <span class="shrink-0 text-neutral-500">ns</span>
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
        <h2 class="font-semibold">Energetic Options</h2>
        <div class="grid grid-cols-2 gap-1">
          <Select bind:value={timeUnits}>
            <option value="ns">Time: ns</option>
            <option value="ps">Time: ps</option>
            <option value="µs">Time: µs</option>
          </Select>
          <Select bind:value={energyUnits}>
            <option value="kcal/mol">Energy: kcal/mol</option>
            <option value="kJ/mol">Energy: kJ/mol</option>
          </Select>
          <Select bind:value={pressureUnits}>
            <option value="atm">Pressure: atm</option>
            <option value="bar">Pressure: bar</option>
            <option value="kPa">Pressure: kPa</option>
            <option value="MPa">Pressure: MPa</option>
          </Select>
          <Select bind:value={temperatureUnits}>
            <option value="K">Temp: K</option>
            <option value="°C">Temp: °C</option>
            <option value="°F">Temp: °F</option>
          </Select>
        </div>
        <Select bind:value={volumeUnits}>
          <option value="Å³">Volume: Å³</option>
          <option value="nm³">Volume: nm³</option>
          <option value="mL">Volume: mL</option>
          <option value="L">Volume: L</option>
        </Select>

        <div class="space-y-1 rounded-md border p-2 dark:border-neutral-800">
          <p class="font-medium">Properties</p>
          {#if availableProperties.length === 0}
            <p class="text-neutral-600">Detect properties after adding log files.</p>
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
        class="flex w-full items-center justify-between font-semibold hover:text-neutral-200"
        onclick={() => (plotSettingsOpen = !plotSettingsOpen)}
      >
        <span>⚙ Plot Settings</span>
        <span class="text-neutral-500">{plotSettingsOpen ? '▲' : '▼'}</span>
      </button>

      {#if plotSettingsOpen}
        <div class="space-y-2 rounded-md border p-2 dark:border-neutral-800">
          <!-- Title -->
          <div>
            <p class="mb-0.5 text-neutral-500">Title</p>
            <Input bind:value={ps.title} placeholder={chartTitle || 'Auto'} className="w-full" />
          </div>

          <!-- X / Y labels -->
          <div class="grid grid-cols-2 gap-1">
            <div>
              <p class="mb-0.5 text-neutral-500">X label</p>
              <Input
                bind:value={ps.xLabel}
                placeholder={chartXLabel || 'Auto'}
                className="w-full"
              />
            </div>
            <div>
              <p class="mb-0.5 text-neutral-500">Y label</p>
              <Input
                bind:value={ps.yLabel}
                placeholder={chartYLabel || 'Auto'}
                className="w-full"
              />
            </div>
          </div>

          <!-- Units -->
          <div class="grid grid-cols-2 gap-1">
            <div>
              <p class="mb-0.5 text-neutral-500">X units</p>
              <Select bind:value={ps.xUnit} className="w-full">
                <option value="ns">ns</option>
                <option value="ps">ps</option>
                <option value="µs">µs</option>
              </Select>
            </div>
            {#if mode === 'structural'}
              <div>
                <p class="mb-0.5 text-neutral-500">Y units</p>
                <Select bind:value={sPlot.yUnit} className="w-full">
                  <option value="Å">Å</option>
                  <option value="nm">nm</option>
                </Select>
              </div>
            {/if}
          </div>

          <!-- Axis limits -->
          <div>
            <p class="mb-0.5 text-neutral-500">X min / max</p>
            <div class="flex gap-1">
              <Input type="number" bind:value={ps.xMin} placeholder="auto" className="w-full" />
              <Input type="number" bind:value={ps.xMax} placeholder="auto" className="w-full" />
            </div>
          </div>
          <div>
            <p class="mb-0.5 text-neutral-500">Y min / max</p>
            <div class="flex gap-1">
              <Input type="number" bind:value={ps.yMin} placeholder="auto" className="w-full" />
              <Input type="number" bind:value={ps.yMax} placeholder="auto" className="w-full" />
            </div>
          </div>

          <!-- Colors + transparency -->
          <div class="grid grid-cols-2 gap-1">
            <div>
              <p class="mb-0.5 text-neutral-500">Line color</p>
              <div class="flex items-center gap-1">
                <input
                  type="color"
                  bind:value={ps.lineColor}
                  class="h-7 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                />
                <Input bind:value={ps.lineColor} className="min-w-0 flex-1 font-mono" />
              </div>
            </div>
            <div>
              <p class="mb-0.5 text-neutral-500">Plot bg</p>
              <div class="flex items-center gap-1">
                <input
                  type="color"
                  bind:value={ps.plotBg}
                  class="h-7 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                />
                <Input bind:value={ps.plotBg} className="min-w-0 flex-1 font-mono" />
              </div>
            </div>
            <div>
              <p class="mb-0.5 text-neutral-500">Text/axes color</p>
              <div class="flex items-center gap-1">
                <input
                  type="color"
                  bind:value={ps.textColor}
                  class="h-7 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                />
                <Input bind:value={ps.textColor} className="min-w-0 flex-1 font-mono" />
              </div>
            </div>
            <div class="flex items-end pb-1">
              <label class="flex items-center gap-2">
                <Checkbox name="show-grid" bind:checked={ps.showGrid} />
                <span>Show grid</span>
              </label>
            </div>
          </div>

          <!-- Aspect ratio + transparent bg + DPI + font -->
          <div class="grid grid-cols-2 gap-1">
            <div>
              <p class="mb-0.5 text-neutral-500">Aspect ratio (W/H)</p>
              <Input
                type="number"
                min="0.5"
                max="10"
                step="0.1"
                bind:value={ps.aspectRatio}
                className="w-full"
              />
            </div>
            <div>
              <p class="mb-0.5 text-neutral-500">Export DPI</p>
              <Select bind:value={ps.dpi} className="w-full">
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
                <span>Transparent bg</span>
              </label>
            </div>
            <div>
              <p class="mb-0.5 text-neutral-500">Font</p>
              <Select bind:value={ps.fontFamily} className="w-full">
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

          <!-- Actions -->
          <div class="flex gap-1 pt-1">
            <Button
              size="sm"
              variant="ghost"
              className="flex-1"
              onclick={() => {
                mode === 'structural'
                  ? (sPlot = { ...structDefaults })
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
  <section class="flex min-h-0 min-w-0 flex-1 flex-col p-4">
    <div class="mb-2">
      <h1 class="text-lg font-semibold">{displayTitle || 'Analysis'}</h1>
      <p class="text-xs text-neutral-500">
        {mode === 'structural'
          ? 'RMSD, RMSF, Distance and Radius of Gyration from trajectories.'
          : 'NAMD energetic properties from ENERGY log records.'}
      </p>
    </div>

    {#if lastError}
      <div class="mb-3 rounded-md border border-red-700/50 bg-red-950/30 p-2 text-xs text-red-300">
        {lastError}
      </div>
    {/if}

    {#if displaySeries.length === 0}
      <div class="flex min-h-0 flex-1 items-center justify-center">
        <Empty message="Run an analysis to see results" />
      </div>
    {:else}
      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
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
          xMinOverride={xMinO}
          xMaxOverride={xMaxO}
          yMinOverride={yMinO}
          yMaxOverride={yMaxO}
          bind:svgEl
        />

        {#if primaryStats}
          <div class="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
            <div class="rounded-md border p-2 dark:border-neutral-800">
              <p class="text-neutral-500">Mean</p>
              <p class="font-semibold">{Number(primaryStats.mean).toFixed(4)}</p>
            </div>
            <div class="rounded-md border p-2 dark:border-neutral-800">
              <p class="text-neutral-500">Std</p>
              <p class="font-semibold">{Number(primaryStats.std).toFixed(4)}</p>
            </div>
            <div class="rounded-md border p-2 dark:border-neutral-800">
              <p class="text-neutral-500">Min</p>
              <p class="font-semibold">{Number(primaryStats.min).toFixed(4)}</p>
            </div>
            <div class="rounded-md border p-2 dark:border-neutral-800">
              <p class="text-neutral-500">Max</p>
              <p class="font-semibold">{Number(primaryStats.max).toFixed(4)}</p>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </section>
</div>
