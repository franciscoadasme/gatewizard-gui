<script>
  import Divider from './ui/Divider.svelte'
  import Input from './ui/Input.svelte'
  import Checkbox from './ui/Checkbox.svelte'

  /** @type {{ stage: { name: string, description: string, time_ns: number, steps: number, ensemble: string, temperature: number, pressure: number, constraints: Record<string, number>, timestep: number, dcd_freq: number, use_gpu: boolean, cpu_cores: number, gpu_id: number, num_gpus: number, minimize_steps?: number, margin?: number }, ensemble: string }} */
  let { stage, ensemble } = $props()
</script>

<div class="rounded-md bg-neutral-900 p-4">
  <div class="mb-2">
    <h3>{stage.name}</h3>
    <p class="text-xs text-neutral-500">{stage.description}</p>
  </div>
  <div
    class="grid grid-cols-[1fr_--spacing(20)_auto] items-center gap-x-2 gap-y-1 text-sm text-nowrap"
  >
    <label for="time_ns">Time:</label>
    <Input id="time_ns" size="sm" type="number" min="0" max="5" step="0.1" value={stage.time_ns} />
    <p class="text-xs text-neutral-500">ns</p>

    <label for="steps">Steps:</label>
    <Input id="steps" size="sm" type="number" min="0" max="1000000" step="1" value={stage.steps} />
    <p class="text-xs text-neutral-500">steps</p>

    {#if stage.minimize_steps}
      <label for="minimize">Minimize:</label>
      <Input
        id="minimize"
        size="sm"
        type="number"
        min="0"
        max="1000000"
        step="1"
        value={stage.minimize_steps}
      />
      <p class="text-xs text-neutral-500">steps</p>
    {/if}

    <label for="ensemble">Ensemble:</label>
    <Input id="ensemble" size="sm" value={stage.ensemble ?? ensemble.toUpperCase()} disabled />
    <p></p>

    <label for="temperature">Temperature:</label>
    <Input
      id="temperature"
      size="sm"
      type="number"
      min="0"
      max="500"
      step="1"
      value={stage.temperature}
    />
    <p class="text-xs text-neutral-500">K</p>

    {#if (stage.ensemble || ensemble).includes('P')}
      <label for="pressure">Pressure:</label>
      <Input
        id="pressure"
        size="sm"
        type="number"
        min="0"
        max="5"
        step="0.1"
        value={stage.pressure}
      />
      <p class="text-xs text-neutral-500">atm</p>
    {/if}

    <label for="timestep">Timestep:</label>
    <Input id="timestep" size="sm" type="number" min="1" max="4" step="1" value={stage.timestep} />
    <p class="text-xs text-neutral-500">fs</p>

    <label for="dcd_freq">DCD Frequency:</label>
    <Input
      id="dcd_freq"
      size="sm"
      type="number"
      min="1"
      max="1000000"
      step="1"
      value={stage.dcd_freq}
    />
    <p class="text-xs text-neutral-500">steps</p>

    {#if stage.margin}
      <label for="margin">Margin:</label>
      <Input id="margin" size="sm" type="number" min="1" max="10" step="0.1" value={stage.margin} />
      <p class="text-xs text-neutral-500">Å</p>
    {/if}

    <div class="col-span-3 my-4">
      <Divider />
    </div>
    <h4 class="col-span-3 mb-2 font-semibold">Positional Restraints</h4>

    {#each Object.entries(stage.constraints) as [key, value] (key)}
      <label for={`restraint_${key}`} class="capitalize">{key.replace(/_/g, ' ')}:</label>
      <Input
        id={`restraint_${key}`}
        size="sm"
        type="number"
        min="0.0"
        max="20.0"
        step="0.1"
        {value}
      />
      <p class="text-xs text-neutral-500">kcal/mol/Å²</p>
    {/each}

    <div class="col-span-3 my-4">
      <Divider />
    </div>
    <h4 class="col-span-3 mb-2 font-semibold">Computational Resources</h4>

    <label for="cpu_cores">CPU Cores:</label>
    <Input id="cpu_cores" size="sm" type="number" value={stage.cpu_cores} />
    <p class="text-xs text-neutral-500">cores</p>

    <div class="col-span-3 mt-2 flex items-center gap-2">
      <Checkbox id="use_gpu" checked={stage.use_gpu} />
      <label for="use_gpu">Enable GPU acceleration</label>
    </div>

    <label for="gpu_id">GPU ID:</label>
    <Input id="gpu_id" size="sm" type="number" value={stage.gpu_id} />
    <p class="text-xs text-neutral-500">device ID</p>

    <label for="num_gpus">Number of GPUs:</label>
    <Input id="num_gpus" size="sm" type="number" value={stage.num_gpus} />
    <p class="text-xs text-neutral-500">devices</p>
  </div>
</div>
