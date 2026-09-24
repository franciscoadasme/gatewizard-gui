<script>
  import Spinner from './ui/Spinner.svelte'
  import { TRAJ_RMSD_SELECTION_PRESETS } from '../lib/analysisSets.js'
  import { themeState } from '../lib/theme.svelte.js'

  /**
   * @type {{
   *   selection: string
   *   referenceFrame: number
   *   currentFrame: number
   *   frameCount: number
   *   mode: 'none' | 'rmsd' | 'align'
   *   rmsd: number[] | null
   *   nMobile: number | null
   *   atomCount: number | null
   *   busy: boolean
   *   error: string
   *   onClose: () => void
   *   onComputeRmsd: () => void
   *   onAlign: () => void
   *   onClear: () => void
   *   onSelectionChange: (sel: string) => void
   *   onReferenceChange: (frame: number) => void
   *   onSeekFrame: (frame: number) => void
   *   onUseCurrentFrame: () => void
   * }}
   */
  let {
    selection,
    referenceFrame,
    currentFrame,
    frameCount,
    mode,
    rmsd,
    nMobile,
    atomCount,
    busy,
    error,
    onClose,
    onComputeRmsd,
    onAlign,
    onClear,
    onSelectionChange,
    onReferenceChange,
    onSeekFrame,
    onUseCurrentFrame
  } = $props()

  const dark = $derived(themeState.current === 'dark')
  const customSelected = $derived(!TRAJ_RMSD_SELECTION_PRESETS.some((p) => p.value === selection))

  const modeHint = $derived.by(() => {
    switch (mode) {
      case 'none':
        return 'Calculate RMSD plots the selection versus the reference frame. Align trajectory fits that selection and applies the same rotation/translation to every atom so the movie stays put.'
      case 'rmsd':
        return 'Showing unaligned RMSD. The trajectory is not moved.'
      case 'align':
        return 'Showing aligned RMSD. Every atom follows the fit — play the trajectory to see it aligned.'
      default: {
        const _never = /** @type {never} */ (mode)
        return _never
      }
    }
  })

  const plot = $derived.by(() => {
    const ys = rmsd && rmsd.length ? rmsd : []
    if (!ys.length) return null
    const w = 360
    const h = 128
    const padL = 36
    const padR = 8
    const padT = 10
    const padB = 22
    const innerW = w - padL - padR
    const innerH = h - padT - padB
    let yMin = Math.min(...ys)
    let yMax = Math.max(...ys)
    if (yMax - yMin < 1e-6) {
      yMin -= 0.25
      yMax += 0.25
    }
    const xAt = (i) => padL + (ys.length <= 1 ? innerW / 2 : (i / (ys.length - 1)) * innerW)
    const yAt = (v) => padT + innerH - ((v - yMin) / (yMax - yMin)) * innerH
    const d = ys
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(2)},${yAt(v).toFixed(2)}`)
      .join(' ')
    const cur = Math.max(0, Math.min(ys.length - 1, Math.round(currentFrame)))
    const curRmsd = ys[cur]
    const mean = ys.reduce((s, v) => s + v, 0) / ys.length
    return {
      w,
      h,
      padL,
      padT,
      innerW,
      innerH,
      yMin,
      yMax,
      d,
      xAt,
      yAt,
      cur,
      curRmsd,
      mean
    }
  })

  /** @param {MouseEvent} e */
  function onPlotClick(e) {
    if (!plot || !rmsd?.length) return
    const el = /** @type {HTMLElement} */ (e.currentTarget)
    const rect = el.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * plot.w
    const t = (x - plot.padL) / plot.innerW
    const i = Math.max(0, Math.min(rmsd.length - 1, Math.round(t * (rmsd.length - 1))))
    onSeekFrame(i)
  }
</script>

<div
  class="viewer-side-panel--nonmodal fixed top-10 bottom-10 left-16 z-50 flex w-[420px] max-w-[calc(100vw-5rem)] flex-col overflow-hidden rounded-lg border border-neutral-300 bg-white p-0 text-neutral-900 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
  role="dialog"
  aria-labelledby="traj-align-title"
>
  <div class="flex items-center justify-between border-b dialog-divider px-4 py-2.5">
    <h3 id="traj-align-title" class="text-sm font-semibold">Align / RMSD</h3>
    <button
      type="button"
      class="text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
      onclick={onClose}>✕</button
    >
  </div>

  <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
    <p class="text-[11px] leading-snug text-neutral-500 dark:text-neutral-400">{modeHint}</p>

    <div class="grid grid-cols-2 gap-2">
      <div
        class="rounded border px-2 py-1.5 text-[11px] leading-snug {mode === 'rmsd'
          ? 'border-yellow-500 bg-yellow-500/10 dark:border-yellow-400'
          : 'border-neutral-200 dark:border-neutral-700'}"
      >
        <div class="font-semibold text-neutral-800 dark:text-neutral-100">Calculate RMSD</div>
        <p class="mt-0.5 text-neutral-500">Versus the reference frame. Does not move atoms.</p>
      </div>
      <div
        class="rounded border px-2 py-1.5 text-[11px] leading-snug {mode === 'align'
          ? 'border-yellow-500 bg-yellow-500/10 dark:border-yellow-400'
          : 'border-neutral-200 dark:border-neutral-700'}"
      >
        <div class="font-semibold text-neutral-800 dark:text-neutral-100">Align trajectory</div>
        <p class="mt-0.5 text-neutral-500">Fit the selection; apply that rigid motion to all atoms.</p>
      </div>
    </div>

    <div>
      <div class="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">
        {mode === 'align' ? 'Fit selection' : 'RMSD selection'}
      </div>
      <div class="flex flex-wrap gap-1">
        {#each TRAJ_RMSD_SELECTION_PRESETS as preset}
          <button
            type="button"
            class="rounded border px-1.5 py-0.5 text-[11px] {selection === preset.value
              ? 'border-yellow-500 bg-yellow-500/15 text-yellow-800 dark:border-yellow-400 dark:text-yellow-300'
              : 'border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'}"
            onclick={() => onSelectionChange(preset.value)}>{preset.label}</button
          >
        {/each}
        <button
          type="button"
          class="rounded border px-1.5 py-0.5 text-[11px] {customSelected
            ? 'border-yellow-500 bg-yellow-500/15 text-yellow-800 dark:border-yellow-400 dark:text-yellow-300'
            : 'border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'}"
          onclick={() => {
            if (!customSelected) onSelectionChange(selection || 'protein and backbone')
          }}>Custom</button
        >
      </div>
      <input
        type="text"
        class="mt-1.5 w-full field-input font-mono text-[11px]"
        value={selection}
        oninput={(e) => onSelectionChange(e.currentTarget.value)}
        placeholder="protein and backbone"
      />
      {#if atomCount != null}
        <p class="mt-1 text-[10px] text-neutral-500">
          {atomCount} atom{atomCount === 1 ? '' : 's'}
          {#if mode === 'align'}
            · fit uses these; all atoms are moved
          {/if}
        </p>
      {/if}
    </div>

    <div class="flex items-center gap-2">
      <label for="traj-align-ref" class="dialog-label w-28 shrink-0 text-xs">Reference frame</label>
      <input
        id="traj-align-ref"
        type="number"
        min="1"
        max={Math.max(1, frameCount)}
        class="w-20 field-input"
        value={referenceFrame + 1}
        oninput={(e) => onReferenceChange(Math.max(0, Number(e.currentTarget.value) - 1))}
      />
      <button type="button" class="dialog-btn-outline text-[11px]" onclick={onUseCurrentFrame}
        >Use current</button
      >
    </div>

    {#if error}
      <p class="gw-notice gw-notice-error font-mono text-[11px]">{error}</p>
    {/if}

    {#if plot}
      {@const axis = dark ? '#a3a3a3' : '#525252'}
      {@const line = dark ? '#facc15' : '#ca8a04'}
      {@const grid = dark ? '#262626' : '#e5e5e5'}
      {@const play = dark ? '#f87171' : '#dc2626'}
      <div>
        <div class="mb-1 flex items-baseline justify-between text-[10px] text-neutral-500">
          <span
            >{nMobile ?? '—'} atoms · {mode === 'align' ? 'aligned' : 'unaligned'} · mean {plot.mean.toFixed(
              2
            )} Å</span
          >
          <span class="font-mono">frame {plot.cur + 1}: {plot.curRmsd.toFixed(2)} Å</span>
        </div>
        <button
          type="button"
          class="block w-full cursor-crosshair rounded border border-neutral-200 bg-neutral-50 p-0 dark:border-neutral-800 dark:bg-neutral-950"
          aria-label="RMSD versus frame; click to jump"
          onclick={onPlotClick}
        >
          <svg
            viewBox="0 0 {plot.w} {plot.h}"
            class="pointer-events-none block w-full"
            aria-hidden="true"
          >
            <line
              x1={plot.padL}
              y1={plot.padT}
              x2={plot.padL}
              y2={plot.padT + plot.innerH}
              stroke={axis}
              stroke-width="1"
            />
            <line
              x1={plot.padL}
              y1={plot.padT + plot.innerH}
              x2={plot.padL + plot.innerW}
              y2={plot.padT + plot.innerH}
              stroke={axis}
              stroke-width="1"
            />
            <line
              x1={plot.padL}
              y1={plot.yAt(plot.mean)}
              x2={plot.padL + plot.innerW}
              y2={plot.yAt(plot.mean)}
              stroke={grid}
              stroke-dasharray="3 3"
            />
            <path d={plot.d} fill="none" stroke={line} stroke-width="1.5" />
            <line
              x1={plot.xAt(plot.cur)}
              y1={plot.padT}
              x2={plot.xAt(plot.cur)}
              y2={plot.padT + plot.innerH}
              stroke={play}
              stroke-width="1"
            />
            <circle cx={plot.xAt(plot.cur)} cy={plot.yAt(plot.curRmsd)} r="2.5" fill={play} />
            <text x={plot.padL - 4} y={plot.padT + 4} text-anchor="end" fill={axis} font-size="8"
              >{plot.yMax.toFixed(1)}</text
            >
            <text
              x={plot.padL - 4}
              y={plot.padT + plot.innerH}
              text-anchor="end"
              fill={axis}
              font-size="8">{plot.yMin.toFixed(1)}</text
            >
            <text
              x={plot.padL + plot.innerW / 2}
              y={plot.h - 4}
              text-anchor="middle"
              fill={axis}
              font-size="8">Frame</text
            >
            <text
              x="10"
              y={plot.padT + plot.innerH / 2}
              text-anchor="middle"
              fill={axis}
              font-size="8"
              transform="rotate(-90 10 {plot.padT + plot.innerH / 2})">Å</text
            >
          </svg>
        </button>
        <p class="mt-1 text-[10px] text-neutral-500">Click the plot to jump to that frame.</p>
      </div>
    {/if}
  </div>

  <div class="flex flex-wrap items-center justify-between gap-2 border-t dialog-divider px-4 py-3">
    <button
      type="button"
      class="dialog-btn-outline"
      disabled={(!rmsd?.length && mode === 'none') || busy}
      onclick={onClear}>Clear</button
    >
    <div class="flex flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        class="dialog-btn-outline flex items-center gap-1"
        disabled={busy || !selection.trim()}
        onclick={onComputeRmsd}
        >{#if busy}<Spinner />{/if}
        Calculate RMSD</button
      >
      <button
        type="button"
        class="flex items-center gap-1 rounded bg-yellow-600 px-3 py-1 text-xs font-semibold text-black hover:bg-yellow-500 disabled:opacity-40"
        disabled={busy || !selection.trim()}
        onclick={onAlign}
        >{#if busy}<Spinner />{/if}
        Align trajectory</button
      >
    </div>
  </div>
</div>
