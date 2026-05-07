<script>
  import { useThrelte } from '@threlte/core'

  /** @type {{center: { x: number, y: number, z: number }, extent: number}} */
  let { center, extent } = $props()

  const { camera, invalidate } = useThrelte()

  $effect(() => {
    const cam = camera.current
    if (!cam) {
      return
    }

    // Back off from `extent` for ~45° FOV; floor avoids clipping tiny sets.
    const dist = Math.max(18, extent * 2.8)
    cam.position.set(center.x + dist * 0.85, center.y + dist * 0.55, center.z + dist * 0.95)
    cam.lookAt(center.x, center.y, center.z)
    invalidate()
  })
</script>
