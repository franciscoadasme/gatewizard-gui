<script>
  import { T, useThrelte } from '@threlte/core'
  import {
    BufferAttribute,
    BufferGeometry,
    Color,
    Points,
    PointsMaterial
  } from 'three'
  import { defaultColorScheme } from '../../../lib/colorSchemes.js'
  import { untrack } from 'svelte'

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
   * }}
   */
  let {
    atoms = [],
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

  $effect(() => {
    const arr = atoms
    const n = arr.length
    if (n < 1) {
      pointsRef = null
      return
    }

    const positions = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const atom = arr[i]
      positions[i * 3] = atom.x
      positions[i * 3 + 1] = atom.y
      positions[i * 3 + 2] = atom.z
    }

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
    pts.frustumCulled = false
    pointsRef = pts
    invalidate()

    return () => {
      geometry.dispose()
      material.dispose()
      if (pointsRef === pts) pointsRef = null
    }
  })

  $effect(() => {
    const pts = untrack(() => pointsRef)
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
