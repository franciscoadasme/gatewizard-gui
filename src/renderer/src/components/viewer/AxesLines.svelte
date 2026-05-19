<script>
  import { T, useRenderer, useTask } from '@threlte/core'
  import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments } from 'three'

  /**
   * @type {{
   *   length?: number
   *   center?: { x: number, y: number, z: number } | null
   * }}
   * `center` pins the axes to the molecule centroid so pan doesn't visually displace them.
   */
  let { length = 5, center = null } = $props()

  const { autoRenderTask } = useRenderer()

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
      // Always draw at an explicit center, or at world origin (0,0,0).
      // Never follow ctrl.target so the axes stay fixed during pan.
      if (center) {
        L.position.set(center.x, center.y, center.z)
      } else {
        L.position.set(0, 0, 0)
      }
    },
    { running: () => !!lines, before: autoRenderTask }
  )
</script>

{#if lines}
  <T is={lines} />
{/if}
