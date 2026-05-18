<script>
  import { T, useThrelte } from '@threlte/core'
  import { DoubleSide, Mesh, MeshStandardMaterial } from 'three'
  import { buildTubeGeometries } from '../../../lib/viewer/cartoon.js'
  import { defaultColorScheme } from '../../../lib/colorSchemes.js'

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
   *   getColor?: (atom: any) => import('three').Color,
   *   tubeRadius?: number,
   *   ssColors?: Record<string, string> | null,
   *   quality?: number,
   *   metalness?: number,
   *   roughness?: number,
   *   emissiveIntensity?: number
   * }}
   */
  let {
    atoms = [],
    residues = [],
    getColor = defaultColorScheme,
    tubeRadius = 0.9,
    ssColors = null,
    quality = 3,
    metalness = 0.08,
    roughness = 0.48,
    emissiveIntensity = 0.0
  } = $props()

  const { invalidate } = useThrelte()

  const material = new MeshStandardMaterial({
    vertexColors: true,
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

    const geometries = buildTubeGeometries(atoms, residues, getColor, {
      tubeRadius,
      ssColors,
      quality
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
