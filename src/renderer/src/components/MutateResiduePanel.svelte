<script>
  import Spinner from './ui/Spinner.svelte'

  const AMINO_ACIDS = [
    'ALA',
    'ARG',
    'ASN',
    'ASP',
    'CYS',
    'GLN',
    'GLU',
    'GLY',
    'HIS',
    'ILE',
    'LEU',
    'LYS',
    'MET',
    'PHE',
    'PRO',
    'SER',
    'THR',
    'TRP',
    'TYR',
    'VAL'
  ]

  /** Three-letter code → one-letter code, including histidine and selenomethionine variants. */
  const AA_ONE = {
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

  /** @param {string} code */
  function residueLabel(code) {
    const name = String(code || '').trim().toUpperCase()
    if (!name) return ''
    const pretty = name.charAt(0) + name.slice(1).toLowerCase()
    const one = AA_ONE[name]
    return one ? `${pretty} (${name}, ${one})` : `${pretty} (${name})`
  }

  /**
   * @type {{
   *   chains: string[]
   *   chain: string
   *   resid: number
   *   currentResname: string
   *   mutateTo: string
   *   rotamers: Array<{ index: number, prob: number, vdw: number, chi: number[], best?: boolean }>
   *   selectedIndex: number
   *   phi: number | null
   *   psi: number | null
   *   busy: boolean
   *   error: string
   *   trajectory: boolean
   *   onChain: (value: string) => void
   *   onResid: (value: number) => void
   *   onMutateTo: (value: string) => void
   *   onList: () => void
   *   onSelect: (index: number) => void
   *   onApply: () => void
   *   onClose: () => void
   * }}
   */
  let {
    chains,
    chain,
    resid,
    currentResname,
    mutateTo,
    rotamers,
    selectedIndex,
    phi,
    psi,
    busy,
    error,
    trajectory,
    onChain,
    onResid,
    onMutateTo,
    onList,
    onSelect,
    onApply,
    onClose
  } = $props()

  const noChi = $derived(mutateTo === 'GLY' || mutateTo === 'ALA')
</script>

<div
  class="viewer-side-panel--nonmodal fixed top-10 bottom-10 left-16 z-50 flex w-[400px] max-w-[calc(100vw-5rem)] flex-col overflow-hidden rounded-lg border border-neutral-300 bg-white p-0 text-neutral-900 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
  role="dialog"
  aria-labelledby="mutate-panel-title"
>
  <div class="flex items-center justify-between border-b dialog-divider px-4 py-2.5">
    <h3 id="mutate-panel-title" class="text-sm font-semibold">Mutate residue</h3>
    <button type="button" class="dialog-btn-outline px-2 py-0.5 text-xs" onclick={onClose}>✕</button>
  </div>

  <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 text-xs">
    <p class="text-[11px] leading-snug text-neutral-500">
      Dunbrack side-chain rotamers. The score is pyMUT’s relative heavy-atom van der Waals within
      about 6 Å, not a force-field energy and not a minimized structure. The backbone is not moved.
    </p>
    {#if trajectory}
      <p class="text-[11px] leading-snug text-amber-700 dark:text-amber-300">
        This structure is a trajectory. The mutator uses frame 0 / the working PDB, not the movie.
      </p>
    {/if}

    <div
      class="rounded border border-neutral-200 bg-neutral-50 px-2.5 py-2 dark:border-neutral-700 dark:bg-neutral-800/60"
    >
      {#if currentResname}
        <p class="text-[10px] uppercase tracking-wide text-neutral-500">This mutation</p>
        <p class="mt-0.5 font-medium text-neutral-900 dark:text-neutral-100">
          {residueLabel(currentResname)} {resid}
          <span class="font-normal text-neutral-500">chain {chain || '—'}</span>
          <span class="mx-1 text-neutral-400">→</span>
          {residueLabel(mutateTo)}
        </p>
      {:else}
        <p class="text-amber-800 dark:text-amber-300">
          No residue at chain {chain || '—'}, number {resid} in this structure.
        </p>
      {/if}
    </div>

    <label class="flex items-center gap-2">
      <span class="dialog-label w-16 shrink-0">Chain</span>
      {#if chains.length}
        <select
          class="field-input min-w-0 flex-1"
          value={chain}
          onchange={(e) => onChain(e.currentTarget.value)}
        >
          {#each chains as id (id)}
            <option value={id}>{id}</option>
          {/each}
        </select>
      {:else}
        <input
          class="field-input min-w-0 flex-1"
          value={chain}
          oninput={(e) => onChain(e.currentTarget.value.trim())}
        />
      {/if}
    </label>

    <label class="flex items-center gap-2">
      <span class="dialog-label w-16 shrink-0">Resid</span>
      <input
        class="field-input w-24"
        type="number"
        value={resid}
        oninput={(e) => onResid(Number(e.currentTarget.value))}
      />
    </label>

    <label class="flex items-center gap-2">
      <span class="dialog-label w-16 shrink-0">To</span>
      <select
        class="field-input min-w-0 flex-1"
        value={mutateTo}
        onchange={(e) => onMutateTo(e.currentTarget.value)}
      >
        {#each AMINO_ACIDS as name (name)}
          <option value={name}>{residueLabel(name)}</option>
        {/each}
      </select>
    </label>

    {#if error}
      <p class="gw-notice gw-notice-error font-mono text-[11px]">{error}</p>
    {/if}

    {#if rotamers.length}
      <p class="text-[10px] text-neutral-500">
        φ {phi ?? '—'}° · ψ {psi ?? '—'}°
        {#if noChi}
          · one placement, no χ angles.
        {/if}
      </p>
      {#if noChi}
        <p class="text-[11px] text-neutral-600 dark:text-neutral-300">
          The side chain is shown on the structure. Apply writes that placement.
        </p>
      {:else}
      <div class="min-h-0 flex-1 overflow-auto rounded border border-neutral-200 dark:border-neutral-700">
        <table class="w-full border-collapse text-left text-[11px]">
          <thead class="sticky top-0 bg-neutral-100 dark:bg-neutral-800">
            <tr>
              <th class="px-2 py-1 font-medium">#</th>
              <th class="px-2 py-1 font-medium">Prob</th>
              <th class="px-2 py-1 font-medium">VdW</th>
              <th class="px-2 py-1 font-medium">χ</th>
            </tr>
          </thead>
          <tbody>
            {#each rotamers as row (row.index)}
              <tr
                class="cursor-pointer border-t border-neutral-200 dark:border-neutral-800 {row.index ===
                selectedIndex
                  ? 'bg-yellow-500/15'
                  : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/60'}"
                role="button"
                tabindex="0"
                onclick={() => onSelect(row.index)}
                onkeydown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.preventDefault()
                  onSelect(row.index)
                }}
              >
                <td class="px-2 py-1 tabular-nums">
                  {row.index + 1}{row.best ? ' · lowest' : ''}
                </td>
                <td class="px-2 py-1 tabular-nums">{row.prob.toFixed(3)}</td>
                <td class="px-2 py-1 tabular-nums">{row.vdw.toFixed(2)}</td>
                <td class="px-2 py-1 tabular-nums">
                  {row.chi?.length ? row.chi.map((angle) => angle.toFixed(0)).join(', ') : '—'}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {/if}
    {/if}
  </div>

  <div class="flex flex-wrap items-center justify-end gap-2 border-t dialog-divider px-4 py-3">
    <button type="button" class="dialog-btn-outline" disabled={busy} onclick={onList}>
      {#if busy}<Spinner />{/if}
      List rotamers
    </button>
    <button
      type="button"
      class="flex items-center gap-1 rounded bg-yellow-600 px-3 py-1 text-xs font-semibold text-black hover:bg-yellow-500 disabled:opacity-40"
      disabled={busy || !rotamers.length}
      onclick={onApply}
    >
      Apply
    </button>
  </div>
</div>
