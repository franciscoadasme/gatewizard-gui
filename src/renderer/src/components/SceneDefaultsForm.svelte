<script>
  import Button from './ui/Button.svelte'
  import ColorInput from './ui/ColorInput.svelte'
  import Input from './ui/Input.svelte'
  import RangeInput from './ui/RangeInput.svelte'
  import { mainViewerControls } from './viewer/Canvas.svelte'
  import { mainViewerCamera } from './viewer/CameraRig.svelte'
  import {
    addDirectionalLight,
    DEFAULT_FOG,
    DEFAULT_SHADOWS,
    fogRangeFromCamera,
    normalizeFog,
    removeDirectionalLight,
    resetLightsAroundStructure,
    resetViewerSettings,
    SHADOW_STRENGTH_MAX,
    viewerSettings
  } from '../lib/viewerSettings.svelte.js'

  /**
   * @type {{
   *   persistOnChange?: boolean,
   *   onPersist?: () => void,
   *   showReset?: boolean,
   *   structureBBox?: { center: [number, number, number], radius: number } | null,
   *   selectedLightIndex?: number | null,
   *   onSelectLight?: (index: number) => void
   * }}
   */
  let {
    persistOnChange = false,
    onPersist = () => {},
    showReset = true,
    structureBBox = null,
    selectedLightIndex = $bindable(null),
    onSelectLight = () => {}
  } = $props()

  // Older persisted scenes may lack fog/shadows/colors — fill before the form binds.
  $effect(() => {
    if (!viewerSettings.fog || typeof viewerSettings.fog.near !== 'number') {
      viewerSettings.fog = normalizeFog(viewerSettings.fog)
    }
    if (!viewerSettings.shadows) viewerSettings.shadows = { ...DEFAULT_SHADOWS }
    if (typeof viewerSettings.shadows.softness !== 'number') {
      viewerSettings.shadows = { ...viewerSettings.shadows, softness: DEFAULT_SHADOWS.softness }
    }
    if (!viewerSettings.ambientColor) viewerSettings.ambientColor = '#ffffff'
    if (!viewerSettings.lightMode) viewerSettings.lightMode = 'camera'
    for (const l of viewerSettings.directionalLights) {
      if (!l.color) l.color = '#ffffff'
    }
  })

  function maybePersist() {
    if (persistOnChange) onPersist()
  }

  function fitDepthCueToView() {
    const cam = mainViewerCamera.current
    if (!cam) return
    const { near, far } = fogRangeFromCamera(cam, mainViewerControls.current?.target)
    viewerSettings.fog = { ...viewerSettings.fog, near, far, enabled: true }
    maybePersist()
  }

  /** @param {'theme' | 'custom'} mode */
  function setBackgroundMode(mode) {
    viewerSettings.backgroundMode = mode
    maybePersist()
  }

  /** @param {'camera' | 'world'} mode */
  function setLightMode(mode) {
    viewerSettings.lightMode = mode
    maybePersist()
  }

  function onResetLightsAround() {
    if (!structureBBox) return
    resetLightsAroundStructure(structureBBox)
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

  <!-- Light attachment -->
  <section class="space-y-2">
    <p
      class="font-medium text-neutral-800 dark:text-neutral-300"
      title="How directional lights move relative to the camera"
    >
      Light attachment
    </p>
    <div class="flex flex-wrap gap-1">
      <button
        type="button"
        title="Shading stays stable while you orbit"
        class="rounded px-2 py-0.5 text-[10px] transition-colors {viewerSettings.lightMode !== 'world'
          ? 'bg-blue-600 text-white'
          : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'}"
        onclick={() => setLightMode('camera')}
      >
        Follow camera
      </button>
      <button
        type="button"
        title="Lights stay in the scene — drag L1/L2 markers in the viewport"
        class="rounded px-2 py-0.5 text-[10px] transition-colors {viewerSettings.lightMode === 'world'
          ? 'bg-blue-600 text-white'
          : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'}"
        onclick={() => setLightMode('world')}
      >
        Fixed in world
      </button>
    </div>
    {#if structureBBox}
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        type="button"
        title="Place key and fill lights around the current framing"
        onclick={onResetLightsAround}
      >
        Reset lights around structure
      </Button>
    {/if}
  </section>

  <!-- Hemisphere light -->
  <section class="space-y-2">
    <p
      class="font-medium text-neutral-800 dark:text-neutral-300"
      title="Soft fill from above (sky) and below (ground)"
    >
      Hemisphere light
    </p>
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
      <span class="w-12 shrink-0 text-neutral-600 dark:text-neutral-400">Color</span>
      <ColorInput size="sm" bind:value={viewerSettings.ambientColor} oninput={maybePersist} />
      <Input
        type="text"
        size="sm"
        className="field-input flex-1"
        bind:value={viewerSettings.ambientColor}
        oninput={maybePersist}
      />
    </div>
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

  <!-- Depth cueing -->
  <section class="space-y-2">
    <p
      class="font-medium text-neutral-800 dark:text-neutral-300"
      title="Fade the back of the structure along the view. Separate from depth of field."
    >
      Depth cueing
    </p>
    <label
      class="flex items-center gap-2 text-neutral-700 dark:text-neutral-300"
      title="Atoms closer than Near stay lit; past Far they fade into the fog color"
    >
      <input
        type="checkbox"
        checked={viewerSettings.fog.enabled}
        onchange={(e) => {
          const enabled = e.currentTarget.checked
          if (enabled) {
            const cam = mainViewerCamera.current
            if (cam) {
              const { near, far } = fogRangeFromCamera(cam, mainViewerControls.current?.target)
              viewerSettings.fog = { ...viewerSettings.fog, enabled: true, near, far }
            } else {
              viewerSettings.fog = { ...viewerSettings.fog, enabled: true }
            }
          } else {
            viewerSettings.fog = { ...viewerSettings.fog, enabled: false }
          }
          maybePersist()
        }}
      />
      Enable depth cueing
    </label>
    <div class="flex items-center gap-2">
      <span
        class="w-14 shrink-0 text-neutral-600 dark:text-neutral-400"
        title="Distance where fog starts (front stays clear)"
      >Near</span
      >
      <RangeInput
        value={viewerSettings.fog.near ?? DEFAULT_FOG.near}
        min={1}
        max={500}
        step={0.5}
        decimals={1}
        oninput={(v) => {
          const far = Math.max(v + 2, viewerSettings.fog.far ?? DEFAULT_FOG.far)
          viewerSettings.fog = { ...viewerSettings.fog, near: v, far }
          maybePersist()
        }}
      />
    </div>
    <div class="flex items-center gap-2">
      <span
        class="w-14 shrink-0 text-neutral-600 dark:text-neutral-400"
        title="Distance where fog is fully opaque"
      >Far</span
      >
      <RangeInput
        value={viewerSettings.fog.far ?? DEFAULT_FOG.far}
        min={2}
        max={600}
        step={0.5}
        decimals={1}
        oninput={(v) => {
          const near = Math.min(v - 2, viewerSettings.fog.near ?? DEFAULT_FOG.near)
          viewerSettings.fog = {
            ...viewerSettings.fog,
            far: v,
            near: Math.max(0.1, near)
          }
          maybePersist()
        }}
      />
    </div>
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-xs"
      title="Set Near/Far from the current camera framing"
      onclick={fitDepthCueToView}
    >
      Fit to view
    </Button>
    <label
      class="flex items-center gap-2 text-neutral-700 dark:text-neutral-300"
      title="When off, pick a custom fog color below"
    >
      <input
        type="checkbox"
        checked={viewerSettings.fog.matchBackground !== false}
        onchange={(e) => {
          viewerSettings.fog = {
            ...viewerSettings.fog,
            matchBackground: e.currentTarget.checked
          }
          maybePersist()
        }}
      />
      Fog color matches background
    </label>
    {#if viewerSettings.fog.matchBackground === false}
      <div class="flex items-center gap-2">
        <span class="w-14 shrink-0 text-neutral-600 dark:text-neutral-400">Color</span>
        <ColorInput
          size="sm"
          bind:value={viewerSettings.fog.color}
          oninput={maybePersist}
        />
      </div>
    {/if}
  </section>

  <!-- Shadows -->
  <section class="space-y-2">
    <p
      class="font-medium text-neutral-800 dark:text-neutral-300"
      title="From directional lights. Off by default — costs GPU on large scenes."
    >
      Shadows
    </p>
    <label class="flex items-center gap-2 text-neutral-700 dark:text-neutral-300">
      <input
        type="checkbox"
        checked={viewerSettings.shadows.enabled}
        onchange={(e) => {
          viewerSettings.shadows = {
            ...viewerSettings.shadows,
            enabled: e.currentTarget.checked
          }
          maybePersist()
        }}
      />
      Enable shadows
    </label>
    <div class="flex items-center gap-2">
      <span
        class="w-14 shrink-0 text-neutral-600 dark:text-neutral-400"
        title="How strongly shadows apply (0–1). Lower ambient if they look washed out."
      >Strength</span
      >
      <RangeInput
        value={viewerSettings.shadows.strength}
        min={0}
        max={SHADOW_STRENGTH_MAX}
        step={0.02}
        decimals={2}
        oninput={(v) => {
          viewerSettings.shadows = { ...viewerSettings.shadows, strength: v }
          maybePersist()
        }}
      />
    </div>
    <div class="flex items-center gap-2">
      <span
        class="w-14 shrink-0 text-neutral-600 dark:text-neutral-400"
        title="Edge blur — keep mid-range to avoid grainy shadows"
      >Softness</span
      >
      <RangeInput
        value={viewerSettings.shadows.softness ?? 0.55}
        min={0}
        max={1}
        step={0.02}
        decimals={2}
        oninput={(v) => {
          viewerSettings.shadows = { ...viewerSettings.shadows, softness: v }
          maybePersist()
        }}
      />
    </div>
  </section>

  <!-- Depth of field -->
  <section class="space-y-2">
    <p
      class="font-medium text-neutral-800 dark:text-neutral-300"
      title="Camera-style blur. Use Focus here from the atom menu to lock on an atom."
    >
      Depth of field
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
      <span class="w-14 shrink-0 text-neutral-600 dark:text-neutral-400" title="Distance to the sharp plane"
        >Focus</span
      >
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
      <span
        class="w-14 shrink-0 text-neutral-600 dark:text-neutral-400"
        title="Thickness of the sharp band"
      >Range</span
      >
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
      <span
        class="w-14 shrink-0 text-neutral-600 dark:text-neutral-400"
        title="Out-of-focus blur amount"
      >Blur</span
      >
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
      <p
        class="text-[10px] text-neutral-500 dark:text-neutral-400"
        title="Move Focus to unlock"
      >
        Tracking atom
        ({viewerSettings.dof.focusTarget.x.toFixed(1)},
        {viewerSettings.dof.focusTarget.y.toFixed(1)},
        {viewerSettings.dof.focusTarget.z.toFixed(1)})
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
      <div
        class="space-y-2 rounded border p-2 {selectedLightIndex === i
          ? 'border-yellow-500/70 dark:border-yellow-500/50'
          : 'border-neutral-200 dark:border-neutral-700'}"
        role="presentation"
        onclick={() => {
          selectedLightIndex = i
          onSelectLight(i)
        }}
      >
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
          <span class="w-12 shrink-0 text-neutral-600 dark:text-neutral-400">Color</span>
          <ColorInput
            size="sm"
            value={light.color || '#ffffff'}
            oninput={(e) => {
              light.color = /** @type {HTMLInputElement} */ (e.currentTarget).value
              maybePersist()
            }}
          />
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
        {#if viewerSettings.lightMode === 'world'}
          <p
            class="text-[10px] text-neutral-500 dark:text-neutral-400"
            title="Or edit XYZ above"
          >
            Drag L{i + 1} in the viewport
          </p>
        {/if}
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
