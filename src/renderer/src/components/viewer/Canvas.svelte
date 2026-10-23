<script module>
  /** Main viewer TrackballControls — gizmo reads `.current` to snap camera. */
  export const mainViewerControls = { current: /** @type {any | null} */ (null) }
</script>

<script>
  import { Canvas as ThrelteCanvas, T } from '@threlte/core'
  import { TrackballControls } from '@threlte/extras'
  import { MOUSE, NoToneMapping, SRGBColorSpace, WebGLRenderer } from 'three'
  import { viewerSettings } from '../../lib/viewerSettings.svelte.js'
  import DepthOfFieldPass from './DepthOfFieldPass.svelte'
  import SceneBackground from './SceneBackground.svelte'
  import SceneLighting from './SceneLighting.svelte'

  /**
   * @type {{
   *   children?: import('svelte').Snippet
   *   onAtomClick?: (e: { x:number, y:number, w:number, h:number, ctrlKey?: boolean }) => void
   *   onAtomContextMenu?: (e: { x:number, y:number, w:number, h:number, clientX:number, clientY:number }) => void
   *   onAtomHover?: (e: { x:number, y:number, w:number, h:number, clientX:number, clientY:number }) => void
   *   registerAsMain?: boolean
   * }}
   */
  let {
    children,
    onAtomClick,
    onAtomContextMenu,
    onAtomHover,
    registerAsMain = true
  } = $props()

  let wrapEl = $state(null)
  let controls = $state(null)
  let resizeFrame = 0
  const pointerBox = { left: 0, top: 0, width: 0, height: 0 }

  function refreshPointerBox() {
    if (!wrapEl) return
    const r = wrapEl.getBoundingClientRect()
    pointerBox.left = r.left
    pointerBox.top = r.top
    pointerBox.width = r.width
    pointerBox.height = r.height
  }

  const ZOOM_SPEED = 3.5
  const FINE_ZOOM_SPEED = 0.4

  $effect(() => {
    if (!registerAsMain) return
    mainViewerControls.current = controls
    return () => {
      if (mainViewerControls.current === controls) {
        mainViewerControls.current = null
      }
    }
  })

  $effect(() => {
    if (!controls) return
    controls.mouseButtons.MIDDLE = MOUSE.PAN
    controls.mouseButtons.RIGHT = -1
  })

  function refreshControlsSize() {
    if (!controls) return
    controls.handleResize?.()
    controls.update?.()
  }

  $effect(() => {
    if (!wrapEl || !controls) return
    const onWheel = (e) => {
      controls.zoomSpeed = e.ctrlKey ? FINE_ZOOM_SPEED : ZOOM_SPEED
      if (e.ctrlKey) e.preventDefault()
    }
    wrapEl.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => wrapEl.removeEventListener('wheel', onWheel, { capture: true })
  })

  $effect(() => {
    if (!wrapEl || !controls || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (resizeFrame) cancelAnimationFrame(resizeFrame)
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0
        refreshPointerBox()
        refreshControlsSize()
      })
    })
    observer.observe(wrapEl)
    refreshPointerBox()
    refreshControlsSize()
    return () => {
      observer.disconnect()
      if (resizeFrame) {
        cancelAnimationFrame(resizeFrame)
        resizeFrame = 0
      }
    }
  })

  /** @type {{ x: number, y: number }} */
  let dragStart = { x: 0, y: 0 }

  function _coords(e) {
    return {
      x: e.clientX - pointerBox.left,
      y: e.clientY - pointerBox.top,
      w: pointerBox.width,
      h: pointerBox.height
    }
  }
</script>

<div
  bind:this={wrapEl}
  class="h-full w-full"
  role="presentation"
  onpointerenter={refreshPointerBox}
  onpointermove={(e) => {
    if (!onAtomHover || !wrapEl) return
    onAtomHover({ ..._coords(e), clientX: e.clientX, clientY: e.clientY })
  }}
  onpointerdown={(e) => {
    refreshPointerBox()
    refreshControlsSize()
    dragStart = { x: e.clientX, y: e.clientY }
  }}
  onpointerup={(e) => {
    if (e.button !== 0) return
    if (!onAtomClick || !wrapEl) return
    if ((e.clientX - dragStart.x) ** 2 + (e.clientY - dragStart.y) ** 2 < 16) {
      onAtomClick({ ..._coords(e), ctrlKey: e.ctrlKey })
    }
  }}
  oncontextmenu={(e) => {
    e.preventDefault()
    if (!onAtomContextMenu || !wrapEl) return
    onAtomContextMenu({ ..._coords(e), clientX: e.clientX, clientY: e.clientY })
  }}
>
  <ThrelteCanvas
    createRenderer={(canvas) => {
      const renderer = new WebGLRenderer({
        canvas,
        powerPreference: 'high-performance',
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true
      })
      // Required for per-representation clip planes (ViewClipApply).
      renderer.outputColorSpace = SRGBColorSpace
      renderer.toneMapping = NoToneMapping
      renderer.localClippingEnabled = true
      if (import.meta.env?.DEV) {
        renderer.debug.checkShaderErrors = true
      }
      return renderer
    }}
  >
    <SceneBackground />

    <T.OrthographicCamera makeDefault manual near={0.05} far={500000} />

    <TrackballControls
      bind:ref={controls}
      staticMoving={false}
      dynamicDampingFactor={0.3}
      rotateSpeed={3.5}
      zoomSpeed={ZOOM_SPEED}
    />

    <SceneLighting />

    {@render children?.()}

    {#if viewerSettings.dof?.enabled}
      <DepthOfFieldPass />
    {/if}
  </ThrelteCanvas>
</div>
