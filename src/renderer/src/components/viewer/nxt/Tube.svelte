<script>
  import { onDestroy, untrack } from 'svelte'
  import { T, useThrelte } from '@threlte/core'
  import { Color, DoubleSide, Mesh, MeshStandardMaterial } from 'three'
  import { buildTubeGeometries } from '../../../lib/viewer/cartoon.js'
  import { defaultColorScheme } from '../../../lib/colorSchemes.js'
  import {
    createGoodsellSurfaceMaterial,
    createSilhouetteOutlineMaterial
  } from '../../../lib/viewer/goodsellMaterial.js'

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
   *   getColor?: (atom: any) => import('three').Color,
   *   tubeRadius?: number,
   *   ssColors?: Record<string, string> | null,
   *   quality?: number,
   *   metalness?: number,
   *   roughness?: number,
   *   emissiveIntensity?: number,
   *   goodsell?: boolean,
   *   outlinesEnabled?: boolean,
   *   outlineColor?: string,
   *   outlineColor?: string,
   *   outlineWidth?: number,
   *   opacity?: number
   * }}
   */
  let {
    atoms,
    residues = [],
    getColor = defaultColorScheme,
    tubeRadius = 0.9,
    ssColors = null,
    quality = 3,
    metalness = 0.08,
    roughness = 0.48,
    emissiveIntensity = 0.0,
    goodsell = false,
    outlinesEnabled = true,
    outlineColor = '#000000',
    outlineWidth = 0.12,
    highlightIndices = new Set(),
    opacity = 1.0
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

  const goodsellMaterial = createGoodsellSurfaceMaterial(true)
  goodsellMaterial.side = DoubleSide

  /** @type {Mesh[]} */
  let meshes = $state([])

  $effect(() => {
    if (goodsell) return
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

    const surfaceMat = goodsell ? goodsellMaterial : material
    const showOutlines = goodsell && outlinesEnabled && outlineWidth > 0
    const outlineMat = showOutlines ? createSilhouetteOutlineMaterial(outlineColor) : null

    /** @type {Mesh[]} */
    const nextMeshes = []

    try {
      const geometries = buildTubeGeometries(atoms, residues, _effectiveGetColor, {
        tubeRadius,
        ssColors,
        quality
      })

      if (showOutlines && outlineMat) {
        const outlineColorForGeom = new Color(outlineColor)
        const outlineColorFn = () => outlineColorForGeom
        const outlineGeometries = buildTubeGeometries(atoms, residues, outlineColorFn, {
          tubeRadius: tubeRadius + outlineWidth,
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
      console.error('[Tube] geometry build failed:', err)
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
    goodsellMaterial.dispose()
  })

  $effect(() => {
    const op = opacity
    for (const mat of [material, goodsellMaterial]) {
      mat.opacity = op
      mat.transparent = op < 1
      mat.depthWrite = op >= 1
      mat.needsUpdate = true
    }
    for (const mesh of untrack(() => meshes)) {
      const mat = mesh.material
      if (Array.isArray(mat)) continue
      mat.opacity = op
      mat.transparent = op < 1
      if ('depthWrite' in mat) mat.depthWrite = op >= 1
      mat.needsUpdate = true
    }
    invalidate()
  })
</script>

{#each meshes as mesh (mesh.uuid)}
  <T is={mesh} />
{/each}
