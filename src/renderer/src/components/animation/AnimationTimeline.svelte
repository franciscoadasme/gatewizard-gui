<script>
  import { onDestroy } from 'svelte'
  import Button from '../ui/Button.svelte'
  import Spinner from '../ui/Spinner.svelte'
  import Play from '../icons/Play.svelte'
  import Pause from '../icons/Pause.svelte'
  import Stop from '../icons/Stop.svelte'
  import CaptureKeyframe from '../icons/CaptureKeyframe.svelte'
  import Save from '../icons/Save.svelte'
  import Load from '../icons/Load.svelte'
  import ExportVideo from '../icons/ExportVideo.svelte'
  import AnimationEasingEditor from './AnimationEasingEditor.svelte'
  import AnimationFadeEditor from './AnimationFadeEditor.svelte'
  import { easingLabel } from '../../lib/animation/easing.js'
  import { viewsApproximatelyEqual } from '../../lib/animation/keyframeEasing.js'
  import { EXPORT_ASPECT_PRESETS } from '../../lib/animation/schema.js'
  import {
    coerceExportFormat,
    exportFormatsForBackground
  } from '../../lib/animation/exportFormats.js'
  import { clampNumber } from '../../lib/rangeInput.js'
  import {
    animFrameToTime,
    animTimeToFrame,
    snapAnimTime
  } from '../../lib/animation/timelinePlayhead.js'
  import { isTrajHotkeyBlocked } from '../../lib/viewer/trajectoryFrames.js'
  import ConfirmPrompt from './ConfirmPrompt.svelte'

  /**
   * @type {{
   *   playhead: number
   *   duration_s: number
   *   fps?: number
   *   playing: boolean
   *   exporting?: boolean
   *   keyframes?: import('../../lib/animation/schema.js').AnimationKeyframe[]
   *   cameraTrack?: { keys: import('../../lib/animation/channelTracks.js').CameraChannelKey[] }
   *   structureTracks?: Record<string, { keys: import('../../lib/animation/channelTracks.js').StructureChannelKey[] }>
   *   viewKeyTracks?: Record<string, { keys: import('../../lib/animation/channelTracks.js').ViewChannelKey[] }>
   *   viewTracks?: string[]
   *   liveViews?: { id: string, selection?: string, baseSelection?: string, structureId?: string }[]
   *   structures?: { id?: string, label?: string, path?: string }[]
   *   activeTrack?: { kind: 'camera' } | { kind: 'structure', structureId: string } | { kind: 'view', viewId: string } | null
   *   onActiveTrackChange?: (t: { kind: 'camera' } | { kind: 'structure', structureId: string } | { kind: 'view', viewId: string } | null) => void
   *   onPlayPause: () => void
   *   onStop: () => void
   *   onScrub: (time_s: number) => void
   *   onGoToKeyframe?: (id: string) => void
   *   onMoveKeyframe?: (id: string, time_s: number) => void
   *   onMoveKeyframes?: (moves: { id: string, time_s: number }[]) => void
   *   onRenameKeyframe?: (id: string, name: string) => void
   *   onDuplicateKeyframe?: (id: string) => void
   *   onDeleteKeyframe?: (id: string) => void
   *   onClearKeyframes?: () => void
   *   onCaptureKeyframe?: () => void
   *   workingDir?: string
   *   outputFolder?: string
   *   projectName?: string
   *   exportFrame?: import('../../lib/animation/schema.js').AnimationExportFrame
   *   onOutputFolderChange?: (v: string) => void
   *   onProjectNameChange?: (v: string) => void
   *   onFpsChange?: (v: number) => void
   *   onDurationChange?: (v: number) => void
   *   onExportFrameChange?: (frame: import('../../lib/animation/schema.js').AnimationExportFrame) => void
   *   onSaveProject?: () => void
   *   onLoadProject?: () => void
   *   onExportVideo?: () => void
   *   onEasingChange?: (
   *     toKeyframeId: string,
   *     next: {
   *       easing: import('../../lib/animation/easing.js').AnimationEasingKind
   *       easingBezier?: [number, number, number, number]
   *     },
   *     channel: 'camera' | 'motion' | 'style',
   *     structureId?: string | null,
   *     viewId?: string | null
   *   ) => void
   *   onViewFadeChange?: (
   *     viewId: string,
   *     keyframeId: string,
   *     next: import('../../lib/animation/fade.js').AnimationFadeSettings
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
    cameraTrack = { keys: [] },
    structureTracks = {},
    viewKeyTracks = {},
    viewTracks = [],
    liveViews = [],
    structures = [],
    activeTrack = null,
    onActiveTrackChange,
    onPlayPause,
    onStop,
    onScrub,
    onGoToKeyframe,
    onMoveKeyframe,
    onMoveKeyframes,
    onRenameKeyframe,
    onDuplicateKeyframe,
    onDeleteKeyframe,
    onClearKeyframes,
    onCaptureKeyframe,
    workingDir = '',
    outputFolder = '',
    projectName = '',
    exportFrame = {
      aspectPreset: '16:9',
      width: 1920,
      height: 1080,
      showGuide: true,
      exportFormat: 'mp4'
    },
    onOutputFolderChange,
    onProjectNameChange,
    onFpsChange,
    onDurationChange,
    onExportFrameChange,
    onSaveProject,
    onLoadProject,
    onExportVideo,
    onEasingChange,
    onViewFadeChange,
    onClose
  } = $props()

  const safeDuration = $derived(Math.max(duration_s, 0.01))
  const safeFps = $derived(Math.max(1, fps))
  const frameStep = $derived(1 / safeFps)
  const totalFrames = $derived(Math.max(1, Math.round(safeDuration * safeFps)))
  const cameraKeys = $derived([...(cameraTrack?.keys ?? [])].sort((a, b) => a.time_s - b.time_s))
  let trackEl = $state(/** @type {HTMLDivElement | null} */ (null))
  let rulerEl = $state(/** @type {HTMLDivElement | null} */ (null))
  let draggingId = $state(/** @type {string | null} */ (null))
  let draggingPlayhead = $state(false)
  let displayPlayhead = $state(/** @type {number | null} */ (null))
  const shownPlayhead = $derived(displayPlayhead ?? playhead)
  let suppressTrackClick = false
  /** @type {number | null} */
  let pendingScrub = null
  let scrubRaf = 0
  /** @type {Record<string, boolean>} */
  let structureExpanded = $state({})
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

  /** @param {string} preset */
  function onAspectPresetChange(preset) {
    if (!onExportFrameChange) return
    const size = EXPORT_ASPECT_PRESETS[/** @type {keyof typeof EXPORT_ASPECT_PRESETS} */ (preset)]
    onExportFrameChange({
      ...exportFrame,
      aspectPreset: /** @type {import('../../lib/animation/schema.js').AnimationAspectPreset} */ (preset),
      ...(preset !== 'custom' && size ? { width: size.width, height: size.height } : {})
    })
  }

  /**
   * @param {Event} e
   * @param {(v: number) => void} apply
   * @param {number} min
   * @param {number} max
   * @param {number} step
   */
  function commitNum(e, apply, min, max, step) {
    apply(clampNumber(/** @type {HTMLInputElement} */ (e.currentTarget).value, min, max, step))
  }

  /** @param {number} t */
  function snapTime(t) {
    return snapAnimTime(t, safeFps, duration_s)
  }

  function flushScrub() {
    scrubRaf = 0
    const next = pendingScrub
    pendingScrub = null
    if (next == null) return
    onScrub(next)
  }

  /** @param {number} time_s */
  function queueScrub(time_s) {
    pendingScrub = snapTime(time_s)
    if (scrubRaf) return
    scrubRaf = requestAnimationFrame(flushScrub)
  }

  onDestroy(() => {
    if (scrubRaf) cancelAnimationFrame(scrubRaf)
  })

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
    const t = snapTime(time_s)
    displayPlayhead = t
    queueScrub(t)
  }

  /** @param {string} raw */
  function commitJumpTime(raw) {
    if (exporting) return
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    displayPlayhead = null
    scrubTo(n)
  }

  /** @param {string} raw */
  function commitJumpFrame(raw) {
    if (exporting) return
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    displayPlayhead = null
    scrubTo(animFrameToTime(n, safeFps, duration_s))
  }

  let confirmKind = $state(/** @type {null | 'clear' | 'delete'} */ (null))
  let confirmDeleteIds = $state(/** @type {string[]} */ ([]))
  let selectedKeyIds = $state(/** @type {string[]} */ ([]))

  const aspectOptions = Object.keys(EXPORT_ASPECT_PRESETS)
  const formatOptions = $derived(exportFormatsForBackground(exportFrame?.transparentBg === true))
  const selectedFormat = $derived(
    coerceExportFormat(exportFrame?.exportFormat, exportFrame?.transparentBg === true)
  )
  const fieldClass =
    'min-w-0 rounded border border-neutral-300 bg-transparent px-1.5 py-0.5 text-[11px] dark:border-neutral-800 dark:bg-neutral-950'
  const numClass =
    'field-input w-14 shrink-0 rounded px-1 py-0.5 text-right font-mono text-[10px] tabular-nums'

  /** @param {string} id */
  function keySelectedClass(id) {
    return selectedKeyIds.includes(id) ? 'ring-2 ring-white ring-offset-1 ring-offset-neutral-900' : ''
  }

  /** @param {string} id */
  function toggleKeySelection(id) {
    selectedKeyIds = selectedKeyIds.includes(id)
      ? selectedKeyIds.filter((keyId) => keyId !== id)
      : [...selectedKeyIds, id]
  }

  /** @param {string[]} ids */
  function requestDelete(ids) {
    const unique = [...new Set(ids)].filter(Boolean)
    if (!unique.length || exporting || !onDeleteKeyframe) return
    confirmDeleteIds = unique
    confirmKind = 'delete'
  }

  function deletePlayheadKeyframe() {
    if (selectedKeyIds.length) {
      requestDelete(selectedKeyIds)
      return
    }
    const kf = playheadKeyframe
    if (!kf?.id || exporting || !onDeleteKeyframe) return
    requestDelete([kf.id])
  }

  function confirmClearKeyframes() {
    if (!channelKeyCount || exporting || !onClearKeyframes) return
    confirmKind = 'clear'
  }

  function closeConfirm() {
    confirmKind = null
    confirmDeleteIds = []
  }

  function acceptConfirm() {
    const kind = confirmKind
    const ids = confirmDeleteIds
    closeConfirm()
    if (kind === 'clear') onClearKeyframes?.()
    else if (kind === 'delete') {
      for (const id of ids) onDeleteKeyframe?.(id)
      selectedKeyIds = selectedKeyIds.filter((id) => !ids.includes(id))
    }
  }

  /**
   * Keyframe dots, the playhead, and easing bars keep their own clicks.
   * @param {EventTarget | null} target
   */
  function isTrackControlTarget(target) {
    return (
      target instanceof Element &&
      !!target.closest('[data-keyframe], [data-playhead], [data-segment]')
    )
  }

  /**
   * Empty lane or ruler: drop the key selection, then scrub.
   * Pointer-down owns this because the following click is suppressed by the scrub drag.
   * @param {PointerEvent} e
   * @param {HTMLElement | null} el
   */
  function onEmptyTrackPointerDown(e, el) {
    if (exporting || isTrackControlTarget(e.target)) return
    selectedKeyIds = []
    startScrubDrag(e, el)
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
      if (scrubRaf) {
        cancelAnimationFrame(scrubRaf)
        flushScrub()
      }
      displayPlayhead = null
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
    onEmptyTrackPointerDown(e, rulerEl)
  }

  /** @param {PointerEvent} e */
  function onLanePointerDown(e) {
    const lane = e.currentTarget instanceof HTMLElement ? e.currentTarget : trackEl
    onEmptyTrackPointerDown(e, lane)
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
   * @param {{ channel: { kind: string, structureId?: string, viewId?: string } } | null | undefined} ref
   */
  function keyTrackId(ref) {
    if (!ref) return ''
    if (ref.channel.kind === 'structure') return `s:${ref.channel.structureId}`
    if (ref.channel.kind === 'view') return `v:${ref.channel.viewId}`
    return 'camera'
  }

  /**
   * @param {Map<string, number>} starts
   * @param {number} delta
   */
  function movesForDelta(starts, delta) {
    const times = [...starts.values()]
    let nextDelta = delta
    const minT = Math.min(...times)
    const maxT = Math.max(...times)
    if (minT + nextDelta < 0) nextDelta = -minT
    if (maxT + nextDelta > safeDuration) nextDelta = safeDuration - maxT
    return [...starts.entries()].map(([kid, t0]) => {
      let time_s = snapTime(t0 + nextDelta)
      const self = timelineKeyById(kid)
      const track = keyTrackId(self)
      const blocked = allTimelineKeys.some(
        (other) =>
          !starts.has(other.id) &&
          keyTrackId(other) === track &&
          Math.abs(other.time_s - time_s) < 0.05
      )
      if (blocked) time_s = t0
      return { id: kid, time_s }
    })
  }

  /**
   * @param {PointerEvent} e
   * @param {string} id
   */
  function onKeyframePointerDown(e, id) {
    if (e.ctrlKey || e.metaKey) {
      e.stopPropagation()
      e.preventDefault()
      toggleKeySelection(id)
      return
    }
    startKeyframeDrag(e, id)
  }

  /**
   * @param {MouseEvent} e
   * @param {string} id
   */
  function onKeyframeClick(e, id) {
    e.stopPropagation()
    if (e.ctrlKey || e.metaKey || draggingId) return
    onGoToKeyframe?.(id)
  }

  /**
   * @param {PointerEvent} e
   * @param {string} id
   */
  function startKeyframeDrag(e, id) {
    if (exporting || (!onMoveKeyframe && !onMoveKeyframes)) return
    e.stopPropagation()
    e.preventDefault()
    if (!selectedKeyIds.includes(id)) selectedKeyIds = [id]
    const group = selectedKeyIds.includes(id) ? selectedKeyIds : [id]
    /** @type {Map<string, number>} */
    const starts = new Map()
    for (const gid of group) {
      const ref = timelineKeyById(gid)
      if (ref) starts.set(gid, ref.time_s)
    }
    if (!starts.has(id)) starts.set(id, timelineKeyById(id)?.time_s ?? playhead)
    const origin = starts.get(id) ?? 0
    draggingId = id
    suppressTrackClick = true

    /** @param {PointerEvent} ev */
    const onMove = (ev) => {
      const moves = movesForDelta(starts, timeFromClientX(ev.clientX, trackEl) - origin)
      const dragged = moves.find((move) => move.id === id)
      const ordered = dragged ? [...moves.filter((move) => move.id !== id), dragged] : moves
      if (onMoveKeyframes) onMoveKeyframes(ordered)
      else for (const move of ordered) onMoveKeyframe?.(move.id, move.time_s)
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
    const keys = viewKeyTracks?.[trackId]?.keys ?? []
    for (const k of keys) {
      if (k.view?.selection || k.view?.baseSelection) {
        return k.view.selection || k.view.baseSelection || trackId.slice(0, 8)
      }
    }
    for (const kf of keyframes) {
      const sv = kf.views?.find((v) => String(v.id) === trackId)
      if (sv?.selection || sv?.baseSelection) {
        return sv.selection || sv.baseSelection || trackId.slice(0, 8)
      }
    }
    return trackId.slice(0, 8)
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

  /** @type {{ toKeyframeId: string, channel: 'camera' | 'motion' | 'style', structureId?: string | null, viewId?: string | null } | null} */
  let selectedSegment = $state(null)
  /** @type {{ viewId: string, keyframeId: string } | null} */
  let selectedFade = $state(null)

  /** @param {string} structureId */
  function structureLabel(structureId) {
    const meta = structures.find((s) => s.id === structureId)
    if (meta?.label) return meta.label
    if (meta?.path) return String(meta.path).split(/[/\\]/).pop() || structureId
    return structureId.slice(0, 8)
  }

  const structureRowIds = $derived.by(() => {
    /** @type {Set<string>} */
    const ids = new Set()
    for (const s of structures) {
      if (s.id) ids.add(s.id)
    }
    for (const sid of Object.keys(structureTracks || {})) ids.add(sid)
    for (const v of liveViews) {
      if (v.structureId && !/** @type {any} */ (v)._isSelHighlight) ids.add(v.structureId)
    }
    return [...ids]
  })

  /** @param {string} structureId */
  function viewsForStructure(structureId) {
    /** @type {Set<string>} */
    const ids = new Set()
    for (const vid of viewTracks) {
      const live = liveViews.find((v) => String(v.id) === vid)
      if (live?.structureId === structureId) ids.add(vid)
      else if ((viewKeyTracks?.[vid]?.keys ?? []).some((k) => k.view?.structureId === structureId)) {
        ids.add(vid)
      }
    }
    for (const v of liveViews) {
      if (/** @type {any} */ (v)._isSelHighlight) continue
      if (v.structureId === structureId) ids.add(String(v.id))
    }
    return [...ids]
  }

  const orphanViewIds = $derived.by(() => {
    /** @type {Set<string>} */
    const assigned = new Set()
    for (const sid of structureRowIds) {
      for (const vid of viewsForStructure(sid)) assigned.add(vid)
    }
    /** @type {Set<string>} */
    const out = new Set()
    for (const vid of viewTracks) {
      if (!assigned.has(vid)) out.add(vid)
    }
    for (const v of liveViews) {
      if (/** @type {any} */ (v)._isSelHighlight) continue
      const id = String(v.id)
      if (!v.structureId && !assigned.has(id)) out.add(id)
    }
    return [...out]
  })

  /**
   * @typedef {{ id: string, time_s: number, label: string, channel: { kind: 'camera' } | { kind: 'structure', structureId: string } | { kind: 'view', viewId: string } }} TimelineKeyRef
   */

  const allTimelineKeys = $derived.by(() => {
    /** @type {TimelineKeyRef[]} */
    const out = []
    for (const k of cameraKeys) {
      out.push({
        id: k.id,
        time_s: k.time_s,
        label: `Camera · ${k.time_s.toFixed(2)}s`,
        channel: { kind: 'camera' }
      })
    }
    for (const [sid, tr] of Object.entries(structureTracks || {})) {
      for (const k of tr.keys || []) {
        out.push({
          id: k.id,
          time_s: k.time_s,
          label: `${structureLabel(sid)} · ${k.time_s.toFixed(2)}s`,
          channel: { kind: 'structure', structureId: sid }
        })
      }
    }
    for (const [vid, tr] of Object.entries(viewKeyTracks || {})) {
      for (const k of tr.keys || []) {
        out.push({
          id: k.id,
          time_s: k.time_s,
          label: `${trackLabel(vid)} · ${k.time_s.toFixed(2)}s`,
          channel: { kind: 'view', viewId: vid }
        })
      }
    }
    if (!out.length) {
      for (const k of keyframes) {
        out.push({
          id: k.id,
          time_s: k.time_s,
          label: k.name || `Keyframe · ${k.time_s.toFixed(2)}s`,
          channel: { kind: 'camera' }
        })
      }
    }
    return out.sort((a, b) => a.time_s - b.time_s)
  })

  const channelKeyCount = $derived(allTimelineKeys.length)

  const playheadKeyframe = $derived.by(() => {
    const tol = frameStep * 0.51
    const near = allTimelineKeys.filter((k) => Math.abs(k.time_s - shownPlayhead) < tol)
    if (!near.length) return null
    if (activeTrack?.kind === 'camera') {
      const hit = near.find((k) => k.channel.kind === 'camera')
      if (hit) return hit
    } else if (activeTrack?.kind === 'structure') {
      const hit = near.find(
        (k) => k.channel.kind === 'structure' && k.channel.structureId === activeTrack.structureId
      )
      if (hit) return hit
    } else if (activeTrack?.kind === 'view') {
      const hit = near.find(
        (k) => k.channel.kind === 'view' && k.channel.viewId === activeTrack.viewId
      )
      if (hit) return hit
    }
    return near[0]
  })

  /** @param {string} structureId */
  function isStructureExpanded(structureId) {
    return structureExpanded[structureId] !== false
  }

  /** @param {string} structureId */
  function toggleStructureExpanded(structureId) {
    structureExpanded = {
      ...structureExpanded,
      [structureId]: !isStructureExpanded(structureId)
    }
  }

  /**
   * @param {{ kind: 'camera' } | { kind: 'structure', structureId: string } | { kind: 'view', viewId: string }} track
   */
  function selectTrack(track) {
    onActiveTrackChange?.(track)
  }

  /** @param {{ kind: 'camera' } | { kind: 'structure', structureId: string } | { kind: 'view', viewId: string }} track */
  function isActiveTrack(track) {
    if (!activeTrack) return false
    if (track.kind === 'camera') return activeTrack.kind === 'camera'
    if (track.kind === 'structure') {
      return activeTrack.kind === 'structure' && activeTrack.structureId === track.structureId
    }
    return activeTrack.kind === 'view' && activeTrack.viewId === track.viewId
  }

  /**
   * @template {{ time_s: number }} T
   * @param {T[]} keys
   */
  function channelSegments(keys) {
    const sorted = [...keys].sort((a, b) => a.time_s - b.time_s)
    return sorted.slice(1).map((to, i) => ({ from: sorted[i], to }))
  }

  const camSegments = $derived(channelSegments(cameraKeys))

  const selectedSegmentInfo = $derived.by(() => {
    if (!selectedSegment) return null
    if (selectedSegment.channel === 'camera') {
      const idx = cameraKeys.findIndex((k) => k.id === selectedSegment.toKeyframeId)
      if (idx <= 0) return null
      return {
        from: cameraKeys[idx - 1],
        to: cameraKeys[idx],
        channel: /** @type {const} */ ('camera'),
        structureId: null,
        viewId: null
      }
    }
    if (selectedSegment.channel === 'style') {
      const vid = selectedSegment.viewId
      if (!vid) return null
      const keys = [...(viewKeyTracks?.[vid]?.keys ?? [])].sort((a, b) => a.time_s - b.time_s)
      const idx = keys.findIndex((k) => k.id === selectedSegment.toKeyframeId)
      if (idx <= 0) return null
      return {
        from: keys[idx - 1],
        to: keys[idx],
        channel: /** @type {const} */ ('style'),
        structureId: null,
        viewId: vid
      }
    }
    const sid = selectedSegment.structureId
    if (!sid) return null
    const keys = [...(structureTracks?.[sid]?.keys ?? [])].sort((a, b) => a.time_s - b.time_s)
    const idx = keys.findIndex((k) => k.id === selectedSegment.toKeyframeId)
    if (idx <= 0) return null
    return {
      from: keys[idx - 1],
      to: keys[idx],
      channel: /** @type {const} */ ('motion'),
      structureId: sid,
      viewId: null
    }
  })

  const selectedFadeInfo = $derived.by(() => {
    if (!selectedFade) return null
    const keys = viewKeyTracks?.[selectedFade.viewId]?.keys ?? []
    const key = keys.find((k) => k.id === selectedFade.keyframeId)
    if (!key) return null
    return { kf: key, view: key.view, viewId: selectedFade.viewId }
  })

  /** @param {string} id */
  function timelineKeyById(id) {
    return allTimelineKeys.find((k) => k.id === id) ?? null
  }

  function menuGoTo() {
    if (!contextMenu) return
    onGoToKeyframe?.(contextMenu.keyframeId)
    closeContextMenu()
  }

  function menuSetTime() {
    if (!contextMenu) return
    const kf = timelineKeyById(contextMenu.keyframeId)
    if (!kf) return
    editDialog = {
      keyframeId: kf.id,
      mode: 'time',
      value: snapTime(kf.time_s).toFixed(3)
    }
    closeContextMenu()
  }

  function menuDuplicate() {
    if (!contextMenu) return
    onDuplicateKeyframe?.(contextMenu.keyframeId)
    closeContextMenu()
  }

  /**
   * @param {string} toKeyframeId
   * @param {'camera' | 'motion' | 'style'} channel
   * @param {string | null} [structureId]
   * @param {string | null} [viewId]
   */
  function openSegmentEasing(toKeyframeId, channel, structureId = null, viewId = null) {
    if (channel === 'camera') {
      if (cameraKeys.findIndex((k) => k.id === toKeyframeId) <= 0) return
    } else if (channel === 'motion' && structureId) {
      const keys = structureTracks?.[structureId]?.keys ?? []
      if (keys.findIndex((k) => k.id === toKeyframeId) <= 0) return
    } else if (channel === 'style' && viewId) {
      const keys = viewKeyTracks?.[viewId]?.keys ?? []
      if (keys.findIndex((k) => k.id === toKeyframeId) <= 0) return
    } else {
      return
    }
    selectedFade = null
    selectedSegment = { toKeyframeId, channel, structureId, viewId }
    closeContextMenu()
  }

  function closeSegmentEasing() {
    selectedSegment = null
  }

  /**
   * @param {string} viewId
   * @param {string} keyframeId
   */
  function openViewFade(viewId, keyframeId) {
    selectedSegment = null
    selectedFade = { viewId, keyframeId }
    closeContextMenu()
  }

  function closeViewFade() {
    selectedFade = null
  }

  /**
   * @param {'camera' | 'motion' | 'style'} channel
   * @param {string | null} [structureId]
   * @param {string | null} [viewId]
   */
  function menuEasing(channel, structureId = null, viewId = null) {
    if (!contextMenu) return
    openSegmentEasing(contextMenu.keyframeId, channel, structureId, viewId)
  }

  function menuDelete() {
    if (!contextMenu) return
    const id = contextMenu.keyframeId
    const ids = selectedKeyIds.includes(id) && selectedKeyIds.length > 1 ? [...selectedKeyIds] : [id]
    closeContextMenu()
    requestDelete(ids)
  }

  function menuViewFade() {
    if (!contextMenu) return
    const hit = timelineKeyById(contextMenu.keyframeId)
    if (!hit || hit.channel.kind !== 'view') return
    openViewFade(hit.channel.viewId, hit.id)
  }

  const contextMenuEasingOptions = $derived.by(() => {
    if (!contextMenu) return null
    const hit = timelineKeyById(contextMenu.keyframeId)
    if (!hit) return null
    if (hit.channel.kind === 'camera') {
      return cameraKeys.findIndex((k) => k.id === hit.id) > 0
        ? { channel: /** @type {const} */ ('camera'), structureId: null, viewId: null }
        : null
    }
    if (hit.channel.kind === 'structure') {
      const sid = hit.channel.structureId
      const keys = structureTracks?.[sid]?.keys ?? []
      return keys.findIndex((k) => k.id === hit.id) > 0
        ? { channel: /** @type {const} */ ('motion'), structureId: sid, viewId: null }
        : null
    }
    if (hit.channel.kind === 'view') {
      const vid = hit.channel.viewId
      const keys = viewKeyTracks?.[vid]?.keys ?? []
      return keys.findIndex((k) => k.id === hit.id) > 0
        ? { channel: /** @type {const} */ ('style'), structureId: null, viewId: vid }
        : null
    }
    return null
  })

  const contextMenuIsViewKey = $derived.by(() => {
    if (!contextMenu) return false
    return timelineKeyById(contextMenu.keyframeId)?.channel.kind === 'view'
  })

  /**
   * @param {MouseEvent} e
   * @param {string} toKeyframeId
   * @param {'camera' | 'motion' | 'style'} channel
   * @param {string | null} [structureId]
   * @param {string | null} [viewId]
   */
  function onSegmentClick(e, toKeyframeId, channel, structureId = null, viewId = null) {
    e.stopPropagation()
    if (exporting) return
    selectedKeyIds = []
    openSegmentEasing(toKeyframeId, channel, structureId, viewId)
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
      if (selectedKeyIds.length) {
        selectedKeyIds = []
        return
      }
      if (canCloseTimeline()) onClose?.()
      return
    }
    if (exporting || editDialog) return
    if (e.key !== 'Delete' && e.key !== 'Backspace') return
    if (isTrajHotkeyBlocked(e.target)) return
    e.preventDefault()
    if (selectedKeyIds.length) requestDelete(selectedKeyIds)
    else deletePlayheadKeyframe()
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
      {formatTime(shownPlayhead)} / {formatTime(duration_s)}
    </span>
    <label class="flex shrink-0 items-center gap-1 text-[11px] text-neutral-500" title="Jump to animation time (seconds)">
      Time
      <input
        class="field-input w-14 rounded px-1 py-0.5 text-right font-mono text-[10px] tabular-nums"
        type="number"
        min="0"
        max={duration_s}
        step={frameStep}
        value={snapTime(shownPlayhead)}
        disabled={exporting}
        aria-label="Jump to time in seconds"
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commitJumpTime(e.currentTarget.value)
          }
        }}
        onchange={(e) => commitJumpTime(e.currentTarget.value)}
      />
    </label>
    <label class="flex shrink-0 items-center gap-1 text-[11px] text-neutral-500" title="Jump to animation frame (timeline FPS, not MD)">
      Frame
      <input
        class="field-input w-12 rounded px-1 py-0.5 text-right font-mono text-[10px] tabular-nums"
        type="number"
        min="0"
        max={totalFrames}
        step="1"
        value={animTimeToFrame(shownPlayhead, safeFps)}
        disabled={exporting}
        aria-label="Jump to animation frame"
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commitJumpFrame(e.currentTarget.value)
          }
        }}
        onchange={(e) => commitJumpFrame(e.currentTarget.value)}
      />
    </label>
    <button
      type="button"
      class={transportBtnClass}
      onclick={deletePlayheadKeyframe}
      disabled={exporting || (!playheadKeyframe && selectedKeyIds.length < 1)}
      title={selectedKeyIds.length > 1
        ? `Delete ${selectedKeyIds.length} selected keyframes`
        : playheadKeyframe
          ? 'Delete keyframe at playhead'
          : 'Move the playhead onto a keyframe to delete it'}
      aria-label="Delete keyframe at playhead"
    >
      <svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <path d="M3 4h10M6 4V3h4v1M5 4l.5 9h5L11 4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
    <button
      type="button"
      class={transportBtnClass}
      onclick={onCaptureKeyframe}
      disabled={playing || exporting || !onCaptureKeyframe}
      title="Capture"
      aria-label="Capture"
    >
      <CaptureKeyframe className="size-3.5" />
    </button>
    <button
      type="button"
      class={transportBtnClass}
      onclick={onSaveProject}
      disabled={exporting || !onSaveProject}
      title="Save project"
      aria-label="Save project"
    >
      <Save className="size-3.5" />
    </button>
    <button
      type="button"
      class={transportBtnClass}
      onclick={onLoadProject}
      disabled={exporting || !onLoadProject}
      title="Load project"
      aria-label="Load project"
    >
      <Load className="size-3.5" />
    </button>
    <button
      type="button"
      class={transportBtnClass}
      onclick={onExportVideo}
      disabled={exporting || !onExportVideo}
      title={exporting ? 'Exporting animation…' : 'Export animation'}
      aria-label="Export animation"
    >
      {#if exporting}
        <Spinner className="size-3.5" />
      {:else}
        <ExportVideo className="size-3.5" />
      {/if}
    </button>

    {#if onClose || onClearKeyframes}
      <div class="ml-auto flex shrink-0 items-center gap-1">
        {#if onClearKeyframes}
          <Button
            variant="outline"
            size="sm"
            onclick={confirmClearKeyframes}
            disabled={exporting || !channelKeyCount}
            title="Remove all channel keys; duration and FPS stay"
          >
            Clear
          </Button>
        {/if}
        {#if onClose}
          <Button variant="outline" size="sm" onclick={onClose} disabled={exporting} title="Close timeline (Esc)">
            Close
          </Button>
        {/if}
      </div>
    {/if}
  </div>

  <div class="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pb-1 text-[11px] text-neutral-500">
    <label class="flex min-w-0 items-center gap-1">
      <span class="shrink-0">Project</span>
      <input
        class="{fieldClass} w-28"
        value={projectName}
        disabled={exporting || !onProjectNameChange}
        oninput={(e) => onProjectNameChange?.(e.currentTarget.value)}
      />
    </label>
    <label class="flex min-w-0 items-center gap-1">
      <span class="shrink-0">Output</span>
      <input
        class="{fieldClass} w-36 font-mono text-[10px]"
        value={outputFolder}
        disabled={exporting || !onOutputFolderChange}
        oninput={(e) => onOutputFolderChange?.(e.currentTarget.value)}
      />
    </label>
    <label class="flex items-center gap-1">
      FPS
      <input
        class={numClass}
        type="number"
        min="1"
        max="120"
        step="1"
        value={fps}
        disabled={exporting || !onFpsChange}
        onchange={(e) => onFpsChange && commitNum(e, onFpsChange, 1, 120, 1)}
      />
    </label>
    <label class="flex items-center gap-1">
      Duration
      <input
        class={numClass}
        type="number"
        min="0.5"
        max="600"
        step="0.1"
        value={duration_s}
        disabled={exporting || !onDurationChange}
        onchange={(e) => onDurationChange && commitNum(e, onDurationChange, 0.5, 600, 0.1)}
      />
    </label>
    <select
      class="field-input w-[4.25rem] shrink-0 rounded px-1 py-0.5 text-[10px]"
      value={exportFrame.aspectPreset}
      disabled={exporting || !onExportFrameChange}
      title="Aspect ratio"
      onchange={(e) => onAspectPresetChange(e.currentTarget.value)}
    >
      {#each aspectOptions as opt}
        <option value={opt}>{opt}</option>
      {/each}
    </select>
    <input
      class={numClass}
      type="number"
      min="64"
      step="1"
      value={exportFrame.width}
      disabled={exporting || !onExportFrameChange || exportFrame.aspectPreset !== 'custom'}
      title="Export width"
      onchange={(e) =>
        onExportFrameChange?.({
          ...exportFrame,
          aspectPreset: 'custom',
          width: Math.max(64, Number(e.currentTarget.value) || exportFrame.width)
        })}
    />
    <span class="text-neutral-600">×</span>
    <input
      class={numClass}
      type="number"
      min="64"
      step="1"
      value={exportFrame.height}
      disabled={exporting || !onExportFrameChange || exportFrame.aspectPreset !== 'custom'}
      title="Export height"
      onchange={(e) =>
        onExportFrameChange?.({
          ...exportFrame,
          aspectPreset: 'custom',
          height: Math.max(64, Number(e.currentTarget.value) || exportFrame.height)
        })}
    />
    <label class="flex items-center gap-1">
      Quality
      <select
        class="field-input w-12 shrink-0 rounded px-1 py-0.5 text-[10px]"
        value={String(exportFrame.quality ?? 2)}
        disabled={exporting || !onExportFrameChange}
        onchange={(e) =>
          onExportFrameChange?.({
            ...exportFrame,
            quality: Number(e.currentTarget.value) || 2
          })}
      >
        <option value="1">1×</option>
        <option value="2">2×</option>
        <option value="3">3×</option>
        <option value="4">4×</option>
        <option value="5">5×</option>
      </select>
    </label>
    <label class="flex items-center gap-1">
      Format
      <select
        class="field-input w-28 shrink-0 rounded px-1 py-0.5 text-[10px]"
        value={selectedFormat}
        disabled={exporting || !onExportFrameChange}
        title="Export format"
        onchange={(e) =>
          onExportFrameChange?.({
            ...exportFrame,
            exportFormat: coerceExportFormat(e.currentTarget.value, exportFrame.transparentBg === true)
          })}
      >
        {#each formatOptions as fmt}
          <option value={fmt.id}>{fmt.label}</option>
        {/each}
      </select>
    </label>
    <label class="flex items-center gap-1">
      <input
        type="checkbox"
        checked={exportFrame.showGuide}
        disabled={exporting || !onExportFrameChange}
        onchange={(e) => onExportFrameChange?.({ ...exportFrame, showGuide: e.currentTarget.checked })}
      />
      Safe area
    </label>
    <label class="flex items-center gap-1" title="Transparent movies are GIF, WebM, or PNG frames. MP4 and MOV stay opaque.">
      <input
        type="checkbox"
        checked={exportFrame.transparentBg === true}
        disabled={exporting || !onExportFrameChange}
        onchange={(e) => {
          const transparentBg = e.currentTarget.checked
          onExportFrameChange?.({
            ...exportFrame,
            transparentBg,
            exportFormat: coerceExportFormat(exportFrame.exportFormat, transparentBg)
          })
        }}
      />
      Transparent
    </label>
  </div>
  {#if !workingDir}
    <p class="px-3 pb-1 text-[10px] text-amber-700 dark:text-amber-300">
      Set a working directory in the top bar to save projects and exports.
    </p>
  {/if}

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
          aria-valuenow={shownPlayhead}
          tabindex="0"
          onpointerdown={onRulerPointerDown}
          oncontextmenu={onTrackContextMenu}
          onkeydown={(e) => {
            if (exporting) return
            if (e.key === 'ArrowLeft') {
              e.preventDefault()
              scrubTo(shownPlayhead - frameStep)
            } else if (e.key === 'ArrowRight') {
              e.preventDefault()
              scrubTo(shownPlayhead + frameStep)
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

    <!-- Camera + playhead (pinned) -->
    <div class="flex gap-2">
      <button
        type="button"
        class="w-24 shrink-0 truncate pt-0.5 text-left text-[10px] font-medium {isActiveTrack({ kind: 'camera' })
          ? 'text-yellow-600 dark:text-yellow-400'
          : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'}"
        title="Camera track — click to make Capture write camera keys"
        onclick={() => selectTrack({ kind: 'camera' })}
      >
        Camera
      </button>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        bind:this={trackEl}
        class="relative h-5 min-w-0 flex-1 {exporting ? 'cursor-default' : draggingPlayhead ? 'cursor-grabbing' : 'cursor-pointer'}"
        onpointerdown={onLanePointerDown}
        oncontextmenu={onTrackContextMenu}
      >
        <div
          class="pointer-events-none absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 rounded-full bg-neutral-300 dark:bg-neutral-700 {exporting
            ? 'opacity-70'
            : ''}"
        ></div>
        <div
          class="pointer-events-none absolute top-1/2 h-3 -translate-y-1/2 rounded-full bg-yellow-500/70"
          style="left: 0; width: {pct(shownPlayhead)}%"
        ></div>
        {#each camSegments as seg (seg.to.id)}
          {@const left = pct(seg.from.time_s)}
          {@const width = Math.max(0.5, pct(seg.to.time_s) - left)}
          {@const selected =
            selectedSegment?.toKeyframeId === seg.to.id && selectedSegment?.channel === 'camera'}
          {@const kind = seg.to.cameraEasing ?? 'easeInOutCubic'}
          <button
            type="button"
            data-segment="camera"
            class="absolute top-1/2 h-2 -translate-y-1/2 rounded-full border transition-colors {exporting
              ? 'pointer-events-none opacity-60'
              : 'cursor-pointer hover:border-sky-400/70 hover:bg-sky-500/25'} {selected
              ? 'border-sky-400 bg-sky-500/35'
              : kind === 'linear'
                ? 'border-neutral-500/50 bg-neutral-500/20'
                : 'border-violet-500/40 bg-violet-500/20'}"
            style="left: {left}%; width: {width}%"
            title="Camera · {easingLabel(kind, seg.to.cameraEasingBezier)} — click to edit"
            onclick={(e) => onSegmentClick(e, seg.to.id, 'camera')}
          ></button>
        {/each}
        {#each cameraKeys as kf (kf.id)}
          {@const left = pct(kf.time_s)}
          {@const active = Math.abs(shownPlayhead - kf.time_s) < frameStep * 0.51}
          {@const dragging = draggingId === kf.id}
          <button
            type="button"
            data-keyframe={kf.id}
            class="absolute top-1/2 z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-yellow-950/40 transition-transform {dragging
              ? 'scale-125 cursor-grabbing bg-yellow-200'
              : exporting
                ? 'cursor-default'
                : 'cursor-grab hover:scale-110'} {active
              ? 'bg-yellow-300'
              : 'bg-yellow-500/90'} {keySelectedClass(kf.id)}"
            style="left: {left}%"
            title="Camera · {snapTime(kf.time_s).toFixed(3)}s — drag to move, right-click to edit"
            onpointerdown={(e) => onKeyframePointerDown(e, kf.id)}
            onclick={(e) => onKeyframeClick(e, kf.id)}
            oncontextmenu={(e) => openKeyframeMenu(e, kf.id)}
          ></button>
        {/each}
        <button
          type="button"
          data-playhead="true"
          class="absolute top-0 z-20 flex -translate-x-1/2 flex-col items-center {exporting
            ? 'pointer-events-none'
            : draggingPlayhead
              ? 'cursor-grabbing'
              : 'cursor-ew-resize'}"
          style="left: {pct(shownPlayhead)}%"
          title="Playhead · {snapTime(shownPlayhead).toFixed(3)}s — drag to scrub (snaps to frames), right-click to capture or delete"
          aria-label="Playhead"
          onpointerdown={startPlayheadDrag}
          onclick={(e) => e.stopPropagation()}
          oncontextmenu={onPlayheadContextMenu}
        >
          <div class="h-4 w-0.5 rounded-full bg-white shadow dark:bg-neutral-100"></div>
          <div class="size-2 -mt-0.5 rotate-45 rounded-sm bg-white shadow dark:bg-neutral-100"></div>
        </button>
      </div>
    </div>

    <div class="mt-0.5 max-h-[40vh] space-y-0.5 overflow-y-auto overscroll-contain">
      {#each structureRowIds as structureId (structureId)}
        {@const structKeys = [...(structureTracks?.[structureId]?.keys ?? [])].sort(
          (a, b) => a.time_s - b.time_s
        )}
        {@const structSegs = channelSegments(structKeys)}
        {@const expanded = isStructureExpanded(structureId)}
        {@const structActive = isActiveTrack({ kind: 'structure', structureId })}
        <div class="flex gap-2">
          <div class="flex w-24 shrink-0 items-start gap-0.5 pt-0.5">
            <button
              type="button"
              class="shrink-0 rounded px-0.5 text-[10px] text-neutral-500 hover:bg-neutral-200/80 dark:hover:bg-neutral-800"
              title={expanded ? 'Collapse representations' : 'Expand representations'}
              onclick={() => toggleStructureExpanded(structureId)}
            >
              {expanded ? '▾' : '▸'}
            </button>
            <button
              type="button"
              class="min-w-0 flex-1 truncate text-left text-[10px] font-medium {structActive
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'}"
              title="{structureLabel(structureId)} — click to capture motion on this structure"
              onclick={() => selectTrack({ kind: 'structure', structureId })}
            >
              {structureLabel(structureId)}
            </button>
          </div>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="relative h-5 min-w-0 flex-1 {exporting ? '' : 'cursor-pointer'}"
            onpointerdown={onLanePointerDown}
          >
            {#each structSegs as seg (`motion-${structureId}-${seg.to.id}`)}
              {@const left = pct(seg.from.time_s)}
              {@const width = Math.max(0.5, pct(seg.to.time_s) - left)}
              {@const kind = seg.to.motionEasing ?? 'easeInOutCubic'}
              {@const selected =
                selectedSegment?.toKeyframeId === seg.to.id &&
                selectedSegment?.channel === 'motion' &&
                selectedSegment?.structureId === structureId}
              <button
                type="button"
                data-segment="motion"
                class="absolute top-1/2 h-2 -translate-y-1/2 rounded-full border transition-colors {exporting
                  ? 'pointer-events-none opacity-60'
                  : 'cursor-pointer hover:border-sky-400/70 hover:bg-sky-500/25'} {selected
                  ? 'border-sky-400 bg-sky-500/35'
                  : kind === 'linear'
                    ? 'border-neutral-500/50 bg-neutral-500/20'
                    : 'border-emerald-500/40 bg-emerald-500/20'}"
                style="left: {left}%; width: {width}%"
                title="{structureLabel(structureId)} · {easingLabel(kind, seg.to.motionEasingBezier)} — click to edit"
                onclick={(e) => onSegmentClick(e, seg.to.id, 'motion', structureId)}
              ></button>
            {/each}
            {#each structKeys as kf (kf.id)}
              {@const left = pct(kf.time_s)}
              {@const dragging = draggingId === kf.id}
              <button
                type="button"
                data-keyframe={kf.id}
                class="absolute top-1/2 z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-950/30 transition-transform {dragging
                  ? 'scale-125 cursor-grabbing bg-amber-200'
                  : exporting
                    ? 'cursor-default'
                    : 'cursor-grab hover:scale-110'} bg-amber-400 hover:bg-amber-300 {keySelectedClass(kf.id)}"
                style="left: {left}%"
                title="{structureLabel(structureId)} · {kf.time_s.toFixed(2)}s"
                onpointerdown={(e) => onKeyframePointerDown(e, kf.id)}
                onclick={(e) => onKeyframeClick(e, kf.id)}
                oncontextmenu={(e) => openKeyframeMenu(e, kf.id)}
              ></button>
            {/each}
          </div>
        </div>

        {#if expanded}
          {#each viewsForStructure(structureId) as trackId (trackId)}
            {@const viewKeys = [...(viewKeyTracks?.[trackId]?.keys ?? [])].sort(
              (a, b) => a.time_s - b.time_s
            )}
            {@const viewSegs = channelSegments(viewKeys)}
            {@const viewActive = isActiveTrack({ kind: 'view', viewId: trackId })}
            <div class="flex gap-2">
              <button
                type="button"
                class="w-24 shrink-0 truncate pl-4 pt-0.5 text-left font-mono text-[10px] {viewActive
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'}"
                title="{trackLabel(trackId)} — click to capture this representation"
                onclick={() => selectTrack({ kind: 'view', viewId: trackId })}
              >
                {trackLabel(trackId)}
              </button>
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="relative h-5 min-w-0 flex-1 {exporting ? '' : 'cursor-pointer'}"
                onpointerdown={onLanePointerDown}
              >
                {#each viewSegs as seg (`style-${trackId}-${seg.to.id}`)}
                  {@const styleDiffers = !viewsApproximatelyEqual(seg.from.view, seg.to.view)}
                  {#if styleDiffers}
                    {@const left = pct(seg.from.time_s)}
                    {@const width = Math.max(0.5, pct(seg.to.time_s) - left)}
                    {@const kind = seg.to.styleEasing ?? 'easeInOutCubic'}
                    {@const selected =
                      selectedSegment?.toKeyframeId === seg.to.id &&
                      selectedSegment?.channel === 'style' &&
                      selectedSegment?.viewId === trackId}
                    <button
                      type="button"
                      data-segment="style"
                      class="absolute top-1/2 h-2 -translate-y-1/2 rounded-full border transition-colors {exporting
                        ? 'pointer-events-none opacity-60'
                        : 'cursor-pointer hover:border-fuchsia-400/70 hover:bg-fuchsia-500/25'} {selected
                        ? 'border-fuchsia-400 bg-fuchsia-500/35'
                        : kind === 'linear'
                          ? 'border-neutral-500/50 bg-neutral-500/20'
                          : 'border-fuchsia-500/40 bg-fuchsia-500/20'}"
                      style="left: {left}%; width: {width}%"
                      title="{trackLabel(trackId)} · style · {easingLabel(kind, seg.to.styleEasingBezier)} — click to edit"
                      onclick={(e) => onSegmentClick(e, seg.to.id, 'style', null, trackId)}
                    ></button>
                  {/if}
                {/each}
                {#each viewKeys as kf (kf.id)}
                  {@const left = pct(kf.time_s)}
                  {@const dragging = draggingId === kf.id}
                  <button
                    type="button"
                    data-keyframe={kf.id}
                    class="absolute top-1/2 z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-950/30 transition-transform {dragging
                      ? 'scale-125 cursor-grabbing bg-emerald-200'
                      : exporting
                        ? 'cursor-default'
                        : 'cursor-grab hover:scale-110'} bg-emerald-500 hover:bg-emerald-400 {keySelectedClass(kf.id)}"
                    style="left: {left}%"
                    title="{trackLabel(trackId)} · {kf.time_s.toFixed(2)}s"
                    onpointerdown={(e) => onKeyframePointerDown(e, kf.id)}
                    onclick={(e) => onKeyframeClick(e, kf.id)}
                    oncontextmenu={(e) => openKeyframeMenu(e, kf.id)}
                  ></button>
                {/each}
              </div>
            </div>
          {/each}
        {/if}
      {/each}

      {#each orphanViewIds as trackId (trackId)}
        {@const viewKeys = [...(viewKeyTracks?.[trackId]?.keys ?? [])].sort(
          (a, b) => a.time_s - b.time_s
        )}
        {@const viewSegs = channelSegments(viewKeys)}
        {@const viewActive = isActiveTrack({ kind: 'view', viewId: trackId })}
        <div class="flex gap-2">
          <button
            type="button"
            class="w-24 shrink-0 truncate pt-0.5 text-left font-mono text-[10px] {viewActive
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'}"
            title="{trackLabel(trackId)} — click to capture this representation"
            onclick={() => selectTrack({ kind: 'view', viewId: trackId })}
          >
            {trackLabel(trackId)}
          </button>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="relative h-5 min-w-0 flex-1 {exporting ? '' : 'cursor-pointer'}"
            onpointerdown={onLanePointerDown}
          >
            {#each viewSegs as seg (`style-orphan-${trackId}-${seg.to.id}`)}
              {@const styleDiffers = !viewsApproximatelyEqual(seg.from.view, seg.to.view)}
              {#if styleDiffers}
                {@const left = pct(seg.from.time_s)}
                {@const width = Math.max(0.5, pct(seg.to.time_s) - left)}
                {@const kind = seg.to.styleEasing ?? 'easeInOutCubic'}
                {@const selected =
                  selectedSegment?.toKeyframeId === seg.to.id &&
                  selectedSegment?.channel === 'style' &&
                  selectedSegment?.viewId === trackId}
                <button
                  type="button"
                  data-segment="style"
                  class="absolute top-1/2 h-2 -translate-y-1/2 rounded-full border transition-colors {exporting
                    ? 'pointer-events-none opacity-60'
                    : 'cursor-pointer hover:border-fuchsia-400/70 hover:bg-fuchsia-500/25'} {selected
                    ? 'border-fuchsia-400 bg-fuchsia-500/35'
                    : kind === 'linear'
                      ? 'border-neutral-500/50 bg-neutral-500/20'
                      : 'border-fuchsia-500/40 bg-fuchsia-500/20'}"
                  style="left: {left}%; width: {width}%"
                  title="{trackLabel(trackId)} · style · {easingLabel(kind, seg.to.styleEasingBezier)} — click to edit"
                  onclick={(e) => onSegmentClick(e, seg.to.id, 'style', null, trackId)}
                ></button>
              {/if}
            {/each}
            {#each viewKeys as kf (kf.id)}
              {@const left = pct(kf.time_s)}
              {@const dragging = draggingId === kf.id}
              <button
                type="button"
                data-keyframe={kf.id}
                class="absolute top-1/2 z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-950/30 transition-transform {dragging
                  ? 'scale-125 cursor-grabbing bg-emerald-200'
                  : exporting
                    ? 'cursor-default'
                    : 'cursor-grab hover:scale-110'} bg-emerald-500 hover:bg-emerald-400 {keySelectedClass(kf.id)}"
                style="left: {left}%"
                title="{trackLabel(trackId)} · {kf.time_s.toFixed(2)}s"
                onpointerdown={(e) => onKeyframePointerDown(e, kf.id)}
                onclick={(e) => onKeyframeClick(e, kf.id)}
                oncontextmenu={(e) => openKeyframeMenu(e, kf.id)}
              ></button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
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
    {#if playheadKeyframe && Math.abs(trackContextMenu.time_s - playheadKeyframe.time_s) < frameStep * 0.51}
      <button
        type="button"
        role="menuitem"
        class="block w-full px-3 py-1.5 text-left text-red-300 hover:bg-neutral-800"
        onclick={() => {
          closeTrackContextMenu()
          deletePlayheadKeyframe()
        }}>Delete keyframe</button
      >
    {/if}
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
    {#if contextMenuEasingOptions}
      <button
        type="button"
        role="menuitem"
        class="block w-full px-3 py-1.5 text-left hover:bg-neutral-800"
        onclick={() =>
          menuEasing(
            contextMenuEasingOptions.channel,
            contextMenuEasingOptions.structureId,
            contextMenuEasingOptions.viewId
          )}
        >{contextMenuEasingOptions.channel === 'camera'
          ? 'Camera easing…'
          : contextMenuEasingOptions.channel === 'style'
            ? 'Style easing…'
            : 'Motion easing…'}</button
      >
    {/if}
    {#if contextMenuIsViewKey}
      <button
        type="button"
        role="menuitem"
        class="block w-full px-3 py-1.5 text-left hover:bg-neutral-800"
        onclick={menuViewFade}>Fade settings…</button
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
  {@const motion = selectedSegmentInfo.channel === 'motion'}
  {@const style = selectedSegmentInfo.channel === 'style'}
  {#key `${selectedSegmentInfo.to.id}:${selectedSegmentInfo.channel}:${selectedSegmentInfo.structureId ?? ''}:${selectedSegmentInfo.viewId ?? ''}`}
    <AnimationEasingEditor
      trackLabel={motion
        ? `${structureLabel(selectedSegmentInfo.structureId || '')} motion`
        : style
          ? `${trackLabel(selectedSegmentInfo.viewId || '')} style`
          : 'Camera easing'}
      fromLabel={`${motion ? 'Motion' : style ? 'Style' : 'Camera'} · ${selectedSegmentInfo.from.time_s.toFixed(2)}s`}
      toLabel={`${motion ? 'Motion' : style ? 'Style' : 'Camera'} · ${selectedSegmentInfo.to.time_s.toFixed(2)}s`}
      fromTime_s={selectedSegmentInfo.from.time_s}
      toTime_s={selectedSegmentInfo.to.time_s}
      easing={motion
        ? (selectedSegmentInfo.to.motionEasing ?? 'easeInOutCubic')
        : style
          ? (selectedSegmentInfo.to.styleEasing ?? 'easeInOutCubic')
          : (selectedSegmentInfo.to.cameraEasing ?? 'easeInOutCubic')}
      easingBezier={motion
        ? (selectedSegmentInfo.to.motionEasingBezier ?? null)
        : style
          ? (selectedSegmentInfo.to.styleEasingBezier ?? null)
          : (selectedSegmentInfo.to.cameraEasingBezier ?? null)}
      onChange={(next) =>
        onEasingChange(
          selectedSegmentInfo.to.id,
          next,
          selectedSegmentInfo.channel,
          selectedSegmentInfo.structureId,
          selectedSegmentInfo.viewId
        )}
      onClose={closeSegmentEasing}
    />
  {/key}
{/if}

{#if selectedFadeInfo && onViewFadeChange}
  {#key `${selectedFadeInfo.viewId}:${selectedFadeInfo.kf.id}`}
    <AnimationFadeEditor
      itemLabel="{trackLabel(selectedFadeInfo.viewId)} fade"
      fadeEnabled={selectedFadeInfo.view.fadeEnabled}
      fadeIn_s={selectedFadeInfo.view.fadeIn_s}
      fadeOut_s={selectedFadeInfo.view.fadeOut_s}
      fadeInEasing={selectedFadeInfo.view.fadeInEasing}
      fadeOutEasing={selectedFadeInfo.view.fadeOutEasing}
      fadeInBezier={selectedFadeInfo.view.fadeInBezier ?? null}
      fadeOutBezier={selectedFadeInfo.view.fadeOutBezier ?? null}
      onChange={(next) => onViewFadeChange(selectedFadeInfo.viewId, selectedFadeInfo.kf.id, next)}
      onClose={closeViewFade}
    />
  {/key}
{/if}

<ConfirmPrompt
  open={confirmKind !== null}
  title={confirmKind === 'clear'
    ? 'Clear all keys?'
    : confirmDeleteIds.length > 1
      ? `Remove ${confirmDeleteIds.length} keyframes?`
      : 'Delete this key?'}
  message={confirmKind === 'clear'
    ? `Remove all ${channelKeyCount} channel key${channelKeyCount === 1 ? '' : 's'}? Duration and FPS stay.`
    : confirmDeleteIds.length > 1
      ? 'The selected keys are removed from their tracks.'
      : 'This key is removed from its track.'}
  confirmLabel={confirmKind === 'clear' ? 'Clear' : 'Delete'}
  onCancel={closeConfirm}
  onConfirm={acceptConfirm}
/>
