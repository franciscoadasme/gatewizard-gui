<script>
  import { docsEntries } from '../lib/docsLinks.js'

  /** @type {{ docsId: string, text: string }} */
  let { docsId, text } = $props()

  const NOTE_WIDTH = 256
  const MARGIN = 8

  let open = $state(false)
  let booksOpen = $state(false)
  /** @type {HTMLDivElement | undefined} */
  let root = $state()
  /** @type {HTMLButtonElement | undefined} */
  let bookBtn = $state()
  /** @type {HTMLDivElement | undefined} */
  let note = $state()
  /** @type {HTMLDivElement | undefined} */
  let bookMenu = $state()
  /** @type {{ top: number, left: number, width: number } | null} */
  let place = $state(null)
  /** @type {ReturnType<typeof setTimeout> | 0} */
  let closeTimer = 0

  function close() {
    clearTimeout(closeTimer)
    closeTimer = 0
    open = false
    booksOpen = false
    place = null
  }

  function cancelClose() {
    clearTimeout(closeTimer)
    closeTimer = 0
  }

  function scheduleClose() {
    clearTimeout(closeTimer)
    closeTimer = setTimeout(() => {
      open = false
      booksOpen = false
      place = null
    }, 140)
  }

  function position() {
    const anchor = booksOpen ? bookBtn : root
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const width = Math.min(booksOpen ? 200 : NOTE_WIDTH, window.innerWidth - MARGIN * 2)
    const height = (booksOpen ? bookMenu : note)?.offsetHeight || 140
    let left = rect.left
    const maxLeft = window.innerWidth - MARGIN - width
    if (left > maxLeft) left = maxLeft
    if (left < MARGIN) left = MARGIN
    const below = rect.bottom + 4
    const fitsBelow = below + height <= window.innerHeight - MARGIN
    const top = fitsBelow ? below : Math.max(MARGIN, rect.top - height - 4)
    place = { top, left, width }
  }

  function show() {
    cancelClose()
    booksOpen = false
    open = true
    position()
  }

  function showBooks() {
    cancelClose()
    open = false
    booksOpen = true
    position()
  }

  $effect(() => {
    if (!open && !booksOpen) return
    position()
    const frame = requestAnimationFrame(() => position())
    /** @param {Event} _event */
    const onMove = () => position()
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  })

  /** @param {KeyboardEvent} event */
  function onKey(event) {
    if (event.key === 'Escape') close()
  }

  /** @param {PointerEvent} event */
  function onPointerDown(event) {
    if (!open && !booksOpen) return
    const target = event.target
    if (!(target instanceof Node)) return
    if (root?.contains(target) || note?.contains(target) || bookMenu?.contains(target)) return
    close()
  }

  /**
   * Draw the note on document.body so a scrolling sidebar cannot clip it
   * or grow a scrollbar under the pointer.
   * @param {HTMLElement} node
   */
  function portal(node) {
    document.body.appendChild(node)
    return {
      destroy() {
        node.remove()
      }
    }
  }

  const links = $derived(docsEntries(docsId))

  /** @param {string} url */
  async function openDocs(url) {
    close()
    if (window.api?.openExternalUrl) {
      try {
        await window.api.openExternalUrl(url)
        return
      } catch {
        /* fall through */
      }
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }
</script>

<svelte:window onkeydown={onKey} onpointerdown={onPointerDown} />

<div bind:this={root} class="relative flex shrink-0 items-center gap-1">
  <button
    type="button"
    class="flex size-5 items-center justify-center rounded-full border border-neutral-300 bg-neutral-50 text-[11px] font-semibold leading-none text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
    aria-label="Explanation"
    onmouseenter={show}
    onmouseleave={scheduleClose}
    onclick={(event) => {
      event.stopPropagation()
      if (open) close()
      else show()
    }}
  >
    i
  </button>
  <button
    type="button"
    bind:this={bookBtn}
    class="flex size-5 items-center justify-center rounded-md border border-neutral-300 bg-neutral-50 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
    aria-label="Documentation"
    aria-expanded={booksOpen}
    title="User guide and API"
    onmouseenter={showBooks}
    onmouseleave={scheduleClose}
    onclick={(event) => {
      event.stopPropagation()
      if (booksOpen) close()
      else showBooks()
    }}
  >
    <svg viewBox="0 0 16 16" class="size-3" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
      <path d="M3 2.5h4.2a2.2 2.2 0 0 1 2.2 2.2V13a1.6 1.6 0 0 0-1.6-1.6H3V2.5Z" />
      <path d="M13 2.5H8.8A2.2 2.2 0 0 0 6.6 4.7V13A1.6 1.6 0 0 1 8.2 11.4H13V2.5Z" />
    </svg>
  </button>
  {#if open && place}
    <div
      bind:this={note}
      use:portal
      class="fixed z-50 rounded-md border border-neutral-300 bg-neutral-50 p-2 text-[11px] leading-snug text-neutral-800 shadow-md dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
      style="top: {place.top}px; left: {place.left}px; width: {place.width}px"
      role="note"
      onmouseenter={cancelClose}
      onmouseleave={scheduleClose}
    >
      {text}
    </div>
  {/if}
  {#if booksOpen && place}
    <div
      bind:this={bookMenu}
      use:portal
      class="fixed z-50 rounded-md border border-neutral-300 bg-neutral-50 py-1 text-[11px] text-neutral-800 shadow-md dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
      style="top: {place.top}px; left: {place.left}px; width: {place.width}px"
      role="menu"
      tabindex="-1"
      onmouseenter={cancelClose}
      onmouseleave={scheduleClose}
    >
      {#each links as link (link.url)}
        <button
          type="button"
          class="block w-full px-2 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
          role="menuitem"
          onclick={(event) => {
            event.stopPropagation()
            void openDocs(link.url)
          }}
        >
          {link.label}
        </button>
      {/each}
    </div>
  {/if}
</div>
