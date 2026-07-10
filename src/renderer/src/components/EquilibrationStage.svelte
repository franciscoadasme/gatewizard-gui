<script>
  import Button from './ui/Button.svelte'
  import Divider from './ui/Divider.svelte'
  import Gear from './icons/Gear.svelte'
  import Input from './ui/Input.svelte'
  import { canonicalEnsemble } from '../lib/ensemble.js'

  /** @typedef {{ id: string, name: string, force_constant: number, selection: string }} Constraint */

  /** @type {{ stage: { name: string, description: string, time_ns: number, steps: number, ensemble: string, temperature: number, pressure: number, constraints: Array<Constraint>, timestep: number, dcd_freq: number, minimize_steps?: number, margin?: number, surface_tension?: number }, ensemble: string, onOpenAddConstraint: () => void, onOpenEditConstraint: (constraintIndex: number) => void }} */
  let { stage = $bindable(), ensemble, onAddConstraint, onEditConstraint } = $props()

  const uid = $props.id()

  /** steps = time_ns (ns) × 1 000 000 / timestep (fs) */
  function stepsFromTime(time_ns, timestep) {
    return Math.round((time_ns * 1_000_000) / timestep)
  }

  /** time_ns = steps × timestep (fs) / 1 000 000; rounded to 9 sig. fig. to avoid float noise */
  function timeFromSteps(steps, timestep) {
    return parseFloat(((steps * timestep) / 1_000_000).toPrecision(9))
  }
</script>

<div class="rounded-md border border-neutral-200 bg-neutral-50 p-4 text-neutral-900 dark:border-transparent dark:bg-neutral-900 dark:text-inherit">
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

    {#if ['npat', 'npgt'].includes(stage.ensemble || ensemble)}
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
