<script>
  /**
   * Hosts a representation and applies per-view clip planes.
   * Camera-slab planes follow the Threlte camera each frame.
   *
   * Use a stable Three.Group via `<T is={root}>` — never bind:ref to $state.
   * Assigning an Object3D into $state re-renders this wrapper and remounts
   * children, which breaks Cartoon/Tube (`T is={mesh}`).
   */
  import { T, useTask, useThrelte } from '@threlte/core'
  import { Group, Plane } from 'three'
  import {
    applyClipToObject3D,
    normalizeClip,
    planesFromClip
  } from '../../lib/viewer/viewClip.js'

  /**
   * @type {{
   *   clip?: import('../../lib/viewer/viewClip.js').ViewClipConfig | null,
   *   visible?: boolean,
   *   children?: import('svelte').Snippet
   * }}
   */
  let { clip = null, visible = true, children } = $props()

  const { camera, invalidate } = useThrelte()

  const root = new Group()
  root.frustumCulled = false

  const _planes = [new Plane(), new Plane()]
  let hadClip = false
  let lastCamSig = ''

  $effect(() => {
    root.visible = visible !== false
  })

  useTask(
    () => {
      const clipNorm = normalizeClip(clip)
      if (!clipNorm.enabled) {
        if (hadClip) {
          applyClipToObject3D(root, [])
          hadClip = false
          lastCamSig = ''
          invalidate()
        }
        return
      }
      hadClip = true

      const cam = camera.current
      if (cam) cam.updateMatrixWorld(true)

      const planes = planesFromClip(clipNorm, cam, _planes)
      if (!planes.length) {
        applyClipToObject3D(root, [])
        return
      }

      // Attach / refresh materials (new meshes appear after Cartoon builds).
      applyClipToObject3D(root, planes)

      // Camera slab: mutate plane equations in place and redraw when the view moves.
      if (clipNorm.mode === 'camera' && cam) {
        const q = cam.quaternion
        const p = cam.position
        const sig = `${q.x.toFixed(4)},${q.y.toFixed(4)},${q.z.toFixed(4)},${q.w.toFixed(4)},${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)},${clipNorm.near},${clipNorm.far}`
        if (sig !== lastCamSig) {
          lastCamSig = sig
          invalidate()
        }
      }
    },
    { autoInvalidate: false }
  )
</script>

<T is={root} dispose={false}>
  {@render children?.()}
</T>
