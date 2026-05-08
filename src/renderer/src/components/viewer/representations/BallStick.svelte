<script>
  import { T, useThrelte } from '@threlte/core'
  import {
    Color,
    CylinderGeometry,
    InstancedBufferAttribute,
    InstancedMesh,
    Matrix4,
    MeshStandardMaterial,
    Quaternion,
    SphereGeometry,
    Vector3
  } from 'three'

  /** Covalent radii (Å); scaled for visible atom spheres. */
  const COVALENT = {
    H: 0.31,
    C: 0.76,
    N: 0.71,
    O: 0.66,
    F: 0.57,
    P: 1.07,
    S: 1.05,
    CL: 1.02,
    BR: 1.2,
    I: 1.39,
    FE: 1.52,
    ZN: 1.22,
    NA: 1.66,
    MG: 1.41,
    CA: 1.76,
    K: 2.03,
    SE: 1.2
  }
  const DEFAULT_COVALENT = 1.2

  /** Visual scale applied to covalent radii (Å → scene). */
  const BALL_STICK_ATOM_SCALE = 0.5

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

  const BOND_RADIUS = 0.1
  const STICK_GRAY = /** @type {[number, number, number]} */ ([0.72, 0.72, 0.74])

  /**
   * @param {string} el
   * @returns {string}
   */
  function elemKey(el) {
    return String(el || 'C')
      .trim()
      .toUpperCase()
      .slice(0, 2)
  }

  /**
   * @param {string} el
   * @returns {number}
   */
  function covalRadius(el) {
    const k = elemKey(el)
    if (COVALENT[k] !== undefined) return COVALENT[k]
    if (k.length >= 1 && COVALENT[k[0]] !== undefined) return COVALENT[k[0]]
    return DEFAULT_COVALENT
  }

  /**
   * @param {string} el
   * @returns {[number, number, number]}
   */
  function cpkRgb(el) {
    const k = elemKey(el)
    if (CPK[k]) return /** @type {[number, number, number]} */ (CPK[k])
    if (k.length >= 1 && CPK[k[0]]) return /** @type {[number, number, number]} */ (CPK[k[0]])
    return DEFAULT_CPK
  }

  /**
   * @param {string} el
   * @returns {number} Radius (Å) for spheres and bond endpoint inset.
   */
  function atomBallRadius(el) {
    return Math.max(covalRadius(el) * BALL_STICK_ATOM_SCALE, 0.12)
  }

  // Reactive state

  /** @type {{ atoms: { x: number, y: number, z: number, element: string }[], bonds: [number, number][] }} */
  let { atoms = [], bonds = [] } = $props()

  let sphereMeshRef = $state(/** @type {InstancedMesh | null} */ (null))
  let bondMeshRef = $state(/** @type {InstancedMesh | null} */ (null))

  const count = $derived(atoms.length)

  const { invalidate } = useThrelte()

  $effect(() => {
    const n = count
    if (n < 1) {
      return
    }

    const sphereGeom = new SphereGeometry(1, 20, 16)
    const sphereMat = new MeshStandardMaterial({
      metalness: 0.1,
      roughness: 0.42
    })
    const sphereMesh = new InstancedMesh(sphereGeom, sphereMat, n)
    sphereMesh.instanceColor = new InstancedBufferAttribute(new Float32Array(n * 3), 3)

    const sphereMatrix = new Matrix4()
    const sphereQuat = new Quaternion()
    const sphereScale = new Vector3()
    const spherePos = new Vector3()
    const sphereColor = new Color()

    atoms.forEach((atom, index) => {
      const ri = atomBallRadius(atom.element)
      spherePos.set(atom.x, atom.y, atom.z)
      sphereScale.set(ri, ri, ri)
      sphereMatrix.compose(spherePos, sphereQuat, sphereScale)
      sphereMesh.setMatrixAt(index, sphereMatrix)
      const [cr, cg, cb] = cpkRgb(atom.element)
      sphereColor.setRGB(cr, cg, cb)
      sphereMesh.setColorAt(index, sphereColor)
    })
    sphereMesh.instanceMatrix.needsUpdate = true
    sphereMesh.instanceColor.needsUpdate = true

    const m = bonds.length
    const cylGeom = new CylinderGeometry(BOND_RADIUS, BOND_RADIUS, 1, 10, 1, false)
    const cylMat = new MeshStandardMaterial({
      color: new Color().setRGB(...STICK_GRAY),
      metalness: 0.05,
      roughness: 0.55
    })
    const bondMesh = new InstancedMesh(cylGeom, cylMat, m)

    const cylMatrix = new Matrix4()
    const cylQuat = new Quaternion()
    const cylScale = new Vector3()
    const cylPos = new Vector3()
    const dir = new Vector3()
    const pa = new Vector3()
    const pb = new Vector3()
    const yAxis = new Vector3(0, 1, 0)

    const atom_by_index = new Map(atoms.map((atom) => [atom.index, atom]))
    for (let b = 0; b < m; b++) {
      const [i, j] = bonds[b]
      const ai = atom_by_index.get(i)
      const aj = atom_by_index.get(j)
      if (!ai || !aj) {
        continue
      }
      pa.set(ai.x, ai.y, ai.z)
      pb.set(aj.x, aj.y, aj.z)

      /** Shorten cylinders so spheres sit visibly on ends (Å). */
      const ri = atomBallRadius(ai.element)
      const rj = atomBallRadius(aj.element)

      dir.copy(pb).sub(pa)
      const effLen = dir.length() - ri - rj

      dir.normalize()
      cylPos.copy(pa).addScaledVector(dir, ri + effLen / 2)
      cylQuat.setFromUnitVectors(yAxis, dir)
      cylScale.set(1, effLen, 1)
      cylMatrix.compose(cylPos, cylQuat, cylScale)
      bondMesh.setMatrixAt(b, cylMatrix)
    }
    bondMesh.instanceMatrix.needsUpdate = true

    sphereMeshRef = sphereMesh
    bondMeshRef = bondMesh
    invalidate()

    return () => {
      sphereMesh.dispose()
      bondMesh.dispose()
      sphereMeshRef = null
      bondMeshRef = null
    }
  })
</script>

{#if sphereMeshRef}
  <T is={sphereMeshRef} />
{/if}
{#if bondMeshRef}
  <T is={bondMeshRef} />
{/if}
