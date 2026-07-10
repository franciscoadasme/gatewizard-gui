<script>
  import { onDestroy, onMount } from 'svelte'
  import { mainViewerCamera } from './CameraRig.svelte'
  import { mainViewerControls } from './Canvas.svelte'
  import {
    applyHydrationBoxDrag,
    beginHydrationBoxDrag,
    projectHydrationBox
  } from '../../lib/viewer/hydrationBoxManipulator.js'
  import { axisColor } from '../../lib/viewer/axisColors.js'

  /**
   * @type {{
   *   visible?: boolean
   *   boxMin?: [number, number, number]
   *   boxMax?: [number, number, number]
   *   width?: number
   *   height?: number
   *   onBoxChange?: (min: number[], max: number[]) => void
   *   onDragEnd?: () => void
   * }}
   */
  let {
    visible = false,
    boxMin = [0, 0, 0],
    boxMax = [1, 1, 1],
    width = 0,
    height = 0,
    onBoxChange = () => {},
    onDragEnd = () => {}
  } = $props()

  let svgEl = $state(/** @type {SVGSVGElement | null} */ (null))
  let layout = $state({ edges: [], handles: [], faces: [], pixPerAng: 1 })
  /** @type {object | null} */
  let drag = $state(null)
  /** @type {Element | null} */
  let captureEl = null
  let rafId = 0

  function refreshLayout() {
    const cam = mainViewerCamera.current
    if (!cam || !visible || !width || !height) {
      layout = { edges: [], handles: [], faces: [], pixPerAng: 1 }
      return
    }
    layout = projectHydrationBox(cam, width, height, boxMin, boxMax)
  }

  function tick() {
    refreshLayout()
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
    if (!drag || !svgEl) return
    const cam = mainViewerCamera.current
    if (!cam) return
    const rect = svgEl.getBoundingClientRect()
    const next = applyHydrationBoxDrag(drag, cam, rect, e.clientX, e.clientY)
    if (next) onBoxChange(next.min, next.max)
    e.preventDefault()
  }

  /** @param {PointerEvent} e */
  function onWindowPointerUp(e) {
    endDrag(e)
  }

  /** @param {PointerEvent} [e] */
  function endDrag(e) {
    if (!drag) return
    drag = null
    if (mainViewerControls.current) mainViewerControls.current.enabled = true
    onDragEnd()
    if (captureEl && e) {
      try {
        captureEl.releasePointerCapture(e.pointerId)
      } catch {
        /* already released */
      }
    }
    captureEl = null
    window.removeEventListener('pointermove', onWindowPointerMove)
    window.removeEventListener('pointerup', onWindowPointerUp)
    window.removeEventListener('pointercancel', onWindowPointerUp)
  }

  /**
   * @param {{ mode: string, axis: string, side: string }} pick
   * @param {PointerEvent} e
   */
  function startDrag(pick, e) {
    if (!visible || drag || !svgEl) return
    const cam = mainViewerCamera.current
    if (!cam) return
    const rect = svgEl.getBoundingClientRect()
    const state = beginHydrationBoxDrag(pick, cam, rect, e.clientX, e.clientY, boxMin, boxMax)
    if (!state) return
    drag = state
    captureEl = e.currentTarget
    if (mainViewerControls.current) mainViewerControls.current.enabled = false
    captureEl.setPointerCapture(e.pointerId)
    window.addEventListener('pointermove', onWindowPointerMove)
    window.addEventListener('pointerup', onWindowPointerUp)
    window.addEventListener('pointercancel', onWindowPointerUp)
    e.preventDefault()
    e.stopPropagation()
  }
</script>

{#if visible && width > 0 && height > 0}
  <svg
    bind:this={svgEl}
    class="pointer-events-none absolute inset-0 z-20 h-full w-full"
    viewBox="0 0 {width} {height}"
    role="presentation"
    aria-hidden="true"
  >
    {#each layout.edges as edge, i (i)}
      <line
        x1={edge.a.x}
        y1={edge.a.y}
        x2={edge.b.x}
        y2={edge.b.y}
        stroke="#fbbf24"
        stroke-width="2"
        vector-effect="non-scaling-stroke"
        opacity="0.95"
      />
    {/each}

    {#each layout.faces as face (`${face.axis}-${face.side}`)}
      <polygon
        points={face.pts.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="#38bdf8"
        fill-opacity="0.06"
        stroke="none"
        role="button"
        tabindex="-1"
        aria-label="Move hydration box ({face.axis} {face.side} face)"
        class="pointer-events-auto cursor-move touch-none"
        onpointerdown={(e) =>
          startDrag({ mode: 'translate', axis: face.axis, side: face.side }, e)}
      />
    {/each}

    {#each layout.handles as h (`${h.axis}-${h.side}`)}
      {@const col = axisColor(h.axis)}
      <rect
        x={h.scr.x - 7}
        y={h.scr.y - 7}
        width="14"
        height="14"
        rx="2"
        fill={col}
        stroke="#ffffff"
        stroke-width="1.5"
        vector-effect="non-scaling-stroke"
        role="button"
        tabindex="-1"
        aria-label="Resize hydration box along {h.axis} ({h.side})"
        class="pointer-events-auto cursor-nwse-resize touch-none"
        onpointerdown={(e) => startDrag({ mode: 'resize', axis: h.axis, side: h.side }, e)}
      />
    {/each}
  </svg>
{/if}
