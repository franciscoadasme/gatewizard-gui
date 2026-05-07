<script>
  import { T, useThrelte } from '@threlte/core'
  import {
    Color,
    InstancedBufferAttribute,
    InstancedMesh,
    Matrix4,
    MeshStandardMaterial,
    Quaternion,
    SphereGeometry,
    Vector3
  } from 'three'

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

  /** CPK RGB (0–1). */
  const CPK = {
    H: [1, 1, 1],
    C: [0.56, 0.56, 0.56],
    N: [0.19, 0.31, 0.97],
    O: [1, 0.05, 0.05],
    S: [0.98, 0.98, 0.2],
    P: [1, 0.5, 0],
    F: [0.56, 0.88, 0.31],
    CL: [0.12, 0.94, 0.12],
    BR: [0.65, 0.16, 0.16],
    I: [0.58, 0, 0.58],
    FE: [0.88, 0.4, 0.2],
    ZN: [0.49, 0.5, 0.69],
    NA: [0.67, 0.36, 0.94],
    MG: [0.54, 0.6, 0.78],
    CA: [0.67, 0.36, 0.94],
    K: [0.56, 0.25, 0.83],
    SE: [0.8, 0.6, 0.2]
  }
  const DEFAULT_CPK = [0.5, 0.5, 0.5]

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

  /**
   * @param {string} el
   * @returns {[number, number, number]}
   */
  function cpkRgb(el) {
    const k = String(el || 'C')
      .trim()
      .toUpperCase()
      .slice(0, 2)
    if (CPK[k]) return /** @type {[number, number, number]} */ (CPK[k])
    if (k.length >= 1 && CPK[k[0]]) return /** @type {[number, number, number]} */ (CPK[k[0]])
    return DEFAULT_CPK
  }

  /** @type {{ x: number, y: number, z: number, element: string }[]} */
  let { atoms = [] } = $props()

  const { invalidate } = useThrelte()

  const count = $derived(atoms.length)

  let meshRef = $state(/** @type {InstancedMesh | null} */ (null))

  $effect(() => {
    const n = count
    if (n < 1) {
      meshRef = null
      return
    }

    const geometry = new SphereGeometry(1, 16, 12)
    const material = new MeshStandardMaterial({
      metalness: 0.12,
      roughness: 0.45
    })
    const mesh = new InstancedMesh(geometry, material, n)
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(n * 3), 3)

    const matrix = new Matrix4()
    const quat = new Quaternion()
    const scale = new Vector3()
    const pos = new Vector3()
    const color = new Color()

    atoms.forEach((atom, index) => {
      pos.set(atom.x, atom.y, atom.z)
      const r = vdwRadius(atom.element)
      scale.set(r, r, r)
      matrix.compose(pos, quat, scale)
      mesh.setMatrixAt(index, matrix)
      const [cr, cg, cb] = cpkRgb(atom.element)
      color.setRGB(cr, cg, cb)
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
</script>

{#if meshRef}
  <T is={meshRef} />
{/if}
