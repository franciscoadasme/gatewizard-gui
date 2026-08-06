<script>
  import Protein from './icons/Protein.svelte'
  import Button from './ui/Button.svelte'

  /**
   * @typedef {{
   *   n_atoms: number
   *   n_residues: number
   *   n_segments: number
   *   segments?: Array<{ segid: string, n_residues: number, n_atoms: number }>
   *   residue_types?: string[]
   *   categories?: Record<string, { total_residues: number, total_atoms: number, by_name: Record<string, number> }>
   *   lipid_headgroup_atoms?: Array<{ name: string, atom_count: number }>
   *   lipid_headgroup_selection?: string
   * }} TopoInfo
   */

  /** @type {{ topoInfo: TopoInfo, onClose?: () => void }} */
  let { topoInfo, onClose = () => {} } = $props()
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
  onmousedown={onClose}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="mx-4 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border border-neutral-300 bg-white p-5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
    onmousedown={(e) => e.stopPropagation()}
  >
    <h2 class="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-50">Topology Summary</h2>

    <div class="mb-4 grid grid-cols-3 gap-2">
      <div class="rounded border border-neutral-200 p-2 text-center dark:border-neutral-800">
        <p class="text-neutral-500">Atoms</p>
        <p class="text-sm font-semibold">{topoInfo.n_atoms.toLocaleString()}</p>
      </div>
      <div class="rounded border border-neutral-200 p-2 text-center dark:border-neutral-800">
        <p class="text-neutral-500">Residues</p>
        <p class="text-sm font-semibold">{topoInfo.n_residues.toLocaleString()}</p>
      </div>
      <div class="rounded border border-neutral-200 p-2 text-center dark:border-neutral-800">
        <p class="text-neutral-500">Segments</p>
        <p class="text-sm font-semibold">{topoInfo.n_segments}</p>
      </div>
    </div>

    {#if topoInfo.categories && Object.keys(topoInfo.categories).length > 0}
      <p class="mb-1.5 font-medium">Molecule categories</p>
      <div class="mb-4 space-y-2">
        {#each Object.entries(topoInfo.categories) as [cat, info] (cat)}
          <div class="rounded border border-neutral-200 p-2 dark:border-neutral-800">
            <div class="mb-1 flex items-center justify-between gap-2">
              <span class="flex items-center gap-1.5 font-medium">
                {#if cat === 'Protein'}
                  <Protein className="size-3.5 shrink-0" />
                {:else if cat === 'Water'}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="size-3.5 shrink-0"
                    aria-hidden="true"
                  >
                    <path d="M9.7 11.8 7.6 9.3" />
                    <path d="M14.3 11.8 16.4 9.3" />
                    <circle cx="12" cy="14.5" r="3.6" />
                    <circle cx="6" cy="7.5" r="2.4" class="fill-white dark:fill-neutral-900" />
                    <circle cx="18" cy="7.5" r="2.4" class="fill-white dark:fill-neutral-900" />
                  </svg>
                {:else if cat === 'Nucleic'}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="size-3.5 shrink-0"
                    aria-hidden="true"
                  >
                    <path d="M8 2c0 5 8 5 8 10s-8 5-8 10" />
                    <path d="M16 2c0 5-8 5-8 10s8 5 8 10" />
                    <path d="M9.5 5h5" />
                    <path d="M8 12h8" />
                    <path d="M9.5 19h5" />
                  </svg>
                {:else if cat === 'Ions'}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="size-3.5 shrink-0"
                    aria-hidden="true"
                  >
                    <circle cx="8.5" cy="8.5" r="5" />
                    <path d="M8.5 6v5M6 8.5h5" />
                    <circle cx="17" cy="17" r="4" />
                    <path d="M15 17h4" />
                  </svg>
                {:else if cat === 'Lipids'}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="size-3.5 shrink-0"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="5" r="3" />
                    <path d="M10.7 7.8c-1.9 1.8-2 3.4-.7 5.3s1.2 3.6-.4 5.4" />
                    <path d="M13.3 7.8c1.9 1.8 2 3.4.7 5.3s-1.2 3.6.4 5.4" />
                  </svg>
                {:else}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="size-3.5 shrink-0"
                    aria-hidden="true"
                  >
                    <path d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4z" />
                  </svg>
                {/if}
                {cat}
              </span>
              <span class="text-neutral-500 dark:text-neutral-400"
                >{info.total_residues} residues · {info.total_atoms.toLocaleString()} atoms</span
              >
            </div>
            <p class="leading-relaxed text-neutral-600 dark:text-neutral-500">
              {#each Object.entries(info.by_name).sort() as [rname, count] (rname)}
                <span class="mr-2"
                  ><span class="text-neutral-800 dark:text-neutral-300">{rname}</span> ×{count}</span
                >
              {/each}
            </p>
          </div>
        {/each}
      </div>
    {/if}

    {#if topoInfo.segments && topoInfo.segments.length > 1}
      <p class="mb-1 font-medium">Segments</p>
      <table class="mb-4 w-full">
        <thead>
          <tr class="border-b border-neutral-200 text-neutral-500 dark:border-neutral-800">
            <th class="pb-1 text-left">SegID</th>
            <th class="pb-1 text-right">Residues</th>
            <th class="pb-1 text-right">Atoms</th>
          </tr>
        </thead>
        <tbody>
          {#each topoInfo.segments as seg (seg.segid)}
            <tr class="border-b border-neutral-200/80 dark:border-neutral-800/50">
              <td class="py-0.5 text-neutral-700 dark:text-neutral-300">{seg.segid}</td>
              <td class="py-0.5 text-right text-neutral-700 dark:text-neutral-300">{seg.n_residues}</td>
              <td class="py-0.5 text-right text-neutral-700 dark:text-neutral-300"
                >{seg.n_atoms.toLocaleString()}</td
              >
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}

    {#if topoInfo.lipid_headgroup_atoms?.length}
      <p class="mb-1 font-medium">Phosphate / headgroup atom names</p>
      <div class="mb-4 flex flex-wrap gap-1">
        {#each topoInfo.lipid_headgroup_atoms as atom (atom.name)}
          <span
            class="rounded border border-amber-700/40 bg-amber-50 px-2 py-1 font-mono text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-200"
          >
            {atom.name}
            <span class="text-amber-800/80 dark:text-amber-400/80">×{atom.atom_count}</span>
          </span>
        {/each}
      </div>
      {#if topoInfo.lipid_headgroup_selection}
        <p class="mb-4 font-mono text-neutral-600 dark:text-neutral-400"
          >{topoInfo.lipid_headgroup_selection}</p
        >
      {/if}
    {/if}

    {#if topoInfo.residue_types?.length}
      <p class="mb-1 font-medium">All residue types ({topoInfo.residue_types.length})</p>
      <p class="leading-relaxed text-neutral-600 dark:text-neutral-400"
        >{topoInfo.residue_types.join('  ')}</p
      >
    {/if}

    <Button className="mt-4 w-full" onclick={onClose}>Close</Button>
  </div>
</div>
