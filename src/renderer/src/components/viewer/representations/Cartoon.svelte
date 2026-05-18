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
   *   }>,
   *   helixWidth?: number,
   *   sheetWidth?: number,
   *   coilWidth?: number,
   *   ssColors?: Record<string, string> | null,
   *   metalness?: number,
   *   roughness?: number,
   *   emissiveIntensity?: number
   * }}
   */
  let {
    atoms,
    residues = [],
    helixWidth = 1.0,
    sheetWidth = 0.875,
    coilWidth = 0.125,
    ssColors = null,
    metalness = 0.08,
    roughness = 0.48,
    emissiveIntensity = 0.0
  } = $props()

  const { invalidate } = useThrelte()

  const material = new MeshStandardMaterial({
    vertexColors: true,
    metalness,
    roughness,
    side: DoubleSide
  })

  /** @type {Mesh[]} */
  let meshes = $state([])

  $effect(() => {
    material.metalness = metalness
    material.roughness = roughness
    material.emissiveIntensity = emissiveIntensity
    material.needsUpdate = true
    invalidate()
  })

  $effect(() => {
    if (!atoms?.length || !residues?.length) {
      meshes = []
      return
    }

    const geometries = buildCartoonGeometries(atoms, residues, {
      helixWidth,
      sheetWidth,
      coilWidth,
      ssColors
    })
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
