<script>
  /** @typedef {{ name: string, element: string, index: number, res_name: string, res_id: number, chain_id: string }} HovAtom */

  /**
   * @type {{
   *   active?: boolean,
   *   selectionLevel?: string,
   *   hoveredAtom?: HovAtom | null,
   *   groupAtomCount?: number,
   *   selectedAtomCount?: number,
   *   editBusy?: boolean,
   *   onCenterView?: () => void,
   *   onDelete?: () => void,
   *   onRenameRes?: (atom: HovAtom) => void,
   *   onRenameChain?: (atom: HovAtom) => void,
   *   onRenumberRes?: (atom: HovAtom) => void,
   *   onclose?: () => void,
   * }}
   */
  let {
    active = $bindable(false),
    selectionLevel = 'residue',
    hoveredAtom = null,
    groupAtomCount = 0,
    selectedAtomCount = 0,
    editBusy = false,
    onCenterView = () => {},
    onDelete = () => {},
    onRenameRes = () => {},
    onRenameChain = () => {},
    onRenumberRes = () => {},
    onclose = () => {}
  } = $props()

  const LEVEL_LABEL = { atom: 'Atom', residue: 'Residue', chain: 'Chain', molecule: 'Molecule' }

  /** AA 3→1 map for a compact residue label */
  const AA1 = {
    ALA: 'A',
    ARG: 'R',
    ASN: 'N',
    ASP: 'D',
    CYS: 'C',
    GLN: 'Q',
    GLU: 'E',
    GLY: 'G',
    HIS: 'H',
    ILE: 'I',
    LEU: 'L',
    LYS: 'K',
    MET: 'M',
    PHE: 'F',
    PRO: 'P',
    SER: 'S',
    THR: 'T',
    TRP: 'W',
    TYR: 'Y',
    VAL: 'V',
    HSD: 'H',
    HSE: 'H',
    HSP: 'H',
    HID: 'H',
    HIE: 'H',
    HIP: 'H',
    MSE: 'M'
  }

  /** @param {HovAtom} atom */
  function resLabel(atom) {
    const one = AA1[atom.res_name] ?? null
    const short = one ? `${one}${atom.res_id}` : `${atom.res_name}${atom.res_id}`
    return short
  }

  /** @param {HovAtom} atom */
  function selectionDescription(atom) {
    if (selectionLevel === 'atom') return `${atom.name} (${atom.element})`
    if (selectionLevel === 'residue') return resLabel(atom)
    if (selectionLevel === 'chain') return `Chain ${atom.chain_id}`
    return `Molecule (chain ${atom.chain_id})`
  }
</script>

{#if active}
  <!-- Floating panel: right side of viewer, non-blocking pointer events on viewer -->
  <div
    class="pointer-events-none absolute inset-y-0 right-0 flex items-start justify-end"
    aria-hidden="true"
  ></div>
  <div
    class="absolute top-2 right-2 z-20 flex w-48 flex-col overflow-hidden rounded-xl border border-neutral-700/70 bg-neutral-950/92 text-xs text-neutral-200 shadow-2xl"
    style="backdrop-filter:blur(6px)"
  >
    <!-- Header -->
    <div
      class="flex items-center justify-between border-b border-neutral-800/80 bg-orange-500/10 px-3 py-2"
    >
      <div class="flex items-center gap-1.5">
        <!-- pencil icon -->
        <svg viewBox="0 0 16 16" class="size-3.5 fill-orange-400" aria-hidden="true">
          <path
            d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.647a.5.5 0 0 0 0-.707zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11z"
          />
        </svg>
        <span class="font-semibold text-orange-300">Edit</span>
        <span class="text-neutral-500">·</span>
        <span class="text-[11px] text-orange-200/80"
          >{LEVEL_LABEL[selectionLevel] ?? selectionLevel}</span
        >
      </div>
      <button
        type="button"
        class="flex size-5 items-center justify-center rounded text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-white"
        onclick={onclose}
        title="Exit edit mode"
        aria-label="Exit edit mode">×</button
      >
    </div>

    <!-- Selected group indicator (when locked by click) -->
    {#if selectedAtomCount > 0}
      <div class="border-b border-neutral-800/60 bg-yellow-500/8 px-3 py-1.5">
        <div class="flex items-center gap-1.5">
          <svg viewBox="0 0 16 16" class="size-3 shrink-0 fill-yellow-400" aria-hidden="true"
            ><rect
              x="1"
              y="1"
              width="14"
              height="14"
              rx="2"
              ry="2"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            /></svg
          >
          <span class="text-[11px] text-yellow-300/90"
            >Selected: {selectedAtomCount} atom{selectedAtomCount !== 1 ? 's' : ''}</span
          >
        </div>
      </div>
    {/if}

    <!-- Hover info -->
    <div class="border-b border-neutral-800/60 px-3 py-2.5">
      {#if hoveredAtom}
        <div class="mb-0.5 font-mono text-sm leading-tight font-semibold text-white">
          {selectionDescription(hoveredAtom)}
        </div>
        <div class="text-[10px] text-neutral-400">
          Chain <span class="text-neutral-200">{hoveredAtom.chain_id}</span>
          {#if selectionLevel !== 'atom'}
            · <span class="text-neutral-200">{groupAtomCount}</span> atoms
          {/if}
        </div>
        {#if selectionLevel === 'atom'}
          <div class="mt-0.5 text-[10px] text-neutral-500">
            index <span class="font-mono text-neutral-300">{hoveredAtom.index}</span>
          </div>
        {:else if selectionLevel === 'residue'}
          <div class="mt-0.5 text-[10px] text-neutral-500">
            res <span class="font-mono text-neutral-300">{hoveredAtom.res_id}</span>
            · <span class="font-mono text-neutral-300">{hoveredAtom.res_name}</span>
          </div>
        {/if}
      {:else}
        <div class="py-1 text-neutral-600 italic">Hover over any atom…</div>
      {/if}
    </div>

    <!-- Actions (only when something is hovered) -->
    {#if hoveredAtom}
      <div class="flex flex-col gap-1 border-t border-neutral-800/60 px-2 pt-2 pb-3">
        <!-- Center view -->
        <button
          type="button"
          onclick={onCenterView}
          class="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-neutral-200 transition-colors hover:bg-neutral-800"
        >
          <svg viewBox="0 0 16 16" class="size-3 shrink-0 fill-neutral-400" aria-hidden="true">
            <path
              d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0m0 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1m0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8m0 1a3 3 0 1 1 0 6 3 3 0 0 1 0-6m0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2"
            />
          </svg>
          Center view
        </button>

        <!-- Rename residue (shown when residue/atom level) -->
        {#if selectionLevel === 'residue' || selectionLevel === 'atom'}
          <button
            type="button"
            onclick={() => onRenameRes(hoveredAtom)}
            class="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-neutral-200 transition-colors hover:bg-neutral-800"
          >
            <svg viewBox="0 0 16 16" class="size-3 shrink-0 fill-neutral-400" aria-hidden="true">
              <path
                d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.647a.5.5 0 0 0 0-.707zM4 6v1h1V6zM3 7H2v1h1zm-1 1H1v1h1zm7-7v1h1V1zM9 2H8v1h1zM8 3H7v1h1zM6 4H5v1h1zm-1 1H4v1h1zm-1 1H3v1h1zm-1 1H2v1h1zm-1 1H1v1h1zM1 8v1H0V8z"
              />
              <path
                d="M12.293 2.293a1 1 0 0 1 1.414 0l.5.5a1 1 0 0 1 0 1.414l-9.5 9.5A1 1 0 0 1 4 14H1a1 1 0 0 1-1-1v-3a1 1 0 0 1 .293-.707z"
              />
            </svg>
            Rename residue…
          </button>
        {/if}

        <!-- Rename chain (always shown) -->
        <button
          type="button"
          onclick={() => onRenameChain(hoveredAtom)}
          class="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-neutral-200 transition-colors hover:bg-neutral-800"
        >
          <svg viewBox="0 0 16 16" class="size-3 shrink-0 fill-neutral-400" aria-hidden="true">
            <path
              d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.647a.5.5 0 0 0 0-.707zM4 6v1h1V6zM3 7H2v1h1zm-1 1H1v1h1zm7-7v1h1V1zM9 2H8v1h1zM8 3H7v1h1zM6 4H5v1h1zm-1 1H4v1h1zm-1 1H3v1h1zm-1 1H2v1h1zm-1 1H1v1h1zM1 8v1H0V8z"
            />
            <path
              d="M12.293 2.293a1 1 0 0 1 1.414 0l.5.5a1 1 0 0 1 0 1.414l-9.5 9.5A1 1 0 0 1 4 14H1a1 1 0 0 1-1-1v-3a1 1 0 0 1 .293-.707z"
            />
          </svg>
          Rename chain…
        </button>

        <!-- Renumber residues (shown for residue/chain/molecule) -->
        {#if selectionLevel !== 'atom'}
          <button
            type="button"
            onclick={() => onRenumberRes(hoveredAtom)}
            class="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-neutral-200 transition-colors hover:bg-neutral-800"
          >
            <svg viewBox="0 0 16 16" class="size-3 shrink-0 fill-neutral-400" aria-hidden="true">
              <path
                fill-rule="evenodd"
                d="M4.5 3.5a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-1 0V5.707L2.354 7.854a.5.5 0 1 1-.708-.708L3.5 5.293V4a.5.5 0 0 1 .5-.5zM8 1a1 1 0 0 1 1-1h5a1 1 0 0 1 0 2H9a1 1 0 0 1-1-1m1 4a1 1 0 0 0 0 2h5a1 1 0 0 0 0-2zm0 5a1 1 0 0 0 0 2h5a1 1 0 0 0 0-2z"
              />
            </svg>
            Renumber…
          </button>
        {/if}

        <!-- Divider -->
        <div class="my-0.5 border-t border-neutral-800/60"></div>

        <!-- Delete -->
        <button
          type="button"
          onclick={onDelete}
          disabled={editBusy}
          class="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-red-400 transition-colors hover:bg-red-900/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg viewBox="0 0 16 16" class="size-3 shrink-0 fill-red-400" aria-hidden="true">
            <path
              d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"
            />
            <path
              d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"
            />
          </svg>
          Delete selection
          {#if editBusy}
            <svg
              class="ml-auto size-3 animate-spin fill-neutral-500"
              viewBox="0 0 16 16"
              aria-hidden="true"
            >
              <path
                d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z"
              />
              <path
                fill-rule="evenodd"
                d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3M3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9z"
              />
            </svg>
          {/if}
        </button>
      </div>
    {/if}
  </div>
{/if}
