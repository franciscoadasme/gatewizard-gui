<script>
  import { useThrelte } from '@threlte/core'
  import { setTrajPlayInvalidate } from '../../../lib/viewer/trajPlayClock.js'

  const { invalidate } = useThrelte()

  $effect(() => {
    setTrajPlayInvalidate(() => invalidate())
    return () => setTrajPlayInvalidate(() => {})
  })
</script>
