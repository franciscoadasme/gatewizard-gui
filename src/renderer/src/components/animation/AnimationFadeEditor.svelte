<script>
  import {
    DEFAULT_FADE_EASING,
    DEFAULT_FADE_IN_S,
    DEFAULT_FADE_OUT_S,
    isFadeEnabled,
    normalizeFadeSettings
  } from '../../lib/animation/fade.js'
  import {
    EASING_PRESETS,
    easingLabel,
    normalizeBezier,
    normalizeEasingKind,
    sampleEasingCurves
  } from '../../lib/animation/easing.js'
  import RangeInput from '../ui/RangeInput.svelte'

  /**
   * @type {{
   *   itemLabel: string
   *   fadeEnabled?: boolean
   *   fadeIn_s?: number
   *   fadeOut_s?: number
   *   fadeInEasing?: import('../../lib/animation/easing.js').AnimationEasingKind
   *   fadeOutEasing?: import('../../lib/animation/easing.js').AnimationEasingKind
   *   fadeInBezier?: [number, number, number, number] | null
   *   fadeOutBezier?: [number, number, number, number] | null
   *   onChange: (next: import('../../lib/animation/fade.js').AnimationFadeSettings) => void
   *   onClose: () => void
   * }}
   */
  let {
    itemLabel,
    fadeEnabled = true,
    fadeIn_s = DEFAULT_FADE_IN_S,
    fadeOut_s = DEFAULT_FADE_OUT_S,
    fadeInEasing = DEFAULT_FADE_EASING,
    fadeOutEasing = DEFAULT_FADE_EASING,
    fadeInBezier = null,
    fadeOutBezier = null,
    onChange,
    onClose
  } = $props()

  const presetList = Object.values(EASING_PRESETS).filter((p) => p.kind !== 'bezier')

  /** @type {'in' | 'out'} */
  let activeDir = $state('in')

  const seed = $derived(
    normalizeFadeSettings({
      fadeEnabled,
      fadeIn_s,
      fadeOut_s,
      fadeInEasing,
      fadeOutEasing,
      fadeInBezier,
      fadeOutBezier
    })
  )

  let localEnabled = $state(true)
  let localIn_s = $state(DEFAULT_FADE_IN_S)
  let localOut_s = $state(DEFAULT_FADE_OUT_S)
  let localInKind = $state(/** @type {import('../../lib/animation/easing.js').AnimationEasingKind} */ (DEFAULT_FADE_EASING))
  let localOutKind = $state(/** @type {import('../../lib/animation/easing.js').AnimationEasingKind} */ (DEFAULT_FADE_EASING))
  let localInBezier = $state(/** @type {[number, number, number, number]} */ ([0.42, 0, 0.58, 1]))
  let localOutBezier = $state(/** @type {[number, number, number, number]} */ ([0.42, 0, 0.58, 1]))
  let canvas = $state(/** @type {HTMLCanvasElement | null} */ (null))
  /** @type {'p1' | 'p2' | null} */
  let dragging = $state(null)

  $effect.pre(() => {
    localEnabled = isFadeEnabled(seed)
    localIn_s = seed.fadeIn_s ?? DEFAULT_FADE_IN_S
    localOut_s = seed.fadeOut_s ?? DEFAULT_FADE_OUT_S
    localInKind = normalizeEasingKind(seed.fadeInEasing)
    localOutKind = normalizeEasingKind(seed.fadeOutEasing)
    localInBezier = [...normalizeBezier(seed.fadeInBezier, localInKind)]
    localOutBezier = [...normalizeBezier(seed.fadeOutBezier, localOutKind)]
  })

  const activeKind = $derived(activeDir === 'in' ? localInKind : localOutKind)
  const activeBezier = $derived(activeDir === 'in' ? localInBezier : localOutBezier)
  const samples = $derived(
    sampleEasingCurves(activeKind, activeKind === 'bezier' ? activeBezier : null)
  )

  function emitChange() {
    onChange({
      fadeEnabled: localEnabled,
      fadeIn_s: localIn_s,
      fadeOut_s: localOut_s,
      fadeInEasing: localInKind,
      fadeOutEasing: localOutKind,
      fadeInBezier: localInKind === 'bezier' ? [...localInBezier] : undefined,
      fadeOutBezier: localOutKind === 'bezier' ? [...localOutBezier] : undefined
    })
  }

  /** @param {'in' | 'out'} dir @param {import('../../lib/animation/easing.js').AnimationEasingKind} kind */
  function selectPreset(dir, kind) {
    if (dir === 'in') {
      localInKind = kind
      if (kind !== 'bezier') localInBezier = normalizeBezier(null, kind)
    } else {
      localOutKind = kind
      if (kind !== 'bezier') localOutBezier = normalizeBezier(null, kind)
    }
    emitChange()
  }

  /** @param {'in' | 'out'} dir */
  function selectCustom(dir) {
    if (dir === 'in') localInKind = 'bezier'
    else localOutKind = 'bezier'
    activeDir = dir
    emitChange()
  }

  function drawChart() {
    if (!canvas) return
    const pad = 16
    const w = canvas.clientWidth || 280
    const h = canvas.clientHeight || 88
    canvas.width = Math.round(w * devicePixelRatio)
    canvas.height = Math.round(h * devicePixelRatio)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const plotW = w - pad * 2
    const plotH = h - pad * 2

    ctx.strokeStyle = '#404040'
    ctx.lineWidth = 1
    ctx.strokeRect(pad, pad, plotW, plotH)

    ctx.strokeStyle = '#eab308'
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let i = 0; i < samples.position.length; i++) {
      const p = samples.position[i]
      const cx = pad + p.t * plotW
      const cy = pad + (1 - p.y) * plotH
      if (i === 0) ctx.moveTo(cx, cy)
      else ctx.lineTo(cx, cy)
    }
    ctx.stroke()

    if (activeKind === 'bezier') {
      const [x1, y1, x2, y2] = activeBezier
      const p0 = { x: pad, y: pad + plotH }
      const p1 = { x: pad + x1 * plotW, y: pad + (1 - y1) * plotH }
      const p2 = { x: pad + x2 * plotW, y: pad + (1 - y2) * plotH }
      const p3 = { x: pad + plotW, y: pad }
      ctx.strokeStyle = '#525252'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(p0.x, p0.y)
      ctx.lineTo(p1.x, p1.y)
      ctx.moveTo(p3.x, p3.y)
      ctx.lineTo(p2.x, p2.y)
      ctx.stroke()
      ctx.setLineDash([])
      for (const p of [p1, p2]) {
        ctx.fillStyle = '#facc15'
        ctx.beginPath()
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    ctx.fillStyle = '#a3a3a3'
    ctx.font = '10px Roboto, sans-serif'
    ctx.fillText(activeDir === 'in' ? 'Fade in opacity' : 'Fade out opacity', pad, 12)
  }

  $effect(() => {
    activeDir
    localInKind
    localOutKind
    localInBezier
    localOutBezier
    samples
    canvas
    dragging
    drawChart()
  })

  /**
   * @param {PointerEvent} e
   * @param {'p1' | 'p2'} handle
   */
  function startHandleDrag(e, handle) {
    if (activeKind !== 'bezier') {
      if (activeDir === 'in') localInKind = 'bezier'
      else localOutKind = 'bezier'
    }
    dragging = handle
    e.preventDefault()
    e.stopPropagation()
    /** @param {PointerEvent} ev */
    const onMove = (ev) => updateHandleFromEvent(ev, handle)
    const onUp = () => {
      dragging = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      emitChange()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  /**
   * @param {PointerEvent} e
   * @param {'p1' | 'p2'} handle
   */
  function updateHandleFromEvent(e, handle) {
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const pad = 16
    const plotW = rect.width - pad * 2
    const plotH = rect.height - pad * 2
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left - pad) / plotW))
    const y = Math.max(-0.4, Math.min(1.4, 1 - (e.clientY - rect.top - pad) / plotH))
    if (activeDir === 'in') {
      const next = /** @type {[number, number, number, number]} */ ([...localInBezier])
      if (handle === 'p1') {
        next[0] = x
        next[1] = y
      } else {
        next[2] = x
        next[3] = y
      }
      localInBezier = next
    } else {
      const next = /** @type {[number, number, number, number]} */ ([...localOutBezier])
      if (handle === 'p1') {
        next[0] = x
        next[1] = y
      } else {
        next[2] = x
        next[3] = y
      }
      localOutBezier = next
    }
  }
</script>

<div
  class="fixed bottom-[7.5rem] left-1/2 z-[220] w-[min(22rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl"
  role="dialog"
  aria-labelledby="fade-editor-title"
  tabindex="-1"
>
  <div class="flex items-start justify-between gap-2 border-b border-neutral-800 px-3 py-2">
    <div class="min-w-0">
      <p id="fade-editor-title" class="text-xs font-semibold text-neutral-100">Fade in / out</p>
      <p class="truncate text-[10px] text-neutral-500">{itemLabel}</p>
    </div>
    <button
      type="button"
      class="shrink-0 rounded px-1.5 py-0.5 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
      aria-label="Close"
      onclick={onClose}>×</button
    >
  </div>

  <div class="space-y-3 px-3 py-2">
    <label class="flex cursor-pointer items-center gap-2 rounded border border-neutral-800 px-2 py-1.5 text-[11px] text-neutral-200">
      <input
        type="checkbox"
        class="accent-yellow-500"
        checked={localEnabled}
        onchange={(e) => {
          localEnabled = e.currentTarget.checked
          emitChange()
        }}
      />
      Animate fade in / out
    </label>

    <div class="space-y-3 {localEnabled ? '' : 'pointer-events-none opacity-45'}">
    <div class="flex gap-1">
      <button
        type="button"
        class="flex-1 rounded border px-2 py-1 text-[10px] {activeDir === 'in'
          ? 'border-yellow-500/70 bg-yellow-500/15 text-yellow-200'
          : 'border-neutral-700 text-neutral-400 hover:bg-neutral-800'}"
        onclick={() => (activeDir = 'in')}>Fade in</button
      >
      <button
        type="button"
        class="flex-1 rounded border px-2 py-1 text-[10px] {activeDir === 'out'
          ? 'border-yellow-500/70 bg-yellow-500/15 text-yellow-200'
          : 'border-neutral-700 text-neutral-400 hover:bg-neutral-800'}"
        onclick={() => (activeDir = 'out')}>Fade out</button
      >
    </div>

    {#if activeDir === 'in'}
      <label class="flex flex-col gap-1 text-[10px] text-neutral-400">
        <span>Duration (s) · 0 = instant</span>
        <RangeInput
          bind:value={
            () => localIn_s,
            (v) => {
              localIn_s = v
              emitChange()
            }
          }
          min={0}
          max={30}
          step={0.05}
          decimals={2}
          rangeClassName="flex-1 accent-yellow-400"
          inputClassName="w-16"
        />
      </label>
      <div class="flex flex-wrap gap-1">
        {#each presetList as preset (preset.kind)}
          <button
            type="button"
            class="rounded border px-2 py-1 text-[10px] transition-colors {localInKind === preset.kind
              ? 'border-yellow-500/70 bg-yellow-500/15 text-yellow-200'
              : 'border-neutral-700 text-neutral-300 hover:border-neutral-600 hover:bg-neutral-800'}"
            title={preset.hint}
            onclick={() => selectPreset('in', preset.kind)}>{preset.label}</button
          >
        {/each}
        <button
          type="button"
          class="rounded border px-2 py-1 text-[10px] transition-colors {localInKind === 'bezier'
            ? 'border-yellow-500/70 bg-yellow-500/15 text-yellow-200'
            : 'border-neutral-700 text-neutral-300 hover:border-neutral-600 hover:bg-neutral-800'}"
          onclick={() => selectCustom('in')}>Custom</button
        >
      </div>
      <p class="text-[10px] text-neutral-500">
        In: {localIn_s.toFixed(2)}s · {easingLabel(localInKind, localInKind === 'bezier' ? localInBezier : null)}
      </p>
    {:else}
      <label class="flex flex-col gap-1 text-[10px] text-neutral-400">
        <span>Duration (s) · 0 = instant</span>
        <RangeInput
          bind:value={
            () => localOut_s,
            (v) => {
              localOut_s = v
              emitChange()
            }
          }
          min={0}
          max={30}
          step={0.05}
          decimals={2}
          rangeClassName="flex-1 accent-yellow-400"
          inputClassName="w-16"
        />
      </label>
      <div class="flex flex-wrap gap-1">
        {#each presetList as preset (preset.kind)}
          <button
            type="button"
            class="rounded border px-2 py-1 text-[10px] transition-colors {localOutKind === preset.kind
              ? 'border-yellow-500/70 bg-yellow-500/15 text-yellow-200'
              : 'border-neutral-700 text-neutral-300 hover:border-neutral-600 hover:bg-neutral-800'}"
            title={preset.hint}
            onclick={() => selectPreset('out', preset.kind)}>{preset.label}</button
          >
        {/each}
        <button
          type="button"
          class="rounded border px-2 py-1 text-[10px] transition-colors {localOutKind === 'bezier'
            ? 'border-yellow-500/70 bg-yellow-500/15 text-yellow-200'
            : 'border-neutral-700 text-neutral-300 hover:border-neutral-600 hover:bg-neutral-800'}"
          onclick={() => selectCustom('out')}>Custom</button
        >
      </div>
      <p class="text-[10px] text-neutral-500">
        Out: {localOut_s.toFixed(2)}s · {easingLabel(localOutKind, localOutKind === 'bezier' ? localOutBezier : null)}
      </p>
    {/if}

    <div class="relative">
      <canvas
        bind:this={canvas}
        class="h-24 w-full cursor-crosshair rounded border border-neutral-800 bg-neutral-950"
        aria-label="Fade opacity curve"
      ></canvas>
      {#if activeKind === 'bezier' && canvas}
        {@const pad = 16}
        {@const w = canvas.clientWidth || 280}
        {@const h = canvas.clientHeight || 88}
        {@const plotW = w - pad * 2}
        {@const plotH = h - pad * 2}
        {@const [x1, y1, x2, y2] = activeBezier}
        <button
          type="button"
          class="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-yellow-300 bg-yellow-500/80"
          style="left:{pad + x1 * plotW}px;top:{pad + (1 - y1) * plotH}px"
          aria-label="Bezier handle 1"
          onpointerdown={(e) => startHandleDrag(e, 'p1')}
        ></button>
        <button
          type="button"
          class="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-yellow-300 bg-yellow-500/80"
          style="left:{pad + x2 * plotW}px;top:{pad + (1 - y2) * plotH}px"
          aria-label="Bezier handle 2"
          onpointerdown={(e) => startHandleDrag(e, 'p2')}
        ></button>
      {/if}
    </div>

    <p class="text-[10px] text-neutral-600">
      {#if localEnabled}
        Fade settings are saved on capture keyframe and apply when this item appears, disappears,
        or toggles visibility between keyframes.
      {:else}
        Fade is off — visibility changes are instant at keyframe boundaries (no opacity animation).
      {/if}
    </p>
    </div>
  </div>
</div>
