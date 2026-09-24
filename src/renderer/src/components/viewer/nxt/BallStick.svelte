<script>
  import { T, useTask, useThrelte } from '@threlte/core'
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
  import { setMultiBondOffsetAxis } from '../../../lib/viewer/multiBondOffset.js'
  import { untrack } from 'svelte'
  import { collectAtomIndices, readAtomXyz } from '../../../lib/viewer/trajectoryFrames.js'
  import { blendPlayXyz, trajPlayClock } from '../../../lib/viewer/trajPlayClock.js'

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
   * How far sticks dig into atom spheres (fraction of atom radius).
   * 0 = end flush at the surface; higher = more embedded (cleaner multi-bond caps).
   */
  const BOND_SPHERE_PENETRATION = 0.42

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
   * [sphere width, sphere height, cylinder radial] per quality 1–5.
   * Max used to be only 32 cylinder sides — that is what makes CPK/ball-stick
   * look “toothed” at the sphere–bond seam even at Quality 5.
   */
  const BS_QUALITY = /** @type {Record<number,[number,number,number]>} */ ({
    1: [16, 12, 12],
    2: [32, 24, 20],
    3: [48, 36, 32],
    4: [96, 64, 56],
    5: [160, 96, 96]
  })

  /**
   * @type {{
   *   atoms: Atom[],
   *   bonds?: Array<[number, number] | [number, number, number]>,
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
   *   opacity?: number,
   *   showMultipleBonds?: boolean,
   *   bondColorMode?: 'uniform' | 'atoms',
   *   bondColor?: string,
   *   highlightIndices?: Set<number>,
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
    opacity = 1.0,
    showMultipleBonds = true,
    bondColorMode = 'uniform',
    bondColor = '#b8b8bc'
  } = $props()

  /** Offset (Å) between parallel sticks for double/triple bonds. */
  const MULTI_BOND_SPACING = 0.22

  /**
   * Parse bond row; aromatic / unknown orders render as a single stick.
   * @param {unknown} bond
   * @returns {{ i: number, j: number, order: number } | null}
   */
  function parseBond(bond) {
    if (!Array.isArray(bond) || bond.length < 2) return null
    const i = Number(bond[0])
    const j = Number(bond[1])
    if (!Number.isFinite(i) || !Number.isFinite(j)) return null
    let order = 1
    if (bond.length > 2 && Number.isFinite(Number(bond[2]))) {
      const o = Math.round(Number(bond[2]))
      // Aromatic (~1.5) and other non-integer → single stick (plan)
      if (o >= 2 && o <= 3 && Math.abs(Number(bond[2]) - o) < 1e-6) order = o
    }
    return { i, j, order }
  }

  /**
   * Expand bonds into cylinder instances (multiple for order ≥ 2 when enabled).
   * @returns {Array<{ i: number, j: number, offset: number }>}
   */
  function expandBondInstances() {
    /** @type {Array<{ i: number, j: number, offset: number }>} */
    const instances = []
    for (const raw of bonds) {
      const b = parseBond(raw)
      if (!b) continue
      const order = showMultipleBonds ? b.order : 1
      if (order <= 1) {
        instances.push({ i: b.i, j: b.j, offset: 0 })
        continue
      }
      // Center the fan of parallel sticks around the bond axis
      for (let k = 0; k < order; k++) {
        const offset = (k - (order - 1) / 2) * MULTI_BOND_SPACING
        instances.push({ i: b.i, j: b.j, offset })
      }
    }
    return instances
  }

  /**
   * Cylinder instance count (×2 when bonds are split-colored by endpoint atoms).
   * @returns {number}
   */
  function bondDrawCount() {
    const n = expandBondInstances().length
    return bondColorMode === 'atoms' ? n * 2 : n
  }

  function resolveBondUniformColor() {
    try {
      return new Color(bondColor || '#b8b8bc')
    } catch {
      return new Color().setRGB(...STICK_GRAY)
    }
  }

  let sphereMeshRef = $state(/** @type {InstancedMesh | null} */ (null))
  let bondMeshRef = $state(/** @type {InstancedMesh | null} */ (null))
  let sphereOutlineMeshRef = $state(/** @type {InstancedMesh | null} */ (null))
  let bondOutlineMeshRef = $state(/** @type {InstancedMesh | null} */ (null))

  const count = $derived(atoms.length)
  const { camera, invalidate } = useThrelte()

  /** @type {Float32Array | null | undefined} */
  let playXyz = null
  /** @type {Atom[] | null} */
  let playIdxAtoms = null
  /** @type {Int32Array | null} */
  let playIdx = null

  function coords() {
    return playXyz ?? xyz
  }

  /** @param {Atom[]} arr */
  function playIndices(arr) {
    if (arr === playIdxAtoms) return playIdx
    playIdxAtoms = arr
    playIdx = collectAtomIndices(arr)
    return playIdx
  }
  const _bondMid = new Vector3()
  const _lastCamPos = new Vector3(NaN, NaN, NaN)
  const _lastCamQuat = new Quaternion(0, 0, 0, 1)

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
    sphereMesh.frustumCulled = false
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
      sphereOutlineMesh.frustumCulled = false
    }

    const sphereMatrix = new Matrix4()
    const sphereQuat = new Quaternion()
    const sphereScale = new Vector3()
    const spherePos = new Vector3()

    const atomList = untrack(() => atoms)
    atomList.forEach((atom, index) => {
      const ri = atomBallRadius(atom.element) * atomScale
      const color = untrack(() => getColor(atom))
      const p = readAtomXyz(atom, coords())
      spherePos.set(p.x, p.y, p.z)
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
    const splitBonds = bondColorMode === 'atoms'
    const cylGeom = new CylinderGeometry(bondRadius, bondRadius, 1, cr, 1, false)
    const uniformCol = resolveBondUniformColor()
    /** @type {import('three').Material} */
    let cylMat
    if (goodsell) {
      cylMat = new MeshToonMaterial({
        color: splitBonds ? new Color(0xffffff) : uniformCol,
        gradientMap: getToonGradientMap()
      })
    } else {
      const mat = new MeshStandardMaterial({
        color: splitBonds ? new Color(0xffffff) : uniformCol,
        metalness,
        roughness,
        emissiveIntensity: glowBulb ? 0 : emissiveIntensity,
        transparent: opacity < 1,
        opacity,
        depthWrite: opacity >= 1
      })
      if (glowBulb && emissiveIntensity > 0.001) {
        applyGlowMaterial(mat, emissiveIntensity, { useSurfaceColor: splitBonds })
      }
      cylMat = mat
    }
    const bondMesh = new InstancedMesh(cylGeom, cylMat, Math.max(m, 1))
    bondMesh.renderOrder = 1
    bondMesh.frustumCulled = false
    if (splitBonds) {
      bondMesh.instanceColor = new InstancedBufferAttribute(new Float32Array(Math.max(m, 1) * 3), 3)
    }
    bondMesh.count = m

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
      bondOutlineMesh.frustumCulled = false
    }

    const cylMatrix = new Matrix4()
    const cylQuat = new Quaternion()
    const cylScale = new Vector3()
    const cylPos = new Vector3()
    const dir = new Vector3()
    const pa = new Vector3()
    const pb = new Vector3()
    const yAxis = new Vector3(0, 1, 0)
    const offsetAxis = new Vector3()

    const atom_by_index = new Map(atoms.map((atom) => [atom.index, atom]))
    const bondInstances = expandBondInstances()
    let written = 0
    for (const { i, j, offset } of bondInstances) {
      if (written >= m) break
      const ai = atom_by_index.get(i) ?? (atoms[i]?.index === i ? atoms[i] : undefined)
      const aj = atom_by_index.get(j) ?? (atoms[j]?.index === j ? atoms[j] : undefined)
      if (!ai || !aj) continue

      const pi = readAtomXyz(ai, coords())
      const pj = readAtomXyz(aj, coords())
      pa.set(pi.x, pi.y, pi.z)
      pb.set(pj.x, pj.y, pj.z)

      const ri = atomBallRadius(ai.element) * atomScale
      const rj = atomBallRadius(aj.element) * atomScale
      const insetI = ri * (1 - BOND_SPHERE_PENETRATION)
      const insetJ = rj * (1 - BOND_SPHERE_PENETRATION)

      dir.copy(pb).sub(pa)
      const fullLen = Math.max(dir.length(), 0.02)
      dir.normalize()

      if (Math.abs(offset) > 1e-8) {
        _bondMid.copy(pa).add(pb).multiplyScalar(0.5)
        setMultiBondOffsetAxis(dir, _bondMid, camera.current?.position, offsetAxis)
        pa.addScaledVector(offsetAxis, offset)
        pb.addScaledVector(offsetAxis, offset)
        dir.copy(pb).sub(pa).normalize()
      }

      if (splitBonds) {
        const midLen = Math.max(fullLen / 2 - (insetI + insetJ) / 2, 0.02)
        // Half near atom i
        cylPos.copy(pa).addScaledVector(dir, insetI + midLen / 2)
        cylQuat.setFromUnitVectors(yAxis, dir)
        cylScale.set(1, midLen, 1)
        cylMatrix.compose(cylPos, cylQuat, cylScale)
        bondMesh.setMatrixAt(written, cylMatrix)
        bondMesh.setColorAt(written, untrack(() => getColor(ai)))
        if (bondOutlineMesh) bondOutlineMesh.setMatrixAt(written, cylMatrix)
        written++
        if (written >= m) break
        // Half near atom j
        cylPos.copy(pb).addScaledVector(dir, -(insetJ + midLen / 2))
        cylMatrix.compose(cylPos, cylQuat, cylScale)
        bondMesh.setMatrixAt(written, cylMatrix)
        bondMesh.setColorAt(written, untrack(() => getColor(aj)))
        if (bondOutlineMesh) bondOutlineMesh.setMatrixAt(written, cylMatrix)
        written++
      } else {
        const effLen = Math.max(fullLen - insetI - insetJ, 0.02)
        cylPos.copy(pa).addScaledVector(dir, insetI + effLen / 2)
        cylQuat.setFromUnitVectors(yAxis, dir)
        cylScale.set(1, effLen, 1)
        cylMatrix.compose(cylPos, cylQuat, cylScale)
        bondMesh.setMatrixAt(written, cylMatrix)
        if (bondOutlineMesh) bondOutlineMesh.setMatrixAt(written, cylMatrix)
        written++
      }
    }
    bondMesh.count = written
    bondMesh.instanceMatrix.needsUpdate = true
    if (bondMesh.instanceColor) bondMesh.instanceColor.needsUpdate = true
    if (bondOutlineMesh) {
      bondOutlineMesh.count = written
      bondOutlineMesh.instanceMatrix.needsUpdate = true
    }

    return { sphereMesh, bondMesh, sphereOutlineMesh, bondOutlineMesh }
  }

  /**
   * @param {InstancedMesh} bondMesh
   * @param {InstancedMesh | null} bondOutlineMesh
   * @param {Atom[]} arr
   * @param {boolean} [writeColors]
   */
  function updateBondMatrices(bondMesh, bondOutlineMesh, arr, writeColors = false) {
    const bondInstances = expandBondInstances()
    const splitBonds = bondColorMode === 'atoms'
    const need = splitBonds ? bondInstances.length * 2 : bondInstances.length
    if (!need) return
    if (need > bondMesh.instanceMatrix.count) return need

    const atom_by_index = new Map(arr.map((atom) => [atom.index, atom]))
    const cylMatrix = new Matrix4()
    const cylQuat = new Quaternion()
    const cylScale = new Vector3()
    const cylPos = new Vector3()
    const dir = new Vector3()
    const pa = new Vector3()
    const pb = new Vector3()
    const yAxis = new Vector3(0, 1, 0)
    const offsetAxis = new Vector3()

    let written = 0
    for (const { i, j, offset } of bondInstances) {
      const ai = atom_by_index.get(i) ?? (arr[i]?.index === i ? arr[i] : undefined)
      const aj = atom_by_index.get(j) ?? (arr[j]?.index === j ? arr[j] : undefined)
      if (!ai || !aj) continue

      const pi = readAtomXyz(ai, coords())
      const pj = readAtomXyz(aj, coords())
      pa.set(pi.x, pi.y, pi.z)
      pb.set(pj.x, pj.y, pj.z)

      const ri = atomBallRadius(ai.element) * atomScale
      const rj = atomBallRadius(aj.element) * atomScale
      const insetI = ri * (1 - BOND_SPHERE_PENETRATION)
      const insetJ = rj * (1 - BOND_SPHERE_PENETRATION)

      dir.copy(pb).sub(pa)
      const fullLen = Math.max(dir.length(), 0.02)
      dir.normalize()

      if (Math.abs(offset) > 1e-8) {
        _bondMid.copy(pa).add(pb).multiplyScalar(0.5)
        setMultiBondOffsetAxis(dir, _bondMid, camera.current?.position, offsetAxis)
        pa.addScaledVector(offsetAxis, offset)
        pb.addScaledVector(offsetAxis, offset)
        dir.copy(pb).sub(pa).normalize()
      }

      if (splitBonds) {
        const midLen = Math.max(fullLen / 2 - (insetI + insetJ) / 2, 0.02)
        cylPos.copy(pa).addScaledVector(dir, insetI + midLen / 2)
        cylQuat.setFromUnitVectors(yAxis, dir)
        cylScale.set(1, midLen, 1)
        cylMatrix.compose(cylPos, cylQuat, cylScale)
        bondMesh.setMatrixAt(written, cylMatrix)
        if (writeColors && bondMesh.instanceColor) bondMesh.setColorAt(written, getColor(ai))
        if (bondOutlineMesh) bondOutlineMesh.setMatrixAt(written, cylMatrix)
        written++
        cylPos.copy(pb).addScaledVector(dir, -(insetJ + midLen / 2))
        cylMatrix.compose(cylPos, cylQuat, cylScale)
        bondMesh.setMatrixAt(written, cylMatrix)
        if (writeColors && bondMesh.instanceColor) bondMesh.setColorAt(written, getColor(aj))
        if (bondOutlineMesh) bondOutlineMesh.setMatrixAt(written, cylMatrix)
        written++
      } else {
        const effLen = Math.max(fullLen - insetI - insetJ, 0.02)
        cylPos.copy(pa).addScaledVector(dir, insetI + effLen / 2)
        cylQuat.setFromUnitVectors(yAxis, dir)
        cylScale.set(1, effLen, 1)
        cylMatrix.compose(cylPos, cylQuat, cylScale)
        bondMesh.setMatrixAt(written, cylMatrix)
        if (bondOutlineMesh) bondOutlineMesh.setMatrixAt(written, cylMatrix)
        written++
      }
    }
    bondMesh.count = written
    bondMesh.instanceMatrix.needsUpdate = true
    if (writeColors && bondMesh.instanceColor) bondMesh.instanceColor.needsUpdate = true
    if (bondOutlineMesh) {
      bondOutlineMesh.count = written
      bondOutlineMesh.instanceMatrix.needsUpdate = true
    }
  }

  $effect(() => {
    const n = count
    void bonds
    void showMultipleBonds
    void bondColorMode
    void bondColor
    if (n < 1) {
      sphereMeshRef = null
      bondMeshRef = null
      sphereOutlineMeshRef = null
      bondOutlineMeshRef = null
      return
    }

    const m = bondDrawCount()
    const showOutlines = goodsell && outlinesEnabled && outlineWidth > 0
    const built = buildMeshes(n, m, showOutlines)

    sphereMeshRef = built.sphereMesh
    bondMeshRef = built.bondMesh
    sphereOutlineMeshRef = built.sphereOutlineMesh
    bondOutlineMeshRef = built.bondOutlineMesh
    if (m > 0) {
      updateBondMatrices(built.bondMesh, built.bondOutlineMesh, untrack(() => atoms), true)
    }
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

  /**
   * @param {Atom[]} arr
   */
  function uploadBallStick(arr) {
    const sphereMesh = sphereMeshRef
    if (!sphereMesh || arr.length !== sphereMesh.count) return
    const sphereOutline = sphereOutlineMeshRef
    const sphereMatrix = new Matrix4()
    const sphereQuat = new Quaternion()
    const sphereScale = new Vector3()
    const spherePos = new Vector3()
    for (let index = 0; index < arr.length; index++) {
      const atom = arr[index]
      const ri = atomBallRadius(atom.element) * atomScale
      const p = readAtomXyz(atom, coords())
      spherePos.set(p.x, p.y, p.z)
      sphereScale.set(ri, ri, ri)
      sphereMatrix.compose(spherePos, sphereQuat, sphereScale)
      sphereMesh.setMatrixAt(index, sphereMatrix)
      if (sphereOutline) {
        const outlineScale = 1 + outlineWidth / Math.max(ri, 0.5)
        sphereScale.set(ri * outlineScale, ri * outlineScale, ri * outlineScale)
        sphereMatrix.compose(spherePos, sphereQuat, sphereScale)
        sphereOutline.setMatrixAt(index, sphereMatrix)
      }
    }
    sphereMesh.instanceMatrix.needsUpdate = true
    if (sphereOutline) sphereOutline.instanceMatrix.needsUpdate = true
    const bondMesh = bondMeshRef
    if (bondMesh) {
      updateBondMatrices(bondMesh, bondOutlineMeshRef, arr, false)
    }
    invalidate()
  }

  $effect(() => {
    void xyzEpoch
    void xyz
    if (trajPlayClock.playing) return
    playXyz = xyz
    uploadBallStick(atoms)
  })

  useTask(() => {
    if (!trajPlayClock.playing) return
    const arr = untrack(() => atoms)
    playXyz = blendPlayXyz(trajSmooth, playIndices(arr), trajSmoothRestoreH !== false)
    uploadBallStick(arr)
  })

  $effect(() => {
    const mesh = untrack(() => bondMeshRef)
    if (!mesh || !(bonds?.length ?? 0)) return
    void bonds
    void showMultipleBonds
    void bondColorMode
    const need = bondDrawCount()
    if (need > mesh.instanceMatrix.count) {
      const n = untrack(() => atoms.length)
      if (n < 1) return
      const showOutlines = untrack(() => goodsell && outlinesEnabled && outlineWidth > 0)
      const prevSphere = untrack(() => sphereMeshRef)
      const prevBond = mesh
      const prevSphereOutline = untrack(() => sphereOutlineMeshRef)
      const prevBondOutline = untrack(() => bondOutlineMeshRef)
      const built = buildMeshes(n, need, showOutlines)
      sphereMeshRef = built.sphereMesh
      bondMeshRef = built.bondMesh
      sphereOutlineMeshRef = built.sphereOutlineMesh
      bondOutlineMeshRef = built.bondOutlineMesh
      prevSphere?.dispose()
      prevBond.dispose()
      prevSphereOutline?.dispose()
      prevBondOutline?.dispose()
      updateBondMatrices(built.bondMesh, built.bondOutlineMesh, atoms, true)
      invalidate()
      return
    }
    updateBondMatrices(mesh, untrack(() => bondOutlineMeshRef), atoms, false)
    invalidate()
  })

  function hasMultiBonds() {
    if (!showMultipleBonds) return false
    for (const raw of bonds) {
      const b = parseBond(raw)
      if (b && b.order >= 2) return true
    }
    return false
  }

  useTask(() => {
    const mesh = bondMeshRef
    if (!mesh || !hasMultiBonds()) return
    const cam = camera.current
    if (!cam) return
    if (
      cam.position.distanceToSquared(_lastCamPos) < 1e-12 &&
      cam.quaternion.angleTo(_lastCamQuat) < 1e-5
    ) {
      return
    }
    _lastCamPos.copy(cam.position)
    _lastCamQuat.copy(cam.quaternion)
    updateBondMatrices(mesh, untrack(() => bondOutlineMeshRef), untrack(() => atoms), false)
    invalidate()
  })

  const _tmpHL = new Color()

  $effect(() => {
    const mesh = untrack(() => sphereMeshRef)
    if (!mesh) return

    const arr = untrack(() => atoms)
    const hi = highlightIndices
    void getColor
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

    // Split-colored bonds follow the same scheme as atom spheres.
    const bondMesh = untrack(() => bondMeshRef)
    if (bondMesh && bondColorMode === 'atoms' && bondMesh.instanceColor) {
      updateBondMatrices(bondMesh, untrack(() => bondOutlineMeshRef), arr, true)
    }
    invalidate()
  })

  $effect(() => {
    void bondColor
    if (bondColorMode !== 'uniform') return
    const mesh = untrack(() => bondMeshRef)
    if (!mesh) return
    const mat = mesh.material
    if (Array.isArray(mat)) return
    if ('color' in mat) mat.color.copy(resolveBondUniformColor())
    mat.needsUpdate = true
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
