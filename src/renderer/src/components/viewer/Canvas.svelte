<script module>
  /** Main viewer TrackballControls — gizmo reads `.current` to snap camera. */
  export const mainViewerControls = { current: /** @type {any | null} */ (null) }
</script>

<script>
  import { Canvas as ThrelteCanvas, T } from '@threlte/core'
  import { TrackballControls } from '@threlte/extras'
  import { MOUSE, WebGLRenderer } from 'three'
  import { goodsellLightingState } from '../../lib/goodsellSceneLighting.svelte.js'
  import { viewerSettings } from '../../lib/viewerSettings.svelte.js'
  import SceneBackground from './SceneBackground.svelte'

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

  $effect(() => {
    if (!controls) return
    controls.mouseButtons.MIDDLE = MOUSE.PAN
    controls.mouseButtons.RIGHT = -1
  })

  /** @type {{ x: number, y: number }} */
  let dragStart = { x: 0, y: 0 }

  const hemisphereSky = $derived(viewerSettings.hemisphereSky)
  const hemisphereGround = $derived(viewerSettings.hemisphereGround)
  const hemisphereIntensity = $derived(viewerSettings.hemisphereIntensity)
  const ambientIntensity = $derived(viewerSettings.ambientIntensity)
  const directionalLights = $derived(viewerSettings.directionalLights)
  const dirLightMultiplier = $derived(goodsellLightingState.active ? 0.35 : 1)

  function _coords(e) {
    const r = wrapEl.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height }
  }
</script>

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
      zoomSpeed={3.5}
    />

    <T.HemisphereLight args={[hemisphereSky, hemisphereGround, hemisphereIntensity]} />

    <T.AmbientLight intensity={ambientIntensity} />

    {#each directionalLights as light, i (i)}
      {#if light.enabled}
        <T.DirectionalLight position={light.position} intensity={light.intensity * dirLightMultiplier} />
      {/if}
    {/each}

    {@render children?.()}
  </ThrelteCanvas>
</div>
