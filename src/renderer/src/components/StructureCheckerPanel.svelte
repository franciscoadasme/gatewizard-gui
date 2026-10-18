<script>
  import Spinner from './ui/Spinner.svelte'

  /**
   * @type {{
   *   report: Record<string, any> | null
   *   shown: Record<string, string[]>
   *   busy: boolean
   *   error: string
   *   trajectory: boolean
   *   previewLabel: string
   *   onFocus: (selection: string, label: string, letters?: string, likely?: string, group?: Record<string, any> | null) => void
   *   onKeepPreview: () => void
   *   onChoose: (id: string, altloc: string) => void
   *   onShown: (id: string, letters: string[]) => void
   *   onKeepLikely: () => boolean
   *   onApply: () => void
   *   onClose: () => void
   * }}
   */
  let {
    report,
    shown,
    busy,
    error,
    trajectory,
    previewLabel = '',
    onFocus,
    onKeepPreview,
    onChoose,
    onShown,
    onKeepLikely,
    onApply,
    onClose
  } = $props()

  const summary = $derived(report?.summary || null)
  const altlocs = $derived(Array.isArray(report?.altlocs) ? report.altlocs : [])
  const quiet = $derived(
    !!summary &&
      summary.missing_atoms === 0 &&
      summary.missing_residues === 0 &&
      summary.gaps === 0 &&
      summary.altlocs === 0 &&
      summary.chain_differences === 0 &&
      summary.other === 0
  )

  /** @type {Record<string, boolean>} */
  let open = $state({})
  let active = $state('')

  /** @param {string} key */
  function toggle(key) {
    open = { ...open, [key]: !open[key] }
  }

  /**
   * @param {string} key
   * @param {string} selection
   * @param {string} label
   * @param {string} [letters]
   * @param {string} [likely]
   */
  function focus(key, selection, label, letters = '', likely = '', group = null) {
    active = key
    onFocus(selection || '', label, letters, likely, group)
  }

  /** @param {{ id: string, default: string, options: Array<{ altloc: string }> }} group */
  function shownLetters(group) {
    const saved = shown?.[group.id]
    if (Array.isArray(saved) && saved.length) return saved
    return group.options.map((option) => option.altloc)
  }

  /**
   * @param {{ id: string, default: string, options: Array<{ altloc: string }>, selection: string, chain: string, resid: number, icode?: string, resname: string }} group
   * @param {string} letter
   */
  function toggleLetter(group, letter) {
    const current = shownLetters(group)
    const next = current.includes(letter)
      ? current.filter((item) => item !== letter)
      : [...current, letter]
    const letters = next.length ? next : [letter]
    onShown(group.id, letters)
    const kept = letters.includes(group.default) ? group.default : letters[0]
    onChoose(group.id, kept)
    const label = `${place(group.chain, group.resid, group.icode, group.resname)} ${letters.join('+')}`
    focus(group.id, group.selection, label, letters.join(','), group.default, group)
  }

  /**
   * @param {string} chain
   * @param {number} resid
   * @param {string} [icode]
   * @param {string} [resname]
   */
  function place(chain, resid, icode = '', resname = '') {
    return `${chain || '?'}${resid}${icode || ''}${resname ? ` ${resname}` : ''}`
  }

  function keepMostProbable() {
    if (!onKeepLikely()) return
    const group = altlocs.find((item) => item.id === active)
    if (!group?.default) return
    const letter = group.default
    focus(
      group.id,
      group.selection,
      `${place(group.chain, group.resid, group.icode, group.resname)} ${letter}`,
      letter,
      letter,
      group
    )
  }

  /**
   * @param {string} chain
   * @param {number | null | undefined} from
   * @param {number | null | undefined} to
   */
  function spanSelection(chain, from, to) {
    if (!chain || (from == null && to == null)) return ''
    if (from == null) return `chainID ${chain} and resid ${to}`
    if (to == null || from === to) return `chainID ${chain} and resid ${from}`
    return `chainID ${chain} and resid ${from} to ${to}`
  }

  /** @param {string} key */
  function rowClass(key) {
    return `block w-full rounded px-1 py-0.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
      active === key ? 'bg-yellow-500/15' : ''
    }`
  }
</script>

<div
  class="viewer-side-panel--nonmodal fixed top-10 bottom-10 left-16 z-50 flex w-[440px] max-w-[calc(100vw-5rem)] flex-col overflow-hidden rounded-lg border border-neutral-300 bg-white p-0 text-neutral-900 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
  role="dialog"
  aria-labelledby="structure-checker-title"
>
  <div class="flex items-center justify-between border-b dialog-divider px-4 py-2.5">
    <h3 id="structure-checker-title" class="text-sm font-semibold">Structure checker</h3>
    <button type="button" class="dialog-btn-outline px-2 py-0.5 text-xs" onclick={onClose}>✕</button>
  </div>
  <div class="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2 text-[11px]">
    {#if busy && !report}
      <p class="flex items-center gap-2 px-1 text-neutral-500"><Spinner /> Checking the structure…</p>
    {:else if summary}
      <p class="px-1 pb-1 text-neutral-500">
        {summary.missing_atoms} missing atoms · {summary.missing_residues} missing residues · {summary.gaps} breaks · {summary.altlocs} alternate conformations · {summary.chain_differences} chain differences · {summary.other} other
      </p>
      {#if quiet}
        <p class="px-1">Nothing to report. The loaded model has no missing heavy atoms, gaps, alternate conformations, or chain differences.</p>
      {/if}

      {#if report.missing_atoms?.length}
        <section class="rounded border border-neutral-200 dark:border-neutral-700">
          <button type="button" class="flex w-full items-center justify-between px-2 py-1.5 text-left font-semibold" onclick={() => toggle('atoms')}>
            <span>Missing atoms ({report.missing_atoms.length})</span>
            <span class="text-neutral-500">{open.atoms ? '▾' : '▸'}</span>
          </button>
          {#if open.atoms}
            <div class="space-y-0.5 border-t border-neutral-200 px-1 py-1 dark:border-neutral-700">
              {#each report.missing_atoms as row, i}
                <button type="button" class={rowClass(`atom-${i}`)} onclick={() => focus(`atom-${i}`, row.selection, `${place(row.chain, row.resid, row.icode, row.resname)} missing ${row.atom}`)}>
                  {place(row.chain, row.resid, row.icode, row.resname)} is missing {row.atom}
                </button>
              {/each}
            </div>
          {/if}
        </section>
      {/if}

      {#if report.missing_residues?.length}
        <section class="rounded border border-neutral-200 dark:border-neutral-700">
          <button type="button" class="flex w-full items-center justify-between px-2 py-1.5 text-left font-semibold" onclick={() => toggle('residues')}>
            <span>Missing residues ({report.missing_residues.length})</span>
            <span class="text-neutral-500">{open.residues ? '▾' : '▸'}</span>
          </button>
          {#if open.residues}
            <div class="space-y-0.5 border-t border-neutral-200 px-1 py-1 dark:border-neutral-700">
              {#each report.missing_residues as row, i}
                <button type="button" class={rowClass(`res-${i}`)} onclick={() => focus(`res-${i}`, row.selection, row.source === 'seqres' ? `Chain ${row.chain || '?'} SEQRES gap` : `Chain ${row.chain} gap ${row.after_resid}–${row.before_resid}`)}>
                  {#if row.source === 'seqres'}
                    Chain {row.chain || '?'} SEQRES has {row.count} names without coordinates{row.resnames?.length ? `: ${row.resnames.join(' ')}` : ''}.
                  {:else}
                    Chain {row.chain} is missing {row.count} residue{row.count === 1 ? '' : 's'} between {row.after_resid} and {row.before_resid}{row.missing?.length ? ` (${row.missing.join(', ')})` : ''}.
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </section>
      {/if}

      {#if report.gaps?.length}
        <section class="rounded border border-neutral-200 dark:border-neutral-700">
          <button type="button" class="flex w-full items-center justify-between px-2 py-1.5 text-left font-semibold" onclick={() => toggle('gaps')}>
            <span>Backbone breaks ({report.gaps.length})</span>
            <span class="text-neutral-500">{open.gaps ? '▾' : '▸'}</span>
          </button>
          {#if open.gaps}
            <div class="space-y-0.5 border-t border-neutral-200 px-1 py-1 dark:border-neutral-700">
              {#each report.gaps as row, i}
                <button type="button" class={rowClass(`gap-${i}`)} onclick={() => focus(`gap-${i}`, row.selection, `Chain ${row.chain} break ${row.resid_a}–${row.resid_b}`)}>
                  Chain {row.chain}: {row.resname_a} {row.resid_a} to {row.resname_b} {row.resid_b} is {row.distance} Å
                </button>
              {/each}
            </div>
          {/if}
        </section>
      {/if}

      {#if altlocs.length}
        <section class="rounded border border-neutral-200 dark:border-neutral-700">
          <button type="button" class="flex w-full items-center justify-between px-2 py-1.5 text-left font-semibold" onclick={() => toggle('alt')}>
            <span>Alternate conformations ({altlocs.length})</span>
            <span class="text-neutral-500">{open.alt ? '▾' : '▸'}</span>
          </button>
          {#if open.alt}
            <div class="space-y-2 border-t border-neutral-200 px-2 py-1.5 dark:border-neutral-700">
              <p class="text-neutral-500">Each row is one residue. Check one letter or both. The most likely conformation is drawn with yellow carbons. The other stays gray. Atoms that overlap and have no altLoc letter are listed here too.</p>
              {#each altlocs as group}
                {@const letters = shownLetters(group)}
                <div class="relative rounded border border-neutral-200 px-2 py-1.5 dark:border-neutral-700 {active === group.id ? 'bg-yellow-500/15' : ''}">
                  <button
                    type="button"
                    class="absolute inset-0 rounded"
                    aria-label="Show {place(group.chain, group.resid, group.icode, group.resname)}"
                    onclick={() => focus(group.id, group.selection, `${place(group.chain, group.resid, group.icode, group.resname)} ${letters.join('+')}`, letters.join(','), group.default, group)}
                  ></button>
                  <div class="pointer-events-none relative mb-1 font-medium">
                    {group.label || place(group.chain, group.resid, group.icode, group.resname)}
                  </div>
                  {#if group.inferred}
                    <p class="pointer-events-none relative mb-1 text-neutral-500">These atoms overlap. No altLoc letter was set, so they are treated as alternate conformations.</p>
                  {/if}
                  <div class="relative z-10 flex flex-wrap gap-2">
                    {#each group.options as option}
                      <label class="inline-flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={letters.includes(option.altloc)}
                          onchange={() => toggleLetter(group, option.altloc)}
                        />
                        <span class={option.likely ? 'text-yellow-700 dark:text-yellow-300' : ''}>
                          {option.altloc} {Number(option.occupancy).toFixed(2)}{option.likely ? ' · most likely' : ''}
                        </span>
                      </label>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </section>
      {/if}

      {#if report.chain_pairs?.length}
        <section class="rounded border border-neutral-200 dark:border-neutral-700">
          <button type="button" class="flex w-full items-center justify-between px-2 py-1.5 text-left font-semibold" onclick={() => toggle('chains')}>
            <span>Chains ({report.chain_pairs.length})</span>
            <span class="text-neutral-500">{open.chains ? '▾' : '▸'}</span>
          </button>
          {#if open.chains}
            <div class="space-y-2 border-t border-neutral-200 px-2 py-1.5 dark:border-neutral-700">
              {#each report.chain_pairs as pair, pi}
                {@const pairSelection = `chainID ${pair.chain_a} or chainID ${pair.chain_b}`}
                <div class="rounded border border-neutral-200 px-2 py-1.5 dark:border-neutral-700">
                  <button type="button" class={rowClass(`pair-${pi}`)} onclick={() => focus(`pair-${pi}`, pairSelection, `Chains ${pair.chain_a} and ${pair.chain_b}`)}>
                    Chain {pair.chain_a} ({pair.length_a}) and chain {pair.chain_b} ({pair.length_b})
                  </button>
                  <p class="text-neutral-500">{pair.same ? 'These chains match.' : pair.length_note} Identity {Math.round(pair.identity * 100)}%.</p>
                  {#each pair.substitutions as sub, si}
                    <button type="button" class={rowClass(`sub-${pi}-${si}`)} onclick={() => focus(`sub-${pi}-${si}`, sub.selection, `${pair.chain_a}${sub.resid_a} ${sub.resname_a} vs ${pair.chain_b}${sub.resid_b} ${sub.resname_b}`)}>
                      {pair.chain_a}{sub.resid_a} {sub.resname_a} differs from {pair.chain_b}{sub.resid_b} {sub.resname_b}
                    </button>
                  {/each}
                  {#each pair.length_differences as diff, di}
                    {@const diffSelection = [spanSelection(diff.chain_a, diff.from_resid_a, diff.to_resid_a), spanSelection(diff.chain_b, diff.from_resid_b, diff.to_resid_b)].filter(Boolean).join(' or ')}
                    <button type="button" class={rowClass(`len-${pi}-${di}`)} onclick={() => focus(`len-${pi}-${di}`, diffSelection, `Length difference ${diff.chain_a} and ${diff.chain_b}`)}>
                      {diff.count_a} residues on {diff.chain_a} line up with {diff.count_b} on {diff.chain_b}.
                    </button>
                  {/each}
                </div>
              {/each}
            </div>
          {/if}
        </section>
      {/if}

      {#if report.issues?.length}
        <section class="rounded border border-neutral-200 dark:border-neutral-700">
          <button type="button" class="flex w-full items-center justify-between px-2 py-1.5 text-left font-semibold" onclick={() => toggle('other')}>
            <span>Other ({report.issues.length})</span>
            <span class="text-neutral-500">{open.other ? '▾' : '▸'}</span>
          </button>
          {#if open.other}
            <div class="space-y-0.5 border-t border-neutral-200 px-1 py-1 dark:border-neutral-700">
              {#each report.issues as issue, i}
                <button type="button" class={rowClass(`issue-${i}`)} onclick={() => focus(`issue-${i}`, issue.selection, issue.message)}>
                  {issue.message}
                </button>
              {/each}
            </div>
          {/if}
        </section>
      {/if}
    {/if}
    {#if error}
      <p class="gw-notice gw-notice-error font-mono text-[11px]">{error}</p>
    {/if}
  </div>
  <div class="space-y-2 border-t dialog-divider px-4 py-3">
    {#if previewLabel}
      <p class="text-[11px] text-neutral-500">Licorice on {previewLabel}. It goes away when you open another finding.</p>
    {/if}
    <div class="flex flex-wrap justify-end gap-2">
      <button type="button" class="dialog-btn-outline" disabled={!previewLabel} onclick={onKeepPreview}>
        Keep representation
      </button>
      <button type="button" class="dialog-btn-outline" disabled={busy || !altlocs.length} onclick={keepMostProbable}>
        Keep most probable
      </button>
      <button
        type="button"
        class="flex items-center gap-1 rounded bg-yellow-600 px-3 py-1 text-xs font-semibold text-black hover:bg-yellow-500 disabled:opacity-40"
        disabled={busy || !altlocs.length || trajectory}
        title={trajectory ? 'A trajectory stays on its own topology. Apply is for a structure file.' : 'Write a PDB with the chosen conformations'}
        onclick={onApply}
      >
        {#if busy}<Spinner />{/if} Apply
      </button>
    </div>
  </div>
</div>
