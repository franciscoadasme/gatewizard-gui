<script>
  import { T, useThrelte } from '@threlte/core'
  import { DoubleSide, Mesh, MeshStandardMaterial } from 'three'
  import { buildCartoonGeometries } from '../../../lib/viewer/cartoon.js'

  /**
   * @type {{
   *   atoms: { x: number, y: number, z: number, name: string }[],
   *   residues: Array<{
   *     chain: string,
   *     number: number,
   *     insertion?: string,
   *     atom_indices: number[],
   *     ca_index?: number,
   *     sec?: string
   *   }>
   * }}
   */
  let { atoms, residues = [] } = $props()

  const { invalidate } = useThrelte()

  const material = new MeshStandardMaterial({
    vertexColors: true,
    metalness: 0.08,
    roughness: 0.48,
    side: DoubleSide
  })

  /** @type {Mesh[]} */
  let meshes = $state([])

  $effect(() => {
    if (!atoms?.length || !residues?.length) {
      meshes = []
      return
    }

    const geometries = buildCartoonGeometries(atoms, residues)
    const newMeshes = geometries.map((geom) => new Mesh(geom, material))

    meshes = newMeshes
    invalidate()

    return () => {
      newMeshes.forEach((m) => m.geometry.dispose())
    }
  })

  $effect(() => () => material.dispose())
</script>

{#each meshes as mesh (mesh.uuid)}
  <T is={mesh} />
{/each}
