<script>
  /**
   * Scrollable log viewer that sticks to the bottom while new lines arrive,
   * but pauses auto-follow when the user scrolls up to read earlier output.
   * Auto-follow resumes when they scroll back near the bottom.
   *
   * @type {{
   *   lines?: string[]
   *   emptyText?: string
   *   className?: string
   * }}
   */
  let {
    lines = [],
    emptyText = 'No log output yet...',
    className = ''
  } = $props()

  /** @type {HTMLPreElement | null} */
  let preEl = $state(null)
  let followBottom = $state(true)
  const BOTTOM_THRESHOLD_PX = 48

  const text = $derived(lines.length > 0 ? lines.join('\n') : emptyText)

  function isNearBottom(el) {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD_PX
  }

  function scrollToBottom() {
    if (!preEl) return
    preEl.scrollTop = preEl.scrollHeight
  }

  /** @param {Event} e */
  function onScroll(e) {
    const el = /** @type {HTMLPreElement} */ (e.currentTarget)
    followBottom = isNearBottom(el)
  }

  // When content changes, stick to bottom only if the user is following.
  $effect(() => {
    void text
    if (!preEl || !followBottom) return
    requestAnimationFrame(scrollToBottom)
  })
</script>

<pre
  bind:this={preEl}
  class="sidebar-panel mt-1 max-h-60 overflow-auto p-2 text-xs whitespace-pre-wrap dark:bg-neutral-950 dark:text-neutral-500 {className}"
  onscroll={onScroll}
>{text}</pre>
