<script>
  /**
   * Non-modal table of Maestro CT properties for loaded poses from one source file.
   */
  import {
    FAMILY_LABELS,
    collectRealPropertyNames,
    defaultVisibleColumns,
    displayPropertyLabel,
    findProperty,
    formatPropertyCell,
    groupPropertyColumns,
    loadSavedVisibleColumns,
    pickHeadlineProperty,
    saveVisibleColumns
  } from '../lib/maestroProperties.js'

  /**
   * @typedef {import('../lib/visualizeStructures.js').StructureEntry} StructureEntry
   */

  /** @type {{
   *   structures: StructureEntry[],
   *   activeStructureId: string | null,
   *   headlineProperty?: string,
   *   onHeadlinePropertyChange?: (name: string) => void,
   *   onActivate: (structureId: string) => void,
   *   onApplyOrder?: (orderedIds: string[]) => void,
   *   onClose: () => void
   * }} */
  let {
    structures = [],
    activeStructureId = null,
    headlineProperty = '',
    onHeadlinePropertyChange,
    onActivate,
    onApplyOrder,
    onClose
  } = $props()

  const active = $derived(
    structures.find((st) => st.id === activeStructureId) ||
      structures.find((st) => st.kind === 'maestro_ct') ||
      null
  )

  const sourcePath = $derived(String(active?.sourcePath || ''))

  const rows = $derived(
    structures.filter(
      (st) =>
        st.kind === 'maestro_ct' &&
        sourcePath &&
        String(st.sourcePath || '') === sourcePath
    )
  )

  const columnGroups = $derived(groupPropertyColumns(rows))
  const allColumnNames = $derived(columnGroups.flatMap((g) => g.names))

  /** @type {string[]} */
  let visibleColumns = $state([])
  let columnsOpen = $state(false)
  /** @type {string | null} */
  let sortColumn = $state(null)
  /** @type {'asc' | 'desc'} */
  let sortDir = $state('asc')
  /** Last column set we initialized from (plain let so the effect does not re-subscribe). */
  let columnsInitKey = ''

  $effect(() => {
    const names = allColumnNames
    const groups = columnGroups
    const key = `${sourcePath}\n${names.join('\n')}`
    if (key === columnsInitKey) return
    columnsInitKey = key
    if (!names.length) {
      visibleColumns = []
      return
    }
    const saved = loadSavedVisibleColumns()
    if (saved?.length) {
      const keep = saved.filter((n) => names.includes(n))
      visibleColumns = keep.length ? keep : defaultVisibleColumns(groups)
    } else {
      visibleColumns = defaultVisibleColumns(groups)
    }
  })

  const displayColumns = $derived(
    visibleColumns.filter((n) => allColumnNames.includes(n))
  )

  const sortedRows = $derived.by(() => {
    const list = [...rows]
    if (!sortColumn) {
      list.sort((a, b) => (a.ctIndex ?? 0) - (b.ctIndex ?? 0))
      return list
    }
    list.sort((a, b) => {
      const pa = findProperty(a.properties, sortColumn)
      const pb = findProperty(b.properties, sortColumn)
      const aMissing = !pa
      const bMissing = !pb
      if (aMissing && bMissing) return (a.ctIndex ?? 0) - (b.ctIndex ?? 0)
      if (aMissing) return 1
      if (bMissing) return -1
      let cmp = 0
      if (pa.type === 'real' || pa.type === 'integer') {
        cmp = Number(pa.value) - Number(pb.value)
      } else if (pa.type === 'boolean') {
        cmp = Number(Boolean(pa.value)) - Number(Boolean(pb.value))
      } else {
        cmp = String(pa.value).localeCompare(String(pb.value))
      }
      if (cmp === 0) return (a.ctIndex ?? 0) - (b.ctIndex ?? 0)
      return sortDir === 'asc' ? cmp : -cmp
    })
    return list
  })

  const emptyBecauseOpenBabel = $derived(
    rows.length > 0 && rows.every((st) => !(st.properties && st.properties.length))
  )

  const realNames = $derived(collectRealPropertyNames(rows))

  const headlineHint = $derived.by(() => {
    if (headlineProperty) return displayPropertyLabel(headlineProperty)
    const sample = rows.map((st) => pickHeadlineProperty(st.properties, null)).find(Boolean)
    if (sample) return `Auto → ${displayPropertyLabel(sample.name)}`
    return 'Auto'
  })

  /** @param {Event} e */
  function onHeadlineSelect(e) {
    const el = e.currentTarget
    if (!(el instanceof HTMLSelectElement)) return
    onHeadlinePropertyChange?.(el.value)
  }

  /** @param {string} name */
  function toggleColumn(name) {
    const next = visibleColumns.includes(name)
      ? visibleColumns.filter((n) => n !== name)
      : [...visibleColumns, name]
    visibleColumns = next
    saveVisibleColumns(next)
  }

  /** @param {string} name */
  function toggleSort(name) {
    if (sortColumn === name) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc'
    } else {
      sortColumn = name
      sortDir = 'asc'
    }
  }

  function showDefaults() {
    const next = defaultVisibleColumns(columnGroups)
    visibleColumns = next
    saveVisibleColumns(next)
  }

  function showAll() {
    visibleColumns = [...allColumnNames]
    saveVisibleColumns(visibleColumns)
  }
</script>

<div
  class="viewer-side-panel--nonmodal fixed top-10 bottom-10 left-16 z-50 flex w-[min(720px,calc(100vw-5rem))] max-w-[calc(100vw-5rem)] flex-col overflow-hidden rounded-lg border border-neutral-300 bg-white p-0 text-neutral-900 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
  role="dialog"
  aria-labelledby="maestro-properties-title"
>
  <div class="flex items-center justify-between gap-2 border-b dialog-divider px-4 py-2.5">
    <div class="min-w-0">
      <h3 id="maestro-properties-title" class="text-sm font-semibold">Maestro properties</h3>
      {#if sourcePath}
        <p class="truncate text-[11px] text-neutral-500" title={sourcePath}>
          {sourcePath.split(/[/\\]/).pop()} · {rows.length} loaded
          · energies in kcal/mol
        </p>
      {/if}
    </div>
    <div class="flex shrink-0 items-center gap-1">
      <button
        type="button"
        class="dialog-btn-outline px-2 py-0.5 text-xs"
        onclick={() => (columnsOpen = !columnsOpen)}
      >{columnsOpen ? 'Hide columns' : 'Columns'}</button>
      <button type="button" class="dialog-btn-outline px-2 py-0.5 text-xs" onclick={onClose}>✕</button>
    </div>
  </div>

  {#if realNames.length}
    <div
      class="flex shrink-0 flex-wrap items-center gap-2 border-b border-neutral-200 px-3 py-2 text-[11px] dark:border-neutral-700"
    >
      <label class="flex min-w-0 items-center gap-1.5 text-neutral-600 dark:text-neutral-300">
        <span class="shrink-0">On structure rows</span>
        <select
          class="max-w-[16rem] rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-[11px] text-neutral-900 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100"
          value={headlineProperty}
          onchange={onHeadlineSelect}
          title="Property shown under each loaded Maestro pose and in the entry-picker score column. Auto uses MMGBSA ΔG bind, then docking score, Glide gscore, Prime energy, or the first other real."
        >
          <option value="">Auto</option>
          {#each realNames as name (name)}
            <option value={name}>{displayPropertyLabel(name)}</option>
          {/each}
        </select>
      </label>
      <span class="text-neutral-500">{headlineHint}</span>
      {#if sortColumn && onApplyOrder}
        <button
          type="button"
          class="dialog-btn-outline ml-auto px-2 py-0.5"
          title="Reorder the Representations list to match this table sort"
          onclick={() => onApplyOrder(sortedRows.map((st) => st.id))}
        >Apply order to list</button>
      {/if}
    </div>
  {/if}

  {#if columnsOpen}
    <div
      class="max-h-[40%] shrink-0 space-y-2 overflow-y-auto border-b border-neutral-200 px-3 py-2 text-[11px] dark:border-neutral-700"
    >
      <div class="flex gap-2">
        <button type="button" class="dialog-btn-outline px-2 py-0.5" onclick={showDefaults}
          >Defaults</button
        >
        <button type="button" class="dialog-btn-outline px-2 py-0.5" onclick={showAll}>All</button>
      </div>
      {#each columnGroups as group (group.family)}
        <section>
          <p class="mb-1 font-semibold text-neutral-600 dark:text-neutral-300">
            {FAMILY_LABELS[group.family] || group.family}
          </p>
          <div class="flex flex-wrap gap-x-3 gap-y-1">
            {#each group.names as name (name)}
              <label class="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  class="size-3 accent-yellow-500"
                  checked={visibleColumns.includes(name)}
                  onchange={() => toggleColumn(name)}
                />
                <span title={name}>{displayPropertyLabel(name)}</span>
              </label>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {/if}

  <div class="min-h-0 flex-1 overflow-auto">
    {#if !rows.length}
      <p class="px-4 py-6 text-xs text-neutral-500">
        Load a Maestro file to compare pose properties.
      </p>
    {:else if emptyBecauseOpenBabel}
      <p class="px-4 py-6 text-xs text-neutral-500">
        This file was opened with the Open Babel fallback, which does not read Maestro scores.
        Install RDKit in the app environment to show Glide, MM/GBSA, and IFD properties.
      </p>
    {:else if !displayColumns.length}
      <p class="px-4 py-6 text-xs text-neutral-500">
        No columns selected. Open Columns and turn some properties on.
      </p>
    {:else}
      <table class="min-w-full border-collapse text-[11px]">
        <thead class="sticky top-0 z-10 bg-neutral-100 dark:bg-neutral-950">
          <tr class="border-b border-neutral-200 dark:border-neutral-700">
            <th class="px-2 py-1.5 text-left font-semibold">Pose</th>
            {#each displayColumns as name (name)}
              <th class="px-2 py-1.5 text-right font-semibold">
                <button
                  type="button"
                  class="w-full text-right hover:text-yellow-600 dark:hover:text-yellow-400"
                  title="{name} (kcal/mol when an energy)"
                  onclick={() => toggleSort(name)}
                >
                  {displayPropertyLabel(name)}{sortColumn === name
                    ? sortDir === 'asc'
                      ? ' ↑'
                      : ' ↓'
                    : ''}
                </button>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each sortedRows as st (st.id)}
            <tr
              class="cursor-pointer border-b border-neutral-100 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/60 {activeStructureId ===
              st.id
                ? 'bg-yellow-500/10'
                : ''}"
              onclick={() => onActivate(st.id)}
            >
              <td class="max-w-[12rem] truncate px-2 py-1 font-medium" title={st.label}>{st.label}</td>
              {#each displayColumns as name (name)}
                <td
                  class="px-2 py-1 text-right tabular-nums text-neutral-700 dark:text-neutral-300"
                  title={name}
                >{formatPropertyCell(findProperty(st.properties, name)) || '—'}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>
