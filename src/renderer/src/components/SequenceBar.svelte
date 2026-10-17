<script>
  import {
    allResidueKeys,
    clickResidueSelection,
    keysInRange,
    parseGapSequence,
    sequenceToText
  } from '../lib/viewer/sequenceBar.js'

  /**
   * @type {{
   *   chains: Array<{ chain: string, items: object[] }>,
   *   selected: Set<string>,
   *   busy?: boolean,
   *   note?: string,
   *   onSelect: (keys: Set<string>, opts?: { focus?: boolean }) => void,
   *   onContextMenu: (event: MouseEvent) => void,
   *   onFill: (gaps: Array<{ chain: string, after: number, before: number, sequence: string[] }>) => void,
   *   onClose: () => void
   * }}
   */
  let {
    chains = [],
    selected = new Set(),
    busy = false,
    note = '',
    onSelect,
    onContextMenu,
    onFill,
    onClose
  } = $props()

  let anchorKey = $state('')
  let dragging = $state(false)
  let dragMoved = $state(false)
  let shiftDrag = false
  /** @type {Set<string> | null} */
  let dragKeys = $state(null)
  /** @type {Set<string>} */
  let selectionAtDrag = new Set()
  /** @type {{ items: object[], centered: boolean, x: number, y: number } | null} */
  let gapEditor = $state(null)
  /** @type {Record<string, string>} */
  let gapDrafts = $state({})
  let gapError = $state('')

  const shortGaps = $derived(
    chains.flatMap((row) => row.items.filter((item) => item.kind === 'gap' && item.count >= 1 && item.count <= 6))
  )
  const tooLong = $derived(
    chains.reduce(
      (count, row) =>
        count + row.items.filter((item) => item.kind === 'gap' && item.count > 6).length,
      0
    )
  )

  /**
   * @param {PointerEvent} event
   * @param {string} key
   */
  function onLetterDown(event, key) {
    if (event.button !== 0) return
    dragging = true
    dragMoved = false
    dragKeys = null
    anchorKey = key
    shiftDrag = event.shiftKey
    selectionAtDrag = new Set(selected)
    if (event.shiftKey) {
      const next = keysInRange(chains, anchorKey, key, selectionAtDrag, true)
      dragKeys = next
      onSelect(next, { focus: true })
    }
  }

  /**
   * @param {string} key
   */
  function onLetterEnter(key) {
    if (!dragging || !anchorKey || key === anchorKey) return
    dragMoved = true
    const next = keysInRange(chains, anchorKey, key, selectionAtDrag, true)
    dragKeys = next
    onSelect(next, { focus: false })
  }

  function onPointerUp() {
    if (!dragging) return
    if (!dragMoved && !shiftDrag && anchorKey) {
      const next = clickResidueSelection(selectionAtDrag, anchorKey)
      onSelect(next, { focus: next.size > 0 })
    } else if (dragMoved && dragKeys) {
      onSelect(dragKeys, { focus: true })
    }
    dragging = false
    dragMoved = false
    dragKeys = null
  }

  /**
   * @param {object[]} items
   * @param {boolean} centered
   * @param {number} x
   * @param {number} y
   */
  function openGapEditor(items, centered, x, y) {
    /** @type {Record<string, string>} */
    const drafts = {}
    for (const item of items) drafts[item.key] = sequenceToText(item.sequence)
    gapDrafts = drafts
    gapError = ''
    gapEditor = { items, centered, x, y }
  }

  /**
   * @param {MouseEvent} event
   * @param {object} item
   */
  function openGapAt(event, item) {
    event.preventDefault()
    event.stopPropagation()
    if (item.count > 6) return
    openGapEditor([item], false, event.clientX, event.clientY)
  }

  function submitGapEditor() {
    if (!gapEditor) return
    /** @type {Array<{ chain: string, after: number, before: number, sequence: string[] }>} */
    const gaps = []
    for (const item of gapEditor.items) {
      const parsed = parseGapSequence(gapDrafts[item.key] || '', item.count)
      if ('error' in parsed) {
        gapError = `Chain ${item.chain} ${item.after}–${item.before}: ${parsed.error}`
        return
      }
      gaps.push({
        chain: item.chain,
        after: item.after,
        before: item.before,
        sequence: parsed.sequence
      })
    }
    gapEditor = null
    onFill(gaps)
  }

  /** @param {{ centered: boolean, x: number, y: number, items: object[] }} editor */
  function editorStyle(editor) {
    if (editor.centered) return ''
    const width = 300
    const left = Math.max(8, Math.min(editor.x, window.innerWidth - width - 8))
    const top = Math.max(8, Math.min(editor.y + 6, window.innerHeight - 220))
    return `left:${left}px;top:${top}px;width:${width}px`
  }
</script>

<svelte:window onpointerup={onPointerUp} />

<div
  class="pointer-events-auto absolute inset-x-0 bottom-0 z-20 max-h-[38%] overflow-auto border-t border-neutral-200 bg-white/95 px-2 py-1.5 text-xs dark:border-neutral-800 dark:bg-neutral-950/95"
  role="region"
  aria-label="Protein sequence"
>
  <div class="mb-1 flex flex-wrap items-center gap-2">
    <span class="font-medium text-neutral-700 dark:text-neutral-200">Sequence</span>
    <button
      type="button"
      class="rounded border border-neutral-300 px-1.5 py-0.5 text-[10px] text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      onclick={() => onSelect(allResidueKeys(chains), { focus: true })}
    >
      All
    </button>
    <button
      type="button"
      class="rounded border border-neutral-300 px-1.5 py-0.5 text-[10px] text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      onclick={() => onSelect(new Set(), { focus: false })}
    >
      None
    </button>
    <button
      type="button"
      class="rounded border border-neutral-300 px-1.5 py-0.5 text-[10px] text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      disabled={busy || shortGaps.length === 0}
      onclick={() => openGapEditor(shortGaps, true, 0, 0)}
    >
      {busy ? 'Filling gaps…' : `Fill short gaps (${shortGaps.length})`}
    </button>
    {#if tooLong > 0}
      <span class="text-[10px] text-amber-700 dark:text-amber-300">
        {tooLong} gap{tooLong === 1 ? '' : 's'} will not be completed.
      </span>
    {/if}
    {#if note}
      <span class="text-[10px] text-neutral-500">{note}</span>
    {/if}
    <button
      type="button"
      class="ml-auto rounded border border-neutral-300 px-1.5 py-0.5 text-[10px] text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      onclick={onClose}
    >
      Close
    </button>
  </div>
  {#if chains.length === 0}
    <p class="text-[11px] text-neutral-500">No protein residues in this structure.</p>
  {/if}
  {#each chains as row (row.chain)}
    <div class="mb-1 flex items-start gap-1">
      <span class="w-6 shrink-0 pt-0.5 font-mono text-[10px] text-neutral-500">{row.chain}</span>
      <div class="flex flex-wrap gap-px font-mono text-[11px] leading-none">
        {#each row.items as item (item.key)}
          {#if item.kind === 'gap'}
            <button
              type="button"
              class="inline-flex items-center rounded px-0.5 text-[9px] {item.count <= 6
                ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200'
                : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'}"
              title={item.count <= 6
                ? `${item.count} missing residues (${item.after} to ${item.before}). Click to fill this gap.`
                : `${item.count} missing residues (${item.after} to ${item.before}) will not be completed`}
              onclick={(event) => openGapAt(event, item)}
              oncontextmenu={(event) => openGapAt(event, item)}
            >
              ·{item.count}·
            </button>
          {:else}
            <button
              type="button"
              class="h-4 w-4 rounded-sm {selected.has(item.key)
                ? 'bg-sky-600 text-white'
                : 'text-neutral-800 hover:bg-neutral-200 dark:text-neutral-200 dark:hover:bg-neutral-800'}"
              title={`${item.resname} ${item.resid}`}
              onpointerdown={(event) => onLetterDown(event, item.key)}
              onpointerenter={() => onLetterEnter(item.key)}
              oncontextmenu={(event) => {
                event.preventDefault()
                if (!selected.has(item.key)) {
                  const next = new Set(selected)
                  next.add(item.key)
                  anchorKey = item.key
                  onSelect(next, { focus: true })
                }
                onContextMenu(event)
              }}
            >
              {item.letter}
            </button>
          {/if}
        {/each}
      </div>
    </div>
  {/each}
</div>

{#if gapEditor}
  <button
    type="button"
    class="fixed inset-0 z-40 cursor-default"
    aria-label="Close gap menu"
    onclick={() => (gapEditor = null)}
  ></button>
  <div
    class="fixed z-50 max-h-[70vh] overflow-auto rounded-md border border-neutral-200 bg-white p-2 text-xs shadow-md dark:border-neutral-700 dark:bg-neutral-950 {gapEditor.centered
      ? 'top-[14%] left-1/2 w-[22rem] -translate-x-1/2'
      : ''}"
    style={editorStyle(gapEditor)}
    role="dialog"
    aria-label="Fill gap"
  >
    <p class="mb-1 font-medium text-neutral-800 dark:text-neutral-100">
      {gapEditor.centered ? `Fill short gaps (${gapEditor.items.length})` : 'Fill this gap'}
    </p>
    <p class="mb-2 text-[10px] text-neutral-500">
      Keep SEQRES, or type another sequence. One letter per residue, or three-letter names.
    </p>
    <div class="space-y-1">
      {#each gapEditor.items as item (item.key)}
        <label class="flex items-center gap-2">
          <span class="w-28 shrink-0 font-mono text-[10px] text-neutral-600 dark:text-neutral-300">
            {item.chain} {item.after}–{item.before}
          </span>
          <input
            class="min-w-0 flex-1 rounded border border-neutral-300 bg-white px-1 py-0.5 font-mono text-[11px] dark:border-neutral-600 dark:bg-neutral-900"
            value={gapDrafts[item.key] || ''}
            spellcheck="false"
            aria-label={`Sequence for chain ${item.chain} ${item.after} to ${item.before}`}
            oninput={(event) => {
              gapDrafts = { ...gapDrafts, [item.key]: event.currentTarget.value }
            }}
          />
          {#if item.sequence?.length}
            <button
              type="button"
              class="shrink-0 text-[10px] text-sky-700 hover:underline dark:text-sky-300"
              onclick={() => (gapDrafts = { ...gapDrafts, [item.key]: sequenceToText(item.sequence) })}
            >
              SEQRES
            </button>
          {/if}
        </label>
      {/each}
    </div>
    {#if gapError}
      <p class="mt-1 text-[10px] text-amber-700 dark:text-amber-300">{gapError}</p>
    {/if}
    <div class="mt-2 flex gap-2">
      <button
        type="button"
        class="rounded bg-sky-600 px-2 py-0.5 text-[10px] text-white disabled:opacity-40"
        disabled={busy}
        onclick={submitGapEditor}
      >
        Fill
      </button>
      <button
        type="button"
        class="rounded px-1.5 py-0.5 text-[10px] text-neutral-600 dark:text-neutral-300"
        onclick={() => (gapEditor = null)}
      >
        Cancel
      </button>
    </div>
  </div>
{/if}
