<script>
  import Divider from './ui/Divider.svelte'
  import Input from './ui/Input.svelte'
  import Checkbox from './ui/Checkbox.svelte'

  /** @type {{ stage: { name: string, description: string, time_ns: number, steps: number, ensemble: string, temperature: number, pressure: number, constraints: Record<string, number>, timestep: number, dcd_freq: number, use_gpu: boolean, cpu_cores: number, gpu_id: number, num_gpus: number, minimize_steps?: number, margin?: number }, ensemble: string }} */
  let { stage = $bindable(), ensemble } = $props()

  const uid = $props.id()
  const constraintKeys = $derived(Object.keys(stage.constraints))
</script>

<div class="rounded-md bg-neutral-900 p-4">
  <div class="mb-2">
    <h3>{stage.name}</h3>
    <p class="text-xs text-neutral-500">{stage.description}</p>
  </div>
  <form
    class="grid grid-cols-[1fr_--spacing(20)_auto] items-center gap-x-2 gap-y-1 text-sm text-nowrap"
  >
    <label for="{uid}-time_ns">Time:</label>
    <Input
      id="{uid}-time_ns"
      size="sm"
      type="number"
      min="0"
      max="5"
      step="0.1"
      bind:value={stage.time_ns}
    />
    <p class="text-xs text-neutral-500">ns</p>

    <label for="{uid}-steps">Steps:</label>
    <Input
      id="{uid}-steps"
      size="sm"
      type="number"
      min="0"
      max="1000000"
      step="1"
      bind:value={stage.steps}
    />
    <p class="text-xs text-neutral-500">steps</p>

    {#if stage.minimize_steps != null}
      <label for="{uid}-minimize">Minimize:</label>
      <Input
        id="{uid}-minimize"
        size="sm"
        type="number"
        min="0"
        max="1000000"
        step="1"
        bind:value={stage.minimize_steps}
      />
      <p class="text-xs text-neutral-500">steps</p>
    {/if}

    <label for="{uid}-ensemble">Ensemble:</label>
    <Input
      id="{uid}-ensemble"
      size="sm"
      value={stage.ensemble ?? ensemble.toUpperCase()}
      disabled
    />
    <p></p>

    <label for="{uid}-temperature">Temperature:</label>
    <Input
      id="{uid}-temperature"
      size="sm"
      type="number"
      min="0"
      max="500"
      step="1"
      bind:value={stage.temperature}
    />
    <p class="text-xs text-neutral-500">K</p>

    {#if (stage.ensemble || ensemble).includes('P')}
      <label for="{uid}-pressure">Pressure:</label>
      <Input
        id="{uid}-pressure"
        size="sm"
        type="number"
        min="0"
        max="5"
        step="0.1"
        bind:value={stage.pressure}
      />
      <p class="text-xs text-neutral-500">atm</p>
    {/if}

    <label for="{uid}-timestep">Timestep:</label>
    <Input
      id="{uid}-timestep"
      size="sm"
      type="number"
      min="1"
      max="4"
      step="1"
      bind:value={stage.timestep}
    />
    <p class="text-xs text-neutral-500">fs</p>

    <label for="{uid}-dcd_freq">DCD Frequency:</label>
    <Input
      id="{uid}-dcd_freq"
      size="sm"
      type="number"
      min="1"
      max="1000000"
      step="1"
      bind:value={stage.dcd_freq}
    />
    <p class="text-xs text-neutral-500">steps</p>

    {#if stage.margin != null}
      <label for="{uid}-margin">Margin:</label>
      <Input
        id="{uid}-margin"
        size="sm"
        type="number"
        min="1"
        max="10"
        step="0.1"
        bind:value={stage.margin}
      />
      <p class="text-xs text-neutral-500">Å</p>
    {/if}

    <div class="col-span-3 my-4">
      <Divider />
    </div>
    <h4 class="col-span-3 mb-2 font-semibold">Positional Restraints</h4>

    {#each constraintKeys as key (key)}
      <label for="{uid}-restraint_{key}" class="capitalize">{key.replace(/_/g, ' ')}:</label>
      <Input
        id="{uid}-restraint_{key}"
        size="sm"
        type="number"
        min="0.0"
        max="20.0"
        step="0.1"
        bind:value={stage.constraints[key]}
      />
      <p class="text-xs text-neutral-500">kcal/mol/Å²</p>
    {/each}

    <div class="col-span-3 my-4">
      <Divider />
    </div>
    <h4 class="col-span-3 mb-2 font-semibold">Computational Resources</h4>

    <label for="{uid}-cpu_cores">CPU Cores:</label>
    <Input id="{uid}-cpu_cores" size="sm" type="number" bind:value={stage.cpu_cores} />
    <p class="text-xs text-neutral-500">cores</p>

    <div class="col-span-3 mt-2 flex items-center gap-2">
      <Checkbox id="{uid}-use_gpu" bind:checked={stage.use_gpu} />
      <label for="{uid}-use_gpu">Enable GPU acceleration</label>
    </div>

    {#if stage.use_gpu}
      <label for="{uid}-gpu_id">GPU ID:</label>
      <Input id="{uid}-gpu_id" size="sm" type="number" bind:value={stage.gpu_id} />
      <p class="text-xs text-neutral-500">device ID</p>

      <label for="{uid}-num_gpus">Number of GPUs:</label>
      <Input id="{uid}-num_gpus" size="sm" type="number" bind:value={stage.num_gpus} />
      <p class="text-xs text-neutral-500">devices</p>
    {/if}
  </form>
</div>
