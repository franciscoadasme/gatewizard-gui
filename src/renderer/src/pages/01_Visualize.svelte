<script>
  import MoleculeCanvas from '../components/MoleculeCanvas.svelte'
  import { loadPdb, selectAtoms } from '../lib/backendApi.js'

  /** Shown under the buttons: PDB info or ping output. */
  let sidebarResult = $state('')
  let openPdbLoading = $state(false)
  let filePath = $state(null)
  let selection = $state(null)
  let selectionError = $state(null)

  /** Passed to Threlte viewer (positions + elements from backend). */
  /** @type {null | { n_atoms: number, positions: number[], elements: string[] }} */
  let structure = $state(null)

  async function onOpenPdb() {
    openPdbLoading = true
    sidebarResult = ''
    try {
      const dlg = await window.api.openPdbDialog()
      if (dlg.canceled) {
        return
      }
      filePath = dlg.filePath

      structure = await loadPdb(dlg.filePath)
      const base = dlg.filePath.split(/[/\\]/).pop() ?? dlg.filePath
      const n = structure?.n_atoms
      sidebarResult = typeof n === 'number' ? `${n} atoms — ${base}` : JSON.stringify(structure)
    } catch (err) {
      sidebarResult = err instanceof Error ? err.message : String(err)
      structure = null
    } finally {
      openPdbLoading = false
    }
  }

  async function onSelect() {
    try {
      structure = await selectAtoms(filePath, selection)
      selectionError = null
    } catch (ex) {
      selectionError = ex instanceof Error ? ex.message : String(ex)
    }
  }
</script>

<div class="flex flex-1 divide-x divide-neutral-800">
  <div class="flex w-60 flex-col gap-2 p-2">
    <button
      class="w-full rounded-md p-2 active:translate-y-0.5 disabled:opacity-50 dark:bg-neutral-800 dark:hover:bg-neutral-700"
      type="button"
      disabled={openPdbLoading}
      onclick={onOpenPdb}>{openPdbLoading ? '...' : 'Open PDB...'}</button
    >
    <form class="flex flex-col gap-1">
      <input
        type="text"
        class="w-full rounded-md border p-2 dark:border-neutral-700 dark:hover:bg-neutral-700"
        placeholder="PDB ID (e.g. 1crn)"
      />
      <button
        class="w-full rounded-md p-2 active:translate-y-0.5 disabled:opacity-50 dark:bg-neutral-800 dark:hover:bg-neutral-700"
        type="submit"
        disabled={openPdbLoading}>Download PDB</button
      >
    </form>
    <input
      type="text"
      class="w-full rounded-md border p-2 dark:border-neutral-700 dark:hover:bg-neutral-700"
      placeholder="Selection (e.g. protein)"
      bind:value={selection}
      onchange={onSelect}
    />
    {#if selectionError}
      <p class="text-red-500 text-xs font-semibold">{selectionError}</p>
    {/if}
    {#if sidebarResult}
      <p
        class="rounded-md border border-neutral-700 bg-neutral-900/50 p-2 font-mono text-sm text-neutral-200"
      >
        {sidebarResult}
      </p>
    {/if}
  </div>

  <MoleculeCanvas {structure} />

  <div class="w-60 p-2">
    <h2>Representations</h2>
  </div>
</div>
