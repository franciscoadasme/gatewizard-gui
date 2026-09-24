<script>
  import { onDestroy, untrack } from 'svelte'
  import { T, useTask, useThrelte } from '@threlte/core'
  import { Color, DoubleSide, Mesh, MeshStandardMaterial } from 'three'
  import { createCartoonSkin, updateRibbonSkins } from '../../../lib/viewer/cartoon.js'
  import { collectAtomIndices } from '../../../lib/viewer/trajectoryFrames.js'
  import { blendPlayXyz, trajPlayClock } from '../../../lib/viewer/trajPlayClock.js'
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
   *   helixWidth?: number,
   *   sheetWidth?: number,
   *   coilWidth?: number,
   *   getColor?: (atom: any) => import('three').Color,
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
   *   opacity?: number,
   *   xyz?: Float32Array | null,
   *   xyzEpoch?: number
   *   trajSmooth?: number
   *   trajSmoothRestoreH?: boolean
   * }}
   */
  let {
    atoms,
    xyz = null,
    xyzEpoch = 0,
    trajSmooth = 0,
    trajSmoothRestoreH = true,
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

  /** @type {import('../../../lib/viewer/cartoon.js').RibbonSkin[]} */
  let surfaceSkin = []
  /** @type {import('../../../lib/viewer/cartoon.js').RibbonSkin[]} */
  let outlineSkin = []

  $effect(() => {
    if (!atoms?.length || !residues?.length) {
      surfaceSkin = []
      outlineSkin = []
      meshes = []
      return
    }

    const surfaceMat = goodsell ? goodsellMaterial : material
    const showOutlines = goodsell && outlinesEnabled && outlineWidth > 0
    const outlineMat = showOutlines ? createSilhouetteOutlineMaterial(outlineColor) : null
    const packed = untrack(() => xyz)

    /** @type {Mesh[]} */
    const nextMeshes = []
    /** @type {import('../../../lib/viewer/cartoon.js').RibbonSkin[]} */
    let nextSurface = []
    /** @type {import('../../../lib/viewer/cartoon.js').RibbonSkin[]} */
    let nextOutline = []

    try {
      nextSurface = createCartoonSkin(atoms, residues, _effectiveGetColor, {
        helixWidth,
        sheetWidth,
        coilWidth,
        ssColors,
        quality
      })
      if (packed) updateRibbonSkins(nextSurface, packed, atoms)

      if (showOutlines && outlineMat) {
        const grow = outlineWidth * 0.9
        const outlineColorForGeom = new Color(outlineColor)
        const outlineColorFn = () => outlineColorForGeom
        nextOutline = createCartoonSkin(atoms, residues, outlineColorFn, {
          helixWidth: helixWidth + grow,
          sheetWidth: sheetWidth + grow * (sheetWidth / helixWidth),
          coilWidth: coilWidth + grow * (coilWidth / helixWidth),
          ssColors,
          quality
        })
        if (packed) updateRibbonSkins(nextOutline, packed, atoms)
        for (const skin of nextOutline) {
          const outlineMesh = new Mesh(skin.geometry, outlineMat)
          outlineMesh.renderOrder = 0
          outlineMesh.frustumCulled = false
          nextMeshes.push(outlineMesh)
        }
      }

      for (const skin of nextSurface) {
        const surfaceMesh = new Mesh(skin.geometry, surfaceMat)
        surfaceMesh.renderOrder = 1
        surfaceMesh.frustumCulled = false
        nextMeshes.push(surfaceMesh)
      }
    } catch (err) {
      console.error('[Cartoon] geometry build failed:', err)
      surfaceSkin = []
      outlineSkin = []
      meshes = []
      return
    }

    surfaceSkin = nextSurface
    outlineSkin = nextOutline
    meshes = nextMeshes
    invalidate()

    return () => {
      for (const m of nextMeshes) {
        m.geometry.dispose()
      }
      outlineMat?.dispose()
      if (surfaceSkin === nextSurface) surfaceSkin = []
      if (outlineSkin === nextOutline) outlineSkin = []
    }
  })

  /** @type {typeof atoms | null} */
  let playIdxAtoms = null
  /** @type {Int32Array | null} */
  let playIdx = null

  /** @param {typeof atoms} arr */
  function playIndices(arr) {
    if (arr === playIdxAtoms) return playIdx
    playIdxAtoms = arr
    playIdx = collectAtomIndices(arr)
    return playIdx
  }

  /**
   * @param {Float32Array | null | undefined} packed
   * @param {typeof atoms} arr
   */
  function uploadRibbon(packed, arr) {
    const surface = surfaceSkin
    const outline = outlineSkin
    if (!surface.length) return
    updateRibbonSkins(surface, packed, arr)
    if (outline.length) updateRibbonSkins(outline, packed, arr)
    invalidate()
  }

  $effect(() => {
    void xyzEpoch
    void xyz
    if (trajPlayClock.playing) return
    uploadRibbon(xyz, atoms)
  })

  useTask(() => {
    if (!trajPlayClock.playing) return
    const arr = untrack(() => atoms)
    uploadRibbon(blendPlayXyz(trajSmooth, playIndices(arr), trajSmoothRestoreH !== false), arr)
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
