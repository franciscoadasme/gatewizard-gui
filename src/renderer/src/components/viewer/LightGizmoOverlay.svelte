<script>
  import { onDestroy, onMount } from 'svelte'
  import { Vector3 } from 'three'
  import { mainViewerCamera } from './CameraRig.svelte'
  import { mainViewerControls } from './Canvas.svelte'
  import { viewerSettings } from '../../lib/viewerSettings.svelte.js'

  /**
   * Screen-space markers for world-fixed directional lights.
   * Drag a marker to move that light; XYZ fields in Scene rendering stay in sync.
   * @type {{
   *   visible?: boolean
   *   width?: number
   *   height?: number
   *   selectedIndex?: number | null
   *   onSelect?: (index: number) => void
   * }}
   */
  let {
    visible = true,
    width = 0,
    height = 0,
    selectedIndex = null,
    onSelect = () => {}
  } = $props()

  /** @type {{ index: number, x: number, y: number, color: string, enabled: boolean }[]} */
  let markers = $state([])

  /** @type {null | { index: number, startClientX: number, startClientY: number, origin: [number, number, number], right: Vector3, up: Vector3, pixPerAng: number }} */
  let drag = $state(null)

  const _v = new Vector3()

  function project(wx, wy, wz) {
    const cam = mainViewerCamera.current
    if (!cam || !width || !height) return { x: width / 2, y: height / 2, ok: false }
    _v.set(wx, wy, wz).project(cam)
    if (!Number.isFinite(_v.x) || !Number.isFinite(_v.y)) return { x: 0, y: 0, ok: false }
    return {
      x: (_v.x * 0.5 + 0.5) * width,
      y: (1 - (_v.y * 0.5 + 0.5)) * height,
      ok: _v.z > -1 && _v.z < 1
    }
  }

  function refresh() {
    if (!visible || viewerSettings.lightMode !== 'world') {
      markers = []
      return
    }
    markers = viewerSettings.directionalLights.map((l, index) => {
      const [x, y, z] = l.position
      const p = project(x, y, z)
      return {
        index,
        x: p.x,
        y: p.y,
        color: l.color || '#ffffff',
        enabled: l.enabled !== false && p.ok
      }
    })
  }

  let rafId = 0
  function tick() {
    refresh()
    rafId = requestAnimationFrame(tick)
  }

  onMount(() => {
    rafId = requestAnimationFrame(tick)
  })

  onDestroy(() => {
    cancelAnimationFrame(rafId)
    endDrag()
  })

  /** @param {PointerEvent} e */
  function onWindowPointerMove(e) {
    if (!drag) return
    const dx = e.clientX - drag.startClientX
    const dy = e.clientY - drag.startClientY
    const scale = drag.pixPerAng > 0.01 ? 1 / drag.pixPerAng : 0.05
    const nx = drag.origin[0] + drag.right.x * dx * scale - drag.up.x * dy * scale
    const ny = drag.origin[1] + drag.right.y * dx * scale - drag.up.y * dy * scale
    const nz = drag.origin[2] + drag.right.z * dx * scale - drag.up.z * dy * scale
    const lights = viewerSettings.directionalLights.map((l, i) =>
      i === drag.index
        ? {
            ...l,
            position: /** @type {[number, number, number]} */ ([nx, ny, nz])
          }
        : l
    )
    viewerSettings.directionalLights = lights
    e.preventDefault()
  }

  function endDrag() {
    if (!drag) return
    drag = null
    if (mainViewerControls.current) mainViewerControls.current.enabled = true
    window.removeEventListener('pointermove', onWindowPointerMove)
    window.removeEventListener('pointerup', endDrag)
    window.removeEventListener('pointercancel', endDrag)
  }

  /**
   * @param {PointerEvent} e
   * @param {number} index
   */
  function startDrag(e, index) {
    if (e.button !== 0) return
    const cam = mainViewerCamera.current
    const light = viewerSettings.directionalLights[index]
    if (!cam || !light) return
    e.preventDefault()
    e.stopPropagation()
    onSelect(index)

    const right = new Vector3(1, 0, 0).applyQuaternion(cam.quaternion).normalize()
    const up = new Vector3(0, 1, 0).applyQuaternion(cam.quaternion).normalize()
    // Approximate Å per screen pixel from projected unit length
    const a = project(light.position[0], light.position[1], light.position[2])
    const b = project(
      light.position[0] + right.x,
      light.position[1] + right.y,
      light.position[2] + right.z
    )
    const pixPerAng = Math.max(0.5, Math.hypot(b.x - a.x, b.y - a.y))

    drag = {
      index,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origin: /** @type {[number, number, number]} */ ([...light.position]),
      right,
      up,
      pixPerAng
    }
    if (mainViewerControls.current) mainViewerControls.current.enabled = false
    window.addEventListener('pointermove', onWindowPointerMove)
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
    try {
      e.currentTarget instanceof Element &&
        e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }
</script>

{#if visible && viewerSettings.lightMode === 'world' && width > 0 && height > 0}
  <svg
    class="pointer-events-none absolute inset-0 z-[18] overflow-visible"
    width={width}
    height={height}
    aria-hidden="true"
  >
    {#each markers as m (m.index)}
      {#if m.enabled}
        <g
          class="pointer-events-auto cursor-grab active:cursor-grabbing"
          transform="translate({m.x}, {m.y})"
          onpointerdown={(e) => startDrag(e, m.index)}
          role="button"
          tabindex="-1"
          aria-label="Directional light {m.index + 1}"
        >
          <circle
            r={selectedIndex === m.index ? 11 : 9}
            fill={m.color}
            stroke={selectedIndex === m.index ? '#facc15' : '#0a0a0a'}
            stroke-width={selectedIndex === m.index ? 2.5 : 1.5}
            opacity="0.92"
          />
          <circle r="2.5" fill="#0a0a0a" opacity="0.7" />
          <text
            y="-14"
            text-anchor="middle"
            class="select-none fill-white text-[10px] font-semibold"
            style="paint-order: stroke; stroke: #000; stroke-width: 3px"
          >L{m.index + 1}</text
          >
        </g>
      {/if}
    {/each}
  </svg>
{/if}
