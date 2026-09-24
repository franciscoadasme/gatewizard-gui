<script>
  import Spinner from './ui/Spinner.svelte'

  /**
   * @type {{
   *   structures: Array<{ id: string, label: string, chains: string[], proteinChains: string[] }>
   *   referenceId: string
   *   mobileId: string
   *   referenceChain: string
   *   mobileChain: string
   *   busy: boolean
   *   error: string
   *   result: string
   *   onReference: (id: string) => void
   *   onMobile: (id: string) => void
   *   onReferenceChain: (chain: string) => void
   *   onMobileChain: (chain: string) => void
   *   onApply: () => void
   *   onClose: () => void
   * }}
   */
  let {
    structures,
    referenceId,
    mobileId,
    referenceChain,
    mobileChain,
    busy,
    error,
    result,
    onReference,
    onMobile,
    onReferenceChain,
    onMobileChain,
    onApply,
    onClose
  } = $props()

  const reference = $derived(structures.find((entry) => entry.id === referenceId) ?? null)
  const mobile = $derived(structures.find((entry) => entry.id === mobileId) ?? null)
  const referenceChains = $derived(reference?.proteinChains?.length ? reference.proteinChains : reference?.chains ?? [])
  const mobileChains = $derived(mobile?.proteinChains?.length ? mobile.proteinChains : mobile?.chains ?? [])
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
      Sequence alignment (BLOSUM62) then a rigid fit on Cα anchors. The whole mobile structure
      moves, including its ligands. The reference stays fixed. This needs protein chains with
      usable sequence homology.
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
      <span class="dialog-label w-24 shrink-0">Ref chain</span>
      <select
        class="field-input min-w-0 flex-1"
        value={referenceChain}
        onchange={(e) => onReferenceChain(e.currentTarget.value)}
      >
        {#each referenceChains as id (id)}
          <option value={id}>{id}</option>
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
    <label class="flex items-center gap-2">
      <span class="dialog-label w-24 shrink-0">Mobile chain</span>
      <select
        class="field-input min-w-0 flex-1"
        value={mobileChain}
        onchange={(e) => onMobileChain(e.currentTarget.value)}
      >
        {#each mobileChains as id (id)}
          <option value={id}>{id}</option>
        {/each}
      </select>
    </label>

    {#if error}
      <p class="gw-notice gw-notice-error font-mono text-[11px]">{error}</p>
    {/if}
    {#if result}
      <p class="text-[11px] text-neutral-600 dark:text-neutral-300">{result}</p>
    {/if}
  </div>
  <div class="flex justify-end gap-2 border-t dialog-divider px-4 py-3">
    <button
      type="button"
      class="flex items-center gap-1 rounded bg-yellow-600 px-3 py-1 text-xs font-semibold text-black hover:bg-yellow-500 disabled:opacity-40"
      disabled={busy || structures.length < 2 || !referenceChain || !mobileChain}
      onclick={onApply}
    >
      {#if busy}<Spinner />{/if}
      Superimpose
    </button>
  </div>
</div>
