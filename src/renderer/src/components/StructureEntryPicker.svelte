<script>
  /**
   * Multi-entry picker for Maestro CTs / multi-MODEL PDBs.
   * Styled like other Visualize dialogs (neutral + yellow accents, light/dark).
   * @typedef {{
   *   index: number,
   *   label: string,
   *   atomCount?: number,
   *   title?: string,
   *   properties?: import('../lib/maestroProperties.js').MaestroProperty[]
   * }} StructureInspectEntry
   */
  import { themeState } from '../lib/theme.svelte.js'
  import Spinner from './ui/Spinner.svelte'
  import {
    collectRealPropertyNames,
    displayPropertyLabel,
    formatHeadlineLine,
    formatHeadlineValue,
    loadSavedHeadlinePropertyName,
    normalizeMaestroProperties,
    pickHeadlineProperty,
    saveHeadlinePropertyName
  } from '../lib/maestroProperties.js'

  /** @type {{
   *   open: boolean,
   *   title?: string,
   *   sourcePath?: string,
   *   entries: StructureInspectEntry[],
   *   loading?: boolean,
   *   loadingMessage?: string,
   *   headlineProperty?: string,
   *   onHeadlinePropertyChange?: (name: string) => void,
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
    headlineProperty = '',
    onHeadlinePropertyChange,
    onConfirm,
    onCancel
  } = $props()

  /** @type {Set<number>} */
  let selected = $state(new Set())
  /** @type {'index' | 'score' | null} */
  let sortKey = $state(null)
  /** @type {'asc' | 'desc'} */
  let sortDir = $state('asc')
  /** Local draft until parent syncs; seeded from prop / localStorage. */
  let localHeadline = $state('')
  const isDark = $derived(themeState.current === 'dark')

  const preferredHeadline = $derived(
    typeof headlineProperty === 'string' && headlineProperty
      ? headlineProperty
      : localHeadline
  )

  const realNames = $derived(
    collectRealPropertyNames(
      (entries || []).map((e) => ({ properties: normalizeMaestroProperties(e.properties) }))
    )
  )

  const rows = $derived(
    (entries || []).map((entry) => {
      const properties = normalizeMaestroProperties(entry.properties)
      const headline = pickHeadlineProperty(properties, preferredHeadline || null)
      return {
        entry,
        properties,
        headline,
        scoreText: formatHeadlineValue(headline),
        scoreLine: formatHeadlineLine(headline),
        scoreValue: headline && headline.type === 'real' ? Number(headline.value) : null
      }
    })
  )

  const hasAnyScore = $derived(realNames.length > 0)

  const scoreColumnLabel = $derived.by(() => {
    if (preferredHeadline) return displayPropertyLabel(preferredHeadline)
    const sample = rows.find((r) => r.headline)?.headline
    if (sample) return displayPropertyLabel(sample.name)
    return 'Score'
  })

  const autoHint = $derived.by(() => {
    if (preferredHeadline) return displayPropertyLabel(preferredHeadline)
    const sample = rows.find((r) => r.headline)?.headline
    if (sample) return `Auto → ${displayPropertyLabel(sample.name)}`
    return 'Auto (first available score)'
  })

  const displayRows = $derived.by(() => {
    const list = [...rows]
    if (sortKey === 'score') {
      list.sort((a, b) => {
        const av = a.scoreValue
        const bv = b.scoreValue
        const aMissing = av == null || !Number.isFinite(av)
        const bMissing = bv == null || !Number.isFinite(bv)
        if (aMissing && bMissing) return a.entry.index - b.entry.index
        if (aMissing) return 1
        if (bMissing) return -1
        const cmp = av - bv
        return sortDir === 'asc' ? cmp : -cmp
      })
    } else if (sortKey === 'index') {
      list.sort((a, b) => {
        const cmp = a.entry.index - b.entry.index
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return list
  })

  $effect(() => {
    if (open && !loading && entries?.length) {
      selected = new Set(entries.map((e) => e.index))
      sortKey = null
      sortDir = 'asc'
      if (!headlineProperty) {
        localHeadline = loadSavedHeadlinePropertyName()
      }
    }
    if (open && loading) {
      selected = new Set()
    }
  })

  $effect(() => {
    if (typeof headlineProperty === 'string') {
      localHeadline = headlineProperty
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

  /** @param {'index' | 'score'} key */
  function toggleSort(key) {
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc'
    } else {
      sortKey = key
      sortDir = 'asc'
    }
  }

  /** @param {Event} e */
  function onHeadlineSelect(e) {
    const el = e.currentTarget
    if (!(el instanceof HTMLSelectElement)) return
    const next = el.value
    localHeadline = next
    saveHeadlinePropertyName(next)
    onHeadlinePropertyChange?.(next)
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
      class="flex max-h-[min(80vh,560px)] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-neutral-300 bg-white text-neutral-900 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
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
          class="flex shrink-0 flex-wrap items-center gap-2 border-b border-neutral-200 px-4 py-2 dark:border-neutral-700"
        >
          <button type="button" class="dialog-btn-outline" onclick={selectAll}>Select all</button>
          <button type="button" class="dialog-btn-outline" onclick={selectNone}>Select none</button>
          {#if hasAnyScore}
            <label class="ml-2 flex min-w-0 items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
              <span class="shrink-0">Show score</span>
              <select
                class="max-w-[14rem] rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-xs text-neutral-900 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100"
                value={preferredHeadline}
                onchange={onHeadlineSelect}
                title="Property shown in the score column and under loaded poses. Auto picks MMGBSA ΔG bind, then docking score, Glide gscore, Prime energy, or the first other real."
              >
                <option value="">Auto</option>
                {#each realNames as name (name)}
                  <option value={name}>{displayPropertyLabel(name)}</option>
                {/each}
              </select>
            </label>
          {/if}
          <span class="ml-auto self-center text-xs tabular-nums text-neutral-500 dark:text-neutral-400"
            >{selected.size} selected</span
          >
        </div>

        {#if hasAnyScore}
          <p class="shrink-0 border-b border-neutral-200 px-4 py-1 text-[10px] text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
            Score column: {autoHint}. Energies are kcal/mol. Change “Show score” to use another property.
          </p>
          <div
            class="grid shrink-0 grid-cols-[auto_minmax(0,1fr)_11rem] gap-2 border-b border-neutral-200 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
          >
            <span class="w-3.5"></span>
            <button
              type="button"
              class="text-left hover:text-neutral-800 dark:hover:text-neutral-200"
              onclick={() => toggleSort('index')}
            >Entry{sortKey === 'index' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</button>
            <button
              type="button"
              class="truncate text-right hover:text-neutral-800 dark:hover:text-neutral-200"
              onclick={() => toggleSort('score')}
              title="Sort by {scoreColumnLabel}. Selection checkboxes stay as they are."
            >{scoreColumnLabel}{sortKey === 'score' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</button>
          </div>
        {/if}

        <ul class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {#each displayRows as row (row.entry.index)}
            <li>
              <label
                class="grid cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800/80 {hasAnyScore
                  ? 'grid-cols-[auto_minmax(0,1fr)_11rem]'
                  : 'grid-cols-[auto_minmax(0,1fr)]'}"
              >
                <input
                  type="checkbox"
                  class="mt-0.5 size-3.5 shrink-0 accent-yellow-500"
                  checked={selected.has(row.entry.index)}
                  onchange={() => toggle(row.entry.index)}
                />
                <span class="min-w-0">
                  <span class="block truncate text-sm text-neutral-900 dark:text-neutral-100"
                    >{row.entry.label}</span
                  >
                  {#if row.entry.atomCount != null}
                    <span class="text-xs text-neutral-500 dark:text-neutral-400"
                      >{row.entry.atomCount.toLocaleString()} atoms</span
                    >
                  {/if}
                </span>
                {#if hasAnyScore}
                  <span
                    class="truncate text-right text-xs tabular-nums text-neutral-700 dark:text-neutral-300"
                    title={row.headline ? `${row.headline.name} = ${row.scoreText}` : preferredHeadline || ''}
                  >{row.scoreText || '—'}</span>
                {/if}
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
