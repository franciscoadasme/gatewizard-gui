<script>
  import { T, useRenderer, useTask } from '@threlte/core'
  import {
    InstancedMesh,
    Matrix4,
    MeshBasicMaterial,
    SphereGeometry
  } from 'three'

  /**
   * @type {{
   *   visible?: boolean
   *   ghostWaters?: boolean
   *   ghostPoints?: [number, number, number][] | null
   * }}
   */
  let {
    visible = false,
    ghostWaters = false,
    ghostPoints = null
  } = $props()

  const { autoRenderTask } = useRenderer()

  let ghostMesh = $state(/** @type {InstancedMesh | null} */ (null))

  $effect(() => {
    if (!visible || !ghostWaters || !ghostPoints?.length) {
      ghostMesh = null
      return
    }
    const positions = ghostPoints
    const sphere = new SphereGeometry(0.22, 6, 6)
    const mat = new MeshBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.35 })
    const mesh = new InstancedMesh(sphere, mat, positions.length)
    const m = new Matrix4()
    positions.forEach(([x, y, z], i) => {
      m.makeTranslation(x, y, z)
      mesh.setMatrixAt(i, m)
    })
    mesh.instanceMatrix.needsUpdate = true
    ghostMesh = mesh
    return () => {
      sphere.dispose()
      mat.dispose()
      ghostMesh = null
    }
  })
</script>

{#if visible && ghostMesh}
  <T is={ghostMesh} />
{/if}
