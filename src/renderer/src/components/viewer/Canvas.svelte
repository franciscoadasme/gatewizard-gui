<script module>
  /** Main viewer TrackballControls — gizmo reads `.current` to snap camera. */
  export const mainViewerControls = { current: /** @type {any | null} */ (null) }
</script>

<script>
  import { Canvas as ThrelteCanvas, T } from '@threlte/core'
  import { TrackballControls } from '@threlte/extras'
  import { MOUSE, WebGLRenderer } from 'three'

  /**
   * @type {{
   *   children?: import('svelte').Snippet
   *   onAtomClick?: (e: { x:number, y:number, w:number, h:number }) => void
   *   onAtomContextMenu?: (e: { x:number, y:number, w:number, h:number, clientX:number, clientY:number }) => void
   *   onAtomHover?: (e: { x:number, y:number, w:number, h:number, clientX:number, clientY:number }) => void
   * }}
   */
  let { children, onAtomClick, onAtomContextMenu, onAtomHover } = $props()

  let wrapEl = $state(null)
  let controls = $state(null)

  $effect(() => {
    mainViewerControls.current = controls
    return () => {
      mainViewerControls.current = null
    }
  })

  // Middle-drag pans the camera view (slides camera+target together).
  // Atoms are never moved — this is pure camera navigation, like VMD T-mode.
  $effect(() => {
    if (!controls) return
    controls.mouseButtons.MIDDLE = MOUSE.PAN
    controls.mouseButtons.RIGHT = -1
  })
  /** @type {{ x: number, y: number }} */
  let dragStart = { x: 0, y: 0 }

  function _coords(e) {
    const r = wrapEl.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height }
  }
</script>

<!--
  Wrapper div captures pointer events without breaking TrackballControls:
  - pointerdown records start; pointerup fires click only if pointer moved < 4 px (not a drag)
  - contextmenu forwards to parent with canvas-local coords
-->
<div
  bind:this={wrapEl}
  class="h-full w-full"
  role="presentation"
  onpointermove={(e) => {
    if (!onAtomHover || !wrapEl) return
    onAtomHover({ ..._coords(e), clientX: e.clientX, clientY: e.clientY })
  }}
  onpointerdown={(e) => {
    dragStart = { x: e.clientX, y: e.clientY }
  }}
  onpointerup={(e) => {
    if (e.button !== 0) return
    if (!onAtomClick || !wrapEl) return
    if ((e.clientX - dragStart.x) ** 2 + (e.clientY - dragStart.y) ** 2 < 16) {
      onAtomClick(_coords(e))
    }
  }}
  oncontextmenu={(e) => {
    e.preventDefault()
    if (!onAtomContextMenu || !wrapEl) return
    onAtomContextMenu({ ..._coords(e), clientX: e.clientX, clientY: e.clientY })
  }}
>
  <ThrelteCanvas
    createRenderer={(canvas) =>
      new WebGLRenderer({
        canvas,
        powerPreference: 'high-performance',
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true
      })}
  >
    <T.Color attach="background" args={[0x000000]} />
    <T.OrthographicCamera makeDefault manual near={0.05} far={500000} />
    <TrackballControls
      bind:ref={controls}
      staticMoving={false}
      dynamicDampingFactor={0.3}
      rotateSpeed={3.5}
      zoomSpeed={3.5}
    />
    <T.HemisphereLight args={['#c4d2e8', '#0c0e12', 0.52]} />
    <T.AmbientLight intensity={0.35} />
    <T.DirectionalLight position={[7, 11, 9]} intensity={0.42} />
    <T.DirectionalLight position={[-9, 6, -7]} intensity={0.34} />
    {@render children?.()}
  </ThrelteCanvas>
</div>
