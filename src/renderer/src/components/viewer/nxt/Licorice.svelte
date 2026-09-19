<script>
  import { T, useTask, useThrelte } from '@threlte/core'
  import {
    Color,
    CylinderGeometry,
    Group,
    InstancedBufferAttribute,
    InstancedMesh,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    MeshToonMaterial,
    Quaternion,
    SphereGeometry,
    TorusGeometry,
    Vector3
  } from 'three'
  import { defaultColorScheme } from '../../../lib/colorSchemes.js'
  import { getToonGradientMap } from '../../../lib/viewer/goodsellMaterial.js'
  import { applyGlowMaterial } from '../../../lib/viewer/glowMaterial.js'
  import { applySplitBondColors } from '../../../lib/viewer/splitBondMaterial.js'
  import { setMultiBondOffsetAxis } from '../../../lib/viewer/multiBondOffset.js'
  import {
    buildAdjacency,
    classifyAtoms,
    computeBranchJoints,
    computeElbows,
    computeEndAdjustments,
    computeTerminals,
    elbowFrameMatrixElements,
    pipeBendRadius,
    stickEndpoints
  } from '../../../lib/viewer/licoricePipe.js'
  import { untrack } from 'svelte'

  /** @typedef {{ x: number, y: number, z: number, element: string, name: string, index?: number }} Atom */
  /** @typedef {(atom: Atom) => import('three').Color} ColorScheme */

  const BOND_RADIUS = 0.1
  /** Slightly fatten elbow tube so it seals against shortened sticks. */
  const ELBOW_TUBE_SCALE = 1.04
  /**
   * Branch joints (deg≥3): sphere slightly larger than the stick so it buries
   * cylinder–cylinder polygonal intersection teeth (same-radius sphere is not enough).
   */
  const BRANCH_SPHERE_SCALE = 1.12

  /**
   * Cylinder + joint-sphere radial segments per quality 1–5 (aligned with ball-stick density).
   * Joint spheres use the same count as sticks.
   */
  const LIC_QUALITY = /** @type {Record<number, number>} */ ({
    1: 16,
    2: 28,
    3: 48,
    4: 80,
    5: 128
  })

  /** @param {number} quality */
  function resolveCylinderSides(quality) {
    const q = Math.round(Number(quality))
    return LIC_QUALITY[q] ?? LIC_QUALITY[3]
  }

  /**
   * @type {{
   *   atoms: Atom[],
   *   bonds?: Array<[number, number] | [number, number, number]>,
   *   getColor?: ColorScheme,
   *   quality?: number,
   *   bondScale?: number,
   *   stickRoundness?: number,
   *   metalness?: number,
   *   roughness?: number,
   *   emissiveIntensity?: number,
   *   goodsell?: boolean,
   *   outlinesEnabled?: boolean,
   *   outlineColor?: string,
   *   outlineWidth?: number,
   *   glowBulb?: boolean,
   *   opacity?: number,
   *   showMultipleBonds?: boolean,
   *   highlightIndices?: Set<number>
   * }}
   */
  let {
    atoms = [],
    bonds = [],
    getColor = defaultColorScheme,
    quality = 3,
    bondScale = 1.0,
    stickRoundness = 1.0,
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
    showMultipleBonds = true
  } = $props()

  /**
   * PyMOL-style multi-bonds: thin parallel sticks whose outer envelope stays
   * within a single-bond radius (not full-radius sticks spaced far apart).
   * @param {number} order
   * @param {number} bondRadius
   * @returns {{ radiusScale: number, spacing: number }}
   */
  function multiBondLayout(order, bondRadius) {
    const R = Math.max(1e-6, bondRadius)
    if (order <= 1) return { radiusScale: 1, spacing: 0 }
    // Double ~0.36R each; triple thinner — outer edge ≈ R.
    const radiusScale = order === 2 ? 0.36 : 0.28
    const r = R * radiusScale
    const maxK = (order - 1) / 2
    const spacing = maxK > 0 ? ((R - r) / maxK) * 0.92 : 0
    return { radiusScale, spacing }
  }

  /**
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
      if (o >= 2 && o <= 3 && Math.abs(Number(bond[2]) - o) < 1e-6) order = o
    }
    return { i, j, order }
  }

  /** @returns {Map<string, number>} undirected "a:b" → bond order */
  function bondOrderMap() {
    /** @type {Map<string, number>} */
    const map = new Map()
    for (const raw of bonds) {
      const b = parseBond(raw)
      if (!b) continue
      const a = Math.min(b.i, b.j)
      const c = Math.max(b.i, b.j)
      const key = `${a}:${c}`
      map.set(key, Math.max(map.get(key) ?? 1, b.order))
    }
    return map
  }

  /** @param {number} i @param {number} j @param {Map<string, number>} orders */
  function orderBetween(i, j, orders) {
    const a = Math.min(i, j)
    const c = Math.max(i, j)
    return orders.get(`${a}:${c}`) ?? 1
  }

  function uniqueBondEdges() {
    /** @type {Map<string, { i: number, j: number }>} */
    const map = new Map()
    for (const raw of bonds) {
      const b = parseBond(raw)
      if (!b) continue
      const a = Math.min(b.i, b.j)
      const c = Math.max(b.i, b.j)
      map.set(`${a}:${c}`, { i: a, j: c })
    }
    return [...map.values()]
  }

  /** @returns {Array<{ i: number, j: number, order: number, slot: number, slots: number }>} */
  function expandBondInstances() {
    /** @type {Array<{ i: number, j: number, order: number, slot: number, slots: number }>} */
    const instances = []
    for (const raw of bonds) {
      const b = parseBond(raw)
      if (!b) continue
      const order = showMultipleBonds ? b.order : 1
      if (order <= 1) {
        instances.push({ i: b.i, j: b.j, order: 1, slot: 0, slots: 1 })
        continue
      }
      for (let k = 0; k < order; k++) {
        instances.push({ i: b.i, j: b.j, order, slot: k, slots: order })
      }
    }
    return instances
  }

  /**
   * Round sphere caps on degree-1 (terminal) atoms. Flat = closed cylinder ends only.
   * Continuous pipe between bonds is always on.
   */
  function roundTerminalCaps() {
    const r = Number(stickRoundness)
    return !Number.isFinite(r) || r > 0.001
  }

  /** Debounced tessellation so the Quality slider stays fluid while meshes catch up. */
  let appliedSides = $state(resolveCylinderSides(3))
  $effect(() => {
    const target = resolveCylinderSides(quality)
    if (target === appliedSides) return
    const id = setTimeout(() => {
      appliedSides = target
    }, 80)
    return () => clearTimeout(id)
  })

  let bondMeshRef = $state(/** @type {InstancedMesh | null} */ (null))
  let bondOutlineMeshRef = $state(/** @type {InstancedMesh | null} */ (null))
  let capMeshRef = $state(/** @type {InstancedMesh | null} */ (null))
  let capOutlineMeshRef = $state(/** @type {InstancedMesh | null} */ (null))
  let branchMeshRef = $state(/** @type {InstancedMesh | null} */ (null))
  let branchOutlineMeshRef = $state(/** @type {InstancedMesh | null} */ (null))
  let elbowGroupRef = $state(/** @type {Group | null} */ (null))

  /** Shared solid material for elbow meshes (colored via material clones). */
  let elbowBaseMaterial = /** @type {MeshStandardMaterial | MeshToonMaterial | null} */ (null)

  const count = $derived(atoms.length)
  const { camera, invalidate } = useThrelte()
  const _tmpColor = new Color()
  const _tmpEnd = new Color()
  const _elbowMat = new Matrix4()
  const _elbowEls = new Float32Array(16)
  const _bondMid = new Vector3()
  const _lastCamPos = new Vector3(NaN, NaN, NaN)
  const _lastCamQuat = new Quaternion(0, 0, 0, 1)

  /**
   * @param {Atom} atom
   * @param {import('three').Color} [into]
   * @returns {import('three').Color}
   */
  function colorForAtom(atom, into = _tmpColor) {
    into.copy(getColor(atom))
    if (highlightIndices.size > 0 && atom.index != null && highlightIndices.has(atom.index)) {
      into.setRGB(
        Math.min(1, into.r * 1.5 + 0.4),
        Math.min(1, into.g * 1.5 + 0.4),
        Math.min(1, into.b * 1.5 + 0.4)
      )
    }
    return into
  }

  /**
   * @param {InstancedMesh} mesh
   * @param {number} index
   * @param {import('three').Color} color
   */
  function setEndColorAt(mesh, index, color) {
    const attr = /** @type {InstancedBufferAttribute | undefined} */ (
      mesh.geometry.getAttribute('instanceColorEnd')
    )
    if (!attr) return
    attr.setXYZ(index, color.r, color.g, color.b)
  }

  function makeBondMaterial() {
    /** @type {MeshStandardMaterial | MeshToonMaterial} */
    let mat
    if (goodsell) {
      mat = new MeshToonMaterial({ gradientMap: getToonGradientMap() })
    } else {
      mat = new MeshStandardMaterial({
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
    }
    applySplitBondColors(mat)
    return mat
  }

  /** Opaque materials only — never custom discard / sweep-clamp shaders. */
  function makeSolidMaterial() {
    if (goodsell) {
      return new MeshToonMaterial({
        gradientMap: getToonGradientMap(),
        transparent: opacity < 1,
        opacity,
        depthWrite: opacity >= 1
      })
    }
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
    return mat
  }

  /**
   * @param {Atom[]} arr
   */
  function positionsMap(arr) {
    /** @type {Map<number, [number, number, number]>} */
    const m = new Map()
    for (const atom of arr) {
      if (atom.index == null) continue
      m.set(atom.index, [atom.x, atom.y, atom.z])
    }
    return m
  }

  function pipeCounts() {
    const classified = classifyAtoms(buildAdjacency(uniqueBondEdges()))
    const orders = bondOrderMap()
    let caps = 0
    let branches = 0
    let elbows = 0
    const wantCaps = roundTerminalCaps()
    for (const [idx, info] of classified) {
      if (info.degree === 1) {
        if (wantCaps) {
          const n = info.neighbors[0]
          let order = n == null ? 1 : orderBetween(idx, n, orders)
          if (!showMultipleBonds) order = 1
          caps += Math.max(1, order)
        }
      } else if (info.degree === 2) elbows++
      else if (info.degree >= 3) branches++
    }
    return { caps, branches, elbows }
  }

  /**
   * @param {Group} group
   */
  function clearElbowGroup(group) {
    while (group.children.length) {
      const child = /** @type {Mesh} */ (group.children[group.children.length - 1])
      group.remove(child)
      child.geometry?.dispose()
      if (child.material && child.material !== elbowBaseMaterial) {
        const mat = child.material
        if (!Array.isArray(mat)) mat.dispose()
      }
    }
  }

  /**
   * Exact-sweep torus elbows as ordinary Meshes in a Group (stable with Threlte;
   * BatchedMesh was going transparent / vanishing on option rebuilds).
   * @param {Group} group
   * @param {ReturnType<typeof computeElbows>} elbows
   * @param {Map<any, Atom>} atom_by_index
   * @param {number} stickRadius
   * @param {boolean} updateColors
   * @param {number} radial
   * @param {number} tubularPerPi
   */
  function syncElbows(group, elbows, atom_by_index, stickRadius, updateColors, radial, tubularPerPi) {
    const bendR = pipeBendRadius(stickRadius)
    const tubeR = stickRadius * ELBOW_TUBE_SCALE
    if (!elbowBaseMaterial) elbowBaseMaterial = makeSolidMaterial()

    // Resize child list to match elbow count
    while (group.children.length > elbows.length) {
      const child = /** @type {Mesh} */ (group.children[group.children.length - 1])
      group.remove(child)
      child.geometry?.dispose()
      if (child.material && child.material !== elbowBaseMaterial) {
        const mat = child.material
        if (!Array.isArray(mat)) mat.dispose()
      }
    }
    while (group.children.length < elbows.length) {
      const mat = elbowBaseMaterial.clone()
      const mesh = new Mesh(new TorusGeometry(bendR, tubeR, radial, 8, Math.PI / 2), mat)
      mesh.matrixAutoUpdate = false
      mesh.frustumCulled = false
      mesh.renderOrder = 2
      group.add(mesh)
    }

    for (let i = 0; i < elbows.length; i++) {
      const elbow = elbows[i]
      const mesh = /** @type {Mesh} */ (group.children[i])
      const tubular = Math.max(6, Math.ceil((elbow.sweep / Math.PI) * tubularPerPi))
      const prevSweep = mesh.userData.sweep ?? -1
      if (Math.abs(prevSweep - elbow.sweep) > 1e-3 || mesh.userData.bendR !== bendR) {
        mesh.geometry.dispose()
        mesh.geometry = new TorusGeometry(bendR, tubeR, radial, tubular, elbow.sweep)
        mesh.userData.sweep = elbow.sweep
        mesh.userData.bendR = bendR
      }

      elbowFrameMatrixElements(elbow, _elbowEls)
      _elbowMat.fromArray(_elbowEls)
      mesh.matrix.copy(_elbowMat)
      mesh.matrixWorldNeedsUpdate = true

      if (updateColors) {
        const atom = atom_by_index.get(elbow.atomIndex)
        if (atom && mesh.material && !Array.isArray(mesh.material) && 'color' in mesh.material) {
          mesh.material.color.copy(colorForAtom(atom, _tmpColor))
        }
      }
    }
  }

  /**
   * @param {number} stickCount
   * @param {{ caps: number, branches: number, elbows: number }} pipe
   * @param {boolean} showOutlines
   */
  function buildMeshes(stickCount, pipe, showOutlines) {
    const cr = appliedSides
    // Joint/terminal spheres must match cylinder density — 0.75× lagged behind and
    // left visible teeth at branch seams once cylinder sides exceeded ~150.
    const sphereWidth = Math.max(8, cr)
    const sphereHeight = Math.max(8, Math.ceil(sphereWidth / 2))
    const bondRadius = BOND_RADIUS * bondScale
    const n = Math.max(stickCount, 1)

    const cylGeom = new CylinderGeometry(bondRadius, bondRadius, 1, cr, 1, false)
    cylGeom.setAttribute('instanceColorEnd', new InstancedBufferAttribute(new Float32Array(n * 3), 3))

    const bondMesh = new InstancedMesh(cylGeom, makeBondMaterial(), n)
    bondMesh.renderOrder = 1
    bondMesh.instanceColor = new InstancedBufferAttribute(new Float32Array(n * 3), 3)
    bondMesh.count = stickCount
    if (bondMesh.material && !Array.isArray(bondMesh.material)) {
      // Reduce z-fight sparkle where sticks meet branch spheres / elbows
      bondMesh.material.polygonOffset = true
      bondMesh.material.polygonOffsetFactor = 1
      bondMesh.material.polygonOffsetUnits = 1
    }

    /** @type {InstancedMesh | null} */
    let bondOutlineMesh = null
    if (showOutlines && stickCount > 0) {
      bondOutlineMesh = new InstancedMesh(
        new CylinderGeometry(bondRadius + outlineWidth, bondRadius + outlineWidth, 1, cr, 1, false),
        new MeshBasicMaterial({
          color: outlineColor,
          depthWrite: false,
          transparent: opacity < 1,
          opacity
        }),
        stickCount
      )
      bondOutlineMesh.renderOrder = 0
    }

    /** @type {InstancedMesh | null} */
    let capMesh = null
    /** @type {InstancedMesh | null} */
    let capOutlineMesh = null
    if (pipe.caps > 0) {
      const capGeom = new SphereGeometry(1, sphereWidth, sphereHeight)
      capMesh = new InstancedMesh(capGeom, makeSolidMaterial(), pipe.caps)
      capMesh.renderOrder = 2
      capMesh.instanceColor = new InstancedBufferAttribute(new Float32Array(pipe.caps * 3), 3)
      capMesh.count = pipe.caps
      if (showOutlines) {
        capOutlineMesh = new InstancedMesh(
          capGeom.clone(),
          new MeshBasicMaterial({
            color: outlineColor,
            depthWrite: false,
            transparent: opacity < 1,
            opacity
          }),
          pipe.caps
        )
        capOutlineMesh.renderOrder = 0
      }
    }

    /** @type {InstancedMesh | null} */
    let branchMesh = null
    /** @type {InstancedMesh | null} */
    let branchOutlineMesh = null
    if (pipe.branches > 0) {
      // Dense UV sphere (not low-detail icosa) — multi-bond seams need the extra faces.
      const branchGeom = new SphereGeometry(1, sphereWidth, sphereHeight)
      branchMesh = new InstancedMesh(branchGeom, makeSolidMaterial(), pipe.branches)
      branchMesh.renderOrder = 2
      branchMesh.instanceColor = new InstancedBufferAttribute(new Float32Array(pipe.branches * 3), 3)
      branchMesh.count = pipe.branches
      if (showOutlines) {
        branchOutlineMesh = new InstancedMesh(
          branchGeom.clone(),
          new MeshBasicMaterial({
            color: outlineColor,
            depthWrite: false,
            transparent: opacity < 1,
            opacity
          }),
          pipe.branches
        )
        branchOutlineMesh.renderOrder = 0
      }
    }

    /** @type {Group | null} */
    let elbowGroup = null
    if (pipe.elbows > 0) {
      elbowBaseMaterial?.dispose()
      elbowBaseMaterial = makeSolidMaterial()
      elbowGroup = new Group()
      elbowGroup.frustumCulled = false
    } else {
      elbowBaseMaterial?.dispose()
      elbowBaseMaterial = null
    }

    return {
      bondMesh,
      bondOutlineMesh,
      capMesh,
      capOutlineMesh,
      branchMesh,
      branchOutlineMesh,
      elbowGroup
    }
  }

  /**
   * @param {ReturnType<typeof buildMeshes>} meshes
   * @param {Atom[]} arr
   * @param {boolean} [updateColors=true]
   */
  function updateMatrices(meshes, arr, updateColors = true) {
    const {
      bondMesh,
      bondOutlineMesh,
      capMesh,
      capOutlineMesh,
      branchMesh,
      branchOutlineMesh,
      elbowGroup
    } = meshes
    if (!bondMesh) return 0
    const bondInstances = expandBondInstances()
    if (bondInstances.length > bondMesh.instanceMatrix.count) return bondInstances.length

    const bondRadius = BOND_RADIUS * bondScale
    const wantCaps = roundTerminalCaps()
    const atom_by_index = new Map(arr.map((atom) => [atom.index, atom]))
    const positions = positionsMap(arr)
    const orders = bondOrderMap()

    const edges = uniqueBondEdges()
    const adjacency = buildAdjacency(edges)
    const classified = classifyAtoms(adjacency)
    const endAdj = computeEndAdjustments(classified, positions, bondRadius)
    const terminals = wantCaps ? computeTerminals(classified) : []
    const branches = computeBranchJoints(classified)
    const elbows = computeElbows(classified, positions, bondRadius)

    const cylMatrix = new Matrix4()
    const cylQuat = new Quaternion()
    const cylScale = new Vector3()
    const cylPos = new Vector3()
    const dir = new Vector3()
    const pa = new Vector3()
    const pb = new Vector3()
    const yAxis = new Vector3(0, 1, 0)
    const offsetAxis = new Vector3()
    const jointMatrix = new Matrix4()
    const jointQuat = new Quaternion()
    const jointScale = new Vector3(bondRadius, bondRadius, bondRadius)
    const jointPos = new Vector3()

    let written = 0

    for (const { i, j, order, slot, slots } of bondInstances) {
      const ai = atom_by_index.get(i) ?? (arr[i]?.index === i ? arr[i] : undefined)
      const aj = atom_by_index.get(j) ?? (arr[j]?.index === j ? arr[j] : undefined)
      if (!ai || !aj) continue

      pa.set(ai.x, ai.y, ai.z)
      pb.set(aj.x, aj.y, aj.z)
      dir.copy(pb).sub(pa)
      if (dir.lengthSq() < 1e-12) continue
      dir.normalize()

      const { radiusScale, spacing } = multiBondLayout(order, bondRadius)
      const offset = order <= 1 ? 0 : (slot - (slots - 1) / 2) * spacing

      if (Math.abs(offset) > 1e-8) {
        _bondMid.copy(pa).add(pb).multiplyScalar(0.5)
        setMultiBondOffsetAxis(dir, _bondMid, camera.current?.position, offsetAxis)
        pa.addScaledVector(offsetAxis, offset)
        pb.addScaledVector(offsetAxis, offset)
        dir.copy(pb).sub(pa).normalize()
      }

      let fullLen = pa.distanceTo(pb)

      if (endAdj) {
        const adjA = endAdj.get(i)?.get(j) ?? 0
        const adjB = endAdj.get(j)?.get(i) ?? 0
        const ep = stickEndpoints([pa.x, pa.y, pa.z], [pb.x, pb.y, pb.z], adjA, adjB)
        if (!ep) continue
        pa.set(ep.start[0], ep.start[1], ep.start[2])
        pb.set(ep.end[0], ep.end[1], ep.end[2])
        fullLen = ep.length
        dir.set(ep.dir[0], ep.dir[1], ep.dir[2])
      }

      cylPos.copy(pa).add(pb).multiplyScalar(0.5)
      cylQuat.setFromUnitVectors(yAxis, dir)
      cylScale.set(radiusScale, Math.max(fullLen, 1e-4), radiusScale)
      cylMatrix.compose(cylPos, cylQuat, cylScale)
      bondMesh.setMatrixAt(written, cylMatrix)
      if (updateColors) {
        bondMesh.setColorAt(written, colorForAtom(ai, _tmpColor))
        setEndColorAt(bondMesh, written, colorForAtom(aj, _tmpEnd))
      }
      if (bondOutlineMesh) {
        // Outline geom is already bondRadius+outlineWidth; only thin for multi-bonds.
        cylScale.set(radiusScale, Math.max(fullLen, 1e-4), radiusScale)
        cylMatrix.compose(cylPos, cylQuat, cylScale)
        bondOutlineMesh.setMatrixAt(written, cylMatrix)
      }
      written++
    }

    bondMesh.count = written
    bondMesh.instanceMatrix.needsUpdate = true
    if (updateColors) {
      if (bondMesh.instanceColor) bondMesh.instanceColor.needsUpdate = true
      const endAttr = bondMesh.geometry.getAttribute('instanceColorEnd')
      if (endAttr) endAttr.needsUpdate = true
    }
    if (bondOutlineMesh) {
      bondOutlineMesh.count = written
      bondOutlineMesh.instanceMatrix.needsUpdate = true
    }

    if (capMesh && wantCaps) {
      let cWritten = 0
      for (const idx of terminals) {
        const atom = atom_by_index.get(idx)
        if (!atom) continue
        const info = classified.get(idx)
        const nIdx = info?.neighbors?.[0]
        let order = nIdx == null ? 1 : orderBetween(idx, nIdx, orders)
        if (!showMultipleBonds) order = 1
        const { radiusScale, spacing } = multiBondLayout(order, bondRadius)

        offsetAxis.set(0, 0, 0)
        if (order >= 2 && nIdx != null) {
          const nb = atom_by_index.get(nIdx)
          if (nb) {
            dir.set(nb.x - atom.x, nb.y - atom.y, nb.z - atom.z)
            if (dir.lengthSq() > 1e-12) {
              dir.normalize()
              _bondMid.set(atom.x, atom.y, atom.z)
              setMultiBondOffsetAxis(dir, _bondMid, camera.current?.position, offsetAxis)
            }
          }
        }

        const slots = Math.max(1, order)
        for (let slot = 0; slot < slots; slot++) {
          if (cWritten >= capMesh.instanceMatrix.count) break
          const off = order <= 1 ? 0 : (slot - (slots - 1) / 2) * spacing
          const capR = bondRadius * radiusScale
          jointPos.set(atom.x, atom.y, atom.z)
          if (Math.abs(off) > 1e-8) jointPos.addScaledVector(offsetAxis, off)
          jointScale.set(capR, capR, capR)
          jointMatrix.compose(jointPos, jointQuat, jointScale)
          capMesh.setMatrixAt(cWritten, jointMatrix)
          if (updateColors) capMesh.setColorAt(cWritten, colorForAtom(atom, _tmpColor))
          if (capOutlineMesh) {
            const oR = capR + outlineWidth
            jointScale.set(oR, oR, oR)
            jointMatrix.compose(jointPos, jointQuat, jointScale)
            capOutlineMesh.setMatrixAt(cWritten, jointMatrix)
          }
          cWritten++
        }
      }
      capMesh.count = cWritten
      capMesh.instanceMatrix.needsUpdate = true
      if (updateColors && capMesh.instanceColor) capMesh.instanceColor.needsUpdate = true
      if (capOutlineMesh) {
        capOutlineMesh.count = cWritten
        capOutlineMesh.instanceMatrix.needsUpdate = true
      }
    }

    if (branchMesh) {
      let bWritten = 0
      const branchR = bondRadius * BRANCH_SPHERE_SCALE
      const outlineR = branchR + outlineWidth
      for (const idx of branches) {
        if (bWritten >= branchMesh.instanceMatrix.count) break
        const atom = atom_by_index.get(idx)
        if (!atom) continue
        jointPos.set(atom.x, atom.y, atom.z)
        jointScale.set(branchR, branchR, branchR)
        jointMatrix.compose(jointPos, jointQuat, jointScale)
        branchMesh.setMatrixAt(bWritten, jointMatrix)
        if (updateColors) branchMesh.setColorAt(bWritten, colorForAtom(atom, _tmpColor))
        if (branchOutlineMesh) {
          jointScale.set(outlineR, outlineR, outlineR)
          jointMatrix.compose(jointPos, jointQuat, jointScale)
          branchOutlineMesh.setMatrixAt(bWritten, jointMatrix)
          jointScale.set(bondRadius, bondRadius, bondRadius)
        }
        bWritten++
      }
      branchMesh.count = bWritten
      branchMesh.instanceMatrix.needsUpdate = true
      if (updateColors && branchMesh.instanceColor) branchMesh.instanceColor.needsUpdate = true
      if (branchOutlineMesh) {
        branchOutlineMesh.count = bWritten
        branchOutlineMesh.instanceMatrix.needsUpdate = true
      }
    }

    if (elbowGroup) {
      const cr = appliedSides
      const radial = Math.max(8, Math.floor(cr / 2))
      const tubularPerPi = Math.max(8, Math.round(cr * 0.4))
      // Always refresh colors when rebuilding elbow list so option toggles don't leave gaps
      // with invisible / uncolored elbows.
      syncElbows(
        elbowGroup,
        elbows,
        atom_by_index,
        bondRadius,
        updateColors || elbows.length !== elbowGroup.children.length,
        radial,
        tubularPerPi
      )
    }

    return written
  }

  function updateColorsOnly() {
    const bondMesh = bondMeshRef
    const capMesh = capMeshRef
    const branchMesh = branchMeshRef
    const elbowGroup = elbowGroupRef
    if (!bondMesh) return
    const bondInstances = expandBondInstances()
    const atom_by_index = new Map(atoms.map((atom) => [atom.index, atom]))
    let written = 0
    for (const { i, j } of bondInstances) {
      const ai = atom_by_index.get(i) ?? (atoms[i]?.index === i ? atoms[i] : undefined)
      const aj = atom_by_index.get(j) ?? (atoms[j]?.index === j ? atoms[j] : undefined)
      if (!ai || !aj) continue
      bondMesh.setColorAt(written, colorForAtom(ai, _tmpColor))
      setEndColorAt(bondMesh, written, colorForAtom(aj, _tmpEnd))
      written++
    }
    if (bondMesh.instanceColor) bondMesh.instanceColor.needsUpdate = true
    const endAttr = bondMesh.geometry.getAttribute('instanceColorEnd')
    if (endAttr) endAttr.needsUpdate = true

    const classified = classifyAtoms(buildAdjacency(uniqueBondEdges()))
    if (capMesh && roundTerminalCaps()) {
      const terminals = computeTerminals(classified)
      const orders = bondOrderMap()
      let c = 0
      for (const idx of terminals) {
        const atom = atom_by_index.get(idx)
        if (!atom) continue
        const nIdx = classified.get(idx)?.neighbors?.[0]
        let order = nIdx == null ? 1 : orderBetween(idx, nIdx, orders)
        if (!showMultipleBonds) order = 1
        const slots = Math.max(1, order)
        for (let s = 0; s < slots; s++) {
          if (c >= capMesh.instanceMatrix.count) break
          capMesh.setColorAt(c, colorForAtom(atom, _tmpColor))
          c++
        }
      }
      if (capMesh.instanceColor) capMesh.instanceColor.needsUpdate = true
    }
    if (branchMesh) {
      const branches = computeBranchJoints(classified)
      let b = 0
      for (const idx of branches) {
        if (b >= branchMesh.instanceMatrix.count) break
        const atom = atom_by_index.get(idx)
        if (atom) branchMesh.setColorAt(b, colorForAtom(atom, _tmpColor))
        b++
      }
      if (branchMesh.instanceColor) branchMesh.instanceColor.needsUpdate = true
    }
    if (elbowGroup) {
      const positions = positionsMap(atoms)
      const elbows = computeElbows(classified, positions, BOND_RADIUS * bondScale)
      for (let i = 0; i < elbows.length && i < elbowGroup.children.length; i++) {
        const mesh = /** @type {Mesh} */ (elbowGroup.children[i])
        const atom = atom_by_index.get(elbows[i].atomIndex)
        if (atom && mesh.material && !Array.isArray(mesh.material) && 'color' in mesh.material) {
          mesh.material.color.copy(colorForAtom(atom, _tmpColor))
        }
      }
    }
    invalidate()
  }

  /** @param {ReturnType<typeof buildMeshes>} built */
  function disposeBuilt(built) {
    built.bondMesh?.dispose()
    built.bondOutlineMesh?.dispose()
    built.capMesh?.dispose()
    built.capOutlineMesh?.dispose()
    built.branchMesh?.dispose()
    built.branchOutlineMesh?.dispose()
    if (built.elbowGroup) {
      clearElbowGroup(built.elbowGroup)
    }
    elbowBaseMaterial?.dispose()
    elbowBaseMaterial = null
  }

  function clearRefs() {
    bondMeshRef = null
    bondOutlineMeshRef = null
    capMeshRef = null
    capOutlineMeshRef = null
    branchMeshRef = null
    branchOutlineMeshRef = null
    elbowGroupRef = null
  }

  function currentMeshes() {
    return {
      bondMesh: bondMeshRef,
      bondOutlineMesh: bondOutlineMeshRef,
      capMesh: capMeshRef,
      capOutlineMesh: capOutlineMeshRef,
      branchMesh: branchMeshRef,
      branchOutlineMesh: branchOutlineMeshRef,
      elbowGroup: elbowGroupRef
    }
  }

  function hasMultiBonds() {
    if (!showMultipleBonds) return false
    for (const raw of bonds) {
      const b = parseBond(raw)
      if (b && b.order >= 2) return true
    }
    return false
  }

  // Re-orient multi-bond offsets as the camera orbits so double bonds stay visible.
  useTask(() => {
    if (!bondMeshRef || !hasMultiBonds()) return
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
    updateMatrices(untrack(() => currentMeshes()), untrack(() => atoms), false)
    invalidate()
  })

  // Single owner for mesh construction — avoids BatchedMesh/effect races that
  // left shortened sticks without elbows after option clicks.
  $effect(() => {
    void count
    void bonds
    void showMultipleBonds
    void stickRoundness
    void bondScale
    void appliedSides
    void goodsell
    void outlinesEnabled
    void outlineWidth
    void outlineColor
    void metalness
    void roughness
    void emissiveIntensity
    void glowBulb
    const stickCount = expandBondInstances().length
    if (stickCount < 1) {
      clearRefs()
      return
    }
    const pipe = pipeCounts()
    const showOutlines = goodsell && outlinesEnabled && outlineWidth > 0
    const built = buildMeshes(stickCount, pipe, showOutlines)
    bondMeshRef = built.bondMesh
    bondOutlineMeshRef = built.bondOutlineMesh
    capMeshRef = built.capMesh
    capOutlineMeshRef = built.capOutlineMesh
    branchMeshRef = built.branchMesh
    branchOutlineMeshRef = built.branchOutlineMesh
    elbowGroupRef = built.elbowGroup
    updateMatrices(built, untrack(() => atoms), true)
    invalidate()
    return () => {
      disposeBuilt(built)
      clearRefs()
    }
  })

  $effect(() => {
    void atoms
    void bonds
    void showMultipleBonds
    const meshes = untrack(() => currentMeshes())
    if (!meshes.bondMesh) return
    // If topology outgrew capacity, the build effect will recreate; skip here.
    const need = expandBondInstances().length
    if (need > meshes.bondMesh.instanceMatrix.count) return
    updateMatrices(meshes, atoms, false)
    invalidate()
  })

  $effect(() => {
    void getColor
    void highlightIndices
    if (!bondMeshRef) return
    updateColorsOnly()
  })

  $effect(() => {
    const op = opacity
    for (const mesh of [
      untrack(() => bondMeshRef),
      untrack(() => bondOutlineMeshRef),
      untrack(() => capMeshRef),
      untrack(() => capOutlineMeshRef),
      untrack(() => branchMeshRef),
      untrack(() => branchOutlineMeshRef)
    ]) {
      if (!mesh) continue
      const mat = mesh.material
      if (Array.isArray(mat)) continue
      mat.opacity = op
      mat.transparent = op < 1
      if ('depthWrite' in mat) mat.depthWrite = op >= 1
      mat.needsUpdate = true
    }
    const group = untrack(() => elbowGroupRef)
    if (group) {
      for (const child of group.children) {
        const mesh = /** @type {Mesh} */ (child)
        const mat = mesh.material
        if (Array.isArray(mat)) continue
        mat.opacity = op
        mat.transparent = op < 1
        if ('depthWrite' in mat) mat.depthWrite = op >= 1
        mat.needsUpdate = true
      }
    }
    if (elbowBaseMaterial) {
      elbowBaseMaterial.opacity = op
      elbowBaseMaterial.transparent = op < 1
      elbowBaseMaterial.depthWrite = op >= 1
      elbowBaseMaterial.needsUpdate = true
    }
    invalidate()
  })
</script>

{#if bondOutlineMeshRef}
  <T is={bondOutlineMeshRef} />
{/if}
{#if capOutlineMeshRef}
  <T is={capOutlineMeshRef} />
{/if}
{#if branchOutlineMeshRef}
  <T is={branchOutlineMeshRef} />
{/if}
{#if bondMeshRef}
  <T is={bondMeshRef} />
{/if}
{#if elbowGroupRef}
  <T is={elbowGroupRef} />
{/if}
{#if branchMeshRef}
  <T is={branchMeshRef} />
{/if}
{#if capMeshRef}
  <T is={capMeshRef} />
{/if}
