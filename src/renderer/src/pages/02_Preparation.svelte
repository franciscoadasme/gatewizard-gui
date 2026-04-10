<script>
  import Button from '../components/ui/Button.svelte'
  import Checkbox from '../components/ui/Checkbox.svelte'
  import Divider from '../components/ui/Divider.svelte'

  let capProtein = $state(false)
  let disulfideBonds = $state([])
  let maxDisulfideDistance = $state(2.5)
  let targetPh = $state(7.0)
  let workingFile = $state('foo.pdb')

  let protonatedFile = $derived(workingFile.replace('.pdb', '_protonated.pdb'))
</script>

<div class="flex flex-1 divide-x divide-neutral-800 select-none">
  <aside class="w-70 space-y-4 p-4 text-xs">
    <div class="space-y-2">
      {#if workingFile}
        <p class="mb-1">Working file:</p>
        <p class="rounded-md border p-2 dark:border-neutral-800 dark:text-neutral-400">
          {workingFile}
        </p>
      {:else}
        <form>
          <label for="search" class="mb-1 block">Working file:</label>
          <Button variant="outline" className="w-full">Click to select a file...</Button>
        </form>
      {/if}
      <div>
        <p class="mb-1">Export Protonated File:</p>
        <p class="rounded-md border p-2 dark:border-neutral-800 dark:text-neutral-400">
          {protonatedFile}
        </p>
      </div>
    </div>
    <Divider />
    <form class="space-y-2">
      <h2 class="font-semibold">PropKa Analysis</h2>
      <div class="flex items-center gap-1">
        <label for="target-ph" class="flex-1">Target pH:</label>
        <input
          type="text"
          inputmode="decimal"
          name="target-ph"
          class="w-20 rounded-md border p-2 dark:border-neutral-700 dark:hover:bg-neutral-700"
          bind:value={targetPh}
        />
      </div>
      <div class="flex items-center gap-1">
        <Checkbox name="protein-cap" bind:checked={capProtein} />
        <label for="protein-cap">Cap protein termini (ACE/NME)</label>
      </div>
      <Button type="submit" className="w-full">Run PropKa</Button>
    </form>
    <Divider />
    <form class="space-y-2">
      <h2 class="font-semibold">Disulfide Bonding</h2>
      <div class="flex items-center gap-1">
        <label for="max-ss-distance" class="flex-1">Max S-S distance (Å):</label>
        <input
          type="text"
          inputmode="decimal"
          name="max-ss-distance"
          class="w-20 rounded-md border p-2 dark:border-neutral-700 dark:hover:bg-neutral-700"
          bind:value={maxDisulfideDistance}
        />
      </div>
      <Button type="submit" variant="outline" className="w-full">Detect bonds</Button>
      <div class="space-y-2">
        <p>Detected S-S bonds:</p>
        <pre class="rounded-md border p-2 dark:border-neutral-800">No disulfide bonds detected.
        </pre>
      </div>
    </form>
    <Divider />
    <div class="space-y-2">
      <Button className="w-full">Prepare</Button>
      <Button className="w-full" variant="outline">Export Results</Button>
      <Button className="w-full" variant="outline">Reset</Button>
    </div>
    <pre class="rounded-md border p-2 dark:border-neutral-800">No output yet.</pre>
  </aside>
  <div class="flex-1 p-4">
    <h1 class="text-xl font-semibold text-neutral-800">Preparation</h1>
    <p class="mt-2 text-neutral-600">Stage: preparation workflow.</p>
    <p class="rounded-md border p-2 text-sm dark:border-neutral-800">
      Target pH: {targetPh}<br />
      Cap protein termini: {capProtein}<br />
      Max S-S distance: {maxDisulfideDistance}<br />
      Disulfide bonds: {disulfideBonds.length}<br />
      Protonated file: {protonatedFile}<br />
      Working file: {workingFile}
    </p>
  </div>
</div>
