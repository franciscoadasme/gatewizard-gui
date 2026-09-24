<script>
  import Spinner from './ui/Spinner.svelte'

  /**
   * @type {{
   *   chains: string[]
   *   chain: string
   *   busy: boolean
   *   error: string
   *   trajectory: boolean
   *   onChain: (value: string) => void
   *   onSplit: () => void
   *   onClose: () => void
   * }}
   */
  let { chains, chain, busy, error, trajectory, onChain, onSplit, onClose } = $props()
</script>

<div
  class="viewer-side-panel--nonmodal fixed top-10 bottom-10 left-16 z-50 flex w-[380px] max-w-[calc(100vw-5rem)] flex-col overflow-hidden rounded-lg border border-neutral-300 bg-white p-0 text-neutral-900 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
  role="dialog"
  aria-labelledby="split-chain-title"
>
  <div class="flex items-center justify-between border-b dialog-divider px-4 py-2.5">
    <h3 id="split-chain-title" class="text-sm font-semibold">Split chain</h3>
    <button type="button" class="dialog-btn-outline px-2 py-0.5 text-xs" onclick={onClose}>✕</button>
  </div>
  <div class="flex flex-1 flex-col gap-3 px-4 py-3 text-xs">
    <p class="text-[11px] leading-snug text-neutral-500">
      Writes every atom of this chain, including ligands on it, as a new structure. Water on the
      chain is kept and can be hidden. The original structure stays loaded.
    </p>
    {#if trajectory}
      <p class="text-[11px] leading-snug text-amber-700 dark:text-amber-300">
        A trajectory is split from frame 0, not from the movie.
      </p>
    {/if}
    <label class="flex items-center gap-2">
      <span class="dialog-label w-16 shrink-0">Chain</span>
      {#if chains.length}
        <select class="field-input min-w-0 flex-1" value={chain} onchange={(e) => onChain(e.currentTarget.value)}>
          {#each chains as id (id)}
            <option value={id}>{id}</option>
          {/each}
        </select>
      {:else}
        <input class="field-input min-w-0 flex-1" value={chain} oninput={(e) => onChain(e.currentTarget.value.trim())} />
      {/if}
    </label>
    {#if error}
      <p class="gw-notice gw-notice-error font-mono text-[11px]">{error}</p>
    {/if}
  </div>
  <div class="flex justify-end gap-2 border-t dialog-divider px-4 py-3">
    <button
      type="button"
      class="flex items-center gap-1 rounded bg-yellow-600 px-3 py-1 text-xs font-semibold text-black hover:bg-yellow-500 disabled:opacity-40"
      disabled={busy || !chain}
      onclick={onSplit}
    >
      {#if busy}<Spinner />{/if}
      Split chain
    </button>
  </div>
</div>
