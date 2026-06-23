<script>
  import Button from './ui/Button.svelte'
  import ColorInput from './ui/ColorInput.svelte'
  import Input from './ui/Input.svelte'
  import {
    addDirectionalLight,
    persistViewerSettings,
    removeDirectionalLight,
    resetViewerSettings,
    viewerSettings
  } from '../lib/viewerSettings.svelte.js'

  /** @type {{ open?: boolean }} */
  let { open = $bindable(false) } = $props()

  /** @type {HTMLDialogElement | null} */
  let dialogEl = $state(null)
  let backdropPointerDown = $state(false)

  /** @param {HTMLDialogElement | null} dialog */
  function mountDialogToBody(dialog) {
    if (dialog && dialog.parentElement !== document.body) {
      document.body.appendChild(dialog)
    }
  }

  function closeDialog() {
    open = false
    dialogEl?.close()
  }

  $effect(() => {
    if (!dialogEl) return
    if (open) {
      mountDialogToBody(dialogEl)
      if (!dialogEl.open) dialogEl.showModal()
    } else if (dialogEl.open) {
      dialogEl.close()
    }
  })

  function persist() {
    persistViewerSettings()
  }

  /** @param {'theme' | 'custom'} mode */
  function setBackgroundMode(mode) {
    viewerSettings.backgroundMode = mode
    persist()
  }

  /** @param {MouseEvent} event */
  function onDialogClick(event) {
    if (event.target === dialogEl && backdropPointerDown) closeDialog()
    backdropPointerDown = false
  }

  /** @param {PointerEvent} event */
  function onDialogPointerDown(event) {
    backdropPointerDown = event.target === dialogEl
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialogEl}
  class="fixed top-10 bottom-10 left-16 z-50 m-0 w-80 max-w-[calc(100vw-5rem)] overflow-y-auto rounded-lg border border-neutral-300 bg-white p-0 text-xs text-neutral-900 shadow-2xl backdrop:bg-black/20 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
  onpointerdown={onDialogPointerDown}
  onclick={onDialogClick}
  oncancel={(e) => {
    e.preventDefault()
    closeDialog()
  }}
>
  <div class="flex flex-col gap-0">
    <div
      class="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-200 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
    >
      <span class="text-sm font-medium">Scene rendering</span>
      <button
        type="button"
        class="relative z-20 -mr-1 min-h-8 min-w-8 rounded px-2 text-lg leading-none text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-white"
        aria-label="Close"
        onclick={(e) => {
          e.stopPropagation()
          closeDialog()
        }}>&times;</button
      >
    </div>

    <div class="flex flex-col gap-4 p-3">
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
            <ColorInput
              size="sm"
              bind:value={viewerSettings.customBackgroundHex}
              oninput={persist}
            />
            <Input
              type="text"
              size="sm"
              className="field-input flex-1"
              bind:value={viewerSettings.customBackgroundHex}
              oninput={persist}
            />
          </div>
        {/if}
      </section>

      <!-- Hemisphere light -->
      <section class="space-y-2">
        <p class="font-medium text-neutral-800 dark:text-neutral-300">Hemisphere light</p>
        <div class="flex items-center gap-2">
          <span class="w-12 shrink-0 text-neutral-600 dark:text-neutral-400">Sky</span>
          <ColorInput size="sm" bind:value={viewerSettings.hemisphereSky} oninput={persist} />
          <Input
            type="text"
            size="sm"
            className="field-input flex-1"
            bind:value={viewerSettings.hemisphereSky}
            oninput={persist}
          />
        </div>
        <div class="flex items-center gap-2">
          <span class="w-12 shrink-0 text-neutral-600 dark:text-neutral-400">Ground</span>
          <ColorInput size="sm" bind:value={viewerSettings.hemisphereGround} oninput={persist} />
          <Input
            type="text"
            size="sm"
            className="field-input flex-1"
            bind:value={viewerSettings.hemisphereGround}
            oninput={persist}
          />
        </div>
        <div class="flex items-center gap-2">
          <span class="w-12 shrink-0 text-neutral-600 dark:text-neutral-400">Power</span>
          <input
            type="range"
            class="flex-1 accent-blue-500"
            min={0}
            max={3}
            step={0.05}
            bind:value={viewerSettings.hemisphereIntensity}
            oninput={persist}
          />
          <span class="w-10 text-right tabular-nums">{viewerSettings.hemisphereIntensity.toFixed(2)}</span>
        </div>
      </section>

      <!-- Ambient light -->
      <section class="space-y-2">
        <p class="font-medium text-neutral-800 dark:text-neutral-300">Ambient light</p>
        <div class="flex items-center gap-2">
          <span class="w-12 shrink-0 text-neutral-600 dark:text-neutral-400">Power</span>
          <input
            type="range"
            class="flex-1 accent-blue-500"
            min={0}
            max={3}
            step={0.05}
            bind:value={viewerSettings.ambientIntensity}
            oninput={persist}
          />
          <span class="w-10 text-right tabular-nums">{viewerSettings.ambientIntensity.toFixed(2)}</span>
        </div>
      </section>

      <!-- Directional lights -->
      <section class="space-y-3">
        <div class="flex items-center justify-between">
          <p class="font-medium text-neutral-800 dark:text-neutral-300">Directional lights</p>
          <button
            type="button"
            class="rounded px-2 py-0.5 text-[10px] text-neutral-600 transition-colors hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-800"
            onclick={() => addDirectionalLight()}
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
                  onchange={persist}
                />
                Light {i + 1}
              </label>
              {#if viewerSettings.directionalLights.length > 1}
                <button
                  type="button"
                  class="text-[10px] text-red-500 hover:text-red-400"
                  onclick={() => removeDirectionalLight(i)}>Remove</button
                >
              {/if}
            </div>
            <div class="flex items-center gap-2">
              <span class="w-12 shrink-0 text-neutral-600 dark:text-neutral-400">Power</span>
              <input
                type="range"
                class="flex-1 accent-blue-500"
                min={0}
                max={2}
                step={0.02}
                bind:value={light.intensity}
                oninput={persist}
              />
              <span class="w-8 text-right tabular-nums">{light.intensity.toFixed(2)}</span>
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
                    oninput={persist}
                  />
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </section>

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        type="button"
        onclick={() => {
          resetViewerSettings()
        }}
      >
        Reset to defaults
      </Button>
    </div>
  </div>
</dialog>
