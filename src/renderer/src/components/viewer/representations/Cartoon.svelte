<script>
  import { T, useThrelte } from '@threlte/core'
  import { Color, DoubleSide, Mesh, MeshStandardMaterial } from 'three'
  import { buildCartoonGeometries } from '../../../lib/viewer/cartoon.js'
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
   *   helixWidth?: number,
   *   sheetWidth?: number,
   *   coilWidth?: number,
   *   getColor?: (atom: any) => import('three').Color,
   *   ssColors?: Record<string, string> | null,
   *   quality?: number,
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
    getColor = defaultColorScheme,
    ssColors = null,
    quality = 3,
    metalness = 0.08,
    roughness = 0.48,
    emissiveIntensity = 0.0,
    highlightIndices = new Set()
  } = $props()

  const { invalidate } = useThrelte()

  const _tmpHL = new Color()
  const _effectiveGetColor = $derived(
    highlightIndices.size === 0
      ? getColor
      : (atom) => {
          const c = getColor(atom)
          if (highlightIndices.has(atom.index)) {
            return _tmpHL.setRGB(
              Math.min(1, c.r * 1.5 + 0.4),
              Math.min(1, c.g * 1.5 + 0.4),
              Math.min(1, c.b * 1.5 + 0.4)
            )
          }
          return c
        }
  )

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

    const geometries = buildCartoonGeometries(atoms, residues, _effectiveGetColor, {
      helixWidth,
      sheetWidth,
      coilWidth,
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
