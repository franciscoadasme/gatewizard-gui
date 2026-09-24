<script>
  import { useThrelte } from '@threlte/core'
  import { Color } from 'three'
  import { themeState } from '../../lib/theme.svelte.js'
  import { themeBackgroundHex, viewerSettings } from '../../lib/viewerSettings.svelte.js'
  import { isExportCaptureActive } from '../../lib/viewer/exportCapture.js'

  const { scene, renderer, invalidate } = useThrelte()

  $effect(() => {
    if (!scene || !renderer) return

    const theme = themeState.current
    const mode = viewerSettings.backgroundMode
    const customHex = viewerSettings.customBackgroundHex
    if (isExportCaptureActive()) return
    const hex = mode === 'custom' ? customHex : themeBackgroundHex(theme)

    const color = new Color(hex)
    if (scene.background instanceof Color) {
      scene.background.copy(color)
    } else {
      scene.background = color
    }
    renderer.setClearColor(color, 1)
    invalidate()
  })
</script>
