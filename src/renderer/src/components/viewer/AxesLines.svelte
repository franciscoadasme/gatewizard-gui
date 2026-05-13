<script>
  import { T, useRenderer, useTask, useThrelte, useThrelteUserContext } from '@threlte/core'
  import { get } from 'svelte/store'
  import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments, Vector3 } from 'three'

  /** @type {{ length?: number }} Half-length of each axis segment from the origin (same convention as `AxesHelper`). */
  let { length = 5 } = $props()

  const controlsNamespace = useThrelteUserContext('threlte-controls')
  const { camera } = useThrelte()
  const { autoRenderTask } = useRenderer()
  const viewDir = new Vector3()

  let lines = $state(/** @type {LineSegments | null} */ (null))

  $effect(() => {
    const s = length
    const positions = new Float32Array([0, 0, 0, s, 0, 0, 0, 0, 0, 0, s, 0, 0, 0, 0, 0, 0, s])
    const colors = new Float32Array([1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1])
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    geometry.setAttribute('color', new BufferAttribute(colors, 3))

    const material = new LineBasicMaterial({ vertexColors: true, toneMapped: false })
    const mesh = new LineSegments(geometry, material)
    lines = mesh

    return () => {
      geometry.dispose()
      material.dispose()
      lines = null
    }
  })

  useTask(
    () => {
      const L = lines
      if (!L) return

      const ctx = controlsNamespace ? get(controlsNamespace) : undefined
      const ctrl =
        (ctx?.trackballControls && get(ctx.trackballControls)) ||
        (ctx?.orbitControls && get(ctx.orbitControls)) ||
        undefined

      if (ctrl?.target) {
        L.position.copy(ctrl.target)
        return
      }

      const cam = camera.current
      if (cam) {
        cam.getWorldDirection(viewDir)
        L.position.copy(cam.position).addScaledVector(viewDir, 12)
      }
    },
    { running: () => !!lines, before: autoRenderTask }
  )
</script>

{#if lines}
  <T is={lines} />
{/if}
