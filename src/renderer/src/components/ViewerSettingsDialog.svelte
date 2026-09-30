<script>
  import SceneDefaultsForm from './SceneDefaultsForm.svelte'
  import { themeState } from '../lib/theme.svelte.js'

  /**
   * Non-modal Scene rendering panel — keeps the 3D view rotatable and light
   * gizmos interactive while settings stay open.
   * @type {{
   *   open?: boolean
   *   structureBBox?: { center: [number, number, number], radius: number } | null
   *   selectedLightIndex?: number | null
   * }}
   */
  let {
    open = $bindable(false),
    structureBBox = null,
    selectedLightIndex = $bindable(null)
  } = $props()

  const isDark = $derived(themeState.current === 'dark')

  function closePanel() {
    open = false
  }
</script>

{#if open}
  <div
    class="viewer-side-panel--nonmodal fixed top-10 bottom-10 left-16 z-50 flex w-80 max-w-[calc(100vw-5rem)] flex-col overflow-hidden rounded-lg border border-neutral-300 bg-white p-0 text-xs text-neutral-900 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 {isDark
      ? 'dark'
      : ''}"
    role="dialog"
    aria-labelledby="scene-rendering-title"
  >
    <div
      class="flex shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
    >
      <span
        id="scene-rendering-title"
        class="text-sm font-medium"
        title="Orbit the view while this panel is open. World-fixed lights show draggable L1/L2 markers."
      >Scene rendering</span
      >
      <button
        type="button"
        class="dialog-btn-outline px-2 py-0.5 text-xs"
        aria-label="Close"
        onclick={closePanel}
      >✕</button
      >
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <SceneDefaultsForm
        persistOnChange={false}
        {structureBBox}
        bind:selectedLightIndex
      />
    </div>
  </div>
{/if}
