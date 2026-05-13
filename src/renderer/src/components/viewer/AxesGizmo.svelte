<script>
  import { useRenderer, useTask, useThrelte } from '@threlte/core'
  import {
    CanvasTexture,
    ConeGeometry,
    CylinderGeometry,
    Group,
    Mesh,
    MeshStandardMaterial,
    Quaternion,
    Sprite,
    SpriteMaterial,
    Vector3
  } from 'three'

  /** @type {{ visible?: boolean }} */
  let { visible = false } = $props()

  const SHAFT_LENGTH = 0.5
  const SHAFT_RADIUS = 0.05
  const TIP_LENGTH = 0.25
  const TIP_RADIUS = 0.1
  const LABEL_OFFSET = 0.1
  const Y_AXIS = new Vector3(0, 1, 0)
  const AXES = [
    { label: 'X', color: '#ff0000', direction: [1, 0, 0] },
    { label: 'Y', color: '#00ff00', direction: [0, 1, 0] },
    { label: 'Z', color: '#0000ff', direction: [0, 0, 1] }
  ]

  /** Distance along −Z (camera space) to the HUD plane. */
  const HUD_DEPTH = 1.12
  /** How far toward the lower-left edge of that plane (0 = center, 1 = edge). */
  const CORNER_FRAC = 0.8
  /** Arrow size relative to half-height of the view at `HUD_DEPTH`. */
  const SCALE_VS_HALF_HEIGHT = 0.3

  const { camera } = useThrelte()
  const { autoRenderTask } = useRenderer()
  const direction = new Vector3()
  const axisAlign = new Quaternion()
  const camWorldQuat = new Quaternion()

  let root = $state(/** @type {Group | null} */ (null))

  $effect(() => {
    const group = new Group()
    group.renderOrder = 1000

    const shaftGeometry = new CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, SHAFT_LENGTH, 18)
    const tipGeometry = new ConeGeometry(TIP_RADIUS, TIP_LENGTH, 18)
    /** @type {import('three').Material[]} */
    const materials = []
    /** @type {import('three').Texture[]} */
    const textures = []

    for (const axis of AXES) {
      direction.fromArray(axis.direction)
      axisAlign.setFromUnitVectors(Y_AXIS, direction)

      const metalOpts = {
        color: axis.color,
        metalness: 0.4,
        roughness: 0.6,
        envMapIntensity: 1
      }
      const shaftMaterial = new MeshStandardMaterial(metalOpts)
      const tipMaterial = new MeshStandardMaterial(metalOpts)
      materials.push(shaftMaterial, tipMaterial)

      const shaft = new Mesh(shaftGeometry, shaftMaterial)
      shaft.renderOrder = 1000
      shaft.position.copy(direction).multiplyScalar(SHAFT_LENGTH / 2)
      shaft.quaternion.copy(axisAlign)

      const tip = new Mesh(tipGeometry, tipMaterial)
      tip.renderOrder = 1000
      tip.position.copy(direction).multiplyScalar(SHAFT_LENGTH + TIP_LENGTH / 2)
      tip.quaternion.copy(axisAlign)

      group.add(shaft, tip)

      const canvasEl = document.createElement('canvas')
      canvasEl.width = 128
      canvasEl.height = 128
      const ctx = canvasEl.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, canvasEl.width, canvasEl.height)
        ctx.font = 'bold 76px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.lineWidth = 10
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)'
        ctx.strokeText(axis.label, canvasEl.width / 2, canvasEl.height / 2)
        ctx.fillStyle = axis.color
        ctx.fillText(axis.label, canvasEl.width / 2, canvasEl.height / 2)
      }

      const labelTexture = new CanvasTexture(canvasEl)
      labelTexture.needsUpdate = true
      textures.push(labelTexture)

      const labelMaterial = new SpriteMaterial({
        map: labelTexture,
        transparent: true
      })
      materials.push(labelMaterial)

      const label = new Sprite(labelMaterial)
      label.renderOrder = 1000
      label.position.copy(direction).multiplyScalar(SHAFT_LENGTH + TIP_LENGTH + LABEL_OFFSET)
      label.scale.set(0.34, 0.34, 0.34)
      group.add(label)
    }

    root = group

    return () => {
      if (group.parent) {
        group.parent.remove(group)
      }
      group.clear()
      root = null
      shaftGeometry.dispose()
      tipGeometry.dispose()
      for (const m of materials) {
        m.dispose()
      }
      for (const t of textures) {
        t.dispose()
      }
    }
  })

  useTask(
    () => {
      const cam = camera.current
      const gizmo = root
      if (!gizmo || !cam) {
        return
      }

      if (gizmo.parent !== cam) {
        cam.add(gizmo)
      }
      gizmo.visible = visible
      if (!visible) {
        return
      }

      cam.updateMatrixWorld(true)

      cam.getWorldQuaternion(camWorldQuat)
      gizmo.quaternion.copy(camWorldQuat).invert()

      if ('fov' in cam && cam.aspect !== undefined) {
        const tanHalfFov = Math.tan((cam.fov * Math.PI) / 360)
        const halfH = tanHalfFov * HUD_DEPTH
        const halfW = halfH * cam.aspect
        gizmo.position.set(-halfW * CORNER_FRAC, -halfH * CORNER_FRAC, -HUD_DEPTH)
        gizmo.scale.setScalar(Math.max(halfH * SCALE_VS_HALF_HEIGHT, 0.006))
      } else {
        gizmo.position.set(-0.42, -0.34, -1.1)
        gizmo.scale.setScalar(0.12)
      }
    },
    {
      running: () => !!root,
      before: autoRenderTask
    }
  )
</script>
