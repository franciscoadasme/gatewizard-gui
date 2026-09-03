<script>
  import { moveIdInList, normalizeIdList } from '../lib/analysisGridLayout.js'

  let {
    /** @type {string[]} */
    setIds = [],
    /** @type {Array<{ id: string, label?: string, legendLabel?: string }>} */
    sets = [],
    /** @type {(ids: string[]) => void} */
    onchange = undefined
  } = $props()

  const ordered = $derived(normalizeIdList(setIds))

  function nameOf(id) {
    const set = sets.find((s) => s.id === id)
    const custom = String(set?.legendLabel || '').trim()
    return custom || set?.label || id
  }

  function emit(next) {
    onchange?.(normalizeIdList(next))
  }

  function add(id) {
    const nextId = String(id || '').trim()
    if (!nextId || ordered.includes(nextId)) return
    emit([...ordered, nextId])
  }

  function removeAt(index) {
    emit(ordered.filter((_, i) => i !== index))
  }

  function move(index, dir) {
    emit(moveIdInList(ordered, index, dir))
  }
</script>

<div class="space-y-1">
  {#if ordered.length === 0}
    <p class="sidebar-hint">No sets assigned.</p>
  {:else}
    <ul class="space-y-0.5">
      {#each ordered as id, i (id)}
        <li
          class="flex items-center gap-0.5 rounded border border-neutral-200 bg-neutral-50 px-1 py-0.5 text-[11px] text-neutral-800 dark:border-neutral-800 dark:bg-neutral-950/60 dark:text-neutral-200"
        >
          <span class="min-w-0 flex-1 truncate" title={nameOf(id)}>{nameOf(id)}</span>
          <button
            type="button"
            class="rounded px-1 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 disabled:opacity-30 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            disabled={i === 0}
            onclick={() => move(i, -1)}
            title="Move up">↑</button
          >
          <button
            type="button"
            class="rounded px-1 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 disabled:opacity-30 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            disabled={i === ordered.length - 1}
            onclick={() => move(i, 1)}
            title="Move down">↓</button
          >
          <button
            type="button"
            class="rounded px-1 text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-500 dark:hover:bg-red-950/40 dark:hover:text-red-300"
            onclick={() => removeAt(i)}
            title="Remove">✕</button
          >
        </li>
      {/each}
    </ul>
  {/if}
  {#if sets.length > 0}
    <select
      class="w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-800 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-200"
      value=""
      onchange={(e) => {
        const el = /** @type {HTMLSelectElement} */ (e.currentTarget)
        add(el.value)
        el.value = ''
      }}
    >
      <option value="">Add set</option>
      {#each sets as s (s.id)}
        <option value={s.id} disabled={ordered.includes(s.id)}>{nameOf(s.id)}</option>
      {/each}
    </select>
  {/if}
</div>
