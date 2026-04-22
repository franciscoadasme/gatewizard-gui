<script>
  import Button from '../components/ui/Button.svelte'
  import Divider from '../components/ui/Divider.svelte'
  import EquilibrationStage from '../components/EquilibrationStage.svelte'
  import protocols from '../../../../resources/protocols.json'
  import Checkbox from '../components/ui/Checkbox.svelte'
  import Input from '../components/ui/Input.svelte'
  import Select from '../components/ui/Select.svelte'

  /** @type {Record<string, { default: import('svelte').Component, label?: string }>} */
  const engineModules = import.meta.glob('./equilibration/engines/*.svelte', { eager: true })
  const engines = Object.entries(engineModules)
    .map(([path, mod]) => {
      const name = path.split('/').pop().replace('.svelte', '')
      return {
        id: name.toLowerCase(),
        label: mod.label ?? name,
        Component: mod.default
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))

  /** @type {{ workingDir?: string }} */
  let { workingDir = '' } = $props()

  let engine = $state('namd')
  let ensemble = $state('nvt')
  let inputDir = $state('')
  let outputDir = $state('equilibration')
  let stages = $state(protocols.base.stages)

  const CurrentEngine = $derived(engines.find((e) => e.id === engine)?.Component)

  async function selectInputDir() {
    const { canceled, dirPath } = await window.api.openDirectoryDialog(
      'Select Input Directory',
      workingDir
    )
    if (canceled) {
      return
    }
    inputDir = dirPath
  }
</script>

<div class="flex min-w-0 flex-1 divide-x divide-neutral-800 select-none">
  <aside class="w-70 space-y-4 overflow-x-clip overflow-y-auto p-4 text-xs">
    <div class="space-y-2">
      <div class="space-y-1">
        <p class="text-xs">Input directory:</p>
        <p class="text-xs text-neutral-500">
          Must contain <code>.prmtop</code> and <code>.inpcrd</code> files.
        </p>
        {#if inputDir}
          <Input type="text" value={inputDir} className="w-full" disabled />
          <Button variant="outline" className="w-full" onclick={selectInputDir}
            >Select another directory...</Button
          >
        {:else}
          <Button variant="outline" className="w-full" onclick={selectInputDir}
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
          {#each engines as engine (engine.id)}
            <option value={engine.id}>{engine.label}</option>
          {/each}
        </Select>
      </div>
      {#if CurrentEngine}
        <CurrentEngine />
      {/if}
    </div>
    <Divider />
    <div class="space-y-2">
      <Button className="w-full">Run Equilibration</Button>
      <Button className="w-full" variant="outline">Generate Input Files</Button>
    </div>
  </aside>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <div class="flex min-h-0 flex-1 flex-col space-y-4 p-4">
      <div class="">
        <h2 class="text-lg font-bold">Equilibration</h2>
        <p class="text-sm text-neutral-500">
          Setup and run an equilibration protocol for membrane protein systems
        </p>
      </div>
      <Divider />
      <div>
        <h3 class="font-semibold">Protocol</h3>
        <div class="flex items-center gap-2">
          <p class="text-sm">Ensemble:</p>
          <Select bind:value={ensemble}>
            <option value="npt">NPT</option>
            <option value="nvt">NVT</option>
            <option value="npat">NPAT</option>
            <option value="npgt">NPgT</option>
          </Select>
          <Button variant="outline">Load</Button>
          <Button variant="outline">Save</Button>
        </div>
      </div>
      <div class="flex min-h-0 w-full flex-1 items-start gap-4 overflow-auto pb-2">
        {#each stages as _, i (stages[i].name)}
          <EquilibrationStage bind:stage={stages[i]} {ensemble} />
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
        {#each stages as stage (stage.name)}
          <div class="flex items-center gap-2">
            <p class="text-xs">{stage.name}</p>
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>
