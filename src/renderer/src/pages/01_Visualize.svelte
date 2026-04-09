<script>
  import MoleculeCanvas from '../components/MoleculeCanvas.svelte'

  /** Shown under the buttons: PDB info or ping output. */
  let sidebarResult = $state('')
  let openPdbLoading = $state(false)
  let pingLoading = $state(false)

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
      const data = await window.api.loadPdb(dlg.filePath)
      const base = dlg.filePath.split(/[/\\]/).pop() ?? dlg.filePath
      const n = data?.n_atoms
      sidebarResult = typeof n === 'number' ? `${n} atoms — ${base}` : JSON.stringify(data)

      if (
        data &&
        typeof data.n_atoms === 'number' &&
        Array.isArray(data.positions) &&
        Array.isArray(data.elements)
      ) {
        structure = {
          n_atoms: data.n_atoms,
          positions: data.positions,
          elements: data.elements
        }
      } else {
        structure = null
      }
    } catch (err) {
      sidebarResult = err instanceof Error ? err.message : String(err)
      structure = null
    } finally {
      openPdbLoading = false
    }
  }

  /**
   * @param {SubmitEvent} event
   */
  async function onDownloadPdb(event) {
    event.preventDefault()
    pingLoading = true
    sidebarResult = ''
    try {
      const data = await window.api.pingBackend()
      const msg = typeof data?.message === 'string' ? data.message : JSON.stringify(data)
      const gw =
        data && typeof data.gatewizard_version === 'string' ? data.gatewizard_version : null
      sidebarResult = gw ? `${msg} (gatewizard ${gw})` : msg
    } catch (err) {
      sidebarResult = err instanceof Error ? err.message : String(err)
    } finally {
      pingLoading = false
    }
  }
</script>

<div class="flex flex-1 divide-x divide-neutral-800">
  <div class="flex w-60 flex-col gap-2 p-2">
    <button
      class="w-full rounded-md p-2 active:translate-y-0.5 disabled:opacity-50 dark:bg-neutral-800 dark:hover:bg-neutral-700"
      type="button"
      disabled={openPdbLoading || pingLoading}
      onclick={onOpenPdb}>{openPdbLoading ? '...' : 'Open PDB...'}</button
    >
    <form class="flex flex-col gap-1" onsubmit={onDownloadPdb}>
      <input
        type="text"
        class="w-full rounded-md border p-2 dark:border-neutral-700 dark:hover:bg-neutral-700"
        placeholder="PDB ID (e.g. 1crn)"
      />
      <button
        class="w-full rounded-md p-2 active:translate-y-0.5 disabled:opacity-50 dark:bg-neutral-800 dark:hover:bg-neutral-700"
        type="submit"
        disabled={pingLoading || openPdbLoading}>{pingLoading ? '...' : 'Download PDB'}</button
      >
    </form>
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
