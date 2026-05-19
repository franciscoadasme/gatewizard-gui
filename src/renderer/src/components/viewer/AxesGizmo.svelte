<script>
  import { Canvas as ThrelteCanvas, T } from '@threlte/core'
  import {
    BufferGeometry,
    CanvasTexture,
    Group,
    Line,
    LineBasicMaterial,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    Quaternion,
    Raycaster,
    SphereGeometry,
    Sprite,
    SpriteMaterial,
    Vector2,
    Vector3
  } from 'three'
  import AxesGizmoScene from './AxesGizmoScene.svelte'
  import { gizmoCamera } from './AxesGizmoScene.svelte'
  import { mainViewerCamera, mainViewerInvalidate } from './CameraRig.svelte'
  import { mainViewerControls } from './Canvas.svelte'

  const LINE_LENGTH = 0.65
  const SPHERE_SCALE = 0.46
  const CANVAS_SIZE = 128
  const NEG_MAX_FILL = 0.7

  const AXES = [
    {
      label: 'X',
      color: '#e03030',
      dir: new Vector3(1, 0, 0),
      negDir: new Vector3(-1, 0, 0),
      posUp: new Vector3(0, 1, 0),
      negUp: new Vector3(0, 1, 0)
    },
    {
      label: 'Y',
      color: '#38c038',
      dir: new Vector3(0, 1, 0),
      negDir: new Vector3(0, -1, 0),
      posUp: new Vector3(0, 0, -1),
      negUp: new Vector3(0, 0, 1)
    },
    {
      label: 'Z',
      color: '#3048e0',
      dir: new Vector3(0, 0, 1),
      negDir: new Vector3(0, 0, -1),
      posUp: new Vector3(0, 1, 0),
      negUp: new Vector3(0, 1, 0)
    }
  ]

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} color
   * @param {string | null} label
   * @param {boolean} hovered
   * @param {boolean}  isPos       true = positive (solid, black label); false = negative (outline + interpolated fill)
   * @param {number}   [fillAlpha=1]  0–NEG_MAX_FILL; ignored for isPos=true
   */
  function drawCircle(ctx, color, label, hovered, isPos, fillAlpha = 1) {
    const sz = CANVAS_SIZE
    ctx.clearRect(0, 0, sz, sz)
    const cx = sz / 2
    const r = sz * 0.35

    if (isPos) {
      ctx.beginPath()
      ctx.arc(cx, cx, r, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
    } else {
      if (fillAlpha > 0.01) {
        ctx.globalAlpha = fillAlpha
        ctx.beginPath()
        ctx.arc(cx, cx, r, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()
        ctx.globalAlpha = 1.0
      }
      ctx.beginPath()
      ctx.arc(cx, cx, r, 0, Math.PI * 2)
      ctx.strokeStyle = color
      ctx.lineWidth = 8
      ctx.stroke()
    }

    if (hovered) {
      ctx.beginPath()
      ctx.arc(cx, cx, isPos ? r - 9 : r + 9, 0, Math.PI * 2)
      ctx.strokeStyle = '#ffdd00'
      ctx.lineWidth = 13
      ctx.stroke()
    }

    if (label) {
      ctx.font = 'bold 56px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = isPos ? '#000000' : '#ffffff'
      ctx.fillText(label, cx, cx)
    }
  }

  let gizmoRoot = $state(/** @type {Group | null} */ (null))

  /** @type {{ mesh: import('three').Mesh, dir: import('three').Vector3, up: import('three').Vector3 }[]} */
  let hitObjects = []

  /**
   * @type {{
   *   mesh: import('three').Mesh,
   *   sprite: import('three').Sprite,
   *   canvas: HTMLCanvasElement,
   *   ctx: CanvasRenderingContext2D,
   *   color: string,
   *   label: string,
   *   isNeg: boolean,
   *   axisDir: import('three').Vector3,
   *   fillAlpha: number
   * }[]}
   */
  let sphereRefs = []

  /** @type {import('three').Mesh | null} */
  let hoveredMesh = null

  const _raycaster = new Raycaster()
  const _mouse = new Vector2()
  const _camDir = new Vector3()

  // ── Camera snap animation ────────────────────────────────────────────
  const SNAP_DURATION = 380 // ms
  let _snapAnimating = false
  let _snapStartTime = 0
  const _snapStartQuat = new Quaternion()
  const _snapEndQuat = new Quaternion()
  const _snapCurrQuat = new Quaternion()
  const _snapTarget = new Vector3()
  const _snapLookMat = new Matrix4()
  const _snapTmpVec = new Vector3()
  let _snapDist = 0

  /**
   * @param {import('three').Vector3} dir
   * @param {import('three').Vector3} up
   */
  function snapCamera(dir, up) {
    const cam = mainViewerCamera.current
    const ctrl = mainViewerControls.current
    if (!cam || !ctrl || !('target' in ctrl)) return

    _snapTarget.copy(ctrl.target)
    _snapDist = cam.position.distanceTo(_snapTarget)

    // Start quaternion = current camera orientation
    _snapStartQuat.copy(cam.quaternion)

    // End quaternion = lookAt from (target + dir*dist) toward target with given up
    _snapTmpVec.copy(_snapTarget).addScaledVector(dir, _snapDist)
    _snapLookMat.lookAt(_snapTmpVec, _snapTarget, up)
    _snapEndQuat.setFromRotationMatrix(_snapLookMat)

    // If already animating, restart from current position
    _snapStartTime = performance.now()
    if (!_snapAnimating) {
      _snapAnimating = true
      _snapAnimFrame()
    }
  }

  function _snapAnimFrame() {
    const cam = mainViewerCamera.current
    const ctrl = mainViewerControls.current
    if (!cam || !ctrl) {
      _snapAnimating = false
      return
    }

    const elapsed = performance.now() - _snapStartTime
    const rawT = Math.min(elapsed / SNAP_DURATION, 1)
    // Ease-out cubic: fast start, smooth stop
    const t = 1 - Math.pow(1 - rawT, 3)

    _snapCurrQuat.copy(_snapStartQuat).slerp(_snapEndQuat, t)

    // +Z in camera local space = direction from target toward camera
    _snapTmpVec.set(0, 0, 1).applyQuaternion(_snapCurrQuat)
    cam.position.copy(_snapTarget).addScaledVector(_snapTmpVec, _snapDist)

    // +Y in camera local space = camera up
    cam.up.set(0, 1, 0).applyQuaternion(_snapCurrQuat)

    cam.lookAt(_snapTarget)
    if (typeof ctrl.update === 'function') ctrl.update()
    mainViewerInvalidate.fn()

    if (rawT < 1) {
      requestAnimationFrame(_snapAnimFrame)
    } else {
      _snapAnimating = false
    }
  }

  /** @param {MouseEvent} e */
  function getMouseNDC(e) {
    const rect = /** @type {HTMLElement} */ (e.currentTarget).getBoundingClientRect()
    _mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    _mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
  }

  /** @param {MouseEvent} e */
  function handleMouseMove(e) {
    const cam = gizmoCamera.current
    if (!cam || hitObjects.length === 0) return
    getMouseNDC(e)
    _raycaster.setFromCamera(_mouse, cam)
    const hits = _raycaster.intersectObjects(hitObjects.map((h) => h.mesh))
    const newMesh =
      hits.length > 0 ? (hitObjects.find((h) => h.mesh === hits[0].object)?.mesh ?? null) : null
    if (newMesh === hoveredMesh) return

    if (hoveredMesh) {
      const ref = sphereRefs.find((r) => r.mesh === hoveredMesh)
      if (ref) {
        drawCircle(
          ref.ctx,
          ref.color,
          ref.isNeg ? null : ref.label,
          false,
          !ref.isNeg,
          ref.fillAlpha
        )
        ref.sprite.material.map.needsUpdate = true
      }
    }
    if (newMesh) {
      const ref = sphereRefs.find((r) => r.mesh === newMesh)
      if (ref) {
        const displayLabel = ref.isNeg ? `-${ref.label}` : ref.label
        drawCircle(ref.ctx, ref.color, displayLabel, true, !ref.isNeg, ref.fillAlpha)
        ref.sprite.material.map.needsUpdate = true
      }
    }
    hoveredMesh = newMesh
  }

  function handleMouseLeave() {
    if (!hoveredMesh) return
    const ref = sphereRefs.find((r) => r.mesh === hoveredMesh)
    if (ref) {
      drawCircle(ref.ctx, ref.color, ref.isNeg ? null : ref.label, false, !ref.isNeg, ref.fillAlpha)
      ref.sprite.material.map.needsUpdate = true
    }
    hoveredMesh = null
  }

  /** @param {MouseEvent} e */
  function handleClick(e) {
    const cam = gizmoCamera.current
    if (!cam || hitObjects.length === 0) return
    getMouseNDC(e)
    _raycaster.setFromCamera(_mouse, cam)
    const hits = _raycaster.intersectObjects(hitObjects.map((h) => h.mesh))
    if (hits.length > 0) {
      const hit = hitObjects.find((h) => h.mesh === hits[0].object)
      if (hit) snapCamera(hit.dir, hit.up)
    }
  }

  /** @param {import('three').Camera} mini */
  function onFrame(mini) {
    if (sphereRefs.length === 0) return
    _camDir.copy(mini.position).normalize()
    for (const ref of sphereRefs) {
      if (!ref.isNeg) continue
      const dot = ref.axisDir.dot(_camDir)
      const newFillAlpha = Math.min(NEG_MAX_FILL, Math.max(0, dot))
      if (Math.abs(newFillAlpha - ref.fillAlpha) < 0.012) continue
      ref.fillAlpha = newFillAlpha
      const negInFront = dot > 0
      const isHovered = ref.mesh === hoveredMesh
      drawCircle(
        ref.ctx,
        ref.color,
        isHovered ? `-${ref.label}` : null,
        isHovered,
        false,
        newFillAlpha
      )
      ref.sprite.material.map.needsUpdate = true
      ref.sprite.renderOrder = negInFront ? 1003 : 1001
      ref.mesh.renderOrder = negInFront ? 1004 : 1002
      const posRef = sphereRefs.find((r) => !r.isNeg && r.label === ref.label)
      if (posRef) {
        posRef.sprite.renderOrder = negInFront ? 1001 : 1003
        posRef.mesh.renderOrder = negInFront ? 1002 : 1004
        posRef.sprite.material.opacity = 1 - newFillAlpha * 0.05
        posRef.sprite.material.needsUpdate = true
      }
    }
  }

  $effect(() => {
    const group = new Group()
    group.renderOrder = 1000
    group.frustumCulled = false

    /** @type {typeof hitObjects} */
    const localHits = []
    /** @type {typeof sphereRefs} */
    const localRefs = []
    /** @type {import('three').BufferGeometry[]} */
    const geometries = []
    /** @type {import('three').Material[]} */
    const materials = []
    /** @type {import('three').Texture[]} */
    const textures = []

    const hitGeo = new SphereGeometry(0.22, 8, 8)
    geometries.push(hitGeo)

    for (const axis of AXES) {
      // ── Positive line ──────────────────────────────────────────────
      const posLineMat = new LineBasicMaterial({ color: axis.color })
      materials.push(posLineMat)
      const posLineGeo = new BufferGeometry().setFromPoints([
        new Vector3(0, 0, 0),
        axis.dir.clone().multiplyScalar(LINE_LENGTH)
      ])
      geometries.push(posLineGeo)
      const posLine = new Line(posLineGeo, posLineMat)
      posLine.renderOrder = 999
      posLine.frustumCulled = false
      group.add(posLine)

      // ── Positive sprite (solid fill, black label) ──────────────────
      const posCanvas = document.createElement('canvas')
      posCanvas.width = CANVAS_SIZE
      posCanvas.height = CANVAS_SIZE
      const posCtx = /** @type {CanvasRenderingContext2D} */ (posCanvas.getContext('2d'))
      drawCircle(posCtx, axis.color, axis.label, false, true)
      const posTex = new CanvasTexture(posCanvas)
      textures.push(posTex)
      const posSpriteMat = new SpriteMaterial({
        map: posTex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        opacity: 1
      })
      materials.push(posSpriteMat)
      const posSprite = new Sprite(posSpriteMat)
      posSprite.renderOrder = 1003
      posSprite.frustumCulled = false
      posSprite.position.copy(axis.dir).multiplyScalar(LINE_LENGTH)
      posSprite.scale.set(SPHERE_SCALE, SPHERE_SCALE, SPHERE_SCALE)
      group.add(posSprite)

      const posHitMat = new MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false })
      materials.push(posHitMat)
      const posHit = new Mesh(hitGeo, posHitMat)
      posHit.renderOrder = 1004
      posHit.frustumCulled = false
      posHit.position.copy(axis.dir).multiplyScalar(LINE_LENGTH)
      group.add(posHit)
      localHits.push({ mesh: posHit, dir: axis.dir.clone(), up: axis.posUp.clone() })
      localRefs.push({
        mesh: posHit,
        sprite: posSprite,
        canvas: posCanvas,
        ctx: posCtx,
        color: axis.color,
        label: axis.label,
        isNeg: false,
        axisDir: axis.dir.clone(),
        fillAlpha: 1
      })

      // ── Negative sprite (same size, starts as outline when behind) ─
      const negCanvas = document.createElement('canvas')
      negCanvas.width = CANVAS_SIZE
      negCanvas.height = CANVAS_SIZE
      const negCtx = /** @type {CanvasRenderingContext2D} */ (negCanvas.getContext('2d'))
      drawCircle(negCtx, axis.color, null, false, false, 0)
      const negTex = new CanvasTexture(negCanvas)
      textures.push(negTex)
      const negSpriteMat = new SpriteMaterial({
        map: negTex,
        transparent: true,
        depthTest: false,
        depthWrite: false
      })
      materials.push(negSpriteMat)
      const negSprite = new Sprite(negSpriteMat)
      negSprite.renderOrder = 1001
      negSprite.frustumCulled = false
      negSprite.position.copy(axis.negDir).multiplyScalar(LINE_LENGTH)
      negSprite.scale.set(SPHERE_SCALE, SPHERE_SCALE, SPHERE_SCALE)
      group.add(negSprite)

      const negHitMat = new MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false })
      materials.push(negHitMat)
      const negHit = new Mesh(hitGeo, negHitMat)
      negHit.renderOrder = 1002
      negHit.frustumCulled = false
      negHit.position.copy(axis.negDir).multiplyScalar(LINE_LENGTH)
      group.add(negHit)
      localHits.push({ mesh: negHit, dir: axis.negDir.clone(), up: axis.negUp.clone() })
      localRefs.push({
        mesh: negHit,
        sprite: negSprite,
        canvas: negCanvas,
        ctx: negCtx,
        color: axis.color,
        label: axis.label,
        isNeg: true,
        axisDir: axis.negDir.clone(),
        fillAlpha: 0
      })
    }

    group.traverse((o) => {
      o.frustumCulled = false
    })

    gizmoRoot = group
    hitObjects = localHits
    sphereRefs = localRefs

    return () => {
      if (group.parent) group.parent.remove(group)
      group.clear()
      gizmoRoot = null
      hitObjects = []
      sphereRefs = []
      hoveredMesh = null
      for (const g of geometries) g.dispose()
      for (const m of materials) m.dispose()
      for (const t of textures) t.dispose()
    }
  })
</script>

{#if gizmoRoot}
  <div
    class="absolute bottom-3 left-3 z-20 h-40 w-40 cursor-default overflow-hidden"
    role="button"
    tabindex="-1"
    aria-label="Camera orientation gizmo — click an axis to snap view"
    onclick={handleClick}
    onmousemove={handleMouseMove}
    onmouseleave={handleMouseLeave}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') handleClick(/** @type {any} */ (e))
    }}
  >
    <ThrelteCanvas class="pointer-events-none block h-full w-full">
      <T.OrthographicCamera
        makeDefault
        manual
        left={-1.35}
        right={1.35}
        top={1.35}
        bottom={-1.35}
        near={0.05}
        far={50}
      />
      <AxesGizmoScene gizmo={gizmoRoot} {onFrame} />
    </ThrelteCanvas>
  </div>
{/if}
