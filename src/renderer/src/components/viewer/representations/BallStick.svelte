<script>
  import { T, useThrelte } from '@threlte/core'
  import {
    Color,
    CylinderGeometry,
    InstancedBufferAttribute,
    InstancedMesh,
    Matrix4,
    MeshBasicMaterial,
    MeshStandardMaterial,
    MeshToonMaterial,
    Quaternion,
    SphereGeometry,
    Vector3
  } from 'three'
  import { defaultColorScheme } from '../../../lib/colorSchemes.js'
  import { getToonGradientMap } from '../../../lib/viewer/goodsellMaterial.js'
  import { applyGlowMaterial } from '../../../lib/viewer/glowMaterial.js'
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

  /** Sphere segments and cylinder radial segments per quality level (1–5). */
  const BS_QUALITY = /** @type {Record<number,[number,number,number]>} */ ({
    1: [12, 10, 8],
    2: [18, 14, 10],
    3: [28, 22, 14],
    4: [48, 36, 20],
    5: [72, 56, 32]
  })

  /**
   * @type {{
   *   atoms: Atom[],
   *   bonds?: [number,number][],
   *   getColor?: ColorScheme,
   *   quality?: number,
   *   atomScale?: number,
   *   bondScale?: number,
   *   metalness?: number,
   *   roughness?: number,
   *   emissiveIntensity?: number,
   *   goodsell?: boolean,
   *   outlinesEnabled?: boolean,
   *   outlineColor?: string,
   *   outlineWidth?: number,
   *   outlineWidth?: number,
   *   glowBulb?: boolean,
   *   opacity?: number
   * }}
   */
  let {
    atoms = [],
    bonds = [],
    getColor = defaultColorScheme,
    quality = 3,
    atomScale = 1.0,
    bondScale = 1.0,
    metalness = 0.1,
    roughness = 0.42,
    emissiveIntensity = 0.0,
    goodsell = false,
    outlinesEnabled = true,
    outlineColor = '#000000',
    outlineWidth = 0.12,
    highlightIndices = new Set(),
    glowBulb = false,
    opacity = 1.0
  } = $props()

  let sphereMeshRef = $state(/** @type {InstancedMesh | null} */ (null))
  let bondMeshRef = $state(/** @type {InstancedMesh | null} */ (null))
  let sphereOutlineMeshRef = $state(/** @type {InstancedMesh | null} */ (null))
  let bondOutlineMeshRef = $state(/** @type {InstancedMesh | null} */ (null))

  const count = $derived(atoms.length)

  const { invalidate } = useThrelte()

  /**
   * @param {number} n
   * @param {number} m
   * @param {boolean} showOutlines
   */
  function buildMeshes(n, m, showOutlines) {
    const [sw, sh, cr] = BS_QUALITY[quality] ?? BS_QUALITY[3]
    const sphereGeom = new SphereGeometry(1, sw, sh)

    /** @type {import('three').Material} */
    let sphereMat
    if (goodsell) {
      sphereMat = new MeshToonMaterial({ gradientMap: getToonGradientMap() })
    } else {
      const mat = new MeshStandardMaterial({
        metalness,
        roughness,
        emissiveIntensity: glowBulb ? 0 : emissiveIntensity,
        transparent: opacity < 1,
        opacity,
        depthWrite: opacity >= 1
      })
      if (glowBulb && emissiveIntensity > 0.001) {
        applyGlowMaterial(mat, emissiveIntensity, { useSurfaceColor: true })
      }
      sphereMat = mat
    }

    const sphereMesh = new InstancedMesh(sphereGeom, sphereMat, n)
    sphereMesh.renderOrder = 1
    sphereMesh.instanceColor = new InstancedBufferAttribute(new Float32Array(n * 3), 3)

    /** @type {InstancedMesh | null} */
    let sphereOutlineMesh = null
    if (showOutlines) {
      const outlineMat = new MeshBasicMaterial({
        color: outlineColor,
        depthWrite: false,
        transparent: opacity < 1,
        opacity
      })
      sphereOutlineMesh = new InstancedMesh(sphereGeom.clone(), outlineMat, n)
      sphereOutlineMesh.renderOrder = 0
    }

    const sphereMatrix = new Matrix4()
    const sphereQuat = new Quaternion()
    const sphereScale = new Vector3()
    const spherePos = new Vector3()

    atoms.forEach((atom, index) => {
      const ri = atomBallRadius(atom.element) * atomScale
      const color = untrack(() => getColor(atom))
      spherePos.set(atom.x, atom.y, atom.z)
      sphereScale.set(ri, ri, ri)
      sphereMatrix.compose(spherePos, sphereQuat, sphereScale)
      sphereMesh.setMatrixAt(index, sphereMatrix)
      sphereMesh.setColorAt(index, color)

      if (sphereOutlineMesh) {
        const outlineScale = 1 + outlineWidth / Math.max(ri, 0.5)
        sphereScale.set(ri * outlineScale, ri * outlineScale, ri * outlineScale)
        sphereMatrix.compose(spherePos, sphereQuat, sphereScale)
        sphereOutlineMesh.setMatrixAt(index, sphereMatrix)
      }
    })
    sphereMesh.instanceMatrix.needsUpdate = true
    sphereMesh.instanceColor.needsUpdate = true
    if (sphereOutlineMesh) sphereOutlineMesh.instanceMatrix.needsUpdate = true

    const bondRadius = BOND_RADIUS * bondScale
    const outlineBondRadius = bondRadius + outlineWidth
    const cylGeom = new CylinderGeometry(bondRadius, bondRadius, 1, cr, 1, false)
    /** @type {import('three').Material} */
    let cylMat
    if (goodsell) {
      cylMat = new MeshToonMaterial({
        color: new Color().setRGB(...STICK_GRAY),
        gradientMap: getToonGradientMap()
      })
    } else {
      const mat = new MeshStandardMaterial({
        color: new Color().setRGB(...STICK_GRAY),
        metalness,
        roughness,
        emissiveIntensity: glowBulb ? 0 : emissiveIntensity,
        transparent: opacity < 1,
        opacity,
        depthWrite: opacity >= 1
      })
      if (glowBulb && emissiveIntensity > 0.001) {
        applyGlowMaterial(mat, emissiveIntensity, { useSurfaceColor: false })
      }
      cylMat = mat
    }
    const bondMesh = new InstancedMesh(cylGeom, cylMat, m)
    bondMesh.renderOrder = 1

    /** @type {InstancedMesh | null} */
    let bondOutlineMesh = null
    if (showOutlines && m > 0) {
      const outlineCylGeom = new CylinderGeometry(
        outlineBondRadius,
        outlineBondRadius,
        1,
        cr,
        1,
        false
      )
      const outlineCylMat = new MeshBasicMaterial({ color: outlineColor, depthWrite: false })
      bondOutlineMesh = new InstancedMesh(outlineCylGeom, outlineCylMat, m)
      bondOutlineMesh.renderOrder = 0
    }

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
      if (!ai || !aj) continue

      pa.set(ai.x, ai.y, ai.z)
      pb.set(aj.x, aj.y, aj.z)

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

      if (bondOutlineMesh) {
        bondOutlineMesh.setMatrixAt(b, cylMatrix)
      }
    }
    bondMesh.instanceMatrix.needsUpdate = true
    if (bondOutlineMesh) bondOutlineMesh.instanceMatrix.needsUpdate = true

    return { sphereMesh, bondMesh, sphereOutlineMesh, bondOutlineMesh }
  }

  $effect(() => {
    const n = count
    if (n < 1) {
      sphereMeshRef = null
      bondMeshRef = null
      sphereOutlineMeshRef = null
      bondOutlineMeshRef = null
      return
    }

    const m = bonds.length
    const showOutlines = goodsell && outlinesEnabled && outlineWidth > 0
    const built = buildMeshes(n, m, showOutlines)

    sphereMeshRef = built.sphereMesh
    bondMeshRef = built.bondMesh
    sphereOutlineMeshRef = built.sphereOutlineMesh
    bondOutlineMeshRef = built.bondOutlineMesh
    invalidate()

    return () => {
      built.sphereMesh.dispose()
      built.bondMesh.dispose()
      built.sphereOutlineMesh?.dispose()
      built.bondOutlineMesh?.dispose()
      sphereMeshRef = null
      bondMeshRef = null
      sphereOutlineMeshRef = null
      bondOutlineMeshRef = null
    }
  })

  const _tmpHL = new Color()

  $effect(() => {
    const mesh = untrack(() => sphereMeshRef)
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
    const op = opacity
    for (const mesh of [
      untrack(() => sphereMeshRef),
      untrack(() => bondMeshRef),
      untrack(() => sphereOutlineMeshRef),
      untrack(() => bondOutlineMeshRef)
    ]) {
      if (!mesh) continue
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

{#if sphereOutlineMeshRef}
  <T is={sphereOutlineMeshRef} />
{/if}
{#if bondOutlineMeshRef}
  <T is={bondOutlineMeshRef} />
{/if}
{#if sphereMeshRef}
  <T is={sphereMeshRef} />
{/if}
{#if bondMeshRef}
  <T is={bondMeshRef} />
{/if}
