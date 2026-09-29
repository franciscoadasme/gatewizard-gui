<script>
  /**
   * Multi-entry picker for Maestro CTs / multi-MODEL PDBs.
   * Styled like other Visualize dialogs (neutral + yellow accents, light/dark).
   * @typedef {{ index: number, label: string, atomCount?: number, title?: string }} StructureInspectEntry
   */
  import { themeState } from '../lib/theme.svelte.js'
  import Spinner from './ui/Spinner.svelte'

  /** @type {{
   *   open: boolean,
   *   title?: string,
   *   sourcePath?: string,
   *   entries: StructureInspectEntry[],
   *   loading?: boolean,
   *   loadingMessage?: string,
   *   onConfirm?: (indices: number[]) => void,
   *   onCancel?: () => void
   * }} */
  let {
    open = false,
    title = 'Select structures to load',
    sourcePath = '',
    entries = [],
    loading = false,
    loadingMessage = 'Reading file…',
    onConfirm,
    onCancel
  } = $props()

  /** @type {Set<number>} */
  let selected = $state(new Set())
  const isDark = $derived(themeState.current === 'dark')

  $effect(() => {
    if (open && !loading && entries?.length) {
      selected = new Set(entries.map((e) => e.index))
    }
    if (open && loading) {
      selected = new Set()
    }
  })

  function toggle(index) {
    if (loading) return
    const next = new Set(selected)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    selected = next
  }

  function selectAll() {
    if (loading) return
    selected = new Set(entries.map((e) => e.index))
  }

  function selectNone() {
    if (loading) return
    selected = new Set()
  }

  function confirm() {
    if (loading) return
    const indices = [...selected].sort((a, b) => a - b)
    onConfirm?.(indices)
  }

  function cancel() {
    onCancel?.()
  }

  /** @param {KeyboardEvent} e */
  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    } else if (e.key === 'Enter' && !loading && selected.size > 0) {
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
      aria-busy={loading}
      aria-label={loading ? loadingMessage : title}
      tabindex="-1"
    >
      <div
        class="flex shrink-0 items-start justify-between gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-700"
      >
        <div class="min-w-0">
          <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {loading ? 'Reading structures…' : title}
          </h2>
          {#if sourcePath}
            <p class="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400" title={sourcePath}>
              {sourcePath.split(/[/\\]/).pop()}
              {#if !loading}
                · {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}
              {/if}
            </p>
          {/if}
        </div>
        <button
          type="button"
          class="relative -mr-1 -mt-0.5 min-h-8 min-w-8 rounded px-2 text-lg leading-none text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-white"
          aria-label="Close"
          onclick={cancel}
        >&times;</button>
      </div>

      {#if loading}
        <div
          class="flex min-h-[12rem] flex-1 flex-col items-center justify-center gap-3 px-4 py-8 text-center"
        >
          <Spinner className="size-8 text-yellow-500" label={loadingMessage} />
          <p class="text-sm text-neutral-700 dark:text-neutral-200">{loadingMessage}</p>
          <p class="max-w-xs text-xs text-neutral-500 dark:text-neutral-400">
            Listing entries in this file. The selection list will appear when ready.
          </p>
        </div>
      {:else}
        <div
          class="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-4 py-2 dark:border-neutral-700"
        >
          <button type="button" class="dialog-btn-outline" onclick={selectAll}>Select all</button>
          <button type="button" class="dialog-btn-outline" onclick={selectNone}>Select none</button>
          <span class="ml-auto self-center text-xs tabular-nums text-neutral-500 dark:text-neutral-400"
            >{selected.size} selected</span
          >
        </div>

        <ul class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {#each entries as entry (entry.index)}
            <li>
              <label
                class="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800/80"
              >
                <input
                  type="checkbox"
                  class="mt-0.5 size-3.5 shrink-0 accent-yellow-500"
                  checked={selected.has(entry.index)}
                  onchange={() => toggle(entry.index)}
                />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm text-neutral-900 dark:text-neutral-100"
                    >{entry.label}</span
                  >
                  {#if entry.atomCount != null}
                    <span class="text-xs text-neutral-500 dark:text-neutral-400"
                      >{entry.atomCount.toLocaleString()} atoms</span
                    >
                  {/if}
                </span>
              </label>
            </li>
          {/each}
        </ul>
      {/if}

      <div
        class="flex shrink-0 justify-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-700"
      >
        <button type="button" class="dialog-btn-outline" onclick={cancel}>Cancel</button>
        <button
          type="button"
          class="rounded bg-yellow-600 px-3 py-1 text-xs font-semibold text-black transition-colors hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={loading || selected.size === 0}
          onclick={confirm}
        >Load selected</button
        >
      </div>
    </div>
  </div>
{/if}
