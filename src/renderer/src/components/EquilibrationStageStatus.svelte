<script>
  import Check from './icons/Check.svelte'
  import Danger from './icons/Danger.svelte'
  import Duration from './icons/Duration.svelte'
  import Spinner from './ui/Spinner.svelte'

  const MINIMIZATION_CONVERGED_TOOLTIP =
    'Minimization converged before completing all requested steps and finished successfully.'

  /** @type {{ stage_info: { name: string, status: 'running' | 'completed' | 'error' | 'not_started', simulated_time: number|null, total_simulation_time: number|null, performance: number|null, elapsed_time_seconds: number|null, is_minimization?: boolean, steps_completed?: number|null, total_steps?: number|null, minimization_converged_early?: boolean, output: string }, tracking?: boolean, compact?: boolean }} */
  let { stage_info, tracking = true, compact = false } = $props()

  function formatElapsed(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '0s'
    const s = Math.round(seconds)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    if (h > 0) return `${h}h ${m}m ${sec}s`
    if (m > 0) return `${m}m ${sec}s`
    return `${sec}s`
  }

  let progress = $derived(
    stage_info.is_minimization
      ? stage_info.status === 'completed'
        ? 100
        : Math.round(
            ((stage_info.steps_completed ?? 0) / (stage_info.total_steps ?? 1)) * 100
          )
      : Math.round(
          ((stage_info.simulated_time ?? 0) / (stage_info.total_simulation_time ?? 1)) *
            100
        )
  )
  let color = $derived(
    stage_info.status === 'completed'
      ? 'bg-green-600'
      : stage_info.status === 'error'
        ? 'bg-red-600'
        : stage_info.status === 'running'
          ? 'bg-blue-500'
          : 'bg-transparent'
  )

  let hasMinimizationMetrics = $derived(
    stage_info.is_minimization &&
      (stage_info.steps_completed != null || stage_info.total_steps != null)
  )

  let hasMdMetrics = $derived(stage_info.simulated_time !== null)

  let rowTitle = $derived(
    stage_info.minimization_converged_early ? MINIMIZATION_CONVERGED_TOOLTIP : undefined
  )
</script>

{#if compact}
  <div class="flex items-center gap-2 text-xs" title={rowTitle}>
    <div class="flex min-w-0 flex-1 items-center gap-1">
      {#if stage_info.status === 'completed'}
        <Check className="size-4 shrink-0 fill-green-600" title="Completed" />
      {:else if stage_info.status === 'error'}
        <Danger className="size-4 shrink-0 fill-red-600" />
      {:else if stage_info.status === 'running'}
        {#if tracking}
          <Spinner className="size-4 shrink-0" />
        {:else}
          <Duration className="size-4 shrink-0 fill-neutral-500" />
        {/if}
      {:else if stage_info.status === 'not_started'}
        <Duration className="size-4 shrink-0 fill-white" />
      {/if}
      <span class="truncate text-nowrap">{stage_info.name}</span>
      {#if hasMinimizationMetrics}
        <span class="truncate text-nowrap text-neutral-500">
          ({stage_info.steps_completed ?? 0}{#if stage_info.total_steps}
            / {stage_info.total_steps}{/if} steps
          {#if stage_info.elapsed_time_seconds !== null}
            &middot; {formatElapsed(stage_info.elapsed_time_seconds)}
          {/if})
        </span>
      {:else if hasMdMetrics}
        <span class="truncate text-nowrap text-neutral-500">
          ({stage_info.simulated_time.toFixed(stage_info.simulated_time > 1 ? 0 : 3)} ns &middot;
          {(stage_info.performance ?? 0).toFixed(1)} ns/day
          {#if stage_info.elapsed_time_seconds !== null}
            &middot; {formatElapsed(stage_info.elapsed_time_seconds)}
          {/if})
        </span>
      {/if}
    </div>
    <div class="h-1 w-28 shrink-0 overflow-hidden rounded-full bg-neutral-800">
      <div class="h-full transition-all duration-300 {color}" style="width: {progress}%"></div>
    </div>
  </div>
{:else}
  <div class="col-span-2 grid grid-cols-subgrid items-center text-xs" title={rowTitle}>
    <div class="flex items-center gap-1">
      {#if stage_info.status === 'completed'}
        <Check className="size-4 fill-green-600" title="Completed" />
      {:else if stage_info.status === 'error'}
        <Danger className="size-4 fill-red-600" />
      {:else if stage_info.status === 'running'}
        {#if tracking}
          <Spinner className="size-4" />
        {:else}
          <Duration className="size-4 fill-neutral-500" />
        {/if}
      {:else if stage_info.status === 'not_started'}
        <Duration className="size-4 fill-white" />
      {/if}
      <span class="text-nowrap">{stage_info.name}</span>
      {#if hasMinimizationMetrics}
        <span class="text-nowrap text-neutral-500">
          ({stage_info.steps_completed ?? 0}{#if stage_info.total_steps}
            / {stage_info.total_steps}{/if} steps
          {#if stage_info.elapsed_time_seconds !== null}
            &middot; {formatElapsed(stage_info.elapsed_time_seconds)}
          {/if})
        </span>
      {:else if hasMdMetrics}
        <span class="text-nowrap text-neutral-500">
          ({stage_info.simulated_time.toFixed(stage_info.simulated_time > 1 ? 0 : 3)} ns &middot;
          {(stage_info.performance ?? 0).toFixed(1)} ns/day
          {#if stage_info.elapsed_time_seconds !== null}
            &middot; {formatElapsed(stage_info.elapsed_time_seconds)}
          {/if})
        </span>
      {/if}
    </div>
    <div class="ml-1 h-1 w-full overflow-hidden rounded-full bg-neutral-800">
      <div class="h-full w-full transition-all duration-300 {color}" style="width: {progress}%"></div>
    </div>
  </div>
{/if}
