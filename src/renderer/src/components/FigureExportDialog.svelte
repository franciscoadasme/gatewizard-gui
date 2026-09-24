<script>
  /**
   * Save Image options: pixel size, scale, and optional transparent background.
   * Stays off the viewport so the export crop guide stays visible.
   */
  import { themeState } from '../lib/theme.svelte.js'

  /** @type {{
   *   open: boolean,
   *   defaultWidth?: number,
   *   defaultHeight?: number,
   *   defaultScale?: number,
   *   defaultTransparent?: boolean,
   *   onPreviewChange?: (opts: { width: number, height: number, scale: number }) => void,
   *   onCancel?: () => void,
   *   onSave?: (opts: { width: number, height: number, scale: number, transparentBg: boolean }) => void
   * }} */
  let {
    open = false,
    defaultWidth = 1280,
    defaultHeight = 720,
    defaultScale = 1,
    defaultTransparent = false,
    onPreviewChange,
    onCancel,
    onSave
  } = $props()

  const SCALE_OPTIONS = [1, 2, 3, 4]

  let width = $state(1280)
  let height = $state(720)
  let scale = $state(1)
  let transparentBg = $state(false)
  const isDark = $derived(themeState.current === 'dark')
  const frameW = $derived(Math.max(1, Math.round(Number(width) || 1)))
  const frameH = $derived(Math.max(1, Math.round(Number(height) || 1)))
  const scaleN = $derived(SCALE_OPTIONS.includes(Number(scale)) ? Number(scale) : 1)
  const outW = $derived(Math.max(1, Math.round(frameW * scaleN)))
  const outH = $derived(Math.max(1, Math.round(frameH * scaleN)))

  $effect(() => {
    if (!open) return
    width = Math.max(1, Math.round(defaultWidth) || 1280)
    height = Math.max(1, Math.round(defaultHeight) || 720)
    scale = SCALE_OPTIONS.includes(defaultScale) ? defaultScale : 1
    transparentBg = Boolean(defaultTransparent)
  })

  $effect(() => {
    if (!open) return
    onPreviewChange?.({ width: frameW, height: frameH, scale: scaleN })
  })

  function cancel() {
    onCancel?.()
  }

  function confirm() {
    onSave?.({
      width: frameW,
      height: frameH,
      scale: scaleN,
      transparentBg
    })
  }

  /** @param {KeyboardEvent} e */
  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      confirm()
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="pointer-events-none fixed inset-x-0 bottom-16 z-[80] flex justify-center px-4 {isDark
      ? 'dark'
      : ''}"
    role="presentation"
    onkeydown={onKeydown}
  >
    <div
      class="pointer-events-auto flex w-full max-w-sm flex-col overflow-hidden rounded-lg border border-neutral-300 bg-white text-neutral-900 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
      role="dialog"
      aria-modal="false"
      aria-label="Save figure"
      tabindex="-1"
    >
      <div
        class="flex shrink-0 items-start justify-between gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-700"
      >
        <div class="min-w-0">
          <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Save figure</h2>
          <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            Yellow frame is the exported crop. Transparent keeps only the structure.
          </p>
        </div>
        <button
          type="button"
          class="relative -mr-1 -mt-0.5 min-h-8 min-w-8 rounded px-2 text-lg leading-none text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-white"
          aria-label="Close"
          onclick={cancel}
        >&times;</button>
      </div>

      <div class="space-y-3 px-4 py-3">
        <div class="flex flex-wrap items-center gap-2">
          <label class="flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-400">
            Width
            <input
              class="w-20 rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-right font-mono text-xs tabular-nums dark:border-neutral-600 dark:bg-neutral-800"
              type="number"
              min="1"
              step="1"
              bind:value={width}
            />
          </label>
          <span class="text-xs text-neutral-500">×</span>
          <label class="flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-400">
            Height
            <input
              class="w-20 rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-right font-mono text-xs tabular-nums dark:border-neutral-600 dark:bg-neutral-800"
              type="number"
              min="1"
              step="1"
              bind:value={height}
            />
          </label>
          <span class="text-[10px] text-neutral-500">px</span>
        </div>
        <label class="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
          Scale
          <select
            class="rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-xs dark:border-neutral-600 dark:bg-neutral-800"
            bind:value={scale}
          >
            {#each SCALE_OPTIONS as n}
              <option value={n}>{n}×</option>
            {/each}
          </select>
          <span class="font-mono text-[10px] text-neutral-500">{outW} × {outH}</span>
        </label>
        <label class="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
          <input type="checkbox" bind:checked={transparentBg} />
          Transparent background
        </label>
      </div>

      <div
        class="flex shrink-0 justify-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-700"
      >
        <button type="button" class="dialog-btn-outline" onclick={cancel}>Cancel</button>
        <button
          type="button"
          class="rounded bg-yellow-600 px-3 py-1 text-xs font-semibold text-black transition-colors hover:bg-yellow-500"
          onclick={confirm}
        >Save PNG</button>
      </div>
    </div>
  </div>
{/if}
