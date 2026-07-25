<script>
  import { onDestroy } from 'svelte'
  import { useTask, useThrelte } from '@threlte/core'
  import { Vector3 } from 'three'
  import {
    DepthOfFieldEffect,
    EffectComposer,
    EffectPass,
    RenderPass
  } from 'postprocessing'
  import { viewerSettings } from '../../lib/viewerSettings.svelte.js'

  const { renderer, scene, camera, size, autoRender, autoRenderTask, invalidate } = useThrelte()

  /** @type {EffectComposer | null} */
  let composer = null
  /** @type {DepthOfFieldEffect | null} */
  let dofEffect = null
  /** @type {RenderPass | null} */
  let renderPass = null
  /** @type {EffectPass | null} */
  let effectPass = null
  const _focusVec = new Vector3()
  let composerFailed = false

  function disposeComposer() {
    if (effectPass) {
      try {
        effectPass.dispose()
      } catch {
        /* ignore */
      }
      effectPass = null
    }
    if (renderPass) {
      try {
        renderPass.dispose()
      } catch {
        /* ignore */
      }
      renderPass = null
    }
    if (dofEffect) {
      try {
        dofEffect.dispose()
      } catch {
        /* ignore */
      }
      dofEffect = null
    }
    if (composer) {
      try {
        composer.dispose()
      } catch {
        /* ignore */
      }
      composer = null
    }
  }

  function applyDofParams() {
    if (!dofEffect) return
    const dof = viewerSettings.dof
    dofEffect.cocMaterial.focusDistance = dof.focusDistance
    dofEffect.cocMaterial.focusRange = dof.focusRange
    dofEffect.bokehScale = dof.bokehScale
    if (dof.focusTarget) {
      _focusVec.set(dof.focusTarget.x, dof.focusTarget.y, dof.focusTarget.z)
      dofEffect.target = _focusVec
    } else {
      dofEffect.target = null
    }
  }

  function ensureComposer() {
    const cam = camera.current
    if (!cam || !renderer || composerFailed) return null
    if (composer && dofEffect) return composer
    try {
      disposeComposer()
      const dof = viewerSettings.dof
      composer = new EffectComposer(renderer)
      renderPass = new RenderPass(scene, cam)
      dofEffect = new DepthOfFieldEffect(cam, {
        focusDistance: dof.focusDistance,
        focusRange: dof.focusRange,
        bokehScale: dof.bokehScale,
        resolutionScale: 0.75
      })
      effectPass = new EffectPass(cam, dofEffect)
      composer.addPass(renderPass)
      composer.addPass(effectPass)
      const s = size.current
      if (s?.width && s?.height) composer.setSize(s.width, s.height)
      return composer
    } catch (err) {
      console.warn('[DepthOfField] composer init failed — effect disabled', err)
      composerFailed = true
      disposeComposer()
      autoRender.set(true)
      return null
    }
  }

  $effect(() => {
    const enabled = viewerSettings.dof?.enabled === true
    // Track param changes for live updates
    void viewerSettings.dof?.focusDistance
    void viewerSettings.dof?.focusRange
    void viewerSettings.dof?.bokehScale
    void viewerSettings.dof?.focusTarget

    if (!enabled || composerFailed) {
      disposeComposer()
      autoRender.set(true)
      invalidate()
      return
    }

    autoRender.set(false)
    const c = ensureComposer()
    if (!c || !dofEffect) {
      autoRender.set(true)
      return
    }

    const cam = camera.current
    if (cam) {
      renderPass.mainCamera = cam
      dofEffect.mainCamera = cam
      effectPass.mainCamera = cam
    }
    applyDofParams()
    invalidate()
  })

  $effect(() => {
    const s = $size
    if (!composer || !s?.width || !s?.height) return
    composer.setSize(s.width, s.height)
    invalidate()
  })

  useTask(
    () => {
      if (!viewerSettings.dof?.enabled || !composer || composerFailed) return
      const cam = camera.current
      if (!cam) return
      if (renderPass) renderPass.mainCamera = cam
      if (dofEffect) dofEffect.mainCamera = cam
      if (effectPass) effectPass.mainCamera = cam
      composer.render()
    },
    { stage: autoRenderTask.stage, after: autoRenderTask, autoInvalidate: false }
  )

  onDestroy(() => {
    disposeComposer()
    autoRender.set(true)
  })
</script>
