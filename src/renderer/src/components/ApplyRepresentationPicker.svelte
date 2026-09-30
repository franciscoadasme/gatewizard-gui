<script>
  /**
   * Pick target structures when cloning a representation (Apply to…).
   * Styled like StructureEntryPicker and other Visualize dialogs.
   * @typedef {{ id: string, label: string }} StructureOption
   */
  import { themeState } from '../lib/theme.svelte.js'

  /** @type {{
   *   open: boolean,
   *   sourceLabel?: string,
   *   targets: StructureOption[],
   *   selected: Set<string>,
   *   busy?: boolean,
   *   phase?: string,
   *   onSelectedChange?: (next: Set<string>) => void,
   *   onConfirm?: () => void | Promise<void>,
   *   onCancel?: () => void
   * }} */
  let {
    open = false,
    sourceLabel = '',
    targets = [],
    selected = new Set(),
    busy = false,
    phase = '',
    onSelectedChange,
    onConfirm,
    onCancel
  } = $props()

  const isDark = $derived(themeState.current === 'dark')

  function toggle(id) {
    if (busy) return
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onSelectedChange?.(next)
  }

  function selectAll() {
    if (busy) return
    onSelectedChange?.(new Set(targets.map((t) => t.id)))
  }

  function selectNone() {
    if (busy) return
    onSelectedChange?.(new Set())
  }

  function cancel() {
    if (busy) return
    onCancel?.()
  }

  async function confirm() {
    if (busy || !selected.size) return
    await onConfirm?.()
  }

  /** @param {KeyboardEvent} e */
  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    } else if (e.key === 'Enter' && selected.size > 0 && !busy) {
      e.preventDefault()
      void confirm()
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
      if (e.target === e.currentTarget && !busy) cancel()
    }}
  >
    <div
      class="flex max-h-[min(80vh,480px)] w-full max-w-md flex-col overflow-hidden rounded-lg border border-neutral-300 bg-white text-neutral-900 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
      role="dialog"
      aria-modal="true"
      aria-busy={busy}
      aria-label="Apply representation to"
      tabindex="-1"
    >
      <div
        class="flex shrink-0 items-start justify-between gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-700"
      >
        <div class="min-w-0">
          <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100"
            >{busy ? 'Copying representation…' : 'Apply representation to…'}</h2
          >
          {#if busy && phase}
            <p class="mt-0.5 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">{phase}</p>
          {:else if sourceLabel}
            <p class="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400" title={sourceLabel}>
              {sourceLabel}
            </p>
          {/if}
        </div>
        <button
          type="button"
          class="relative -mr-1 -mt-0.5 min-h-8 min-w-8 rounded px-2 text-lg leading-none text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-white"
          aria-label="Close"
          disabled={busy}
          onclick={cancel}
        >&times;</button>
      </div>

      {#if busy}
        <div class="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-10">
          <div
            class="size-8 animate-spin rounded-full border-2 border-yellow-500 border-t-transparent"
            aria-hidden="true"
          ></div>
          <p class="text-center text-xs text-neutral-600 dark:text-neutral-300">
            Matching selection and style on each structure…
          </p>
          {#if phase}
            <p class="text-xs tabular-nums text-neutral-500 dark:text-neutral-400">{phase}</p>
          {/if}
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
          {#each targets as target (target.id)}
            <li>
              <label
                class="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800/80"
              >
                <input
                  type="checkbox"
                  class="size-3.5 shrink-0 accent-yellow-500"
                  checked={selected.has(target.id)}
                  onchange={() => toggle(target.id)}
                />
                <span class="min-w-0 truncate text-sm text-neutral-900 dark:text-neutral-100"
                  >{target.label}</span
                >
              </label>
            </li>
          {/each}
          {#if targets.length === 0}
            <li class="px-2 py-3 text-xs text-neutral-500 dark:text-neutral-400"
              >No other structures loaded.</li
            >
          {/if}
        </ul>
      {/if}

      <div
        class="flex shrink-0 justify-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-700"
      >
        <button type="button" class="dialog-btn-outline" disabled={busy} onclick={cancel}>Cancel</button>
        <button
          type="button"
          class="rounded bg-yellow-600 px-3 py-1 text-xs font-semibold text-black transition-colors hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!selected.size || busy}
          onclick={() => void confirm()}
        >{busy ? 'Copying…' : 'Apply'}</button>
      </div>
    </div>
  </div>
{/if}
