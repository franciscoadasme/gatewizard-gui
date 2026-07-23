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

  /**
   * Each click steps the camera by ~90°, rotating around a CAMERA-RELATIVE
   * axis derived from where the clicked ball currently sits on screen — not
   * a fixed per-world-axis behavior. Horizontal spheres (left/right) yaw
   * around camera-up (vertical axis stays fixed on screen); vertical spheres
   * (top/bottom) pitch around camera-right (horizontal axis stays fixed).
   * Repeated clicks on the ball at that screen position keep stepping 90° in
   * the same rotational direction — handy for turntable-style animation
   * keyframes around one axis.
   *
   * The raw 90°-rotated pose is then snapped to the nearest perfectly
   * axis-aligned/symmetric orientation, and the camera slerps
   * to that exact clean target via the shortest path. When the camera is
   * already aligned this is a no-op on the target (identical to a pure ±90°
   * step); when the view was manually dragged to an oblique angle, the click
   * corrects it back to a clean, symmetric alignment.
   */
  const AXES = [
    { label: 'X', color: '#e03030', dir: new Vector3(1, 0, 0), negDir: new Vector3(-1, 0, 0) },
    { label: 'Y', color: '#38c038', dir: new Vector3(0, 1, 0), negDir: new Vector3(0, -1, 0) },
    { label: 'Z', color: '#3048e0', dir: new Vector3(0, 0, 1), negDir: new Vector3(0, 0, -1) }
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
      ctx.font = 'bold 56px Roboto, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = isPos ? '#000000' : '#ffffff'
      ctx.fillText(label, cx, cx)
    }
  }

  let gizmoRoot = $state(/** @type {Group | null} */ (null))

  /** @type {{ mesh: import('three').Mesh, dir: import('three').Vector3 }[]} */
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

  // ── Camera step: ±90° turntable, snapped to exact symmetric alignment ──
  // TrackballControls.update() always lookAt()s and may apply mouse damping
  // (_lastAngle); we clear that each frame so it can't fight the snap.
  const SNAP_DURATION = 380 // ms
  const STEP = Math.PI / 2
  const _originVec = new Vector3(0, 0, 0)
  const _tmpLookMat = new Matrix4()
  let _snapAnimating = false
  let _snapStartTime = 0
  let _snapRaf = 0
  const _snapTarget = new Vector3()
  const _snapStartQuat = new Quaternion()
  const _snapTargetQuat = new Quaternion()
  const _snapQuat = new Quaternion()
  const _snapAxis = new Vector3()
  const _snapRight = new Vector3()
  const _snapEye = new Vector3()
  const _snapUp = new Vector3()
  const _snapLook = new Vector3()
  const _snapRawEye = new Vector3()
  const _snapRawUp = new Vector3()
  const _snapCleanEye = new Vector3()
  const _snapCleanUp = new Vector3()
  const _localZ = new Vector3(0, 0, 1)
  const _localY = new Vector3(0, 1, 0)
  const _camDir = new Vector3()
  let _snapDist = 0

  /** Kill TrackballControls inertial rotate so it cannot fight the snap. */
  function silenceTrackball(ctrl) {
    if (!ctrl) return
    if ('_lastAngle' in ctrl) ctrl._lastAngle = 0
    if ('_lastAxis' in ctrl && ctrl._lastAxis?.set) ctrl._lastAxis.set(0, 0, 0)
  }

  /**
   * Snap `v` to the nearest of the 6 cardinal unit vectors (±X/±Y/±Z).
   * @param {import('three').Vector3} v
   * @param {import('three').Vector3} out
   */
  function snapToCardinal(v, out) {
    const ax = Math.abs(v.x)
    const ay = Math.abs(v.y)
    const az = Math.abs(v.z)
    if (ax >= ay && ax >= az) return out.set(v.x < 0 ? -1 : 1, 0, 0)
    if (ay >= az) return out.set(0, v.y < 0 ? -1 : 1, 0)
    return out.set(0, 0, v.z < 0 ? -1 : 1)
  }

  /**
   * Step the camera ~90° to bring `dir` (a fixed world axis direction) toward front.
   * Rotation axis/sign are derived from the CURRENT camera basis, so this always
   * pitches when `dir` currently sits above/below on screen, and yaws when it
   * currently sits left/right — regardless of which world axis `dir` is. The
   * resulting pose is snapped to an exact axis-aligned orientation and reached
   * via the shortest quaternion path (a no-op correction when already aligned).
   * @param {import('three').Vector3} dir
   */
  function stepCamera(dir) {
    const cam = mainViewerCamera.current
    const ctrl = mainViewerControls.current
    if (!cam || !ctrl || !('target' in ctrl)) return

    if (_snapRaf) {
      cancelAnimationFrame(_snapRaf)
      _snapRaf = 0
    }

    silenceTrackball(ctrl)

    _snapTarget.copy(ctrl.target)
    _snapDist = cam.position.distanceTo(_snapTarget)
    if (_snapDist < 1e-8) return

    _snapStartQuat.copy(cam.quaternion)
    _snapEye.copy(cam.position).sub(_snapTarget).normalize()
    _snapUp.copy(cam.up).normalize()
    _snapLook.copy(_snapEye).negate() // forward
    _snapRight.crossVectors(_snapLook, _snapUp) // right = look × up
    if (_snapRight.lengthSq() < 1e-12) return
    _snapRight.normalize()

    const upDot = dir.dot(_snapUp)
    const rightDot = dir.dot(_snapRight)
    const lookDot = dir.dot(_snapLook)
    const aUp = Math.abs(upDot)
    const aRight = Math.abs(rightDot)
    const aLook = Math.abs(lookDot)

    let angle
    if (aUp >= aRight && aUp >= aLook) {
      // Ball is above/below on screen → pitch around camera right, no roll.
      _snapAxis.copy(_snapRight)
      angle = upDot > 0 ? -STEP : STEP
    } else if (aRight >= aLook) {
      // Ball is left/right on screen → yaw around camera up, no roll.
      _snapAxis.copy(_snapUp)
      angle = rightDot > 0 ? STEP : -STEP
    } else {
      // Ball points toward/away from camera (front/back) → half-turn yaw.
      _snapAxis.copy(_snapUp)
      angle = Math.PI
    }

    // Raw 90°-rotated pose, then snapped to an exact symmetric/aligned pose.
    _snapQuat.setFromAxisAngle(_snapAxis, angle)
    _snapRawEye.copy(_snapEye).applyQuaternion(_snapQuat)
    _snapRawUp.copy(_snapUp).applyQuaternion(_snapQuat)
    snapToCardinal(_snapRawEye, _snapCleanEye)
    _snapCleanUp.copy(_snapRawUp).addScaledVector(_snapCleanEye, -_snapRawUp.dot(_snapCleanEye))
    snapToCardinal(_snapCleanUp, _snapCleanUp)

    _tmpLookMat.lookAt(_snapCleanEye, _originVec, _snapCleanUp)
    _snapTargetQuat.setFromRotationMatrix(_tmpLookMat)

    _snapStartTime = performance.now()
    _snapAnimating = true
    _snapAnimFrame()
  }

  /** @param {number} t 0–1 */
  function applyStepPose(t) {
    const cam = mainViewerCamera.current
    const ctrl = mainViewerControls.current
    if (!cam || !ctrl) return

    _snapQuat.copy(_snapStartQuat).slerp(_snapTargetQuat, t)
    _snapEye.copy(_localZ).applyQuaternion(_snapQuat).multiplyScalar(_snapDist)
    _snapUp.copy(_localY).applyQuaternion(_snapQuat)

    cam.position.copy(_snapTarget).add(_snapEye)
    cam.quaternion.copy(_snapQuat)
    cam.up.copy(_snapUp)

    silenceTrackball(ctrl)
    if (ctrl._eye?.copy) ctrl._eye.copy(_snapEye)
    // Safe: damping is zeroed, so update only syncs position/lookAt bookkeeping.
    if (typeof ctrl.update === 'function') ctrl.update()
    mainViewerInvalidate.fn()
  }

  function _snapAnimFrame() {
    if (!mainViewerCamera.current) {
      _snapAnimating = false
      _snapRaf = 0
      return
    }

    const elapsed = performance.now() - _snapStartTime
    const rawT = Math.min(elapsed / SNAP_DURATION, 1)
    const t = 1 - Math.pow(1 - rawT, 3)

    applyStepPose(rawT >= 1 ? 1 : t)
    if (rawT >= 1) {
      _snapAnimating = false
      _snapRaf = 0
      return
    }

    _snapRaf = requestAnimationFrame(_snapAnimFrame)
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
      if (hit) stepCamera(hit.dir)
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
      localHits.push({
        mesh: posHit,
        dir: axis.dir.clone()
      })
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
      localHits.push({
        mesh: negHit,
        dir: axis.negDir.clone()
      })
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
