<script>
  import Button from '../components/ui/Button.svelte'
  import Checkbox from '../components/ui/Checkbox.svelte'
  import Divider from '../components/ui/Divider.svelte'
  import Spinner from '../components/ui/Spinner.svelte'
  import FollowLog from '../components/FollowLog.svelte'
  import { builderStatus, logEvent } from '../lib/pageStatus.svelte.js'
  import {
    getAvailableLipids,
    getAvailableForceFields,
    validateBuilder,
    generatePreparation,
    runPreparation,
    detectLigands,
    parametrizeLigand,
    getLigandImage,
    checkLigandParametrization,
    getJobStatus,
    getJobLog,
    scanJobs,
    getProteinHydrogenStatus
  } from '../lib/backendApi'
  import {
    defaultBuildFolderName,
    outputFolderPath
  } from '../lib/outputFolders.js'
  import { themeState } from '../lib/theme.svelte.js'
  import { themeBackgroundHex } from '../lib/viewerSettings.svelte.js'

  /** @type {{ workingDir?: string }} */
  let { workingDir = '' } = $props()

  const paneBackgroundStyle = $derived(
    `background-color: ${themeBackgroundHex(themeState.current)}`
  )

  let workingFile = $state('')
  let outputFolderName = $state('')

  function resolveOutputFolderName() {
    if (outputFolderName.trim()) return outputFolderName.trim()
    return defaultBuildFolderName(workingFile)
  }

  function syncOutputFolderName() {
    const resolved = resolveOutputFolderName()
    if (resolved && resolved !== outputFolderName.trim()) {
      outputFolderName = resolved
    }
    return resolved
  }

  const outputDir = $derived(outputFolderPath(workingDir, resolveOutputFolderName()))

  const lipidsPromise = getAvailableLipids().then((data) => data.lipids)
  const ffPromise = getAvailableForceFields()

  let waterModel = $state('opc')
  let mdEngine = $state('namd')
  let proteinFf = $state('ff19SB')
  let lipidFf = $state('lipid21')

  let preoriented = $state(true)
  let parametrize = $state(true)
  /** Skip packmol-memgen re-protonation; keep PropKa residue names (default on). */
  let notProtonate = $state(true)
  /** Strip protein H before packmol-memgen (keeps ligand / hetero H). Default off. */
  let removeProteinH = $state(false)
  let proteinHCount = $state(0)
  let nloop = $state(20)
  let nloopAll = $state(100)
  let tolerance = $state(2.0)
  let advancedOpen = $state(false)
  let addSalt = $state(true)
  let saltConcentration = $state(0.15)
  let cation = $state('K+')
  let anion = $state('Cl-')
  let dist = $state(12)
  let distWat = $state(26)
  let boxSizingMode = $state('water_layer')
  let boxDimX = $state(100)
  let boxDimY = $state(100)
  let boxDimZ = $state(100)

  /**
   * @typedef {{
   *   name: string,
   *   charge: number,
   *   multiplicity: number,
   *   status: string,
   *   frcmod: string,
   *   lib: string,
   *   mol2: string,
   *   pdb_lines: string[],
   *   imageView: 'initial' | 'final',
   *   initialImageBase64: string,
   *   finalImageBase64: string,
   *   imageLoading: boolean
   * }} LigandRow
   */
  /** @type {LigandRow[]} */
  let ligands = $state([])
  let detectingLigands = $state(false)

  // ── Jobs ──
  /**
   * @typedef {{ jobDir: string, name: string, status: string, currentStep: number, steps: string[], stepsCompleted: string[], error: string|null, startTime: string, endTime: string|null, elapsed: string, logLines: string[], showLog: boolean }} Job
   */
  /** @type {Job[]} */
  let jobs = $state([])
  let launching = $state(false)
  let generatingInputFiles = $state(false)
  let validating = $state(false)
  /** @type {{ valid: boolean, warning: boolean, message: string } | null} */
  let validationResult = $state(null)

  /** Ref to the poll interval so we can clear it */
  let pollIntervalId = $state(null)

  const canGenerateInput = $derived(
    workingDir !== '' &&
      workingFile !== '' &&
      validationResult?.valid === true &&
      !generatingInputFiles &&
      !launching
  )
  const pendingJob = $derived(jobs.find((j) => j.status === 'not_started'))
  const hasGeneratedInputFiles = $derived(
    jobs.some((j) =>
      ['not_started', 'running', 'completed', 'error'].includes(j.status)
    )
  )
  const canStartPreparation = $derived(
    workingDir !== '' &&
      pendingJob !== undefined &&
      !launching &&
      !generatingInputFiles
  )

  // ── Sync to shared status bar store ──
  $effect(() => {
    builderStatus.jobCount = jobs.length
    builderStatus.runningCount = jobs.filter((j) => j.status === 'running').length
    builderStatus.completedCount = jobs.filter((j) => j.status === 'completed').length
    builderStatus.errorCount = jobs.filter((j) => j.status === 'error').length
    builderStatus.generatingInput = generatingInputFiles
    const latest = jobs[0]
    builderStatus.latestName = latest?.name ?? ''
    builderStatus.latestStatus = latest?.status ?? ''
    builderStatus.latestElapsed = latest?.elapsed ?? ''
  })

  // When workingDir changes from App, scan for existing preparation jobs
  $effect(() => {
    if (workingDir && workingFile && !outputFolderName.trim()) {
      outputFolderName = defaultBuildFolderName(workingFile)
    }
  })

  $effect(() => {
    if (!workingDir) return
    scanJobs(workingDir)
      .then(({ jobs: found }) => {
        const existing = new Set(jobs.map((j) => j.jobDir))
        const newJobs = found
          .filter((j) => !existing.has(j.job_dir))
          .map((j) => ({
            jobDir: j.job_dir,
            name: j.name,
            status: j.status || 'unknown',
            currentStep: j.current_step || 0,
            steps:
              j.steps?.length > 0
                ? j.steps
                : j.steps_completed?.length > 0
                  ? j.steps_completed
                  : ['Packmol'],
            stepsCompleted: j.steps_completed || [],
            error: j.error || null,
            startTime: j.start_time || '',
            endTime: j.end_time || null,
            elapsed: formatElapsed(j.start_time, j.end_time),
            logLines: [],
            showLog: false
          }))
        if (newJobs.length > 0) {
          jobs = [...newJobs, ...jobs].sort(
            (a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0)
          )
          if (newJobs.some((j) => j.status === 'running')) startPolling()
        }
      })
      .catch(() => {})
  })

  function startPolling() {
    if (pollIntervalId) return
    pollIntervalId = setInterval(pollAllJobs, 4000)
  }

  function stopPollingIfDone() {
    if (jobs.every((j) => j.status !== 'running')) {
      if (pollIntervalId) {
        clearInterval(pollIntervalId)
        pollIntervalId = null
      }
    }
  }

  /** Format elapsed seconds to human string */
  function formatElapsed(startIso, endIso) {
    if (!startIso) return ''
    const start = new Date(startIso).getTime()
    const end = endIso ? new Date(endIso).getTime() : Date.now()
    const s = Math.max(0, Math.round((end - start) / 1000))
    const m = Math.floor(s / 60)
    const h = Math.floor(m / 60)
    if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`
    if (m > 0) return `${m}m ${s % 60}s`
    return `${s}s`
  }

  async function pollAllJobs() {
    for (let i = 0; i < jobs.length; i++) {
      if (jobs[i].status !== 'running') continue
      try {
        const st = await getJobStatus(jobs[i].jobDir)
        const prevStatus = jobs[i].status
        jobs[i] = {
          ...jobs[i],
          status: st.status || 'running',
          currentStep: st.current_step ?? jobs[i].currentStep,
          stepsCompleted: st.steps_completed || [],
          error: st.error || null,
          startTime: st.start_time || jobs[i].startTime,
          endTime: st.end_time || null,
          elapsed: formatElapsed(st.start_time || jobs[i].startTime, st.end_time || null)
        }
        // Log terminal transitions from running
        const newStatus = st.status || 'running'
        if (prevStatus === 'running' && newStatus !== 'running') {
          if (newStatus === 'completed') {
            logEvent(
              'info',
              'build',
              `Job completed: ${jobs[i].name}`,
              `Elapsed: ${jobs[i].elapsed}`
            )
          } else {
            logEvent('info', 'build', `Job ${newStatus}: ${jobs[i].name}`, st.error || '')
          }
        }
        // Also refresh log if visible
        if (jobs[i].showLog) {
          await refreshJobLog(i)
        }
      } catch {
        // Backend unreachable — skip this cycle
      }
    }
    // Update elapsed for running jobs (even between polls)
    for (let i = 0; i < jobs.length; i++) {
      if (jobs[i].status === 'running') {
        jobs[i] = {
          ...jobs[i],
          elapsed: formatElapsed(jobs[i].startTime, null)
        }
      }
    }
    stopPollingIfDone()
  }

  async function refreshJobLog(/** @type {number} */ index) {
    try {
      const { lines } = await getJobLog(jobs[index].jobDir)
      jobs[index] = { ...jobs[index], logLines: lines }
    } catch {
      // ignore
    }
  }

  async function toggleJobLog(/** @type {number} */ index) {
    const show = !jobs[index].showLog
    jobs[index] = { ...jobs[index], showLog: show }
    if (show) await refreshJobLog(index)
  }

  /** Resolve Builder output folder for ligand_params/; sync the left-panel name if needed. */
  function requireBuilderOutputDir() {
    if (!workingDir) {
      throw new Error('Set a Working Directory in the top bar before parametrizing ligands.')
    }
    const folder = syncOutputFolderName()
    const dir = outputFolderPath(workingDir, folder)
    if (!dir) {
      throw new Error('Could not resolve the Builder output folder for ligand parametrization.')
    }
    return dir
  }

  /**
   * Load/cached 2D image for the active view (initial = PDB lines, final = mol2).
   * @param {number} index
   * @param {'initial' | 'final'} [view]
   */
  async function loadLigandImage(index, view) {
    const lig = ligands[index]
    if (!lig) return
    const targetView = view ?? lig.imageView ?? (lig.mol2 ? 'final' : 'initial')
    if (targetView === 'final' && !lig.mol2) return
    if (targetView === 'initial' && !(lig.pdb_lines?.length > 0)) return

    const cached =
      targetView === 'final' ? lig.finalImageBase64 : lig.initialImageBase64
    if (cached) {
      if (lig.imageView !== targetView) {
        ligands[index] = { ...ligands[index], imageView: targetView }
      }
      return
    }

    ligands[index] = { ...ligands[index], imageView: targetView, imageLoading: true }
    try {
      /** @type {{ pdbLines?: string[], mol2Path?: string }} */
      const opts =
        targetView === 'final' ? { mol2Path: lig.mol2 } : { pdbLines: lig.pdb_lines }
      const { image } = await getLigandImage(opts)
      const next = { ...ligands[index], imageView: targetView, imageLoading: false }
      if (targetView === 'final') next.finalImageBase64 = image
      else next.initialImageBase64 = image
      ligands[index] = next
    } catch (error) {
      ligands[index] = { ...ligands[index], imageLoading: false }
      console.error(`Ligand 2D image (${targetView}) failed for ${lig.name}:`, error)
    }
  }

  /**
   * @param {number} index
   * @param {'initial' | 'final'} view
   */
  async function setLigandImageView(index, view) {
    const lig = ligands[index]
    if (!lig || lig.imageView === view) return
    if (view === 'final' && !lig.mol2) return
    await loadLigandImage(index, view)
  }

  async function onDetectLigands() {
    if (!workingFile) return
    try {
      detectingLigands = true
      const data = await detectLigands(workingFile)
      ligands = data.ligands.map((l) => ({
        name: l.name,
        charge: 0,
        multiplicity: 1,
        status: 'not_parametrized',
        frcmod: '',
        lib: '',
        mol2: '',
        pdb_lines: l.pdb_lines || [],
        imageView: /** @type {'initial' | 'final'} */ ('initial'),
        initialImageBase64: '',
        finalImageBase64: '',
        imageLoading: false
      }))

      // Check if any ligands were already parametrized in a previous run
      const names = ligands.map((l) => l.name)
      logEvent(
        'detail',
        'build',
        `Detected ligands`,
        `${ligands.length} ligand(s): ${names.join(', ') || '—'}`
      )
      if (names.length > 0) {
        let outputDirForCache = ''
        try {
          if (workingDir) outputDirForCache = requireBuilderOutputDir()
        } catch {
          // Cache check can still fall back to the PDB directory on the backend
        }
        const { parametrized } = await checkLigandParametrization(
          workingFile,
          names,
          outputDirForCache || null
        )
        for (let i = 0; i < ligands.length; i++) {
          const cached = parametrized[ligands[i].name]
          if (cached) {
            ligands[i] = {
              ...ligands[i],
              status: 'completed',
              frcmod: cached.frcmod,
              lib: cached.lib,
              mol2: cached.mol2 || '',
              imageView: cached.mol2 ? 'final' : 'initial'
            }
          }
        }
      }

      // Load images for all detected ligands (in parallel)
      await Promise.all(ligands.map((lig, i) => loadLigandImage(i, lig.imageView)))
    } catch (error) {
      // Show error in the first job or as a standalone message
      console.error('Ligand detection error:', error)
    } finally {
      detectingLigands = false
    }
  }

  async function onParametrizeLigand(/** @type {number} */ index) {
    const lig = ligands[index]
    try {
      const builderOut = requireBuilderOutputDir()
      ligands[index] = { ...lig, status: 'running' }
      const result = await parametrizeLigand(
        workingFile,
        lig.name,
        lig.charge,
        lig.multiplicity,
        builderOut
      )
      ligands[index] = {
        ...lig,
        status: 'completed',
        frcmod: result.frcmod || '',
        lib: result.lib || '',
        mol2: result.mol2 || '',
        imageView: 'final',
        finalImageBase64: '', // force reload from new mol2
        imageLoading: false
      }
      logEvent(
        'detail',
        'build',
        `Parametrized ligand: ${lig.name}`,
        `Output: ${builderOut}/ligand_params/${lig.name}`
      )
      await loadLigandImage(index, 'final')
    } catch (error) {
      ligands[index] = { ...lig, status: 'failed' }
      console.error(`Parametrization of ${lig.name} failed:`, error)
      alert(error instanceof Error ? error.message : String(error))
    }
  }

  async function onBrowseFrcmod(/** @type {number} */ index) {
    const result = await window.api.openLigandFileDialog(
      'Select frcmod file',
      ['frcmod'],
      workingDir || undefined
    )
    if (!result.canceled) {
      ligands[index] = { ...ligands[index], frcmod: result.filePath }
    }
  }

  async function onBrowseLib(/** @type {number} */ index) {
    const result = await window.api.openLigandFileDialog(
      'Select lib file',
      ['lib'],
      workingDir || undefined
    )
    if (!result.canceled) {
      ligands[index] = { ...ligands[index], lib: result.filePath }
    }
  }

  function removeLigand(/** @type {number} */ index) {
    ligands = ligands.filter((_, i) => i !== index)
  }

  function addManualLigand() {
    ligands = [
      ...ligands,
      {
        name: '',
        charge: 0,
        multiplicity: 1,
        status: 'manual',
        frcmod: '',
        lib: '',
        mol2: '',
        pdb_lines: [],
        imageView: 'initial',
        initialImageBase64: '',
        finalImageBase64: '',
        imageLoading: false
      }
    ]
  }

  function buildParams() {
    syncOutputFolderName()
    const upperLipids = upperLeaflet.map((e) => e.lipid)
    const lowerLipids = lowerLeaflet.map((e) => e.lipid)
    const upperRatios = upperLeaflet.map((e) => e.ratio).join(':')
    const lowerRatios = lowerLeaflet.map((e) => e.ratio).join(':')
    const lipidRatios = `${upperRatios}//${lowerRatios}`
    return {
      path: workingFile,
      upperLipids,
      lowerLipids,
      lipidRatios,
      waterModel,
      mdEngine: ['opc', 'tip4pd', 'tip4pew'].includes(String(waterModel).toLowerCase())
        ? mdEngine || null
        : null,
      proteinFf,
      lipidFf,
      preoriented,
      parametrize,
      notProtonate,
      removeProteinH,
      nloop: parseInt(String(nloop), 10),
      nloopAll: parseInt(String(nloopAll), 10),
      tolerance: parseFloat(String(tolerance)),
      addSalt,
      saltConcentration: addSalt ? parseFloat(saltConcentration) : 0,
      cation,
      anion,
      dist: parseFloat(dist),
      distWat: parseFloat(distWat),
      dims:
        boxSizingMode === 'explicit'
          ? [parseFloat(boxDimX), parseFloat(boxDimY), parseFloat(boxDimZ)]
          : null,
      outputFolderName: outputFolderName.trim() || null,
      workingDir: workingDir || null,
      ligandParams: ligands
        .filter((l) => l.frcmod && l.lib && l.name)
        .map((l) => ({ name: l.name, frcmod: l.frcmod, lib: l.lib }))
    }
  }

  async function onValidate() {
    if (!workingFile) {
      validationResult = {
        valid: false,
        warning: false,
        message: 'Please select a working PDB file first.'
      }
      return
    }
    if (!upperLeaflet.length && !lowerLeaflet.length) {
      validationResult = {
        valid: false,
        warning: false,
        message: 'Please add at least one lipid to a leaflet.'
      }
      return
    }
    try {
      validating = true
      validationResult = null
      const params = buildParams()
      const result = await validateBuilder(params)
      if (typeof result.protein_hydrogen_count === 'number') {
        proteinHCount = result.protein_hydrogen_count
      }
      validationResult = {
        valid: result.valid,
        warning: result.warning ?? false,
        message: result.message ?? result.error ?? ''
      }
      logEvent(
        'detail',
        'build',
        `Configuration ${result.valid ? 'valid' : result.warning ? 'warning' : 'invalid'}`,
        validationResult.message
      )
    } catch (error) {
      validationResult = {
        valid: false,
        warning: false,
        message: error instanceof Error ? error.message : String(error)
      }
    } finally {
      validating = false
    }
  }

  function buildJobSteps() {
    return parametrize
      ? preoriented
        ? ['Packmol', 'pdb4amber', 'tleap']
        : ['MEMEMBED', 'Packmol', 'pdb4amber', 'tleap']
      : preoriented
        ? ['Packmol']
        : ['MEMEMBED', 'Packmol']
  }

  async function onGenerateInput() {
    if (!workingFile) return
    try {
      generatingInputFiles = true
      const params = buildParams()
      const result = await generatePreparation(params)
      if (result.success && result.job_dir) {
        const dirName = result.job_dir.split(/[/\\]/).pop() || result.job_dir
        outputFolderName = dirName
        /** @type {Job} */
        const newJob = {
          jobDir: result.job_dir,
          name: dirName,
          status: 'not_started',
          currentStep: 0,
          steps: buildJobSteps(),
          stepsCompleted: [],
          error: null,
          startTime: '',
          endTime: null,
          elapsed: '',
          logLines: [],
          showLog: false
        }
        jobs = [newJob, ...jobs]
        logEvent(
          'info',
          'build',
          `Generated input: "${newJob.name}"`,
          result.job_dir
        )
      } else {
        alert(`Failed: ${result.message}`)
      }
    } catch (error) {
      alert(`Error: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      generatingInputFiles = false
    }
  }

  async function onStartPreparation() {
    const job = pendingJob
    if (!job) return
    try {
      launching = true
      const result = await runPreparation(job.jobDir)
      if (result.success) {
        const index = jobs.findIndex((j) => j.jobDir === job.jobDir)
        if (index >= 0) {
          jobs[index] = {
            ...jobs[index],
            status: 'running',
            startTime: new Date().toISOString(),
            elapsed: '0s'
          }
        }
        startPolling()
        logEvent(
          'info',
          'build',
          `Started job: ${job.name}`,
          `Steps: ${job.steps.join(' → ')}`
        )
      } else {
        alert(`Failed: ${result.message}`)
      }
    } catch (error) {
      alert(`Error: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      launching = false
    }
  }

  function removeJob(/** @type {number} */ index) {
    jobs = jobs.filter((_, i) => i !== index)
    stopPollingIfDone()
  }

  function onLoadDefaults() {
    waterModel = 'opc'
    mdEngine = 'namd'
    proteinFf = 'ff19SB'
    lipidFf = 'lipid21'
    preoriented = true
    parametrize = true
    notProtonate = true
    removeProteinH = false
    proteinHCount = 0
    nloop = 20
    nloopAll = 100
    tolerance = 2.0
    addSalt = true
    saltConcentration = 0.15
    cation = 'K+'
    anion = 'Cl-'
    dist = 12
    distWat = 26
    boxSizingMode = 'water_layer'
    boxDimX = 100
    boxDimY = 100
    boxDimZ = 100
    upperLeaflet = [{ lipid: 'POPC', ratio: 1.0 }]
    lowerLeaflet = [{ lipid: 'POPC', ratio: 1.0 }]
    outputFolderName = ''
    ligands = []
  }

  /** Clear tab state (input, jobs, ligands) and restore form defaults. */
  function onClear() {
    if (pollIntervalId) {
      clearInterval(pollIntervalId)
      pollIntervalId = null
    }
    workingFile = ''
    outputFolderName = ''
    jobs = []
    ligands = []
    validationResult = null
    launching = false
    generatingInputFiles = false
    validating = false
    advancedOpen = false
    onLoadDefaults()
    builderStatus.jobCount = 0
    builderStatus.runningCount = 0
    builderStatus.completedCount = 0
    builderStatus.errorCount = 0
    builderStatus.latestName = ''
    builderStatus.latestStatus = ''
    builderStatus.latestElapsed = ''
    builderStatus.generatingInput = false
  }

  /** @type {{ lipid: string, ratio: number }[]} */
  let upperLeaflet = $state([{ lipid: 'POPC', ratio: 1.0 }])
  /** @type {{ lipid: string, ratio: number }[]} */
  let lowerLeaflet = $state([{ lipid: 'POPC', ratio: 1.0 }])

  function addLipid(/** @type {'upper' | 'lower'} */ leaflet) {
    const entry = { lipid: 'POPC', ratio: 1.0 }
    if (leaflet === 'upper') upperLeaflet = [...upperLeaflet, entry]
    else lowerLeaflet = [...lowerLeaflet, entry]
  }

  function removeLipid(/** @type {'upper' | 'lower'} */ leaflet, /** @type {number} */ index) {
    if (leaflet === 'upper') upperLeaflet = upperLeaflet.filter((_, i) => i !== index)
    else lowerLeaflet = lowerLeaflet.filter((_, i) => i !== index)
  }

  async function refreshProteinHydrogenStatus(filePath) {
    if (!filePath) {
      proteinHCount = 0
      return
    }
    try {
      const status = await getProteinHydrogenStatus(filePath)
      proteinHCount = status.count ?? 0
    } catch {
      proteinHCount = 0
    }
  }

  function openAdvancedRemoveProteinH() {
    advancedOpen = true
    requestAnimationFrame(() => {
      document.getElementById('remove-protein-h-option')?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      })
    })
  }

  const showProteinHWarning = $derived(proteinHCount > 0 && !removeProteinH)

  async function onBrowse() {
    const result = await window.api.openPdbDialog(workingDir || undefined)
    if (!result.canceled) {
      workingFile = result.filePath
      outputFolderName = defaultBuildFolderName(result.filePath)
      await refreshProteinHydrogenStatus(result.filePath)
    }
  }
</script>

<div class="flex min-w-0 flex-1 divide-x divide-neutral-200 overflow-hidden select-none dark:divide-neutral-800">
  <!-- ── Left: Options (scrollable) ── -->
  <aside class="w-80 shrink-0 space-y-4 overflow-x-clip overflow-y-auto p-4 text-xs">
    <!-- Input -->
    <div class="space-y-2">
      <h2 class="sidebar-heading">Input</h2>
      <div class="space-y-1">
        <span class="sidebar-label">PDB File</span>
        <div class="flex items-center gap-1">
          <input
            type="text"
            placeholder="Select PDB file..."
            class="sidebar-control flex-1 p-2"
            bind:value={workingFile}
            readonly
          />
          <Button variant="default" className="shrink-0 text-xs px-2 py-1.5" onclick={onBrowse}
            >Browse</Button
          >
        </div>
        {#if showProteinHWarning}
          <div class="gw-notice gw-notice-warning text-[11px] leading-snug">
            <p>
              Protein has {proteinHCount} hydrogen atom{proteinHCount === 1 ? '' : 's'}. Non-Amber H
              (e.g. from Schrödinger) can break tleap after packmol-memgen.
            </p>
            <button
              type="button"
              class="mt-1 font-medium text-neutral-900 underline underline-offset-2 hover:text-yellow-700 dark:text-neutral-100 dark:hover:text-yellow-400"
              onclick={openAdvancedRemoveProteinH}
            >
              Open Advanced settings → Remove protein hydrogens
            </button>
          </div>
        {/if}
      </div>
      <div class="space-y-1">
        <span class="sidebar-label">Output folder</span>
        <input
          type="text"
          placeholder="02_build_structure"
          class="sidebar-control w-full p-2"
          bind:value={outputFolderName}
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
    <Divider />

    <!-- Ligand Parametrization (must run before packmol-memgen) -->
    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <h2 class="sidebar-heading">Ligand Parametrization</h2>
        <div class="flex gap-1">
          <Button
            variant="outline"
            className="text-xs px-1.5 py-0.5"
            onclick={onDetectLigands}
            disabled={!workingFile || detectingLigands}
          >
            {detectingLigands ? 'Detecting...' : 'Detect'}
          </Button>
          <button
            class="dark:text-neutral-500 dark:hover:text-neutral-300"
            onclick={addManualLigand}>+ Manual</button
          >
        </div>
      </div>
      {#if ligands.length === 0}
        <p class="sidebar-hint">
          No ligands. Click "Detect" after selecting a PDB, or add manually.
        </p>
      {/if}
      {#each ligands as lig, i (i)}
        <div class="sidebar-panel space-y-1.5 p-2">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1.5">
              {#if lig.status === 'manual'}
                <input
                  type="text"
                  placeholder="LIG"
                  class="sidebar-control w-14 p-1"
                  bind:value={lig.name}
                />
              {:else}
                <span class="sidebar-subheading">{lig.name}</span>
              {/if}
              <span
                class="rounded px-1 py-0.5"
                class:bg-neutral-700={lig.status === 'not_parametrized' || lig.status === 'manual'}
                class:bg-yellow-800={lig.status === 'running'}
                class:bg-green-800={lig.status === 'completed'}
                class:bg-red-800={lig.status === 'failed'}
              >
                {lig.status === 'not_parametrized'
                  ? 'Pending'
                  : lig.status === 'running'
                    ? 'Running...'
                    : lig.status === 'completed'
                      ? 'Done'
                      : lig.status === 'failed'
                        ? 'Failed'
                        : 'Manual'}
              </span>
            </div>
            <button
              class="dark:text-neutral-500 dark:hover:text-neutral-300"
              onclick={() => removeLigand(i)}>&times;</button
            >
          </div>
          <div class="flex items-center gap-2">
            <span class="sidebar-label">Charge</span>
            <input
              type="number"
              class="sidebar-control w-12 p-1"
              bind:value={lig.charge}
            />
            <span class="sidebar-label">Mult.</span>
            <input
              type="number"
              class="sidebar-control w-12 p-1"
              bind:value={lig.multiplicity}
            />
          </div>
          <div class="flex items-center gap-1">
            <span class="sidebar-label w-12 shrink-0">frcmod</span>
            <input
              type="text"
              class="sidebar-control flex-1 p-1"
              bind:value={lig.frcmod}
              readonly
              placeholder="Auto or browse..."
            />
            <button
              class="dark:text-neutral-500 dark:hover:text-neutral-300"
              onclick={() => onBrowseFrcmod(i)}>Browse</button
            >
          </div>
          <div class="flex items-center gap-1">
            <span class="sidebar-label w-12 shrink-0">lib</span>
            <input
              type="text"
              class="sidebar-control flex-1 p-1"
              bind:value={lig.lib}
              readonly
              placeholder="Auto or browse..."
            />
            <button
              class="dark:text-neutral-500 dark:hover:text-neutral-300"
              onclick={() => onBrowseLib(i)}>Browse</button
            >
          </div>
          {#if lig.status !== 'running'}
            <Button
              variant="outline"
              className="w-full text-xs"
              onclick={() => onParametrizeLigand(i)}
              disabled={!workingFile || !workingDir || lig.status === 'running'}
            >
              {lig.status === 'completed'
                ? `Re-parametrize ${lig.name || 'ligand'}`
                : `Parametrize ${lig.name || 'ligand'}`}
            </Button>
          {/if}
        </div>
      {/each}
      {#if ligands.length > 0 && !workingDir}
        <p class="sidebar-hint">
          Set a working directory to write ligand_params under the Builder output folder.
        </p>
      {/if}
    </div>
    <Divider />

    <!-- Membrane & Force Fields -->
    <div class="space-y-2">
      <h2 class="sidebar-heading">Force Fields</h2>
      {#await ffPromise then ff}
        <div class="flex items-center gap-1">
          <span class="sidebar-label w-20 shrink-0">Water</span>
          <select
            class="sidebar-control flex-1 p-2"
            bind:value={waterModel}
          >
            {#each ff.water_models as wm (wm)}
              <option value={wm}>{wm}</option>
            {/each}
          </select>
        </div>
        {#if ['opc', 'tip4pd', 'tip4pew'].includes(String(waterModel).toLowerCase())}
          <div class="flex items-center gap-1">
            <span class="sidebar-label w-20 shrink-0">MD engine</span>
            <select
              class="sidebar-control flex-1 p-2"
              bind:value={mdEngine}
            >
              <option value="namd">namd</option>
              <option value="gromacs">gromacs</option>
              <option value="openmm">openmm</option>
            </select>
          </div>
          <p class="sidebar-hint">
            4-site water ({waterModel}) needs a target MD engine. Choose
            <strong>namd</strong> so tleap uses FlexibleWater (and equilibration can use
            waterModel tip4). For <strong>gromacs</strong> / <strong>openmm</strong>,
            parametrization stays the standard Amber path — same as other water models.
          </p>
          {#if mdEngine === 'namd'}
            <p class="sidebar-hint">
              NAMD selected: FlexibleWater will be applied in tleap for this water model.
            </p>
          {/if}
        {/if}
        <div class="flex items-center gap-1">
          <span class="sidebar-label w-20 shrink-0">Protein FF</span>
          <select
            class="sidebar-control flex-1 p-2"
            bind:value={proteinFf}
          >
            {#each ff.protein_ffs as pff (pff)}
              <option value={pff}>{pff}</option>
            {/each}
          </select>
        </div>
        <div class="flex items-center gap-1">
          <span class="sidebar-label w-20 shrink-0">Lipid FF</span>
          <select
            class="sidebar-control flex-1 p-2"
            bind:value={lipidFf}
          >
            {#each ff.lipid_ffs as lff (lff)}
              <option value={lff}>{lff}</option>
            {/each}
          </select>
        </div>
      {/await}
    </div>
    <Divider />

    <!-- Lipid Composition -->
    <div class="space-y-2">
      <h2 class="sidebar-heading">Lipid Composition</h2>
      <div class="sidebar-panel space-y-1.5 p-2">
        <div class="flex items-center justify-between">
          <span class="sidebar-subheading">Upper Leaflet</span>
          <button
            class="dark:text-neutral-500 dark:hover:text-neutral-300"
            onclick={() => addLipid('upper')}>+ Add</button
          >
        </div>
        {#each upperLeaflet as entry, i (i)}
          <div class="flex items-center gap-1">
            {#await lipidsPromise then lipids}
              <select
                class="sidebar-control flex-1 p-1"
                bind:value={entry.lipid}
              >
                {#each lipids as lipid (lipid)}
                  <option value={lipid}>{lipid}</option>
                {/each}
              </select>
            {/await}
            <input
              type="text"
              inputmode="decimal"
              class="sidebar-control w-10 p-1 text-center"
              bind:value={entry.ratio}
            />
            {#if upperLeaflet.length > 1}
              <button
                class="dark:text-neutral-500 dark:hover:text-neutral-300"
                onclick={() => removeLipid('upper', i)}>&times;</button
              >
            {/if}
          </div>
        {/each}
      </div>
      <div class="sidebar-panel space-y-1.5 p-2">
        <div class="flex items-center justify-between">
          <span class="sidebar-subheading">Lower Leaflet</span>
          <button
            class="dark:text-neutral-500 dark:hover:text-neutral-300"
            onclick={() => addLipid('lower')}>+ Add</button
          >
        </div>
        {#each lowerLeaflet as entry, i (i)}
          <div class="flex items-center gap-1">
            {#await lipidsPromise then lipids}
              <select
                class="sidebar-control flex-1 p-1"
                bind:value={entry.lipid}
              >
                {#each lipids as lipid (lipid)}
                  <option value={lipid}>{lipid}</option>
                {/each}
              </select>
            {/await}
            <input
              type="text"
              inputmode="decimal"
              class="sidebar-control w-10 p-1 text-center"
              bind:value={entry.ratio}
            />
            {#if lowerLeaflet.length > 1}
              <button
                class="dark:text-neutral-500 dark:hover:text-neutral-300"
                onclick={() => removeLipid('lower', i)}>&times;</button
              >
            {/if}
          </div>
        {/each}
      </div>
    </div>
    <Divider />

    <!-- System Options -->
    <div class="space-y-2">
      <h2 class="sidebar-heading">System Options</h2>
      <div class="flex items-center gap-2">
        <Checkbox name="preoriented" bind:checked={preoriented} />
        <span class="sidebar-label">Pre-oriented in membrane</span>
      </div>
      <div class="flex items-center gap-2">
        <Checkbox name="add-salt" bind:checked={addSalt} />
        <span class="sidebar-label">Add salt</span>
      </div>
      {#if addSalt}
        <div class="flex flex-wrap items-center gap-1 pl-6">
          <input
            type="text"
            inputmode="decimal"
            class="sidebar-control w-14 p-1"
            bind:value={saltConcentration}
          />
          <span class="sidebar-label">M</span>
          <select
            class="sidebar-control p-1"
            bind:value={cation}
          >
            <option value="K+">K+</option>
            <option value="Na+">Na+</option>
          </select>
          <select
            class="sidebar-control p-1"
            bind:value={anion}
          >
            <option value="Cl-">Cl-</option>
          </select>
        </div>
      {/if}
      <div class="flex items-center gap-2">
        <label class="sidebar-label flex items-center gap-1">
          <input type="radio" name="box-sizing" value="water_layer" bind:group={boxSizingMode} />
          Water layer
        </label>
        <label class="sidebar-label flex items-center gap-1">
          <input type="radio" name="box-sizing" value="explicit" bind:group={boxSizingMode} />
          Explicit dims
        </label>
      </div>
      {#if boxSizingMode === 'water_layer'}
        <div class="flex items-center gap-1 pl-6">
          <span class="sidebar-label" title="packmol-memgen --dist_wat">
            Water thickness
          </span>
          <input
            type="number"
            min="0"
            step="1"
            class="sidebar-control w-16 p-1"
            bind:value={distWat}
          />
          <span class="sidebar-label">Å</span>
        </div>
        <div class="flex items-center gap-1 pl-6">
          <span
            class="sidebar-label"
            title="packmol-memgen --dist: minimum distance between solute extents and box boundaries"
          >
            Boundary distance
          </span>
          <input
            type="number"
            min="0"
            step="1"
            class="sidebar-control w-16 p-1"
            bind:value={dist}
          />
          <span class="sidebar-label">Å</span>
        </div>
      {:else}
        <div class="flex items-center gap-1 pl-6">
          <span class="sidebar-label">X</span>
          <input
            type="text"
            inputmode="decimal"
            class="sidebar-control w-12 p-1"
            bind:value={boxDimX}
          />
          <span class="sidebar-label">Y</span>
          <input
            type="text"
            inputmode="decimal"
            class="sidebar-control w-12 p-1"
            bind:value={boxDimY}
          />
          <span class="sidebar-label">Z</span>
          <input
            type="text"
            inputmode="decimal"
            class="sidebar-control w-12 p-1"
            bind:value={boxDimZ}
          />
          <span class="sidebar-label">Å</span>
        </div>
      {/if}
    </div>
    <Divider />

    <!-- Advanced settings -->
    <details
      bind:open={advancedOpen}
      class="sidebar-panel group [&>summary::-webkit-details-marker]:hidden"
    >
      <summary
        class="sidebar-heading cursor-pointer list-none px-3 py-2 hover:text-neutral-700 dark:hover:text-neutral-100"
      >
        <span class="flex items-center justify-between gap-2">
          Advanced settings
          <span class="sidebar-hint font-normal group-open:rotate-180">▾</span>
        </span>
      </summary>
      <div class="space-y-3 border-t border-neutral-200 px-3 py-3 dark:border-neutral-800">
        <div class="flex items-center gap-2">
          <Checkbox name="parametrize" bind:checked={parametrize} />
          <span class="sidebar-label">Parametrize with tleap</span>
        </div>

        <div class="flex items-center gap-2">
          <Checkbox name="not-protonate" bind:checked={notProtonate} />
          <span
            class="sidebar-label"
            title="Recommended when the protein was prepared with PropKa first. Passes --notprotonate to packmol-memgen so residue names like GLH/ASH/HIP are kept. Without this, reduce may re-protonate and rename atoms (e.g. HA→HCA), which breaks tleap."
          >
            Skip protonation (preserve PropKa)
          </span>
        </div>

        <div id="remove-protein-h-option" class="flex items-center gap-2">
          <Checkbox name="remove-protein-h" bind:checked={removeProteinH} />
          <span
            class="sidebar-label"
            title="Strip hydrogens from protein residues only before packmol-memgen. Ligands and other heteroatoms keep their hydrogens. Use when the PDB has non-Amber H (e.g. Schrödinger) that would break tleap."
          >
            Remove protein hydrogens
          </span>
        </div>

        <div class="space-y-2">
          <h3 class="sidebar-group-heading">
            PACKMOL options
          </h3>
          <div class="space-y-2 pl-1">
            <label class="sidebar-label flex items-center justify-between gap-2">
              <span title="GENCAN loops for PACKMOL; increase to improve packing">--nloop</span>
              <input
                type="number"
                min="1"
                step="1"
                class="sidebar-control w-20 p-1 text-right"
                bind:value={nloop}
              />
            </label>
            <label class="sidebar-label flex items-center justify-between gap-2">
              <span title="GENCAN loops for all-together packing">--nloop_all</span>
              <input
                type="number"
                min="1"
                step="1"
                class="sidebar-control w-20 p-1 text-right"
                bind:value={nloopAll}
              />
            </label>
            <label class="sidebar-label flex items-center justify-between gap-2">
              <span title="Clash tolerance (radius1 + radius2)">--tolerance</span>
              <input
                type="number"
                min="0"
                step="0.1"
                class="sidebar-control w-20 p-1 text-right"
                bind:value={tolerance}
              />
            </label>
          </div>
        </div>
      </div>
    </details>
    <Divider />

    <!-- Actions -->
    <div class="space-y-2">
      <Button
        className="w-full"
        variant="outline"
        onclick={onValidate}
        disabled={validating || launching || generatingInputFiles}
      >
        {validating ? 'Validating…' : 'Validate Inputs'}
      </Button>
      {#if validationResult !== null}
        <div
          class="gw-notice {validationResult.valid
            ? validationResult.warning
              ? 'gw-notice-warning'
              : 'gw-notice-success'
            : 'gw-notice-error'}"
        >
          {#if validationResult.valid && !validationResult.warning}
            <p>✓ All inputs are valid.</p>
            {#if pendingJob}
              <p class="mt-1">Click <strong>Start Preparation</strong> to proceed.</p>
            {/if}
          {:else}
            <p class="whitespace-pre-wrap">{validationResult.message}</p>
            {#if validationResult.warning && showProteinHWarning}
              <button
                type="button"
                class="mt-2 font-medium text-neutral-900 underline underline-offset-2 hover:text-yellow-700 dark:text-neutral-100 dark:hover:text-yellow-400"
                onclick={openAdvancedRemoveProteinH}
              >
                Open Advanced settings → Remove protein hydrogens
              </button>
            {/if}
          {/if}
        </div>
      {/if}
      <div role="group" aria-label="Generate preparation input files action">
        <Button
          className="w-full"
          variant="outline"
          onclick={onGenerateInput}
          disabled={!canGenerateInput}
        >
          {#if generatingInputFiles}
            <Spinner className="mr-1" />
            Generating...
          {:else}
            Generate Input Files
          {/if}
        </Button>
      </div>
      <div role="group" aria-label="Run preparation action">
        <Button className="w-full" onclick={onStartPreparation} disabled={!canStartPreparation}>
          {#if launching}
            <Spinner className="mr-1" />
            Launching...
          {:else}
            Start Preparation
          {/if}
        </Button>
      </div>
      {#if validationResult === null && workingFile}
        <p class="gw-notice gw-notice-warning">
          Inputs have not been validated. Click <strong>Validate Inputs</strong> before generating.
        </p>
      {/if}
      {#if validationResult?.valid && !hasGeneratedInputFiles}
        <p class="gw-notice gw-notice-warning">
          Input files have not been generated yet. Click <strong>Generate Input Files</strong> first.
        </p>
      {/if}
      {#if workingDir === '' && workingFile}
        <p class="gw-notice gw-notice-warning">
          Set a <strong>Working Directory</strong> in the top bar to generate output folders.
        </p>
      {/if}
      <Button className="w-full" variant="ghost" onclick={onClear}>Clear</Button>
      <button
        class="w-full text-center dark:text-neutral-500 dark:hover:text-neutral-300"
        onclick={onLoadDefaults}>Reset Defaults</button
      >
    </div>
  </aside>

  <!-- ── Right: Ligand Preview & Job Tracker ── -->
  <div
    class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    style={paneBackgroundStyle}
  >
    <!-- Ligand 2D images -->
    {#if ligands.some((l) => l.initialImageBase64 || l.finalImageBase64 || l.imageLoading)}
      <div class="mx-4 mt-4 shrink-0">
        <h2 class="mb-2 text-xs font-semibold dark:text-neutral-400">Ligand Structures</h2>
        <div class="flex flex-wrap gap-3">
          {#each ligands as lig, i (lig.name)}
            {@const shown =
              lig.imageView === 'final' ? lig.finalImageBase64 : lig.initialImageBase64}
            {#if shown || lig.imageLoading || lig.pdb_lines?.length}
              <div class="sidebar-panel space-y-1 p-2">
                <div class="flex items-center gap-1.5 text-xs">
                  <span class="sidebar-subheading">{lig.name}</span>
                  <div class="inline-flex overflow-hidden rounded border border-neutral-600">
                    <button
                      type="button"
                      class="px-1.5 py-0.5 text-xs"
                      class:bg-neutral-700={lig.imageView === 'initial'}
                      class:text-white={lig.imageView === 'initial'}
                      class:dark:text-neutral-400={lig.imageView !== 'initial'}
                      disabled={!(lig.pdb_lines?.length > 0) || lig.imageLoading}
                      onclick={() => setLigandImageView(i, 'initial')}
                    >
                      Initial
                    </button>
                    <button
                      type="button"
                      class="border-l border-neutral-600 px-1.5 py-0.5 text-xs"
                      class:bg-green-800={lig.imageView === 'final'}
                      class:text-white={lig.imageView === 'final'}
                      class:dark:text-neutral-400={lig.imageView !== 'final'}
                      disabled={!lig.mol2 || lig.imageLoading}
                      title={lig.mol2 ? 'Show parametrized mol2 2D' : 'Parametrize first'}
                      onclick={() => setLigandImageView(i, 'final')}
                    >
                      Final
                    </button>
                  </div>
                </div>
                {#if shown}
                  <img
                    src="data:image/png;base64,{shown}"
                    alt="2D structure of {lig.name} ({lig.imageView})"
                    class="rounded"
                    style="max-width: 300px; max-height: 240px;"
                  />
                {:else if lig.imageLoading}
                  <p class="sidebar-hint px-1 py-6 text-center">Loading 2D…</p>
                {:else}
                  <p class="sidebar-hint px-1 py-6 text-center">No 2D image available</p>
                {/if}
              </div>
            {/if}
          {/each}
        </div>
      </div>
    {/if}

    <h1 class="m-4 mb-2 text-xl font-semibold">Preparation Jobs</h1>
    {#if jobs.length === 0}
      <p
        class="mx-4 mb-4 flex flex-1 items-center justify-center rounded-lg border border-dashed border-neutral-300 text-neutral-500 dark:border-neutral-800 dark:text-neutral-700"
      >
        No preparations yet. Configure options, generate input files, then click "Start Preparation".
      </p>
    {:else}
      <div class="mx-4 mb-4 min-h-0 flex-1 space-y-3 overflow-y-auto">
      {#each jobs as job, ji (job.jobDir)}
        <div
          class="gw-notice rounded-lg p-3 {job.status === 'completed'
            ? 'gw-notice-success'
            : job.status === 'error'
              ? 'gw-notice-error'
              : job.status === 'running'
                ? 'gw-notice-warning'
                : job.status === 'not_started'
                  ? 'gw-notice-info'
                  : ''}"
        >
          <!-- Header -->
          <div class="mb-2 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <!-- Status icon -->
              {#if job.status === 'running'}
                <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-yellow-500"></span>
              {:else if job.status === 'completed'}
                <span class="inline-block h-2 w-2 rounded-full bg-green-500"></span>
              {:else if job.status === 'error'}
                <span class="inline-block h-2 w-2 rounded-full bg-red-500"></span>
              {:else if job.status === 'not_started'}
                <span class="inline-block h-2 w-2 rounded-full bg-blue-500"></span>
              {:else}
                <span class="inline-block h-2 w-2 rounded-full bg-neutral-500"></span>
              {/if}
              <span class="font-semibold text-neutral-900 dark:text-neutral-200" title={job.jobDir}>{job.name}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="tabular-nums dark:text-neutral-500">{job.elapsed}</span>
              {#if job.status !== 'running'}
                <button
                  class="dark:text-neutral-600 dark:hover:text-neutral-300"
                  onclick={() => removeJob(ji)}
                  title="Remove">&times;</button
                >
              {/if}
            </div>
          </div>

          <!-- Step progress bar -->
          <div class="mb-2">
            <div class="flex gap-1">
              {#each job.steps as step, si (step)}
                {@const done =
                  job.stepsCompleted.includes(step) ||
                  (job.status === 'completed' && si < job.steps.length)}
                {@const active =
                  job.status === 'running' &&
                  !done &&
                  (si === 0 || job.stepsCompleted.includes(job.steps[si - 1]))}
                <div class="flex-1">
                  <div
                    class="h-1.5 rounded-full transition-colors"
                    class:bg-green-600={done}
                    class:bg-yellow-500={active}
                    class:animate-pulse={active}
                    class:bg-neutral-700={!done && !active}
                  ></div>
                  <span
                    class="mt-0.5 block text-center"
                    class:dark:text-green-400={done}
                    class:dark:text-yellow-400={active}
                    class:dark:text-neutral-600={!done && !active}
                    style="font-size: 0.6rem;"
                  >
                    {step}
                  </span>
                </div>
              {/each}
            </div>
          </div>

          <!-- Error message -->
          {#if job.error}
            <div class="mb-2 rounded bg-red-900/30 p-2 text-red-300">{job.error}</div>
          {/if}

          <!-- Log toggle -->
          <button
            class="dark:text-neutral-500 dark:hover:text-neutral-300"
            onclick={() => toggleJobLog(ji)}
          >
            {job.showLog ? '▾ Hide log' : '▸ Show log'}
          </button>

          {#if job.showLog}
            <div class="mt-1 flex items-center justify-end gap-1">
              <button
                class="dark:text-neutral-600 dark:hover:text-neutral-300"
                onclick={() => refreshJobLog(ji)}
                title="Refresh"
              >
                ↻
              </button>
            </div>
            <FollowLog lines={job.logLines} />
          {/if}
        </div>
      {/each}
      </div>
    {/if}
  </div>
</div>
