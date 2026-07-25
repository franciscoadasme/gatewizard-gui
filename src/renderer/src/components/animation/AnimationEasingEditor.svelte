<script>
  import {
    DEFAULT_EASING_KIND,
    EASING_PRESETS,
    normalizeBezier,
    normalizeEasingKind,
    sampleEasingCurves
  } from '../../lib/animation/easing.js'

  /**
   * @type {{
   *   fromLabel: string
   *   toLabel: string
   *   fromTime_s: number
   *   toTime_s: number
   *   easing: import('../../lib/animation/easing.js').AnimationEasingKind
   *   easingBezier?: [number, number, number, number] | null
   *   onChange: (next: { easing: import('../../lib/animation/easing.js').AnimationEasingKind, easingBezier?: [number, number, number, number] }) => void
   *   onClose: () => void
   * }}
   */
  let {
    fromLabel,
    toLabel,
    fromTime_s,
    toTime_s,
    easing,
    easingBezier = null,
    onChange,
    onClose
  } = $props()

  const presetList = Object.values(EASING_PRESETS).filter((p) => p.kind !== 'bezier')
  const seedKind = $derived(normalizeEasingKind(easing))
  const seedBezier = $derived(normalizeBezier(easingBezier, seedKind))

  let localKind = $state(/** @type {import('../../lib/animation/easing.js').AnimationEasingKind} */ (DEFAULT_EASING_KIND))
  let localBezier = $state(/** @type {[number, number, number, number]} */ ([...EASING_PRESETS[DEFAULT_EASING_KIND].bezier]))
  let posCanvas = $state(/** @type {HTMLCanvasElement | null} */ (null))
  let velCanvas = $state(/** @type {HTMLCanvasElement | null} */ (null))
  /** @type {'p1' | 'p2' | null} */
  let dragging = $state(null)

  $effect.pre(() => {
    localKind = seedKind
    localBezier = [...seedBezier]
  })

  const samples = $derived(sampleEasingCurves(localKind, localKind === 'bezier' ? localBezier : null))

  function emitChange() {
    onChange({
      easing: localKind,
      easingBezier: localKind === 'bezier' ? [...localBezier] : undefined
    })
  }

  /** @param {import('../../lib/animation/easing.js').AnimationEasingKind} kind */
  function selectPreset(kind) {
    localKind = kind
    if (kind !== 'bezier') {
      localBezier = normalizeBezier(null, kind)
    }
    emitChange()
  }

  function selectCustom() {
    localKind = 'bezier'
    emitChange()
  }

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {number} pad
   */
  function plotRect(canvas, pad) {
    const w = canvas.clientWidth || 280
    const h = canvas.clientHeight || 100
    canvas.width = Math.round(w * devicePixelRatio)
    canvas.height = Math.round(h * devicePixelRatio)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
    const plotW = w - pad * 2
    const plotH = h - pad * 2
    return { ctx, w, h, pad, plotW, plotH }
  }

  /** @param {number} x @param {number} y @param {{ pad: number, plotW: number, plotH: number }} r */
  function toCanvas(x, y, r) {
    return {
      cx: r.pad + x * r.plotW,
      cy: r.pad + (1 - y) * r.plotH
    }
  }

  function drawCharts() {
    drawPositionChart()
    drawVelocityChart()
  }

  function drawPositionChart() {
    if (!posCanvas) return
    const r = plotRect(posCanvas, 16)
    if (!r) return
    const { ctx, w, h, pad, plotW, plotH } = r

    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#171717'
    ctx.fillRect(0, 0, w, h)

    ctx.strokeStyle = '#404040'
    ctx.lineWidth = 1
    ctx.strokeRect(pad, pad, plotW, plotH)

    // Grid
    ctx.strokeStyle = '#2a2a2a'
    for (let i = 1; i < 4; i++) {
      const gx = pad + (plotW * i) / 4
      const gy = pad + (plotH * i) / 4
      ctx.beginPath()
      ctx.moveTo(gx, pad)
      ctx.lineTo(gx, pad + plotH)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(pad, gy)
      ctx.lineTo(pad + plotW, gy)
      ctx.stroke()
    }

    if (localKind === 'bezier') {
      const p1 = toCanvas(localBezier[0], localBezier[1], r)
      const p2 = toCanvas(localBezier[2], localBezier[3], r)
      const end = toCanvas(1, 1, r)
      const start = toCanvas(0, 0, r)
      ctx.strokeStyle = '#525252'
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(start.cx, start.cy)
      ctx.lineTo(p1.cx, p1.cy)
      ctx.lineTo(p2.cx, p2.cy)
      ctx.lineTo(end.cx, end.cy)
      ctx.stroke()
      ctx.setLineDash([])

      for (const [pt, label] of [
        [p1, 'p1'],
        [p2, 'p2']
      ]) {
        ctx.fillStyle = dragging === label ? '#fde047' : '#eab308'
        ctx.beginPath()
        ctx.arc(pt.cx, pt.cy, dragging === label ? 6 : 5, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    ctx.strokeStyle = '#38bdf8'
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let i = 0; i < samples.position.length; i++) {
      const p = samples.position[i]
      const { cx, cy } = toCanvas(p.t, p.y, r)
      if (i === 0) ctx.moveTo(cx, cy)
      else ctx.lineTo(cx, cy)
    }
    ctx.stroke()

    ctx.fillStyle = '#a3a3a3'
    ctx.font = '10px Roboto, sans-serif'
    ctx.fillText('Start', pad, h - 4)
    ctx.fillText('End', pad + plotW - 18, h - 4)
    ctx.fillText('Position', pad, 12)
  }

  function drawVelocityChart() {
    if (!velCanvas) return
    const r = plotRect(velCanvas, 16)
    if (!r) return
    const { ctx, w, h, pad, plotW, plotH } = r

    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#171717'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = '#404040'
    ctx.lineWidth = 1
    ctx.strokeRect(pad, pad, plotW, plotH)

    const vals = samples.velocity.map((p) => p.y)
    const minV = Math.min(0, ...vals)
    const maxV = Math.max(1.5, ...vals)
    const span = Math.max(0.001, maxV - minV)

    // Reference line for constant velocity (linear)
    const linY = (1 - (1 - minV) / span)
    ctx.strokeStyle = '#525252'
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(pad, pad + linY * plotH)
    ctx.lineTo(pad + plotW, pad + linY * plotH)
    ctx.stroke()
    ctx.setLineDash([])

    ctx.strokeStyle = '#f472b6'
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let i = 0; i < samples.velocity.length; i++) {
      const p = samples.velocity[i]
      const nx = p.t
      const ny = (p.y - minV) / span
      const cx = pad + nx * plotW
      const cy = pad + (1 - ny) * plotH
      if (i === 0) ctx.moveTo(cx, cy)
      else ctx.lineTo(cx, cy)
    }
    ctx.stroke()

    ctx.fillStyle = '#a3a3a3'
    ctx.font = '10px Roboto, sans-serif'
    ctx.fillText('Velocity (change rate)', pad, 12)
    ctx.fillText('Linear = flat', pad + plotW - 58, 12)
  }

  $effect(() => {
    localKind
    localBezier
    samples
    posCanvas
    velCanvas
    dragging
    drawCharts()
  })

  /**
   * @param {PointerEvent} e
   * @param {'p1' | 'p2'} handle
   */
  function startHandleDrag(e, handle) {
    if (localKind !== 'bezier') {
      localKind = 'bezier'
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
    if (!posCanvas) return
    const rect = posCanvas.getBoundingClientRect()
    const pad = 16
    const plotW = rect.width - pad * 2
    const plotH = rect.height - pad * 2
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left - pad) / plotW))
    const y = Math.max(-0.4, Math.min(1.4, 1 - (e.clientY - rect.top - pad) / plotH))
    const next = /** @type {[number, number, number, number]} */ ([...localBezier])
    if (handle === 'p1') {
      next[0] = x
      next[1] = y
    } else {
      next[2] = x
      next[3] = y
    }
    localBezier = next
  }
</script>

<div
  class="fixed bottom-[7.5rem] left-1/2 z-[220] w-[min(22rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl"
  role="dialog"
  aria-labelledby="easing-editor-title"
  tabindex="-1"
>
  <div class="flex items-start justify-between gap-2 border-b border-neutral-800 px-3 py-2">
    <div class="min-w-0">
      <p id="easing-editor-title" class="text-xs font-semibold text-neutral-100">Segment easing</p>
      <p class="truncate text-[10px] text-neutral-500">
        {fromLabel} ({fromTime_s.toFixed(2)}s) → {toLabel} ({toTime_s.toFixed(2)}s)
      </p>
    </div>
    <button
      type="button"
      class="shrink-0 rounded px-1.5 py-0.5 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
      aria-label="Close"
      onclick={onClose}>×</button
    >
  </div>

  <div class="space-y-2 px-3 py-2">
    <p class="text-[10px] text-neutral-400">
      Choose how motion blends between keyframes. Use <span class="text-neutral-200">Linear</span> for
      constant-speed turntable rotations.
    </p>

    <div class="flex flex-wrap gap-1">
      {#each presetList as preset (preset.kind)}
        <button
          type="button"
          class="rounded border px-2 py-1 text-[10px] transition-colors {localKind === preset.kind
            ? 'border-yellow-500/70 bg-yellow-500/15 text-yellow-200'
            : 'border-neutral-700 text-neutral-300 hover:border-neutral-600 hover:bg-neutral-800'}"
          title={preset.hint}
          onclick={() => selectPreset(preset.kind)}>{preset.label}</button
        >
      {/each}
      <button
        type="button"
        class="rounded border px-2 py-1 text-[10px] transition-colors {localKind === 'bezier'
          ? 'border-yellow-500/70 bg-yellow-500/15 text-yellow-200'
          : 'border-neutral-700 text-neutral-300 hover:border-neutral-600 hover:bg-neutral-800'}"
        title={EASING_PRESETS.bezier.hint}
        onclick={selectCustom}>Custom</button
      >
    </div>

    {#if localKind !== 'linear'}
      <p class="text-[10px] text-neutral-500">{EASING_PRESETS[localKind]?.hint ?? EASING_PRESETS.bezier.hint}</p>
    {/if}

    <div>
      <canvas
        bind:this={posCanvas}
        class="h-24 w-full cursor-crosshair rounded border border-neutral-800 bg-neutral-950"
        aria-label="Position easing curve"
      ></canvas>
      {#if localKind === 'bezier'}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="relative -mt-24 h-24 w-full">
          <!-- invisible hit targets over handles drawn on canvas -->
        </div>
        <p class="mt-1 text-[10px] text-neutral-500">
          Drag the yellow handles on the curve to shape a custom blend.
        </p>
        {#if posCanvas}
          {@const pad = 16}
          {@const w = posCanvas.clientWidth || 280}
          {@const h = posCanvas.clientHeight || 96}
          {@const plotW = w - pad * 2}
          {@const plotH = h - pad * 2}
          {@const p1x = pad + localBezier[0] * plotW}
          {@const p1y = pad + (1 - localBezier[1]) * plotH}
          {@const p2x = pad + localBezier[2] * plotW}
          {@const p2y = pad + (1 - localBezier[3]) * plotH}
          <div class="pointer-events-none relative -mt-24 h-24 w-full">
            <button
              type="button"
              class="pointer-events-auto absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-yellow-300/80 bg-transparent"
              style="left:{p1x}px;top:{p1y}px"
              aria-label="Adjust first control point"
              onpointerdown={(e) => startHandleDrag(e, 'p1')}
            ></button>
            <button
              type="button"
              class="pointer-events-auto absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-yellow-300/80 bg-transparent"
              style="left:{p2x}px;top:{p2y}px"
              aria-label="Adjust second control point"
              onpointerdown={(e) => startHandleDrag(e, 'p2')}
            ></button>
          </div>
        {/if}
      {/if}
    </div>

    <div>
      <canvas
        bind:this={velCanvas}
        class="h-16 w-full rounded border border-neutral-800 bg-neutral-950"
        aria-label="Velocity curve"
      ></canvas>
    </div>
  </div>
</div>
