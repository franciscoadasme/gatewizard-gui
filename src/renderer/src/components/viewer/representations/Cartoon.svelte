<script>
  import { onDestroy } from 'svelte'
  import { T, useThrelte } from '@threlte/core'
  import { Color, DoubleSide, Mesh, MeshStandardMaterial } from 'three'
  import { buildCartoonGeometries } from '../../../lib/viewer/cartoon.js'
  import { defaultColorScheme } from '../../../lib/colorSchemes.js'
  import {
    createIllustrativeSurfaceMaterial,
    createSilhouetteOutlineMaterial
  } from '../../../lib/viewer/illustrativeMaterial.js'

  /**
   * @type {{
   *   atoms: { x: number, y: number, z: number, name: string, index?: number }[],
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
   *   emissiveIntensity?: number,
   *   illustrative?: boolean,
   *   outlinesEnabled?: boolean,
   *   outlineColor?: string,
   *   outlineWidth?: number
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
    illustrative = false,
    outlinesEnabled = true,
    outlineColor = '#000000',
    outlineWidth = 0.12,
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

  const illustrativeMaterial = createIllustrativeSurfaceMaterial(true)
  illustrativeMaterial.side = DoubleSide

  /** @type {Mesh[]} */
  let meshes = $state([])

  $effect(() => {
    if (illustrative) return
    material.metalness = metalness
    material.roughness = roughness
    material.emissiveIntensity = emissiveIntensity
    material.emissive.setHex(0x000000)
    material.toneMapped = true
    material.needsUpdate = true
    invalidate()
  })

  $effect(() => {
    if (!atoms?.length || !residues?.length) {
      meshes = []
      return
    }

    const surfaceMat = illustrative ? illustrativeMaterial : material
    const showOutlines = illustrative && outlinesEnabled && outlineWidth > 0
    const outlineMat = showOutlines ? createSilhouetteOutlineMaterial(outlineColor) : null

    /** @type {Mesh[]} */
    const nextMeshes = []

    try {
      const geometries = buildCartoonGeometries(atoms, residues, _effectiveGetColor, {
        helixWidth,
        sheetWidth,
        coilWidth,
        ssColors,
        quality
      })

      if (showOutlines && outlineMat) {
        const grow = outlineWidth * 0.9
        const outlineColorForGeom = new Color(outlineColor)
        const outlineColorFn = () => outlineColorForGeom
        const outlineGeometries = buildCartoonGeometries(atoms, residues, outlineColorFn, {
          helixWidth: helixWidth + grow,
          sheetWidth: sheetWidth + grow * (sheetWidth / helixWidth),
          coilWidth: coilWidth + grow * (coilWidth / helixWidth),
          ssColors,
          quality
        })
        for (const geom of outlineGeometries) {
          const outlineMesh = new Mesh(geom, outlineMat)
          outlineMesh.renderOrder = 0
          nextMeshes.push(outlineMesh)
        }
      }

      for (const geom of geometries) {
        const surfaceMesh = new Mesh(geom, surfaceMat)
        surfaceMesh.renderOrder = 1
        nextMeshes.push(surfaceMesh)
      }
    } catch (err) {
      console.error('[Cartoon] geometry build failed:', err)
      meshes = []
      return
    }

    meshes = nextMeshes
    invalidate()

    return () => {
      for (const m of nextMeshes) {
        m.geometry.dispose()
      }
      outlineMat?.dispose()
    }
  })

  onDestroy(() => {
    meshes = []
    material.dispose()
    illustrativeMaterial.dispose()
  })
</script>

{#each meshes as mesh (mesh.uuid)}
  <T is={mesh} />
{/each}
