<script>
  /**
   * Applies viewerSettings lights (camera-follow or world), fog, and shadows
   * inside the Threlte canvas tree.
   *
   * Note: Threlte exposes `camera` as `{ current }`, but `scene` / `renderer` are
   * the Three objects themselves (see CameraRig / SceneBackground).
   */
  import { T, useTask, useThrelte } from '@threlte/core'
  import { Fog, PCFSoftShadowMap, Vector3 } from 'three'
  import { goodsellLightingState } from '../../lib/goodsellSceneLighting.svelte.js'
  import { themeState } from '../../lib/theme.svelte.js'
  import {
    resolveFogColor,
    SHADOW_STRENGTH_MAX,
    shadowRadiusFromSoftness,
    viewerSettings
  } from '../../lib/viewerSettings.svelte.js'
  import { sceneDirectionalLightRegistry } from '../../lib/viewer/sceneDirectionalLights.js'
  import SceneDirectionalLight from './SceneDirectionalLight.svelte'

  const { camera, scene, renderer, invalidate } = useThrelte()

  const hemisphereSky = $derived(viewerSettings.hemisphereSky)
  const hemisphereGround = $derived(viewerSettings.hemisphereGround)
  const hemisphereIntensity = $derived(viewerSettings.hemisphereIntensity)
  const ambientColor = $derived(viewerSettings.ambientColor || '#ffffff')
  const ambientIntensity = $derived(viewerSettings.ambientIntensity)
  const directionalLights = $derived(viewerSettings.directionalLights)
  const lightMode = $derived(viewerSettings.lightMode === 'world' ? 'world' : 'camera')
  const fogCfg = $derived(viewerSettings.fog)
  const shadowsCfg = $derived(viewerSettings.shadows)
  const dirLightMultiplier = $derived(goodsellLightingState.active ? 0.35 : 1)
  const fogColorHex = $derived(resolveFogColor(themeState.current))

  const _offset = new Vector3()
  const _world = new Vector3()
  const _look = new Vector3()

  /**
   * Configure a directional light's shadow camera to cover a molecular scene.
   * @param {import('three').DirectionalLight} light
   * @param {number} strength Darkness 0–1 (Three shadow.intensity)
   * @param {number} softness Edge blur 0–1
   * @param {number} halfExtent
   */
  function configureShadow(light, strength, softness, halfExtent) {
    light.castShadow = true
    const sh = light.shadow
    if (!sh) return
    // Keep map size stable — reallocating mid-session can blank shadows.
    sh.mapSize.set(2048, 2048)
    sh.bias = -0.0008
    sh.normalBias = 0.03
    sh.radius = shadowRadiusFromSoftness(softness)
    // Three.js: intensity must stay in [0, 1] (shader uses mix(1, shadow, intensity)).
    const intensity = Math.max(0, Math.min(SHADOW_STRENGTH_MAX, strength))
    if ('intensity' in sh) {
      /** @type {{ intensity: number }} */ (sh).intensity = intensity
    }
    const cam = sh.camera
    const ext = Math.max(40, halfExtent)
    cam.left = -ext
    cam.right = ext
    cam.top = ext
    cam.bottom = -ext
    cam.near = 0.5
    cam.far = Math.max(400, ext * 6)
    cam.updateProjectionMatrix()
  }

  /**
   * Linear depth cue with user Near/Far (camera distances).
   * Atoms closer than near stay fully lit; past far they match the fog color.
   * @param {number} near
   * @param {number} far
   * @param {string} colorHex
   */
  function applyDepthCueFog(near, far, colorHex) {
    if (!scene) return
    const n = Math.max(0.1, near)
    const f = Math.max(n + 1, far)
    if (scene.fog instanceof Fog) {
      scene.fog.color.set(colorHex)
      scene.fog.near = n
      scene.fog.far = f
    } else {
      scene.fog = new Fog(colorHex, n, f)
    }
  }

  $effect(() => {
    const enabled = shadowsCfg?.enabled === true
    const strength = typeof shadowsCfg?.strength === 'number' ? shadowsCfg.strength : 1
    const softness = typeof shadowsCfg?.softness === 'number' ? shadowsCfg.softness : 0.45
    if (!renderer) return

    renderer.shadowMap.enabled = enabled
    renderer.shadowMap.type = PCFSoftShadowMap
    renderer.shadowMap.needsUpdate = true

    if (scene) {
      scene.traverse((obj) => {
        if (obj.isMesh || obj.isInstancedMesh) {
          obj.castShadow = enabled
          obj.receiveShadow = enabled
        }
      })
    }

    const halfExtent = 80
    for (const light of sceneDirectionalLightRegistry.byIndex.values()) {
      if (enabled) configureShadow(light, strength, softness, halfExtent)
      else light.castShadow = false
    }
    invalidate()
  })

  $effect(() => {
    if (!scene) return
    const fog = fogCfg
    if (!(fog?.enabled)) {
      scene.fog = null
      invalidate()
      return
    }
    const near = typeof fog.near === 'number' ? fog.near : 70
    const far = typeof fog.far === 'number' ? fog.far : 140
    applyDepthCueFog(near, far, fogColorHex)
    invalidate()
  })

  useTask(() => {
    if (shadowsCfg?.enabled !== true || !scene) return
    scene.traverse((obj) => {
      if ((obj.isMesh || obj.isInstancedMesh) && !obj.castShadow) {
        obj.castShadow = true
        obj.receiveShadow = true
      }
    })
  })

  useTask(() => {
    const cam = camera.current
    if (!cam) return
    cam.updateMatrixWorld(true)
    _look.set(0, 0, -1).applyQuaternion(cam.quaternion)

    const shadowsOn = shadowsCfg?.enabled === true
    const strength = typeof shadowsCfg?.strength === 'number' ? shadowsCfg.strength : 1
    const softness = typeof shadowsCfg?.softness === 'number' ? shadowsCfg.softness : 0.45

    for (let i = 0; i < directionalLights.length; i++) {
      const cfg = directionalLights[i]
      const light = sceneDirectionalLightRegistry.byIndex.get(i)
      if (!cfg?.enabled || !light) continue

      if (lightMode === 'camera') {
        const [ox, oy, oz] = cfg.position
        _offset.set(ox, oy, oz)
        _world.copy(_offset).applyMatrix4(cam.matrixWorld)
        light.position.copy(_world)
        light.target.position.copy(cam.position).addScaledVector(_look, 80)
      } else {
        light.position.set(cfg.position[0], cfg.position[1], cfg.position[2])
        light.target.position.set(0, 0, 0)
      }
      light.target.updateMatrixWorld()
      if (scene && !light.target.parent) {
        scene.add(light.target)
      }

      if (shadowsOn) {
        const half =
          light.position.length() > 1 ? Math.max(50, light.position.length() * 0.85) : 80
        configureShadow(light, strength, softness, half)
      }
    }
  })
</script>

<T.HemisphereLight args={[hemisphereSky, hemisphereGround, hemisphereIntensity]} />

<T.AmbientLight color={ambientColor} intensity={ambientIntensity} />

{#each directionalLights as light, i (i)}
  {#if light.enabled}
    <SceneDirectionalLight
      index={i}
      position={light.position}
      intensity={light.intensity * dirLightMultiplier}
      color={light.color || '#ffffff'}
      {lightMode}
      castShadow={shadowsCfg?.enabled === true}
    />
  {/if}
{/each}
