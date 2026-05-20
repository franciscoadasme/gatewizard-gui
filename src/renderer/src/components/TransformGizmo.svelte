<script>
  import { onMount, onDestroy } from 'svelte'
  import { Vector3 } from 'three'

  /**
   * @type {{
   *   centroid: { x: number, y: number, z: number },
   *   cameraContainer: { current: import('three').Camera | null },
   *   width: number,
   *   height: number,
   *   busy?: boolean,
   *   previewActive?: boolean,
   *   onTranslate: (p: { axis: string, delta: number }) => Promise<void>,
   *   onRotate: (p: { axis: string, angle: number }) => Promise<void>,
   *   onDragMove?: (p: { type: string, axis: string, delta?: number, angle?: number }) => void,
   *   onReset: () => void,
   *   onApply: () => Promise<void>,
   * }}
   */
  let {
    centroid,
    cameraContainer,
    width,
    height,
    busy = false,
    previewActive = false,
    undoAvailable = false,
    onTranslate,
    onRotate,
    onDragMove = () => {},
    onReset,
    onApply = () => {}
  } = $props()

  const AXIS_D = 4
  const ARROW_LEN = 68
  const ARROW_HEAD = 11
  const ROT_R = { x: 46, y: 57, z: 68 }
  const ROT_STROKE = 2.8
  const APPLY_Y_OFF = -104

  let sc = $state({ x: 0, y: 0 })
  let axDirs = $state({ x: { dx: 1, dy: 0 }, y: { dx: 0, dy: -1 }, z: { dx: 0.6, dy: -0.4 } })
  let _pixPerAng = 20
  let rafId = null

  function proj(wx, wy, wz) {
    const cam = cameraContainer?.current
    if (!cam) return { x: width / 2, y: height / 2 }
    const v = new Vector3(wx, wy, wz).project(cam)
    return { x: (v.x * 0.5 + 0.5) * width, y: (1 - (v.y * 0.5 + 0.5)) * height }
  }

  function norm2D(dx, dy) {
    const l = Math.sqrt(dx * dx + dy * dy)
    return l > 0.01 ? { dx: dx / l, dy: dy / l } : { dx: 1, dy: 0 }
  }

  function tick() {
    if (cameraContainer?.current) {
      const p0 = proj(centroid.x, centroid.y, centroid.z)
      const px = proj(centroid.x + AXIS_D, centroid.y, centroid.z)
      const py = proj(centroid.x, centroid.y + AXIS_D, centroid.z)
      const pz = proj(centroid.x, centroid.y, centroid.z + AXIS_D)
      sc = p0
      axDirs = {
        x: norm2D(px.x - p0.x, px.y - p0.y),
        y: norm2D(py.x - p0.x, py.y - p0.y),
        z: norm2D(pz.x - p0.x, pz.y - p0.y)
      }
      const xDist = Math.sqrt((px.x - p0.x) ** 2 + (px.y - p0.y) ** 2)
      _pixPerAng = xDist > 0.01 ? xDist / AXIS_D : 20
    }
    rafId = requestAnimationFrame(tick)
  }

  function _onKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault()
      if (undoAvailable) onReset()
    }
  }

  onMount(() => {
    rafId = requestAnimationFrame(tick)
    window.addEventListener('keydown', _onKeyDown)
  })
  onDestroy(() => {
    if (rafId != null) cancelAnimationFrame(rafId)
    window.removeEventListener('keydown', _onKeyDown)
  })

  let drag = $state(null)

  function startDrag(type, axis, e) {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect = e.currentTarget.closest('svg')?.getBoundingClientRect() ?? { left: 0, top: 0 }
    const svgX = e.clientX - rect.left
    const svgY = e.clientY - rect.top
    drag = {
      type,
      axis,
      startX: e.clientX,
      startY: e.clientY,
      svgOffsetX: rect.left,
      svgOffsetY: rect.top,
      startSvgX: svgX,
      startSvgY: svgY,
      startAngle: Math.atan2(svgY - sc.y, svgX - sc.x),
      delta: 0,
      angle: 0
    }
  }

  function onPMove(e) {
    if (!drag) return
    if (drag.type === 'translate') {
      const dir = axDirs[drag.axis] ?? { dx: 1, dy: 0 }
      const p = (e.clientX - drag.startX) * dir.dx + (e.clientY - drag.startY) * dir.dy
      drag = { ...drag, delta: p / _pixPerAng }
      onDragMove({ type: 'translate', axis: drag.axis, delta: drag.delta })
    } else {
      const svgX = e.clientX - drag.svgOffsetX
      const svgY = e.clientY - drag.svgOffsetY
      let dA = (Math.atan2(svgY - sc.y, svgX - sc.x) - drag.startAngle) * (180 / Math.PI)
      while (dA > 180) dA -= 360
      while (dA < -180) dA += 360
      drag = { ...drag, angle: dA }
      onDragMove({ type: 'rotate', axis: drag.axis, angle: drag.angle })
    }
  }

  async function onPUp(e) {
    if (!drag) return
    const d = drag
    drag = null
    if (d.type === 'translate' && Math.abs(d.delta) > 0.005) {
      await onTranslate({ axis: d.axis, delta: d.delta })
    } else if (d.type === 'rotate' && Math.abs(d.angle) > 0.1) {
      await onRotate({ axis: d.axis, angle: d.angle })
    }
  }

  function arrowPts(ex, ey, dx, dy) {
    const px = -dy * ARROW_HEAD * 0.45
    const py = dx * ARROW_HEAD * 0.45
    const hx = ex - dx * ARROW_HEAD
    const hy = ey - dy * ARROW_HEAD
    return `${ex},${ey} ${hx + px},${hy + py} ${hx - px},${hy - py}`
  }

  const AXES = [
    { key: 'x', color: '#f05050', label: 'X' },
    { key: 'y', color: '#48c748', label: 'Y' },
    { key: 'z', color: '#5878f8', label: 'Z' }
  ]
</script>

<div
  aria-hidden="true"
  style="position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:10"
>
  <svg {width} {height} style="pointer-events:none;overflow:visible">

    <!-- ── Blender-style drag guides ──────────────────────────────────── -->
    {#if drag?.type === 'translate' && drag.axis !== 'view'}
      {@const dir = axDirs[drag.axis]}
      {@const axColor = AXES.find((a) => a.key === drag.axis)?.color ?? '#ffffff'}
      <!-- Full-viewport guide line along the active axis -->
      <line
        x1={sc.x - dir.dx * 3000}
        y1={sc.y - dir.dy * 3000}
        x2={sc.x + dir.dx * 3000}
        y2={sc.y + dir.dy * 3000}
        stroke={axColor}
        stroke-width={1}
        stroke-opacity={0.3}
        stroke-dasharray="6 4"
        style="pointer-events:none"
      />
    {/if}

    {#if drag?.type === 'rotate'}
      {@const r = ROT_R[drag.axis]}
      {@const axColor = AXES.find((a) => a.key === drag.axis)?.color ?? '#ffffff'}
      {@const startA = drag.startAngle}
      {@const endA = startA + drag.angle * (Math.PI / 180)}
      {@const lineLen = r + 28}
      <!-- Reference line: center → start-click position -->
      <line
        x1={sc.x}
        y1={sc.y}
        x2={sc.x + Math.cos(startA) * lineLen}
        y2={sc.y + Math.sin(startA) * lineLen}
        stroke={axColor}
        stroke-width={1}
        stroke-opacity={0.35}
        stroke-dasharray="4 3"
        style="pointer-events:none"
      />
      <!-- Active line: center → current angle -->
      <line
        x1={sc.x}
        y1={sc.y}
        x2={sc.x + Math.cos(endA) * lineLen}
        y2={sc.y + Math.sin(endA) * lineLen}
        stroke={axColor}
        stroke-width={1.5}
        stroke-opacity={0.8}
        style="pointer-events:none"
      />
      <!-- Rotation arc -->
      {#if Math.abs(drag.angle) > 0.5}
        {@const sxA = sc.x + Math.cos(startA) * r}
        {@const syA = sc.y + Math.sin(startA) * r}
        {@const exA = sc.x + Math.cos(endA) * r}
        {@const eyA = sc.y + Math.sin(endA) * r}
        {@const largeArc = Math.abs(drag.angle) > 180 ? 1 : 0}
        {@const sweep = drag.angle > 0 ? 1 : 0}
        <path
          d={`M ${sxA} ${syA} A ${r} ${r} 0 ${largeArc} ${sweep} ${exA} ${eyA}`}
          fill="none"
          stroke={axColor}
          stroke-width={2.5}
          stroke-opacity={0.55}
          style="pointer-events:none"
        />
      {/if}
    {/if}

    {#each AXES as ax}
      {@const r = ROT_R[ax.key]}
      {@const active = drag?.axis === ax.key && drag?.type === 'rotate'}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <circle
        cx={sc.x}
        cy={sc.y}
        {r}
        fill="none"
        stroke="transparent"
        stroke-width={16}
        style="pointer-events:all;cursor:crosshair"
        onpointerdown={(e) => startDrag('rotate', ax.key, e)}
        onpointermove={onPMove}
        onpointerup={onPUp}
      />
      <circle
        cx={sc.x}
        cy={sc.y}
        {r}
        fill="none"
        stroke={ax.color}
        stroke-width={active ? ROT_STROKE + 2 : ROT_STROKE}
        stroke-opacity={active ? 1 : 0.5}
        stroke-dasharray={active ? 'none' : '6 3'}
        style="pointer-events:none;filter:{active
          ? 'drop-shadow(0 0 6px ' + ax.color + ')'
          : 'none'}"
      />
      <text
        x={sc.x + r * 0.714 + 3}
        y={sc.y - r * 0.714 - 3}
        fill={ax.color}
        fill-opacity={0.75}
        font-size="9"
        font-weight="bold"
        font-family="monospace"
        text-anchor="start"
        dominant-baseline="auto"
        style="pointer-events:none;user-select:none">{ax.label}</text
      >
    {/each}

    {#each AXES as ax}
      {@const dir = axDirs[ax.key]}
      {@const ex = sc.x + dir.dx * ARROW_LEN}
      {@const ey = sc.y + dir.dy * ARROW_LEN}
      {@const shaftEnd = ARROW_LEN - ARROW_HEAD + 1}
      {@const active = drag?.axis === ax.key && drag?.type === 'translate'}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <line
        x1={sc.x + dir.dx * 12}
        y1={sc.y + dir.dy * 12}
        x2={sc.x + dir.dx * shaftEnd}
        y2={sc.y + dir.dy * shaftEnd}
        stroke="transparent"
        stroke-width={14}
        stroke-linecap="round"
        style="pointer-events:all;cursor:crosshair"
        onpointerdown={(e) => startDrag('translate', ax.key, e)}
        onpointermove={onPMove}
        onpointerup={onPUp}
      />
      <line
        x1={sc.x + dir.dx * 12}
        y1={sc.y + dir.dy * 12}
        x2={sc.x + dir.dx * shaftEnd}
        y2={sc.y + dir.dy * shaftEnd}
        stroke={ax.color}
        stroke-width={active ? 2.8 : 1.9}
        stroke-linecap="round"
        stroke-opacity={active ? 1 : 0.9}
        style="pointer-events:none;filter:{active
          ? 'drop-shadow(0 0 5px ' + ax.color + ')'
          : 'none'}"
      />
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <polygon
        points={arrowPts(ex, ey, dir.dx, dir.dy)}
        fill="transparent"
        style="pointer-events:all;cursor:crosshair"
        onpointerdown={(e) => startDrag('translate', ax.key, e)}
        onpointermove={onPMove}
        onpointerup={onPUp}
      />
      <polygon
        points={arrowPts(ex, ey, dir.dx, dir.dy)}
        fill={ax.color}
        fill-opacity={active ? 1 : 0.9}
        style="pointer-events:none"
      />
      <text
        x={ex + dir.dx * 11}
        y={ey + dir.dy * 11}
        fill={ax.color}
        font-size="11.5"
        font-weight="bold"
        font-family="sans-serif"
        text-anchor="middle"
        dominant-baseline="middle"
        style="pointer-events:none;user-select:none">{ax.label}</text
      >
    {/each}

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <circle
      cx={sc.x}
      cy={sc.y}
      r={11}
      fill="transparent"
      style="pointer-events:all;cursor:move"
      onpointerdown={(e) => startDrag('translate', 'view', e)}
      onpointermove={onPMove}
      onpointerup={onPUp}
    />
    <circle
      cx={sc.x}
      cy={sc.y}
      r={7.5}
      fill="white"
      fill-opacity={0.9}
      stroke="#444"
      stroke-width={1.2}
      style="pointer-events:none"
    />
    <circle cx={sc.x} cy={sc.y} r={3} fill="#1a1a1a" style="pointer-events:none" />

    {#if drag}
      {@const lbl =
        drag.type === 'translate'
          ? `${drag.axis.toUpperCase()}  ${drag.delta >= 0 ? '+' : ''}${drag.delta.toFixed(2)} Å`
          : `${drag.axis.toUpperCase()}  ${drag.angle >= 0 ? '+' : ''}${drag.angle.toFixed(1)}°`}
      <rect
        x={sc.x - 62}
        y={sc.y - 96}
        width={124}
        height={22}
        rx={6}
        fill="rgba(0,0,0,0.85)"
        stroke="rgba(255,220,0,0.25)"
        stroke-width={1}
        style="pointer-events:none"
      />
      <text
        x={sc.x}
        y={sc.y - 85}
        fill="#facc15"
        font-size="12"
        font-family="'Courier New',monospace"
        text-anchor="middle"
        dominant-baseline="middle"
        style="pointer-events:none;user-select:none">{lbl}</text
      >
    {/if}

    {#if undoAvailable && !drag}
      <!-- Undo button (also bound to Ctrl+Z via keyboard handler) -->
      <g
        role="button"
        tabindex="-1"
        style="pointer-events:all;cursor:pointer"
        onclick={onReset}
        onkeydown={(e) => e.key === 'Enter' && onReset()}
      >
        <rect
          x={sc.x - 46}
          y={sc.y + APPLY_Y_OFF}
          width={92}
          height={22}
          rx={5}
          fill="rgba(35,35,35,0.92)"
          stroke="rgba(255,255,255,0.1)"
          stroke-width={1}
        />
        <text
          x={sc.x}
          y={sc.y + APPLY_Y_OFF + 11}
          fill="#aaa"
          font-size="10.5"
          font-family="sans-serif"
          text-anchor="middle"
          dominant-baseline="middle"
          style="user-select:none">↩ Undo  (Ctrl+Z)</text
        >
      </g>
    {/if}
  </svg>
</div>
