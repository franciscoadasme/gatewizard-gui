<script>
  /**
   * Open one topology + one or more trajectories with per-file stride.
   * Drag ⠿ to live-reorder files before Load.
   */
  import { flip } from 'svelte/animate'
  import { themeState } from '../lib/theme.svelte.js'
  import { liveReorderAtMidpoint, LIST_REORDER_FLIP } from '../lib/liveListReorder.js'

  /** @typedef {{ path: string, stride: number }} TrajFile */

  /** @type {{
   *   open: boolean,
   *   defaultPath?: string,
   *   onConfirm?: (payload: { topologyPath: string, files: TrajFile[] }) => void,
   *   onCancel?: () => void
   * }} */
  let { open = false, defaultPath = '', onConfirm, onCancel } = $props()

  let topologyPath = $state('')
  /** @type {TrajFile[]} */
  let files = $state([])
  /** @type {string | null} */
  let trajDragPath = $state(null)
  const isDark = $derived(themeState.current === 'dark')
  const canLoad = $derived(Boolean(topologyPath) && files.length > 0)

  $effect(() => {
    if (open) {
      topologyPath = ''
      files = []
      trajDragPath = null
    }
  })

  function basename(p) {
    return String(p || '').split(/[/\\]/).pop() || p
  }

  async function pickTopology() {
    const dlg = await window.api.openFileDialog(
      'Open topology',
      [
        { name: 'Topology', extensions: ['pdb', 'ent', 'gro', 'psf', 'prmtop', 'parm7'] },
        { name: 'All files', extensions: ['*'] }
      ],
      defaultPath || undefined
    )
    if (dlg?.canceled || !dlg.filePath) return
    topologyPath = dlg.filePath
  }

  async function pickTrajectories() {
    const dlg = await window.api.openFilesDialog(
      'Open trajectories',
      [
        { name: 'Trajectory', extensions: ['xtc', 'dcd', 'trr', 'nc', 'mdcrd', 'pdb', 'ent'] },
        { name: 'All files', extensions: ['*'] }
      ],
      defaultPath || topologyPath || undefined
    )
    if (dlg?.canceled || !dlg.filePaths?.length) return
    const have = new Set(files.map((f) => f.path))
    const next = [...files]
    for (const path of dlg.filePaths) {
      if (have.has(path)) continue
      next.push({ path, stride: 1 })
      have.add(path)
    }
    files = next
  }

  function removeFile(path) {
    files = files.filter((f) => f.path !== path)
  }

  function setStride(path, raw) {
    const stride = Math.max(1, Math.min(999, Math.round(Number(raw) || 1)))
    files = files.map((f) => (f.path === path ? { ...f, stride } : f))
  }

  /** @param {number} index @param {DragEvent} [e] */
  function onTrajDragStart(index, e) {
    const row = files[index]
    if (!row?.path) return
    trajDragPath = row.path
    if (e?.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', row.path)
    }
  }

  /** @param {DragEvent} e @param {number} index */
  function onTrajDragOver(e, index) {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    if (!trajDragPath) return
    const from = files.findIndex((f) => f.path === trajDragPath)
    const next = liveReorderAtMidpoint(
      files,
      from,
      index,
      e.clientY,
      /** @type {Element} */ (e.currentTarget)
    )
    if (!next) return
    files = next
  }

  function onTrajDragEnd() {
    trajDragPath = null
  }

  /** @param {DragEvent} e */
  function onDropTrajectory(e) {
    e.preventDefault()
    onTrajDragEnd()
  }

  function confirm() {
    if (!canLoad) return
    onConfirm?.({ topologyPath, files: files.map((f) => ({ ...f })) })
  }

  function cancel() {
    onCancel?.()
  }

  /** @param {KeyboardEvent} e */
  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    } else if (e.key === 'Enter' && canLoad) {
      e.preventDefault()
      confirm()
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 {isDark ? 'dark' : ''}"
    role="presentation"
    onkeydown={onKeydown}
    onclick={(e) => {
      if (e.target === e.currentTarget) cancel()
    }}
  >
    <div
      class="flex max-h-[min(80vh,560px)] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-neutral-300 bg-white text-neutral-900 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
      role="dialog"
      aria-modal="true"
      aria-label="Open trajectory"
      tabindex="-1"
    >
      <div
        class="flex shrink-0 items-start justify-between gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-700"
      >
        <div class="min-w-0">
          <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Open trajectory
          </h2>
          <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            One topology plus one or more coordinate files. Stride is per file. Drag ⠿ to reorder.
          </p>
        </div>
        <button
          type="button"
          class="relative -mr-1 -mt-0.5 min-h-8 min-w-8 rounded px-2 text-lg leading-none text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-white"
          aria-label="Close"
          onclick={cancel}
        >&times;</button>
      </div>

      <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <section class="space-y-1.5">
          <p class="text-xs font-medium text-neutral-700 dark:text-neutral-300">Topology</p>
          <div class="flex items-center gap-2">
            <p
              class="min-w-0 flex-1 truncate rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-800"
              title={topologyPath}
            >
              {topologyPath ? basename(topologyPath) : 'pdb / gro / psf / prmtop'}
            </p>
            <button type="button" class="dialog-btn-outline shrink-0" onclick={pickTopology}
              >Browse…</button
            >
          </div>
        </section>

        <section class="space-y-1.5">
          <div class="flex items-center justify-between">
            <p class="text-xs font-medium text-neutral-700 dark:text-neutral-300">Trajectories</p>
            <button type="button" class="dialog-btn-outline" onclick={pickTrajectories}
              >Add files…</button
            >
          </div>
          {#if !files.length}
            <p class="text-xs text-neutral-500 dark:text-neutral-400">
              xtc, dcd, trr, nc, mdcrd (or a multi-model PDB)
            </p>
          {:else}
            <ul class="space-y-1">
              {#each files as file, i (file.path)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <li
                  animate:flip={LIST_REORDER_FLIP}
                  ondragover={(e) => onTrajDragOver(e, i)}
                  ondrop={onDropTrajectory}
                  class="relative flex items-center gap-2 rounded-md border border-transparent px-1 py-1 transition-[opacity,box-shadow,border-color,background-color] duration-150 hover:bg-neutral-100 dark:hover:bg-neutral-800/80
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
                  <span class="min-w-0 flex-1 truncate text-xs" title={file.path}
                    >{basename(file.path)}</span
                  >
                  <label class="flex shrink-0 items-center gap-1 text-[10px] text-neutral-500">
                    Stride
                    <input
                      type="number"
                      min="1"
                      max="999"
                      class="w-14 rounded border border-neutral-300 bg-white px-1 py-0.5 text-xs tabular-nums dark:border-neutral-600 dark:bg-neutral-800"
                      value={file.stride}
                      oninput={(e) => setStride(file.path, e.currentTarget.value)}
                    />
                  </label>
                  <button
                    type="button"
                    class="text-xs text-neutral-500 hover:text-red-500"
                    onclick={() => removeFile(file.path)}>Remove</button
                  >
                </li>
              {/each}
            </ul>
            <p class="text-[10px] text-neutral-500 dark:text-neutral-400">
              Stride 1–999 (1 = all frames). Drag ⠿ to reorder the load order.
            </p>
          {/if}
        </section>
      </div>

      <div
        class="flex shrink-0 justify-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-700"
      >
        <button type="button" class="dialog-btn-outline" onclick={cancel}>Cancel</button>
        <button
          type="button"
          class="rounded bg-yellow-600 px-3 py-1 text-xs font-semibold text-black transition-colors hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!canLoad}
          onclick={confirm}
        >Load</button
        >
      </div>
    </div>
  </div>
{/if}
