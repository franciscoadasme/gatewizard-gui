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
  import { defaultColorScheme } from '../../../lib/colorSchemes.js'
  import { untrack } from 'svelte'

  /** @typedef {{ x: number, y: number, z: number, element: string, name: string }} Atom */
  /** @typedef {(atom: Atom) => import('three').Color} ColorScheme */

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
   * @returns {number} Radius (Å) for spheres and bond endpoint inset.
   */
  function atomBallRadius(el) {
    return Math.max(covalRadius(el) * BALL_STICK_ATOM_SCALE, 0.12)
  }

  /**
   * @type {{atoms: Atom[], bonds: [number, number][], getColor?: ColorScheme, metalness?: number, roughness?: number, emissiveIntensity?: number}}
   */
  let {
    atoms = [],
    bonds = [],
    getColor = defaultColorScheme,
    metalness = 0.1,
    roughness = 0.42,
    emissiveIntensity = 0.0
  } = $props()

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
      metalness,
      roughness,
      emissiveIntensity
    })
    const sphereMesh = new InstancedMesh(sphereGeom, sphereMat, n)
    sphereMesh.instanceColor = new InstancedBufferAttribute(new Float32Array(n * 3), 3)

    const sphereMatrix = new Matrix4()
    const sphereQuat = new Quaternion()
    const sphereScale = new Vector3()
    const spherePos = new Vector3()

    atoms.forEach((atom, index) => {
      const ri = atomBallRadius(atom.element)
      const color = untrack(() => getColor(atom))
      spherePos.set(atom.x, atom.y, atom.z)
      sphereScale.set(ri, ri, ri)
      sphereMatrix.compose(spherePos, sphereQuat, sphereScale)
      sphereMesh.setMatrixAt(index, sphereMatrix)
      sphereMesh.setColorAt(index, color)
    })
    sphereMesh.instanceMatrix.needsUpdate = true
    sphereMesh.instanceColor.needsUpdate = true

    const m = bonds.length
    const cylGeom = new CylinderGeometry(BOND_RADIUS, BOND_RADIUS, 1, 10, 1, false)
    const cylMat = new MeshStandardMaterial({
      color: new Color().setRGB(...STICK_GRAY),
      metalness,
      roughness,
      emissiveIntensity
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

  // Update colors when `getColor` changes (atoms is not tracked).
  $effect(() => {
    const mesh = untrack(() => sphereMeshRef)
    if (!mesh) return

    const arr = untrack(() => atoms)
    const n = arr.length
    for (let index = 0; index < n; index++) {
      const atom = arr[index]
      const color = getColor(atom)
      mesh.setColorAt(index, color)
    }
    mesh.instanceColor.needsUpdate = true
    invalidate()
  })
</script>

{#if sphereMeshRef}
  <T is={sphereMeshRef} />
{/if}
{#if bondMeshRef}
  <T is={bondMeshRef} />
{/if}
