<script>
  import { Canvas as ThrelteCanvas, T } from '@threlte/core'
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
  import AxesGizmoScene from './AxesGizmoScene.svelte'

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

  let gizmoRoot = $state(/** @type {Group | null} */ (null))

  $effect(() => {
    const group = new Group()
    group.renderOrder = 1000
    group.frustumCulled = false

    const shaftGeometry = new CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, SHAFT_LENGTH, 18)
    const tipGeometry = new ConeGeometry(TIP_RADIUS, TIP_LENGTH, 18)
    /** @type {import('three').Material[]} */
    const materials = []
    /** @type {import('three').Texture[]} */
    const textures = []
    const direction = new Vector3()
    const axisAlign = new Quaternion()

    for (const axis of AXES) {
      direction.fromArray(axis.direction)
      axisAlign.setFromUnitVectors(Y_AXIS, direction)

      const metalOpts = {
        color: axis.color,
        metalness: 0.4,
        roughness: 0.6,
        envMapIntensity: 1,
        depthTest: true,
        depthWrite: true
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
        transparent: true,
        depthTest: true,
        depthWrite: false
      })
      materials.push(labelMaterial)

      const label = new Sprite(labelMaterial)
      label.renderOrder = 1000
      label.position.copy(direction).multiplyScalar(SHAFT_LENGTH + TIP_LENGTH + LABEL_OFFSET)
      label.scale.set(0.34, 0.34, 0.34)
      group.add(label)
    }

    group.traverse((o) => {
      o.frustumCulled = false
    })

    gizmoRoot = group

    return () => {
      if (group.parent) {
        group.parent.remove(group)
      }
      group.clear()
      gizmoRoot = null
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
</script>

{#if gizmoRoot}
  <div class="pointer-events-none absolute bottom-3 left-3 z-20 h-32 w-32 overflow-hidden">
    <ThrelteCanvas class="block h-full w-full">
      <!-- <T.Color attach="background" args={[0x0c0c0c]} /> -->
      <T.PerspectiveCamera makeDefault position={[0, 0, 4]} fov={38} near={0.08} far={80} />
      <AxesGizmoScene gizmo={gizmoRoot} />
    </ThrelteCanvas>
  </div>
{/if}
