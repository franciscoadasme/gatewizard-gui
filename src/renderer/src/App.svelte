<script>
  import { onDestroy, onMount } from 'svelte'
  import Button from './components/ui/Button.svelte'
  import { getProjectStatus } from './lib/backendApi'
  import { preparationStatus } from './lib/pageStatus.svelte.js'

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
  })
</script>

<div
  class="flex h-screen flex-col divide-y overflow-hidden dark:divide-neutral-800 dark:bg-neutral-950 dark:text-white"
>
  <header class="px-4 py-2 dark:bg-neutral-800">
    <div class="flex items-center gap-2">
      <span class="text-sm font-medium dark:text-neutral-400">Working Directory:</span>
      <input
        id="working-dir-input"
        type="text"
        readonly
        placeholder="Select a directory..."
        value={workingDir}
        class="flex-1 rounded-md border border-neutral-300 p-2 transition-all dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:placeholder-neutral-600"
      />
      <Button onclick={onBrowseDirectory}>Browse</Button>
    </div>
  </header>

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

  <footer
    class="flex items-center gap-3 overflow-hidden px-3 py-1 text-xs dark:bg-neutral-900 dark:text-neutral-500"
  >
    {#if !workingDir}
      <span>No working directory selected</span>
    {:else}
      <!-- ── Preparation page status ── -->
      {#if preparationStatus.propkaDone || preparationStatus.bondsChecked || preparationStatus.prepareDone}
        <div
          class="flex shrink-0 items-center gap-1.5 rounded bg-neutral-800 px-2 py-0.5 text-neutral-300"
        >
          <span class="font-medium opacity-60">Prep:</span>
          {#if preparationStatus.propkaDone}
            <span title="PropKa analysis done"
              >PropKa (pH {preparationStatus.propkaPh?.toFixed(1)}) ✓</span
            >
          {/if}
          {#if preparationStatus.bondsChecked}
            <span class="opacity-60">·</span>
            {#if preparationStatus.bondsCount > 0}
              <span title="{preparationStatus.bondsCount} disulfide bond(s) detected"
                >{preparationStatus.bondsCount} S-S bond{preparationStatus.bondsCount === 1
                  ? ''
                  : 's'}</span
              >
            {:else}
              <span class="text-neutral-500" title="No disulfide bonds found">no S-S bonds</span>
            {/if}
          {/if}
          {#if preparationStatus.prepareDone}
            <span class="opacity-60">·</span>
            <span class="text-green-500" title="PDB prepared: {preparationStatus.outputFile}"
              >PDB ready ✓</span
            >
          {/if}
        </div>
      {/if}

      <!-- ── File-based job tasks (Builder / Equilibration) ── -->
      {#if statusTasks.length === 0 && !preparationStatus.propkaDone && !preparationStatus.bondsChecked && !preparationStatus.prepareDone}
        <span class="truncate">Ready — {workingDir}</span>
      {/if}
      {#each statusTasks as task (task.id)}
        {@const isRunning = task.status === 'running'}
        {@const isError = task.status === 'error'}
        {@const isDone = task.status === 'completed'}
        {@const pct = Math.round(task.progress * 100)}
        <div
          class="flex min-w-0 shrink-0 items-center gap-1.5 rounded px-2 py-0.5
            {isError
            ? 'bg-red-950 text-red-400'
            : isRunning
              ? 'bg-neutral-800 text-neutral-300'
              : isDone
                ? 'bg-green-950 text-green-500'
                : 'bg-neutral-800 text-neutral-500'}"
        >
          {#if isRunning}
            <span class="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-yellow-400"
            ></span>
          {:else if isDone}
            <span class="shrink-0">✓</span>
          {:else if isError}
            <span class="shrink-0">✕</span>
          {/if}
          <span class="max-w-32 truncate font-medium">{task.name}</span>
          <span class="shrink-0 capitalize opacity-70"
            >{task.type === 'equilibration' && task.engine ? task.engine : task.type}</span
          >
          {#if isRunning || isDone}
            <!-- Progress bar -->
            <div class="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-neutral-700">
              <div
                class="h-full rounded-full transition-all {isDone ? 'bg-green-500' : 'bg-blue-500'}"
                style="width:{pct}%"
              ></div>
            </div>
            <span class="shrink-0 tabular-nums">{pct}%</span>
          {/if}
          {#if isRunning && task.start_time}
            <span class="shrink-0 opacity-60">{elapsed(task.start_time)}</span>
          {/if}
          {#if isError && task.error}
            <span class="max-w-40 truncate opacity-80" title={task.error}>{task.error}</span>
          {/if}
        </div>
      {/each}
    {/if}
  </footer>
</div>
