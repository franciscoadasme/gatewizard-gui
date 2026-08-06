<script>
  import { onDestroy, onMount, untrack } from 'svelte'
  import AppErrorDialog from './components/AppErrorDialog.svelte'
  import Button from './components/ui/Button.svelte'
  import ActivitySidebar from './components/ActivitySidebar.svelte'
  import SettingsDialog from './components/SettingsDialog.svelte'
  import TitleBarControls from './components/TitleBarControls.svelte'
  import WindowResizeHandles from './components/WindowResizeHandles.svelte'
  import { getProjectStatus } from './lib/backendApi'
  import { appSettings, updateAppSettings } from './lib/appSettings.svelte.js'
  import {
    notifyJobFinishedIfUnfocused,
    jobToastState,
    dismissJobToast,
    notificationNav
  } from './lib/jobNotifications.svelte.js'
  import { getAppWindowIconUrl, getWordmarkUrl } from '../../shared/brand.js'
  import { installAppAlertOverride } from './lib/appDialog.svelte.js'
  import { themeState } from './lib/theme.svelte.js'
  import {
    analysisStatus,
    builderStatus,
    equilibrationPageStatus,
    historyLog,
    logEvent,
    preparationStatus,
    toolsStatus,
    visualizeStatus
  } from './lib/pageStatus.svelte.js'

  const windowIcon = $derived(getAppWindowIconUrl(themeState.current))
  const wordmark = $derived(getWordmarkUrl(themeState.current))

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

  // Keep notification focus checks in sync with the active sidebar tab
  $effect(() => {
    notificationNav.currentPageId = currentId
  })

  // ── Working directory (shared with pages) ──
  let workingDir = $state('')

  async function onBrowseDirectory() {
    const result = await window.api.openDirectoryDialog(
      'Select Working Directory',
      workingDir || undefined
    )
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


  // ── Status bar ──
  /** @type {import('./lib/backendApi').ProjectTask[]} */
  let statusTasks = $state([])
  /** @type {ReturnType<typeof setInterval> | null} */
  let statusPollId = null

  async function refreshStatus() {
    if (!workingDir) return
    try {
      const { tasks } = await getProjectStatus(workingDir)
      await maybeNotifyJobTransitions(tasks)
      statusTasks = tasks
    } catch {
      // backend not yet ready — silently skip
    }
  }

  /** @type {Record<string, string>} */
  const prevTaskStatus = {}
  /** @type {Record<string, true>} */
  const notifiedTaskKeys = {}

  /**
   * @param {import('./lib/backendApi').ProjectTask[]} tasks
   */
  async function maybeNotifyJobTransitions(tasks) {
    for (const task of tasks) {
      const id = task.id || `${task.type}:${task.name}`
      const prev = prevTaskStatus[id]
      const next = task.status
      prevTaskStatus[id] = next

      if (next !== 'completed' && next !== 'error') continue
      if (prev !== 'running') continue

      const notifyKey = `${id}:${next}`
      if (notifiedTaskKeys[notifyKey]) continue

      const label = task.name || task.type || 'Job'
      const title = next === 'completed' ? 'Job finished' : 'Job failed'
      const body =
        next === 'completed'
          ? `${label} completed successfully.`
          : `${label} ended with an error${task.error ? `: ${task.error}` : '.'}`

      const sourcePage =
        task.type === 'equilibration'
          ? 'equilibration'
          : task.type === 'preparation'
            ? 'preparation'
            : task.type

      await notifyJobFinishedIfUnfocused({ id, title, body, sourcePage })
      notifiedTaskKeys[notifyKey] = true
    }

    const liveIds = new Set(tasks.map((t) => t.id || `${t.type}:${t.name}`))
    for (const key of Object.keys(prevTaskStatus)) {
      if (!liveIds.has(key)) delete prevTaskStatus[key]
    }
  }

  // Live UI jobs (not in /project-status): MemPro, Packmol, PropKa, Analysis
  /** @type {'running'|'done'|'error'|null} */
  let prevMemproStatus = null
  /** @type {'running'|'done'|'error'|null} */
  let prevPackmolStatus = null
  let prevPropkaRunning = false
  let prevToolsRunning = false
  let prevAnalysisRunning = false

  $effect(() => {
    const s = visualizeStatus.memproStatus
    const prev = prevMemproStatus
    prevMemproStatus = s
    if (prev === 'running' && (s === 'done' || s === 'error')) {
      void notifyJobFinishedIfUnfocused({
        id: `mempro:${visualizeStatus.memproJobId ?? 'job'}`,
        title: s === 'done' ? 'MemPro finished' : 'MemPro failed',
        body:
          s === 'done'
            ? 'Membrane protein orientation completed successfully.'
            : 'Membrane protein orientation ended with an error.',
        sourcePage: 'visualize'
      })
    }
  })

  $effect(() => {
    const s = visualizeStatus.packmolStatus
    const prev = prevPackmolStatus
    prevPackmolStatus = s
    if (prev === 'running' && (s === 'done' || s === 'error')) {
      void notifyJobFinishedIfUnfocused({
        id: `packmol:${visualizeStatus.packmolStartedAt ?? 'job'}`,
        title: s === 'done' ? 'Packmol finished' : 'Packmol failed',
        body:
          s === 'done'
            ? visualizeStatus.packmolMessage || 'Packmol hydration completed successfully.'
            : visualizeStatus.packmolMessage || 'Packmol hydration ended with an error.',
        sourcePage: 'visualize'
      })
    }
  })

  $effect(() => {
    const running = preparationStatus.propkaRunning
    const prev = prevPropkaRunning
    prevPropkaRunning = running
    if (prev && !running) {
      const err = preparationStatus.propkaError
      const ph = preparationStatus.propkaPh
      void notifyJobFinishedIfUnfocused({
        id: `propka:${ph ?? 'run'}`,
        title: err ? 'PropKa failed' : 'PropKa finished',
        body: err
          ? `PropKa ended with an error: ${err}`
          : `PropKa completed successfully${ph != null ? ` (pH ${ph})` : ''}.`,
        sourcePage: 'preparation'
      })
    }
  })

  $effect(() => {
    const running = toolsStatus.runningCount > 0
    const prev = prevToolsRunning
    prevToolsRunning = running
    if (!prev || running) return

    const label = toolsStatus.latestName || toolsStatus.tool || 'Tools'
    const status = toolsStatus.latestStatus
    if (!status || status === 'running') return

    void notifyJobFinishedIfUnfocused({
      id: `tools:${label}:${status}`,
      title: status === 'error' ? 'Tool failed' : 'Tool finished',
      body:
        status === 'error'
          ? `${label} ended with an error${toolsStatus.error ? `: ${toolsStatus.error}` : '.'}`
          : `${label} completed successfully.`,
      sourcePage: 'tools'
    })
  })

  $effect(() => {
    const running = analysisStatus.running
    const prev = prevAnalysisRunning
    prevAnalysisRunning = running
    if (!prev || running) return

    // Skip Clear / reset (no mode, no result, no error)
    const label = analysisStatus.analysisType || analysisStatus.mode || 'Analysis'
    const err = analysisStatus.error
    const hasResult = analysisStatus.resultAvailable
    if (!err && !hasResult && !analysisStatus.mode) return

    void notifyJobFinishedIfUnfocused({
      id: `analysis:${label}`,
      title: err ? 'Analysis failed' : 'Analysis finished',
      body: err
        ? `${label} ended with an error: ${err}`
        : `${label} completed successfully.`,
      sourcePage: 'analysis'
    })
  })

  $effect(() => {
    if (statusPollId) clearInterval(statusPollId)
    statusTasks = []
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

  $effect(() => {
    const items = jobToastState.items
    if (items.length === 0) return
    const latest = items[items.length - 1]
    const timer = setTimeout(() => dismissJobToast(latest.id), 10000)
    return () => clearTimeout(timer)
  })

  onMount(() => {
    if (currentId) loadPage(currentId)

    const removeBoundsListener = window.electron?.ipcRenderer?.on('window:bounds-changed', () => {
      window.dispatchEvent(new Event('resize'))
    })
    const restoreAlert = installAppAlertOverride()
    const removeOpenPageListener = window.api?.onNotificationOpenPage?.((data) => {
      const page = typeof data?.sourcePage === 'string' ? data.sourcePage : ''
      if (page) loadPage(page)
    })

    void runStartupUpdateCheck()

    return () => {
      removeBoundsListener?.()
      restoreAlert()
      removeOpenPageListener?.()
    }
  })

  // ── Settings / updates ──
  let showSettings = $state(false)
  /** @type {'notifications' | 'appearance' | 'scene' | 'versions'} */
  let settingsSection = $state('notifications')
  let updatesPending = $state(false)
  let showUpdateAvailableDialog = $state(false)
  /** @type {string | null} */
  let updateAvailableSummary = $state(null)

  function openSettings(section = 'notifications') {
    settingsSection = section
    showSettings = true
  }

  /**
   * @param {any} result
   */
  function onUpdatesResult(result) {
    if (!result || result.error) {
      if (result == null) updatesPending = false
      return
    }
    const pending = Boolean(result.gui?.updateAvailable || result.gatewizard?.updateAvailable)
    updatesPending = pending
    if (!pending) {
      updateAppSettings({ dismissedUpdateKey: null })
    }
  }

  /**
   * @param {any} result
   */
  function updateKeyFromResult(result) {
    return `${result?.remote?.gui ?? ''}|${result?.remote?.gatewizard ?? ''}`
  }

  async function runStartupUpdateCheck() {
    if (!appSettings.updateCheckOnLaunch || !window.api?.checkForUpdates) return

    // Wait briefly for the backend so API version is available
    for (let i = 0; i < 20; i++) {
      try {
        const result = await window.api.checkForUpdates()
        if (result?.error && /fetch|network|ECONNREFUSED/i.test(result.error)) {
          await new Promise((r) => setTimeout(r, 500))
          continue
        }
        onUpdatesResult(result)
        if (result && !result.error) {
          const pending = Boolean(
            result.gui?.updateAvailable || result.gatewizard?.updateAvailable
          )
          if (pending) {
            const key = updateKeyFromResult(result)
            if (appSettings.dismissedUpdateKey !== key) {
              const parts = []
              if (result.gui?.updateAvailable) {
                parts.push(`GUI ${result.remote.gui} (installed ${result.local.gui})`)
              }
              if (result.gatewizard?.updateAvailable) {
                parts.push(
                  `API ${result.remote.gatewizard}` +
                    (result.local.gatewizard ? ` (installed ${result.local.gatewizard})` : '')
                )
              }
              updateAvailableSummary = parts.join(' · ')
              showUpdateAvailableDialog = true
            }
          }
        }
        return
      } catch {
        await new Promise((r) => setTimeout(r, 500))
      }
    }
  }

  function dismissUpdateDialog() {
    showUpdateAvailableDialog = false
    if (updateAvailableSummary) {
      // Persist dismissal for this remote version pair when user clicks Later
      // Key set from last check via updatesPending path — re-check lightly
      void (async () => {
        try {
          const result = await window.api?.checkForUpdates?.()
          if (result && !result.error) {
            updateAppSettings({ dismissedUpdateKey: updateKeyFromResult(result) })
          }
        } catch {
          /* ignore */
        }
      })()
    }
  }

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
      case 'tools':
        return { name: 'Tools', bg: 'bg-teal-700', text: 'text-teal-200' }
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

    if (visualizeStatus.packmolStatus) {
      const pkRunning = visualizeStatus.packmolStatus === 'running'
      const pkDone = visualizeStatus.packmolStatus === 'done'
      const pkError = visualizeStatus.packmolStatus === 'error'
      const pkElapsed = visualizeStatus.packmolStartedAt
        ? elapsed(visualizeStatus.packmolStartedAt)
        : ''
      chips.push({
        id: 'packmol',
        type: 'packmol',
        label: 'Packmol',
        detail: pkRunning
          ? `running${pkElapsed ? ` · ${pkElapsed}` : ''}`
          : pkDone
            ? 'done — click to view'
            : 'error',
        fullDetail: visualizeStatus.packmolMessage || 'Packmol hydration',
        status: pkError ? 'error' : pkRunning ? 'running' : 'done',
        dismissible: !pkRunning,
        clickable: pkDone || pkError
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

    // 05 Tools
    if (toolsStatus.jobCount > 0 || toolsStatus.launching) {
      const toolsRunning = toolsStatus.runningCount > 0 || toolsStatus.launching
      const toolsError = toolsStatus.errorCount > 0 && !toolsRunning
      chips.push({
        id: 'tools',
        type: 'tools',
        label: 'Tools',
        detail: toolsStatus.launching
          ? 'launching…'
          : toolsRunning
            ? `${toolsStatus.runningCount} running`
            : toolsStatus.latestName || `${toolsStatus.jobCount} job(s)`,
        fullDetail: toolsStatus.launching
          ? `Launching ${toolsStatus.tool || 'tool'}…`
          : `${toolsStatus.jobCount} job(s) · ${toolsStatus.runningCount} running · ${toolsStatus.completedCount} done · ${toolsStatus.errorCount} error${
              toolsStatus.latestName ? ` · latest: ${toolsStatus.latestName} (${toolsStatus.latestStatus})` : ''
            }`,
        status: toolsError ? 'error' : toolsRunning ? 'running' : 'done',
        dismissible: !toolsRunning
      })
    }

    // 06 Analysis
    if (analysisStatus.running || analysisStatus.resultAvailable) {
      const prog = analysisStatus.progress
      const progressDetail =
        prog.active && prog.total > 0 ? ` · set ${prog.current}/${prog.total}` : ''
      chips.push({
        id: 'analysis',
        type: 'analysis',
        label: 'Analysis',
        detail: `${analysisStatus.analysisType || analysisStatus.mode}${analysisStatus.running ? progressDetail || '' : ' ready'}`,
        fullDetail: `Mode: ${analysisStatus.mode || '—'} · type: ${analysisStatus.analysisType || '—'} · ${
          prog.active && prog.label
            ? `running ${prog.current}/${prog.total} (${prog.label})`
            : analysisStatus.running
              ? 'running'
              : 'result available'
        }`,
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
</script>

<div
  class="flex h-full flex-col overflow-hidden bg-white text-neutral-900 dark:bg-neutral-950 dark:text-white"
>
  <header class="flex h-9 shrink-0 items-stretch bg-white dark:bg-neutral-950">
    <div
      class="titlebar-logo-slot flex w-14 shrink-0 items-center justify-center"
      title="Drag to move"
    >
      <img
        src={windowIcon}
        alt="GateWizard"
        draggable="false"
        class="pointer-events-none size-9 object-contain"
      />
    </div>
    <div class="flex min-w-0 flex-1 items-stretch border-b border-neutral-200 dark:border-neutral-800">
      <div class="titlebar-wordmark-slot flex shrink-0 items-center self-center pl-2 pr-1">
        <img
          src={wordmark}
          alt="GateWizard"
          draggable="false"
          class="pointer-events-none h-4 w-auto max-w-[12rem] object-contain object-left"
        />
      </div>
      <div class="titlebar-drag-zone min-w-8 flex-1" aria-hidden="true"></div>
      <div class="titlebar-no-drag flex shrink-0 items-center gap-2 self-center">
      <span class="titlebar-label shrink-0 text-xs font-medium text-neutral-600 dark:text-neutral-400"
        >Working Directory:</span
      >
      <input
        id="working-dir-input"
        type="text"
        readonly
        placeholder="Select a directory..."
        value={workingDir}
        title={workingDir || undefined}
        class="h-6 w-52 shrink-0 truncate rounded border border-neutral-300 px-2 text-xs transition-all dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:placeholder-neutral-600"
      />
      <Button size="sm" className="h-6 shrink-0 px-2.5 py-0 text-xs" onclick={onBrowseDirectory}
        >Browse</Button
      >
    </div>
    <div class="titlebar-drag-zone min-w-8 flex-1" aria-hidden="true"></div>
    <TitleBarControls />
    </div>
  </header>

  <WindowResizeHandles />

  <SettingsDialog
    bind:open={showSettings}
    {updatesPending}
    initialSection={settingsSection}
    onUpdatesResult={onUpdatesResult}
  />

  {#if showUpdateAvailableDialog}
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="updates-available-title"
      tabindex="-1"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      onmousedown={(e) => {
        if (e.target === e.currentTarget) dismissUpdateDialog()
      }}
    >
      <div
        class="mx-4 w-full max-w-md rounded-lg border border-neutral-300 bg-white p-5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
      >
        <h2
          id="updates-available-title"
          class="text-base font-semibold text-neutral-900 dark:text-neutral-100"
        >
          Updates available
        </h2>
        <p class="mt-2 text-neutral-600 dark:text-neutral-400">
          {updateAvailableSummary || 'A newer version of GateWizard is available.'}
        </p>
        <div class="mt-4 flex flex-wrap gap-2">
          <Button
            className="min-w-[8rem] flex-1"
            onclick={() => {
              showUpdateAvailableDialog = false
              openSettings('versions')
            }}
          >
            Open Settings
          </Button>
          <Button className="min-w-[8rem] flex-1" variant="outline" onclick={dismissUpdateDialog}>
            Later
          </Button>
        </div>
      </div>
    </div>
  {/if}

  <div class="flex min-h-0 flex-1 overflow-hidden">
    <ActivitySidebar
      {stages}
      {currentId}
      onNavigate={loadPage}
      onSettings={() => openSettings()}
      {updatesPending}
    />

    <!--
      All pages are mounted once and kept alive — switching tabs only toggles
      visibility/pointer-events so no component state is ever lost.
      `position:absolute; inset:0` ensures every page always has its full
      dimensions (important for the Three.js / WebGL canvas in Visualize).
    -->
    <main class="relative min-h-0 min-w-0 flex-1 overflow-hidden">
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
  </div>

  <footer class="relative flex items-stretch border-t border-neutral-200 bg-neutral-50 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-500">
    <!-- ── Expanded history panel (floats above the footer) ── -->
    {#if statusExpanded}
      <div
        class="absolute right-0 bottom-full left-0 z-20 max-h-80 overflow-y-auto border-t border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-950"
      >
        <!-- Header: title + level filter + entry count + close -->
        <div
          class="sticky top-0 z-10 flex items-center gap-2 border-b border-neutral-200 bg-white px-3 py-1.5 dark:border-neutral-800 dark:bg-neutral-950"
        >
          <span class="shrink-0 font-semibold text-neutral-700 dark:text-neutral-300">History</span>
          <!-- Level filter tabs -->
          <div class="flex gap-0.5 rounded bg-neutral-200 p-0.5 dark:bg-neutral-800">
            {#each [{ id: 'info', label: 'Info', title: 'Major actions only (file open, edits, runs)' }, { id: 'detail', label: 'Detail', title: 'Info + secondary actions (add/remove view, measurements)' }, { id: 'verbose', label: 'All', title: 'Everything including micro changes (gizmo, labels)' }] as lvl (lvl.id)}
              {@const activeClass =
                historyLevel === lvl.id
                  ? 'bg-neutral-400 text-neutral-900 dark:bg-neutral-600 dark:text-neutral-100'
                  : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'}
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
            class="shrink-0 rounded px-2 py-0.5 text-[10px] text-neutral-500 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            >✕</button
          >
        </div>
        <!-- Log entries -->
        {#if visibleLogEntries.length === 0}
          <p class="px-3 py-3 text-neutral-600">No events recorded at this level yet.</p>
        {:else}
          <div class="divide-y divide-neutral-200/80 dark:divide-neutral-800/50">
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
                    <span class="font-medium text-neutral-700 dark:text-neutral-300">{entry.label}</span>
                    <span class="ml-auto shrink-0 text-[10px] text-neutral-600"
                      >{entry.timestamp.toLocaleTimeString()}</span
                    >
                  </div>
                  {#if entry.detail}
                    <p class="mt-0.5 text-[11px] break-all text-neutral-500 dark:text-neutral-400">{entry.detail}</p>
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
              class="rounded bg-neutral-200 px-[4px] py-[1px] text-[9px] leading-none text-neutral-600 tabular-nums dark:bg-neutral-700 dark:text-neutral-400"
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
              class="gw-chip cursor-pointer hover:opacity-80
              {chip.status === 'error'
                ? 'gw-chip-error'
                : chip.status === 'running'
                  ? 'gw-chip-running'
                  : chip.status === 'done'
                    ? 'gw-chip-done'
                    : 'gw-chip-idle'}"
              onclick={() => {
                if (chip.id === 'mempro') visualizeStatus.openMemproDialog = true
                if (chip.id === 'packmol') visualizeStatus.openPackmolDialog = true
              }}
            >
              {@render chipInner()}
            </button>
          {:else}
            <div
              class="gw-chip
              {chip.status === 'error'
                ? 'gw-chip-error'
                : chip.status === 'running'
                  ? 'gw-chip-running'
                  : chip.status === 'done'
                    ? 'gw-chip-done'
                    : 'gw-chip-idle'}"
            >
              {@render chipInner()}
            </div>
          {/if}
        {/each}
      {/if}
    </div>

    <!-- ── Actions: always visible when workingDir is set ── -->
    {#if workingDir}
      <div class="flex shrink-0 items-center gap-1 border-l border-neutral-200 px-2 dark:border-neutral-800">
        <button
          onclick={clearBar}
          title="Hide completed status chips (does not clear the Visualize scene)"
          class="rounded px-1.5 py-0.5 text-[10px] text-neutral-500 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
          >Clear chips</button
        >
        <button
          onclick={() => {
            statusExpanded = !statusExpanded
          }}
          title={statusExpanded ? 'Collapse log' : 'Expand log'}
          class="rounded px-1.5 py-0.5 text-[10px] text-neutral-500 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
          >{statusExpanded ? '▼' : '▲'}</button
        >
      </div>
    {/if}
  </footer>
</div>

{#if jobToastState.items.length > 0}
  <div
    class="pointer-events-none fixed right-4 bottom-14 z-[70] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2"
    aria-live="polite"
  >
    {#each jobToastState.items as toast (toast.id)}
      <div
        class="gw-notice gw-notice-success pointer-events-auto flex w-full items-start gap-2 p-3 text-left transition-opacity hover:opacity-90"
        role="status"
      >
        <button
          type="button"
          class="min-w-0 flex-1 border-0 bg-transparent p-0 text-left text-inherit"
          title={toast.sourcePage ? `Open ${toast.sourcePage}` : undefined}
          onclick={() => {
            if (toast.sourcePage) loadPage(toast.sourcePage)
            dismissJobToast(toast.id)
          }}
        >
          <p class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{toast.title}</p>
          <p class="mt-0.5 text-xs text-neutral-600 dark:text-neutral-400">{toast.body}</p>
          {#if toast.sourcePage}
            <p class="mt-1 text-[10px] text-neutral-500">Click to open {toast.sourcePage}</p>
          {/if}
        </button>
        <button
          type="button"
          class="shrink-0 rounded px-1.5 text-base leading-none text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          aria-label="Dismiss"
          onclick={() => dismissJobToast(toast.id)}
        >
          &times;
        </button>
      </div>
    {/each}
  </div>
{/if}

<AppErrorDialog />
