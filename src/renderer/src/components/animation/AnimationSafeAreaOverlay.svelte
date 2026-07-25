<script>
  import { computeSafeAreaInCanvas } from '../../lib/animation/safeArea.js'

  /**
   * @type {{
   *   canvasWidth: number
   *   canvasHeight: number
   *   frameWidth: number
   *   frameHeight: number
   *   visible?: boolean
   * }}
   */
  let { canvasWidth, canvasHeight, frameWidth, frameHeight, visible = true } = $props()

  const rect = $derived(
    computeSafeAreaInCanvas(canvasWidth, canvasHeight, frameWidth, frameHeight)
  )
</script>

{#if visible && canvasWidth > 0 && canvasHeight > 0}
  <div
    class="pointer-events-none absolute z-[15] border border-dashed border-yellow-400/90"
    style="left:{rect.x}px;top:{rect.y}px;width:{rect.width}px;height:{rect.height}px;box-shadow:0 0 0 9999px rgba(0,0,0,0.38)"
    aria-hidden="true"
  ></div>
  <div
    class="pointer-events-none absolute z-[16] rounded bg-black/50 px-1.5 py-0.5 font-mono text-[10px] text-yellow-200/90"
    style="left:{rect.x + 6}px;top:{rect.y + 6}px"
  >
    {frameWidth}×{frameHeight}
  </div>
{/if}
