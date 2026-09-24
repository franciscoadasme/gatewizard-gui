<script>
  import { T, useTask, useThrelte } from '@threlte/core'
  import {
    BufferAttribute,
    BufferGeometry,
    Color,
    Points,
    PointsMaterial
  } from 'three'
  import { defaultColorScheme } from '../../../lib/colorSchemes.js'
  import { untrack } from 'svelte'
  import { collectAtomIndices, writePointPositions } from '../../../lib/viewer/trajectoryFrames.js'
  import { blendPlayXyz, trajPlayClock } from '../../../lib/viewer/trajPlayClock.js'

  /** @typedef {{ x: number, y: number, z: number, element: string, name: string, index?: number }} Atom */
  /** @typedef {(atom: Atom) => import('three').Color} ColorScheme */

  /**
   * Lightweight atom representation: one GPU point per atom (no spheres/meshes).
   * @type {{
   *   atoms?: Atom[]
   *   getColor?: ColorScheme
   *   pointSize?: number
   *   atomScale?: number
   *   renderOrder?: number
   *   depthTest?: boolean
   *   opacity?: number
   *   highlightIndices?: Set<number>
   *   xyzEpoch?: number
   *   trajSmooth?: number
   *   trajSmoothRestoreH?: boolean
   * }}
   */
  let {
    atoms = [],
    xyz = null,
    xyzEpoch = 0,
    trajSmooth = 0,
    trajSmoothRestoreH = true,
    getColor = defaultColorScheme,
    pointSize = 3,
    atomScale = 1.0,
    renderOrder = 0,
    depthTest = true,
    opacity = 1.0,
    highlightIndices = new Set()
  } = $props()

  const { invalidate } = useThrelte()

  let pointsRef = $state(/** @type {Points | null} */ (null))
  /** @type {Atom[] | null} */
  let denseAtoms = null
  let denseOrder = false

  /**
   * True when view atoms are index 0..n-1, so packed xyz is already in point order.
   * Cached on the atom-array identity; play does not replace that array.
   * @param {Atom[]} arr
   */
  function atomsAreIndexOrder(arr) {
    if (arr === denseAtoms) return denseOrder
    denseAtoms = arr
    denseOrder = true
    for (let i = 0; i < arr.length; i++) {
      if (arr[i]?.index !== i) {
        denseOrder = false
        break
      }
    }
    return denseOrder
  }

  $effect(() => {
    const n = atoms.length
    if (n < 1) {
      pointsRef = null
      denseAtoms = null
      return
    }

    const arr = untrack(() => atoms)
    // xyz changes every play frame. Reading it here rebuilds the geometry and
    // leaves the new color buffer at zero, so points go black while playing.
    const packed = untrack(() => xyz)
    const positions = new Float32Array(n * 3)
    writePointPositions(positions, arr, packed, atomsAreIndexOrder(arr))

    const colors = new Float32Array(n * 3)
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    geometry.setAttribute('color', new BufferAttribute(colors, 3))

    const size = Math.max(0.5, (pointSize || 3) * (atomScale || 1))
    const material = new PointsMaterial({
      size,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: opacity < 1,
      opacity,
      depthTest,
      depthWrite: opacity >= 1
    })

    const pts = new Points(geometry, material)
    pts.renderOrder = renderOrder
    // Points are not culled, so the bounding sphere is never read.
    pts.frustumCulled = false
    pointsRef = pts
    invalidate()

    return () => {
      geometry.dispose()
      material.dispose()
      if (pointsRef === pts) pointsRef = null
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
  function uploadPoints(arr, packed) {
    const pts = pointsRef
    if (!pts) return
    const posAttr = pts.geometry.getAttribute('position')
    if (!posAttr || arr.length !== posAttr.count) return
    const dest = posAttr.array
    if (!(dest instanceof Float32Array)) return
    writePointPositions(dest, arr, packed, atomsAreIndexOrder(arr))
    posAttr.needsUpdate = true
    invalidate()
  }

  $effect(() => {
    void xyzEpoch
    void xyz
    if (trajPlayClock.playing) return
    const arr = atoms
    uploadPoints(arr, xyz)
  })

  useTask(() => {
    if (!trajPlayClock.playing) return
    const arr = untrack(() => atoms)
    const packed = blendPlayXyz(trajSmooth, playIndices(arr), trajSmoothRestoreH !== false)
    uploadPoints(arr, packed)
  })

  $effect(() => {
    const pts = pointsRef
    if (!pts) return
    const arr = untrack(() => atoms)
    const hi = highlightIndices
    void getColor
    const colorAttr = pts.geometry.getAttribute('color')
    if (!colorAttr || arr.length !== colorAttr.count) return
    const _tmp = new Color()
    for (let i = 0; i < arr.length; i++) {
      const atom = arr[i]
      const c = getColor(atom)
      if (hi.size > 0 && atom.index != null && hi.has(atom.index)) {
        _tmp.setRGB(
          Math.min(1, c.r * 1.5 + 0.4),
          Math.min(1, c.g * 1.5 + 0.4),
          Math.min(1, c.b * 1.5 + 0.4)
        )
        colorAttr.setXYZ(i, _tmp.r, _tmp.g, _tmp.b)
      } else {
        colorAttr.setXYZ(i, c.r, c.g, c.b)
      }
    }
    colorAttr.needsUpdate = true
    invalidate()
  })

  $effect(() => {
    const pts = untrack(() => pointsRef)
    if (!pts) return
    const mat = /** @type {PointsMaterial} */ (pts.material)
    mat.size = Math.max(0.5, (pointSize || 3) * (atomScale || 1))
    mat.opacity = opacity
    mat.transparent = opacity < 1
    mat.depthWrite = opacity >= 1
    mat.depthTest = depthTest
    pts.renderOrder = renderOrder
    invalidate()
  })
</script>

{#if pointsRef}
  <T is={pointsRef} />
{/if}
