<script>
  import Button from '../ui/Button.svelte'
  import Spinner from '../ui/Spinner.svelte'
  import CaptureKeyframe from '../icons/CaptureKeyframe.svelte'
  import Save from '../icons/Save.svelte'
  import Load from '../icons/Load.svelte'
  import ExportVideo from '../icons/ExportVideo.svelte'
  import { clampNumber } from '../../lib/rangeInput.js'
  import { EXPORT_ASPECT_PRESETS } from '../../lib/animation/schema.js'
  import { ANIMATION_EXPORT_FORMATS } from '../../lib/animation/exportFormats.js'

  /**
   * @type {{
   *   workingDir?: string
   *   outputFolder: string
   *   projectName: string
   *   fps: number
   *   duration_s: number
   *   exportFrame: import('../../lib/animation/schema.js').AnimationExportFrame
   *   playing: boolean
   *   exporting: boolean
   *   expanded?: boolean
   *   onToggleExpanded?: () => void
   *   onOutputFolderChange: (v: string) => void
   *   onProjectNameChange: (v: string) => void
   *   onFpsChange: (v: number) => void
   *   onDurationChange: (v: number) => void
   *   onExportFrameChange: (frame: import('../../lib/animation/schema.js').AnimationExportFrame) => void
   *   onCaptureKeyframe: () => void
   *   onSaveProject: () => void
   *   onLoadProject: () => void
   *   onExportVideo: () => void
   * }}
   */
  let {
    workingDir = '',
    outputFolder,
    projectName,
    fps,
    duration_s,
    exportFrame,
    playing,
    exporting,
    expanded = true,
    onToggleExpanded,
    onOutputFolderChange,
    onProjectNameChange,
    onFpsChange,
    onDurationChange,
    onExportFrameChange,
    onCaptureKeyframe,
    onSaveProject,
    onLoadProject,
    onExportVideo
  } = $props()

  const aspectOptions = Object.keys(EXPORT_ASPECT_PRESETS)

  const fieldClass =
    'min-w-0 flex-1 rounded border border-neutral-300 bg-transparent px-1.5 py-0.5 text-xs dark:border-neutral-800 dark:bg-neutral-950'

  const numClass =
    'field-input w-12 shrink-0 rounded px-1 py-0.5 text-right text-[11px] tabular-nums'

  const numSmClass =
    'field-input w-14 shrink-0 rounded px-1 py-0.5 text-right font-mono text-[10px] tabular-nums'

  /** @param {Event} e @param {(v: number) => void} apply @param {number} min @param {number} max @param {number} step */
  function onNumInput(e, apply, min, max, step) {
    const el = /** @type {HTMLInputElement} */ (e.currentTarget)
    const trimmed = el.value.trim()
    if (trimmed === '' || trimmed === '-' || trimmed.endsWith('.')) return
    const num = Number(trimmed)
    if (!Number.isFinite(num)) return
    const next = clampNumber(num, min, max, step)
    apply(next)
  }

  /** @param {Event} e @param {(v: number) => void} apply @param {number} min @param {number} max @param {number} step */
  function onNumCommit(e, apply, min, max, step) {
    const el = /** @type {HTMLInputElement} */ (e.currentTarget)
    apply(clampNumber(el.value, min, max, step))
  }

  /** @param {string} preset */
  function onAspectPresetChange(preset) {
    const size = EXPORT_ASPECT_PRESETS[/** @type {keyof typeof EXPORT_ASPECT_PRESETS} */ (preset)]
    onExportFrameChange({
      ...exportFrame,
      aspectPreset: /** @type {import('../../lib/animation/schema.js').AnimationAspectPreset} */ (
        preset
      ),
      ...(preset !== 'custom' ? { width: size.width, height: size.height } : {})
    })
  }

  const iconClass = 'size-[1.125rem] shrink-0'
  const iconBtnClass = 'w-full min-h-8 px-0 py-2'
</script>

<div class="border-t border-neutral-800">
  <div class="flex items-center">
    <button
      type="button"
      class="flex flex-1 items-center justify-between px-2 py-1.5 hover:bg-neutral-100/80 dark:hover:bg-neutral-800/40"
      onclick={() => onToggleExpanded?.()}
    >
      <span class="text-xs font-semibold text-neutral-300">Animation</span>
      <span class="text-xs text-neutral-500">{expanded ? '▾' : '▸'}</span>
    </button>
  </div>

  {#if expanded}
    <div class="space-y-1.5 px-2 pb-2">
      {#if !workingDir}
        <div class="gw-notice gw-notice-warning text-[10px] leading-snug">
          Set a working directory in the top bar to save projects and exports.
        </div>
      {/if}

      <div class="space-y-1">
        <label class="flex min-w-0 items-center gap-2 text-[11px] text-neutral-500">
          <span class="w-12 shrink-0">Project</span>
          <input class={fieldClass} value={projectName} oninput={(e) => onProjectNameChange(e.currentTarget.value)} />
        </label>
        <label class="flex min-w-0 items-center gap-2 text-[11px] text-neutral-500">
          <span class="w-12 shrink-0">Output</span>
          <input
            class="{fieldClass} font-mono text-[10px]"
            value={outputFolder}
            oninput={(e) => onOutputFolderChange(e.currentTarget.value)}
          />
        </label>
      </div>

      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-0.5">
        <label class="flex items-center gap-1.5 text-[11px] text-neutral-500">
          FPS
          <input
            class={numClass}
            type="number"
            min="1"
            max="120"
            step="1"
            value={fps}
            oninput={(e) => onNumInput(e, onFpsChange, 1, 120, 1)}
            onchange={(e) => onNumCommit(e, onFpsChange, 1, 120, 1)}
          />
        </label>
        <label class="flex items-center gap-1.5 text-[11px] text-neutral-500">
          Duration
          <input
            class="{numClass} w-14"
            type="number"
            min="0.5"
            max="600"
            step="0.1"
            value={duration_s}
            oninput={(e) => onNumInput(e, onDurationChange, 0.5, 600, 0.1)}
            onchange={(e) => onNumCommit(e, onDurationChange, 0.5, 600, 0.1)}
          />
        </label>
      </div>

      <div class="space-y-1 rounded border border-neutral-800 px-1.5 py-1">
        <p class="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Export frame</p>
        <div class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <select
            class="field-input w-[4.25rem] shrink-0 rounded px-1 py-0.5 text-[10px]"
            value={exportFrame.aspectPreset}
            onchange={(e) => onAspectPresetChange(e.currentTarget.value)}
            title="Aspect ratio"
          >
            {#each aspectOptions as opt}
              <option value={opt}>{opt}</option>
            {/each}
          </select>
          <input
            class={numSmClass}
            type="number"
            min="64"
            step="1"
            value={exportFrame.width}
            disabled={exportFrame.aspectPreset !== 'custom'}
            title="Export width"
            oninput={(e) =>
              onExportFrameChange({
                ...exportFrame,
                aspectPreset: 'custom',
                width: Math.max(64, Number(e.currentTarget.value) || exportFrame.width)
              })}
          />
          <span class="text-[10px] text-neutral-600">×</span>
          <input
            class={numSmClass}
            type="number"
            min="64"
            step="1"
            value={exportFrame.height}
            disabled={exportFrame.aspectPreset !== 'custom'}
            title="Export height"
            oninput={(e) =>
              onExportFrameChange({
                ...exportFrame,
                aspectPreset: 'custom',
                height: Math.max(64, Number(e.currentTarget.value) || exportFrame.height)
              })}
          />
        </div>
        <label class="flex items-center gap-1.5 text-[10px] text-neutral-500">
          <input
            type="checkbox"
            checked={exportFrame.showGuide}
            onchange={(e) =>
              onExportFrameChange({ ...exportFrame, showGuide: e.currentTarget.checked })}
          />
          Show safe area in viewer
        </label>
        <label class="flex min-w-0 items-center gap-1.5 text-[10px] text-neutral-500">
          <span class="shrink-0">Format</span>
          <select
            class="field-input min-w-0 flex-1 rounded px-1 py-0.5 text-[10px]"
            value={exportFrame.exportFormat ?? 'mp4'}
            onchange={(e) =>
              onExportFrameChange({
                ...exportFrame,
                exportFormat: /** @type {import('../../lib/animation/exportFormats.js').AnimationExportFormat} */ (
                  e.currentTarget.value
                )
              })}
            title="Export format"
          >
            {#each ANIMATION_EXPORT_FORMATS as fmt}
              <option value={fmt.id}>{fmt.label}</option>
            {/each}
          </select>
        </label>
      </div>

      <div class="grid grid-cols-4 gap-1">
        <Button
          variant="outline"
          size="sm"
          className={iconBtnClass}
          title="Capture"
          aria-label="Capture"
          onclick={onCaptureKeyframe}
          disabled={playing || exporting}
        >
          <CaptureKeyframe className={iconClass} />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={iconBtnClass}
          title="Save project"
          aria-label="Save project"
          onclick={onSaveProject}
          disabled={exporting}
        >
          <Save className={iconClass} />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={iconBtnClass}
          title="Load project"
          aria-label="Load project"
          onclick={onLoadProject}
          disabled={exporting}
        >
          <Load className={iconClass} />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={iconBtnClass}
          title={exporting ? 'Exporting animation…' : 'Export animation'}
          aria-label="Export animation"
          onclick={onExportVideo}
          disabled={exporting}
        >
          {#if exporting}
            <Spinner className={iconClass} />
          {:else}
            <ExportVideo className={iconClass} />
          {/if}
        </Button>
      </div>
    </div>
  {/if}
</div>
