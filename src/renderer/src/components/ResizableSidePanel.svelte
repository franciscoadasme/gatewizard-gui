<script>
  /**
   * Page options / representations panel. Drag the inner edge to resize.
   * Drag past minWidth collapses to a thin rail; click or drag the rail to restore
   * at defaultWidth (also the max — the previous fixed w-80 / Visualize default).
   */
  import { onMount } from 'svelte'
  import { pageSidePanelStore } from '../lib/pageSidePanelStore.svelte.js'

  /** @type {{
   *   side?: 'left' | 'right',
   *   storageKey?: string,
   *   defaultWidth?: number,
   *   minWidth?: number,
   *   className?: string,
   *   children?: import('svelte').Snippet
   * }} */
  let {
    side = 'left',
    storageKey = '',
    defaultWidth = 320,
    minWidth = 200,
    className = '',
    children
  } = $props()

  // Max is the historical fixed size (w-80 = 320, Visualize right = 290).
  const maxWidth = $derived(defaultWidth)

  let width = $state(320)
  let collapsed = $state(false)
  /** Last width while expanded (for mid-session memory); rail click still opens to defaultWidth. */
  let lastExpandedWidth = $state(320)

  let _startX = 0
  let _startW = 0
  /** @type {'resize' | 'expand' | null} */
  let _mode = null
  let _seenToggleToken = 0

  function storageId() {
    return storageKey ? `gatewizard.sidePanel.${storageKey}` : ''
  }

  function clampWidth(value) {
    return Math.max(minWidth, Math.min(maxWidth, value))
  }

  function loadState() {
    const id = storageId()
    if (!id || typeof localStorage === 'undefined') return
    try {
      const raw = localStorage.getItem(id)
      if (!raw) return
      const data = JSON.parse(raw)
      if (typeof data.width === 'number' && Number.isFinite(data.width)) {
        const w = clampWidth(data.width)
        width = w
        lastExpandedWidth = w
      }
      if (typeof data.collapsed === 'boolean') collapsed = data.collapsed
    } catch {
      /* ignore bad prefs */
    }
  }

  function saveState() {
    const id = storageId()
    if (!id || typeof localStorage === 'undefined') return
    try {
      localStorage.setItem(
        id,
        JSON.stringify({
          width: collapsed ? lastExpandedWidth : width,
          collapsed
        })
      )
    } catch {
      /* ignore quota */
    }
  }

  onMount(() => {
    width = clampWidth(defaultWidth)
    lastExpandedWidth = width
    loadState()
    _seenToggleToken = pageSidePanelStore.toggleToken
  })

  /** Activity-bar re-click on the current stage toggles this panel when storageKey matches. */
  $effect(() => {
    const token = pageSidePanelStore.toggleToken
    const pageId = pageSidePanelStore.pageId
    if (!storageKey || pageId !== storageKey) return
    if (token === 0 || token === _seenToggleToken) return
    _seenToggleToken = token
    if (collapsed) expandToDefault()
    else collapsePanel()
  })

  function expandToDefault() {
    width = maxWidth
    lastExpandedWidth = maxWidth
    collapsed = false
    saveState()
  }

  function collapsePanel() {
    // Keep lastExpandedWidth from before this drag — do not store the undersize snap.
    collapsed = true
    saveState()
  }

  function onResizePointerDown(e) {
    if (e.button != null && e.button !== 0) return
    e.preventDefault()
    _mode = 'resize'
    _startX = e.clientX
    _startW = width
    lastExpandedWidth = width
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
  }

  function onExpandRailPointerDown(e) {
    if (e.button != null && e.button !== 0) return
    e.preventDefault()
    _mode = 'expand'
    _startX = e.clientX
    _startW = 0
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
  }

  function resizeDelta(clientX) {
    const dx = clientX - _startX
    return side === 'left' ? dx : -dx
  }

  function onPointerMove(e) {
    if (_mode === 'resize') {
      const next = _startW + resizeDelta(e.clientX)
      if (next < minWidth) {
        collapsePanel()
        onPointerUp()
        return
      }
      width = Math.min(maxWidth, next)
      return
    }
    if (_mode === 'expand') {
      const delta = side === 'left' ? e.clientX - _startX : _startX - e.clientX
      if (delta > 24) {
        expandToDefault()
        _mode = 'resize'
        _startX = e.clientX
        _startW = width
      }
    }
  }

  function onPointerUp() {
    const wasExpandClick = _mode === 'expand'
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
    if (wasExpandClick && collapsed) {
      expandToDefault()
    } else if (_mode === 'resize' && !collapsed) {
      lastExpandedWidth = width
      saveState()
    }
    _mode = null
  }

  const railChevron = $derived(side === 'left' ? '›' : '‹')
  const railCursor = $derived(side === 'left' ? 'cursor-e-resize' : 'cursor-w-resize')
  const railTitle = $derived(
    side === 'left'
      ? 'Show options panel (click or drag right)'
      : 'Show representations panel (click or drag left)'
  )
</script>

<div class="flex min-h-0 shrink-0 {side === 'right' ? 'flex-row-reverse' : ''}">
  {#if collapsed}
    <button
      type="button"
      class="group flex w-5 shrink-0 flex-col items-center justify-center border-0 bg-neutral-100 text-neutral-500 transition-colors hover:bg-neutral-200 hover:text-neutral-800 dark:bg-neutral-900 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-200 {railCursor}"
      title={railTitle}
      aria-label={railTitle}
      aria-expanded="false"
      onpointerdown={onExpandRailPointerDown}
    >
      <span class="text-xs leading-none opacity-70 group-hover:opacity-100" aria-hidden="true"
        >{railChevron}</span
      >
    </button>
  {/if}
  <!-- Keep panel children mounted while collapsed so Visualize ViewItems do not refetch bonds. -->
  <div
    class="min-h-0 shrink-0 {className}"
    class:hidden={collapsed}
    style="width: {width}px"
    aria-expanded={!collapsed}
    aria-hidden={collapsed}
  >
    {@render children?.()}
  </div>
  {#if !collapsed}
    <div
      class="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-yellow-500/50"
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(width)}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      title="Drag to resize · drag past minimum to collapse"
      onpointerdown={onResizePointerDown}
    ></div>
  {/if}
</div>
