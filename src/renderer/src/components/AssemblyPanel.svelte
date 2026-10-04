<script>
  import Spinner from './ui/Spinner.svelte'

  /**
   * @type {{
   *   assemblies: Array<{
   *     id: string
   *     description: string
   *     oligomeric_count: number
   *     atom_count: number
   *     atom_count_with_waters: number
   *     already_biological_unit: boolean
   *     needs_confirmation: boolean
   *     needs_confirmation_with_waters: boolean
   *   }>
   *   assemblyId: string
   *   waters: boolean
   *   dropOverlaps: boolean
   *   confirmLarge: boolean
   *   busy: boolean
   *   error: string
   *   message: string
   *   trajectory: boolean
   *   onAssemblyId: (value: string) => void
   *   onWaters: (value: boolean) => void
   *   onDropOverlaps: (value: boolean) => void
   *   onConfirm: (value: boolean) => void
   *   onBuild: () => void
   *   onClose: () => void
   * }}
   */
  let {
    assemblies,
    assemblyId,
    waters,
    dropOverlaps,
    confirmLarge,
    busy,
    error,
    message,
    trajectory,
    onAssemblyId,
    onWaters,
    onDropOverlaps,
    onConfirm,
    onBuild,
    onClose
  } = $props()

  const selected = $derived(assemblies.find((row) => row.id === assemblyId) || null)
  const rawAtomCount = $derived(
    selected ? (waters ? selected.atom_count_with_waters : selected.atom_count) : 0
  )
  const stackedExtra = $derived(
    selected
      ? waters
        ? selected.stacked_extra_atoms_with_waters || 0
        : selected.stacked_extra_atoms || 0
      : 0
  )
  const stackedDetail = $derived(
    selected
      ? waters
        ? selected.stacked_detail_with_waters || ''
        : selected.stacked_detail || ''
      : ''
  )
  const atomCount = $derived(Math.max(0, rawAtomCount - (dropOverlaps ? stackedExtra : 0)))
  const proteinOverlap = $derived(
    selected && Array.isArray(selected.protein_overlap_chains) ? selected.protein_overlap_chains : []
  )
  const needsConfirm = $derived(
    selected
      ? waters
        ? selected.needs_confirmation_with_waters
        : selected.needs_confirmation
      : false
  )
  const canBuild = $derived(
    !!selected && !selected.already_biological_unit && (!needsConfirm || confirmLarge)
  )

  /** @param {typeof assemblies[number]} row */
  function optionLabel(row) {
    const count = waters ? row.atom_count_with_waters : row.atom_count
    const detail = row.description ? `${row.description} · ` : ''
    const copies = `${row.oligomeric_count} chain${row.oligomeric_count === 1 ? '' : 's'}`
    return `${row.id} — ${detail}${copies} · ${count.toLocaleString()} atoms`
  }
</script>

<div
  class="viewer-side-panel--nonmodal fixed top-10 bottom-10 left-16 z-50 flex w-[420px] max-w-[calc(100vw-5rem)] flex-col overflow-hidden rounded-lg border border-neutral-300 bg-white p-0 text-neutral-900 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
  role="dialog"
  aria-labelledby="build-assembly-title"
>
  <div class="flex items-center justify-between border-b dialog-divider px-4 py-2.5">
    <h3 id="build-assembly-title" class="text-sm font-semibold">Build assembly</h3>
    <button type="button" class="dialog-btn-outline px-2 py-0.5 text-xs" onclick={onClose}>✕</button>
  </div>
  <div class="flex flex-1 flex-col gap-3 overflow-auto px-4 py-3 text-xs">
    <p class="text-[11px] leading-snug text-neutral-500">
      Rebuilds the biological oligomer or capsid from the operators stored in the original PDB or
      mmCIF. The asymmetric unit stays loaded. Copies are named A1, A2, and so on, so each subunit
      stays distinct. A PDB chain column only holds one letter. Crystal waters are left out unless
      you ask for them.
    </p>
    {#if trajectory}
      <p class="text-[11px] leading-snug text-amber-700 dark:text-amber-300">
        Assembly operators are read from the original structure file, not from a trajectory frame.
      </p>
    {/if}
    {#if busy && !assemblies.length}
      <p class="flex items-center gap-2 text-[11px] text-neutral-500"><Spinner /> Reading operators…</p>
    {:else if assemblies.length}
      <label class="flex items-center gap-2">
        <span class="dialog-label w-16 shrink-0">Assembly</span>
        <select
          class="field-input min-w-0 flex-1"
          value={assemblyId}
          onchange={(e) => onAssemblyId(e.currentTarget.value)}
        >
          {#each assemblies as row (row.id)}
            <option value={row.id}>{optionLabel(row)}</option>
          {/each}
        </select>
      </label>
      <label class="flex items-center gap-2">
        <input
          type="checkbox"
          checked={waters}
          onchange={(e) => onWaters(e.currentTarget.checked)}
        />
        <span>Include crystal waters</span>
      </label>
      {#if stackedExtra > 0}
        <p class="text-[11px] leading-snug text-amber-700 dark:text-amber-300">
          {stackedExtra.toLocaleString()} extra {stackedExtra === 1 ? 'atom sits' : 'atoms sit'} on
          the same point as another copy{stackedDetail ? ` (${stackedDetail})` : ''}. Ions on a
          symmetry axis are stored once and then copied by every operator.
        </p>
        <label class="flex items-center gap-2">
          <input
            type="checkbox"
            checked={dropOverlaps}
            onchange={(e) => onDropOverlaps(e.currentTarget.checked)}
          />
          <span>Remove those extra copies</span>
        </label>
      {/if}
      {#if proteinOverlap.length}
        <p class="text-[11px] leading-snug text-amber-700 dark:text-amber-300">
          Protein atoms from {proteinOverlap.join(', ')} land on the same point. Those copies are
          kept.
        </p>
      {/if}
      {#if selected?.already_biological_unit}
        <p class="text-[11px] leading-snug text-neutral-500">
          Every operator is the identity, so there is nothing to build.
        </p>
      {:else if selected}
        <p class="text-[11px] leading-snug text-neutral-500">
          About {atomCount.toLocaleString()} atoms in {selected.oligomeric_count} chain{selected.oligomeric_count === 1 ? '' : 's'}.
        </p>
      {/if}
      {#if needsConfirm}
        <label class="flex items-start gap-2 text-[11px] leading-snug text-amber-700 dark:text-amber-300">
          <input
            type="checkbox"
            class="mt-0.5"
            checked={confirmLarge}
            onchange={(e) => onConfirm(e.currentTarget.checked)}
          />
          <span>
            This assembly is large enough to slow the viewer. Confirm before building it.
          </span>
        </label>
      {/if}
      {#if message}
        <p class="text-[11px] leading-snug text-neutral-500">{message}</p>
      {/if}
    {:else if message}
      <p class="text-[11px] leading-snug text-neutral-500">{message}</p>
    {/if}
    {#if error}
      <p class="gw-notice gw-notice-error font-mono text-[11px]">{error}</p>
    {/if}
  </div>
  <div class="flex justify-end gap-2 border-t dialog-divider px-4 py-3">
    <button
      type="button"
      class="flex items-center gap-1 rounded bg-yellow-600 px-3 py-1 text-xs font-semibold text-black hover:bg-yellow-500 disabled:opacity-40"
      disabled={busy || !canBuild}
      onclick={onBuild}
    >
      {#if busy}<Spinner />{/if}
      Build
    </button>
  </div>
</div>
