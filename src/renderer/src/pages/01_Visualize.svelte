<script>
  import MoleculeCanvas from '../components/MoleculeCanvas.svelte'
</script>

<div class="flex flex-1 divide-x divide-neutral-800">
  <div class="flex w-60 flex-col gap-2 p-2">
    <button
      class="w-full rounded-md p-2 active:translate-y-0.5 dark:bg-neutral-800 dark:hover:bg-neutral-700"
      type="button">Open PDB</button
    >
    <form class="flex flex-col gap-1">
      <input
        type="text"
        class="w-full rounded-md border p-2 dark:border-neutral-700 dark:hover:bg-neutral-700"
        placeholder="PDB ID (e.g. 1crn)"
      />
      <button
        class="w-full rounded-md p-2 active:translate-y-0.5 dark:bg-neutral-800 dark:hover:bg-neutral-700"
        type="submit">Download PDB</button
      >
    </form>
  </div>

  <MoleculeCanvas />

  <div class="w-60 p-2">
    <h2>Representations</h2>
  </div>
</div>
