<script>
  import Button from './ui/Button.svelte'
  import Checkbox from './ui/Checkbox.svelte'
  import Divider from './ui/Divider.svelte'
  import Gear from './icons/Gear.svelte'
  import Input from './ui/Input.svelte'
  import { canonicalEnsemble, formEnsembleValue } from '../lib/ensemble.js'

  /** @typedef {{ id: string, name: string, force_constant: number, selection: string }} Constraint */

  /**
   * @type {{
   *   stage: {
   *     name: string,
   *     description: string,
   *     time_ns: number,
   *     steps: number,
   *     ensemble: string,
   *     temperature: number,
   *     pressure: number,
   *     constraints: Array<Constraint>,
   *     timestep: number,
   *     dcd_freq: number,
   *     minimize_steps?: number,
   *     margin?: number,
   *     surface_tension?: number,
   *     stage_kind?: string,
   *     cpu_cores?: number,
   *     gpu_id?: number,
   *     num_gpus?: number,
   *     use_gpu?: boolean,
   *     resources_inherit?: boolean
   *   },
   *   ensemble: string,
   *   onAddConstraint: () => void,
   *   onEditConstraint: (constraintIndex: number) => void
   * }}
   */
  let { stage = $bindable(), ensemble, onAddConstraint, onEditConstraint } = $props()

  const uid = $props.id()

  const stageKind = $derived.by(() => {
    const explicit = String(stage.stage_kind || '').toLowerCase()
    if (explicit) return explicit
    const name = String(stage.name || '').toLowerCase()
    if (name === 'minimization') return 'minimization'
    if (name === 'production') return 'production'
    return 'equilibration'
  })

  const isMinimization = $derived(stageKind === 'minimization')
  const useGpu = $derived(isMinimization ? false : stage.use_gpu !== false)

  const resourceChip = $derived.by(() => {
    const cpu = stage.cpu_cores ?? (isMinimization ? 4 : 1)
    if (isMinimization) return `CPU×${cpu}`
    if (useGpu) return `CPU×${cpu} · GPU×${stage.num_gpus ?? 1}`
    return `CPU×${cpu}`
  })

  /** steps = time_ns (ns) × 1 000 000 / timestep (fs) */
  function stepsFromTime(time_ns, timestep) {
    return Math.round((time_ns * 1_000_000) / timestep)
  }

  /** time_ns = steps × timestep (fs) / 1 000 000; rounded to 9 sig. fig. to avoid float noise */
  function timeFromSteps(steps, timestep) {
    return parseFloat(((steps * timestep) / 1_000_000).toPrecision(9))
  }

  function markExplicitResources() {
    stage.resources_inherit = false
  }

  function onCpuChange(value) {
    stage.cpu_cores = value
    markExplicitResources()
  }

  function onGpuFieldChange() {
    markExplicitResources()
  }

  $effect(() => {
    if (!stage.stage_kind) {
      stage.stage_kind = stageKind
    }
    if (isMinimization) {
      stage.use_gpu = false
      stage.num_gpus = 0
      if (stage.cpu_cores == null) stage.cpu_cores = 4
    } else {
      if (stage.cpu_cores == null) stage.cpu_cores = 1
      if (stage.gpu_id == null) stage.gpu_id = 0
      if (stage.use_gpu == null) stage.use_gpu = true
      if (stage.use_gpu !== false && (stage.num_gpus == null || stage.num_gpus < 1)) {
        stage.num_gpus = 1
      }
    }
  })
</script>

<div class="rounded-md border border-neutral-200 bg-neutral-50 p-4 text-neutral-900 dark:border-transparent dark:bg-neutral-900 dark:text-inherit">
  <div class="mb-2 flex items-start justify-between gap-2">
    <div>
      <h3>{stage.name}</h3>
      <p class="text-xs text-neutral-500">{stage.description}</p>
    </div>
    <span
      class="shrink-0 rounded bg-neutral-200 px-2 py-0.5 font-mono text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
      title="Compute for this stage"
    >
      {resourceChip}
    </span>
  </div>
  <form
    class="grid grid-cols-[1fr_--spacing(20)_auto] items-center gap-x-2 gap-y-1 text-sm text-nowrap"
  >
    <div class="col-span-3 my-2">
      <Divider />
    </div>
    <h4 class="col-span-3 mb-1 font-semibold">Compute</h4>

    <label for="{uid}-cpu">CPU cores:</label>
    <Input
      id="{uid}-cpu"
      size="sm"
      type="number"
      min="1"
      step="1"
      value={stage.cpu_cores ?? (isMinimization ? 4 : 1)}
      oninput={(e) => onCpuChange(Math.max(1, e.currentTarget.valueAsNumber || 1))}
    />
    <p class="text-xs text-neutral-500">threads</p>

    {#if isMinimization}
      <p class="col-span-3 text-xs text-neutral-500">Minimization always runs on CPU.</p>
    {:else}
      <div class="col-span-3 flex items-center gap-2 py-0.5">
        <Checkbox id="{uid}-use-gpu" size="sm" bind:checked={stage.use_gpu} onchange={() => {
          if (!stage.use_gpu) stage.num_gpus = 0
          else if (!stage.num_gpus || stage.num_gpus < 1) stage.num_gpus = 1
          if (stage.gpu_id == null) stage.gpu_id = 0
          markExplicitResources()
        }} />
        <label for="{uid}-use-gpu" class="text-sm">Use GPU</label>
      </div>
      {#if useGpu}
        <label for="{uid}-gpu-id">GPU ID:</label>
        <Input
          id="{uid}-gpu-id"
          size="sm"
          type="number"
          min="0"
          step="1"
          bind:value={stage.gpu_id}
          oninput={onGpuFieldChange}
        />
        <p class="text-xs text-neutral-500">device</p>

        <label for="{uid}-num-gpus">GPUs:</label>
        <Input
          id="{uid}-num-gpus"
          size="sm"
          type="number"
          min="1"
          step="1"
          bind:value={stage.num_gpus}
          oninput={onGpuFieldChange}
        />
        <p class="text-xs text-neutral-500">count</p>
      {/if}
    {/if}

    {#if !isMinimization}
      <label for="{uid}-time_ns">Time:</label>
      <Input
        id="{uid}-time_ns"
        size="sm"
        type="number"
        min="0"
        step="0.001"
        bind:value={stage.time_ns}
        oninput={(e) => {
          const v = e.target.valueAsNumber
          if (isFinite(v) && v > 0) stage.steps = stepsFromTime(v, stage.timestep)
        }}
      />
      <p class="text-xs text-neutral-500">ns</p>

      <label for="{uid}-steps">Steps:</label>
      <Input
        id="{uid}-steps"
        size="sm"
        type="number"
        min="1"
        step="1"
        bind:value={stage.steps}
        oninput={(e) => {
          const v = e.target.valueAsNumber
          if (isFinite(v) && v > 0) stage.time_ns = timeFromSteps(v, stage.timestep)
        }}
      />
      <p class="text-xs text-neutral-500">steps</p>
    {/if}

    {#if isMinimization && stage.minimize_steps != null}
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
      value={stage.ensemble ?? canonicalEnsemble(ensemble)}
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

    {#if ['npat', 'npgt'].includes(formEnsembleValue(stage.ensemble || ensemble))}
      <label for="{uid}-surface-tension">Surface Tension:</label>
      <Input
        id="{uid}-surface-tension"
        size="sm"
        type="number"
        min="0"
        max="100"
        step="1"
        bind:value={stage.surface_tension}
      />
      <p class="text-xs text-neutral-500">dyn/cm</p>
    {/if}

    {#if !isMinimization}
      <label for="{uid}-timestep">Timestep:</label>
      <Input
        id="{uid}-timestep"
        size="sm"
        type="number"
        min="0.5"
        max="4"
        step="0.5"
        bind:value={stage.timestep}
        oninput={(e) => {
          const v = e.target.valueAsNumber
          if (isFinite(v) && v > 0) stage.steps = stepsFromTime(stage.time_ns, v)
        }}
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
    {/if}

    {#if stage.margin != null && !isMinimization}
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

    {#each stage.constraints as constraint, i (constraint.id)}
      <label for="{uid}-restraint_{constraint.id}">{constraint.name}:</label>
      <Input
        id="{uid}-restraint_{constraint.id}"
        size="sm"
        type="number"
        min="0.0"
        max="20.0"
        step="0.1"
        bind:value={stage.constraints[i].force_constant}
      />
      <div>
        <button
          type="button"
          class="rounded p-1 text-neutral-500 transition-colors hover:bg-neutral-200 hover:text-neutral-900 active:translate-y-0.5 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          onclick={() => onEditConstraint(i)}
          aria-label="Edit {constraint.name}"
        >
          <Gear className="h-4 w-4" />
        </button>
      </div>
    {/each}
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="col-span-3 mt-2"
      onclick={onAddConstraint}
    >
      Add constraint
    </Button>
  </form>
</div>
