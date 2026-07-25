<script>
  import Button from '../ui/Button.svelte'
  import Play from '../icons/Play.svelte'
  import Pause from '../icons/Pause.svelte'
  import Stop from '../icons/Stop.svelte'
  import AnimationEasingEditor from './AnimationEasingEditor.svelte'
  import { easingLabel } from '../../lib/animation/easing.js'
  import { keyframesForTrackTimeline } from '../../lib/animation/tracks.js'

  /**
   * @type {{
   *   playhead: number
   *   duration_s: number
   *   fps?: number
   *   playing: boolean
   *   exporting?: boolean
   *   keyframes?: import('../../lib/animation/schema.js').AnimationKeyframe[]
   *   viewTracks?: string[]
   *   liveViews?: { id: string, selection?: string, baseSelection?: string }[]
   *   onPlayPause: () => void
   *   onStop: () => void
   *   onScrub: (time_s: number) => void
   *   onGoToKeyframe?: (id: string) => void
   *   onMoveKeyframe?: (id: string, time_s: number) => void
   *   onRenameKeyframe?: (id: string, name: string) => void
   *   onDuplicateKeyframe?: (id: string) => void
   *   onDeleteKeyframe?: (id: string) => void
   *   onCaptureKeyframe?: () => void
   *   onEasingChange?: (
   *     toKeyframeId: string,
   *     next: {
   *       easing: import('../../lib/animation/easing.js').AnimationEasingKind
   *       easingBezier?: [number, number, number, number]
   *     }
   *   ) => void
   *   onClose?: () => void
   * }}
   */
  let {
    playhead,
    duration_s,
    fps = 30,
    playing,
    exporting = false,
    keyframes = [],
    viewTracks = [],
    liveViews = [],
    onPlayPause,
    onStop,
    onScrub,
    onGoToKeyframe,
    onMoveKeyframe,
    onRenameKeyframe,
    onDuplicateKeyframe,
    onDeleteKeyframe,
    onCaptureKeyframe,
    onEasingChange,
    onClose
  } = $props()

  const safeDuration = $derived(Math.max(duration_s, 0.01))
  const safeFps = $derived(Math.max(1, fps))
  const frameStep = $derived(1 / safeFps)
  const sortedKeyframes = $derived([...keyframes].sort((a, b) => a.time_s - b.time_s))
  let trackEl = $state(/** @type {HTMLDivElement | null} */ (null))
  let rulerEl = $state(/** @type {HTMLDivElement | null} */ (null))
  let draggingId = $state(/** @type {string | null} */ (null))
  let draggingPlayhead = $state(false)
  let suppressTrackClick = false
  let tracksExpanded = $state(false)
  /** @type {{ x: number, y: number, keyframeId: string } | null} */
  let contextMenu = $state(null)
  /** @type {{ x: number, y: number, time_s: number } | null} */
  let trackContextMenu = $state(null)
  let menuPos = $state({ x: 0, y: 0 })
  let menuEl = $state(/** @type {HTMLDivElement | null} */ (null))
  let trackMenuEl = $state(/** @type {HTMLDivElement | null} */ (null))
  /** @type {{ keyframeId: string, mode: 'rename' | 'time', value: string } | null} */
  let editDialog = $state(null)

  const transportBtnClass =
    'flex size-7 shrink-0 items-center justify-center rounded border border-neutral-300 bg-white text-neutral-800 transition-colors hover:bg-neutral-100 disabled:pointer-events-none disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800'

  /** @param {number} t */
  function snapTime(t) {
    const step = frameStep
    const snapped = Math.round(t / step) * step
    const precision = Math.min(6, Math.max(2, String(step).split('.')[1]?.length ?? 0) + 1)
    return Math.max(0, Math.min(duration_s, Number(snapped.toFixed(precision))))
  }

  function formatTime(t) {
    const frame = Math.round(t * safeFps)
    const totalFrames = Math.max(1, Math.round(safeDuration * safeFps))
    const m = Math.floor(t / 60)
    const s = Math.floor(t % 60)
    const f = frame % safeFps
    return `${m}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')} (${frame}/${totalFrames})`
  }

  /** @param {number} t */
  function formatRulerTime(t) {
    if (t < 60) return `${Number(t.toFixed(Math.abs(t - Math.round(t)) < 1e-6 ? 0 : 1))}s`
    const m = Math.floor(t / 60)
    const s = Math.round(t % 60)
    return s ? `${m}:${String(s).padStart(2, '0')}` : `${m}m`
  }

  /** @param {number} time_s */
  function pct(time_s) {
    return Math.max(0, Math.min(100, (time_s / safeDuration) * 100))
  }

  /** @param {number} clientX @param {HTMLElement | null} [el] */
  function timeFromClientX(clientX, el = trackEl) {
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left))
    return snapTime((x / rect.width) * safeDuration)
  }

  /** @param {number} time_s */
  function scrubTo(time_s) {
    onScrub(snapTime(time_s))
  }

  /** @param {MouseEvent} e */
  function onTrackClick(e) {
    if (suppressTrackClick || exporting) return
    if (e.target instanceof Element && e.target.closest('[data-keyframe]')) return
    if (e.target instanceof Element && e.target.closest('[data-playhead]')) return
    scrubTo(timeFromClientX(e.clientX, trackEl))
  }

  /** @param {MouseEvent} e */
  function onRulerClick(e) {
    if (suppressTrackClick || exporting) return
    scrubTo(timeFromClientX(e.clientX, rulerEl))
  }

  /**
   * @param {PointerEvent} e
   * @param {HTMLElement | null} el
   */
  function startScrubDrag(e, el) {
    if (exporting || !el) return
    e.stopPropagation()
    e.preventDefault()
    draggingPlayhead = true
    suppressTrackClick = true
    scrubTo(timeFromClientX(e.clientX, el))

    /** @param {PointerEvent} ev */
    const onMove = (ev) => {
      scrubTo(timeFromClientX(ev.clientX, el))
    }
    const onUp = () => {
      draggingPlayhead = false
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setTimeout(() => {
        suppressTrackClick = false
      }, 0)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  /** @param {PointerEvent} e */
  function onRulerPointerDown(e) {
    startScrubDrag(e, rulerEl)
  }

  /** @param {PointerEvent} e */
  function onTrackPointerDown(e) {
    if (e.target instanceof Element && e.target.closest('[data-keyframe]')) return
    if (e.target instanceof Element && e.target.closest('[data-playhead]')) return
    startScrubDrag(e, trackEl)
  }

  /** @param {PointerEvent} e */
  function startPlayheadDrag(e) {
    e.stopPropagation()
    startScrubDrag(e, trackEl)
  }

  function canCloseTimeline() {
    return !!onClose && !editDialog && !contextMenu && !trackContextMenu && !selectedSegment
  }

  /**
   * @param {PointerEvent} e
   * @param {string} id
   */
  function startKeyframeDrag(e, id) {
    if (exporting || !onMoveKeyframe) return
    e.stopPropagation()
    e.preventDefault()
    draggingId = id
    suppressTrackClick = true

    /** @param {PointerEvent} ev */
    const onMove = (ev) => {
      onMoveKeyframe(id, timeFromClientX(ev.clientX, trackEl))
    }
    const onUp = () => {
      draggingId = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setTimeout(() => {
        suppressTrackClick = false
      }, 0)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const rulerTicks = $derived.by(() => {
    /** @type {{ time: number, label?: string, major: boolean }[]} */
    const ticks = []
    const majorStep =
      safeDuration <= 8 ? 1 : safeDuration <= 30 ? 2 : safeDuration <= 90 ? 5 : safeDuration <= 240 ? 10 : 30
    for (let t = 0; t <= safeDuration + 1e-6; t += majorStep) {
      ticks.push({ time: t, label: formatRulerTime(t), major: true })
    }
    if (safeDuration <= 12 && frameStep <= 0.5) {
      for (let t = 0; t <= safeDuration + 1e-6; t += frameStep) {
        const onMajor = ticks.some((tick) => Math.abs(tick.time - t) < 1e-6)
        if (!onMajor) ticks.push({ time: t, major: false })
      }
      ticks.sort((a, b) => a.time - b.time)
    }
    return ticks
  })

  /** @param {string} trackId */
  function trackLabel(trackId) {
    const live = liveViews.find((v) => String(v.id) === trackId)
    if (live?.selection || live?.baseSelection) {
      return live.selection || live.baseSelection || trackId.slice(0, 8)
    }
    for (const kf of keyframes) {
      const sv = kf.views.find((v) => String(v.id) === trackId)
      if (sv?.selection || sv?.baseSelection) {
        return sv.selection || sv.baseSelection || trackId.slice(0, 8)
      }
    }
    return trackId.slice(0, 8)
  }

  /**
   * @param {import('../../lib/animation/schema.js').AnimationKeyframe} kf
   * @param {string} trackId
   */
  function keyframeHasTrack(kf, trackId) {
    return kf.views.some((v) => String(v.id) === trackId)
  }

  function handleWindowClick() {
    if (editDialog) return
    closeContextMenu()
    closeTrackContextMenu()
  }

  function closeEditDialog() {
    editDialog = null
  }

  function submitEditDialog() {
    if (!editDialog) return
    if (editDialog.mode === 'rename') {
      const name = editDialog.value.trim()
      if (name) onRenameKeyframe?.(editDialog.keyframeId, name)
    } else {
      const t = Number(editDialog.value)
      if (Number.isFinite(t)) {
        onMoveKeyframe?.(editDialog.keyframeId, snapTime(Math.max(0, Math.min(duration_s, t))))
      }
    }
    closeEditDialog()
  }

  /**
   * @param {MouseEvent} e
   * @param {string} keyframeId
   */
  function openKeyframeMenu(e, keyframeId) {
    e.preventDefault()
    e.stopPropagation()
    if (exporting) return
    closeTrackContextMenu()
    contextMenu = { x: e.clientX, y: e.clientY, keyframeId }
  }

  function closeContextMenu() {
    contextMenu = null
  }

  function closeTrackContextMenu() {
    trackContextMenu = null
  }

  /**
   * @param {MouseEvent} e
   * @param {number} [time_s]
   */
  function openTrackContextMenu(e, time_s) {
    e.preventDefault()
    e.stopPropagation()
    if (exporting || playing || !onCaptureKeyframe) return
    closeContextMenu()
    trackContextMenu = {
      x: e.clientX,
      y: e.clientY,
      time_s: snapTime(time_s ?? timeFromClientX(e.clientX)),
    }
  }

  /**
   * @param {MouseEvent} e
   */
  function onTrackContextMenu(e) {
    if (e.target instanceof Element && e.target.closest('[data-keyframe]')) return
    openTrackContextMenu(e)
  }

  /** @param {MouseEvent} e */
  function onPlayheadContextMenu(e) {
    openTrackContextMenu(e, playhead)
  }

  function menuCaptureKeyframe() {
    if (!trackContextMenu) return
    onScrub(trackContextMenu.time_s)
    onCaptureKeyframe?.()
    closeTrackContextMenu()
  }

  $effect(() => {
    if (!contextMenu || !menuEl) return
    const rect = menuEl.getBoundingClientRect()
    const pad = 8
    let x = contextMenu.x
    let y = contextMenu.y
    if (x + rect.width > window.innerWidth - pad) {
      x = Math.max(pad, window.innerWidth - rect.width - pad)
    }
    if (y + rect.height > window.innerHeight - pad) {
      y = Math.max(pad, contextMenu.y - rect.height)
    }
    menuPos = { x, y }
  })

  let trackMenuPos = $state({ x: 0, y: 0 })

  $effect(() => {
    if (!trackContextMenu || !trackMenuEl) return
    const rect = trackMenuEl.getBoundingClientRect()
    const pad = 8
    let x = trackContextMenu.x
    let y = trackContextMenu.y
    if (x + rect.width > window.innerWidth - pad) {
      x = Math.max(pad, window.innerWidth - rect.width - pad)
    }
    if (y + rect.height > window.innerHeight - pad) {
      y = Math.max(pad, trackContextMenu.y - rect.height)
    }
    trackMenuPos = { x, y }
  })

  /** @param {string} id */
  function keyframeById(id) {
    return keyframes.find((k) => k.id === id)
  }

  function menuGoTo() {
    if (!contextMenu) return
    onGoToKeyframe?.(contextMenu.keyframeId)
    closeContextMenu()
  }

  function menuSetTime() {
    if (!contextMenu) return
    const kf = keyframeById(contextMenu.keyframeId)
    if (!kf) return
    editDialog = {
      keyframeId: kf.id,
      mode: 'time',
      value: snapTime(kf.time_s).toFixed(3)
    }
    closeContextMenu()
  }

  function menuRename() {
    if (!contextMenu) return
    const kf = keyframeById(contextMenu.keyframeId)
    if (!kf) return
    editDialog = {
      keyframeId: kf.id,
      mode: 'rename',
      value: kf.name || `Keyframe ${sortedKeyframes.indexOf(kf) + 1}`
    }
    closeContextMenu()
  }

  function menuDuplicate() {
    if (!contextMenu) return
    onDuplicateKeyframe?.(contextMenu.keyframeId)
    closeContextMenu()
  }

  /** @type {{ toKeyframeId: string } | null} */
  let selectedSegment = $state(null)

  const segments = $derived(
    sortedKeyframes.slice(1).map((to, i) => {
      const from = sortedKeyframes[i]
      return { from, to }
    })
  )

  const selectedSegmentInfo = $derived.by(() => {
    if (!selectedSegment) return null
    const idx = sortedKeyframes.findIndex((k) => k.id === selectedSegment.toKeyframeId)
    if (idx <= 0) return null
    const from = sortedKeyframes[idx - 1]
    const to = sortedKeyframes[idx]
    return { from, to }
  })

  /** @param {import('../../lib/animation/schema.js').AnimationKeyframe} to */
  function segmentTitle(to) {
    const idx = sortedKeyframes.indexOf(to)
    const from = idx > 0 ? sortedKeyframes[idx - 1] : null
    if (!from) return ''
    return `${from.name || `Keyframe ${idx}`} → ${to.name || `Keyframe ${idx + 1}`}`
  }

  /** @param {string} toKeyframeId */
  function openSegmentEasing(toKeyframeId) {
    const idx = sortedKeyframes.findIndex((k) => k.id === toKeyframeId)
    if (idx <= 0) return
    selectedSegment = { toKeyframeId }
    closeContextMenu()
  }

  function closeSegmentEasing() {
    selectedSegment = null
  }

  function menuEasing() {
    if (!contextMenu) return
    openSegmentEasing(contextMenu.keyframeId)
  }

  function menuDelete() {
    if (!contextMenu) return
    if (!confirm('Delete this keyframe?')) return
    onDeleteKeyframe?.(contextMenu.keyframeId)
    closeContextMenu()
  }

  /**
   * @param {MouseEvent} e
   * @param {string} toKeyframeId
   */
  function onSegmentClick(e, toKeyframeId) {
    e.stopPropagation()
    if (exporting) return
    openSegmentEasing(toKeyframeId)
  }
</script>

<svelte:window
  onclick={handleWindowClick}
  onkeydown={(e) => {
    if (e.key === 'Escape') {
      if (editDialog) {
        closeEditDialog()
        return
      }
      if (contextMenu) {
        closeContextMenu()
        return
      }
      if (trackContextMenu) {
        closeTrackContextMenu()
        return
      }
      if (selectedSegment) {
        closeSegmentEasing()
        return
      }
      if (canCloseTimeline()) onClose?.()
    }
  }}
/>

<div
  class="flex shrink-0 flex-col border-t border-neutral-300 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900"
>
  <div class="flex items-center gap-2 px-3 py-2">
    <button
      type="button"
      class={transportBtnClass}
      onclick={onPlayPause}
      disabled={exporting}
      title={playing ? 'Pause' : 'Play'}
      aria-label={playing ? 'Pause' : 'Play'}
    >
      {#if playing}
        <Pause className="size-3.5" />
      {:else}
        <Play className="size-3.5" />
      {/if}
    </button>
    <button
      type="button"
      class={transportBtnClass}
      onclick={onStop}
      disabled={exporting}
      title="Stop"
      aria-label="Stop"
    >
      <Stop className="size-3.5" />
    </button>

    <span class="shrink-0 tabular-nums text-[11px] text-neutral-500" title="Snaps to {safeFps} FPS frames">
      {formatTime(playhead)} / {formatTime(duration_s)}
    </span>

    {#if viewTracks.length > 0 || onClose}
      <div class="ml-auto flex shrink-0 items-center gap-1">
        {#if viewTracks.length > 0}
          <button
            type="button"
            class="rounded px-1.5 py-0.5 text-[10px] text-neutral-500 hover:bg-neutral-200/80 dark:hover:bg-neutral-800"
            onclick={() => (tracksExpanded = !tracksExpanded)}
          >
            Tracks {tracksExpanded ? '▾' : '▸'}
          </button>
        {/if}
        {#if onClose}
          <Button variant="outline" size="sm" onclick={onClose} disabled={exporting} title="Close timeline (Esc)">
            Close
          </Button>
        {/if}
      </div>
    {/if}
  </div>

  <div class="space-y-0.5 px-3 pb-2">
    <!-- Time ruler -->
    <div class="flex gap-2">
      <div class="w-24 shrink-0 pt-3 text-[10px] font-medium text-neutral-500">Time</div>
      <div class="relative min-w-0 flex-1">
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          bind:this={rulerEl}
          class="relative h-5 cursor-pointer border-b border-neutral-300/80 dark:border-neutral-700/80 {exporting
            ? 'cursor-default opacity-70'
            : draggingPlayhead
              ? 'cursor-grabbing'
              : ''}"
          role="slider"
          aria-label="Time ruler"
          aria-valuemin={0}
          aria-valuemax={duration_s}
          aria-valuenow={playhead}
          tabindex="0"
          onclick={onRulerClick}
          onpointerdown={onRulerPointerDown}
          oncontextmenu={onTrackContextMenu}
          onkeydown={(e) => {
            if (exporting) return
            if (e.key === 'ArrowLeft') {
              e.preventDefault()
              scrubTo(playhead - frameStep)
            } else if (e.key === 'ArrowRight') {
              e.preventDefault()
              scrubTo(playhead + frameStep)
            }
          }}
        >
          {#each rulerTicks as tick (tick.time)}
            {@const left = pct(tick.time)}
            <div
              class="pointer-events-none absolute bottom-0 z-0 -translate-x-1/2"
              style="left: {left}%"
            >
              <div
                class="{tick.major
                  ? 'h-2.5 w-px bg-neutral-500 dark:bg-neutral-400'
                  : 'h-1.5 w-px bg-neutral-400/70 dark:bg-neutral-600/70'}"
              ></div>
            </div>
          {/each}
          {#each rulerTicks as tick (tick.time)}
            {#if tick.label}
              {@const left = pct(tick.time)}
              <span
                class="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap text-[9px] font-medium tabular-nums text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]"
                style="left: {left}%"
                >{tick.label}</span
              >
            {/if}
          {/each}
        </div>
      </div>
    </div>

    <!-- Camera / playhead track (clean — no easing bars here) -->
    <div class="flex gap-2">
      <div class="w-24 shrink-0 pt-4 text-[10px] font-medium text-neutral-500">Camera</div>
      <div class="relative min-w-0 flex-1">
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          bind:this={trackEl}
          class="absolute inset-x-0 top-[1.125rem] h-3 cursor-pointer rounded-full bg-neutral-300 dark:bg-neutral-700 {exporting
            ? 'cursor-default opacity-70'
            : draggingPlayhead
              ? 'cursor-grabbing'
              : ''}"
          onclick={onTrackClick}
          onpointerdown={onTrackPointerDown}
          oncontextmenu={onTrackContextMenu}
        ></div>
        <div
          class="pointer-events-none absolute top-[1.125rem] h-3 rounded-full bg-yellow-500/70"
          style="left: 0; width: {pct(playhead)}%"
        ></div>
        {#each keyframes as kf (kf.id)}
          {@const left = pct(kf.time_s)}
          {@const active = Math.abs(playhead - kf.time_s) < frameStep * 0.51}
          {@const dragging = draggingId === kf.id}
          <button
            type="button"
            data-keyframe={kf.id}
            class="absolute top-0.5 z-10 -translate-x-1/2 rounded px-0.5 transition-transform {dragging
              ? 'scale-125 cursor-grabbing text-yellow-200'
              : exporting
                ? 'cursor-default'
                : 'cursor-grab hover:scale-110'} {active
              ? 'text-yellow-300'
              : 'text-yellow-600/80 dark:text-yellow-500/80'}"
            style="left: {left}%"
            title="{kf.name || 'Keyframe'} · {snapTime(kf.time_s).toFixed(3)}s — drag to move, right-click to edit"
            onpointerdown={(e) => startKeyframeDrag(e, kf.id)}
            onclick={(e) => {
              e.stopPropagation()
              if (!draggingId) onGoToKeyframe?.(kf.id)
            }}
            oncontextmenu={(e) => openKeyframeMenu(e, kf.id)}
          >
            <svg viewBox="0 0 12 16" class="size-3.5" fill="currentColor" aria-hidden="true">
              <path d="M6 0 L12 5.5 V16 H0 V5.5 Z" />
            </svg>
          </button>
        {/each}
        <button
          type="button"
          data-playhead="true"
          class="absolute top-0 z-20 flex -translate-x-1/2 flex-col items-center {exporting
            ? 'pointer-events-none'
            : draggingPlayhead
              ? 'cursor-grabbing'
              : 'cursor-ew-resize'}"
          style="left: {pct(playhead)}%"
          title="Playhead · {snapTime(playhead).toFixed(3)}s — drag to scrub (snaps to frames), right-click to capture keyframe"
          aria-label="Playhead"
          onpointerdown={startPlayheadDrag}
          onclick={(e) => e.stopPropagation()}
          oncontextmenu={onPlayheadContextMenu}
        >
          <svg viewBox="0 0 12 16" class="size-3.5 text-white drop-shadow dark:text-neutral-100" fill="currentColor" aria-hidden="true">
            <path d="M6 0 L12 5.5 V16 H0 V5.5 Z" />
          </svg>
          <div class="h-3 w-0.5 rounded-full bg-white shadow dark:bg-neutral-100"></div>
        </button>
      </div>
    </div>

    <!-- Easing segments on their own row so they do not block scrubbing -->
    {#if segments.length > 0}
      <div class="flex gap-2">
        <div class="w-24 shrink-0 pt-0.5 text-[10px] font-medium text-neutral-500">Easing</div>
        <div class="relative h-3 min-w-0 flex-1">
          {#each segments as seg (seg.to.id)}
            {@const left = pct(seg.from.time_s)}
            {@const width = Math.max(0.5, pct(seg.to.time_s) - left)}
            {@const selected = selectedSegment?.toKeyframeId === seg.to.id}
            {@const isLinear = (seg.to.easing ?? 'easeInOutCubic') === 'linear'}
            <button
              type="button"
              class="absolute top-0.5 h-2 rounded-full border transition-colors {exporting
                ? 'pointer-events-none opacity-60'
                : 'cursor-pointer hover:border-sky-400/70 hover:bg-sky-500/25'} {selected
                ? 'border-sky-400 bg-sky-500/35'
                : isLinear
                  ? 'border-neutral-500/50 bg-neutral-500/20'
                  : 'border-violet-500/40 bg-violet-500/20'}"
              style="left: {left}%; width: {width}%"
              title="{segmentTitle(seg.to)} · {easingLabel(seg.to.easing ?? 'easeInOutCubic', seg.to.easingBezier)} — click to edit easing"
              onclick={(e) => onSegmentClick(e, seg.to.id)}
            ></button>
          {/each}
        </div>
      </div>
    {/if}

    {#if tracksExpanded && viewTracks.length > 0}
      <div class="mt-0.5 max-h-28 space-y-0.5 overflow-y-auto">
        {#each viewTracks as trackId (trackId)}
          <div class="flex gap-2">
            <div
              class="w-24 shrink-0 truncate pt-0.5 font-mono text-[10px] text-neutral-500"
              title={trackLabel(trackId)}
            >
              {trackLabel(trackId)}
            </div>
            <div class="relative h-4 min-w-0 flex-1">
              {#each keyframesForTrackTimeline(keyframes, trackId) as kf (kf.id)}
                {@const left = pct(kf.time_s)}
                {@const explicit = keyframeHasTrack(kf, trackId)}
                <button
                  type="button"
                  class="absolute top-1/2 z-10 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full {explicit
                    ? 'bg-emerald-500/80 hover:bg-emerald-400'
                    : 'bg-emerald-500/35 hover:bg-emerald-400/60'}"
                  style="left: {left}%"
                  title="{trackLabel(trackId)} · {kf.time_s.toFixed(2)}s{explicit ? '' : ' (inherited)'}"
                  onclick={(e) => {
                    e.stopPropagation()
                    onGoToKeyframe?.(kf.id)
                  }}
                  oncontextmenu={(e) => openKeyframeMenu(e, kf.id)}
                ></button>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

{#if trackContextMenu}
  <div
    bind:this={trackMenuEl}
    role="menu"
    class="fixed z-[200] min-w-44 rounded-md border border-neutral-700 bg-neutral-900 py-1 text-xs text-neutral-200 shadow-xl"
    style="left:{trackMenuPos.x}px;top:{trackMenuPos.y}px"
  >
    <button
      type="button"
      role="menuitem"
      class="block w-full px-3 py-1.5 text-left hover:bg-neutral-800"
      onclick={menuCaptureKeyframe}
      >Capture keyframe at {snapTime(trackContextMenu.time_s).toFixed(2)}s</button
    >
  </div>
{/if}

{#if contextMenu}
  <div
    bind:this={menuEl}
    role="menu"
    class="fixed z-[200] min-w-36 rounded-md border border-neutral-700 bg-neutral-900 py-1 text-xs text-neutral-200 shadow-xl"
    style="left:{menuPos.x}px;top:{menuPos.y}px"
  >
    <button
      type="button"
      role="menuitem"
      class="block w-full px-3 py-1.5 text-left hover:bg-neutral-800"
      onclick={menuGoTo}>Go to keyframe</button
    >
    <button
      type="button"
      role="menuitem"
      class="block w-full px-3 py-1.5 text-left hover:bg-neutral-800"
      onclick={menuSetTime}>Set time…</button
    >
    <button
      type="button"
      role="menuitem"
      class="block w-full px-3 py-1.5 text-left hover:bg-neutral-800"
      onclick={menuDuplicate}>Duplicate</button
    >
    <button
      type="button"
      role="menuitem"
      class="block w-full px-3 py-1.5 text-left hover:bg-neutral-800"
      onclick={menuRename}>Rename…</button
    >
    {#if sortedKeyframes.findIndex((k) => k.id === contextMenu.keyframeId) > 0}
      <button
        type="button"
        role="menuitem"
        class="block w-full px-3 py-1.5 text-left hover:bg-neutral-800"
        onclick={menuEasing}>Segment easing…</button
      >
    {/if}
    <button
      type="button"
      role="menuitem"
      class="block w-full px-3 py-1.5 text-left text-red-300 hover:bg-neutral-800"
      onclick={menuDelete}>Delete</button
    >
  </div>
{/if}

{#if editDialog}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="fixed inset-0 z-[210] flex items-center justify-center bg-black/40 p-4"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-labelledby="kf-edit-title"
    onclick={closeEditDialog}
    onkeydown={(e) => e.key === 'Escape' && closeEditDialog()}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="w-full max-w-xs rounded-lg border border-neutral-700 bg-neutral-900 p-3 shadow-xl"
      onclick={(e) => e.stopPropagation()}
    >
      <p id="kf-edit-title" class="mb-2 text-xs font-semibold text-neutral-200">
        {editDialog.mode === 'rename' ? 'Rename keyframe' : 'Set keyframe time'}
      </p>
      <form
        class="flex gap-2"
        onsubmit={(e) => {
          e.preventDefault()
          submitEditDialog()
        }}
      >
        <input
          class="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100"
          type={editDialog.mode === 'time' ? 'number' : 'text'}
          min={editDialog.mode === 'time' ? 0 : undefined}
          max={editDialog.mode === 'time' ? duration_s : undefined}
          step={editDialog.mode === 'time' ? String(frameStep) : undefined}
          value={editDialog.value}
          oninput={(e) => {
            if (!editDialog) return
            editDialog = { ...editDialog, value: e.currentTarget.value }
          }}
        />
        <button
          type="submit"
          class="rounded bg-yellow-600 px-2 py-1 text-xs font-medium text-neutral-950 hover:bg-yellow-500"
          >OK</button
        >
        <button
          type="button"
          class="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
          onclick={closeEditDialog}>Cancel</button
        >
      </form>
      {#if editDialog.mode === 'time'}
        <p class="mt-2 text-[10px] text-neutral-500">Snaps to {safeFps} FPS ({frameStep.toFixed(3)}s steps)</p>
      {/if}
    </div>
  </div>
{/if}

{#if selectedSegmentInfo && onEasingChange}
  {#key selectedSegmentInfo.to.id}
    <AnimationEasingEditor
      fromLabel={selectedSegmentInfo.from.name || 'Keyframe'}
      toLabel={selectedSegmentInfo.to.name || 'Keyframe'}
      fromTime_s={selectedSegmentInfo.from.time_s}
      toTime_s={selectedSegmentInfo.to.time_s}
      easing={selectedSegmentInfo.to.easing ?? 'easeInOutCubic'}
      easingBezier={selectedSegmentInfo.to.easingBezier ?? null}
      onChange={(next) => onEasingChange(selectedSegmentInfo.to.id, next)}
      onClose={closeSegmentEasing}
    />
  {/key}
{/if}
