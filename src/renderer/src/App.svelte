<script>
  import { onDestroy, onMount, untrack } from 'svelte'
  import Button from './components/ui/Button.svelte'
  import Info from './components/icons/Info.svelte'
  import Spinner from './components/ui/Spinner.svelte'
  import TitleBarControls from './components/TitleBarControls.svelte'
  import { getDependencyVersions, getProjectStatus } from './lib/backendApi'
  import pkg from '../../../package.json'
  import windowIcon from '../../../resources/window_icon.png'
  import {
    analysisStatus,
    builderStatus,
    equilibrationPageStatus,
    historyLog,
    logEvent,
    preparationStatus,
    visualizeStatus
  } from './lib/pageStatus.svelte.js'

  const pageModules = import.meta.glob('./pages/*.svelte', { eager: true })

  /**
   * Derives route id and nav label from the filename:
   * `FooBar.svelte` → id `fooBar`, label `FooBar`.
   * Optional `NN-FooBar.svelte` (e.g. `01-Visualize.svelte`) sets sort order (NN) and still
   * derives id/label from `FooBar`.
   * @param {string} file
   */
  function stageFromFile(file) {
    const basename = file.match(/\/([^/]+)\.svelte$/)?.[1] ?? ''
    const prefixed = /^(\d+)[-_](.+)$/.exec(basename)
    const order = prefixed ? parseInt(prefixed[1], 10) : Infinity
    const name = prefixed ? prefixed[2] : basename
    const id = name.charAt(0).toLowerCase() + name.slice(1)
    return { file, id, label: name, order }
  }

  const stages = Object.keys(pageModules)
    .map(stageFromFile)
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))

  const hashId = typeof location !== 'undefined' ? location.hash.replace(/^#/, '') : ''
  let currentId = $state(
    hashId && stages.some((s) => s.id === hashId) ? hashId : (stages[0]?.id ?? '')
  )

  // ── Working directory (shared with pages) ──
  let workingDir = $state('')

  async function onBrowseDirectory() {
    const result = await window.api.openDirectoryDialog()
    if (!result.canceled) {
      workingDir = result.dirPath
    }
  }

  function loadPage(id) {
    const stage = stages.find((s) => s.id === id)
    if (!stage) return
    currentId = id
    if (typeof history !== 'undefined') {
      history.replaceState(null, '', `#${id}`)
    }
  }

  /**
   * @param {MouseEvent} e
   * @param {string} id
   */
  function onNavClick(e, id) {
    e.preventDefault()
    loadPage(id)
  }

  // ── Status bar ──
  /** @type {import('./lib/backendApi').ProjectTask[]} */
  let statusTasks = $state([])
  let statusActive = $state(false)
  /** @type {ReturnType<typeof setInterval> | null} */
  let statusPollId = null

  async function refreshStatus() {
    if (!workingDir) return
    try {
      const { tasks, active } = await getProjectStatus(workingDir)
      statusTasks = tasks
      statusActive = active
    } catch {
      // backend not yet ready — silently skip
    }
  }

  $effect(() => {
    if (statusPollId) clearInterval(statusPollId)
    statusTasks = []
    statusActive = false
    if (!workingDir) return
    refreshStatus()
    statusPollId = setInterval(refreshStatus, 5000)
  })

  onDestroy(() => {
    if (statusPollId) clearInterval(statusPollId)
  })

  /** @param {string|null} iso */
  function elapsed(iso) {
    if (!iso) return ''
    const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
    const m = Math.floor(s / 60),
      h = Math.floor(m / 60)
    if (h > 0) return `${h}h ${m % 60}m`
    if (m > 0) return `${m}m ${s % 60}s`
    return `${s}s`
  }

  onMount(() => {
    if (currentId) loadPage(currentId)

    const removeBoundsListener = window.electron?.ipcRenderer?.on('window:bounds-changed', () => {
      window.dispatchEvent(new Event('resize'))
    })

    return () => removeBoundsListener?.()
  })

  /**
   * Suppress file-based poll tasks for a type that the reactive store is already
   * tracking live (avoids the same job appearing twice in the status bar).
   * After an app restart the reactive stores are empty, so historical file tasks
   * still appear correctly.
   */
  const filteredTasks = $derived(
    statusTasks.filter((task) => {
      // Builder preparation jobs are tracked live in builderStatus
      if (task.type === 'preparation' && builderStatus.jobCount > 0) return false
      // Equilibration is tracked live in equilibrationPageStatus
      const eqTracked =
        equilibrationPageStatus.status &&
        equilibrationPageStatus.status !== 'not_started' &&
        equilibrationPageStatus.status !== 'empty'
      if (task.type === 'equilibration' && eqTracked) return false
      return true
    })
  )

  /**
   * Maps a chip type to a page label and Tailwind bg colour for the origin badge.
   * @param {string} type
   */
  function pageTag(type) {
    switch (type) {
      case 'mempro':
        return { name: 'MemPro', bg: 'bg-yellow-700', text: 'text-yellow-200' }
      case 'view':
        return { name: 'Visualize', bg: 'bg-blue-700', text: 'text-blue-200' }
      case 'prep':
        return { name: 'Preparation', bg: 'bg-violet-700', text: 'text-violet-200' }
      case 'build':
        return { name: 'Builder', bg: 'bg-orange-700', text: 'text-orange-200' }
      case 'eq':
        return { name: 'Equilibration', bg: 'bg-cyan-800', text: 'text-cyan-200' }
      case 'analysis':
        return { name: 'Analysis', bg: 'bg-amber-700', text: 'text-amber-200' }
      // file-based task types
      case 'preparation':
        return { name: 'Preparation', bg: 'bg-violet-700', text: 'text-violet-200' }
      case 'equilibration':
        return { name: 'Equilibration', bg: 'bg-cyan-800', text: 'text-cyan-200' }
      default:
        return { name: type, bg: 'bg-neutral-700', text: 'text-neutral-300' }
    }
  }

  // ── Enhanced status bar ──
  let statusExpanded = $state(false)
  /** IDs hidden from the collapsed chip bar (Clear button) */
  let barDismissed = $state(/** @type {Set<string>} */ (new Set()))
  /** Event IDs manually removed from the expanded history log (× button) */
  let logDismissed = $state(/** @type {Set<string>} */ (new Set()))
  /** @type {Record<string, Date>} */
  let chipTimestamps = $state({})
  /** @type {string[]} */
  let chipSeqOrder = $state([])
  /** Level filter for the history panel: show 'info' only, 'detail', or 'verbose' (all) */
  let historyLevel = $state('info')
  /** Tracks previous chip status to detect meaningful state transitions (plain, non-reactive) */
  const _prevChipStatus = {}

  /**
   * Build a unified flat list of all status chips from reactive page stores
   * and file-based backend poll tasks.
   */
  const allChips = $derived.by(() => {
    /** @type {Array<{id:string, type:string, label:string, detail:string, fullDetail:string, status:'running'|'done'|'error'|'idle', dismissible:boolean}>} */
    const chips = []

    // 01 Visualize
    if (visualizeStatus.loading || visualizeStatus.loaded) {
      chips.push({
        id: 'visualize',
        type: 'view',
        label: 'View',
        detail: visualizeStatus.loading ? 'Loading…' : visualizeStatus.fileName,
        fullDetail: visualizeStatus.loading
          ? 'Loading structure file…'
          : `Structure loaded: ${visualizeStatus.fileName}${visualizeStatus.viewCount > 0 ? ` · ${visualizeStatus.viewCount} view${visualizeStatus.viewCount === 1 ? '' : 's'}` : ''}`,
        status: visualizeStatus.loading ? 'running' : 'idle',
        dismissible: visualizeStatus.loaded && !visualizeStatus.loading
      })
    }

    // 01b MemPro orientation (persisted, may outlive the Visualize session)
    if (visualizeStatus.memproStatus) {
      const mpRunning = visualizeStatus.memproStatus === 'running'
      const mpDone = visualizeStatus.memproStatus === 'done'
      const mpError = visualizeStatus.memproStatus === 'error'
      const elapsedStr = visualizeStatus.memproStartedAt
        ? elapsed(visualizeStatus.memproStartedAt)
        : ''
      chips.push({
        id: 'mempro',
        type: 'mempro',
        label: 'MemPro',
        detail: mpRunning
          ? `running${elapsedStr ? ` · ${elapsedStr}` : ''}`
          : mpDone
            ? 'done — click to view'
            : 'error',
        fullDetail: mpRunning
          ? `MemPro orientation running${elapsedStr ? ` · elapsed ${elapsedStr}` : ''}…`
          : mpDone
            ? 'MemPro orientation complete — click to view results'
            : `MemPro orientation failed`,
        status: mpError ? 'error' : mpRunning ? 'running' : 'done',
        dismissible: !mpRunning,
        clickable: mpDone
      })
    }

    // 02 Preparation
    if (
      preparationStatus.propkaDone ||
      preparationStatus.bondsChecked ||
      preparationStatus.prepareDone
    ) {
      const details = []
      if (preparationStatus.propkaDone)
        details.push(`PropKa pH ${preparationStatus.propkaPh?.toFixed(1)} ✓`)
      if (preparationStatus.bondsChecked)
        details.push(
          preparationStatus.bondsCount > 0
            ? `${preparationStatus.bondsCount} S-S bond${preparationStatus.bondsCount === 1 ? '' : 's'} detected`
            : 'No S-S bonds'
        )
      if (preparationStatus.prepareDone)
        details.push(`PDB ready ✓ → ${preparationStatus.outputFile}`)
      chips.push({
        id: 'preparation',
        type: 'prep',
        label: 'Prep',
        detail: details[details.length - 1] ?? '',
        fullDetail: details.join(' · '),
        status: preparationStatus.prepareDone ? 'done' : 'idle',
        dismissible: true
      })
    }

    // 03 Builder
    if (builderStatus.jobCount > 0) {
      const hasRunning = builderStatus.runningCount > 0
      const hasError = builderStatus.errorCount > 0
      chips.push({
        id: 'builder',
        type: 'build',
        label: 'Build',
        detail: `${builderStatus.latestName}${builderStatus.jobCount > 1 ? ` +${builderStatus.jobCount - 1} more` : ''}`,
        fullDetail: `${builderStatus.jobCount} job${builderStatus.jobCount === 1 ? '' : 's'} · ${builderStatus.runningCount} running · ${builderStatus.completedCount} done · ${builderStatus.errorCount} error${builderStatus.errorCount === 1 ? '' : 's'}${builderStatus.latestElapsed ? ` · elapsed ${builderStatus.latestElapsed}` : ''} · latest: ${builderStatus.latestName}`,
        status: hasError ? 'error' : hasRunning ? 'running' : 'done',
        dismissible: !hasRunning
      })
    }

    // 04 Equilibration
    const eqStatus = equilibrationPageStatus.status
    const eqKilled = equilibrationPageStatus.wasKilled
    if ((eqStatus && eqStatus !== 'not_started' && eqStatus !== 'empty') || eqKilled) {
      const eqRunning = eqStatus === 'running'
      const eqDone = eqStatus === 'completed'
      const eqError = eqStatus === 'error'
      const eqGen = equilibrationPageStatus.generatingInput
      // After a kill the backend may return not_started — show "killed" state instead
      const killedAndIdle = eqKilled && !eqRunning && !eqGen
      const stageStr =
        equilibrationPageStatus.stagesTotal > 0
          ? `${equilibrationPageStatus.stagesDone}/${equilibrationPageStatus.stagesTotal} stages`
          : killedAndIdle
            ? 'killed'
            : eqStatus
      const elapsedStr = equilibrationPageStatus.runStartedAt
        ? elapsed(new Date(equilibrationPageStatus.runStartedAt).toISOString())
        : ''
      chips.push({
        id: 'equilibration',
        type: 'eq',
        label: `Eq (${equilibrationPageStatus.engine})`,
        detail: eqGen ? 'generating input…' : killedAndIdle ? 'killed' : stageStr,
        fullDetail: eqGen
          ? `Generating equilibration input files for "${equilibrationPageStatus.outputName}"…`
          : killedAndIdle
            ? `${equilibrationPageStatus.engine.toUpperCase()} equilibration "${equilibrationPageStatus.outputName}" was killed${elapsedStr ? ` · ran ${elapsedStr}` : ''}`
            : `${equilibrationPageStatus.engine.toUpperCase()} equilibration "${equilibrationPageStatus.outputName}" · ${stageStr}${elapsedStr ? ` · elapsed ${elapsedStr}` : ''}`,
        status: eqError ? 'error' : eqRunning || eqGen ? 'running' : eqDone ? 'done' : 'idle',
        dismissible: !eqRunning && !eqGen
      })
    }

    // 05 Analysis
    if (analysisStatus.running || analysisStatus.resultAvailable) {
      chips.push({
        id: 'analysis',
        type: 'analysis',
        label: 'Analysis',
        detail: `${analysisStatus.analysisType || analysisStatus.mode}${analysisStatus.running ? '' : ' ready'}`,
        fullDetail: `Mode: ${analysisStatus.mode || '—'} · type: ${analysisStatus.analysisType || '—'} · ${analysisStatus.running ? 'running' : 'result available'}`,
        status: analysisStatus.running ? 'running' : 'done',
        dismissible: !analysisStatus.running
      })
    }

    // File-based backend poll tasks
    for (const task of filteredTasks) {
      const pct = Math.round(task.progress * 100)
      const isRunning = task.status === 'running'
      const isError = task.status === 'error'
      const isDone = task.status === 'completed'
      chips.push({
        id: `task-${task.id}`,
        type: task.type,
        label: task.name,
        detail: `${task.type === 'equilibration' && task.engine ? task.engine : task.type}${isRunning || isDone ? ` ${pct}%` : ''}`,
        fullDetail: `${task.name} · ${task.type}${task.engine ? ` (${task.engine})` : ''} · ${task.status} · ${pct}%${task.start_time && isRunning ? ` · running ${elapsed(task.start_time)}` : ''}${task.error ? ` · Error: ${task.error}` : ''}`,
        status: isError ? 'error' : isRunning ? 'running' : isDone ? 'done' : 'idle',
        dismissible: !isRunning
      })
    }

    return chips
  })

  // Track first-seen seq/timestamp for chip badges; auto-log chip appearance + status changes
  $effect(() => {
    const chips = allChips
    untrack(() => {
      for (const chip of chips) {
        const isNew = !chipTimestamps[chip.id]
        if (isNew) {
          chipTimestamps[chip.id] = new Date()
          chipSeqOrder.push(chip.id)
          logEvent('info', chip.type, chip.label, chip.fullDetail)
        } else if (_prevChipStatus[chip.id] !== chip.status && chip.status !== 'running') {
          // Only log terminal transitions (done/error), skip repeated 'running' updates
          logEvent('info', chip.type, `${chip.label} — ${chip.status}`, chip.fullDetail)
        }
        _prevChipStatus[chip.id] = chip.status
      }
    })
  })

  /** Chips shown in the collapsed bar — live, filtered by barDismissed */
  const visibleBarChips = $derived(
    allChips
      .filter((c) => !barDismissed.has(c.id))
      .map((c) => ({
        ...c,
        seq: chipSeqOrder.indexOf(c.id) + 1 || '?',
        timestamp: chipTimestamps[c.id] ?? null
      }))
  )

  /** History entries shown in the expanded log, filtered by level + manually dismissed */
  const visibleLogEntries = $derived(
    historyLog.filter((e) => {
      if (logDismissed.has(e.id)) return false
      if (historyLevel === 'info') return e.level === 'info'
      if (historyLevel === 'detail') return e.level === 'info' || e.level === 'detail'
      return true // 'verbose' = show everything
    })
  )

  /** Remove a single entry from the history log */
  function dismissFromLog(id) {
    logDismissed = new Set([...logDismissed, id])
  }

  /** Hide all dismissible chips from the collapsed bar; history is preserved */
  function clearBar() {
    const ids = allChips.filter((c) => c.dismissible).map((c) => c.id)
    barDismissed = new Set([...barDismissed, ...ids])
  }

  // ── Dependency versions dialog ──
  let showVersions = $state(false)
  let versionsLoading = $state(false)
  /** @type {string | null} */
  let versionsError = $state(null)
  /** @type {Awaited<ReturnType<typeof getDependencyVersions>> | null} */
  let versionsData = $state(null)

  async function openVersionsDialog() {
    showVersions = true
    versionsLoading = true
    versionsError = null
    try {
      versionsData = await getDependencyVersions()
    } catch (err) {
      versionsData = null
      versionsError = err instanceof Error ? err.message : 'Failed to load dependency versions'
    } finally {
      versionsLoading = false
    }
  }

  /** @param {Record<string, import('./lib/backendApi').DependencyInfo>} dependencies */
  function sortedDependencies(dependencies) {
    return Object.entries(dependencies).sort(([aName, aInfo], [bName, bInfo]) => {
      const groupOrder = { core: 0, md: 1, orientation: 2, gui: 3 }
      const aGroup = groupOrder[aInfo.install_group] ?? 9
      const bGroup = groupOrder[bInfo.install_group] ?? 9
      if (aGroup !== bGroup) return aGroup - bGroup
      return aName.localeCompare(bName)
    })
  }

  /** @param {string} group */
  function installGroupLabel(group) {
    switch (group) {
      case 'md':
        return 'MD extra'
      case 'orientation':
        return 'Orientation extra'
      case 'gui':
        return 'GUI'
      default:
        return 'Core'
    }
  }
</script>

<div
  class="flex h-full flex-col divide-y overflow-hidden dark:divide-neutral-800 dark:bg-neutral-950 dark:text-white"
>
  <header
    class="flex h-9 shrink-0 items-stretch gap-2 bg-neutral-950 pl-3 dark:bg-neutral-950"
  >
    <div class="titlebar-drag flex shrink-0 items-center self-stretch pr-1" title="Drag to move">
      <img
        src={windowIcon}
        alt="GateWizard"
        class="size-6 pointer-events-none object-contain"
      />
    </div>
    <div class="titlebar-no-drag flex min-w-0 flex-1 items-center gap-2">
      <span class="shrink-0 text-sm font-medium dark:text-neutral-400">Working Directory:</span>
      <input
        id="working-dir-input"
        type="text"
        readonly
        placeholder="Select a directory..."
        value={workingDir}
        class="my-1 min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-0.5 text-sm transition-all dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:placeholder-neutral-600"
      />
      <Button className="my-1 shrink-0" onclick={onBrowseDirectory}>Browse</Button>
      <button
        type="button"
        onclick={openVersionsDialog}
        class="shrink-0 rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200 focus-visible:outline-none"
        title="Dependency versions"
        aria-label="Show dependency versions"
      >
        <Info className="size-4" />
      </button>
    </div>
    <div class="titlebar-drag w-10 shrink-0 self-stretch" aria-hidden="true"></div>
    <TitleBarControls />
  </header>

  {#if showVersions}
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dependency-versions-title"
      tabindex="-1"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onmousedown={(e) => {
        if (e.target === e.currentTarget) showVersions = false
      }}
    >
      <div
        class="mx-4 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 text-xs"
      >
        <div class="border-b border-neutral-800 px-5 py-4">
          <h2 id="dependency-versions-title" class="text-base font-semibold text-neutral-100">
            Dependency Versions
          </h2>
          <p class="mt-1 text-neutral-500">
            Record these versions for reproducibility, compatibility checks, or citations.
          </p>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {#if versionsLoading}
            <div class="flex items-center justify-center gap-2 py-10 text-neutral-400">
              <Spinner />
              Loading dependency versions...
            </div>
          {:else if versionsError}
            <p class="rounded-md border border-red-700/50 bg-red-950/30 p-3 text-red-300">
              {versionsError}
            </p>
          {:else if versionsData}
            <div class="space-y-4">
              <div class="grid grid-cols-2 gap-2 md:grid-cols-3">
                <div class="rounded-md border border-neutral-800 p-2">
                  <p class="text-neutral-500">GUI</p>
                  <p class="font-semibold text-neutral-200">{pkg.version}</p>
                </div>
                {#if versionsData.platform?.python_version}
                  <div class="rounded-md border border-neutral-800 p-2">
                    <p class="text-neutral-500">Python</p>
                    <p class="font-semibold text-neutral-200">
                      {versionsData.platform.python_version}
                    </p>
                  </div>
                {/if}
                {#if versionsData.platform?.platform}
                  <div class="rounded-md border border-neutral-800 p-2 md:col-span-1">
                    <p class="text-neutral-500">Platform</p>
                    <p class="truncate font-semibold text-neutral-200" title={versionsData.platform.platform}>
                      {versionsData.platform.platform}
                    </p>
                  </div>
                {/if}
              </div>

              <div>
                <h3 class="mb-2 font-semibold text-neutral-300">Python packages</h3>
                <div class="overflow-hidden rounded-md border border-neutral-800">
                  <table class="w-full">
                    <thead class="bg-neutral-950 text-neutral-500">
                      <tr>
                        <th class="px-3 py-2 text-left font-medium">Package</th>
                        <th class="px-3 py-2 text-left font-medium">Version</th>
                        <th class="px-3 py-2 text-left font-medium">Install set</th>
                        <th class="px-3 py-2 text-left font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-neutral-800">
                      {#each sortedDependencies(versionsData.dependencies) as [name, info] (name)}
                        <tr>
                          <td class="px-3 py-2 font-medium text-neutral-200">{name}</td>
                          <td class="px-3 py-2 font-mono text-neutral-300">
                            {info.version ?? '—'}
                          </td>
                          <td class="px-3 py-2 text-neutral-400">
                            {installGroupLabel(info.install_group ?? 'core')}
                          </td>
                          <td class="px-3 py-2">
                            {#if info.available}
                              <span class="text-green-400">installed</span>
                            {:else}
                              <span class="text-neutral-500">not installed</span>
                            {/if}
                          </td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              </div>

              {#if versionsData.executables?.length}
                <div>
                  <h3 class="mb-2 font-semibold text-neutral-300">External tools</h3>
                  <div class="overflow-hidden rounded-md border border-neutral-800">
                    <table class="w-full">
                      <thead class="bg-neutral-950 text-neutral-500">
                        <tr>
                          <th class="px-3 py-2 text-left font-medium">Engine</th>
                          <th class="px-3 py-2 text-left font-medium">Version</th>
                          <th class="px-3 py-2 text-left font-medium">Path</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-neutral-800">
                        {#each versionsData.executables as exe (exe.name)}
                          <tr>
                            <td class="px-3 py-2 font-medium uppercase text-neutral-200">
                              {exe.name}
                            </td>
                            <td class="px-3 py-2 font-mono text-neutral-300">
                              {exe.version ?? '—'}
                            </td>
                            <td class="max-w-48 truncate px-3 py-2 text-neutral-500" title={exe.path ?? ''}>
                              {exe.path ?? '—'}
                            </td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <div class="border-t border-neutral-800 px-5 py-3">
          <Button className="w-full" onclick={() => (showVersions = false)}>Close</Button>
        </div>
      </div>
    </div>
  {/if}

  <nav class="flex items-center gap-2 p-4 text-sm">
    <p class="dark:text-neutral-200">Stages:</p>
    <div class="flex divide-x divide-neutral-300 overflow-clip rounded-md dark:divide-neutral-700">
      {#each stages as stage (stage.id)}
        <a
          href="#{stage.id}"
          class="bg-neutral-200 px-4 py-2 text-neutral-900 no-underline transition-colors hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-600"
          class:!bg-neutral-200={currentId === stage.id}
          class:!text-black={currentId === stage.id}
          onclick={(e) => onNavClick(e, stage.id)}>{stage.label}</a
        >
      {/each}
    </div>
  </nav>

  <!--
    All pages are mounted once and kept alive — switching tabs only toggles
    visibility/pointer-events so no component state is ever lost.
    `position:absolute; inset:0` ensures every page always has its full
    dimensions (important for the Three.js / WebGL canvas in Visualize).
  -->
  <main class="relative min-h-0 flex-1 overflow-hidden">
    {#each stages as stage (stage.id)}
      {@const PageComp = pageModules[stage.file]?.default}
      {#if PageComp}
        <div
          class="absolute inset-0 flex overflow-hidden"
          style="visibility:{currentId === stage.id
            ? 'visible'
            : 'hidden'};pointer-events:{currentId === stage.id ? 'auto' : 'none'}"
          aria-hidden={currentId !== stage.id}
        >
          <PageComp {workingDir} />
        </div>
      {/if}
    {/each}
  </main>

  <footer class="relative flex items-stretch text-xs dark:bg-neutral-900 dark:text-neutral-500">
    <!-- ── Expanded history panel (floats above the footer) ── -->
    {#if statusExpanded}
      <div
        class="absolute right-0 bottom-full left-0 z-20 max-h-80 overflow-y-auto border-t border-neutral-800 bg-neutral-950 shadow-xl"
      >
        <!-- Header: title + level filter + entry count + close -->
        <div
          class="sticky top-0 z-10 flex items-center gap-2 border-b border-neutral-800 bg-neutral-950 px-3 py-1.5"
        >
          <span class="shrink-0 font-semibold text-neutral-300">History</span>
          <!-- Level filter tabs -->
          <div class="flex gap-0.5 rounded bg-neutral-800 p-0.5">
            {#each [{ id: 'info', label: 'Info', title: 'Major actions only (file open, edits, runs)' }, { id: 'detail', label: 'Detail', title: 'Info + secondary actions (add/remove view, measurements)' }, { id: 'verbose', label: 'All', title: 'Everything including micro changes (gizmo, labels)' }] as lvl (lvl.id)}
              {@const activeClass =
                historyLevel === lvl.id
                  ? 'bg-neutral-600 text-neutral-100'
                  : 'text-neutral-500 hover:text-neutral-300'}
              <button
                onclick={() => {
                  historyLevel = lvl.id
                }}
                title={lvl.title}
                class="rounded px-2 py-0.5 text-[10px] transition-colors {activeClass}"
                >{lvl.label}</button
              >
            {/each}
          </div>
          <span class="ml-auto shrink-0 text-[10px] text-neutral-600"
            >{visibleLogEntries.length} event{visibleLogEntries.length === 1 ? '' : 's'}</span
          >
          <button
            onclick={() => {
              statusExpanded = false
            }}
            class="shrink-0 rounded px-2 py-0.5 text-[10px] text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
            >✕</button
          >
        </div>
        <!-- Log entries -->
        {#if visibleLogEntries.length === 0}
          <p class="px-3 py-3 text-neutral-600">No events recorded at this level yet.</p>
        {:else}
          <div class="divide-y divide-neutral-800/50">
            {#each visibleLogEntries as entry (entry.id)}
              {@const tag = pageTag(entry.page)}
              <div
                class="flex items-start gap-2 px-3 py-1.5
                  {entry.level === 'verbose' ? 'opacity-60' : ''}"
              >
                <!-- global seq number -->
                <span
                  class="mt-0.5 w-5 shrink-0 text-right text-[10px] text-neutral-600 tabular-nums"
                  >{historyLog.indexOf(entry) + 1}</span
                >
                <!-- page-origin tag -->
                <span
                  class="mt-0.5 shrink-0 rounded px-1.5 py-px text-[9px] leading-none {tag.bg} {tag.text}"
                  >{tag.name}</span
                >
                <!-- level indicator dot -->
                <span
                  class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full
                  {entry.level === 'info'
                    ? 'bg-blue-400'
                    : entry.level === 'detail'
                      ? 'bg-neutral-400'
                      : 'bg-neutral-600'}"
                ></span>
                <!-- content -->
                <div class="min-w-0 flex-1">
                  <div class="flex items-baseline gap-2">
                    <span class="font-medium text-neutral-300">{entry.label}</span>
                    <span class="ml-auto shrink-0 text-[10px] text-neutral-600"
                      >{entry.timestamp.toLocaleTimeString()}</span
                    >
                  </div>
                  {#if entry.detail}
                    <p class="mt-0.5 text-[11px] break-all text-neutral-400">{entry.detail}</p>
                  {/if}
                </div>
                <!-- dismiss from history -->
                <button
                  onclick={() => dismissFromLog(entry.id)}
                  title="Remove from history"
                  class="mt-0.5 shrink-0 leading-none text-neutral-600 hover:text-neutral-300"
                  >×</button
                >
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- ── Collapsed chip row ── -->
    <div class="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto px-3 py-2">
      {#if !workingDir}
        <span>No working directory selected</span>
      {:else if visibleBarChips.length === 0}
        <span class="truncate">Ready — {workingDir}</span>
      {:else}
        {#each visibleBarChips as chip (chip.id)}
          {#snippet chipInner()}
            <!-- seq badge (inline, no absolute so overflow-x-auto can't clip it) -->
            <span
              class="rounded bg-neutral-700 px-[4px] py-[1px] text-[9px] leading-none text-neutral-400 tabular-nums"
              >{chip.seq}</span
            >
            {#if chip.status === 'running'}
              <span
                class="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-yellow-400"
              ></span>
            {:else if chip.status === 'done'}
              <span class="shrink-0">✓</span>
            {:else if chip.status === 'error'}
              <span class="shrink-0">✕</span>
            {/if}
            <span class="font-medium whitespace-nowrap opacity-70">{chip.label}</span>
            <span class="max-w-32 truncate text-[11px]" title={chip.fullDetail}>{chip.detail}</span>
          {/snippet}
          {#if chip.clickable}
            <button
              type="button"
              class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded border-0 bg-transparent px-2 py-1 hover:opacity-80
              {chip.status === 'error'
                ? 'bg-red-950 text-red-400'
                : chip.status === 'running'
                  ? 'bg-neutral-800 text-neutral-300'
                  : chip.status === 'done'
                    ? 'bg-green-950 text-green-500'
                    : 'bg-neutral-800 text-neutral-500'}"
              onclick={() => {
                if (chip.id === 'mempro') visualizeStatus.openMemproDialog = true
              }}
            >
              {@render chipInner()}
            </button>
          {:else}
            <div
              class="flex shrink-0 items-center gap-1.5 rounded px-2 py-1
              {chip.status === 'error'
                ? 'bg-red-950 text-red-400'
                : chip.status === 'running'
                  ? 'bg-neutral-800 text-neutral-300'
                  : chip.status === 'done'
                    ? 'bg-green-950 text-green-500'
                    : 'bg-neutral-800 text-neutral-500'}"
            >
              {@render chipInner()}
            </div>
          {/if}
        {/each}
      {/if}
    </div>

    <!-- ── Actions: always visible when workingDir is set ── -->
    {#if workingDir}
      <div class="flex shrink-0 items-center gap-1 border-l border-neutral-800 px-2">
        <button
          onclick={clearBar}
          title="Hide completed chips from status bar (history preserved)"
          class="rounded px-1.5 py-0.5 text-[10px] text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
          >Clear</button
        >
        <button
          onclick={() => {
            statusExpanded = !statusExpanded
          }}
          title={statusExpanded ? 'Collapse log' : 'Expand log'}
          class="rounded px-1.5 py-0.5 text-[10px] text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
          >{statusExpanded ? '▼' : '▲'}</button
        >
      </div>
    {/if}
  </footer>
</div>
