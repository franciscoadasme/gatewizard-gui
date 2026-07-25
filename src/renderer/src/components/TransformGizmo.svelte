<script>
  import { onMount, onDestroy } from 'svelte'
  import { Vector3 } from 'three'
  import { VIEWER_AXES as AXES } from '../lib/viewer/axisColors.js'

  /**
   * @type {{
   *   centroid: { x: number, y: number, z: number },
   *   cameraContainer: { current: import('three').Camera | null },
   *   width: number,
   *   height: number,
   *   busy?: boolean,
   *   previewActive?: boolean,
   *   undoAvailable?: boolean,
   *   onTranslate: (p: { axis: string, delta: number }) => Promise<void>,
   *   onRotate: (p: { axis: string, angle: number }) => Promise<void>,
   *   onDragMove?: (p: { type: string, axis: string, delta?: number, angle?: number }) => void,
   *   onReset: () => void,
   *   onApply?: () => Promise<void>,
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

  // ── Constants ──────────────────────────────────────────────────────────────
  const AXIS_D = 4
  const ARROW_LEN = 120
  const ARROW_HEAD = 17
  /** Screen-pixel target radius for each rotation ring. */
  const ROT_R = { x: 62, y: 76, z: 90 }
  const ROT_STROKE = 2.5
  const ROT_N = 64 // sample points per ring
  const APPLY_Y_OFF = -130

  /**
   * Ring tangent basis [u, v]: the ring lies in span(u, v); normal = u × v = rotation axis.
   *   x-ring → YZ plane   y-ring → ZX plane   z-ring → XY plane
   */
  const RING_BASIS = {
    x: [
      [0, 1, 0],
      [0, 0, 1]
    ],
    y: [
      [0, 0, 1],
      [1, 0, 0]
    ],
    z: [
      [1, 0, 0],
      [0, 1, 0]
    ]
  }

  // ── Reactive state ─────────────────────────────────────────────────────────
  let sc = $state({ x: 0, y: 0 })
  let axDirs = $state({ x: { dx: 1, dy: 0 }, y: { dx: 0, dy: -1 }, z: { dx: 0.6, dy: -0.4 } })
  /** Screen-space projected ring points. Each element: { x, y, front }. */
  let ringPts = $state({ x: [], y: [], z: [] })
  let _pixPerAng = 20
  let rafId = null

  let drag = $state(null)
  /** Currently hovered element: { type: 'rotate'|'translate', axis } | null. Cleared during drag. */
  let hovered = $state(null)

  // ── Projection helpers ─────────────────────────────────────────────────────
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

  // ── 3D ring computation ────────────────────────────────────────────────────
  function computeRingPts() {
    const cam = cameraContainer?.current
    if (!cam || _pixPerAng < 0.01) return
    const camFwd = new Vector3(0, 0, -1).applyQuaternion(cam.quaternion)
    const res = {}
    for (const axis of ['x', 'y', 'z']) {
      const [[ux, uy, uz], [vx, vy, vz]] = RING_BASIS[axis]
      const R = ROT_R[axis] / _pixPerAng // world-unit radius
      const pts = []
      for (let i = 0; i <= ROT_N; i++) {
        const t = (i / ROT_N) * 2 * Math.PI
        const ct = Math.cos(t),
          st = Math.sin(t)
        const sp = proj(
          centroid.x + (ux * ct + vx * st) * R,
          centroid.y + (uy * ct + vy * st) * R,
          centroid.z + (uz * ct + vz * st) * R
        )
        // Front-facing: outward ring-point normal has positive dot with camera forward
        const dot =
          (ux * ct + vx * st) * camFwd.x +
          (uy * ct + vy * st) * camFwd.y +
          (uz * ct + vz * st) * camFwd.z
        // dot > 0 means normal aligns WITH camFwd (pointing away from viewer) = back half.
        // dot < 0 means normal opposes camFwd (pointing toward viewer) = front half.
        pts.push({ x: sp.x, y: sp.y, front: dot < 0 })
      }
      res[axis] = pts
    }
    ringPts = res
  }

  // ── Animation frame ────────────────────────────────────────────────────────
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
      // Use the LARGEST screen-space axis projection so that when any axis
      // points toward the camera its near-zero length doesn't blow up ring radii.
      const dX = Math.sqrt((px.x - p0.x) ** 2 + (px.y - p0.y) ** 2)
      const dY = Math.sqrt((py.x - p0.x) ** 2 + (py.y - p0.y) ** 2)
      const dZ = Math.sqrt((pz.x - p0.x) ** 2 + (pz.y - p0.y) ** 2)
      _pixPerAng = Math.max(dX, dY, dZ, 0.5) / AXIS_D
      computeRingPts()
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

  // ── Drag handling ──────────────────────────────────────────────────────────
  function startDrag(type, axis, e) {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect = e.currentTarget.closest('svg')?.getBoundingClientRect() ?? { left: 0, top: 0 }
    const svgX = e.clientX - rect.left
    const svgY = e.clientY - rect.top
    hovered = null
    // For rotation: record which ring point was clicked so the sweep arc
    // can trace the actual projected ring polyline (not a flat screen circle).
    let startRingIdx = 0
    if (type === 'rotate') {
      const pts = ringPts[axis] ?? []
      let bestDist = Infinity
      for (let i = 0; i < pts.length - 1; i++) {
        const dx = svgX - pts[i].x,
          dy = svgY - pts[i].y
        const d = dx * dx + dy * dy
        if (d < bestDist) {
          bestDist = d
          startRingIdx = i
        }
      }
    }
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
      lastRawAngle: Math.atan2(svgY - sc.y, svgX - sc.x),
      startRingIdx,
      delta: 0,
      angle: 0,
      _rawAngle: 0,
      snapStep: null
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
      // Incremental accumulation on _rawAngle (continuous, unbounded) avoids atan2 wrap.
      const rawAngle = Math.atan2(svgY - sc.y, svgX - sc.x)
      let delta = (rawAngle - drag.lastRawAngle) * (180 / Math.PI)
      while (delta > 180) delta -= 360
      while (delta < -180) delta += 360
      const newRawAngle = (drag._rawAngle ?? 0) + delta
      // Three snap zones based on mouse distance vs ring pixel radius:
      //   d < 55% R  → snap 45°  (inner ticks, toward centre)
      //   d < 145% R → snap  5°  (outer ticks, ring area)
      //   d ≥ 145% R → free continuous
      const d = Math.sqrt((svgX - sc.x) ** 2 + (svgY - sc.y) ** 2)
      const R = ROT_R[drag.axis]
      let snapStep = null
      if (d < R * 0.55) snapStep = 45
      else if (d < R * 1.45) snapStep = 5
      const newAngle = snapStep ? Math.round(newRawAngle / snapStep) * snapStep : newRawAngle
      drag = { ...drag, _rawAngle: newRawAngle, angle: newAngle, lastRawAngle: rawAngle, snapStep }
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

  // ── SVG path helpers ───────────────────────────────────────────────────────
  function arrowPts(ex, ey, dx, dy) {
    const px = -dy * ARROW_HEAD * 0.45
    const py = dx * ARROW_HEAD * 0.45
    const hx = ex - dx * ARROW_HEAD
    const hy = ey - dy * ARROW_HEAD
    return `${ex},${ey} ${hx + px},${hy + py} ${hx - px},${hy - py}`
  }

  /**
   * Front or back arc segments of a projected ring.
   * Handles the wraparound case where a segment spans the pts[0]/pts[N] junction.
   */
  function ringSegPath(pts, wantFront) {
    if (!pts.length) return ''
    const n = pts.length - 1 // pts[ROT_N] === pts[0] — closed loop, skip duplicate
    // Start at first back→front (or front→back) transition for correct wraparound
    let startI = 0
    for (let i = 0; i < n; i++) {
      if (pts[i].front !== wantFront && pts[(i + 1) % n].front === wantFront) {
        startI = (i + 1) % n
        break
      }
    }
    const segs = []
    let seg = null
    for (let _i = 0; _i < n; _i++) {
      const i = (startI + _i) % n
      const p = pts[i]
      if (p.front === wantFront) {
        if (!seg) seg = []
        seg.push(p)
      } else {
        if (seg) {
          segs.push(seg)
          seg = null
        }
      }
    }
    if (seg) segs.push(seg)
    return segs
      .map((s) =>
        s.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
      )
      .join(' ')
  }

  /**
   * Full closed ring outline path for hit testing.
   * Using pointer-events:stroke makes only the thick outline (±9px) respond,
   * not the entire filled disc — so X and Y rings are independently reachable.
   */
  function ringHitPath(pts) {
    if (!pts.length) return ''
    return (
      pts
        .slice(0, -1)
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        .join(' ') + 'Z'
    )
  }

  /**
   * Drag-sweep arc that follows the actual projected ring polyline.
   * Direction is determined by comparing the ring's tangent at startI to the
   * clockwise-perpendicular of the radial direction — works for all axes and
   * camera orientations.
   */
  function ringArcPath(pts, startI, angleDeg) {
    if (!pts.length || Math.abs(angleDeg) < 0.5) return ''
    const n = pts.length - 1
    const steps = Math.min(Math.round((Math.abs(angleDeg) / 360) * n), n - 1)
    if (steps < 1) return ''
    // Determine traversal direction from ring tangent vs clockwise screen direction.
    const p0 = pts[startI]
    const p1 = pts[(startI + 1) % n]
    const dtx = p1.x - p0.x,
      dty = p1.y - p0.y
    const radX = p0.x - sc.x,
      radY = p0.y - sc.y
    // CW perpendicular in screen space (Y-down): rotating (radX,radY) by +90° CW
    // gives (-radY, radX).  This equals the 2D cross product: dty*radX - dtx*radY.
    const dotCW = dty * radX - dtx * radY
    const ringCWiseFwd = dotCW > 0
    const wantCW = angleDeg > 0
    const forward = wantCW === ringCWiseFwd
    const seg = []
    for (let k = 0; k <= steps; k++) {
      const i = forward ? (startI + k) % n : (startI - k + n) % n
      seg.push(pts[i])
    }
    return seg.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  }

  /**
   * Interpolated ring point at a specific rotation angle (degrees).
   * Uses linear interpolation between the two nearest sampled ring points.
   */
  function ringPointAtAngle(pts, angleDeg) {
    const n = pts.length - 1
    if (n < 1) return { x: sc.x, y: sc.y }
    const idx = ((((angleDeg / 360) * n) % n) + n) % n
    const i = Math.floor(idx)
    const frac = idx - i
    const p0 = pts[i]
    const p1 = pts[(i + 1) % n]
    return { x: p0.x + (p1.x - p0.x) * frac, y: p0.y + (p1.y - p0.y) * frac }
  }

  /** SVG path for 45° snap ticks — 8 ticks drawn INWARD from the ring. */
  function ticks45Path(pts) {
    if (!pts.length) return ''
    return [0, 45, 90, 135, 180, 225, 270, 315]
      .map((theta) => {
        const tp = ringPointAtAngle(pts, theta)
        const dx = tp.x - sc.x,
          dy = tp.y - sc.y
        const l = Math.sqrt(dx * dx + dy * dy) || 1
        const nx = dx / l,
          ny = dy / l
        return `M${(tp.x - nx * 12).toFixed(1)},${(tp.y - ny * 12).toFixed(1)}L${(tp.x - nx * 2).toFixed(1)},${(tp.y - ny * 2).toFixed(1)}`
      })
      .join(' ')
  }

  /** SVG path for 5° snap ticks — 64 ticks drawn OUTWARD from the ring (45° positions excluded). */
  function ticks5Path(pts) {
    if (!pts.length) return ''
    const segs = []
    for (let theta = 0; theta < 360; theta += 5) {
      if (theta % 45 === 0) continue
      const tp = ringPointAtAngle(pts, theta)
      const dx = tp.x - sc.x,
        dy = tp.y - sc.y
      const l = Math.sqrt(dx * dx + dy * dy) || 1
      const nx = dx / l,
        ny = dy / l
      segs.push(
        `M${(tp.x + nx * 2).toFixed(1)},${(tp.y + ny * 2).toFixed(1)}L${(tp.x + nx * 7).toFixed(1)},${(tp.y + ny * 7).toFixed(1)}`
      )
    }
    return segs.join(' ')
  }

  // Hover helpers — ignored while a drag is in progress
  function setHov(type, axis) {
    if (!drag) hovered = { type, axis }
  }
  function clrHov(type, axis) {
    if (!drag && hovered?.type === type && hovered?.axis === axis) hovered = null
  }
</script>

<div
  aria-hidden="true"
  style="position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:10"
>
  <svg {width} {height} style="pointer-events:none;overflow:visible">
    <!-- ══════════════════════════════════════════════════════════════════ -->
    <!--  DRAG GUIDES                                                       -->
    <!-- ══════════════════════════════════════════════════════════════════ -->

    {#if drag?.type === 'translate' && drag.axis !== 'view'}
      {@const dir = axDirs[drag.axis]}
      {@const axColor = AXES.find((a) => a.key === drag.axis)?.color ?? '#fff'}
      <line
        x1={sc.x - dir.dx * 3000}
        y1={sc.y - dir.dy * 3000}
        x2={sc.x + dir.dx * 3000}
        y2={sc.y + dir.dy * 3000}
        stroke={axColor}
        stroke-width={2.5}
        stroke-opacity={0.6}
        stroke-dasharray="10 6"
        style="pointer-events:none"
      />
    {/if}

    {#if drag?.type === 'rotate'}
      {@const r = ROT_R[drag.axis]}
      {@const axColor = AXES.find((a) => a.key === drag.axis)?.color ?? '#fff'}
      {@const startA = drag.startAngle}
      {@const endA = startA + drag.angle * (Math.PI / 180)}
      {@const lineLen = r + 30}
      <line
        x1={sc.x}
        y1={sc.y}
        x2={sc.x + Math.cos(startA) * lineLen}
        y2={sc.y + Math.sin(startA) * lineLen}
        stroke={axColor}
        stroke-width={2}
        stroke-opacity={0.6}
        stroke-dasharray="5 3"
        style="pointer-events:none"
      />
      <line
        x1={sc.x}
        y1={sc.y}
        x2={sc.x + Math.cos(endA) * lineLen}
        y2={sc.y + Math.sin(endA) * lineLen}
        stroke={axColor}
        stroke-width={2.8}
        stroke-opacity={0.95}
        style="pointer-events:none"
      />
      {#if Math.abs(drag.angle) > 0.5}
        {@const arcD = ringArcPath(ringPts[drag.axis] ?? [], drag.startRingIdx ?? 0, drag.angle)}
        {#if arcD}
          <path
            d={arcD}
            fill="none"
            stroke={axColor}
            stroke-width={3.5}
            stroke-opacity={0.8}
            style="pointer-events:none"
          />
        {/if}
      {/if}
    {/if}

    <!-- ══════════════════════════════════════════════════════════════════ -->
    <!--  3D ROTATION RINGS                                                -->
    <!--                                                                   -->
    <!--  Each ring is sampled as N points on a 3D circle, projected to   -->
    <!--  screen.  Front-facing half = solid bright arc; back = faint      -->
    <!--  dashed arc.  Hit area uses pointer-events:stroke so ONLY the    -->
    <!--  ring outline (±9 px band) responds — not the full disc.          -->
    <!--  This is the key fix: X (r=46) and Y (r=57) are now reachable    -->
    <!--  even though Z (r=68) is rendered last (on top in SVG).           -->
    <!-- ══════════════════════════════════════════════════════════════════ -->
    {#each AXES as ax}
      {@const pts = ringPts[ax.key] ?? []}
      {@const active = drag?.axis === ax.key && drag?.type === 'rotate'}
      {@const isHov = !drag && hovered?.type === 'rotate' && hovered.axis === ax.key}

      {#if pts.length > 0}
        <!-- Snap tick marks.
             45° ticks (inward, 8 marks): mouse inside 55% of ring radius → 45° snap.
             5° ticks (outward, 64 marks): mouse in ring area 55–145% R → 5° snap.
             Mouse beyond 145% R: free continuous rotation. -->
        <path
          d={ticks45Path(pts)}
          fill="none"
          stroke={ax.color}
          stroke-width={1.5}
          stroke-opacity={active || isHov ? 0.75 : 0.45}
          stroke-linecap="round"
          style="pointer-events:none"
        />
        <path
          d={ticks5Path(pts)}
          fill="none"
          stroke={ax.color}
          stroke-width={1}
          stroke-opacity={active || isHov ? 0.55 : 0.3}
          stroke-linecap="round"
          style="pointer-events:none"
        />
        <!-- Back arc: faint dashed -->
        <path
          d={ringSegPath(pts, false)}
          fill="none"
          stroke={ax.color}
          stroke-width={ROT_STROKE * 0.85}
          stroke-opacity={0.18}
          stroke-dasharray="3 4"
          style="pointer-events:none"
        />
        <!-- Front arc: solid, highlights on hover / active -->
        <path
          d={ringSegPath(pts, true)}
          fill="none"
          stroke={ax.color}
          stroke-width={active || isHov ? ROT_STROKE + 1.5 : ROT_STROKE}
          stroke-opacity={active ? 1 : isHov ? 0.95 : 0.65}
          style="pointer-events:none;filter:{active || isHov
            ? `drop-shadow(0 0 5px ${ax.color})`
            : 'none'}"
        />
        <!-- Invisible hit path.  pointer-events:stroke → only the ring         -->
        <!-- outline responds, not the interior disc.  Fixes X/Y unreachability. -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <path
          d={ringHitPath(pts)}
          fill="none"
          stroke="transparent"
          stroke-width={18}
          style="pointer-events:stroke;cursor:crosshair"
          onpointerenter={() => setHov('rotate', ax.key)}
          onpointerleave={() => clrHov('rotate', ax.key)}
          onpointerdown={(e) => startDrag('rotate', ax.key, e)}
          onpointermove={onPMove}
          onpointerup={onPUp}
        />
      {/if}
    {/each}

    <!-- ══════════════════════════════════════════════════════════════════ -->
    <!--  ROTATION AXIS INDICATOR  (shown during hover AND drag)           -->
    <!--  Rendered AFTER rings so it appears on top of them in SVG order.  -->
    <!--  Dashed line through gizmo center along the axis direction —       -->
    <!--  represents the rotation axis (perpendicular to the ring plane).  -->
    <!-- ══════════════════════════════════════════════════════════════════ -->
    {#if hovered?.type === 'rotate' || drag?.type === 'rotate'}
      {@const axisKey = drag?.type === 'rotate' ? drag.axis : hovered.axis}
      {@const dir = axDirs[axisKey]}
      {@const col = AXES.find((a) => a.key === axisKey)?.color ?? '#fff'}
      <line
        x1={sc.x - dir.dx * 3000}
        y1={sc.y - dir.dy * 3000}
        x2={sc.x + dir.dx * 3000}
        y2={sc.y + dir.dy * 3000}
        stroke={col}
        stroke-width={2}
        stroke-opacity={0.55}
        stroke-dasharray="8 5"
        style="pointer-events:none"
      />
    {/if}

    <!-- ══════════════════════════════════════════════════════════════════ -->
    <!--  TRANSLATE ARROWS                                                  -->
    <!-- ══════════════════════════════════════════════════════════════════ -->
    {#each AXES as ax}
      {@const dir = axDirs[ax.key]}
      {@const ex = sc.x + dir.dx * ARROW_LEN}
      {@const ey = sc.y + dir.dy * ARROW_LEN}
      {@const shaftEnd = ARROW_LEN - ARROW_HEAD + 1}
      {@const active = drag?.axis === ax.key && drag?.type === 'translate'}
      {@const isHov = !drag && hovered?.type === 'translate' && hovered.axis === ax.key}

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
        onpointerenter={() => setHov('translate', ax.key)}
        onpointerleave={() => clrHov('translate', ax.key)}
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
        stroke-width={active || isHov ? 3 : 2}
        stroke-linecap="round"
        stroke-opacity={active || isHov ? 1 : 0.88}
        style="pointer-events:none;filter:{active || isHov
          ? `drop-shadow(0 0 5px ${ax.color})`
          : 'none'}"
      />
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <polygon
        points={arrowPts(ex, ey, dir.dx, dir.dy)}
        fill="transparent"
        style="pointer-events:all;cursor:crosshair"
        onpointerenter={() => setHov('translate', ax.key)}
        onpointerleave={() => clrHov('translate', ax.key)}
        onpointerdown={(e) => startDrag('translate', ax.key, e)}
        onpointermove={onPMove}
        onpointerup={onPUp}
      />
      <polygon
        points={arrowPts(ex, ey, dir.dx, dir.dy)}
        fill={ax.color}
        fill-opacity={active || isHov ? 1 : 0.88}
        style="pointer-events:none;filter:{active || isHov
          ? `drop-shadow(0 0 5px ${ax.color})`
          : 'none'}"
      />
      <text
        x={ex + dir.dx * 11}
        y={ey + dir.dy * 11}
        fill={ax.color}
        font-size="11.5"
        font-weight="bold"
        font-family="Roboto, sans-serif"
        text-anchor="middle"
        dominant-baseline="middle"
        style="pointer-events:none;user-select:none">{ax.label}</text
      >
    {/each}

    <!-- ══════════════════════════════════════════════════════════════════ -->
    <!--  CENTER DOT  (view-plane translate)                               -->
    <!-- ══════════════════════════════════════════════════════════════════ -->
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

    <!-- ══════════════════════════════════════════════════════════════════ -->
    <!--  DRAG LABEL                                                        -->
    <!-- ══════════════════════════════════════════════════════════════════ -->
    {#if drag}
      {@const _dispDeg = ((drag.angle % 360) + 360) % 360}
      {@const lbl =
        drag.type === 'translate'
          ? `${drag.axis.toUpperCase()}  ${drag.delta >= 0 ? '+' : ''}${drag.delta.toFixed(2)} Å`
          : `${drag.axis.toUpperCase()}  ${_dispDeg.toFixed(drag.snapStep ? 0 : 1)}°${drag.snapStep ? `  ·${drag.snapStep}°` : ''}`}
      <rect
        x={sc.x - 68}
        y={sc.y - 96}
        width={136}
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

    <!-- ══════════════════════════════════════════════════════════════════ -->
    <!--  UNDO BUTTON                                                       -->
    <!-- ══════════════════════════════════════════════════════════════════ -->
    {#if undoAvailable && !drag}
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
          font-family="Roboto, sans-serif"
          text-anchor="middle"
          dominant-baseline="middle"
          style="user-select:none">↩ Undo (Ctrl+Z)</text
        >
      </g>
    {/if}
  </svg>
</div>
