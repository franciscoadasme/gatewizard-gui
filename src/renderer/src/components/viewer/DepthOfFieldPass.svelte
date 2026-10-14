<script>
  import { onDestroy } from 'svelte'
  import { useTask, useThrelte } from '@threlte/core'
  import { SRGBColorSpace, UnsignedByteType, Vector3 } from 'three'
  import {
    DepthOfFieldEffect,
    EffectComposer,
    EffectPass,
    KernelSize,
    RenderPass,
    SMAAEffect,
    SMAAPreset
  } from 'postprocessing'
  import { viewerSettings } from '../../lib/viewerSettings.svelte.js'
  import { subscribeExportDrawSize } from '../../lib/viewer/exportCapture.js'

  const { renderer, scene, camera, size, autoRender, autoRenderTask, invalidate } = useThrelte()

  /** @type {EffectComposer | null} */
  let composer = null
  /** @type {DepthOfFieldEffect | null} */
  let dofEffect = null
  /** @type {SMAAEffect | null} */
  let smaaEffect = null
  /** @type {RenderPass | null} */
  let renderPass = null
  /** @type {EffectPass | null} */
  let dofPass = null
  /** @type {EffectPass | null} */
  let smaaPass = null
  const _focusVec = new Vector3()
  let composerFailed = false
  /** @type {{ width: number, height: number, bokehFactor: number } | null} */
  let exportDraw = $state(null)

  /**
   * @param {{ dispose?: () => void } | null} pass
   */
  function safeDispose(pass) {
    if (!pass) return
    try {
      pass.dispose?.()
    } catch {
      /* ignore */
    }
  }

  function disposeComposer() {
    safeDispose(smaaPass)
    smaaPass = null
    safeDispose(dofPass)
    dofPass = null
    safeDispose(renderPass)
    renderPass = null
    safeDispose(smaaEffect)
    smaaEffect = null
    safeDispose(dofEffect)
    dofEffect = null
    safeDispose(composer)
    composer = null
  }

  function applyDofParams() {
    if (!dofEffect) return
    const dof = viewerSettings.dof
    dofEffect.cocMaterial.focusDistance = dof.focusDistance
    dofEffect.cocMaterial.focusRange = dof.focusRange
    const factor = exportDraw?.bokehFactor > 0 ? exportDraw.bokehFactor : 1
    dofEffect.bokehScale = dof.bokehScale * factor
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
      // MSAA + half-float: when DoF owns the frame, the canvas MSAA path is bypassed.
      // Unsigned byte matches the normal view. Half-float made colors more vivid
      // than the same scene with depth of field off.
      renderer.outputColorSpace = SRGBColorSpace
      composer = new EffectComposer(renderer, {
        multisampling: 4,
        frameBufferType: UnsignedByteType
      })
      renderPass = new RenderPass(scene, cam)
      // Full-res bokeh (was 0.75) — low resolutionScale is the main source of
      // stair-stepped / ghosted blur rings in the screenshot.
      dofEffect = new DepthOfFieldEffect(cam, {
        focusDistance: dof.focusDistance,
        focusRange: dof.focusRange,
        bokehScale: dof.bokehScale,
        resolutionScale: 1
      })
      // Soften CoC mask edges so near-blur transitions are less crunchy.
      dofEffect.blurPass.kernelSize = KernelSize.LARGE
      smaaEffect = new SMAAEffect({ preset: SMAAPreset.HIGH })
      dofPass = new EffectPass(cam, dofEffect)
      smaaPass = new EffectPass(cam, smaaEffect)
      composer.addPass(renderPass)
      composer.addPass(dofPass)
      composer.addPass(smaaPass)
      const s = size.current
      const w = exportDraw?.width || s?.width
      const h = exportDraw?.height || s?.height
      if (w && h) composer.setSize(w, h)
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
    return subscribeExportDrawSize((size) => {
      exportDraw = size
    })
  })

  $effect(() => {
    const enabled = viewerSettings.dof?.enabled === true
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
      if (renderPass) renderPass.mainCamera = cam
      dofEffect.mainCamera = cam
      if (dofPass) dofPass.mainCamera = cam
      if (smaaPass) smaaPass.mainCamera = cam
    }
    applyDofParams()
    invalidate()
  })

  $effect(() => {
    const s = $size
    const w = exportDraw?.width || s?.width
    const h = exportDraw?.height || s?.height
    if (!composer || !w || !h) return
    composer.setSize(w, h)
    applyDofParams()
    invalidate()
  })

  useTask(
    () => {
      if (!viewerSettings.dof?.enabled || !composer || composerFailed) return
      const cam = camera.current
      if (!cam) return
      if (renderPass) renderPass.mainCamera = cam
      if (dofEffect) dofEffect.mainCamera = cam
      if (dofPass) dofPass.mainCamera = cam
      if (smaaPass) smaaPass.mainCamera = cam
      composer.render()
    },
    { stage: autoRenderTask.stage, after: autoRenderTask, autoInvalidate: false }
  )

  onDestroy(() => {
    disposeComposer()
    autoRender.set(true)
  })
</script>
