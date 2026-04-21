<script>
  import Button from '../components/ui/Button.svelte'
  import Divider from '../components/ui/Divider.svelte'
  import EquilibrationStage from '../components/EquilibrationStage.svelte'
  import protocols from '../../../../resources/protocols.json'
  import Checkbox from '../components/ui/Checkbox.svelte'
  import Input from '../components/ui/Input.svelte'
  import Select from '../components/ui/Select.svelte'

  let engine = $state('namd')

  /** @type {{ workingDir?: string }} */
  let { workingDir = '' } = $props()

  let inputDir = $state('')
  let outputDir = $state('equilibration')
  let ensemble = $state('nvt')

  function onSelectInputDir() {
    const dir = window.api.showOpenDialog({
      title: 'Select a input directory',
      filters: [{ name: 'All Files', extensions: ['*'] }]
    })
    if (dir) {
      inputDir = dir
    }
  }
</script>

<div class="flex min-w-0 flex-1 divide-x divide-neutral-800 select-none">
  <aside class="w-70 space-y-4 overflow-x-clip overflow-y-auto p-4 text-xs">
    <div class="space-y-2">
      <div class="space-y-1">
        <p class="text-xs">Input directory:</p>
        {#if inputDir}
          <p
            class="w-full rounded-md border p-2 wrap-break-word dark:border-neutral-800 dark:text-neutral-400"
          >
            {inputDir}
          </p>
          <Button variant="outline" className="w-full" onclick={onSelectInputDir}
            >Select another directory...</Button
          >
        {:else}
          <Button variant="outline" className="w-full" onclick={onSelectInputDir}
            >Select a directory...</Button
          >
        {/if}
      </div>
      <div class="space-y-1">
        <p class="text-xs">Output directory:</p>
        <Input type="text" value={outputDir} className="w-full" disabled />
      </div>
    </div>
    <Divider />
    <div class="space-y-2">
      <h2 class="font-semibold">Molecular Dynamics</h2>
      <div class="space-y-1">
        <p class="text-xs">Engine:</p>
        <Select className="w-full" bind:value={engine}>
          <option value="ambermd">AmberMD</option>
          <option value="gromacs">Gromacs</option>
          <option value="namd">NAMD</option>
        </Select>
      </div>
      <div class="space-y-1">
        <p class="text-xs">Executable:</p>
        <Input type="text" value="namd3" className="w-full" />
      </div>
    </div>
    <Divider />
    <div class="space-y-2">
      <Button className="w-full">Run Equilibration</Button>
      <Button className="w-full" variant="outline">Generate Input Files</Button>
    </div>
  </aside>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <div class="flex min-h-0 flex-1 flex-col space-y-4 p-4">
      <h2 class="mb-2 text-lg font-bold">Equilibration Protocol</h2>
      <div class="flex items-center gap-2">
        <p class="text-xs">Equilibration Scheme:</p>
        <Select bind:value={ensemble}>
          <option value="npt">NPT</option>
          <option value="nvt">NVT</option>
          <option value="npat">NPAT</option>
          <option value="npgt">NPgT</option>
        </Select>
        <Button variant="outline">Load</Button>
        <Button variant="outline">Save</Button>
      </div>
      <div class="flex min-h-0 w-full flex-1 items-start gap-4 overflow-auto pb-2">
        {#each protocols.base.stages as stage}
          <EquilibrationStage {stage} {ensemble} />
        {/each}
      </div>
    </div>
    <div
      class="max-h-2/5 min-h-1/5 space-y-2 overflow-y-auto border-t p-4 text-xs dark:border-neutral-800"
    >
      <h3 class="font-semibold uppercase">Progress</h3>
      <div class="flex items-center gap-2">
        <Checkbox name="auto-monitor" size="sm" />
        Update progress every
        <Input
          type="number"
          name="update-interval"
          min="1"
          max="100"
          step="1"
          value={5}
          size="sm"
          className="w-16"
        /> seconds
        <Button variant="outline" size="sm">Refresh</Button>
        <Button variant="outline" size="sm">Process Information</Button>
      </div>
      <div class="">
        {#each protocols.base.stages as stage}
          <div class="flex items-center gap-2">
            <p class="text-xs">{stage.name}</p>
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>
