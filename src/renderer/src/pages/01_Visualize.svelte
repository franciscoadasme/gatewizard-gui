<script>
  import MoleculeCanvas from '../components/MoleculeCanvas.svelte'

  let pingResult = $state('')
  let pingLoading = $state(false)

  async function onDownloadPdb(event) {
    event.preventDefault()
    pingLoading = true
    pingResult = ''
    try {
      const data = await window.api.pingBackend()
      const msg = typeof data?.message === 'string' ? data.message : JSON.stringify(data)
      const gw =
        data && typeof data.gatewizard_version === 'string' ? data.gatewizard_version : null
      pingResult = gw ? `${msg} (gatewizard ${gw})` : msg
    } catch (err) {
      pingResult = err instanceof Error ? err.message : String(err)
    } finally {
      pingLoading = false
    }
  }
</script>

<div class="flex flex-1 divide-x divide-neutral-800">
  <div class="flex w-60 flex-col gap-2 p-2">
    <button
      class="w-full rounded-md p-2 active:translate-y-0.5 dark:bg-neutral-800 dark:hover:bg-neutral-700"
      type="button">Open PDB</button
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
        disabled={pingLoading}>{pingLoading ? '…' : 'Download PDB'}</button
      >
    </form>
    {#if pingResult}
      <p
        class="rounded-md border border-neutral-700 bg-neutral-900/50 p-2 font-mono text-sm text-neutral-200"
      >
        Backend: {pingResult}
      </p>
    {/if}
  </div>

  <MoleculeCanvas />

  <div class="w-60 p-2">
    <h2>Representations</h2>
  </div>
</div>
