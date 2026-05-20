<script>
  import { T, useThrelte } from '@threlte/core'
  import {
    BackSide,
    Color,
    InstancedBufferAttribute,
    InstancedMesh,
    Matrix4,
    MeshStandardMaterial,
    Quaternion,
    SphereGeometry,
    Vector3
  } from 'three'
  import { defaultColorScheme } from '../../../lib/colorSchemes.js'
  import { untrack } from 'svelte'

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
  const VDW_SPHERE_Q = { 1: [12, 8], 2: [24, 16], 3: [48, 32], 4: [72, 48], 5: [128, 96] }

  /**
   * @type {{atoms: Atom[], getColor?: ColorScheme, quality?: number, atomScale?: number, metalness?: number, roughness?: number, emissiveIntensity?: number, renderOrder?: number, depthTest?: boolean, opacity?: number, outline?: boolean}}
   */
  let {
    atoms = [],
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
    highlightIndices = new Set()
  } = $props()

  const { invalidate } = useThrelte()

  const count = $derived(atoms.length)

  let meshRef = $state(/** @type {InstancedMesh | null} */ (null))

  $effect(() => {
    const n = count
    if (n < 1) {
      meshRef = null
      return
    }

    const [ws, hs] = VDW_SPHERE_Q[quality] ?? VDW_SPHERE_Q[3]
    const geometry = new SphereGeometry(1, ws, hs)
    const material = new MeshStandardMaterial({
      metalness,
      roughness,
      emissiveIntensity,
      transparent: opacity < 1,
      opacity,
      depthTest,
      ...(outline ? { side: BackSide } : {})
    })
    const mesh = new InstancedMesh(geometry, material, n)
    mesh.renderOrder = renderOrder
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(n * 3), 3)

    const matrix = new Matrix4()
    const quat = new Quaternion()
    const scale = new Vector3()
    const pos = new Vector3()

    atoms.forEach((atom, index) => {
      pos.set(atom.x, atom.y, atom.z)
      const r = vdwRadius(atom.element) * atomScale
      const color = untrack(() => getColor(atom))
      scale.set(r, r, r)
      matrix.compose(pos, quat, scale)
      mesh.setMatrixAt(index, matrix)
      mesh.setColorAt(index, color)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor.needsUpdate = true

    meshRef = mesh
    invalidate()

    return () => {
      mesh.dispose()
      meshRef = null
    }
  })

  const _tmpHL = new Color()

  // Update colors when `getColor` or `highlightIndices` changes (atoms is not tracked).
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
</script>

{#if meshRef}
  <T is={meshRef} />
{/if}
