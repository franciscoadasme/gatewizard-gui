<script>
  import Button from './ui/Button.svelte'
  import ColorInput from './ui/ColorInput.svelte'
  import Input from './ui/Input.svelte'
  import RangeInput from './ui/RangeInput.svelte'
  import {
    addDirectionalLight,
    removeDirectionalLight,
    resetViewerSettings,
    viewerSettings
  } from '../lib/viewerSettings.svelte.js'

  /**
   * @type {{
   *   persistOnChange?: boolean,
   *   onPersist?: () => void,
   *   showReset?: boolean
   * }}
   */
  let {
    persistOnChange = false,
    onPersist = () => {},
    showReset = true
  } = $props()

  function maybePersist() {
    if (persistOnChange) onPersist()
  }

  /** @param {'theme' | 'custom'} mode */
  function setBackgroundMode(mode) {
    viewerSettings.backgroundMode = mode
    maybePersist()
  }
</script>

<div class="flex flex-col gap-4">
  <!-- Background -->
  <section class="space-y-2">
    <p class="font-medium text-neutral-800 dark:text-neutral-300">Background</p>
    <div class="flex flex-wrap gap-1">
      <button
        type="button"
        class="rounded px-2 py-0.5 text-[10px] transition-colors {viewerSettings.backgroundMode === 'theme'
          ? 'bg-blue-600 text-white'
          : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'}"
        onclick={() => setBackgroundMode('theme')}
      >
        Follow app theme
      </button>
      <button
        type="button"
        class="rounded px-2 py-0.5 text-[10px] transition-colors {viewerSettings.backgroundMode === 'custom'
          ? 'bg-blue-600 text-white'
          : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'}"
        onclick={() => setBackgroundMode('custom')}
      >
        Custom
      </button>
    </div>
    {#if viewerSettings.backgroundMode === 'custom'}
      <div class="flex items-center gap-1">
        <ColorInput size="sm" bind:value={viewerSettings.customBackgroundHex} oninput={maybePersist} />
        <Input
          type="text"
          size="sm"
          className="field-input flex-1"
          bind:value={viewerSettings.customBackgroundHex}
          oninput={maybePersist}
        />
      </div>
    {/if}
  </section>

  <!-- Hemisphere light -->
  <section class="space-y-2">
    <p class="font-medium text-neutral-800 dark:text-neutral-300">Hemisphere light</p>
    <div class="flex items-center gap-2">
      <span class="w-12 shrink-0 text-neutral-600 dark:text-neutral-400">Sky</span>
      <ColorInput size="sm" bind:value={viewerSettings.hemisphereSky} oninput={maybePersist} />
      <Input
        type="text"
        size="sm"
        className="field-input flex-1"
        bind:value={viewerSettings.hemisphereSky}
        oninput={maybePersist}
      />
    </div>
    <div class="flex items-center gap-2">
      <span class="w-12 shrink-0 text-neutral-600 dark:text-neutral-400">Ground</span>
      <ColorInput size="sm" bind:value={viewerSettings.hemisphereGround} oninput={maybePersist} />
      <Input
        type="text"
        size="sm"
        className="field-input flex-1"
        bind:value={viewerSettings.hemisphereGround}
        oninput={maybePersist}
      />
    </div>
    <div class="flex items-center gap-2">
      <span class="w-12 shrink-0 text-neutral-600 dark:text-neutral-400">Power</span>
      <RangeInput
        bind:value={viewerSettings.hemisphereIntensity}
        min={0}
        max={3}
        step={0.05}
        decimals={2}
        oninput={maybePersist}
      />
    </div>
  </section>

  <!-- Ambient light -->
  <section class="space-y-2">
    <p class="font-medium text-neutral-800 dark:text-neutral-300">Ambient light</p>
    <div class="flex items-center gap-2">
      <span class="w-12 shrink-0 text-neutral-600 dark:text-neutral-400">Power</span>
      <RangeInput
        bind:value={viewerSettings.ambientIntensity}
        min={0}
        max={3}
        step={0.05}
        decimals={2}
        oninput={maybePersist}
      />
    </div>
  </section>

  <!-- Depth of field -->
  <section class="space-y-2">
    <p class="font-medium text-neutral-800 dark:text-neutral-300">Depth of field</p>
    <p class="text-[10px] leading-snug text-neutral-500 dark:text-neutral-400">
      Blur distant structure like a camera. Use “Focus here” from the atom menu (or select mode) to
      lock focus on an atom. Off by default — GPU cost only when enabled.
    </p>
    <label class="flex items-center gap-2 text-neutral-700 dark:text-neutral-300">
      <input
        type="checkbox"
        checked={viewerSettings.dof.enabled}
        onchange={(e) => {
          viewerSettings.dof = { ...viewerSettings.dof, enabled: e.currentTarget.checked }
          maybePersist()
        }}
      />
      Enable depth of field
    </label>
    <div class="flex items-center gap-2">
      <span class="w-14 shrink-0 text-neutral-600 dark:text-neutral-400" title="Distance to sharp plane">Focus</span>
      <RangeInput
        value={viewerSettings.dof.focusDistance}
        min={1}
        max={400}
        step={0.5}
        decimals={1}
        oninput={(v) => {
          viewerSettings.dof = {
            ...viewerSettings.dof,
            focusDistance: v,
            focusTarget: null
          }
          maybePersist()
        }}
      />
    </div>
    <div class="flex items-center gap-2">
      <span class="w-14 shrink-0 text-neutral-600 dark:text-neutral-400" title="Thickness of the sharp band">Range</span>
      <RangeInput
        value={viewerSettings.dof.focusRange}
        min={0.5}
        max={120}
        step={0.5}
        decimals={1}
        oninput={(v) => {
          viewerSettings.dof = { ...viewerSettings.dof, focusRange: v }
          maybePersist()
        }}
      />
    </div>
    <div class="flex items-center gap-2">
      <span class="w-14 shrink-0 text-neutral-600 dark:text-neutral-400" title="Out-of-focus blur strength">Blur</span>
      <RangeInput
        value={viewerSettings.dof.bokehScale}
        min={0}
        max={10}
        step={0.1}
        decimals={1}
        oninput={(v) => {
          viewerSettings.dof = { ...viewerSettings.dof, bokehScale: v }
          maybePersist()
        }}
      />
    </div>
    {#if viewerSettings.dof.focusTarget}
      <p class="text-[10px] text-neutral-500 dark:text-neutral-400">
        Tracking focus point
        ({viewerSettings.dof.focusTarget.x.toFixed(1)},
        {viewerSettings.dof.focusTarget.y.toFixed(1)},
        {viewerSettings.dof.focusTarget.z.toFixed(1)}).
        Move Focus to unlock.
      </p>
    {/if}
  </section>

  <!-- Directional lights -->
  <section class="space-y-3">
    <div class="flex items-center justify-between">
      <p class="font-medium text-neutral-800 dark:text-neutral-300">Directional lights</p>
      <button
        type="button"
        class="rounded px-2 py-0.5 text-[10px] text-neutral-600 transition-colors hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-800"
        onclick={() => {
          addDirectionalLight()
          maybePersist()
        }}
        disabled={viewerSettings.directionalLights.length >= 8}
      >
        + Add light
      </button>
    </div>
    {#each viewerSettings.directionalLights as light, i (i)}
      <div class="space-y-2 rounded border border-neutral-200 p-2 dark:border-neutral-700">
        <div class="flex items-center justify-between">
          <label class="flex items-center gap-2 text-neutral-700 dark:text-neutral-300">
            <input
              type="checkbox"
              bind:checked={light.enabled}
              onchange={maybePersist}
            />
            Light {i + 1}
          </label>
          {#if viewerSettings.directionalLights.length > 1}
            <button
              type="button"
              class="text-[10px] text-red-500 hover:text-red-400"
              onclick={() => {
                removeDirectionalLight(i)
                maybePersist()
              }}>Remove</button
            >
          {/if}
        </div>
        <div class="flex items-center gap-2">
          <span class="w-12 shrink-0 text-neutral-600 dark:text-neutral-400">Power</span>
          <RangeInput
            bind:value={light.intensity}
            min={0}
            max={2}
            step={0.02}
            decimals={2}
            oninput={maybePersist}
          />
        </div>
        <div class="grid grid-cols-3 gap-1">
          {#each ['X', 'Y', 'Z'] as axis, j (axis)}
            <div class="flex flex-col gap-0.5">
              <span class="text-[10px] text-neutral-500">{axis}</span>
              <input
                type="number"
                class="field-input w-full rounded px-1.5 py-0.5 text-[11px]"
                step={0.5}
                bind:value={light.position[j]}
                oninput={maybePersist}
              />
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </section>

  {#if showReset}
    <Button
      variant="outline"
      size="sm"
      className="w-full"
      type="button"
      onclick={() => {
        resetViewerSettings()
        maybePersist()
      }}
    >
      Reset to defaults
    </Button>
  {/if}
</div>
