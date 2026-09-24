<script>
  import { T, useTask, useThrelte } from '@threlte/core'
  import {
    BackSide,
    Color,
    InstancedBufferAttribute,
    InstancedMesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    MeshToonMaterial,
    SphereGeometry
  } from 'three'
  import { defaultColorScheme } from '../../../lib/colorSchemes.js'
  import { getToonGradientMap } from '../../../lib/viewer/goodsellMaterial.js'
  import { applyGlowMaterial } from '../../../lib/viewer/glowMaterial.js'
  import { untrack } from 'svelte'
  import {
    collectAtomIndices,
    writeInstanceTranslationScale
  } from '../../../lib/viewer/trajectoryFrames.js'
  import { blendPlayXyz, trajPlayClock } from '../../../lib/viewer/trajPlayClock.js'

  /** @typedef {{ x: number, y: number, z: number, element: string, name: string }} Atom */
  /** @typedef {(atom: Atom) => import('three').Color} ColorScheme */

  /** Approximate van der Waals radii (Å). */
  const VDW = {
    H: 1.2,
    C: 1.7,
    N: 1.55,
    O: 1.52,
    F: 1.47,
    P: 1.8,
    S: 1.8,
    CL: 1.75,
    BR: 1.83,
    I: 1.98,
    FE: 1.94,
    ZN: 1.39,
    NA: 2.27,
    MG: 1.73,
    CA: 1.97,
    K: 2.75,
    SE: 1.9
  }
  const DEFAULT_VDW = 1.7

  /**
   * @param {string} el
   * @returns {number}
   */
  function vdwRadius(el) {
    const k = String(el || 'C')
      .trim()
      .toUpperCase()
      .slice(0, 2)
    if (VDW[k] !== undefined) return VDW[k]
    if (k.length >= 1 && VDW[k[0]] !== undefined) return VDW[k[0]]
    return DEFAULT_VDW
  }

  /** Sphere widthSegments × heightSegments per quality level (1–5). */
  const VDW_SPHERE_Q = {
    1: [16, 12],
    2: [32, 24],
    3: [48, 32],
    4: [96, 64],
    5: [160, 96]
  }

  /**
   * @type {{atoms: Atom[], xyz?: Float32Array | null, xyzEpoch?: number, trajSmooth?: number, trajSmoothRestoreH?: boolean, getColor?: ColorScheme, quality?: number, atomScale?: number, metalness?: number, roughness?: number, emissiveIntensity?: number, renderOrder?: number, depthTest?: boolean, opacity?: number, outline?: boolean, goodsell?: boolean, outlinesEnabled?: boolean, outlineColor?: string, outlineWidth?: number, glowBulb?: boolean}}
   */
  let {
    atoms = [],
    xyz = null,
    xyzEpoch = 0,
    trajSmooth = 0,
    trajSmoothRestoreH = true,
    getColor = defaultColorScheme,
    quality = 3,
    atomScale = 1.0,
    metalness = 0.12,
    roughness = 0.45,
    emissiveIntensity = 0.0,
    renderOrder = 0,
    depthTest = true,
    opacity = 1.0,
    outline = false,
    goodsell = false,
    outlinesEnabled = true,
    outlineColor = '#000000',
    outlineWidth = 0.12,
    highlightIndices = new Set(),
    glowBulb = false
  } = $props()

  const { invalidate } = useThrelte()

  const count = $derived(atoms.length)

  let meshRef = $state(/** @type {InstancedMesh | null} */ (null))
  let outlineMeshRef = $state(/** @type {InstancedMesh | null} */ (null))
  /** @type {Atom[] | null} */
  let radiusAtoms = null
  let radiusScale = NaN
  /** @type {Float32Array | null} */
  let radiiCache = null
  /** @type {Float32Array | null} */
  let outlineRadiiCache = null

  /**
   * @param {Atom[]} arr
   * @param {boolean} outline
   */
  function radiiFor(arr, outline) {
    if (
      arr === radiusAtoms &&
      radiusScale === atomScale &&
      radiiCache &&
      (!outline || outlineRadiiCache)
    ) {
      return outline ? outlineRadiiCache : radiiCache
    }
    radiusAtoms = arr
    radiusScale = atomScale
    const n = arr.length
    const r = new Float32Array(n)
    const or = outline ? new Float32Array(n) : null
    for (let i = 0; i < n; i++) {
      const rad = vdwRadius(arr[i].element) * atomScale
      r[i] = rad
      if (or) or[i] = rad * (1 + outlineWidth / Math.max(rad, 0.5))
    }
    radiiCache = r
    outlineRadiiCache = or
    return outline ? or : r
  }

  /**
   * @param {Float32Array} dest
   * @param {Atom[]} arr
   * @param {Float32Array | null | undefined} packed
   * @param {Float32Array} radii
   */
  function writeVdwMatrices(dest, arr, packed, radii) {
    const n = arr.length
    for (let i = 0; i < n; i++) {
      const atom = arr[i]
      const base = typeof atom.index === 'number' ? atom.index * 3 : i * 3
      if (packed && base + 2 < packed.length) {
        writeInstanceTranslationScale(dest, i, packed[base], packed[base + 1], packed[base + 2], radii[i])
      } else {
        writeInstanceTranslationScale(dest, i, atom.x, atom.y, atom.z, radii[i])
      }
    }
  }

  $effect(() => {
    const n = count
    if (n < 1) {
      meshRef = null
      outlineMeshRef = null
      return
    }

    const [ws, hs] = VDW_SPHERE_Q[quality] ?? VDW_SPHERE_Q[3]
    const geometry = new SphereGeometry(1, ws, hs)

    /** @type {import('three').Material} */
    let material
    if (goodsell) {
      material = new MeshToonMaterial({ gradientMap: getToonGradientMap() })
    } else {
      const mat = new MeshStandardMaterial({
        metalness,
        roughness,
        emissiveIntensity: glowBulb ? 0 : emissiveIntensity,
        transparent: opacity < 1,
        opacity,
        depthTest,
        ...(outline ? { side: BackSide } : {})
      })
      if (glowBulb && emissiveIntensity > 0.001) {
        applyGlowMaterial(mat, emissiveIntensity, { useSurfaceColor: true })
      }
      material = mat
    }

    const mesh = new InstancedMesh(geometry, material, n)
    mesh.renderOrder = renderOrder
    // Unit-sphere geometry would cull the whole cloud when the origin leaves the view.
    mesh.frustumCulled = false
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(n * 3), 3)

    const showOutlines = goodsell && outlinesEnabled && outlineWidth > 0
    /** @type {InstancedMesh | null} */
    let outlineMesh = null
    if (showOutlines) {
      const outlineMat = new MeshBasicMaterial({
        color: outlineColor,
        depthWrite: false
      })
      outlineMesh = new InstancedMesh(geometry.clone(), outlineMat, n)
      outlineMesh.renderOrder = renderOrder - 1
      outlineMesh.frustumCulled = false
    }

    const atomList = untrack(() => atoms)
    const packed = untrack(() => xyz)
    const dest = mesh.instanceMatrix.array
    if (dest instanceof Float32Array) {
      writeVdwMatrices(dest, atomList, packed, radiiFor(atomList, false) ?? new Float32Array(atomList.length))
    }
    const outlineDest = outlineMesh?.instanceMatrix.array
    const outlineRadii = outlineMesh ? radiiFor(atomList, true) : null
    if (outlineMesh && outlineDest instanceof Float32Array && outlineRadii) {
      writeVdwMatrices(outlineDest, atomList, packed, outlineRadii)
    }
    const outlineCol = outlineMesh ? new Color(outlineColor) : null
    atomList.forEach((atom, index) => {
      mesh.setColorAt(index, untrack(() => getColor(atom)))
      if (outlineMesh && outlineCol) outlineMesh.setColorAt(index, outlineCol)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor.needsUpdate = true
    if (outlineMesh) {
      outlineMesh.instanceMatrix.needsUpdate = true
    }

    meshRef = mesh
    outlineMeshRef = outlineMesh
    invalidate()

    return () => {
      mesh.dispose()
      outlineMesh?.dispose()
      meshRef = null
      outlineMeshRef = null
    }
  })

  /** @type {Atom[] | null} */
  let playIdxAtoms = null
  /** @type {Int32Array | null} */
  let playIdx = null

  /** @param {Atom[]} arr */
  function playIndices(arr) {
    if (arr === playIdxAtoms) return playIdx
    playIdxAtoms = arr
    playIdx = collectAtomIndices(arr)
    return playIdx
  }

  /**
   * @param {Atom[]} arr
   * @param {Float32Array | null | undefined} packed
   */
  function uploadVdw(arr, packed) {
    const mesh = meshRef
    if (!mesh || arr.length !== mesh.count) return
    const dest = mesh.instanceMatrix.array
    if (!(dest instanceof Float32Array)) return
    writeVdwMatrices(dest, arr, packed, radiiFor(arr, false) ?? new Float32Array(arr.length))
    const outlineMesh = outlineMeshRef
    const outlineDest = outlineMesh?.instanceMatrix.array
    if (outlineMesh && outlineDest instanceof Float32Array) {
      const or = radiiFor(arr, true)
      if (or) writeVdwMatrices(outlineDest, arr, packed, or)
      outlineMesh.instanceMatrix.needsUpdate = true
    }
    mesh.instanceMatrix.needsUpdate = true
    invalidate()
  }

  $effect(() => {
    void xyzEpoch
    void xyz
    if (trajPlayClock.playing) return
    uploadVdw(atoms, xyz)
  })

  useTask(() => {
    if (!trajPlayClock.playing) return
    const arr = untrack(() => atoms)
    uploadVdw(arr, blendPlayXyz(trajSmooth, playIndices(arr), trajSmoothRestoreH !== false))
  })

  const _tmpHL = new Color()

  $effect(() => {
    const mesh = untrack(() => meshRef)
    if (!mesh) return

    const arr = untrack(() => atoms)
    const hi = highlightIndices
    const n = arr.length
    for (let index = 0; index < n; index++) {
      const atom = arr[index]
      const color = getColor(atom)
      if (hi.size > 0 && hi.has(atom.index)) {
        _tmpHL.setRGB(
          Math.min(1, color.r * 1.5 + 0.4),
          Math.min(1, color.g * 1.5 + 0.4),
          Math.min(1, color.b * 1.5 + 0.4)
        )
        mesh.setColorAt(index, _tmpHL)
      } else {
        mesh.setColorAt(index, color)
      }
    }
    mesh.instanceColor.needsUpdate = true
    invalidate()
  })

  $effect(() => {
    const mesh = untrack(() => meshRef)
    const outlineMesh = untrack(() => outlineMeshRef)
    const op = opacity
    for (const m of [mesh, outlineMesh]) {
      if (!m) continue
      const mat = m.material
      if (Array.isArray(mat)) continue
      mat.opacity = op
      mat.transparent = op < 1
      if ('depthWrite' in mat) mat.depthWrite = op >= 1
      mat.needsUpdate = true
    }
    invalidate()
  })
</script>

{#if outlineMeshRef}
  <T is={outlineMeshRef} />
{/if}
{#if meshRef}
  <T is={meshRef} />
{/if}
