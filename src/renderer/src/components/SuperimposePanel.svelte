<script>
  import Spinner from './ui/Spinner.svelte'
  import { TRAJ_RMSD_SELECTION_PRESETS } from '../lib/analysisSets.js'

  /**
   * @type {{
   *   structures: Array<{ id: string, label: string, chains: string[], proteinChains: string[] }>
   *   referenceId: string
   *   mobileId: string
   *   pairs: Array<{ referenceChain: string, mobileChain: string }>
   *   selection: string
   *   busy: boolean
   *   error: string
   *   result: string
   *   onReference: (id: string) => void
   *   onMobile: (id: string) => void
   *   onPairs: (pairs: Array<{ referenceChain: string, mobileChain: string }>) => void
   *   onPairMatchingIds: () => void
   *   onSelection: (value: string) => void
   *   onApply: () => void
   *   onClose: () => void
   * }}
   */
  let {
    structures,
    referenceId,
    mobileId,
    pairs,
    selection,
    busy,
    error,
    result,
    onReference,
    onMobile,
    onPairs,
    onPairMatchingIds,
    onSelection,
    onApply,
    onClose
  } = $props()

  const reference = $derived(structures.find((entry) => entry.id === referenceId) ?? null)
  const mobile = $derived(structures.find((entry) => entry.id === mobileId) ?? null)
  const referenceChains = $derived(
    reference?.proteinChains?.length ? reference.proteinChains : (reference?.chains ?? [])
  )
  const mobileChains = $derived(
    mobile?.proteinChains?.length ? mobile.proteinChains : (mobile?.chains ?? [])
  )
  const canApply = $derived(
    !busy &&
      structures.length >= 2 &&
      pairs.length > 0 &&
      pairs.every((pair) => pair.referenceChain && pair.mobileChain)
  )

  /**
   * @param {number} index
   * @param {'referenceChain' | 'mobileChain'} key
   * @param {string} value
   */
  function updatePair(index, key, value) {
    onPairs(pairs.map((pair, i) => (i === index ? { ...pair, [key]: value } : pair)))
  }

  function addPair() {
    const usedRef = new Set(pairs.map((pair) => pair.referenceChain))
    const usedMob = new Set(pairs.map((pair) => pair.mobileChain))
    const ref =
      referenceChains.find((id) => !usedRef.has(id)) || referenceChains[0] || ''
    const mob = mobileChains.find((id) => !usedMob.has(id)) || mobileChains[0] || ''
    onPairs([...pairs, { referenceChain: ref, mobileChain: mob }])
  }

  /** @param {number} index */
  function removePair(index) {
    onPairs(pairs.filter((_, i) => i !== index))
  }
</script>

<div
  class="viewer-side-panel--nonmodal fixed top-10 bottom-10 left-16 z-50 flex w-[420px] max-w-[calc(100vw-5rem)] flex-col overflow-hidden rounded-lg border border-neutral-300 bg-white p-0 text-neutral-900 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
  role="dialog"
  aria-labelledby="superimpose-title"
>
  <div class="flex items-center justify-between border-b dialog-divider px-4 py-2.5">
    <h3 id="superimpose-title" class="text-sm font-semibold">Superimpose</h3>
    <button type="button" class="dialog-btn-outline px-2 py-0.5 text-xs" onclick={onClose}>✕</button>
  </div>
  <div class="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 text-xs">
    <p class="text-[11px] leading-snug text-neutral-500">
      Sequence alignment (BLOSUM62) on each pair, then one rigid fit on all those Cα anchors.
      The whole mobile structure moves, including its ligands. The reference stays fixed.
    </p>

    <label class="flex items-center gap-2">
      <span class="dialog-label w-24 shrink-0">Reference</span>
      <select class="field-input min-w-0 flex-1" value={referenceId} onchange={(e) => onReference(e.currentTarget.value)}>
        {#each structures as entry (entry.id)}
          <option value={entry.id}>{entry.label}</option>
        {/each}
      </select>
    </label>

    <label class="flex items-center gap-2">
      <span class="dialog-label w-24 shrink-0">Mobile</span>
      <select class="field-input min-w-0 flex-1" value={mobileId} onchange={(e) => onMobile(e.currentTarget.value)}>
        {#each structures as entry (entry.id)}
          <option value={entry.id}>{entry.label}</option>
        {/each}
      </select>
    </label>

    <div class="space-y-2">
      <div class="flex items-center justify-between gap-2">
        <span class="dialog-label">Chain pairs</span>
        <div class="flex gap-1">
          <button type="button" class="dialog-btn-outline px-2 py-0.5 text-[11px]" onclick={onPairMatchingIds}>
            Pair matching IDs
          </button>
          <button type="button" class="dialog-btn-outline px-2 py-0.5 text-[11px]" onclick={addPair}>
            Add pair
          </button>
        </div>
      </div>
      <div class="grid grid-cols-[1fr_1fr_auto] items-center gap-x-2 gap-y-0.5 text-[10px] text-neutral-500">
        <span>Reference</span>
        <span>Mobile</span>
        <span></span>
      </div>
      {#each pairs as pair, index (index)}
        <div class="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
          <select
            class="field-input min-w-0"
            value={pair.referenceChain}
            onchange={(e) => updatePair(index, 'referenceChain', e.currentTarget.value)}
          >
            {#each referenceChains as id (id)}
              <option value={id}>{id}</option>
            {/each}
          </select>
          <select
            class="field-input min-w-0"
            value={pair.mobileChain}
            onchange={(e) => updatePair(index, 'mobileChain', e.currentTarget.value)}
          >
            {#each mobileChains as id (id)}
              <option value={id}>{id}</option>
            {/each}
          </select>
          <button
            type="button"
            class="dialog-btn-outline px-2 py-0.5 text-[11px]"
            disabled={pairs.length <= 1}
            onclick={() => removePair(index)}
          >
            Remove
          </button>
        </div>
      {/each}
    </div>

    <div class="space-y-1.5">
      <span class="dialog-label">Fit selection</span>
      <p class="text-[10px] leading-snug text-neutral-500">
        Only these atoms (on each paired chain) are used for the fit. The whole mobile
        structure still moves. Leave empty for all protein Cα on the pairs.
      </p>
      <div class="flex flex-wrap gap-1">
        <button
          type="button"
          class="rounded border px-1.5 py-0.5 text-[11px] {!selection.trim()
            ? 'border-yellow-600 bg-yellow-600/15 text-yellow-800 dark:text-yellow-200'
            : 'border-neutral-300 dark:border-neutral-700'}"
          onclick={() => onSelection('')}
        >
          All protein
        </button>
        {#each TRAJ_RMSD_SELECTION_PRESETS.filter((p) => p.value !== 'all') as preset (preset.value)}
          <button
            type="button"
            class="rounded border px-1.5 py-0.5 text-[11px] {selection === preset.value
              ? 'border-yellow-600 bg-yellow-600/15 text-yellow-800 dark:text-yellow-200'
              : 'border-neutral-300 dark:border-neutral-700'}"
            onclick={() => onSelection(preset.value)}
          >
            {preset.label}
          </button>
        {/each}
      </div>
      <input
        class="field-input w-full font-mono"
        type="text"
        placeholder="MDAnalysis, e.g. resid 40-180 or protein and name CA"
        value={selection}
        oninput={(e) => onSelection(e.currentTarget.value)}
      />
    </div>

    {#if error}
      <p class="gw-notice gw-notice-error font-mono text-[11px]">{error}</p>
    {/if}
    {#if result}
      <p class="text-xs font-medium text-neutral-800 dark:text-neutral-100">{result}</p>
    {/if}
  </div>
  <div class="flex justify-end gap-2 border-t dialog-divider px-4 py-3">
    <button
      type="button"
      class="flex items-center gap-1 rounded bg-yellow-600 px-3 py-1 text-xs font-semibold text-black hover:bg-yellow-500 disabled:opacity-40"
      disabled={!canApply}
      onclick={onApply}
    >
      {#if busy}<Spinner />{/if}
      Superimpose
    </button>
  </div>
</div>
