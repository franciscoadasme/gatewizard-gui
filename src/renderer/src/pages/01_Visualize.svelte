<script>
  import {
    AxesGizmo,
    AxesLines,
    BallStick,
    Licorice,
    CameraRig,
    Canvas,
    Cartoon,
    AtomGlowLights,
    AtomPoints,
    TrajPlayBridge,
    MeasureOverlay,
    Tube,
    VdwSpheres,
    OrganicSurface,
    HydrationBoxOverlay
  } from '../components/viewer'
  import { T } from '@threlte/core'
  import {
    mainViewerCamera,
    mainViewerFramingAnchor,
    mainViewerInvalidate
  } from '../components/viewer/CameraRig.svelte'
  import { mainViewerControls } from '../components/viewer/Canvas.svelte'
  import SaveIcon from '../components/icons/Save.svelte'
  import LoadIcon from '../components/icons/Load.svelte'
  import Axes from '../components/icons/Axes.svelte'
  import AxesLinesIcon from '../components/icons/AxesLines.svelte'
  import { COLOR_PALETTE, cpkScheme, defaultColorScheme, ssScheme, DEFAULT_VIEW_MATERIAL, isGoodsellMaterial, isGlowingMaterial, resolveGlowingMaterial, GOODSELL_MATERIAL_DEFAULTS, GLOWING_MATERIAL_DEFAULTS } from '../lib/colorSchemes.js'
  import { getCameraForAtoms } from '../lib/viewer/base.js'
  import { pickAtomFromViews } from '../lib/viewer/picking.js'
  import { boundsFromAtomsWithVdw } from '../lib/viewer/hydrationBoxManipulator.js'
  import { PADDING_FIELD_STYLE, VIEWER_AXES, axisInputStyle } from '../lib/viewer/axisColors.js'
  import { measureDistance, measureAngle, measureDihedral } from '../lib/viewer/measure.js'
  import { splitViewIntoParts, splitViewModeLabel } from '../lib/viewer/splitView.js'
  import { effectiveViewSelection, resolveViewAtomSubset } from '../lib/viewer/viewSelection.js'
  import {
    evaluateSelectionIndices,
    filterByIndexSet,
    trySubsetBySelection
  } from '../lib/viewer/dynamicSelection.js'
  import { Color } from 'three'
  import { tick, untrack } from 'svelte'

  /** Reused Color instance for edit mode selection outline. */
  const OUTLINE_COLOR = new Color(0xffdd00) // yellow → BackSide outline for selected group
  const _outlineGetColor = () => OUTLINE_COLOR
  import {
    getStructure,
    getTrajectoryInfo,
    getTrajectoryFrame,
    getTrajectoryXyzBuffer,
    getTrajectoryCache,
    getTrajectoryCacheData,
    computeTrajectoryAlign,
    countAnalysisSelection,
    detectMolecules,
    inspectStructure,
    importStructureEntries,
    editRenameChain,
    editRenameResidues,
    editRenumberResidues,
    editRenameChainByIndices,
    editRenameResiduesByIndices,
    editRenumberResiduesByIndices,
    editSelectByString,
    editDeleteAtoms,
    editDeleteByIndices,
    editSavePdb,
    structureWriteCoords,
    transformCountSelection,
    transformCompute,
    memproRun,
    memproStatus,
    memproScan,
    memproApply,
    packmolCheck,
    packmolEstimateVolume,
    packmolPreviewInp,
    packmolHydrateCavity,
    packmolRunCustom,
    packmolScanJobs,
    structureScratchPdb,
    mutateRotamers,
    mutateApply,
    structureSplitChain,
    structureMerge,
    structureSuperimpose
  } from '../lib/backendApi.js'
  import {
    defaultHydrationFolderName,
    defaultAnimationFolderName,
    outputFolderPath
  } from '../lib/outputFolders.js'
  import { createEmptyProject, normalizeProject, sortKeyframes, serializeAnimationProject } from '../lib/animation/schema.js'
  import { easingForCapturedKeyframe, previousKeyframeAtTime } from '../lib/animation/keyframeEasing.js'
  import {
    applySceneSettings,
    captureViewerSnapshot,
    deserializeAtomLabels,
    deserializeMeasurements,
    deserializeView
  } from '../lib/animation/serialize.js'
  import { applyCameraPose, waitForMainViewerReady } from '../lib/animation/cameraPose.js'
  import { applyAnimationAtTime, startPlayback } from '../lib/animation/playback.js'
  import { shouldApplyCoordPatch, shouldSeekTrajFrame } from '../lib/animation/timelinePlayhead.js'
  import {
    buildViewpoint,
    normalizeViewpoint,
    serializeViewpoint
  } from '../lib/viewpoint.js'
  import {
    createStructureEntry,
    findStructure,
    isMaestroPath,
    serializeStructuresMeta,
    normalizeStructuresMeta,
    groupStructureMetasForLoad,
    componentKeyFromSelection,
    componentLabel,
    normalizeTrajectoryMeta,
    structureFetchPath,
    nextDuplicateLabel,
    highlightIndicesForStructure,
    editStructureIdFromPanel
  } from '../lib/visualizeStructures.js'
  import {
    claimedStructureIds,
    claimedViewIds,
    createVisibilityGroup,
    dissolveVisibilityGroup,
    groupsForStructure,
    normalizeVisibilityGroups,
    pruneVisibilityGroups,
    rangeSelectIds,
    reorderVisibilityGroup,
    serializeVisibilityGroups,
    structureGroups
  } from '../lib/visualizeGroups.js'
  import StructureEntryPicker from '../components/StructureEntryPicker.svelte'
  import TrajectoryOpenDialog from '../components/TrajectoryOpenDialog.svelte'
  import TrajAlignPanel from '../components/TrajAlignPanel.svelte'
  import MutateResiduePanel from '../components/MutateResiduePanel.svelte'
  import SplitChainPanel from '../components/SplitChainPanel.svelte'
  import SuperimposePanel from '../components/SuperimposePanel.svelte'
  import { defaultSelectionForStructuralType } from '../lib/analysisSets.js'
  import ApplyRepresentationPicker from '../components/ApplyRepresentationPicker.svelte'
  import {
    deriveViewTracks,
    isTrackInAnimation,
    persistViewVisibilityInKeyframes,
    persistViewSelectionEachFrameInKeyframes,
    persistViewTrajSmoothRestoreHInKeyframes,
    restoreViewsAfterLeavingAnimate,
    propagateNewViewsToLaterKeyframes,
    registerViewTrack,
    removeViewTrackFromProject,
    repairForwardViewInheritance,
    syncProjectViewTracks
  } from '../lib/animation/tracks.js'
  import {
    captureCanvasPng,
    computeSafeAreaForCanvas,
    exportFormatMeta,
    frameFileName,
    renderFrame
  } from '../lib/animation/export.js'
  import { animationOutputFileName } from '../lib/animation/exportFormats.js'
  import { captureCanvasWithOverlayPng } from '../lib/animation/overlayCapture.js'
  import AnimationPanel from '../components/animation/AnimationPanel.svelte'
  import AnimationTimeline from '../components/animation/AnimationTimeline.svelte'
  import AnimationFadeEditor from '../components/animation/AnimationFadeEditor.svelte'
  import AnimationSafeAreaOverlay from '../components/animation/AnimationSafeAreaOverlay.svelte'
  import { liveOverlayFadeDefaults } from '../lib/animation/serialize.js'
  import { fadeSummary } from '../lib/animation/fade.js'
  import DetectIcon from '../components/icons/Detect.svelte'
  import Plus from '../components/icons/Plus.svelte'
  import ResizableSidePanel from '../components/ResizableSidePanel.svelte'
  import ResetIcon from '../components/icons/Reset.svelte'
  import Sun from '../components/icons/Sun.svelte'
  import Spinner from '../components/ui/Spinner.svelte'
  import RangeInput from '../components/ui/RangeInput.svelte'
  import { viewerBusy, waitForViewerIdle } from '../lib/viewer/viewerBusy.svelte.js'
  import ViewItem, { skipNextPathFetch, skipNextAtomsFetch } from '../components/ViewItem.svelte'
  import ViewerSettingsDialog from '../components/ViewerSettingsDialog.svelte'
  import RadialMenu from '../components/RadialMenu.svelte'
  import TransformGizmo from '../components/TransformGizmo.svelte'
  import HydrationBoxManipulatorOverlay from '../components/viewer/HydrationBoxManipulatorOverlay.svelte'
  import { visualizeStatus, logEvent } from '../lib/pageStatus.svelte.js'
  import { requestSidePanelExpand } from '../lib/pageSidePanelStore.svelte.js'
  import { syncGoodsellSceneLighting } from '../lib/goodsellSceneLighting.svelte.js'
  import { themeState } from '../lib/theme.svelte.js'
  import { themeBackgroundHex, viewerSettings } from '../lib/viewerSettings.svelte.js'
  import { getAppWindowIconUrl } from '../../../shared/brand.js'
  import { clearLabelScreenOffset } from '../lib/viewer/labelStyle.js'
  import {
    applyPatchToAtoms,
    atomsFromBaseAndPatch,
    coordPatchToPreviewArray,
    createCoordUndoStack,
    densePositionsToPreview,
    diffFromBase,
    inversePatchFromBefore,
    normalizeCoordPatch,
    positionsToCoordPatch,
    snapshotAtomCoords
  } from '../lib/viewer/workingCoords.js'
  import {
    applyBlendToViewAtoms,
    applyRigidXyz,
    atomWithPackedXyz,
    labelsWithPackedXyz,
    measurementsWithPackedXyz,
    readAffine12,
    applyXyzFloat32ToAtoms,
    clampTrajSmooth,
    buildHydrogenParentMap,
    trajSmoothRestoreHEnabled,
    collectAtomIndices,
    concatSidecarSlices,
    createTrajectoryFrameCache,
    decodeAlignBinary,
    fileStridesFromFiles,
    gwxyzToAllFrames,
    isTrajHotkeyBlocked,
    loadAllFits,
    parseBoxLengths,
    pickDisplayFrame,
    playTargetFrame,
    TRAJ_PLAY_FPS,
    TRAJ_PLAY_MAX_LAG,
    TRAJ_PREFETCH_PLAY,
    splitPackedFrames,
    trajLoadAllBytesCap,
    trajPlayReady,
    unionAtomIndices,
    xyzBinaryToFrames,
    xyzColumnarToFloat32,
    xyzPackedToFrames
  } from '../lib/viewer/trajectoryFrames.js'
  import {
    blendPlayXyz,
    requestTrajPlayFrame,
    setTrajPlayClock,
    trajPlayClock
  } from '../lib/viewer/trajPlayClock.js'
  import { appSettings } from '../lib/appSettings.svelte.js'

  /** @typedef {{ x: number, y: number, z: number, element: string, name: string }} Atom */
  /** @typedef {{ chain: string, resname: string, number: number, atom_indices: number[], ca_index?: number, sec?: string }} Residue */
  /** @typedef {{ type: 'cartoon' | 'ball-stick' | 'licorice' | 'vdw' | 'tube' | 'points' }} Representation */
  /** @typedef {{ name: string, color?: string, resolver: (atom: Atom) => import('three').Color }} ColorScheme */
  /** @typedef {{ id: string, selection: string, representation: Representation, atoms: Atom[], bonds?: [number, number][], residues?: Residue[], visible: boolean, colorScheme: ColorScheme }} View */
  /** @typedef {ReturnType<typeof getCameraForAtoms> & { framingZoom: number, framingGeneration: number, poseResetGeneration: number }} ViewerFraming */

  /** @type {{ workingDir?: string }} */
  let { workingDir = '' } = $props()

  // form fields
  // ── Multi-structure workspace ────────────────────────────────────────
  /** @type {import('../lib/visualizeStructures.js').StructureEntry[]} */
  let structures = $state([])
  /** @type {string | null} */
  let activeStructureId = $state(null)
  /**
   * Active structure's getStructure-shaped object (atoms/bonds/residues/path).
   * Derived compat for the edit / measure / tool code that expects a single
   * `structure`. Editing tools operate on the ACTIVE structure.
   */
  let structure = $derived(findStructure(structures, activeStructureId))
  /** Active structure path (derived compat). */
  let filePath = $derived(structure?.path ?? null)
  /** Active structure topology (derived compat). */
  let topologyPath = $derived(structure?.topologyPath ?? null)

  /**
   * Multi-entry picker modal state. `resolve` is fulfilled with the selected
   * entry indices (or null on cancel) by the picker callbacks.
   * @type {{ open: boolean, sourcePath: string, entries: Array<{ index: number, label: string, atomCount?: number, title?: string }>, resolve: ((indices: number[] | null) => void) | null }}
   */
  let entryPicker = $state({ open: false, sourcePath: '', entries: [], resolve: null })
  let trajDialogOpen = $state(false)
  let trajPlayhead = $state(0)
  let trajXyzEpoch = $state(0)
  let trajPlaying = $state(false)
  /** @type {HTMLInputElement | null} */
  let trajSliderEl = $state(null)
  /** @type {HTMLElement | null} */
  let trajFrameLabelEl = $state(null)
  let trajScrubbing = $state(false)
  let trajPlayTimer = 0
  let trajPlayRaf = 0
  let trajPlayOriginMs = 0
  let trajPlayOriginFrame = 0
  let trajDisplayFrame = 0
  /** @type {Promise<void>} */
  let trajSeekWaiter = Promise.resolve()
  /** @type {ReturnType<typeof createTrajectoryFrameCache> | null} */
  let trajCache = $state(null)
  /** @type {Map<string, Float32Array>} */
  const trajBlendPrev = new Map()
  /** @type {{ key: string, playhead: number, xyz: Float32Array | null, scratch: Float32Array | null }} */
  let trajBlendShared = { key: '', playhead: -1, xyz: null, scratch: null }
  /** @type {{ key: string, indices: Int32Array | null }} */
  let trajVisibleIndexCache = { key: '', indices: null }
  /** @type {WeakMap<object, Int32Array>} */
  const viewIndexCache = new WeakMap()

  function resetTrajBlendCaches() {
    trajBlendPrev.clear()
    trajBlendShared = { key: '', playhead: -1, xyz: null, scratch: null }
    trajVisibleIndexCache = { key: '', indices: null }
  }

  /** @param {number} frame */
  function syncTrajSliderDom(frame) {
    const n = trajStructure?.trajectory?.logicalFrameCount ?? 0
    const snapped = Math.max(0, Math.round(frame))
    if (trajSliderEl) {
      trajSliderEl.max = String(Math.max(0, n - 1))
      trajSliderEl.value = String(snapped)
    }
    if (trajFrameLabelEl) {
      const digits = String(Math.max(n, 1)).length
      trajFrameLabelEl.textContent = `${String(snapped + 1).padStart(digits, '0')}/${n}`
    }
  }
  /** @type {Map<string, { epoch: number, playhead: number, level: number, restoreH: boolean, each: boolean, sel: string, sourceAtoms: unknown, ownerAtoms: unknown, result: { atoms: object[], bonds: unknown, residues: unknown, xyz: Float32Array | null } }>} */
  const viewDrawCache = new Map()
  /** @type {Map<string, Float32Array>} */
  const trajAlignScratch = new Map()
  /** Keep affines off $state so Float32Array.subarray stays intact. */
  /** @type {Float32Array | null} */
  let trajAlignAffines = null
  const trajStructure = $derived(structures.find((s) => s.trajectory) ?? null)
  let trajAlignOpen = $state(false)
  let mutateOpen = $state(false)
  let mutateChain = $state('')
  let mutateResid = $state(1)
  let mutateTo = $state('PHE')
  let mutateRows = $state(/** @type {Array<{ index: number, prob: number, vdw: number, chi: number[], atoms: Array<{ name: string, element: string, x: number, y: number, z: number }>, best?: boolean }>} */ ([]))
  let mutatePhi = $state(/** @type {number | null} */ (null))
  let mutatePsi = $state(/** @type {number | null} */ (null))
  let mutateSelected = $state(0)
  let mutateBusy = $state(false)
  let mutateError = $state('')
  let mutPreviewAtoms = $state(/** @type {Array<{ index: number, name: string, element: string, x: number, y: number, z: number }>} */ ([]))
  let mutPreviewBonds = $state(/** @type {number[][]} */ ([]))
  const mutPreviewColor = cpkScheme()
  let splitOpen = $state(false)
  let splitChainId = $state('')
  let splitBusy = $state(false)
  let splitError = $state('')
  let superOpen = $state(false)
  let superRefId = $state('')
  let superMobId = $state('')
  let superRefChain = $state('')
  let superMobChain = $state('')
  let superBusy = $state(false)
  let superError = $state('')
  let superResult = $state('')
  /** @type {{ id: string, chain: string } | null} */
  let lastSplit = $state(null)
  const PROTEIN_RESIDUES = new Set([
    'ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'GLN', 'GLU', 'GLY', 'HIS', 'ILE',
    'LEU', 'LYS', 'MET', 'PHE', 'PRO', 'SER', 'THR', 'TRP', 'TYR', 'VAL'
  ])
  /** Residue name at the mutator's chain + number, so the panel can show what will change. */
  const mutateCurrentResname = $derived.by(() => {
    const chain = String(mutateChain || '').trim()
    const resid = Number(mutateResid)
    if (!chain || !Number.isFinite(resid) || !structure) return ''
    const residues = structure.residues
    if (Array.isArray(residues) && residues.length) {
      let fallback = ''
      for (const res of residues) {
        if (String(res.chain || '').trim() !== chain || Number(res.number) !== resid) continue
        const name = String(res.resname || '').toUpperCase()
        if (PROTEIN_RESIDUES.has(name)) return name
        if (!fallback) fallback = name
      }
      if (fallback) return fallback
    }
    const atoms = structure.atoms
    if (!Array.isArray(atoms)) return ''
    let fallback = ''
    for (const atom of atoms) {
      if (String(atom.chain_id || '').trim() !== chain || Number(atom.res_id) !== resid) continue
      const name = String(atom.res_name || '').toUpperCase()
      if (PROTEIN_RESIDUES.has(name)) return name
      if (!fallback) fallback = name
    }
    return fallback
  })
  let trajAlignBusy = $state(false)
  let trajAlignError = $state('')
  let trajAlignAtomCount = $state(/** @type {number | null} */ (null))
  let trajAlignRestoreToken = 0
  let trajAlign = $state({
    selection: defaultSelectionForStructuralType('rmsd').selection,
    referenceFrame: 0,
    /** @type {'none' | 'rmsd' | 'align'} */
    mode: 'none',
    apply: false,
    rmsd: /** @type {number[] | null} */ (null),
    nMobile: /** @type {number | null} */ (null)
  })
  /** @type {{
   *   path: string,
   *   host_path: string,
   *   bytes: number,
   *   header_bytes: number,
   *   frames_ready: number,
   *   frames_total: number,
   *   atom_count: number,
   *   complete: boolean,
   *   error: string | null,
   *   load_all: boolean
   * } | null} */
  let trajCacheInfo = $state(null)
  let trajCachePoll = 0
  let trajSidecarReady = $state(false)
  let trajAdoptPending = $state(false)
  let trajRamLoadLabel = $state('')
  let trajCacheError = $state('')
  const trajCanPlay = $derived(
    trajPlayReady(trajCacheInfo, {
      adoptPending: trajAdoptPending,
      framesReady: trajSidecarReady
    })
  )
  const trajRmsdNow = $derived.by(() => {
    if (!trajAlign.rmsd?.length) return null
    const i = Math.max(0, Math.min(trajAlign.rmsd.length - 1, Math.round(trajPlayhead)))
    return trajAlign.rmsd[i]
  })

  /** Apply-representation menu: which view is targeting other structures. */
  /** @type {{ viewId: string | null, open: boolean }} */
  let applyMenu = $state({ viewId: null, open: false })
  /** @type {Set<string>} */
  let applyMenuSelected = $state(new Set())
  /**
   * Structure groups collapsed in the Representations panel (separate from entry
   * objects so toggling one header does not rebuild every StructureEntry).
   * @type {Set<string>}
   */
  let collapsedStructureIds = $state(new Set())
  /**
   * Structures hidden via the eye toggle. Kept separate from StructureEntry
   * objects so flipping visibility does not rewrite `structures` / `viewAtoms`
   * and rebuild GPU meshes (same pattern as collapse).
   * @type {Set<string>}
   */
  let structureHiddenIds = $state(new Set())
  /**
   * User-created visibility groups (ordered). Empty → implicit Workspace.
   * @type {import('../lib/visualizeGroups.js').VisibilityGroup[]}
   */
  let visibilityGroups = $state([])
  /** @type {Set<string>} */
  let selectedStructureIds = $state(new Set())
  /** @type {Set<string>} */
  let selectedViewIds = $state(new Set())
  /** @type {string | null} */
  let selectionAnchorStructureId = $state(null)
  /** @type {string | null} */
  let selectionAnchorViewId = $state(null)
  /** Right-click menu on a structure row. @type {{ x: number, y: number, id: string } | null} */
  let structureCtxMenu = $state(null)
  /** @type {{ x: number, y: number }} */
  let structureCtxMenuPos = $state({ x: 0, y: 0 })
  /** @type {HTMLDivElement | null} */
  let structureCtxMenuEl = $state(null)
  /** Inline rename for a visibility group. @type {string | null} */
  let editingGroupId = $state(null)
  let editingGroupName = $state('')
  /** @type {HTMLInputElement | null} */
  let editingGroupInputEl = $state(null)
  /** Inline rename for a structure label. @type {string | null} */
  let editingStructureId = $state(null)
  let editingStructureName = $state('')
  /** @type {HTMLInputElement | null} */
  let editingStructureInputEl = $state(null)
  /** Ignore the blur that fires while the field is being mounted and focused. */
  let inlineRenameArmed = false
  /** Structure id while a duplicate PDB is being written and loaded. */
  let duplicatingStructureId = $state(null)
  /** True while selected structures are being written into one PDB. */
  let mergeBusy = $state(false)
  /** Progress while applying structure representations across targets. */
  let applyRepsBusy = $state(false)
  let applyRepsPhase = $state('')

  /** @type {Map<string, Array<{ view: View, index: number }>>} */
  const viewsByStructureId = $derived.by(() => {
    /** @type {Map<string, Array<{ view: View, index: number }>>} */
    const map = new Map()
    for (let i = 0; i < views.length; i++) {
      const v = views[i]
      if (v._isSelHighlight) continue
      const sid = v.structureId || ''
      if (!map.has(sid)) map.set(sid, [])
      map.get(sid).push({ view: v, index: i })
    }
    return map
  })

  let pdbId = $state('')

  // state
  let axesLinesVisible = $state(false)
  let axesVisible = $state(true)
  let sceneSettingsOpen = $state(false)
  const sceneBackgroundStyle = $derived.by(() => {
    const theme = themeState.current
    const mode = viewerSettings.backgroundMode
    const custom = viewerSettings.customBackgroundHex
    const hex = mode === 'custom' ? custom : themeBackgroundHex(theme)
    return `background-color: ${hex}`
  })
  /** @type {ViewerFraming | null} */
  let camera = $state(null)
  let loadingPDB = $state(false)
  /** Phase label shown in the centered 3D viewport overlay while loading. */
  let loadingPhase = $state('')
  /** Elapsed seconds while loading (updated each second). */
  let loadingElapsedSec = $state(0)
  /**
   * Opaque cover while restoring a saved view / animation so intermediate states
   * (default points view, full-atom VDW flash, glow-bulb placement) are not shown.
   */
  let sceneRestoring = $state(false)
  let sceneRestoringPhase = $state('')
  /** Optional subtitle (e.g. current structure label) under the phase. */
  let sceneRestoringDetail = $state('')
  /** 0 / 0 hides the restore progress bar. */
  let sceneRestoringCurrent = $state(0)
  let sceneRestoringTotal = $state(0)
  /** Status line after load (e.g. Using system.prmtop for bonds). */
  let loadBondStatus = $state('')
  let loadingElapsedTimer = 0

  function startOverlayElapsed() {
    loadingElapsedSec = 0
    const started = Date.now()
    if (loadingElapsedTimer) clearInterval(loadingElapsedTimer)
    loadingElapsedTimer = setInterval(() => {
      loadingElapsedSec = Math.floor((Date.now() - started) / 1000)
    }, 250)
  }

  function stopOverlayElapsed() {
    if (loadingElapsedTimer) {
      clearInterval(loadingElapsedTimer)
      loadingElapsedTimer = 0
    }
  }

  function clearSceneRestoreUi() {
    sceneRestoring = false
    sceneRestoringPhase = ''
    sceneRestoringDetail = ''
    sceneRestoringCurrent = 0
    sceneRestoringTotal = 0
    stopOverlayElapsed()
  }

  /**
   * @param {number} current
   * @param {number} total
   * @param {string} [detail]
   */
  function reportStructureLoadProgress(current, total, detail) {
    sceneRestoringCurrent = current
    sceneRestoringTotal = total
    if (total > 1) {
      sceneRestoringPhase = `Loading structures… ${current} / ${total}`
    } else {
      sceneRestoringPhase = 'Loading structure…'
    }
    sceneRestoringDetail = detail ? String(detail) : ''
  }

  /** True while Auto-generate representations is fetching/building views. */
  let autoGeneratingViews = $state(false)
  /** @type {View[]} */
  let views = $state([])

  // ── Measurement & label state ────────────────────────────────────────
  /** @type {'distance'|'angle'|'dihedral'|null} */
  let measureMode = $state(null)
  /** @type {Atom[]} */
  let measurePicks = $state([])
  /** @type {Array<{ id:string, type:'distance'|'angle'|'dihedral', atoms:Atom[], color:string, size:number, lineWidth:number, background?: string, backgroundOpacity?: number, padding?: number, radius?: number, offsetY?: number, liftDir?: string, visible?: boolean }>} */
  let measurements = $state([])
  /** @type {Array<{ id:string, atom:Atom, text:string, size:number, color:string, background?: string, backgroundOpacity?: number, padding?: number, radius?: number, offsetY?: number, liftDir?: string, visible?: boolean }>} */
  let atomLabels = $state([])
  /** @type {{ x:number, y:number, atom:Atom } | null} */
  let ctxMenu = $state(null)
  let canvasWidth = $state(0)
  let canvasHeight = $state(0)
  // Label display settings — captured into each label at creation time
  let labelSize = $state(12)
  let labelColor = $state('#ffffff')
  let labelBackground = $state('#000000')
  let labelBackgroundOpacity = $state(0.75)
  let labelPadding = $state(6)
  let labelRadius = $state(4)
  let labelOffsetY = $state(22)
  /** @type {'up' | 'down' | 'left' | 'right'} */
  let labelLiftDir = $state('up')
  // Measurement display settings — same chip model as labels (+ line width)
  let measSize = $state(15)
  let measColor = $state('#facc15')
  let measBackground = $state('#000000')
  let measBackgroundOpacity = $state(0.75)
  let measPadding = $state(6)
  let measRadius = $state(4)
  let measOffsetY = $state(0)
  /** @type {'up' | 'down' | 'left' | 'right'} */
  let measLiftDir = $state('up')
  let measLineWidth = $state(3)
  // Panel section collapse state (labels start collapsed — less clutter with representations)
  let measExpanded = $state(false)
  let labelsExpanded = $state(false)
  /** @type {{ kind: 'label' | 'meas' | 'view', id: string } | null} */
  let overlayFadeEditor = $state(null)

  // Animation mode
  let animateMode = $state(false)
  let animExpanded = $state(true)
  let animProject = $state(createEmptyProject())
  let animPlayhead = $state(0)
  let animPlaying = $state(false)
  let animExporting = $state(false)
  let animExportPhase = $state('')
  let animExportFrame = $state(0)
  let animExportTotal = $state(0)
  /** Set true by Cancel during export; checked between frames / before encode. */
  let animExportCancelRequested = false
  /** @type {(() => void) | null} */
  let animStopPlayback = null
  /** Last applied animation coord-patch signature; skip atom clones when unchanged. */
  let lastAnimCoordSig = /** @type {string | undefined} */ (undefined)

  // Gear panel open state
  /** @type {{ kind: 'meas'|'label', id: string } | null} */
  let gearOpen = $state(null)
  function toggleGear(kind, id) {
    gearOpen = gearOpen?.kind === kind && gearOpen.id === id ? null : { kind, id }
  }

  // Bottom toolbar / edit state
  let openMenuOpen = $state(false)
  let editMenuOpen = $state(false)
  let editBusy = $state(false)
  /** Hover-open timers for dropdown menus */
  let _openHoverTimer = null
  let _selectHoverTimer = null
  let _editMenuHoverTimer = null
  let _toolsMenuHoverTimer = null
  /** @type {HTMLElement | null} */
  let openMenuBtnEl = $state(null)
  /** @type {HTMLElement | null} */
  let selectMenuBtnEl = $state(null)
  /** @type {HTMLElement | null} */
  let editMenuBtnEl = $state(null)
  /** @type {HTMLElement | null} */
  let toolsMenuBtnEl = $state(null)

  /** Fixed coords so upward menus aren’t clipped by the toolbar’s overflow-x scroll. */
  function toolbarMenuFixedStyle(anchorEl) {
    if (!anchorEl || typeof window === 'undefined') return ''
    const r = anchorEl.getBoundingClientRect()
    return `position:fixed;left:${Math.round(r.left)}px;bottom:${Math.round(window.innerHeight - r.top + 2)}px;z-index:60`
  }

  function closeAllToolbarMenus() {
    openMenuOpen = false
    selectMenuOpen = false
    editMenuOpen = false
    toolsMenuOpen = false
  }
  /** @type {HTMLElement | null} */
  let viewerEl = $state(null)

  // ── Interactive Edit Mode ────────────────────────────────────────────
  let editMode = $state(false)

  // ── Sync to shared status bar store ──
  $effect(() => {
    visualizeStatus.loading = loadingPDB
    visualizeStatus.loaded = structure !== null
    visualizeStatus.fileName = filePath ? (String(filePath).split(/[/\\]/).pop() ?? '') : ''
    visualizeStatus.viewCount = views.length
  })

  $effect(() => {
    const needsFlatLighting = views.some(
      (v) =>
        v.visible &&
        isGoodsellMaterial(v.material) &&
        v.material.useGoodsellLighting !== false
    )
    syncGoodsellSceneLighting(needsFlatLighting)
  })
  let selectMenuOpen = $state(false)
  const EDIT_LEVEL_LABEL = { atom: 'Atom', residue: 'Res', chain: 'Chain', molecule: 'Mol.' }
  /** @type {'atom'|'residue'|'chain'|'molecule'} */
  let editSelectionLevel = $state('residue')
  /** @type {{ name:string, element:string, index:number, res_name:string, res_id:number, chain_id:string } | null} */
  let editHoveredAtom = $state(null)
  /** @type {Set<number>} */
  let editHoverGroupIndices = $state(new Set())
  /** @type {{ clientX:number, clientY:number } | null} */
  let editTooltip = $state(null)
  /** @type {Set<number>} — persistent selection locked by left-click */
  let selectedGroupIndices = $state(new Set())
  /** @type {{ name:string, element:string, index:number, res_name:string, res_id:number, chain_id:string } | null} */
  let selectedAtom = $state(null)
  /** Atom index for DOF focus so the target follows trajectory xyz. */
  let dofFocusAtomIndex = $state(/** @type {number | null} */ (null))

  /** Atoms that receive bulb lights when Glowing material filter is “highlighted”. */
  const glowHighlightIndices = $derived.by(() => {
    const indices = new Set(selectedGroupIndices)
    for (const i of editHoverGroupIndices) indices.add(i)
    return indices
  })

  const editSelectedAtoms = $derived(
    editMode && selectedGroupIndices.size > 0 && structure
      ? structure.atoms.filter((a) => selectedGroupIndices.has(a.index))
      : []
  )

  // When selection LEVEL changes mid-hover: recompute the hover group for the
  // current atom at the new level, and clear the stale click-locked selection.
  // Does NOT re-run when only editHoveredAtom changes (hover movement is handled
  // directly in handleCanvasHover), so the yellow outline persists during hover.
  $effect(() => {
    const level = editSelectionLevel
    const atom = untrack(() => editHoveredAtom)
    editHoverGroupIndices = atom ? new Set(_editGroupIndices(atom, level)) : new Set()
    selectedGroupIndices = new Set()
    selectedAtom = null
  })

  // Clear hover state when edit mode is turned off
  $effect(() => {
    if (!editMode) {
      editHoveredAtom = null
      editHoverGroupIndices = new Set()
      editTooltip = null
      selectedGroupIndices = new Set()
      selectedAtom = null
      showGizmo = false
      if (selHighlightViewId) {
        views = views.filter((v) => v.id !== selHighlightViewId)
        selHighlightViewId = null
      }
    }
  })
  // Edit dialog refs
  /** @type {HTMLDialogElement | null} */
  let dlgRenameChain = $state(null)
  /** @type {HTMLDialogElement | null} */
  let dlgRenameRes = $state(null)
  /** @type {HTMLDialogElement | null} */
  let dlgRenumberRes = $state(null)
  /** @type {HTMLDialogElement | null} */
  let dlgDeleteAtoms = $state(null)
  /** @type {HTMLDialogElement | null} */
  let dlgTransform = $state(null)
  // Rename chain form fields
  let rcOldChain = $state('')
  let rcNewChain = $state('')
  let rcApplyToSel = $state(false)
  // Rename residues form fields
  let rrChain = $state('')
  let rrStart = $state(1)
  let rrEnd = $state(9999)
  let rrNewName = $state('')
  let rrApplyToSel = $state(false)
  // Renumber residues form fields
  let rnChain = $state('')
  let rnStart = $state(1)
  let rnEnd = $state(9999)
  let rnNewStart = $state(1)
  let rnApplyToSel = $state(false)
  // Custom selection dialog
  /** @type {HTMLDialogElement | null} */
  let dlgCustomSel = $state(null)
  let customSelInput = $state('')
  let customSelError = $state('')
  let customSelBusy = $state(false)
  // Delete atoms form field
  let daSelection = $state('water')
  // Transform form fields
  let tfRotAngle = $state(0)
  let tfRotAxis = $state('z')
  let tfTx = $state(0)
  let tfTy = $state(0)
  let tfTz = $state(0)
  // Transform enhanced state
  let memproDialogOpen = $state(false)
  let packmolDialogOpen = $state(false)
  let toolsMenuOpen = $state(false)
  let transformTab = $state('rotate') // 'rotate' | 'translate' | 'align'
  /** @type {number[][] | null} positions[atom.index] = [x,y,z] — gizmo/dialog drag preview */
  let previewPositions = $state(null)
  /** @type {number[][] | null} animation playback overlay (does not mutate working atoms) */
  let animCoordOverlay = $state(null)
  /** Base pose XYZ at structure load (for animation diffs + undo). */
  /** @type {Map<number, [number, number, number]>} */
  let baseAtomCoords = $state(new Map())
  /**
   * Per-structure animation coord overlays keyed by structureId. Views owned by a
   * non-active structure resolve their overlay here so multi-structure animation
   * still applies the right coordinates. The active structure mirrors this via
   * `animCoordOverlay`.
   * @type {Map<string, number[][]>}
   */
  let animCoordOverlayByStructure = $state(new Map())
  /**
   * Per-structure base pose snapshots keyed by structureId (source of truth for
   * coordinate diffs / undo when switching the active structure).
   * @type {Map<string, Map<number, [number, number, number]>>}
   */
  let baseAtomCoordsByStructure = new Map()
  let coordsDirty = $state(false)
  /** Bump to force representation geometry rebuild after in-memory XYZ commits. */
  let coordsGeneration = $state(0)
  const coordUndoStack = createCoordUndoStack(32)
  let tfPreviewBusy = $state(false)
  // Shared selection (rotate / translate tabs)
  let tfSel = $state('')
  let tfSelCount = $state(null)
  let tfRotCenter = $state('selection') // 'selection' | 'origin'
  // Align tab
  let tfAlignPrimSel = $state('')
  let tfAlignPrimCount = $state(null)
  let tfAlignTargetAxis = $state('z')
  let tfAlignSecSel = $state('')
  let tfAlignSecCount = $state(null)
  let tfAlignSecAxis = $state('x')
  let tfAlignApplyTo = $state('') // MDAnalysis sel or '' = all
  // MemPro
  let memproJobId = $state(null)
  let memproJobStatus = $state(null) // 'running' | 'done' | 'error' | null
  /** @type {object[]} */
  let memproResults = $state([])
  let memproError = $state(null)
  let memproBusy = $state(false)
  let memproNIters = $state(150)
  let memproGridSize = $state(36)
  let memproDualMembrane = $state(false)
  let memproPeripheral = $state(false)
  let memproUseWeights = $state(false)
  let memproFlip = $state(false)
  let memproMembrane = $state('')
  // Packmol hydration
  let packmolTab = $state('hydrate')
  /** @type {{ available: boolean, version?: string|null, resolved_path?: string|null }|null} */
  let packmolAvailable = $state(null)
  let packmolBusy = $state(false)
  let packmolBoxMin = $state({ x: 0, y: 0, z: 0 })
  let packmolBoxMax = $state({ x: 10, y: 10, z: 10 })
  let packmolBoxPadding = $state(2)
  let packmolShowBox = $state(true)
  let packmolShowGhost = $state(false)
  /** @type {object|null} */
  let packmolVolume = $state(null)
  let packmolHydrogenStatus = $state('')
  let packmolExclusionMode = $state('')
  let packmolTolerance = $state(2)
  let packmolNloop = $state(20)
  let packmolSoluteRadius = $state(2.5)
  let packmolNWaters = $state(0)
  let packmolOutputFolder = $state('')
  let packmolLog = $state('')
  let packmolResultPath = $state('')
  let packmolCustomInp = $state('')
  let packmolPreviewBusy = $state(false)
  let packmolError = $state('')
  /** Box bounds used for the last successful volume calculation. */
  /** @type {{ min: number[], max: number[] } | null} */
  let packmolVolumeBox = $state(null)
  /** @type {Array<object>} */
  let packmolJobs = $state([])
  const packmolBoxValid = $derived.by(
    () =>
      packmolBoxMax.x > packmolBoxMin.x &&
      packmolBoxMax.y > packmolBoxMin.y &&
      packmolBoxMax.z > packmolBoxMin.z
  )
  const packmolBoxMinArr = $derived([packmolBoxMin.x, packmolBoxMin.y, packmolBoxMin.z])
  const packmolBoxMaxArr = $derived([packmolBoxMax.x, packmolBoxMax.y, packmolBoxMax.z])
  const packmolBoxMatchesVolume = $derived.by(() => {
    if (!packmolVolumeBox) return false
    const [x0, y0, z0] = packmolBoxMinArr
    const [x1, y1, z1] = packmolBoxMaxArr
    const [a0, b0, c0] = packmolVolumeBox.min
    const [a1, b1, c1] = packmolVolumeBox.max
    return x0 === a0 && y0 === b0 && z0 === c0 && x1 === a1 && y1 === b1 && z1 === c1
  })

  $effect(() => {
    if (packmolVolumeBox && !packmolBoxMatchesVolume && packmolVolume) {
      packmolVolume = null
    }
  })
  const isPdbIdValid = $derived.by(() => pdbId.trim().length === 4)

  // Debounced atom-count lookups for transform selections
  let _tfSelTimer = null
  $effect(() => {
    const s = tfSel
    clearTimeout(_tfSelTimer)
    if (!filePath || !s.trim()) {
      tfSelCount = null
      return
    }
    _tfSelTimer = setTimeout(async () => {
      try {
        const r = await transformCountSelection({ path: filePath, selection: s.trim() })
        tfSelCount = r.count
      } catch {
        tfSelCount = null
      }
    }, 500)
    return () => clearTimeout(_tfSelTimer)
  })

  let _tfAlignPrimTimer = null
  $effect(() => {
    const s = tfAlignPrimSel
    clearTimeout(_tfAlignPrimTimer)
    if (!filePath || !s.trim()) {
      tfAlignPrimCount = null
      return
    }
    _tfAlignPrimTimer = setTimeout(async () => {
      try {
        const r = await transformCountSelection({ path: filePath, selection: s.trim() })
        tfAlignPrimCount = r.count
      } catch {
        tfAlignPrimCount = null
      }
    }, 500)
    return () => clearTimeout(_tfAlignPrimTimer)
  })

  let _tfAlignSecTimer = null
  $effect(() => {
    const s = tfAlignSecSel
    clearTimeout(_tfAlignSecTimer)
    if (!filePath || !s.trim()) {
      tfAlignSecCount = null
      return
    }
    _tfAlignSecTimer = setTimeout(async () => {
      try {
        const r = await transformCountSelection({ path: filePath, selection: s.trim() })
        tfAlignSecCount = r.count
      } catch {
        tfAlignSecCount = null
      }
    }, 500)
    return () => clearTimeout(_tfAlignSecTimer)
  })

  // ── MemPro: recover persisted job when workingDir is set ──────────────────
  $effect(() => {
    const wd = workingDir
    if (!wd) return
    memproScan(wd)
      .then((r) => {
        if (!r.found) return
        memproJobId = r.job_id
        memproJobStatus = r.status
        if (r.status === 'done') memproResults = r.results ?? []
        if (r.status === 'error') memproError = r.error
        visualizeStatus.memproJobId = r.job_id
        visualizeStatus.memproStatus = r.status
        visualizeStatus.memproStartedAt = r.start_time ?? null
        if (r.status === 'done')
          logEvent(
            'info',
            'view',
            'MemPro done (recovered)',
            `${(r.results ?? []).length} orientation(s)`
          )
        else if (r.status === 'running')
          logEvent('info', 'view', 'MemPro running (recovered)', r.job_id)
        else if (r.status === 'error')
          logEvent('info', 'view', 'MemPro error (recovered)', r.error ?? '')
      })
      .catch(() => {})
  })

  // ── MemPro: open panel when status bar chip triggers it ───────────────────
  $effect(() => {
    if (visualizeStatus.openMemproDialog) {
      visualizeStatus.openMemproDialog = false
      openMemproDialog()
    }
  })

  // ── Packmol: open panel from status bar ─────────────────────────────────
  $effect(() => {
    if (visualizeStatus.openPackmolDialog) {
      visualizeStatus.openPackmolDialog = false
      openPackmolDialog()
    }
  })

  // Reset tool panels when leaving Visualize (avoids stale open state on HMR / tab switch).
  $effect(() => {
    return () => {
      memproDialogOpen = false
      visualizeStatus.openMemproDialog = false
      packmolDialogOpen = false
      visualizeStatus.openPackmolDialog = false
      trajAlignOpen = false
      mutateOpen = false
      splitOpen = false
      superOpen = false
      mutPreviewAtoms = []
      mutPreviewBonds = []
    }
  })

  // Close tool panels on Escape while open.
  $effect(() => {
    if (!memproDialogOpen && !packmolDialogOpen && !trajAlignOpen && !mutateOpen && !splitOpen && !superOpen) return
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (packmolDialogOpen) closePackmolDialog()
      else if (memproDialogOpen) closeMemproDialog()
      else if (trajAlignOpen) trajAlignOpen = false
      else if (mutateOpen) closeMutateDialog()
      else if (splitOpen) splitOpen = false
      else if (superOpen) superOpen = false
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  $effect(() => {
    if (!trajStructure?.trajectory) return
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      if (isTrajHotkeyBlocked(e.target)) return
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        toggleTrajPlayback()
        return
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        stepTrajFrame(1)
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        stepTrajFrame(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ── MemPro job polling ───────────────────────────────────────────────────
  $effect(() => {
    if (!memproJobId || memproJobStatus !== 'running') return
    const interval = setInterval(async () => {
      try {
        let r
        if (workingDir) {
          r = await memproScan(workingDir)
          if (!r.found) return
        } else {
          r = await memproStatus(memproJobId)
        }
        if (r.status !== memproJobStatus) {
          memproJobStatus = r.status
          visualizeStatus.memproStatus = r.status
          if (r.status === 'done') {
            memproResults = r.results ?? []
            logEvent(
              'info',
              'view',
              'MemPro orientation complete',
              `${memproResults.length} result(s)`
            )
            clearInterval(interval)
          } else if (r.status === 'error') {
            memproError = r.error
            logEvent('info', 'view', 'MemPro failed', r.error ?? '')
            clearInterval(interval)
          }
        }
      } catch {
        /* ignore */
      }
    }, 5000)
    return () => clearInterval(interval)
  })

  /**
   * Build default representation views for one structure via detectMolecules.
   * Returned views carry the owning structureId + componentKey.
   * @param {import('../lib/visualizeStructures.js').StructureEntry} entry
   * @returns {Promise<View[]>}
   */
  async function buildAutoViewsForStructure(entry) {
    if (!entry?.path) return []
    const data = await detectMolecules(entry.path, { topology: entry.topologyPath ?? null })
    /** @type {View[]} */
    const next = []
    const globalBonds = entry.bonds ?? []
    for (const [i, struc] of data.entries()) {
      const representation = isBiopolymerSelection(struc.selection)
        ? { type: 'cartoon' }
        : { type: 'vdw' }
      const atomIdx = new Set((struc.atoms || []).map((a) => a.index))
      const molBonds =
        struc.bonds && struc.bonds.length
          ? struc.bonds
          : globalBonds.filter(([ai, bi]) => atomIdx.has(ai) && atomIdx.has(bi))
      let colorScheme
      if (isBiopolymerSelection(struc.selection) && struc.residues?.length) {
        colorScheme = { name: 'ss', resolver: ssScheme(struc.residues, {}) }
      } else if (struc.selection.startsWith('resname')) {
        const color = `#${COLOR_PALETTE[i % COLOR_PALETTE.length].getHexString()}`
        colorScheme = {
          name: 'cpk-carbon',
          color,
          resolver: cpkScheme({ carbonColor: color })
        }
      } else {
        colorScheme = { name: 'cpk', resolver: cpkScheme() }
      }
      next.push({
        id: crypto.randomUUID(),
        structureId: entry.id,
        componentKey: componentKeyFromSelection(struc.selection),
        selection: struc.selection,
        baseSelection: struc.selection,
        representation,
        path: entry.path,
        atoms: struc.atoms,
        bonds: molBonds,
        residues: struc.residues ?? null,
        visible: struc.selection !== 'water',
        colorScheme,
        helixWidth: 1.0,
        sheetWidth: 0.875,
        coilWidth: 0.125,
        ssColors: null,
        tubeRadius: 0.9,
        atomScale: 1.0,
        bondScale: 1.0,
        pointSize: 3,
        quality: 3,
        showMultipleBonds: true,
        stickRoundness: 1.0,
        bondColorMode: 'uniform',
        bondColor: '#b8b8bc',
        opacity: 1,
        surfaceInflate: 0.25,
        surfaceSource: 'atoms',
        surfaceSubdivision: 0,
        trajSmooth: 0,
        trajSmoothRestoreH: true,
        material: { ...DEFAULT_VIEW_MATERIAL },
        _prefetched: true
      })
    }
    return next
  }

  /** Auto-generate representations for the ACTIVE structure (replaces its views). */
  async function onAutoGenerateViews() {
    const entry = structure
    if (!entry || autoGeneratingViews) return
    autoGeneratingViews = true
    try {
      const generated = await buildAutoViewsForStructure(entry)
      // Replace only this structure's views; keep other structures untouched.
      const others = views.filter((v) => v.structureId !== entry.id)
      views = [...others, ...generated]
      reframeCameraOnAtoms(collectVisibleViewAtoms(views))
      logEvent(
        'detail',
        'view',
        'Auto-generated views',
        `${generated.length} view(s) from detected molecules`
      )
    } catch (err) {
      console.error(err)
      logEvent('error', 'view', 'Auto-generate failed', String(err?.message ?? err))
    } finally {
      autoGeneratingViews = false
    }
  }

  async function onFetchPDB() {
    const id = pdbId.trim().toUpperCase()
    if (id.length !== 4) return
    const before = structures.length
    await appendStructure(id, { topology: null })
    if (structures.length > before) {
      pdbId = ''
    }
  }

  /**
   * Open one-or-more structure files (multi-select). Maestro / multi-MODEL files
   * prompt the entry picker; every selection is APPENDED to the workspace.
   */
  async function onOpenPdb() {
    const dlg = await window.api.openPdbDialog(workingDir || undefined)
    if (dlg.canceled) return
    const paths =
      Array.isArray(dlg.filePaths) && dlg.filePaths.length
        ? dlg.filePaths
        : dlg.filePath
          ? [dlg.filePath]
          : []
    if (!paths.length) return
    await openFiles(paths)
  }

  /** Explicit topology + coordinate pair when auto-detect is wrong or paths differ. */
  async function onOpenWithTopology() {
    const topDlg = await window.api.openTopologyDialog(workingDir || undefined)
    if (topDlg.canceled || !topDlg.filePath) return
    const pdbDlg = await window.api.openPdbDialog(workingDir || undefined)
    if (pdbDlg.canceled || !pdbDlg.filePath) return
    await appendStructure(pdbDlg.filePath, { topology: topDlg.filePath })
  }

  function trajFileLabel(entry) {
    const files = entry?.trajectory?.files ?? []
    if (!files.length) return ''
    return files
      .map((f) => {
        const name = String(f.path).split(/[/\\]/).pop() || f.path
        return f.stride > 1 ? `${name} ×${f.stride}` : name
      })
      .join(' + ')
  }

  function maxTrajSmoothInUse() {
    const sid = trajStructure?.id
    let max = 0
    for (const v of views) {
      if (sid && v.structureId && v.structureId !== sid) continue
      max = Math.max(max, clampTrajSmooth(v.trajSmooth))
    }
    return max
  }

  /**
   * @param {import('../lib/visualizeStructures.js').StructureEntry | null | undefined} entry
   * @param {{ mode: 'align' | 'rmsd', apply: boolean, selection: string, referenceFrame: number } | null} spec
   */
  function persistTrajAlignment(entry, spec) {
    if (!entry?.trajectory) return
    entry.trajectory.alignment = spec ?? null
  }

  /**
   * Re-apply Align / RMSD saved on the trajectory after the sidecar is ready.
   * @param {import('../lib/visualizeStructures.js').StructureEntry | null | undefined} entry
   */
  async function restoreTrajAlignment(entry) {
    const spec = entry?.trajectory?.alignment
    if (!spec || (spec.mode !== 'align' && spec.mode !== 'rmsd')) return
    if (
      trajAlign.mode === spec.mode &&
      trajAlign.selection === spec.selection &&
      trajAlign.referenceFrame === spec.referenceFrame &&
      (spec.mode !== 'align' || (trajAlign.apply && trajAlignAffines))
    ) {
      return
    }
    const token = ++trajAlignRestoreToken
    trajAlign = {
      ...trajAlign,
      selection: spec.selection,
      referenceFrame: spec.referenceFrame
    }
    await computeTrajRmsdOrAlign(spec.mode)
    if (token !== trajAlignRestoreToken) return
  }

  function disposeTrajCache() {
    trajAlignRestoreToken += 1
    stopTrajPlayback()
    trajCache?.dispose()
    trajCache = null
    setTrajPlayClock({ playing: false, cache: null, playhead: 0, nAtoms: 0, box: null })
    resetTrajBlendCaches()
    viewDrawCache.clear()
    trajAlignScratch.clear()
    trajAlignAffines = null
    trajAlign = {
      ...trajAlign,
      apply: false,
      mode: 'none',
      rmsd: null,
      nMobile: null,
      referenceFrame: 0
    }
    trajAlignError = ''
    trajAlignAtomCount = null
    trajCacheInfo = null
    trajSidecarReady = false
    trajAdoptPending = false
    trajRamLoadLabel = ''
    trajCacheError = ''
    if (trajCachePoll) {
      clearInterval(trajCachePoll)
      trajCachePoll = 0
    }
    trajPlayhead = 0
    trajDisplayFrame = 0
    trajXyzEpoch += 1
  }

  function bindTrajCache(entry) {
    const traj = entry?.trajectory
    if (!traj?.files?.length) {
      disposeTrajCache()
      return
    }
    const strides = fileStridesFromFiles(traj.files)
    const topology = entry.topologyPath || traj.files[0].path
    const paths = traj.files.map((f) => f.path)
    const nAtoms = entry.atoms?.length ?? 0
    trajCache?.dispose()
    /**
     * @param {number} start
     * @param {number} count
     */
    async function fetchXyzRange(start, count) {
      try {
        const info = trajCacheInfo
        if (info && (info.complete || start < info.frames_ready) && nAtoms > 0) {
          try {
            const frameBytes = nAtoms * 12
            const header = info.header_bytes || 16
            const ready = info.complete ? info.frames_total : info.frames_ready
            const countFit = Math.max(0, Math.min(count, ready - start))
            if (countFit > 0) {
              const raw = await concatSidecarSlices(
                readSidecarSlice,
                info.path || info.host_path,
                header + start * frameBytes,
                countFit * frameBytes
              )
              const frames = splitPackedFrames(raw, nAtoms, countFit)
              if (frames.length) {
                trajCacheError = ''
                return frames
              }
            }
          } catch {
            /* HTTP fallback */
          }
        }
        try {
          const buf = await getTrajectoryXyzBuffer({
            topology_path: topology,
            trajectory_paths: paths,
            file_strides: strides,
            frame: start,
            count
          })
          const frames = xyzBinaryToFrames(buf)
          if (frames.length) {
            trajCacheError = ''
            return frames
          }
        } catch {
          /* JSON packed fallback */
        }
        const payload = await getTrajectoryFrame({
          topology_path: topology,
          trajectory_paths: paths,
          file_strides: strides,
          frame: start,
          count
        })
        trajCacheError = ''
        return xyzPackedToFrames(payload)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err || 'Trajectory cache read failed')
        trajCacheError = msg
        if (trajPlaying) stopTrajPlayback()
        throw err instanceof Error ? err : new Error(msg)
      }
    }
    trajCache = createTrajectoryFrameCache({
      nAtoms,
      logicalFrameCount: traj.logicalFrameCount,
      box: parseBoxLengths(traj.box),
      maxBytes: appSettings.trajStreamCacheMib * 1024 * 1024,
      fetchFrame: async (frame) => {
        const frames = await fetchXyzRange(frame, 1)
        return frames[0] ?? new Float32Array(0)
      },
      fetchFrames: fetchXyzRange
    })
    trajCache.setHydrogenParents(buildHydrogenParentMap(entry.atoms, entry.bonds))
    trajPlayhead = traj.logicalFrame ?? 0
    trajDisplayFrame = Math.round(trajPlayhead)
    void startTrajSidecar(entry)
  }

  /**
   * @param {import('../lib/visualizeStructures.js').StructureEntry} entry
   */
  function trajCachePayload(entry) {
    const traj = entry.trajectory
    return {
      topology_path: entry.topologyPath || traj?.files[0]?.path,
      trajectory_paths: (traj?.files || []).map((f) => f.path),
      file_strides: fileStridesFromFiles(traj?.files),
      cache_dir: workingDir || null
    }
  }

  /**
   * @param {string} filePath
   * @param {number} offset
   * @param {number} length
   */
  async function readSidecarSlice(filePath, offset, length) {
    const api = /** @type {{ readBinarySlice?: Function } | undefined} */ (window.api)
    if (!api?.readBinarySlice) throw new Error('no slice reader')
    const info = trajCacheInfo
    const candidates = [filePath, info?.path, info?.host_path].filter(
      (p, i, all) => typeof p === 'string' && p && all.indexOf(p) === i
    )
    let lastErr = /** @type {unknown} */ (null)
    for (const p of candidates) {
      try {
        return await api.readBinarySlice(p, offset, length)
      } catch (err) {
        lastErr = err
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Could not read trajectory cache')
  }

  /**
   * @param {import('../lib/visualizeStructures.js').StructureEntry} entry
   * @param {NonNullable<typeof trajCacheInfo>} info
   */
  function warmTrajPlayPath() {
    if (!trajCache || !trajStructure) return
    setTrajPlayClock({
      playing: false,
      playhead: trajPlayhead,
      cache: trajCache,
      box: parseBoxLengths(trajStructure.trajectory?.box),
      nAtoms: trajStructure.atoms?.length ?? 0
    })
    blendPlayXyz(0)
    requestTrajPlayFrame()
  }

  async function adoptTrajSidecar(entry, info) {
    if (!trajCache) return
    trajAdoptPending = true
    trajRamLoadLabel = ''
    try {
      const nAtoms = info.atom_count
      const nFrames = info.frames_total
      const ramCap = trajLoadAllBytesCap(
        typeof navigator !== 'undefined' ? navigator.deviceMemory : undefined,
        appSettings.trajLoadAllGib
      )
      if (info.load_all && info.complete && loadAllFits(nAtoms, nFrames, ramCap)) {
        try {
          let buf = null
          try {
            buf = await concatSidecarSlices(
              readSidecarSlice,
              info.path || info.host_path,
              0,
              info.header_bytes + info.bytes,
              undefined,
              {
                onProgress: (chunk, total) => {
                  trajRamLoadLabel = `${chunk}/${total}`
                }
              }
            )
          } catch {
            buf = await getTrajectoryCacheData(trajCachePayload(entry))
          }
          if (buf && buf.byteLength) {
            const all = gwxyzToAllFrames(buf, nAtoms, nFrames)
            if (all.length >= nAtoms * 3) {
              trajCache.setPreload(all)
              syncTrajAlignXform()
              trajSidecarReady = true
              trajXyzEpoch += 1
              warmTrajPlayPath()
              void restoreTrajAlignment(entry)
              return
            }
          }
        } catch {
          /* stream instead */
        }
      }
      trajSidecarReady = info.frames_ready > 0
      trajXyzEpoch += 1
      if (info.complete) {
        warmTrajPlayPath()
        void restoreTrajAlignment(entry)
      }
    } finally {
      trajAdoptPending = false
      trajRamLoadLabel = ''
    }
  }

  /**
   * @param {import('../lib/visualizeStructures.js').StructureEntry} entry
   */
  async function startTrajSidecar(entry) {
    if (trajCachePoll) {
      clearInterval(trajCachePoll)
      trajCachePoll = 0
    }
    trajSidecarReady = false
    trajAdoptPending = false
    trajRamLoadLabel = ''
    trajCacheError = ''
    try {
      const info = await getTrajectoryCache(trajCachePayload(entry))
      trajCacheInfo = info
      if (info.error) {
        trajCacheError = info.error
        return
      }
      if (info.complete) {
        trajAdoptPending = true
        await adoptTrajSidecar(entry, info)
        return
      }
      trajCachePoll = setInterval(async () => {
        try {
          const next = await getTrajectoryCache(trajCachePayload(entry))
          trajCacheInfo = next
          if (next.error) {
            trajCacheError = next.error
            clearInterval(trajCachePoll)
            trajCachePoll = 0
            if (trajPlaying) stopTrajPlayback()
            return
          }
          if (next.complete) {
            trajAdoptPending = true
            clearInterval(trajCachePoll)
            trajCachePoll = 0
            await adoptTrajSidecar(entry, next)
          } else if (next.frames_ready > 0) {
            trajSidecarReady = true
          }
        } catch {
          /* keep polling */
        }
      }, 400)
    } catch {
      trajCacheInfo = null
    }
  }

  /**
   * @param {number} playhead
   * @param {{ playing?: boolean, persist?: boolean, holdCache?: boolean }} [opts]
   */
  async function seekTrajFrame(playhead, opts = {}) {
    const entry = trajStructure
    if (!entry?.trajectory || !trajCache) return
    const n = entry.trajectory.logicalFrameCount
    if (n <= 0) return
    const f = Math.max(0, Math.min(n - 1, Number(playhead) || 0))
    const logical = Math.max(0, Math.min(n - 1, Math.round(f)))
    if (!shouldSeekTrajFrame(logical, trajDisplayFrame)) {
      trajPlayhead = f
      if (opts.persist !== false && entry.trajectory) {
        entry.trajectory.logicalFrame = logical
      }
      return
    }
    const jumped = !opts.holdCache && Math.abs(f - trajPlayhead) > 8
    if (jumped) {
      trajCache.invalidate()
      resetTrajBlendCaches()
    }
    trajPlayhead = f
    if (opts.persist !== false && entry.trajectory) {
      entry.trajectory.logicalFrame = logical
    }
    const radius = opts.playing
      ? Math.max(TRAJ_PREFETCH_PLAY, 1 + maxTrajSmoothInUse())
      : Math.max(3, 1 + maxTrajSmoothInUse())
    if (!trajCache.has(logical)) {
      await trajCache.get(logical)
    }
    void trajCache.prefetch(f, radius, { sequential: opts.playing === true })
    trajDisplayFrame = logical
    setTrajPlayClock({
      playing: trajPlaying,
      playhead: f,
      cache: trajCache,
      box: parseBoxLengths(entry.trajectory?.box),
      nAtoms: entry.atoms?.length ?? 0
    })
    syncTrajSliderDom(logical)
    trajXyzEpoch += 1
  }

  function rebaseTrajClock(frame) {
    trajPlayOriginFrame = Math.max(0, Math.round(Number(frame) || 0))
    trajPlayOriginMs = performance.now()
  }

  /**
   * @param {number} f
   * @param {{ persist?: boolean }} [opts]
   */
  function applyTrajPlayhead(f, opts = {}) {
    const entry = trajStructure
    if (!entry?.trajectory) return
    const n = entry.trajectory.logicalFrameCount
    const frame = Math.max(0, Math.min(n - 1, Number(f) || 0))
    trajDisplayFrame = Math.round(frame)
    if (opts.persist !== false) {
      entry.trajectory.logicalFrame = trajDisplayFrame
    }
    setTrajPlayClock({
      playing: trajPlaying,
      playhead: frame,
      cache: trajCache,
      box: parseBoxLengths(entry.trajectory?.box),
      nAtoms: entry.atoms?.length ?? 0
    })
    if (trajPlaying) {
      syncTrajSliderDom(trajDisplayFrame)
      requestTrajPlayFrame()
      return
    }
    trajPlayhead = frame
    syncTrajSliderDom(trajDisplayFrame)
  }

  $effect(() => {
    void trajPlayhead
    void trajStructure?.trajectory?.logicalFrameCount
    if (!trajPlaying) syncTrajSliderDom(Math.round(trajPlayhead))
  })

  $effect(() => {
    const cache = trajCache
    const entry = trajStructure
    if (!cache || !entry) return
    void entry.atoms
    void entry.bonds
    cache.setHydrogenParents(buildHydrogenParentMap(entry.atoms, entry.bonds))
  })

  /** @param {number} now */
  function runTrajPlayTick(now) {
    if (!trajPlaying) return
    const entry = trajStructure
    if (!entry?.trajectory || !trajCache) {
      stopTrajPlayback()
      return
    }
    const n = entry.trajectory.logicalFrameCount
    const target = playTargetFrame(now - trajPlayOriginMs, trajPlayOriginFrame, TRAJ_PLAY_FPS, n)
    if (target >= n - 1 && trajCache.has(n - 1)) {
      applyTrajPlayhead(n - 1)
      stopTrajPlayback()
      return
    }
    const pick = pickDisplayFrame(target, n, (frame) => trajCache.has(frame), trajDisplayFrame)
    if (pick.missing) {
      void trajCache.get(pick.frame)
    } else if (!pick.hold || pick.frame !== Math.round(trajPlayhead)) {
      applyTrajPlayhead(pick.frame, { persist: false })
    }
    if (target - pick.frame > TRAJ_PLAY_MAX_LAG && trajCache.has(Math.round(target))) {
      const snap = Math.round(target)
      rebaseTrajClock(snap)
      applyTrajPlayhead(snap, { persist: false })
    }
    void trajCache.prefetch(Math.round(target), TRAJ_PREFETCH_PLAY, { sequential: true })
    trajPlayRaf = requestAnimationFrame(runTrajPlayTick)
  }

  function stopTrajPlayback() {
    trajPlaying = false
    setTrajPlayClock({ playing: false, playhead: trajDisplayFrame })
    trajPlayhead = trajDisplayFrame
    trajXyzEpoch += 1
    syncTrajSliderDom(trajDisplayFrame)
    if (trajPlayRaf) {
      cancelAnimationFrame(trajPlayRaf)
      trajPlayRaf = 0
    }
    if (trajPlayTimer) {
      clearInterval(trajPlayTimer)
      trajPlayTimer = 0
    }
  }

  function toggleTrajPlayback() {
    if (!trajStructure?.trajectory) return
    if (trajPlaying) {
      stopTrajPlayback()
      return
    }
    if (!trajCanPlay) {
      const info = trajCacheInfo
      alert(
        info?.error
          ? `The trajectory cache failed: ${info.error}`
          : trajAdoptPending
            ? `Loading frames into RAM${trajRamLoadLabel ? ` (${trajRamLoadLabel})` : ''}… Play starts when that finishes.`
            : info && !info.complete
              ? `Indexing is still running (${info.frames_ready}/${info.frames_total} frames). Play starts when the cache is finished.`
              : 'The trajectory cache is not ready yet. Wait until indexing finishes, then press Play.'
      )
      return
    }
    const n = trajStructure.trajectory.logicalFrameCount
    if (n <= 1) return
    const hasSurface = views.some(
      (v) =>
        v.visible !== false &&
        (v.opacity ?? 1) > 0.001 &&
        v.representation?.type === 'surface'
    )
    if (hasSurface) {
      const ok = confirm(
        'A Surface representation will stay on the last built frame while playing. Remeshing it every frame is too slow. Hide Surface, or pause / export an image later to rebuild it at the current coordinates.\n\nPlay anyway?'
      )
      if (!ok) return
    }
    if (Math.round(trajPlayhead) >= n - 1) applyTrajPlayhead(0)
    trajPlaying = true
    setTrajPlayClock({
      playing: true,
      playhead: trajPlayhead,
      cache: trajCache,
      box: parseBoxLengths(trajStructure.trajectory?.box),
      nAtoms: trajStructure.atoms?.length ?? 0
    })
    rebaseTrajClock(trajPlayhead)
    void trajCache?.prefetch(Math.round(trajPlayhead), TRAJ_PREFETCH_PLAY, { sequential: true })
    trajPlayRaf = requestAnimationFrame(runTrajPlayTick)
  }

  /** @param {number} delta */
  function stepTrajFrame(delta) {
    const entry = trajStructure
    if (!entry?.trajectory) return
    const n = entry.trajectory.logicalFrameCount
    const next = Math.max(0, Math.min(n - 1, Math.round(trajPlayhead) + delta))
    if (trajPlaying) rebaseTrajClock(next)
    void seekTrajFrame(next)
  }

  function openTrajAlignPanel() {
    toolsMenuOpen = false
    memproDialogOpen = false
    packmolDialogOpen = false
    trajAlignOpen = true
    void refreshTrajAlignCount()
  }

  let trajAlignCountTimer = 0
  function scheduleTrajAlignCount() {
    if (trajAlignCountTimer) clearTimeout(trajAlignCountTimer)
    trajAlignCountTimer = setTimeout(() => {
      trajAlignCountTimer = 0
      void refreshTrajAlignCount()
    }, 350)
  }

  async function refreshTrajAlignCount() {
    const entry = trajStructure
    if (!entry?.trajectory || !trajAlign.selection.trim()) {
      trajAlignAtomCount = null
      return
    }
    try {
      const r = await countAnalysisSelection({
        topologyPath: entry.topologyPath || entry.path,
        trajectoryPaths: entry.trajectory.files.map((f) => f.path),
        selection: trajAlign.selection
      })
      trajAlignAtomCount = r.count
    } catch {
      trajAlignAtomCount = null
    }
  }

  /**
   * @param {'rmsd' | 'align'} mode
   */
  async function computeTrajRmsdOrAlign(mode) {
    const entry = trajStructure
    if (!entry?.trajectory) return
    trajAlignBusy = true
    trajAlignError = ''
    try {
      const strides = fileStridesFromFiles(entry.trajectory.files)
      const topology = entry.topologyPath || entry.trajectory.files[0].path
      const doAlign = mode === 'align'
      const blob = await computeTrajectoryAlign({
        topology_path: topology,
        trajectory_paths: entry.trajectory.files.map((f) => f.path),
        file_strides: strides,
        selection: trajAlign.selection,
        reference_frame: trajAlign.referenceFrame,
        cache_dir: workingDir || null,
        align: doAlign
      })
      const result = decodeAlignBinary(blob)
      trajAlignAffines = doAlign ? result.affines : null
      trajAlign = {
        ...trajAlign,
        rmsd: result.rmsd,
        nMobile: result.n_mobile,
        apply: doAlign,
        mode
      }
      trajAlignScratch.clear()
      resetTrajBlendCaches()
      persistTrajAlignment(entry, {
        mode,
        apply: doAlign,
        selection: trajAlign.selection,
        referenceFrame: trajAlign.referenceFrame
      })
      syncTrajAlignXform()
      trajXyzEpoch += 1
      logEvent(
        'info',
        'view',
        doAlign ? 'Trajectory aligned' : 'RMSD calculated',
        `${result.n_mobile} atoms · ${result.n_frames} frames`
      )
    } catch (ex) {
      trajAlignError = ex instanceof Error ? ex.message : String(ex)
    } finally {
      trajAlignBusy = false
    }
  }

  function clearTrajAlignment() {
    trajAlignAffines = null
    trajAlign = { ...trajAlign, apply: false, mode: 'none', rmsd: null, nMobile: null }
    trajAlignScratch.clear()
    resetTrajBlendCaches()
    persistTrajAlignment(trajStructure, null)
    syncTrajAlignXform()
    trajAlignError = ''
    trajXyzEpoch += 1
  }

  /**
   * Alignment is the live trajectory: each frame is transformed before blend/smooth.
   */
  function syncTrajAlignXform() {
    if (!trajCache) return
    if (!trajAlign.apply || !trajAlignAffines) {
      trajCache.setFrameXform(null)
      return
    }
    const affines = trajAlignAffines
    trajCache.setFrameXform((frame, xyz) => {
      const aff = readAffine12(affines, frame)
      return aff ? applyRigidXyz(xyz, aff) : xyz
    })
  }

  /**
   * @param {{ topologyPath: string, files: Array<{ path: string, stride: number }> }} payload
   */
  async function onOpenTrajectoryConfirm(payload) {
    trajDialogOpen = false
    await openTrajectory(payload.topologyPath, payload.files)
  }

  /**
   * @param {string} topologyPathIn
   * @param {Array<{ path: string, stride: number }>} files
   * @param {{ logicalFrame?: number, id?: string, label?: string, alignment?: object | null, box?: [number, number, number] | null }} [opts]
   */
  async function loadTrajectoryEntry(topologyPathIn, files, opts = {}) {
    const trajectory_paths = files.map((f) => f.path)
    const file_strides = fileStridesFromFiles(files)
    const info = await getTrajectoryInfo({
      topology_path: topologyPathIn,
      trajectory_paths,
      file_strides
    })
    if (!info.logical_frame_count) {
      throw new Error('Trajectory has no frames after stride')
    }

    let raw
    try {
      raw = await getStructure({
        path: structureFetchPath(trajectory_paths[0], topologyPathIn),
        topology: topologyPathIn,
        needs_bonds: true,
        needs_secondary_structure: true,
        save_dir: workingDir || null
      })
    } catch {
      raw = null
    }
    if (!raw?.atoms?.length) {
      raw = await getTrajectoryFrame({
        topology_path: topologyPathIn,
        trajectory_paths,
        file_strides,
        frame: 0,
        full: true,
        needs_bonds: true,
        needs_secondary_structure: true
      })
    }
    if (!raw?.atoms?.length) {
      throw new Error('Could not load atoms for this topology / trajectory pair')
    }

    const frame0 = await getTrajectoryFrame({
      topology_path: topologyPathIn,
      trajectory_paths,
      file_strides,
      frame: 0
    })
    applyXyzFloat32ToAtoms(raw.atoms, xyzColumnarToFloat32(frame0))

    const logicalFrame = Math.max(
      0,
      Math.min(info.logical_frame_count - 1, Math.round(opts.logicalFrame ?? 0))
    )
    const trajectory = normalizeTrajectoryMeta({
      files: info.files.map((f) => ({
        path: f.path,
        stride: f.stride
      })),
      logicalFrame,
      logicalFrameCount: info.logical_frame_count,
      rawFrameCounts: info.files.map((f) => f.n_frames),
      box: info.box ?? opts.box,
      alignment: opts.alignment
    })

    return createStructureEntry({
      id: opts.id,
      sourcePath: topologyPathIn,
      kind: 'file',
      label: opts.label || String(topologyPathIn).split(/[/\\]/).pop() || 'trajectory',
      path: raw.path || trajectory_paths[0],
      topologyPath: raw.topology_used || topologyPathIn,
      atoms: raw.atoms,
      bonds: raw.bonds || [],
      residues: raw.residues,
      bond_source: raw.bond_source,
      trajectory
    })
  }

  /**
   * @param {string} topologyPathIn
   * @param {Array<{ path: string, stride: number }>} files
   * @param {{ logicalFrame?: number, id?: string, label?: string, resetCamera?: boolean, addDefaultView?: boolean }} [opts]
   */
  async function openTrajectory(topologyPathIn, files, opts = {}) {
    const started = Date.now()
    const firstStructure = structures.length === 0
    try {
      loadingPDB = true
      loadingElapsedSec = 0
      loadingPhase = 'Reading trajectory…'
      loadBondStatus = ''
      if (loadingElapsedTimer) clearInterval(loadingElapsedTimer)
      loadingElapsedTimer = setInterval(() => {
        loadingElapsedSec = Math.floor((Date.now() - started) / 1000)
      }, 250)

      loadingPhase = 'Checking frames…'
      const entry = await loadTrajectoryEntry(topologyPathIn, files, opts)

      // v1: one playhead — replace a previous traj-backed structure.
      const withoutOldTraj = structures.filter((s) => !s.trajectory)
      const removed = structures.filter((s) => s.trajectory)
      if (removed.length) {
        const removedIds = new Set(removed.map((s) => s.id))
        views = views.filter((v) => !removedIds.has(v.structureId))
      }
      structures = [...withoutOldTraj, entry]
      syncStructureHiddenFromEntries([entry])
      activeStructureId = entry.id
      baseAtomCoords = new Map()
      coordsDirty = false
      coordsGeneration += 1
      coordUndoStack.clear()
      previewPositions = null
      animCoordOverlay = null
      bindTrajCache(entry)
      const logicalFrame = entry.trajectory?.logicalFrame ?? 0
      if (logicalFrame > 0) {
        await seekTrajFrame(logicalFrame)
      } else {
        trajXyzEpoch += 1
      }

      logEvent('info', 'view', `Opened trajectory ${entry.label}`, trajFileLabel(entry))
      if (opts.addDefaultView !== false && !views.some((v) => v.structureId === entry.id)) {
        addView('all', { type: 'points' }, { structureId: entry.id })
      }
      if ((opts.resetCamera ?? firstStructure) || !camera) {
        reframeCameraOnAtoms(collectVisibleViewAtoms(views))
      }
      requestSidePanelExpand('visualize')
      return entry
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
      return null
    } finally {
      if (loadingElapsedTimer) {
        clearInterval(loadingElapsedTimer)
        loadingElapsedTimer = 0
      }
      loadingPDB = false
      loadingPhase = ''
    }
  }

  // ── Multi-structure workspace helpers ─────────────────────────────────────

  /**
   * Patch the ACTIVE structure entry in place (edit tools mutate the active
   * structure; this keeps the derived `structure`/`filePath` in sync).
   * @param {Partial<import('../lib/visualizeStructures.js').StructureEntry> & Record<string, unknown>} patch
   */
  function patchActiveStructure(patch) {
    if (!activeStructureId) return
    structures = structures.map((s) => (s.id === activeStructureId ? { ...s, ...patch } : s))
  }

  /** Resolve the owning structure entry for a view (falls back to active). */
  function ownerStructure(view) {
    return findStructure(structures, view?.structureId) ?? structure
  }

  /**
   * Prompt the user to choose entries from a Maestro / multi-MODEL file.
   * @param {string} sourcePath
   * @param {Array<{ index: number, label: string, atomCount?: number, title?: string }>} entries
   * @returns {Promise<number[] | null>} selected indices or null on cancel
   */
  function showEntryPicker(sourcePath, entries) {
    return new Promise((resolve) => {
      entryPicker = { open: true, sourcePath, entries, resolve }
    })
  }

  function resolveEntryPicker(indices) {
    const resolve = entryPicker.resolve
    entryPicker = { open: false, sourcePath: '', entries: [], resolve: null }
    resolve?.(indices)
  }

  /**
   * Open a list of paths, appending every resulting structure. Multi-entry files
   * (Maestro CT / multi-MODEL) prompt the entry picker.
   * @param {string[]} paths
   */
  async function openFiles(paths) {
    for (const path of paths) {
      await openOnePath(path)
    }
  }

  /** @param {string} path */
  async function openOnePath(path) {
    // Inspect for multi-entry (Maestro CT or multi-MODEL PDB).
    /** @type {Awaited<ReturnType<typeof inspectStructure>> | null} */
    let info = null
    try {
      info = await inspectStructure(path)
    } catch {
      info = null
    }
    const entries = info?.entries ?? []
    const isMulti = entries.length > 1 || (isMaestroPath(path) && entries.length >= 1)
    if (info && isMulti) {
      const indices = await showEntryPicker(path, entries)
      if (!indices || !indices.length) return
      // Show the loading overlay immediately — Maestro import can take many
      // seconds before batchAppendImported starts (users otherwise re-open the file).
      const started = Date.now()
      loadingPDB = true
      loadingElapsedSec = 0
      loadingPhase = 'Importing structures…'
      loadBondStatus = ''
      if (loadingElapsedTimer) clearInterval(loadingElapsedTimer)
      loadingElapsedTimer = setInterval(() => {
        loadingElapsedSec = Math.floor((Date.now() - started) / 1000)
      }, 250)
      await tick()
      try {
        loadingPhase = 'Materializing entries…'
        const imported = await importStructureEntries(path, indices)
        const chosen = entries.filter((e) => indices.includes(e.index))
        await batchAppendImported(path, imported, chosen)
      } catch (ex) {
        if (loadingElapsedTimer) {
          clearInterval(loadingElapsedTimer)
          loadingElapsedTimer = 0
        }
        loadingPDB = false
        loadingPhase = ''
        alert(ex instanceof Error ? ex.message : String(ex))
      }
      return
    }
    // Single structure file.
    await appendStructure(path, { topology: null })
  }

  /**
   * Run async work over items with a fixed concurrency limit.
   * @template T, R
   * @param {T[]} items
   * @param {number} concurrency
   * @param {(item: T, index: number) => Promise<R>} fn
   * @returns {Promise<R[]>}
   */
  async function mapPool(items, concurrency, fn) {
    /** @type {R[]} */
    const results = new Array(items.length)
    let next = 0
    async function worker() {
      while (next < items.length) {
        const i = next++
        results[i] = await fn(items[i], i)
      }
    }
    const n = Math.max(1, Math.min(concurrency, items.length))
    await Promise.all(Array.from({ length: n }, () => worker()))
    return results
  }

  /**
   * Build a default "all" points view for an entry without mutating `views`.
   * @param {import('../lib/visualizeStructures.js').StructureEntry} entry
   */
  function makeDefaultPointsView(entry) {
    return {
      id: crypto.randomUUID(),
      structureId: entry.id,
      componentKey: componentKeyFromSelection('all'),
      selection: 'all',
      baseSelection: 'all',
      representation: { type: 'points' },
      path: entry.path,
      atoms: entry.atoms,
      bonds: entry.bonds,
      residues: entry.residues,
      visible: true,
      colorScheme: { name: 'cpk', resolver: cpkScheme() },
      helixWidth: 1.0,
      sheetWidth: 0.875,
      coilWidth: 0.125,
      ssColors: null,
      tubeRadius: 0.9,
      atomScale: 1.0,
      bondScale: 1.0,
      pointSize: 3,
      quality: 3,
      showMultipleBonds: true,
      stickRoundness: 1.0,
      bondColorMode: 'uniform',
      bondColor: '#b8b8bc',
      opacity: 1,
      surfaceInflate: 0.25,
      surfaceSource: 'atoms',
      surfaceSubdivision: 0,
      trajSmooth: 0,
      trajSmoothRestoreH: true,
      material: { ...DEFAULT_VIEW_MATERIAL }
    }
  }

  /**
   * Append many imported cache PDBs with bounded concurrency and one UI commit.
   * @param {string} sourcePath
   * @param {{ kind?: string, structures?: Array<Record<string, unknown>> }} imported
   * @param {Array<{ index: number, label: string }>} chosenEntries
   */
  async function batchAppendImported(sourcePath, imported, chosenEntries) {
    const list = imported.structures ?? []
    if (!list.length) {
      if (loadingElapsedTimer) {
        clearInterval(loadingElapsedTimer)
        loadingElapsedTimer = 0
      }
      loadingPDB = false
      loadingPhase = ''
      return
    }
    const started = Date.now() - loadingElapsedSec * 1000
    const workspaceWasEmpty = structures.length === 0
    const kind =
      imported.kind === 'maestro'
        ? /** @type {'maestro_ct'} */ ('maestro_ct')
        : /** @type {'pdb_model'} */ ('pdb_model')

    loadingPDB = true
    loadingPhase = `Loading structures… 0 / ${list.length}`
    loadBondStatus = ''
    if (loadingElapsedTimer) clearInterval(loadingElapsedTimer)
    loadingElapsedTimer = setInterval(() => {
      loadingElapsedSec = Math.floor((Date.now() - started) / 1000)
    }, 250)

    let done = 0
    try {
      const specs = list.map((st, i) => ({
        st,
        meta: chosenEntries[i] ?? { index: i, label: String(st.label || '') }
      }))

      // Concurrency 2: parallel /get-structure JSON peaks dominate heap on large CTs.
      const fetched = await mapPool(specs, 2, async ({ st, meta }) => {
        const path = String(st.path ?? st.pdbPath ?? '')
        const top =
          typeof st.topology === 'string'
            ? st.topology
            : st.topologyPath != null
              ? String(st.topologyPath)
              : null
        try {
          const raw = await getStructure({
            path,
            topology: top,
            needs_bonds: false,
            needs_secondary_structure: false,
            save_dir: workingDir || null
          })
          done += 1
          loadingPhase = `Loading structures… ${done} / ${specs.length}`
          return { ok: true, raw, st, meta, top }
        } catch (ex) {
          done += 1
          loadingPhase = `Loading structures… ${done} / ${specs.length}`
          return {
            ok: false,
            error: ex instanceof Error ? ex.message : String(ex),
            label: st.label || meta.label || path
          }
        }
      })

      loadingPhase = 'Building workspace…'
      /** @type {import('../lib/visualizeStructures.js').StructureEntry[]} */
      const newEntries = []
      /** @type {View[]} */
      const newViews = []
      const failures = []

      for (const item of fetched) {
        if (!item?.ok) {
          if (item?.label) failures.push(`${item.label}: ${item.error || 'failed'}`)
          continue
        }
        const { raw, st, meta, top } = item
        const resolvedTopology = raw.topology_used || top || null
        const entry = createStructureEntry({
          sourcePath,
          kind,
          ctIndex: kind === 'maestro_ct' ? meta.index : null,
          modelIndex: kind === 'pdb_model' ? meta.index : null,
          label: st.label || meta.label,
          path: raw.path,
          topologyPath: resolvedTopology,
          atoms: raw.atoms,
          bonds: raw.bonds || [],
          residues: raw.residues,
          bond_source: raw.bond_source
        })
        newEntries.push(entry)
        // Defer XYZ base snapshots until a transform / animation needs them.
        newViews.push(makeDefaultPointsView(entry))
        // Drop fetch wrapper refs so GC can reclaim mid-loop on huge batches.
        item.raw = null
      }

      if (!newEntries.length) {
        throw new Error(
          failures.length
            ? `No structures loaded:\n${failures.slice(0, 8).join('\n')}`
            : 'No structures loaded'
        )
      }

      structures = [...structures, ...newEntries]
      views = [...views, ...newViews]
      syncStructureHiddenFromEntries(newEntries)

      // Collapse all but the first workspace structure after a multi-entry import.
      const keepOpen = structures[0]?.id
      const nextCollapsed = new Set(collapsedStructureIds)
      for (const s of structures) {
        if (s.id !== keepOpen) nextCollapsed.add(s.id)
        else nextCollapsed.delete(s.id)
      }
      collapsedStructureIds = nextCollapsed

      activeStructureId = newEntries[0].id
      baseAtomCoords = new Map()
      coordsDirty = false
      coordsGeneration += 1
      coordUndoStack.clear()
      previewPositions = null
      animCoordOverlay = null

      logEvent(
        'info',
        'view',
        `Opened ${newEntries.length} structure(s)`,
        sourcePath
      )
      if (failures.length) {
        alert(`Some entries failed to load:\n${failures.slice(0, 12).join('\n')}`)
      }

      if (workspaceWasEmpty || !camera) {
        reframeCameraOnAtoms(collectVisibleViewAtoms(views))
      }
      requestSidePanelExpand('visualize')
    } finally {
      if (loadingElapsedTimer) {
        clearInterval(loadingElapsedTimer)
        loadingElapsedTimer = 0
      }
      loadingPDB = false
      loadingPhase = ''
    }
  }

  /**
   * Fetch a structure and APPEND it to the workspace (never clobbers existing
   * structures). Becomes the active structure. Adds a default points view.
   * @param {string} path
   * @param {{ topology?: string | null, sourcePath?: string, kind?: import('../lib/visualizeStructures.js').StructureEntry['kind'], ctIndex?: number | null, modelIndex?: number | null, label?: string | null, resetCamera?: boolean, needsSecondaryStructure?: boolean }} [opts]
   * @returns {Promise<import('../lib/visualizeStructures.js').StructureEntry | null>}
   */
  async function appendStructure(path, opts = {}) {
    const started = Date.now()
    const firstStructure = structures.length === 0
    try {
      loadingPDB = true
      loadingElapsedSec = 0
      loadingPhase = 'Reading file…'
      loadBondStatus = ''
      if (loadingElapsedTimer) clearInterval(loadingElapsedTimer)
      loadingElapsedTimer = setInterval(() => {
        loadingElapsedSec = Math.floor((Date.now() - started) / 1000)
      }, 250)

      const top = opts.topology ?? null
      loadingPhase = top
        ? 'Using topology for bonds…'
        : 'Looking for companion topology / bonds…'

      const raw = await getStructure({
        path,
        topology: top,
        needs_bonds: true,
        needs_secondary_structure: opts.needsSecondaryStructure === true,
        save_dir: workingDir || null
      })
      loadingPhase = 'Building atom list…'

      const resolvedTopology = raw.topology_used || top || null
      if (resolvedTopology) {
        const topName = String(resolvedTopology).split(/[/\\]/).pop()
        const src = raw.bond_source || 'topology'
        loadBondStatus =
          src === 'topology'
            ? `Using ${topName} for bonds`
            : `Bonds: ${src}` + (topName ? ` (${topName})` : '')
      } else {
        loadBondStatus =
          raw.bond_source && raw.bond_source !== 'none' ? `Bonds: ${raw.bond_source}` : ''
      }

      const entry = createStructureEntry({
        sourcePath: opts.sourcePath || raw.path,
        kind: opts.kind || 'file',
        ctIndex: opts.ctIndex ?? null,
        modelIndex: opts.modelIndex ?? null,
        label: opts.label || undefined,
        path: raw.path,
        topologyPath: resolvedTopology,
        atoms: raw.atoms,
        bonds: raw.bonds,
        residues: raw.residues,
        bond_source: raw.bond_source
      })

      structures = [...structures, entry]
      syncStructureHiddenFromEntries([entry])
      activeStructureId = entry.id
      baseAtomCoords = new Map()
      coordsDirty = false
      coordsGeneration += 1
      coordUndoStack.clear()
      previewPositions = null
      animCoordOverlay = null

      logEvent('info', 'view', `Opened ${entry.label}`, entry.path)

      // Default "all" points view for the freshly added structure.
      addView('all', { type: 'points' }, { structureId: entry.id })

      const resetCam = opts.resetCamera ?? firstStructure
      if (resetCam || !camera) {
        reframeCameraOnAtoms(collectVisibleViewAtoms(views))
      }
      requestSidePanelExpand('visualize')
      return entry
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
      return null
    } finally {
      if (loadingElapsedTimer) {
        clearInterval(loadingElapsedTimer)
        loadingElapsedTimer = 0
      }
      loadingPDB = false
      loadingPhase = ''
    }
  }

  /**
   * Switch the active (edit-target) structure, persisting the current structure's
   * coord working-state and restoring the target's.
   * @param {string} id
   */
  function setActiveStructure(id) {
    if (id === activeStructureId) return
    // Persist current active coord state.
    if (activeStructureId) {
      baseAtomCoordsByStructure.set(activeStructureId, baseAtomCoords)
      if (animCoordOverlay) animCoordOverlayByStructure.set(activeStructureId, animCoordOverlay)
      else animCoordOverlayByStructure.delete(activeStructureId)
    }
    activeStructureId = id
    if (editMode) {
      selectedGroupIndices = new Set()
      selectedAtom = null
      editHoverGroupIndices = new Set()
      editHoveredAtom = null
      editTooltip = null
    }
    // Restore target coord state (lazy — empty until a transform/animation needs it).
    baseAtomCoords = baseAtomCoordsByStructure.get(id) ?? new Map()
    animCoordOverlay = animCoordOverlayByStructure.get(id) ?? null
    previewPositions = null
    coordUndoStack.clear()
    coordsDirty = false
  }

  /**
   * Snapshot load-time XYZ for undo / dirty / animation patches. Deferred until
   * first needed so multi-structure open does not double atom storage.
   * @param {string | null | undefined} [structureId]
   * @returns {Map<number, [number, number, number]>}
   */
  function ensureBaseAtomCoords(structureId = activeStructureId) {
    if (!structureId) return baseAtomCoords
    let map = baseAtomCoordsByStructure.get(structureId)
    if (map && map.size) {
      if (structureId === activeStructureId) baseAtomCoords = map
      return map
    }
    const entry = findStructure(structures, structureId)
    map = entry?.atoms?.length ? snapshotAtomCoords(entry.atoms) : new Map()
    baseAtomCoordsByStructure.set(structureId, map)
    if (structureId === activeStructureId) baseAtomCoords = map
    return map
  }

  /** Remove a structure and all of its representations from the workspace. */
  function removeStructure(id) {
    const entry = findStructure(structures, id)
    if (!entry) return
    const removedViewIds = new Set(
      views.filter((v) => v.structureId === id).map((v) => v.id)
    )
    views = views.filter((v) => v.structureId !== id)
    for (const vid of removedViewIds) viewAtomsCache.delete(vid)
    structures = structures.filter((s) => s.id !== id)
    visibilityGroups = pruneVisibilityGroups(
      visibilityGroups,
      structures.map((s) => s.id),
      views.filter((v) => !v._isSelHighlight).map((v) => v.id),
      new Map(
        views
          .filter((v) => !v._isSelHighlight && v.structureId)
          .map((v) => /** @type {[string, string]} */ ([v.id, v.structureId]))
      )
    )
    baseAtomCoordsByStructure.delete(id)
    animCoordOverlayByStructure.delete(id)
    if (collapsedStructureIds.has(id)) {
      const next = new Set(collapsedStructureIds)
      next.delete(id)
      collapsedStructureIds = next
    }
    if (structureHiddenIds.has(id)) {
      const next = new Set(structureHiddenIds)
      next.delete(id)
      structureHiddenIds = next
    }
    if (activeStructureId === id) {
      const next = structures[0]?.id ?? null
      activeStructureId = next
      baseAtomCoords = next ? (baseAtomCoordsByStructure.get(next) ?? new Map()) : new Map()
      animCoordOverlay = next ? (animCoordOverlayByStructure.get(next) ?? null) : null
      previewPositions = null
      coordUndoStack.clear()
      coordsDirty = false
    }
    if (structures.length === 0) {
      camera = null
      measurements = []
      measurePicks = []
      atomLabels = []
      measureMode = null
      ctxMenu = null
      collapsedStructureIds = new Set()
      structureHiddenIds = new Set()
      visibilityGroups = []
      clearPanelSelection()
    }
    logEvent('detail', 'view', `Removed structure`, entry.label)
  }

  /**
   * Temp PDB of the coordinates currently shown for this structure.
   * @param {import('../lib/visualizeStructures.js').StructureEntry} entry
   */
  async function writeDisplayedPdb(entry) {
    const scratch = await structureScratchPdb({
      path: entry.path,
      topology: entry.topologyPath || null
    })
    /** @type {number[]} */
    const indices = []
    /** @type {number[]} */
    const xyz = []
    for (const atom of entry.atoms || []) {
      if (typeof atom.index !== 'number') continue
      indices.push(atom.index)
      xyz.push(Number(atom.x), Number(atom.y), Number(atom.z))
    }
    if (indices.length) {
      await structureWriteCoords({
        source: scratch.path,
        dest: scratch.path,
        indices,
        xyz,
        topology: null
      })
    }
    return scratch.path
  }

  /**
   * Copy a loaded structure into a new workspace entry with its own PDB.
   * Coordinates are the ones on screen (the displayed trajectory frame, or unsaved edits).
   * The copy is not a second player of the same movie, so it can be renamed, aligned, and saved alone.
   * @param {string} id
   */
  async function duplicateStructure(id) {
    const entry = findStructure(structures, id)
    if (!entry?.path || !entry.atoms?.length || duplicatingStructureId) return
    duplicatingStructureId = id
    try {
      const scratch = await writeDisplayedPdb(entry)
      const label = nextDuplicateLabel(
        structures.map((item) => item.label),
        entry.label
      )
      const added = await appendStructure(scratch.path, {
        label,
        sourcePath: scratch.path,
        kind: 'file',
        resetCamera: false,
        needsSecondaryStructure: true
      })
      if (added) logEvent('info', 'view', `Duplicated ${entry.label}`, added.label)
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      duplicatingStructureId = null
    }
  }

  /**
   * Concatenate the structures selected in the panel, in list order.
   * Originals stay loaded. A chain letter may be shared when the residues differ
   * (protein in one file, ions in another). A repeated protein, nucleic acid,
   * ion, or ligand on that chain is refused.
   */
  async function mergeSelectedStructures() {
    const chosen = structures.filter((entry) => selectedStructureIds.has(entry.id))
    if (chosen.length < 2) {
      alert('Select at least two structures (Ctrl+click), then Merge.')
      return
    }
    if (mergeBusy) return
    mergeBusy = true
    try {
      /** @type {string[]} */
      const paths = []
      for (const entry of chosen) {
        paths.push(await writeDisplayedPdb(entry))
      }
      const result = await structureMerge({ paths })
      const chainLabel = (result.chains || []).filter(Boolean).join('+')
      const base = chainLabel ? `merged ${chainLabel}` : 'merged'
      const taken = new Set(structures.map((entry) => entry.label))
      let label = base
      let n = 2
      while (taken.has(label)) {
        label = `${base} ${n}`
        n += 1
      }
      const added = await appendStructure(result.path, {
        label,
        sourcePath: result.path,
        kind: 'file',
        resetCamera: false,
        needsSecondaryStructure: true
      })
      if (added) {
        logEvent(
          'info',
          'view',
          `Merged ${chosen.map((entry) => entry.label).join(', ')}`,
          added.label
        )
      }
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      mergeBusy = false
    }
  }

  /** Rename a structure entry's display label. */
  function renameStructure(id, label) {
    const next = String(label ?? '').trim()
    if (!next) return
    structures = structures.map((s) => (s.id === id ? { ...s, label: next } : s))
  }

  /** Toggle structure eye: hide/show without touching `structures` (keeps meshes warm). */
  function toggleStructureVisible(id) {
    if (!id || !findStructure(structures, id)) return
    const next = new Set(structureHiddenIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    structureHiddenIds = next
    // Keep entry.visible in sync for viewpoint serialization (in-place; no array rewrite).
    const entry = findStructure(structures, id)
    if (entry) entry.visible = !next.has(id)
  }

  /** Fast lookup: structureId → drawn in canvas? */
  const structureVisibleById = $derived.by(() => {
    /** @type {Map<string, boolean>} */
    const m = new Map()
    for (const s of structures) m.set(s.id, !structureHiddenIds.has(s.id))
    return m
  })

  /** @param {{ structureId?: string | null }} view */
  function isOwnerStructureVisible(view) {
    if (!view?.structureId) return true
    return structureVisibleById.get(view.structureId) !== false
  }

  function isStructureHidden(id) {
    return structureHiddenIds.has(id)
  }

  /** Meta for viewpoint/animation save: honor the eye-toggle Set. */
  function structuresMetaForSave() {
    return serializeStructuresMeta(structures).map((s) => ({
      ...s,
      visible: !structureHiddenIds.has(s.id)
    }))
  }

  /** Seed eye-toggle Set from StructureEntry.visible (e.g. restored meta). */
  function syncStructureHiddenFromEntries(entries) {
    if (!entries?.length) return
    const next = new Set(structureHiddenIds)
    for (const e of entries) {
      if (e.visible === false) next.add(e.id)
      else next.delete(e.id)
    }
    structureHiddenIds = next
  }

  const panelViews = $derived(views.filter((v) => !v._isSelHighlight))
  const panelViewIds = $derived(panelViews.map((v) => v.id))
  const panelStructureIds = $derived(structures.map((s) => s.id))
  const viewToStructureId = $derived.by(() => {
    /** @type {Map<string, string>} */
    const m = new Map()
    for (const v of panelViews) {
      if (v.structureId) m.set(v.id, v.structureId)
    }
    return m
  })
  const visibilityGroupsPruned = $derived(
    pruneVisibilityGroups(visibilityGroups, panelStructureIds, panelViewIds, viewToStructureId)
  )
  const claimedRepIds = $derived(claimedViewIds(visibilityGroupsPruned))
  const claimedStructIds = $derived(claimedStructureIds(visibilityGroupsPruned))
  const outerStructureGroups = $derived(structureGroups(visibilityGroupsPruned))
  const ungroupedStructures = $derived(
    structures.filter((s) => !claimedStructIds.has(s.id))
  )
  const selectionCount = $derived(selectedStructureIds.size + selectedViewIds.size)
  const workspaceAnyVisible = $derived(
    structures.some((s) => !structureHiddenIds.has(s.id)) ||
      panelViews.some((v) => v.visible !== false)
  )
  const applyMenuSourceView = $derived(
    applyMenu.viewId ? views.find((v) => v.id === applyMenu.viewId) : null
  )
  const applyMenuTargets = $derived(
    applyMenuSourceView
      ? structures
          .filter((s) => s.id !== applyMenuSourceView.structureId)
          .map((s) => ({ id: s.id, label: s.label }))
      : []
  )

  function clearPanelSelection() {
    selectedStructureIds = new Set()
    selectedViewIds = new Set()
    selectionAnchorStructureId = null
    selectionAnchorViewId = null
  }

  /** Keep multi-select if already selected; otherwise select only this structure. */
  function ensureStructureInSelection(id) {
    if (selectedStructureIds.has(id)) return
    selectedStructureIds = new Set([id])
    selectedViewIds = new Set()
    selectionAnchorStructureId = id
    selectionAnchorViewId = null
  }

  /** Keep multi-select if already selected; otherwise select only this representation. */
  function ensureViewInSelection(id) {
    if (selectedViewIds.has(id)) return
    selectedViewIds = new Set([id])
    selectedStructureIds = new Set()
    selectionAnchorViewId = id
    selectionAnchorStructureId = null
  }

  function showPanelSelection() {
    if (selectedStructureIds.size) setStructuresVisible([...selectedStructureIds], true)
    if (selectedViewIds.size) setViewsVisible([...selectedViewIds], true)
  }

  function hidePanelSelection() {
    if (selectedStructureIds.size) setStructuresVisible([...selectedStructureIds], false)
    if (selectedViewIds.size) setViewsVisible([...selectedViewIds], false)
  }

  async function layoutStructureCtxMenu() {
    if (!structureCtxMenu || !structureCtxMenuEl) return
    await tick()
    if (!structureCtxMenu || !structureCtxMenuEl) return
    const pad = 8
    const rect = structureCtxMenuEl.getBoundingClientRect()
    let x = structureCtxMenu.x
    let y = structureCtxMenu.y
    if (x + rect.width > window.innerWidth - pad) {
      x = Math.max(pad, window.innerWidth - rect.width - pad)
    }
    if (y + rect.height > window.innerHeight - pad) {
      y = Math.max(pad, structureCtxMenu.y - rect.height)
    }
    structureCtxMenuPos = { x, y }
  }

  /** @param {string} id @param {MouseEvent} e */
  function openStructureCtxMenu(id, e) {
    e.preventDefault()
    e.stopPropagation()
    ensureStructureInSelection(id)
    structureCtxMenu = { x: e.clientX, y: e.clientY, id }
    structureCtxMenuPos = { x: e.clientX, y: e.clientY }
    layoutStructureCtxMenu()
  }

  /** @param {string} id @param {MouseEvent} e */
  function onStructureRowSelect(id, e) {
    const ordered = panelStructureIds
    if (e.shiftKey) {
      const range = rangeSelectIds(ordered, selectionAnchorStructureId, id)
      selectedStructureIds = new Set([...selectedStructureIds, ...range])
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(selectedStructureIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      selectedStructureIds = next
      selectionAnchorStructureId = id
    } else {
      selectedStructureIds = new Set([id])
      selectedViewIds = new Set()
      selectionAnchorStructureId = id
      selectionAnchorViewId = null
    }
  }

  /** @param {string} id @param {MouseEvent} e */
  function onViewRowSelect(id, e) {
    const ordered = panelViewIds
    if (e.shiftKey) {
      const range = rangeSelectIds(ordered, selectionAnchorViewId, id)
      selectedViewIds = new Set([...selectedViewIds, ...range])
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(selectedViewIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      selectedViewIds = next
      selectionAnchorViewId = id
    } else {
      selectedViewIds = new Set([id])
      selectedStructureIds = new Set()
      selectionAnchorViewId = id
      selectionAnchorStructureId = null
      const owner = views.find((view) => view.id === id)?.structureId
      if (owner) setActiveStructure(owner)
    }
  }

  /**
   * Point Select / rename at the representation group or structure chosen in
   * the panel, when that choice is a single structure.
   */
  function adoptEditStructureFromPanel() {
    const id = editStructureIdFromPanel({
      selectedViewIds,
      viewStructureById: viewToStructureId,
      selectedStructureIds
    })
    if (id) setActiveStructure(id)
  }

  function onCreateGroupFromSelection() {
    if (!selectionCount) return
    const structureIds = Array.from(selectedStructureIds)
    const viewIds = Array.from(selectedViewIds)
    if (!structureIds.length && !viewIds.length) return
    // Structures-only selection → one outer structure group.
    // Representation selection → nested groups inside each structure.
    const kindLabel =
      viewIds.length > 0
        ? visibilityGroups.filter((g) => g.kind === 'views').length + 1
        : visibilityGroups.filter((g) => g.kind === 'structures').length + 1
    const name = `Group ${kindLabel}`
    visibilityGroups = createVisibilityGroup(visibilityGroups, {
      name,
      structureIds,
      viewIds,
      views: panelViews.map((v) => ({ id: v.id, structureId: v.structureId }))
    })
    clearPanelSelection()
  }

  /** @param {string} groupId */
  function onDissolveGroup(groupId) {
    visibilityGroups = dissolveVisibilityGroup(visibilityGroups, groupId)
  }

  /** @param {string} groupId @param {-1|1} delta */
  function onReorderGroup(groupId, delta) {
    visibilityGroups = reorderVisibilityGroup(visibilityGroups, groupId, delta)
  }

  /** @param {string} groupId @param {string} name */
  function onRenameGroup(groupId, name) {
    const next = String(name ?? '').trim()
    if (!next) return
    visibilityGroups = visibilityGroups.map((g) => (g.id === groupId ? { ...g, name: next } : g))
  }

  /** @param {() => HTMLInputElement | null} getInput */
  function focusInlineRename(getInput) {
    inlineRenameArmed = false
    tick().then(() => {
      const el = getInput()
      el?.focus()
      el?.select()
      requestAnimationFrame(() => {
        inlineRenameArmed = true
      })
    })
  }

  /** @param {string} groupId @param {string} currentName */
  function beginGroupRename(groupId, currentName) {
    editingStructureId = null
    editingStructureName = ''
    editingGroupId = groupId
    editingGroupName = currentName || ''
    focusInlineRename(() => editingGroupInputEl)
  }

  function commitGroupRename() {
    if (!inlineRenameArmed || !editingGroupId) return
    const id = editingGroupId
    const name = editingGroupName
    inlineRenameArmed = false
    editingGroupId = null
    editingGroupName = ''
    onRenameGroup(id, name)
  }

  function cancelGroupRename() {
    inlineRenameArmed = false
    editingGroupId = null
    editingGroupName = ''
  }

  /** @param {string} structureId @param {string} currentLabel */
  function beginStructureRename(structureId, currentLabel) {
    editingGroupId = null
    editingGroupName = ''
    editingStructureId = structureId
    editingStructureName = currentLabel || ''
    focusInlineRename(() => editingStructureInputEl)
  }

  function commitStructureRename() {
    if (!inlineRenameArmed || !editingStructureId) return
    const id = editingStructureId
    const name = editingStructureName
    inlineRenameArmed = false
    editingStructureId = null
    editingStructureName = ''
    renameStructure(id, name)
  }

  function cancelStructureRename() {
    inlineRenameArmed = false
    editingStructureId = null
    editingStructureName = ''
  }

  /** @param {string} groupId */
  function toggleGroupCollapsed(groupId) {
    visibilityGroups = visibilityGroups.map((g) =>
      g.id === groupId ? { ...g, collapsed: !g.collapsed } : g
    )
  }

  /** @param {Record<string, unknown> & { visible?: boolean, opacity?: number }} view */
  function applyLiveViewVisibility(view, visible) {
    view.visible = visible
    if (!animateMode) return
    if (visible) {
      if (typeof view.opacity === 'number' && view.opacity <= 0.001) view.opacity = 1
    } else {
      view.opacity = 0
    }
  }

  /** @param {string[]} viewIds @param {boolean} visible */
  function persistAnimatedViewVisibility(viewIds, visible) {
    if (!animateMode || !animProject.keyframes.length) return
    let changed = false
    for (const id of viewIds) {
      if (persistViewVisibilityInKeyframes(animProject.keyframes, id, visible, animPlayhead)) {
        changed = true
      }
    }
    if (changed) animProject = { ...animProject }
  }

  /** @param {string} viewId @param {boolean} enabled */
  function persistAnimatedSelectionEachFrame(viewId, enabled) {
    if (!animateMode || !animProject.keyframes.length) return
    if (persistViewSelectionEachFrameInKeyframes(animProject.keyframes, viewId, enabled, animPlayhead)) {
      animProject = { ...animProject }
    }
  }

  /** @param {string} viewId @param {boolean} enabled */
  function persistAnimatedTrajSmoothRestoreH(viewId, enabled) {
    if (!animateMode || !animProject.keyframes.length) return
    if (persistViewTrajSmoothRestoreHInKeyframes(animProject.keyframes, viewId, enabled, animPlayhead)) {
      animProject = { ...animProject }
    }
  }

  /** @param {string[]} viewIds @param {boolean} visible */
  function setViewsVisible(viewIds, visible) {
    const set = new Set(viewIds)
    for (const v of panelViews) {
      if (set.has(v.id)) applyLiveViewVisibility(v, visible)
    }
    persistAnimatedViewVisibility(viewIds, visible)
  }

  /** @param {string[]} structureIds @param {boolean} visible */
  function setStructuresVisible(structureIds, visible) {
    const next = new Set(structureHiddenIds)
    for (const id of structureIds) {
      if (visible) next.delete(id)
      else next.add(id)
    }
    structureHiddenIds = next
    for (const s of structures) {
      if (structureIds.includes(s.id)) s.visible = visible
    }
  }

  /** Toggle visibility for a structure group (outer) or representation group (nested). */
  function toggleGroupVisible(group) {
    if (!group) return
    if (group.kind === 'structures') {
      const ids = group.structureIds || []
      if (!ids.length) return
      const anyOn = ids.some((id) => !structureHiddenIds.has(id))
      setStructuresVisible(ids, !anyOn)
      return
    }
    const ids = group.viewIds || []
    if (!ids.length) return
    const anyOn = panelViews.some((v) => ids.includes(v.id) && v.visible !== false)
    setViewsVisible(ids, !anyOn)
  }

  function toggleWorkspaceVisible() {
    const show = !workspaceAnyVisible
    structureHiddenIds = show ? new Set() : new Set(structures.map((s) => s.id))
    for (const s of structures) s.visible = show
    const viewIds = []
    for (const v of panelViews) {
      applyLiveViewVisibility(v, show)
      viewIds.push(v.id)
    }
    persistAnimatedViewVisibility(viewIds, show)
  }

  /** Snapshot groups for save (prune dangling ids). */
  function visibilityGroupsForSave() {
    return serializeVisibilityGroups(
      pruneVisibilityGroups(visibilityGroups, panelStructureIds, panelViewIds, viewToStructureId)
    )
  }

  /** @param {unknown} raw */
  function restoreVisibilityGroups(raw) {
    visibilityGroups = normalizeVisibilityGroups(raw)
    clearPanelSelection()
  }

  /** Collapse / expand a structure group in the panel. */
  function toggleStructureCollapse(id) {
    const next = new Set(collapsedStructureIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    collapsedStructureIds = next
  }

  function isStructureCollapsed(id) {
    return collapsedStructureIds.has(id)
  }

  /**
   * @param {string} selection
   * @param {Representation} representation
   * @param {{ structureId?: string | null, componentKey?: string }} [opts]
   */
  function addView(selection = 'all', representation = { type: 'points' }, opts = {}) {
    const id = crypto.randomUUID()
    const sid = opts.structureId ?? activeStructureId
    const owner = findStructure(structures, sid) ?? structure
    logEvent(
      'detail',
      'view',
      `Added representation: ${selection}`,
      `Representation: ${representation.type}`
    )
    const subset = resolveViewAtomSubset(owner, selection, representation?.type)
    views = [
      ...views,
      {
        id,
        structureId: sid,
        componentKey: opts.componentKey ?? componentKeyFromSelection(selection),
        selection,
        baseSelection: selection,
        representation,
        path: owner?.path,
        atoms: subset.atoms,
        bonds: subset.bonds,
        residues: subset.residues,
        visible: true,
        colorScheme: {
          name: 'cpk',
          resolver: cpkScheme()
        },
        helixWidth: 1.0,
        sheetWidth: 0.875,
        coilWidth: 0.125,
        ssColors: null,
        tubeRadius: 0.9,
        atomScale: 1.0,
        bondScale: 1.0,
        pointSize: 3,
        quality: 3,
        showMultipleBonds: true,
        stickRoundness: 1.0,
        bondColorMode: 'uniform',
        bondColor: '#b8b8bc',
        opacity: 1,
        surfaceInflate: 0.25,
        surfaceSource: 'atoms',
        surfaceSubdivision: 0,
        trajSmooth: 0,
        trajSmoothRestoreH: true,
        material: { ...DEFAULT_VIEW_MATERIAL }
      }
    ]
    if (animateMode) {
      registerViewTrack(animProject, id, views.map((v) => String(v.id)))
      animProject = { ...animProject }
      logEvent(
        'info',
        'view',
        'Representation track added',
        'Capture a keyframe at the playhead to include it in the animation. Earlier times stay hidden until then.'
      )
    }
  }

  /** @param {Atom[] | undefined | null} atoms */
  function centerCameraOnAtoms(atoms) {
    const next = getCameraForAtoms(atoms)
    if (!next) {
      return
    }
    camera = {
      ...next,
      framingZoom: 1,
      framingGeneration: (camera?.framingGeneration ?? 0) + 1,
      poseResetGeneration: camera?.poseResetGeneration ?? 0
    }
    syncControlsTarget(atoms)
  }

  /** @param {Atom[] | undefined | null} atoms */
  function syncControlsTarget(atoms) {
    if (!mainViewerControls.current || !atoms?.length) return
    let cx = 0
    let cy = 0
    let cz = 0
    for (const a of atoms) {
      cx += a.x
      cy += a.y
      cz += a.z
    }
    const n = atoms.length
    mainViewerControls.current.target.set(cx / n, cy / n, cz / n)
  }

  /**
   * @param {View[]} [viewList]
   * @returns {Atom[]}
   */
  function collectVisibleViewAtoms(viewList = views) {
    /** @type {Atom[]} */
    const out = []
    const seen = new Set()
    for (const v of viewList) {
      if (!v.visible) continue
      for (const a of v.atoms ?? []) {
        if (seen.has(a.index)) continue
        seen.add(a.index)
        out.push(a)
      }
    }
    return out.length ? out : (structure?.atoms ?? [])
  }

  /** Reframe camera to *atoms* and reset orbit pose (e.g. after auto-generate). @param {Atom[] | undefined | null} atoms */
  function reframeCameraOnAtoms(atoms) {
    const base = getCameraForAtoms(atoms)
    if (!base) return
    camera = {
      ...base,
      framingZoom: 1,
      framingGeneration: (camera?.framingGeneration ?? 0) + 1,
      poseResetGeneration: (camera?.poseResetGeneration ?? 0) + 1
    }
    syncControlsTarget(atoms)
  }

  /**
   * REPLACE the workspace from viewpoint/animation ``structures[]`` meta.
   * Re-materializes Maestro / multi-MODEL entries from the durable ``sourcePath``
   * (not ephemeral structure_cache PDBs). Preserves meta ``id`` values so saved
   * views / visibility groups keep matching ``structureId``s.
   * @param {Array<{ id?: string, path: string, topology?: string | null, sourcePath?: string, kind?: string, label?: string, ctIndex?: number | null, modelIndex?: number | null, visible?: boolean }>} metas
   * @param {{
   *   addDefaultViews?: boolean,
   *   resetCamera?: boolean,
   *   onProgress?: (done: number, total: number, label?: string) => void
   * }} [opts]
   */
  async function loadStructuresFromMeta(metas, opts = {}) {
    const list = normalizeStructuresMeta(metas)
    if (!list.length) throw new Error('No structures to load')
    const addDefaultViews = opts.addDefaultViews === true
    const resetCamera = opts.resetCamera !== false
    const onProgress = opts.onProgress
    let progressDone = 0
    const progressTotal = list.length
    /** @param {string} [label] */
    const tickProgress = (label) => {
      progressDone += 1
      onProgress?.(progressDone, progressTotal, label)
    }

    structures = []
    activeStructureId = null
    views = []
    measurements = []
    measurePicks = []
    atomLabels = []
    measureMode = null
    ctxMenu = null
    visibilityGroups = []
    clearPanelSelection()
    baseAtomCoordsByStructure = new Map()
    animCoordOverlayByStructure = new Map()
    structureHiddenIds = new Set()
    collapsedStructureIds = new Set()
    coordsGeneration += 1

    const { singles, maestro, models } = groupStructureMetasForLoad(list)
    /** @type {import('../lib/visualizeStructures.js').StructureEntry[]} */
    const loaded = []
    /** @type {View[]} */
    const defaultViews = []

    /**
     * @param {string} sourcePath
     * @param {number[]} indices
     * @param {typeof list} metaSlice
     * @param {'maestro_ct' | 'pdb_model'} kind
     */
    async function appendImportedGroup(sourcePath, indices, metaSlice, kind) {
      const base = String(sourcePath).split(/[/\\]/).pop() || 'file'
      onProgress?.(progressDone, progressTotal, `Unpacking ${base}…`)
      const imported = await importStructureEntries(sourcePath, indices)
      const byIndex = new Map(
        (imported.structures || []).map((st) => {
          const idx =
            kind === 'maestro_ct'
              ? Number(st.ctIndex)
              : Number(st.modelIndex)
          return [idx, st]
        })
      )
      for (const meta of metaSlice) {
        const idx = kind === 'maestro_ct' ? Number(meta.ctIndex) : Number(meta.modelIndex)
        const st = byIndex.get(idx)
        if (!st) continue
        const path = String(st.path ?? st.pdbPath ?? '')
        const top =
          typeof meta.topology === 'string'
            ? meta.topology
            : st.topology != null
              ? String(st.topology)
              : null
        const raw = await getStructure({
          path,
          topology: top,
          needs_bonds: false,
          needs_secondary_structure: false,
          save_dir: workingDir || null
        })
        const entry = createStructureEntry({
          id: meta.id,
          sourcePath,
          kind,
          ctIndex: kind === 'maestro_ct' ? idx : null,
          modelIndex: kind === 'pdb_model' ? idx : null,
          label: meta.label || st.label || `${String(sourcePath).split(/[/\\]/).pop() || 'entry'} · ${idx}`,
          path: raw.path,
          topologyPath: raw.topology_used || top || null,
          atoms: raw.atoms,
          bonds: raw.bonds || [],
          residues: raw.residues,
          bond_source: raw.bond_source,
          visible: meta.visible !== false
        })
        loaded.push(entry)
        if (addDefaultViews) defaultViews.push(makeDefaultPointsView(entry))
        tickProgress(entry.label)
      }
    }

    onProgress?.(0, progressTotal, '')
    for (const [sourcePath, slice] of maestro) {
      const indices = slice
        .map((m) => m.ctIndex)
        .filter((n) => typeof n === 'number')
      if (!indices.length) continue
      await appendImportedGroup(sourcePath, /** @type {number[]} */ (indices), slice, 'maestro_ct')
    }
    for (const [sourcePath, slice] of models) {
      const indices = slice
        .map((m) => m.modelIndex)
        .filter((n) => typeof n === 'number')
      if (!indices.length) continue
      await appendImportedGroup(sourcePath, /** @type {number[]} */ (indices), slice, 'pdb_model')
    }
    for (const meta of singles) {
      const path = meta.path || meta.sourcePath
      if (!path) continue
      if (meta.trajectory?.files?.length) {
        const top = meta.topology || meta.path || path
        const entry = await loadTrajectoryEntry(top, meta.trajectory.files, {
          logicalFrame: meta.trajectory.logicalFrame,
          id: meta.id,
          label: meta.label,
          alignment: meta.trajectory.alignment,
          box: meta.trajectory.box
        })
        if (meta.visible === false) entry.visible = false
        loaded.push(entry)
        if (addDefaultViews) defaultViews.push(makeDefaultPointsView(entry))
        tickProgress(entry.label)
        continue
      }
      // Prefer existing file path; if cache PDB is gone but sourcePath is a real file, use that.
      let openPath = path
      try {
        const raw = await getStructure({
          path: openPath,
          topology: meta.topology ?? null,
          needs_bonds: false,
          needs_secondary_structure: false,
          save_dir: workingDir || null
        })
        const entry = createStructureEntry({
          id: meta.id,
          sourcePath: meta.sourcePath || openPath,
          kind: /** @type {any} */ (meta.kind || 'file'),
          ctIndex: meta.ctIndex ?? null,
          modelIndex: meta.modelIndex ?? null,
          label: meta.label,
          path: raw.path,
          topologyPath: raw.topology_used || meta.topology || null,
          atoms: raw.atoms,
          bonds: raw.bonds || [],
          residues: raw.residues,
          bond_source: raw.bond_source,
          visible: meta.visible !== false
        })
        loaded.push(entry)
        if (addDefaultViews) defaultViews.push(makeDefaultPointsView(entry))
        tickProgress(entry.label)
      } catch (ex) {
        const fallback = meta.sourcePath && meta.sourcePath !== openPath ? meta.sourcePath : null
        if (!fallback) throw ex
        const raw = await getStructure({
          path: fallback,
          topology: meta.topology ?? null,
          needs_bonds: false,
          needs_secondary_structure: false,
          save_dir: workingDir || null
        })
        const entry = createStructureEntry({
          id: meta.id,
          sourcePath: fallback,
          kind: 'file',
          label: meta.label,
          path: raw.path,
          topologyPath: raw.topology_used || meta.topology || null,
          atoms: raw.atoms,
          bonds: raw.bonds || [],
          residues: raw.residues,
          bond_source: raw.bond_source,
          visible: meta.visible !== false
        })
        loaded.push(entry)
        if (addDefaultViews) defaultViews.push(makeDefaultPointsView(entry))
        tickProgress(entry.label)
      }
    }

    if (!loaded.length) throw new Error('No structures could be loaded from the saved file')

    // Keep saved order when possible.
    const byId = new Map(loaded.map((e) => [e.id, e]))
    const ordered = []
    for (const m of list) {
      const e = m.id ? byId.get(m.id) : null
      if (e) {
        ordered.push(e)
        byId.delete(e.id)
      }
    }
    ordered.push(...byId.values())

    structures = ordered
    syncStructureHiddenFromEntries(ordered)
    activeStructureId = ordered[0].id
    baseAtomCoords = new Map()
    coordsDirty = false
    coordsGeneration += 1
    coordUndoStack.clear()
    previewPositions = null
    animCoordOverlay = null
    const traj = ordered.find((s) => s.trajectory)
    if (traj) {
      bindTrajCache(traj)
      const frame = traj.trajectory?.logicalFrame ?? 0
      if (frame > 0) await seekTrajFrame(frame)
      else trajXyzEpoch += 1
    } else {
      disposeTrajCache()
    }
    if (addDefaultViews) views = defaultViews
    if (resetCamera) {
      reframeCameraOnAtoms(ordered.flatMap((e) => e.atoms || []))
    }
    requestSidePanelExpand('visualize')
  }

  /**
   * REPLACE the workspace with a single structure. Used by viewpoint / animation
   * load and in-place edit reloads. The multi-structure Open flow uses
   * `appendStructure` / `openFiles` instead.
   * @param {string} path
   * @param {{ resetCamera?: boolean, topology?: string | null }} [opts]
   */
  async function loadStructure(path, { resetCamera = true, topology = null } = {}) {
    // Clear existing workspace state (single-structure replace semantics).
    structures = []
    activeStructureId = null
    views = []
    measurements = []
    measurePicks = []
    atomLabels = []
    measureMode = null
    ctxMenu = null
    baseAtomCoordsByStructure = new Map()
    animCoordOverlayByStructure = new Map()
    coordsGeneration += 1
    const entry = await appendStructure(path, { topology, resetCamera })
    if (!entry && resetCamera) camera = null
  }

  // ── Measurement helpers ──────────────────────────────────────────────
  const MEASURE_NEEDS = { distance: 2, angle: 3, dihedral: 4 }

  /** Standard 3-letter → 1-letter amino acid map */
  const AA1 = {
    ALA: 'A',
    ARG: 'R',
    ASN: 'N',
    ASP: 'D',
    CYS: 'C',
    GLN: 'Q',
    GLU: 'E',
    GLY: 'G',
    HIS: 'H',
    ILE: 'I',
    LEU: 'L',
    LYS: 'K',
    MET: 'M',
    PHE: 'F',
    PRO: 'P',
    SER: 'S',
    THR: 'T',
    TRP: 'W',
    TYR: 'Y',
    VAL: 'V',
    HSD: 'H',
    HSE: 'H',
    HSP: 'H',
    HID: 'H',
    HIE: 'H',
    HIP: 'H',
    MSE: 'M'
  }

  /** Build ordered, deduplicated label format options for a right-clicked atom. */
  function atomLabelFormats(atom) {
    const res3 = atom.res_name ?? ''
    const resId = atom.res_id ?? ''
    const chain = atom.chain_id ?? ''
    const res1 = AA1[res3] ?? ''
    const resTc = res3 ? res3[0] + res3.slice(1).toLowerCase() : ''
    const fmts = [atom.name]
    if (res3 && resId !== '') {
      fmts.push(`${res3}${resId}`)
      fmts.push(`${resTc}${resId}`)
      if (res1) fmts.push(`${res1}${resId}`)
      if (chain) {
        fmts.push(`${res3}${resId}:${chain}`)
        fmts.push(`${resTc}${resId}:${chain}`)
        if (res1) fmts.push(`${res1}${resId}:${chain}`)
      }
    }
    return [...new Set(fmts)].filter(Boolean)
  }

  function toggleMeasureMode(mode) {
    if (!structure) return
    measureMode = measureMode === mode ? null : mode
    measurePicks = []
    ctxMenu = null
  }

  // ── Edit Mode helpers ────────────────────────────────────────────────

  /**
   * Return atom indices belonging to the selection group for the given level.
   * @param {{ index:number, res_id:number, chain_id:string }} atom
   * @param {string} level
   * @returns {number[]}
   */
  function _editGroupIndices(atom, level) {
    if (!structure) return []
    if (level === 'atom') return [atom.index]
    if (level === 'residue')
      return structure.atoms
        .filter((a) => a.chain_id === atom.chain_id && a.res_id === atom.res_id)
        .map((a) => a.index)
    if (level === 'chain')
      return structure.atoms.filter((a) => a.chain_id === atom.chain_id).map((a) => a.index)
    // molecule — the representation of this structure that contains the atom
    const v = views.find(
      (view) =>
        view.structureId === activeStructureId &&
        !view._isSelHighlight &&
        view.atoms?.some((a) => a.index === atom.index)
    )
    return v?.atoms?.map((a) => a.index) ?? []
  }

  function handleCanvasHover({ x, y, w, h, clientX, clientY }) {
    if (!editMode || measureMode) return
    const cam = mainViewerCamera.current
    if (!cam) return
    const atom = pickAtomFromViews(viewsForPicking(), cam, w, h, x, y, 22)
    editHoveredAtom = atom
    editTooltip = atom ? { clientX, clientY } : null
    editHoverGroupIndices = atom ? new Set(_editGroupIndices(atom, editSelectionLevel)) : new Set()
  }

  function onEditModeCenterView() {
    const atoms = atomsAtCurrentTraj(
      structure?.atoms.filter((a) => editHoverGroupIndices.has(a.index))
    )
    if (!atoms?.length) return
    centerCameraOnAtoms(atoms)
    // Also shift rotation pivot to centroid
    if (mainViewerControls.current) {
      let cx = 0,
        cy = 0,
        cz = 0
      for (const a of atoms) {
        cx += a.x
        cy += a.y
        cz += a.z
      }
      const n = atoms.length
      mainViewerControls.current.target.set(cx / n, cy / n, cz / n)
    }
  }

  /** @param {{ res_id:number, chain_id:string, res_name:string }} atom */
  function onEditModeRenameRes(atom) {
    const a = atom ?? selectedAtom ?? editHoveredAtom
    if (!a) return
    rrChain = a.chain_id ?? ''
    rrStart = a.res_id ?? 1
    rrEnd = a.res_id ?? 9999
    rrNewName = a.res_name ?? ''
    rrApplyToSel = selectedGroupIndices.size > 0
    dlgRenameRes?.showModal()
  }

  /** @param {{ chain_id:string }} atom */
  function onEditModeRenameChain(atom) {
    const a = atom ?? selectedAtom ?? editHoveredAtom
    if (!a) return
    rcOldChain = a.chain_id ?? ''
    rcNewChain = a.chain_id ?? ''
    rcApplyToSel = selectedGroupIndices.size > 0
    dlgRenameChain?.showModal()
  }

  /** @param {{ res_id:number, chain_id:string }} atom */
  function onEditModeRenumberRes(atom) {
    const a = atom ?? selectedAtom ?? editHoveredAtom
    if (!a) return
    rnChain = a.chain_id ?? ''
    rnStart = a.res_id ?? 1
    rnEnd = a.res_id ?? 9999
    rnNewStart = 1
    rnApplyToSel = selectedGroupIndices.size > 0
    dlgRenumberRes?.showModal()
  }

  async function onEditModeDelete() {
    const targetIndices =
      selectedGroupIndices.size > 0 ? [...selectedGroupIndices] : [...editHoverGroupIndices]
    if (!filePath || targetIndices.length === 0) return
    if (!confirm(`Delete ${targetIndices.length} atom(s) from the structure?`)) return
    editBusy = true
    try {
      const res = await editDeleteByIndices({ path: filePath, indices: targetIndices })
      logEvent('info', 'view', `Deleted ${targetIndices.length} atom(s)`, filePath)
      selectedGroupIndices = new Set()
      selectedAtom = null
      editHoverGroupIndices = new Set()
      editHoveredAtom = null
      editTooltip = null
      await applyEditResult(res)
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      editBusy = false
    }
  }

  function handleCanvasClick({ x, y, w, h, ctrlKey = false }) {
    ctxMenu = null
    if (Date.now() < _ignoreCanvasClickUntil) return
    // In edit mode (not measuring): left-click locks the hovered group as selected
    if (editMode && !measureMode) {
      const cam = mainViewerCamera.current
      if (!cam) return
      // Keep in-memory moves if the gizmo is dismissed / selection changes
      // before pointer-up commit (or after a sub-threshold drag).
      if (showGizmo) commitGizmoPreviewIfAny()
      const atom = pickAtomFromViews(viewsForPicking(), cam, w, h, x, y)
      if (atom) {
        const groupIndices = new Set(_editGroupIndices(atom, editSelectionLevel))
        if (ctrlKey) {
          // Toggle the clicked group in/out of the current selection
          const allSelected = [...groupIndices].every((i) => selectedGroupIndices.has(i))
          const newSel = new Set(selectedGroupIndices)
          if (allSelected) {
            for (const i of groupIndices) newSel.delete(i)
          } else {
            for (const i of groupIndices) newSel.add(i)
            selectedAtom = atom
          }
          selectedGroupIndices = newSel
        } else {
          selectedAtom = atom
          selectedGroupIndices = groupIndices
          showGizmo = false
        }
      } else {
        if (!ctrlKey) {
          selectedAtom = null
          selectedGroupIndices = new Set()
          showGizmo = false
        }
      }
      _syncSelHighlightView()
      return
    }
    if (!measureMode) return
    const cam = mainViewerCamera.current
    if (!cam) return
    const atom = pickAtomFromViews(viewsForPicking(), cam, w, h, x, y)
    if (!atom) return
    const next = [...measurePicks, atom]
    const need = MEASURE_NEEDS[measureMode]
    if (next.length >= need) {
      measurements = [
        ...measurements,
        {
          id: crypto.randomUUID(),
          type: measureMode,
          atoms: next.slice(0, need),
          color: measColor,
          size: measSize,
          lineWidth: measLineWidth,
          background: measBackground,
          backgroundOpacity: measBackgroundOpacity,
          padding: measPadding,
          radius: measRadius,
          offsetY: measOffsetY,
          liftDir: measLiftDir,
          visible: true,
          ...liveOverlayFadeDefaults()
        }
      ]
      measurePicks = []
    } else {
      measurePicks = next
    }
  }

  function handleCanvasContextMenu({ x, y, w, h, clientX, clientY }) {
    if (measureMode) {
      // right-click cancels active measurement
      measureMode = null
      measurePicks = []
      return
    }
    const cam = mainViewerCamera.current
    if (!cam) return
    const atom = pickAtomFromViews(viewsForPicking(), cam, w, h, x, y)
    if (!atom) return
    ctxMenu = { x: clientX, y: clientY, atom, labelsOpen: false }
  }

  function addAtomLabel(atom, text) {
    logEvent(
      'verbose',
      'view',
      `Label: ${text}`,
      `${atom.name} ${atom.res_name}${atom.res_id} :${atom.chain_id}`
    )
    atomLabels = [
      ...atomLabels,
      {
        id: crypto.randomUUID(),
        atom,
        text,
        size: labelSize,
        color: labelColor,
        background: labelBackground,
        backgroundOpacity: labelBackgroundOpacity,
        padding: labelPadding,
        radius: labelRadius,
        offsetY: labelOffsetY,
        liftDir: labelLiftDir,
        visible: true,
        ...liveOverlayFadeDefaults()
      }
    ]
    ctxMenu = null
  }

  function removeMeasurement(id) {
    measurements = measurements.filter((m) => m.id !== id)
  }

  function removeAtomLabel(id) {
    atomLabels = atomLabels.filter((l) => l.id !== id)
  }

  /**
   * Update lift on live labels. Clears animation `screenDX/DY` so the edit is not
   * overridden by the last applyAnimFrame interpolation result.
   * @param {number} [index] if omitted, apply to every label
   * @param {{ offsetY?: number, liftDir?: 'up' | 'down' | 'left' | 'right' }} patch
   */
  function patchLabelLift(index, patch) {
    const targets =
      typeof index === 'number' ? [atomLabels[index]].filter(Boolean) : atomLabels
    for (const l of targets) {
      if (typeof patch.offsetY === 'number') l.offsetY = patch.offsetY
      if (patch.liftDir) l.liftDir = patch.liftDir
      clearLabelScreenOffset(l)
    }
    atomLabels = [...atomLabels]
  }

  /**
   * Update lift on live measurements (same screen-offset model as labels).
   * @param {number} [index] if omitted, apply to every measurement
   * @param {{ offsetY?: number, liftDir?: 'up' | 'down' | 'left' | 'right' }} patch
   */
  function patchMeasurementLift(index, patch) {
    const targets =
      typeof index === 'number' ? [measurements[index]].filter(Boolean) : measurements
    for (const m of targets) {
      if (typeof patch.offsetY === 'number') m.offsetY = patch.offsetY
      if (patch.liftDir) m.liftDir = patch.liftDir
      clearLabelScreenOffset(m)
    }
    measurements = [...measurements]
  }

  /** @param {import('../lib/animation/fade.js').AnimationFadeSettings} next */
  function onOverlayFadeChange(next) {
    if (!overlayFadeEditor) return
    if (overlayFadeEditor.kind === 'label') {
      atomLabels = atomLabels.map((l) => (l.id === overlayFadeEditor.id ? { ...l, ...next } : l))
    } else if (overlayFadeEditor.kind === 'meas') {
      measurements = measurements.map((m) => (m.id === overlayFadeEditor.id ? { ...m, ...next } : m))
    } else {
      views = views.map((v) => (v.id === overlayFadeEditor.id ? { ...v, ...next } : v))
    }
  }

  function viewDisplayLabel(v) {
    const sel = v.baseSelection || v.selection || 'all'
    const repr = v.representation?.type ?? 'points'
    return `${sel} · ${repr}`
  }

  function clearAllMeasurements() {
    logEvent('detail', 'view', 'Measurements cleared', `${measurements.length} removed`)
    measurements = []
    measurePicks = []
    gearOpen = null
  }

  function clearAllLabels() {
    logEvent('detail', 'view', 'Labels cleared', `${atomLabels.length} removed`)
    atomLabels = []
    gearOpen = null
  }

  /** True when at least one label is visible (master toggle → Hide all). */
  const labelsAnyVisible = $derived(atomLabels.some((l) => l.visible !== false))
  /** True when at least one measurement is visible (master toggle → Hide all). */
  const measAnyVisible = $derived(measurements.some((m) => m.visible !== false))

  function setAllLabelsVisible(visible) {
    if (!atomLabels.length) return
    atomLabels = atomLabels.map((l) => ({ ...l, visible }))
    logEvent('detail', 'view', visible ? 'Show all labels' : 'Hide all labels', `${atomLabels.length}`)
  }

  function setAllMeasurementsVisible(visible) {
    if (!measurements.length) return
    measurements = measurements.map((m) => ({ ...m, visible }))
    logEvent(
      'detail',
      'view',
      visible ? 'Show all measurements' : 'Hide all measurements',
      `${measurements.length}`
    )
  }

  function measurementLabel(m) {
    if (m.type === 'distance') return `${measureDistance(m.atoms[0], m.atoms[1]).toFixed(2)} Å`
    if (m.type === 'angle') return `${measureAngle(m.atoms[0], m.atoms[1], m.atoms[2]).toFixed(1)}°`
    return `${measureDihedral(m.atoms[0], m.atoms[1], m.atoms[2], m.atoms[3]).toFixed(1)}°`
  }

  /** @param {string} id */
  function removeView(id) {
    if (animateMode && isTrackInAnimation(animProject, id)) {
      const inKeyframes = animProject.keyframes.some((kf) =>
        kf.views.some((v) => String(v.id) === id)
      )
      const msg = inKeyframes
        ? 'This representation is used in animation keyframes.\n\nRemove it from all keyframes and delete the representation?'
        : 'Remove this representation track from the animation?'
      if (!confirm(msg)) return
      removeViewTrackFromProject(animProject, id)
      animProject = { ...animProject }
    }
    logEvent('detail', 'view', 'Removed representation', id)
    views = views.filter((it) => it.id !== id)
    viewAtomsCache.delete(id)
    visibilityGroups = pruneVisibilityGroups(
      visibilityGroups,
      structures.map((s) => s.id),
      views.filter((v) => !v._isSelHighlight).map((v) => v.id),
      new Map(
        views
          .filter((v) => !v._isSelHighlight && v.structureId)
          .map((v) => /** @type {[string, string]} */ ([v.id, v.structureId]))
      )
    )
  }

  /** Duplicate a representation so the copy can be edited independently (e.g. selection). */
  /** @param {string} id */
  function duplicateView(id) {
    const src = views.find((v) => v.id === id)
    if (!src || src._isSelHighlight) return
    const dupId = crypto.randomUUID()
    // In-memory clone only. The new card must not /get-structure (or treat the
    // copy as a missing selection) — that hitch is what killed Traj smooth after
    // Duplicate while playing.
    skipNextAtomsFetch.add(dupId)
    const dup = {
      ...src,
      id: dupId,
      representation: { ...src.representation },
      colorScheme: { ...src.colorScheme },
      material: src.material ? { ...src.material } : { ...DEFAULT_VIEW_MATERIAL },
      ssColors: src.ssColors ? { ...src.ssColors } : null,
      atoms: src.atoms,
      bonds: src.bonds,
      residues: src.residues,
      visible: true,
      _prefetched: true,
      _bondOrderFetchDone: true,
      _residueFetchDone: true
    }
    const idx = views.findIndex((v) => v.id === id)
    const next = [...views]
    next.splice(idx + 1, 0, dup)
    views = next
    if (animateMode) {
      registerViewTrack(animProject, dup.id, views.map((v) => String(v.id)))
      animProject = { ...animProject }
      logEvent(
        'info',
        'view',
        'Duplicated representation track',
        'Capture a keyframe to include the copy in the animation.'
      )
    }
    logEvent(
      'detail',
      'view',
      `Duplicated representation: ${src.selection || src.baseSelection || 'all'}`,
      `Representation: ${dup.representation?.type}`
    )
  }

  /**
   * Replace one representation with several, grouped by chain, residue, etc.
   * @param {string} id
   * @param {import('../lib/viewer/splitView.js').SplitViewMode} mode
   */
  function splitViewBy(id, mode) {
    const src = views.find((v) => v.id === id)
    if (!src || src._isSelHighlight) return

    let working = src
    if (mode === 'molecule' && !src.bonds?.length && structure?.bonds?.length) {
      const atomIdx = new Set(src.atoms.map((/** @type {{ index: number }} */ a) => a.index))
      working = {
        ...src,
        bonds: structure.bonds.filter(([i, j]) => atomIdx.has(i) && atomIdx.has(j))
      }
    }

    const result = splitViewIntoParts(working, mode)
    if ('error' in result) {
      alert(result.error)
      return
    }

    const idx = views.findIndex((v) => v.id === id)
    const next = [...views]
    next.splice(idx, 1, ...result.parts)
    if (animateMode) {
      if (isTrackInAnimation(animProject, id)) {
        removeViewTrackFromProject(animProject, id)
      }
      for (const part of result.parts) {
        registerViewTrack(animProject, String(part.id), next.map((v) => String(v.id)))
      }
    }
    views = next
    if (animateMode) {
      animProject = { ...animProject }
    }
    logEvent(
      'detail',
      'view',
      `Split representation by ${splitViewModeLabel(mode)} (${result.parts.length})`,
      result.parts.map((p) => p.selection).join(' · ')
    )
  }

  function resetCamera() {
    const base = getCameraForAtoms(structure?.atoms)
    if (!base) {
      return
    }
    camera = {
      ...base,
      framingZoom: 1,
      framingGeneration: (camera?.framingGeneration ?? 0) + 1,
      poseResetGeneration: (camera?.poseResetGeneration ?? 0) + 1
    }
  }

  function clearWorkspace() {
    logEvent('detail', 'view', 'Workspace cleared')
    structures = []
    activeStructureId = null
    collapsedStructureIds = new Set()
    structureHiddenIds = new Set()
    visibilityGroups = []
    clearPanelSelection()
    viewAtomsCache.clear()
    disposeTrajCache()
    views = []
    measurements = []
    measurePicks = []
    atomLabels = []
    camera = null
    measureMode = null
    ctxMenu = null
    previewPositions = null
    animCoordOverlay = null
    baseAtomCoords = new Map()
    baseAtomCoordsByStructure = new Map()
    animCoordOverlayByStructure = new Map()
    coordsDirty = false
    coordsGeneration += 1
    coordUndoStack.clear()
    stopAnimPlayback()
    if (animExporting) {
      animExportCancelRequested = true
      void window.api.animationCancelEncode?.()
    }
    animateMode = false
    animProject = createEmptyProject()
    animPlayhead = 0
    animExporting = false
    animExportPhase = ''
    animExportFrame = 0
    animExportTotal = 0
    animExportCancelRequested = false
  }

  async function onSaveViewpoint() {
    if (!structure || !filePath || !camera) {
      alert('Load a structure before saving a view.')
      return
    }
    try {
      await tick()
      const snapshot = captureViewerSnapshot({
        views,
        filePath,
        structure,
        getFraming: () => camera,
        getViewport: () => ({ axesVisible, axesLinesVisible }),
        getLabels: () => atomLabels,
        getMeasurements: () => measurements
      })
      const baseName =
        String(filePath).split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') || 'Viewpoint'
      const metas = structuresMetaForSave()
      const primary = metas[0] || {
        path: filePath,
        topology: topologyPath,
        sourcePath: filePath
      }
      const viewpoint = buildViewpoint({
        name: baseName,
        structure: { path: primary.path, topology: primary.topology ?? topologyPath },
        structures: metas,
        visibilityGroups: visibilityGroupsForSave(),
        snapshot
      })
      // Prefer the project working directory; fall back to the durable source folder.
      const defaultDir =
        workingDir ||
        parentOfFile(primary.sourcePath || primary.path || filePath || '') ||
        undefined
      const defaultPath = defaultDir
        ? `${String(defaultDir).replace(/[/\\]+$/, '')}/${baseName}_view.json`
        : `${baseName}_view.json`
      const r = await window.api.saveFileDialog(
        'Save view',
        [{ name: 'GateWizard viewpoint', extensions: ['json'] }],
        defaultPath
      )
      if (!r || r.canceled || !r.filePath) return
      await window.api.writeJson(r.filePath, serializeViewpoint(viewpoint))
      logEvent('info', 'view', 'Saved viewpoint', r.filePath)
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    }
  }

  /**
   * Apply a normalized viewpoint onto the already-loaded structure.
   * Caller should keep `sceneRestoring` true so intermediate meshes are hidden.
   * @param {import('../lib/viewpoint.js').ViewerViewpoint} viewpoint
   */
  async function applyViewpoint(viewpoint) {
    sceneRestoringPhase = 'Restoring representations…'
    applySceneSettings(viewpoint.scene ?? {})
    if (viewpoint.viewport) {
      if (typeof viewpoint.viewport.axesVisible === 'boolean') {
        axesVisible = viewpoint.viewport.axesVisible
      }
      if (typeof viewpoint.viewport.axesLinesVisible === 'boolean') {
        axesLinesVisible = viewpoint.viewport.axesLinesVisible
      }
    }

    // Views mount under the opaque restore cover so glow lights / meshes can
    // finish building before the user ever sees the canvas.
    views = viewpoint.views.map((v) => {
      const owner = findStructure(structures, v.structureId) ?? structure
      const ctx = {
        path: owner?.path ?? null,
        atoms: owner?.atoms,
        bonds: owner?.bonds,
        residues: owner?.residues
      }
      return /** @type {View} */ (deserializeView(v, ctx))
    })
    restoreVisibilityGroups(viewpoint.visibilityGroups)
    sceneRestoringPhase = 'Loading atom selections…'
    await refreshAnimationViewAtoms()

    const atoms = /** @type {Array<{ index: number, x: number, y: number, z: number, element?: string, name?: string }>} */ (
      structure?.atoms ?? []
    )
    atomLabels = /** @type {typeof atomLabels} */ (
      deserializeAtomLabels(viewpoint.labels ?? [], atoms)
    )
    measurements = /** @type {typeof measurements} */ (
      deserializeMeasurements(viewpoint.measurements ?? [], atoms)
    )
    measurePicks = []
    measureMode = null

    const framing = viewpoint.camera?.framing
    // Prefer the live pose zoom (what the user actually saw). Older viewpoint
    // files may have framingZoom stuck at 1 even when camera.zoom was correct.
    const liveZoom =
      typeof viewpoint.camera?.zoom === 'number'
        ? viewpoint.camera.zoom
        : (framing?.framingZoom ?? 1)
    if (framing) {
      camera = {
        center: { x: framing.center[0], y: framing.center[1], z: framing.center[2] },
        extent: framing.extent,
        framingZoom: liveZoom,
        framingGeneration: (camera?.framingGeneration ?? 0) + 1,
        // Do NOT bump poseResetGeneration — that forces a canonical orbit and
        // would wipe the saved camera pose we restore next.
        poseResetGeneration: camera?.poseResetGeneration ?? 0
      }
      mainViewerFramingAnchor.fn(
        framing.center[0],
        framing.center[1],
        framing.center[2],
        framing.extent
      )
    }

    // Camera/controls refs are assigned on a Threlte frame, not on Svelte tick.
    sceneRestoringPhase = 'Restoring camera…'
    const ready = await waitForMainViewerReady()
    if (!ready) {
      console.warn('[viewpoint] camera/controls not ready; pose may not restore')
    }
    const pose = {
      ...viewpoint.camera,
      zoom: liveZoom,
      framing: framing
        ? { ...framing, framingZoom: liveZoom }
        : viewpoint.camera?.framing
    }
    applyCameraPose(pose)
    // One more frame: CameraRig may still run a framing pass after our first apply.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    if (framing) {
      mainViewerFramingAnchor.fn(
        framing.center[0],
        framing.center[1],
        framing.center[2],
        framing.extent
      )
    }
    applyCameraPose(pose)

    // Let glowing materials / mesh rebuilds finish before revealing the canvas.
    sceneRestoringPhase = 'Finishing materials…'
    sceneRestoringDetail = ''
    await waitForViewerIdle({ idleFrames: 4, timeoutMs: 20000, settleMs: 80 })
  }

  async function onLoadViewpoint() {
    const dlg = await window.api.openFileDialog(
      'Open view',
      [{ name: 'GateWizard viewpoint', extensions: ['json'] }],
      workingDir || parentOfFile(filePath || '') || undefined
    )
    if (!dlg || dlg.canceled || !dlg.filePath) return
    sceneRestoring = true
    sceneRestoringPhase = 'Opening view…'
    sceneRestoringDetail = ''
    sceneRestoringCurrent = 0
    sceneRestoringTotal = 0
    startOverlayElapsed()
    try {
      const data = await window.api.readJson(dlg.filePath)
      if (data && typeof data === 'object' && data.format === 'gatewizard-animation') {
        throw new Error('That file is an animation project. Use Open ▾ → Animation… instead.')
      }
      const viewpoint = normalizeViewpoint(data)
      const metas =
        Array.isArray(viewpoint.structures) && viewpoint.structures.length
          ? viewpoint.structures
          : viewpoint.structure?.path
            ? [viewpoint.structure]
            : []
      if (!metas.length) {
        throw new Error('Viewpoint file has no structure path')
      }
      // Auto-load structures (including Maestro source + CT indices) so a saved
      // view can be opened standalone without depending on structure_cache PDBs.
      const sameWorkspace =
        metas.length === structures.length &&
        metas.every((m, i) => m.path === structures[i]?.path || m.id === structures[i]?.id)
      if (!sameWorkspace) {
        reportStructureLoadProgress(0, metas.length, '')
        await loadStructuresFromMeta(metas, {
          addDefaultViews: false,
          resetCamera: true,
          onProgress: reportStructureLoadProgress
        })
        if (!structure) return
        views = []
      }
      sceneRestoringCurrent = 0
      sceneRestoringTotal = 0
      sceneRestoringDetail = ''
      await applyViewpoint(viewpoint)
      logEvent('info', 'view', 'Loaded viewpoint', dlg.filePath)
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      clearSceneRestoreUi()
    }
  }

  async function onSavePdb() {
    if (!filePath || !structure?.atoms?.length) return
    const baseName =
      String(filePath).split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') || 'structure'
    const defaultDir = (workingDir || '').trim()
    const defaultPath = defaultDir
      ? `${defaultDir.replace(/[/\\]+$/, '')}/${baseName}.pdb`
      : `${baseName}.pdb`
    const r = await window.api.saveFileDialog(
      'Save PDB',
      [{ name: 'PDB files', extensions: ['pdb'] }],
      defaultPath
    )
    if (!r || r.canceled || !r.filePath) return
    try {
      if (coordsDirty) {
        const indices = structure.atoms.map((a) => a.index)
        const xyz = []
        for (const a of structure.atoms) xyz.push(a.x, a.y, a.z)
        await structureWriteCoords({
          source: filePath,
          dest: r.filePath,
          indices,
          xyz,
          topology: topologyPath
        })
        coordsDirty = false
        baseAtomCoords = snapshotAtomCoords(structure.atoms)
        coordUndoStack.clear()
      } else {
        await editSavePdb({ source: filePath, dest: r.filePath })
      }
      logEvent('info', 'view', `Saved PDB: ${String(r.filePath).split(/[/\\]/).pop()}`, r.filePath)
      patchActiveStructure({ path: r.filePath })
      const sid = activeStructureId
      for (const v of views) {
        if (v.structureId === sid) v.path = r.filePath
      }
      views = [...views]
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    }
  }

  async function onSaveImage() {
    const canvas = viewerEl?.querySelector('canvas')
    if (!canvas) return
    const baseName =
      String(filePath || 'viewport')
        .split(/[/\\]/)
        .pop()
        ?.replace(/\.[^.]+$/, '') || 'viewport'
    const defaultDir = (workingDir || '').trim()
    const defaultPath = defaultDir
      ? `${defaultDir.replace(/[/\\]+$/, '')}/${baseName}.png`
      : `${baseName}.png`
    const r = await window.api.saveFileDialog(
      'Save Image',
      [{ name: 'PNG Image', extensions: ['png'] }],
      defaultPath
    )
    if (!r || r.canceled || !r.filePath) return
    const dataUrl = /** @type {HTMLCanvasElement} */ (canvas).toDataURL('image/png')
    const base64 = dataUrl.split(',')[1]
    await window.api.writeBinary(r.filePath, base64)
  }

  async function applyEditResult(result) {
    selectedGroupIndices = new Set()
    selectedAtom = null
    if (!result?.path) {
      alert('Edit finished but no structure path was returned.')
      return
    }
    if (views.length === 0) {
      await loadStructure(result.path, { resetCamera: false })
      return
    }
    // Snapshot per-view atom indices before clearing so index-/fragment-based
    // representations (e.g. split molecules) can be rebuilt after rename/renumber.
    const viewIndexSnapshots = views.map((v) => ({
      id: v.id,
      indices: (v.atoms || [])
        .map((/** @type {{ index?: number }} */ a) => a.index)
        .filter((/** @type {unknown} */ n) => typeof n === 'number'),
      selection: String(v.selection || ''),
      lockToIndices: /\bindex\b/i.test(String(v.selection || v.baseSelection || ''))
    }))
    // Keep the previous structure on screen until reload succeeds.
    // Never null `structure` on failure (that blacked out the canvas while
    // leaving representation chips, and disabled Clear scene).
    try {
      loadingPDB = true
      const newStructure = await getStructure({
        path: result.path,
        topology: topologyPath || null,
        // The written PDB has no CONECT. Guess bonds now so ball-and-stick and
        // licorice of a later residue selection are not left disconnected.
        needs_bonds: true,
        needs_secondary_structure: false,
        save_dir: workingDir || null
      })
      const editedId = activeStructureId
      patchActiveStructure({
        path: newStructure.path,
        atoms: newStructure.atoms,
        bonds: newStructure.bonds,
        residues: newStructure.residues,
        bond_source: newStructure.bond_source
      })
      baseAtomCoords = snapshotAtomCoords(newStructure.atoms)
      if (editedId) baseAtomCoordsByStructure.set(editedId, baseAtomCoords)
      const editedPath = newStructure.path
      coordsDirty = false
      coordsGeneration += 1
      coordUndoStack.clear()
      previewPositions = null
      animCoordOverlay = null
      measurements = []
      measurePicks = []
      atomLabels = []
      measureMode = null
      ctxMenu = null
      const byIndex = new Map()
      for (const a of newStructure.atoms || []) {
        if (typeof a.index === 'number') byIndex.set(a.index, a)
      }
      const allBonds = Array.isArray(newStructure.bonds) ? newStructure.bonds : []
      for (const v of views) {
        if (v.structureId !== editedId) continue
        const snap = viewIndexSnapshots.find((s) => s.id === v.id)
        v.path = editedPath
        if (snap?.lockToIndices && snap.indices.length) {
          const atoms = snap.indices.map((i) => byIndex.get(i)).filter(Boolean)
          if (atoms.length) {
            const idxSet = new Set(snap.indices)
            v.atoms = atoms
            v.bonds = allBonds.filter(
              ([i, j]) => idxSet.has(i) && idxSet.has(j)
            )
            const indexSel = `index ${snap.indices.join(' ')}`
            v.selection = indexSel
            v.baseSelection = indexSel
            v.residues = Array.isArray(newStructure.residues)
              ? newStructure.residues.filter((r) =>
                  (r.atom_indices || []).some((/** @type {number} */ i) => idxSet.has(i))
                )
              : []
            v._prefetched = true
            continue
          }
        }
        v.atoms = []
        v.bonds = []
        v.residues = []
        v._prefetched = false
      }
      views = [...views]
      // Optional: discover new molecule types (e.g. after MemPro). Do not
      // block the edit on detect-molecules — its legacy atom payload is heavy
      // and was a common "Failed to fetch" source after chain delete.
      try {
        const detected = await detectMolecules(result.path, {
          topology: structure?.topologyPath ?? null
        })
        const coveredSels = new Set(
          views.filter((v) => v.structureId === editedId).map((v) => v.baseSelection).filter(Boolean)
        )
        if (!coveredSels.has('all')) {
          const extras = []
          for (const [i, mol] of detected.entries()) {
            if (!coveredSels.has(mol.selection)) {
              const repr = isBiopolymerSelection(mol.selection)
                ? { type: 'cartoon' }
                : { type: 'vdw' }
              let colorScheme
              if (isBiopolymerSelection(mol.selection) && mol.residues?.length) {
                colorScheme = { name: 'ss', resolver: ssScheme(mol.residues, {}) }
              } else if (mol.selection.startsWith('resname')) {
                const color = `#${COLOR_PALETTE[(views.length + i) % COLOR_PALETTE.length].getHexString()}`
                colorScheme = {
                  name: 'cpk-carbon',
                  color,
                  resolver: cpkScheme({ carbonColor: color })
                }
              } else {
                colorScheme = { name: 'cpk', resolver: cpkScheme() }
              }
              extras.push({
                id: crypto.randomUUID(),
                structureId: editedId,
                componentKey: componentKeyFromSelection(mol.selection),
                selection: mol.selection,
                baseSelection: mol.selection,
                representation: repr,
                path: editedPath,
                atoms: mol.atoms,
                bonds: mol.bonds ?? [],
                residues: mol.residues ?? null,
                visible: mol.selection !== 'water',
                colorScheme,
                helixWidth: 1.0,
                sheetWidth: 0.875,
                coilWidth: 0.125,
                ssColors: null,
                tubeRadius: 0.9,
                atomScale: 1.0,
                bondScale: 1.0,
                pointSize: 3,
                quality: 3,
                showMultipleBonds: true,
                stickRoundness: 1.0,
                bondColorMode: 'uniform',
                bondColor: '#b8b8bc',
                opacity: 1,
                surfaceInflate: 0.25,
                surfaceSource: 'atoms',
                surfaceSubdivision: 0,
                trajSmooth: 0,
                trajSmoothRestoreH: true,
                material: { ...DEFAULT_VIEW_MATERIAL },
                _prefetched: true
              })
            }
          }
          if (extras.length) views = [...views, ...extras]
        }
      } catch (detectEx) {
        console.warn('[visualize] detectMolecules after edit failed', detectEx)
      }
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      loadingPDB = false
    }
  }

  /**
   * Shared seam for transforms (and future Minimize): commit sparse absolute positions
   * into the working structure in memory. Does not write a temp PDB.
   * @param {{ positions?: Array<number[]|undefined>|Record<number, number[]>|null, patch?: { indices: number[], xyz: number[] }|null, rebuildBonds?: boolean, pushUndo?: boolean }} opts
   */
  function applyCoordOpResult(opts) {
    if (!structure?.atoms?.length) return
    // Snapshot to a plain patch before clearing reactive preview state.
    const patch =
      normalizeCoordPatch(opts.patch) ||
      positionsToCoordPatch(
        opts.positions
          ? Array.isArray(opts.positions) || typeof opts.positions === 'object'
            ? { ...opts.positions }
            : opts.positions
          : null
      )
    if (!patch?.indices?.length) return

    // Capture load-time XYZ before the first mutation (deferred at structure open).
    ensureBaseAtomCoords(activeStructureId)

    if (opts.pushUndo !== false) {
      const before = snapshotAtomCoords(structure.atoms)
      coordUndoStack.push(inversePatchFromBefore(before, patch))
    }

    animCoordOverlay = null
    previewPositions = null
    const editedId = activeStructureId
    const newAtoms = applyPatchToAtoms(structure.atoms, patch)
    patchActiveStructure({ atoms: newAtoms })
    // Sync this structure's representations from the working structure (source of truth).
    const byIndex = new Map(newAtoms.map((a) => [a.index, a]))
    for (const v of views) {
      if (v._isSelHighlight) continue
      if (v.structureId !== editedId) continue
      skipNextPathFetch.add(v.id)
      skipNextAtomsFetch.add(v.id)
      v.atoms = (v.atoms ?? []).map((a) => {
        const src = byIndex.get(a.index)
        return src ? { ...a, x: src.x, y: src.y, z: src.z } : a
      })
    }
    // Selection highlight view uses structure atoms — rebuild if present
    if (selHighlightViewId) _syncSelHighlightView()

    views = [...views]
    _gizmoLastOp = null
    coordsDirty = true
    coordsGeneration += 1
    void opts.rebuildBonds // reserved for future Minimize / no-topology refresh
  }

  /** @deprecated use applyCoordOpResult — kept name for gizmo undo path clarity */
  async function applyGizmoResult(result) {
    if (result?.atoms) {
      /** @type {Array<number[]|undefined>} */
      const positions = []
      for (const a of result.atoms) {
        positions[a.index] = [a.x, a.y, a.z]
      }
      applyCoordOpResult({ positions })
      if (result.path) {
        patchActiveStructure({ path: result.path })
      }
    }
  }

  async function onEditRenameChain() {
    if (!filePath || !rcNewChain) return
    if (!rcApplyToSel && !rcOldChain) return
    editBusy = true
    try {
      let res
      if (rcApplyToSel && selectedGroupIndices.size > 0) {
        res = await editRenameChainByIndices({
          path: filePath,
          indices: [...selectedGroupIndices],
          newChain: rcNewChain
        })
        logEvent(
          'info',
          'view',
          `Renamed chain for ${selectedGroupIndices.size} selected atoms → ${rcNewChain}`,
          filePath
        )
      } else {
        res = await editRenameChain({ path: filePath, oldChain: rcOldChain, newChain: rcNewChain })
        logEvent('info', 'view', `Renamed chain ${rcOldChain} → ${rcNewChain}`, filePath)
      }
      dlgRenameChain?.close()
      await applyEditResult(res)
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      editBusy = false
    }
  }

  async function onEditRenameResidues() {
    if (!filePath || !rrNewName) return
    if (!rrApplyToSel && !rrChain) return
    editBusy = true
    try {
      let res
      if (rrApplyToSel && selectedGroupIndices.size > 0) {
        res = await editRenameResiduesByIndices({
          path: filePath,
          indices: [...selectedGroupIndices],
          newName: rrNewName
        })
        logEvent(
          'info',
          'view',
          `Renamed residues for ${selectedGroupIndices.size} selected atoms → ${rrNewName}`,
          filePath
        )
      } else {
        res = await editRenameResidues({
          path: filePath,
          chainId: rrChain,
          start: rrStart,
          end: rrEnd,
          newName: rrNewName
        })
        logEvent(
          'info',
          'view',
          `Renamed residues ${rrChain}:${rrStart}-${rrEnd} → ${rrNewName}`,
          filePath
        )
      }
      dlgRenameRes?.close()
      await applyEditResult(res)
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      editBusy = false
    }
  }

  async function onEditRenumberResidues() {
    if (!filePath) return
    if (!rnApplyToSel && !rnChain) return
    editBusy = true
    try {
      let res
      if (rnApplyToSel && selectedGroupIndices.size > 0) {
        res = await editRenumberResiduesByIndices({
          path: filePath,
          indices: [...selectedGroupIndices],
          newStart: rnNewStart
        })
        logEvent(
          'info',
          'view',
          `Renumbered residues for ${selectedGroupIndices.size} selected atoms, start → ${rnNewStart}`,
          filePath
        )
      } else {
        res = await editRenumberResidues({
          path: filePath,
          chainId: rnChain,
          start: rnStart,
          end: rnEnd,
          newStart: rnNewStart
        })
        logEvent(
          'info',
          'view',
          `Renumbered residues ${rnChain}:${rnStart}-${rnEnd} → start ${rnNewStart}`,
          filePath
        )
      }
      dlgRenumberRes?.close()
      await applyEditResult(res)
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      editBusy = false
    }
  }

  async function onEditDeleteAtoms() {
    if (!filePath || !daSelection) return
    editBusy = true
    try {
      const res = await editDeleteAtoms({ path: filePath, selection: daSelection })
      dlgDeleteAtoms?.close()
      logEvent('info', 'view', `Deleted atoms: "${daSelection}"`, filePath)
      await applyEditResult(res)
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      editBusy = false
    }
  }

  async function applyCustomSelection() {
    if (!filePath || !customSelInput.trim()) return
    customSelBusy = true
    customSelError = ''
    try {
      const r = await editSelectByString({ path: filePath, selection: customSelInput.trim() })
      if (r.count === 0) {
        customSelError = 'Selection matched no atoms'
        return
      }
      selectedGroupIndices = new Set(r.indices)
      selectedAtom = null
      editMode = true
      dlgCustomSel?.close()
      _syncSelHighlightView()
    } catch (ex) {
      customSelError = ex instanceof Error ? ex.message : String(ex)
    } finally {
      customSelBusy = false
    }
  }

  // ── Preview helper ─────────────────────────────────────────────────
  /**
   * Stable atom arrays for the canvas. Returning a new array on every call
   * (e.g. after an unrelated visibility update) forces nxt representations to
   * dispose and rebuild GPU meshes. XYZ comes from the working structure, then
   * live preview / animation overlay.
   * @type {Map<string, { working: unknown, overlay: unknown, sourceAtoms: unknown, gen: number, result: object[] }>}
   */
  const viewAtomsCache = new Map()

  /**
   * @param {Array<{ index?: number }> | null | undefined} atoms
   * @returns {Int32Array | null}
   */
  function cachedViewIndices(atoms) {
    if (!atoms?.length) return null
    let hit = viewIndexCache.get(atoms)
    if (!hit) {
      hit = collectAtomIndices(atoms)
      if (hit) viewIndexCache.set(atoms, hit)
    }
    return hit
  }

  /**
   * Atom indices used by visible views of this structure. Null means blend all.
   * @param {import('../lib/visualizeStructures.js').StructureEntry} owner
   */
  function visibleTrajIndices(owner) {
    const nAll = owner.atoms?.length ?? 0
    if (nAll < 1) return null
    let key = `${owner.id}:`
    const parts = []
    for (const v of views) {
      if (v.visible === false || (v.opacity ?? 1) <= 0.001) continue
      if ((v.structureId ?? owner.id) !== owner.id) continue
      const atoms = v.atoms
      if (!atoms?.length) continue
      if (atoms.length >= nAll * 0.85) return null
      key += `${v.id}:${atoms.length}|`
      parts.push(cachedViewIndices(atoms))
    }
    if (!parts.length) return null
    if (trajVisibleIndexCache.key === key) return trajVisibleIndexCache.indices
    const indices = unionAtomIndices(parts)
    const tooMany = !indices || indices.length >= nAll * 0.85
    trajVisibleIndexCache = { key, indices: tooMany ? null : indices }
    return trajVisibleIndexCache.indices
  }

  /** Packed xyz for instance reprs (no per-atom object clone). */
  /** @param {import('../lib/backendApi.js').View} view */
  function trajXyzForView(view) {
    const owner = findStructure(structures, view.structureId) ?? structure
    if (!owner?.trajectory || !trajCache) return null
    void trajPlayhead
    void trajXyzEpoch
    void trajAlign.apply
    void trajAlign.mode
    const level = clampTrajSmooth(view.trajSmooth)
    const restoreH = trajSmoothRestoreHEnabled(view.trajSmoothRestoreH)
    const key = `${owner.id}:${level}:${restoreH ? 1 : 0}:${trajAlign.apply ? 1 : 0}`
    if (
      trajBlendShared.key === key &&
      trajBlendShared.playhead === trajPlayhead &&
      trajBlendShared.xyz
    ) {
      trajBlendPrev.set(view.id, trajBlendShared.xyz)
      return trajBlendShared.xyz
    }
    const nFloats = (owner.atoms?.length ?? 0) * 3
    const scratch =
      trajBlendShared.scratch && trajBlendShared.scratch.length === nFloats
        ? trajBlendShared.scratch
        : nFloats > 0
          ? new Float32Array(nFloats)
          : null
    const blended = trajCache.blend(trajPlayhead, level, {
      prev: trajBlendShared.xyz,
      box: parseBoxLengths(owner.trajectory?.box),
      out: scratch,
      indices: visibleTrajIndices(owner),
      restoreH
    })
    if (!blended) return null
    trajBlendShared = {
      key,
      playhead: trajPlayhead,
      xyz: blended,
      scratch
    }
    trajBlendPrev.set(view.id, blended)
    return blended
  }

  /** Packed xyz at Traj smooth 0 — labels / measurements / picks follow the movie. */
  function currentTrajXyz() {
    void trajPlayhead
    void trajXyzEpoch
    void trajAlign.apply
    if (!trajCache || !trajStructure?.trajectory) return null
    return trajCache.blend(trajPlayhead, 0, {
      box: parseBoxLengths(trajStructure.trajectory?.box)
    })
  }

  const liveAtomLabels = $derived.by(() => {
    if (!atomLabels.length) return atomLabels
    return labelsWithPackedXyz(atomLabels, currentTrajXyz())
  })
  const liveMeasurements = $derived.by(() => {
    if (!measurements.length) return measurements
    return measurementsWithPackedXyz(measurements, currentTrajXyz())
  })
  const liveMeasurePicks = $derived.by(() => {
    const picks = measurePicks || []
    if (!picks.length) return picks
    return picks.map((a) => atomWithPackedXyz(a, currentTrajXyz()))
  })

  /**
   * @param {Array<{ index?: number, x: number, y: number, z: number }> | null | undefined} atoms
   */
  function atomsAtCurrentTraj(atoms) {
    const xyz = currentTrajXyz()
    if (!xyz || !atoms?.length) return atoms ?? []
    return atoms.map((a) => atomWithPackedXyz(a, xyz))
  }

  $effect(() => {
    void activeStructureId
    dofFocusAtomIndex = null
  })

  $effect(() => {
    if (animateMode) return
    const idx = dofFocusAtomIndex
    if (idx == null || !viewerSettings.dof?.enabled || !viewerSettings.dof.focusTarget) return
    void trajPlayhead
    void trajXyzEpoch
    void trajAlign.apply
    const xyz = currentTrajXyz()
    if (!xyz) return
    const t = viewerSettings.dof.focusTarget
    const live = atomWithPackedXyz({ index: idx, x: t.x, y: t.y, z: t.z }, xyz)
    if (t.x === live.x && t.y === live.y && t.z === live.z) return
    viewerSettings.dof = {
      ...viewerSettings.dof,
      focusTarget: { x: live.x, y: live.y, z: live.z }
    }
  })

  /**
   * Atoms / bonds / residues / packed xyz for one representation this frame.
   * When ``selectionEachFrame`` is on, the MDAnalysis string is re-evaluated on
   * the full structure (so a byres clip can gain/lose lipids as they move).
   * @param {import('../lib/backendApi.js').View} view
   */
  function viewDraw(view) {
    void trajPlayhead
    void trajXyzEpoch
    void trajAlign.apply
    const owner = findStructure(structures, view.structureId) ?? structure
    const sel = effectiveViewSelection(view)
    const each = view.selectionEachFrame === true
    const level = clampTrajSmooth(view.trajSmooth)
    const restoreH = trajSmoothRestoreHEnabled(view.trajSmoothRestoreH)
    const cacheKey = String(view.id || '')
    const hit = viewDrawCache.get(cacheKey)
    if (
      hit &&
      hit.epoch === trajXyzEpoch &&
      hit.playhead === trajPlayhead &&
      hit.level === level &&
      hit.restoreH === restoreH &&
      hit.each === each &&
      hit.sel === sel &&
      hit.sourceAtoms === view.atoms &&
      hit.ownerAtoms === owner?.atoms
    ) {
      return hit.result
    }

    const xyz = trajXyzForView(view)
    let atoms = view.atoms
    let bonds = view.bonds
    let residues = view.residues ?? []
    if (each && owner?.atoms?.length) {
      const idx = evaluateSelectionIndices(owner.atoms, sel, xyz)
      if (idx) {
        const filtered = filterByIndexSet(
          owner.atoms,
          owner.bonds ?? view.bonds,
          owner.residues ?? view.residues,
          idx
        )
        atoms = filtered.atoms
        bonds = filtered.bonds
        residues = filtered.residues
      }
    }

    let liveAtoms = atoms
    const repr = view.representation?.type
    const usesPackedXyz =
      repr === 'points' ||
      repr === 'vdw' ||
      repr === 'ball-stick' ||
      repr === 'licorice' ||
      repr === 'cartoon' ||
      repr === 'tube' ||
      repr === 'surface'
    if (xyz && atoms?.length && !usesPackedXyz) {
      const reuseKey = `draw:${cacheKey}`
      const prev = viewAtomsCache.get(reuseKey)
      const reuse = prev && prev.sourceAtoms === atoms ? prev.result : undefined
      liveAtoms = applyBlendToViewAtoms(atoms, xyz, reuse)
      viewAtomsCache.set(reuseKey, {
        working: owner?.atoms,
        overlay: xyz,
        sourceAtoms: atoms,
        gen: trajXyzEpoch,
        result: liveAtoms
      })
    }

    const result = { atoms: liveAtoms, bonds, residues, xyz }
    if (cacheKey) {
      viewDrawCache.set(cacheKey, {
        epoch: trajXyzEpoch,
        playhead: trajPlayhead,
        level,
        restoreH,
        each,
        sel,
        sourceAtoms: view.atoms,
        ownerAtoms: owner?.atoms,
        result
      })
    }
    return result
  }

  /** @param {import('../lib/backendApi.js').View} view */
  function viewAtoms(view) {
    if (view?.selectionEachFrame) return viewDraw(view).atoms
    if (!view?.atoms?.length) return view?.atoms
    const owner = findStructure(structures, view.structureId) ?? structure
    const sid = owner?.id ?? view.structureId ?? activeStructureId
    if (owner?.trajectory && trajCache) {
      const blended = trajXyzForView(view)
      if (blended) {
        const xyz = blended
        const cacheKey = `traj:${view.id}`
        const hit = viewAtomsCache.get(cacheKey)
        const reuse = hit && hit.sourceAtoms === view.atoms ? hit.result : undefined
        const result = applyBlendToViewAtoms(view.atoms, xyz, reuse)
        viewAtomsCache.set(cacheKey, {
          working: owner.atoms,
          overlay: xyz,
          sourceAtoms: view.atoms,
          gen: trajXyzEpoch,
          result
        })
        return result
      }
    }
    const structOverlay =
      sid && animCoordOverlayByStructure.has(sid)
        ? animCoordOverlayByStructure.get(sid)
        : sid === activeStructureId
          ? animCoordOverlay
          : null
    // Live gizmo preview only applies to the active structure
    const overlay =
      sid === activeStructureId && previewPositions ? previewPositions : (structOverlay ?? null)
    const working = owner?.atoms
    if (!working?.length && !overlay) return view.atoms

    // Shared ref + no overlay: returning view.atoms avoids cloning ~all atoms per view.
    if (!overlay && working === view.atoms) return view.atoms

    const cacheKey = view.id || ''
    const hit = cacheKey ? viewAtomsCache.get(cacheKey) : null
    if (
      hit &&
      hit.working === working &&
      hit.overlay === overlay &&
      hit.sourceAtoms === view.atoms &&
      hit.gen === coordsGeneration
    ) {
      return hit.result
    }

    /** @type {Map<number, { x: number, y: number, z: number }> | null} */
    let byIndex = null
    if (working?.length && working !== view.atoms) {
      byIndex = new Map()
      for (const a of working) {
        if (typeof a.index === 'number') byIndex.set(a.index, a)
      }
    }

    let anyChanged = false
    const result = new Array(view.atoms.length)
    for (let i = 0; i < view.atoms.length; i++) {
      const a = view.atoms[i]
      const src = typeof a.index === 'number' ? byIndex?.get(a.index) : undefined
      const pos = typeof a.index === 'number' ? overlay?.[a.index] : undefined
      if (!src && !pos) {
        result[i] = a
        continue
      }
      const x = pos ? pos[0] : src.x
      const y = pos ? pos[1] : src.y
      const z = pos ? pos[2] : src.z
      if (!pos && src && src.x === a.x && src.y === a.y && src.z === a.z) {
        result[i] = a
        continue
      }
      anyChanged = true
      result[i] = { ...a, x, y, z }
    }
    const out = anyChanged || overlay ? result : view.atoms
    if (cacheKey) {
      viewAtomsCache.set(cacheKey, {
        working,
        overlay,
        sourceAtoms: view.atoms,
        gen: coordsGeneration,
        result: out
      })
    }
    return out
  }

  /**
   * Resolve a cloned view on a target structure (selection string + style only).
   * Never reuses source atom indices.
   * @param {View} src
   * @param {import('../lib/visualizeStructures.js').StructureEntry} target
   * @returns {Promise<{ view: View | null, skip?: string }>}
   */
  async function resolveClonedViewOnTarget(src, target) {
    try {
      const clonedSel = effectiveViewSelection(src)
      const data = await getStructure({
        path: target.path,
        topology: target.topologyPath,
        selection: clonedSel,
        needs_bonds:
          src.representation?.type === 'ball-stick' || src.representation?.type === 'licorice',
        needs_secondary_structure:
          src.representation?.type === 'cartoon' || src.representation?.type === 'tube',
        save_dir: workingDir || null
      })
      if (!data?.atoms?.length) {
        return { view: null, skip: `${target.label}: "${clonedSel}" matched 0 atoms` }
      }
      const id = crypto.randomUUID()
      return {
        view: {
          ...src,
          id,
          structureId: target.id,
          componentKey: src.componentKey ?? componentKeyFromSelection(clonedSel),
          path: target.path,
          atoms: data.atoms,
          bonds: data.bonds ?? [],
          residues: data.residues,
          representation: { ...src.representation },
          colorScheme: { ...src.colorScheme },
          material: src.material ? { ...src.material } : { ...DEFAULT_VIEW_MATERIAL },
          ssColors: src.ssColors ? { ...src.ssColors } : null,
          visible: true
        }
      }
    } catch (ex) {
      return {
        view: null,
        skip: `${target.label}: ${ex instanceof Error ? ex.message : String(ex)}`
      }
    }
  }

  /**
   * Clone a representation onto other structures (append; does not replace).
   * @param {string} viewId
   * @param {string[]} targetStructureIds
   */
  async function applyViewToStructures(viewId, targetStructureIds) {
    const src = views.find((v) => v.id === viewId)
    if (!src || src._isSelHighlight) return
    const targets = targetStructureIds
      .map((tid) => findStructure(structures, tid))
      .filter((t) => t && t.id !== src.structureId)
    if (!targets.length) return

    applyRepsBusy = true
    applyRepsPhase = `Applying… 0 / ${targets.length}`
    const failed = []
    /** @type {View[]} */
    const created = []
    let done = 0
    try {
      await mapPool(targets, 4, async (target) => {
        const { view, skip } = await resolveClonedViewOnTarget(src, target)
        done += 1
        applyRepsPhase = `Applying… ${done} / ${targets.length}`
        if (view) created.push(view)
        else if (skip) failed.push(skip)
      })
      if (created.length) {
        views = [...views, ...created]
        if (animateMode) {
          for (const v of created) {
            registerViewTrack(animProject, v.id, [...views.map((x) => String(x.id))])
          }
          animProject = { ...animProject }
        }
        logEvent(
          'info',
          'view',
          `Applied representation to ${created.length} structure(s)`,
          src.selection
        )
      }
      if (failed.length) {
        alert(`Could not apply to:\n${failed.slice(0, 20).join('\n')}`)
      }
    } finally {
      applyRepsBusy = false
      applyRepsPhase = ''
    }
  }

  /**
   * Replace every other structure's representations with clones of this
   * structure's views (selection+style resolved per target).
   * @param {string} sourceStructureId
   */
  async function applyStructureRepsToAll(sourceStructureId) {
    const sourceViews = views.filter(
      (v) => v.structureId === sourceStructureId && !v._isSelHighlight
    )
    if (!sourceViews.length) {
      alert('This structure has no representations to apply.')
      return
    }
    const targets = structures.filter((s) => s.id !== sourceStructureId)
    if (!targets.length) {
      alert('No other structures in the workspace.')
      return
    }
    const ok = confirm(
      `Replace representations on ${targets.length} other structure(s) with the ${sourceViews.length} representation(s) from this structure?\n\nSelections that match no atoms on a target are skipped.`
    )
    if (!ok) return

    applyRepsBusy = true
    applyRepsPhase = `Applying… 0 / ${targets.length}`
    const skips = []
    /** @type {View[]} */
    const allNew = []
    let done = 0
    try {
      const results = await mapPool(targets, 3, async (target) => {
        /** @type {View[]} */
        const forTarget = []
        for (const src of sourceViews) {
          const { view, skip } = await resolveClonedViewOnTarget(src, target)
          if (view) forTarget.push(view)
          else if (skip) skips.push(skip)
        }
        done += 1
        applyRepsPhase = `Applying… ${done} / ${targets.length}`
        return { targetId: target.id, views: forTarget }
      })

      const byTarget = new Map(results.map((r) => [r.targetId, r.views]))
      const keep = views.filter(
        (v) =>
          v._isSelHighlight ||
          v.structureId === sourceStructureId ||
          !byTarget.has(v.structureId)
      )
      for (const [, tv] of byTarget) {
        allNew.push(...tv)
      }
      views = [...keep, ...allNew]

      if (animateMode) {
        for (const v of allNew) {
          registerViewTrack(animProject, v.id, views.map((x) => String(x.id)))
        }
        animProject = { ...animProject }
      }
      logEvent(
        'info',
        'view',
        `Applied ${sourceViews.length} representation(s) to ${targets.length} structure(s)`,
        `${allNew.length} view(s) created`
      )
      if (skips.length) {
        alert(
          `Some selections did not match (heterogeneous structures):\n${skips.slice(0, 24).join('\n')}${skips.length > 24 ? `\n…and ${skips.length - 24} more` : ''}`
        )
      }
    } finally {
      applyRepsBusy = false
      applyRepsPhase = ''
    }
  }

  /** Commit any live gizmo preview into the working structure (no-op if none). */
  function commitGizmoPreviewIfAny() {
    if (!previewPositions) return false
    const snapshot = { ...previewPositions }
    applyCoordOpResult({ positions: snapshot })
    _dragStartPositions = null
    return true
  }

  /** Views with overlay XYZ applied — used for picking while previewing / scrubbing. */
  function viewsForPicking() {
    const editStructureOnly = editMode && !measureMode && activeStructureId
    return views
      .filter(
        (v) =>
          v.visible !== false &&
          isOwnerStructureVisible(v) &&
          (!editStructureOnly || v.structureId === activeStructureId)
      )
      .map((v) => {
        const draw = viewDraw(v)
        return { ...v, atoms: draw.atoms, bonds: draw.bonds, residues: draw.residues, xyz: draw.xyz }
      })
  }

  /**
   * Normalize compute/preview API payload into sparse previewPositions.
   * @param {{ indices?: number[], xyz?: number[], positions?: number[][] }} r
   */
  function previewFromComputeResult(r) {
    const sparse = normalizeCoordPatch({ indices: r.indices, xyz: r.xyz })
    if (sparse) return coordPatchToPreviewArray(sparse)
    if (r.positions && structure?.atoms) return densePositionsToPreview(r.positions, structure.atoms)
    return null
  }

  /**
   * Convert the current interactive selection (yellow highlights) to an
   * MDAnalysis selection string suitable for the transform dialog.
   * Returns '' when there is no selection.
   */
  /** Svelte action: focus the element shortly after mount (avoids a11y_autofocus warning). */
  function focusOnMount(el) {
    setTimeout(() => el.focus(), 50)
  }

  function _selStringFromEditSelection() {
    if (!structure || selectedGroupIndices.size === 0) return ''
    const selAtoms = structure.atoms.filter((a) => selectedGroupIndices.has(a.index))
    if (editSelectionLevel === 'chain') {
      const chains = [...new Set(selAtoms.map((a) => a.chain_id))]
      return chains.map((c) => `chainID ${c}`).join(' or ')
    }
    if (editSelectionLevel === 'residue') {
      const pairMap = new Map()
      for (const a of selAtoms) {
        const key = `${a.chain_id}:${a.res_id}`
        if (!pairMap.has(key)) pairMap.set(key, { chain: a.chain_id, resid: a.res_id })
      }
      const pairs = [...pairMap.values()]
      if (pairs.length === 1) return `chainID ${pairs[0].chain} and resid ${pairs[0].resid}`
      return pairs.map((p) => `(chainID ${p.chain} and resid ${p.resid})`).join(' or ')
    }
    // atom or molecule: reliable 0-based index list
    const indices = [...selectedGroupIndices].sort((a, b) => a - b)
    return `index ${indices.join(' ')}`
  }

  // ── Transform Gizmo ─────────────────────────────────────────────────
  /** 3-D centroid of the current selection, using preview positions if available. */
  const gizmoCentroid = $derived.by(() => {
    if (!editMode || selectedGroupIndices.size === 0 || !structure) return null
    const atoms = structure.atoms.filter((a) => selectedGroupIndices.has(a.index))
    if (!atoms.length) return null
    const xyz = currentTrajXyz()
    let cx = 0,
      cy = 0,
      cz = 0
    for (const a of atoms) {
      const pos = previewPositions?.[a.index]
      const live = atomWithPackedXyz(a, xyz)
      cx += pos ? pos[0] : live.x
      cy += pos ? pos[1] : live.y
      cz += pos ? pos[2] : live.z
    }
    const n = atoms.length
    return { x: cx / n, y: cy / n, z: cz / n }
  })

  async function onGizmoTranslate({ axis, delta }) {
    if (!filePath || axis === 'view') return
    editBusy = true
    try {
      const sel = _selStringFromEditSelection() || null
      const op = {
        type: 'translate',
        dx: axis === 'x' ? delta : 0,
        dy: axis === 'y' ? delta : 0,
        dz: axis === 'z' ? delta : 0
      }
      const r = await transformCompute({ path: filePath, selection: sel, op })
      previewPositions = previewFromComputeResult(r)
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      editBusy = false
    }
  }

  async function onGizmoRotate({ axis, angle }) {
    if (!filePath) return
    editBusy = true
    try {
      const sel = _selStringFromEditSelection() || null
      const r = await transformCompute({
        path: filePath,
        selection: sel,
        op: { type: 'rotate', angle, axis, center: 'selection' }
      })
      previewPositions = previewFromComputeResult(r)
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      editBusy = false
    }
  }

  async function onGizmoApply() {
    if (!previewPositions) return
    applyCoordOpResult({ positions: previewPositions })
  }

  /** @type {{ type: string, [k: string]: any } | null} */
  let _gizmoLastOp = null
  /** Atom positions at the start of a drag gesture (for JS real-time preview). */
  let _dragStartPositions = null
  /** Ignore the canvas click that often follows a gizmo pointer-up. */
  let _ignoreCanvasClickUntil = 0
  /** Whether the transform gizmo overlay is shown (toggled via radial menu). */
  let showGizmo = $state(false)
  /** ID of the temporary ball-stick view added for cartoon/tube selections, or null. */
  let selHighlightViewId = $state(null)

  // Gizmo handlers – commit preview in memory on drag release (no temp PDB)
  async function _onGizmoTranslate({ axis, delta }) {
    if (axis === 'view') return
    // Before commit: block the canvas click that often follows pointer-up.
    _ignoreCanvasClickUntil = Date.now() + 400
    _gizmoLastOp = {
      type: 'translate',
      dx: axis === 'x' ? delta : 0,
      dy: axis === 'y' ? delta : 0,
      dz: axis === 'z' ? delta : 0
    }
    if (!commitGizmoPreviewIfAny()) return
    logEvent(
      'verbose',
      'view',
      `Gizmo translate (${axis})`,
      `Δ = ${delta.toFixed(2)} Å (in-memory)`
    )
  }

  async function _onGizmoRotate({ axis, angle }) {
    _ignoreCanvasClickUntil = Date.now() + 400
    _gizmoLastOp = { type: 'rotate', angle, axis, center: 'selection' }
    if (!commitGizmoPreviewIfAny()) return
    logEvent(
      'verbose',
      'view',
      `Gizmo rotate (${axis})`,
      `angle = ${angle.toFixed(1)}° (in-memory)`
    )
  }

  async function onGizmoUndo() {
    const inverse = coordUndoStack.pop()
    if (!inverse) return
    applyCoordOpResult({ patch: inverse, pushUndo: false })
    if (coordUndoStack.size === 0) {
      // May still differ from base if multiple ops — recompute dirty vs base
      ensureBaseAtomCoords(activeStructureId)
      coordsDirty = !!diffFromBase(baseAtomCoords, structure?.atoms ?? [])
    }
  }

  /**
   * Called every pointer-move during a drag: compute a JS-only position preview
   * so the atoms and gizmo update in real-time without backend round-trips.
   */
  function _onGizmoDragMove({ type, axis, delta = 0, angle = 0 }) {
    if (!structure || selectedGroupIndices.size === 0) return
    const selAtoms = structure.atoms.filter((a) => selectedGroupIndices.has(a.index))
    if (!selAtoms.length) return

    // Capture positions at the start of this drag gesture (base = before this drag)
    if (!_dragStartPositions) {
      _dragStartPositions = {}
      for (const a of selAtoms) {
        const prev = previewPositions?.[a.index]
        _dragStartPositions[a.index] = prev ? [...prev] : [a.x, a.y, a.z]
      }
    }
    const base = _dragStartPositions
    const newPos = /** @type {number[][]} */ ([])

    if (type === 'translate') {
      for (const a of selAtoms) {
        const [bx, by, bz] = base[a.index]
        newPos[a.index] = [
          bx + (axis === 'x' ? delta : 0),
          by + (axis === 'y' ? delta : 0),
          bz + (axis === 'z' ? delta : 0)
        ]
      }
    } else if (type === 'rotate') {
      // Centroid from base positions
      let cx = 0,
        cy = 0,
        cz = 0
      for (const a of selAtoms) {
        const [bx, by, bz] = base[a.index]
        cx += bx
        cy += by
        cz += bz
      }
      cx /= selAtoms.length
      cy /= selAtoms.length
      cz /= selAtoms.length
      const rad = angle * (Math.PI / 180)
      const cos = Math.cos(rad),
        sin = Math.sin(rad)
      for (const a of selAtoms) {
        const [bx, by, bz] = base[a.index]
        const dx = bx - cx,
          dy = by - cy,
          dz = bz - cz
        let nx, ny, nz
        if (axis === 'x') {
          nx = dx
          ny = dy * cos - dz * sin
          nz = dy * sin + dz * cos
        } else if (axis === 'y') {
          nx = dx * cos + dz * sin
          ny = dy
          nz = -dx * sin + dz * cos
        } else {
          nx = dx * cos - dy * sin
          ny = dx * sin + dy * cos
          nz = dz
        }
        newPos[a.index] = [cx + nx, cy + ny, cz + nz]
      }
    }
    previewPositions = newPos
  }

  /**
   * Enable DOF and lock focus on an atom (tracks while orbiting).
   * @param {{ x: number, y: number, z: number, name?: string }} atom
   */
  function focusDofOnAtom(atom) {
    if (!atom) return
    const live = atomWithPackedXyz(atom, currentTrajXyz())
    dofFocusAtomIndex = typeof atom.index === 'number' ? atom.index : null
    const cam = mainViewerCamera.current
    const dist = cam
      ? Math.max(
          0.5,
          Math.hypot(cam.position.x - live.x, cam.position.y - live.y, cam.position.z - live.z)
        )
      : (viewerSettings.dof?.focusDistance ?? 80)
    viewerSettings.dof = {
      ...(viewerSettings.dof ?? { enabled: false, focusDistance: 80, focusRange: 20, bokehScale: 2.5, focusTarget: null }),
      enabled: true,
      focusDistance: dist,
      focusTarget: { x: live.x, y: live.y, z: live.z }
    }
    mainViewerInvalidate.fn()
    logEvent('detail', 'view', 'DOF focus', atom.name ?? 'atom')
  }

  // ── Radial context menu helpers ──────────────────────────────────────
  /** Build radial menu items for the given atom context. */
  function _buildRadialItems(atom, ctxGroupIndices) {
    const hasEditSel = editMode && ctxGroupIndices && ctxGroupIndices.size > 0

    const items = []

    // Slot 0 – top: Center view (always)
    items.push({
      slot: 0,
      label: 'Center view',
      color: '#67e8f9',
      icon: '<path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0m0 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1m0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8m0 1a3 3 0 1 1 0 6 3 3 0 0 1 0-6m0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2"/>',
      action: () => {
        const atoms = atomsAtCurrentTraj(
          structure?.atoms.filter((a) =>
            hasEditSel ? ctxGroupIndices.has(a.index) : a.index === atom.index
          )
        )
        if (atoms?.length) {
          centerCameraOnAtoms(atoms)
          if (mainViewerControls.current) {
            let cx = 0,
              cy = 0,
              cz = 0
            for (const a of atoms) {
              cx += a.x
              cy += a.y
              cz += a.z
            }
            mainViewerControls.current.target.set(
              cx / atoms.length,
              cy / atoms.length,
              cz / atoms.length
            )
          }
        }
        ctxMenu = null
      }
    })

    if (hasEditSel) {
      // Slot 1 – top-right: Rename residue
      {
        items.push({
          slot: 1,
          label: 'Rename res.',
          color: '#fb923c',
          icon: '<path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.647a.5.5 0 0 0 0-.707zM4 6v1h1V6zM3 7H2v1h1zm-1 1H1v1h1zm7-7v1h1V1zM9 2H8v1h1zM8 3H7v1h1zM6 4H5v1h1zm-1 1H4v1h1zm-1 1H3v1h1zm-1 1H2v1h1zm-1 1H1v1h1zM1 8v1H0V8z"/><path d="M12.293 2.293a1 1 0 0 1 1.414 0l.5.5a1 1 0 0 1 0 1.414l-9.5 9.5A1 1 0 0 1 4 14H1a1 1 0 0 1-1-1v-3a1 1 0 0 1 .293-.707z"/>',
          action: () => {
            onEditModeRenameRes(atom)
            ctxMenu = null
          }
        })
      }

      // Slot 2 – right: Rename chain
      items.push({
        slot: 2,
        label: 'Rename chain',
        color: '#fb923c',
        icon: '<path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.647a.5.5 0 0 0 0-.707zM4 6v1h1V6zM3 7H2v1h1zm-1 1H1v1h1zm7-7v1h1V1zM9 2H8v1h1zM8 3H7v1h1zM6 4H5v1h1zm-1 1H4v1h1zm-1 1H3v1h1zm-1 1H2v1h1zm-1 1H1v1h1zM1 8v1H0V8z"/><path d="M12.293 2.293a1 1 0 0 1 1.414 0l.5.5a1 1 0 0 1 0 1.414l-9.5 9.5A1 1 0 0 1 4 14H1a1 1 0 0 1-1-1v-3a1 1 0 0 1 .293-.707z"/>',
        action: () => {
          onEditModeRenameChain(atom)
          ctxMenu = null
        }
      })

      // Slot 3 – bottom-right: Renumber residues
      {
        items.push({
          slot: 3,
          label: 'Renumber',
          color: '#facc15',
          icon: '<path d="M5 3a.5.5 0 0 1 .5.5V7H9a.5.5 0 0 1 0 1H5.5A.5.5 0 0 1 5 7.5v-4A.5.5 0 0 1 5.5 3zm5 0a.5.5 0 0 1 .5.5v1.5h1.5a.5.5 0 0 1 0 1H11v1.5a.5.5 0 0 1-1 0V6H8.5a.5.5 0 0 1 0-1H10V3.5A.5.5 0 0 1 10 3"/><path d="M0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm15 0a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1z"/>',
          action: () => {
            onEditModeRenumberRes(atom)
            ctxMenu = null
          }
        })
      }

      // Slot 4 – bottom: Delete selection (red)
      items.push({
        slot: 4,
        label: 'Delete',
        color: '#f87171',
        bgColor: 'rgba(60,20,20,0.96)',
        icon: '<path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/>',
        action: async () => {
          const indices = [...ctxGroupIndices]
          if (!confirm(`Delete ${indices.length} atom(s)?`)) return
          ctxMenu = null
          editBusy = true
          try {
            const res = await editDeleteByIndices({ path: filePath, indices })
            editHoverGroupIndices = new Set()
            editHoveredAtom = null
            await applyEditResult(res)
          } catch (ex) {
            alert(ex instanceof Error ? ex.message : String(ex))
          } finally {
            editBusy = false
          }
        }
      })

      // Slot 5 – bottom-left: Transform / Focus here
      items.push({
        slot: 5,
        label: 'Camera…',
        color: '#818cf8',
        icon: '<path d="M1.5 1a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4A1.5 1.5 0 0 1 1.5 0h4a.5.5 0 0 1 0 1h-4zM10 .5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 16 1.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5zM.5 10a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 0 14.5v-4a.5.5 0 0 1 .5-.5zm15 0a.5.5 0 0 1 .5.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5z"/><path d="M3 6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zm1 0v2h2V6zm5-1a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1zm0 1h2v2H9z"/>',
        submenu: [
          {
            text: 'Transform…',
            action: () => {
              ctxMenu = null
              previewPositions = null
              const selStr = _selStringFromEditSelection()
              if (selStr) {
                tfSel = selStr
                tfAlignPrimSel = selStr
              }
              dlgTransform?.showModal()
            }
          },
          {
            text: 'Focus here (DOF)',
            action: () => {
              focusDofOnAtom(atom)
              ctxMenu = null
            }
          }
        ]
      })
    }

    // Slot 6 – left: Add label (submenu with formats)
    items.push({
      slot: 6,
      label: 'Add label',
      color: '#a3a3a3',
      icon: '<path d="M0 2a2 2 0 0 1 2-2h11.5a.5.5 0 0 1 0 1H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h1.5v1.5a.5.5 0 0 1-.74.439L.819 13.14A2 2 0 0 1 0 11.306zm4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm1 0v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1"/>',
      submenu: atomLabelFormats(atom).map((fmt) => ({
        text: fmt,
        action: () => {
          addAtomLabel(atom, fmt)
          ctxMenu = null
        }
      }))
    })

    // Slot 7 – top-left: Move gizmo (edit selection) or Focus here (DOF)
    if (hasEditSel) {
      items.push({
        slot: 7,
        label: showGizmo ? 'Move (on)' : 'Move',
        color: showGizmo ? '#facc15' : '#94a3b8',
        bgColor: showGizmo ? 'rgba(60,50,0,0.96)' : undefined,
        icon: '<path d="M8 1L10.5 4.5L9 4.5L9 7L11.5 7L11.5 5.5L15 8L11.5 10.5L11.5 9L9 9L9 11.5L10.5 11.5L8 15L5.5 11.5L7 11.5L7 9L4.5 9L4.5 10.5L1 8L4.5 5.5L4.5 7L7 7L7 4.5L5.5 4.5Z"/>',
        action: () => {
          if (showGizmo) commitGizmoPreviewIfAny()
          showGizmo = !showGizmo
          ctxMenu = null
        }
      })
    } else {
      items.push({
        slot: 7,
        label: 'Focus here',
        color: viewerSettings.dof?.enabled ? '#facc15' : '#94a3b8',
        bgColor: viewerSettings.dof?.enabled ? 'rgba(60,50,0,0.96)' : undefined,
        icon: '<path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1m0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11m0 2.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6m0 1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3"/><path d="M8 0v2M8 14v2M0 8h2M14 8h2"/>',
        action: () => {
          focusDofOnAtom(atom)
          ctxMenu = null
        }
      })
    }

    return items
  }

  /**
   * When a selection exists and any visible view is cartoon/tube, add a temporary
   * ball-stick view for the selected atoms in the left panel.
   * Removes the previous one first.
   */
  function _syncSelHighlightView() {
    // Remove previous highlight view
    if (selHighlightViewId) {
      views = views.filter((v) => v.id !== selHighlightViewId)
      selHighlightViewId = null
    }
    if (!editMode || selectedGroupIndices.size === 0 || !structure) return

    // Only add when at least one visible view is cartoon or tube
    const hasCartoonOrTube = views.some(
      (v) =>
        v.visible &&
        v.structureId === activeStructureId &&
        (v.representation.type === 'cartoon' || v.representation.type === 'tube')
    )
    if (!hasCartoonOrTube) return

    const selAtoms = structure.atoms.filter((a) => selectedGroupIndices.has(a.index))
    if (!selAtoms.length) return

    // Filter bonds to only those connecting selected atoms
    const selSet = new Set(selAtoms.map((a) => a.index))
    const selBonds = (structure.bonds ?? []).filter(([a, b]) => selSet.has(a) && selSet.has(b))

    const id = crypto.randomUUID()
    selHighlightViewId = id
    views.push({
      id,
      _isSelHighlight: true,
      structureId: activeStructureId,
      selection: '',
      baseSelection: null,
      representation: { type: 'ball-stick' },
      path: filePath,
      atoms: selAtoms,
      bonds: selBonds,
      residues: null,
      visible: true,
      colorScheme: { name: 'cpk', resolver: cpkScheme() },
      helixWidth: 1.0,
      sheetWidth: 0.875,
      coilWidth: 0.125,
      ssColors: null,
      tubeRadius: 0.9,
      atomScale: 1.1,
      bondScale: 1.0,
      quality: 3,
      opacity: 1,
      surfaceInflate: 0.25,
      surfaceSource: 'atoms',
      surfaceSubdivision: 0,
      material: { ...DEFAULT_VIEW_MATERIAL, emissiveIntensity: 0.25 }
    })
  }

  function _buildTransformOp() {
    if (transformTab === 'rotate') {
      return { type: 'rotate', angle: tfRotAngle, axis: tfRotAxis, center: tfRotCenter }
    } else if (transformTab === 'translate') {
      return { type: 'translate', dx: tfTx, dy: tfTy, dz: tfTz }
    } else {
      return {
        type: 'align',
        targetAxis: tfAlignTargetAxis,
        secondarySelection: tfAlignSecSel.trim() || null,
        secondaryAxis: tfAlignSecAxis,
        applyTo: tfAlignApplyTo.trim() || null
      }
    }
  }

  function _buildTransformSel() {
    return transformTab === 'align' ? tfAlignPrimSel.trim() || null : tfSel.trim() || null
  }

  async function onTransformPreview() {
    if (!filePath) return
    tfPreviewBusy = true
    try {
      const r = await transformCompute({
        path: filePath,
        selection: _buildTransformSel(),
        op: _buildTransformOp()
      })
      previewPositions = previewFromComputeResult(r)
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      tfPreviewBusy = false
    }
  }

  async function onTransformApply() {
    if (!filePath) return
    editBusy = true
    try {
      let positions = previewPositions
      if (!positions) {
        const r = await transformCompute({
          path: filePath,
          selection: _buildTransformSel(),
          op: _buildTransformOp()
        })
        positions = previewFromComputeResult(r)
      }
      applyCoordOpResult({ positions })
      dlgTransform?.close()
      logEvent('info', 'view', 'Transform applied (in-memory)', _buildTransformOp().type)
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      editBusy = false
    }
  }

  async function onCenterAtOrigin() {
    if (!filePath) return
    editBusy = true
    try {
      const sel = tfSel.trim() || null
      const r = await transformCompute({
        path: filePath,
        selection: sel,
        op: { type: 'center' }
      })
      applyCoordOpResult({ positions: previewFromComputeResult(r) })
      dlgTransform?.close()
      logEvent('info', 'view', 'Centered at origin (in-memory)', sel ?? 'all')
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      editBusy = false
    }
  }

  function _boundsFromAtoms(atoms, padding = 0) {
    return boundsFromAtomsWithVdw(atoms, padding)
  }

  function _applyPackmolBoxBounds(min, max) {
    packmolBoxMin = { x: min[0], y: min[1], z: min[2] }
    packmolBoxMax = { x: max[0], y: max[1], z: max[2] }
  }

  function fitPackmolBoxToStructure() {
    if (!structure?.atoms?.length) return
    const b = _boundsFromAtoms(structure.atoms, packmolBoxPadding)
    if (b) {
      _applyPackmolBoxBounds(b.min, b.max)
      packmolVolume = null
    }
  }

  function fitPackmolBoxToSelection() {
    if (!structure) return
    if (selectedGroupIndices.size === 0) {
      packmolError =
        'No selection yet. Use Select in the bottom toolbar, click atoms in the viewer, then try Fit to selection again.'
      return
    }
    packmolError = ''
    const atoms = structure.atoms.filter((a) => selectedGroupIndices.has(a.index))
    const b = _boundsFromAtoms(atoms, packmolBoxPadding)
    if (b) {
      _applyPackmolBoxBounds(b.min, b.max)
      packmolVolume = null
    }
  }

  /** @param {number[]} min @param {number[]} max */
  function onPackmolBoxChange(min, max) {
    _applyPackmolBoxBounds(min, max)
  }

  function onPackmolBoxDragEnd() {
    packmolVolume = null
  }

  function closeMemproDialog() {
    memproDialogOpen = false
    visualizeStatus.openMemproDialog = false
  }

  function openMemproDialog() {
    toolsMenuOpen = false
    memproDialogOpen = true
  }

  function closePackmolDialog() {
    packmolDialogOpen = false
    visualizeStatus.openPackmolDialog = false
  }

  /** Parent directory of a file path (POSIX / Windows). */
  function parentOfFile(pathStr) {
    if (!pathStr) return ''
    const normalized = String(pathStr).replace(/\\/g, '/')
    const i = normalized.lastIndexOf('/')
    if (i <= 0) return pathStr
    return pathStr.slice(0, i)
  }

  function animStructureCtx() {
    return {
      path: filePath,
      atoms: structure?.atoms,
      bonds: structure?.bonds,
      residues: structure?.residues
    }
  }

  /** Cartoon / SS coloring for protein and peptide biopolymers. */
  function isBiopolymerSelection(sel) {
    return sel === 'protein' || sel === 'peptide'
  }

  /** Reload per-view atom subsets after animation load (split/custom selections). */
  async function refreshAnimationViewAtoms() {
    if (!structures.length) return
    let changed = false
    for (const view of views) {
      if (view._isSelHighlight) continue
      const owner = ownerStructure(view)
      const ownerPath = structureFetchPath(owner?.path || view.path, owner?.topologyPath)
      if (!ownerPath) continue
      const selection = effectiveViewSelection(view)
      const repr = view.representation?.type
      // "all" already shares the structure atom array — avoid a second full payload.
      if (selection === 'all' && owner?.atoms?.length) {
        if (view.atoms !== owner.atoms) {
          view.atoms = owner.atoms
          view.bonds = owner.bonds ?? view.bonds
          view.residues = owner.residues ?? view.residues
          changed = true
        }
        view._prefetched = true
        continue
      }
      const local = owner?.atoms?.length
        ? trySubsetBySelection(owner.atoms, owner.bonds, owner.residues, selection)
        : { ok: false, fallback: true }
      if (local.ok) {
        view.atoms = local.atoms
        view.bonds = local.bonds
        view.residues = local.residues
        view._prefetched = true
        changed = true
        continue
      }
      if (!local.fallback) continue
      try {
        const struc = await getStructure({
          path: ownerPath,
          topology: owner?.topologyPath ?? null,
          selection,
          needs_bonds: repr === 'ball-stick' || repr === 'licorice',
          needs_secondary_structure: repr === 'cartoon' || repr === 'tube'
        })
        if (!struc.atoms?.length) continue
        view.atoms = struc.atoms
        view.bonds = struc.bonds ?? view.bonds
        view.residues = struc.residues ?? view.residues
        view._prefetched = true
        changed = true
      } catch {
        /* keep existing atoms */
      }
    }
    if (changed) views = [...views]
  }

  function applyAnimFrame(time_s) {
    applyAnimationAtTime(animProject.keyframes, time_s, {
      getViews: () => views,
      setViews: (nextViews) => {
        views = /** @type {View[]} */ (nextViews)
      },
      structureCtx: animStructureCtx(),
      baseCoords: baseAtomCoords,
      applyFraming: (framing) => {
        if (!camera) return
        camera = {
          ...camera,
          center: { x: framing.center[0], y: framing.center[1], z: framing.center[2] },
          extent: framing.extent,
          framingZoom: framing.framingZoom
        }
      },
      applyViewport: (viewport) => {
        if (typeof viewport.axesVisible === 'boolean') axesVisible = viewport.axesVisible
        if (typeof viewport.axesLinesVisible === 'boolean') axesLinesVisible = viewport.axesLinesVisible
      },
      setLabels: (nextLabels) => {
        atomLabels = /** @type {typeof atomLabels} */ (nextLabels)
      },
      setMeasurements: (nextMeasurements) => {
        measurements = /** @type {typeof measurements} */ (nextMeasurements)
      },
      setCoordOverlay: (patch) => {
        // Mirror color/repr: once keyframes exist, timeline assert keyframe coords
        // and discard unsaved atom moves (capture stores them again on the next keyframe).
        previewPositions = null
        _dragStartPositions = null
        const { apply, signature } = shouldApplyCoordPatch(lastAnimCoordSig, patch ?? null)
        if (!apply) return
        lastAnimCoordSig = signature
        if (animProject.keyframes.length > 0 && structure?.atoms?.length && baseAtomCoords.size) {
          const atoms = atomsFromBaseAndPatch(structure.atoms, baseAtomCoords, patch ?? null)
          patchActiveStructure({ atoms })
          animCoordOverlay = null
          if (activeStructureId) animCoordOverlayByStructure.delete(activeStructureId)
          coordUndoStack.clear()
          coordsDirty = !!diffFromBase(baseAtomCoords, atoms)
        } else {
          animCoordOverlay = coordPatchToPreviewArray(patch)
          if (activeStructureId && animCoordOverlay) {
            animCoordOverlayByStructure.set(activeStructureId, animCoordOverlay)
          }
        }
      },
      setTrajFrame: (frame) => {
        trajSeekWaiter = seekTrajFrame(frame, {
          playing: animPlaying || trajPlaying || animExporting,
          persist: !animExporting,
          holdCache: animExporting
        })
      }
    }, animProject.viewTracks ?? [])
  }

  async function applyAnimFrameLive(time_s) {
    applyAnimFrame(time_s)
    await trajSeekWaiter
    await tick()
  }

  function stopAnimPlayback() {
    animPlaying = false
    if (animStopPlayback) {
      animStopPlayback()
      animStopPlayback = null
    }
  }

  function toggleAnimateMode() {
    toolsMenuOpen = false
    if (animateMode) {
      stopAnimPlayback()
      animateMode = false
      animCoordOverlay = null
      // Keep the same view objects. Cloning faded rows remounts ViewItem
      // effects and storms /get-structure (yellow spinners that never clear).
      // Do not force faded/hidden rows visible — that unhides representations
      // the user hid before or during the animation.
      restoreViewsAfterLeavingAnimate(views, animProject.keyframes, animPlayhead)
      lastAnimCoordSig = undefined
      coordsGeneration += 1
      return
    }
    if (!structure) return
    animateMode = true
    // Freeze base pose for sparse coord diffs when entering animate (if not dirty mid-edit,
    // keep load-time base; if dirty, base stays as original load so patches stay compact).
    ensureBaseAtomCoords(activeStructureId)
    if (!animProject.outputFolder && filePath) {
      animProject.outputFolder = defaultAnimationFolderName(filePath)
    }
    syncProjectViewTracks(animProject)
    repairForwardViewInheritance(animProject.keyframes, animProject.viewTracks ?? [])
    for (const v of views) {
      registerViewTrack(animProject, String(v.id), views.map((x) => String(x.id)))
    }
    animProject = {
      ...animProject,
      structure: { path: filePath ?? '', topology: topologyPath }
    }
  }

  /** Drop select-mode hover/selection UI so it cannot be baked into a keyframe. */
  function clearEphemeralEditSelection() {
    selectedAtom = null
    selectedGroupIndices = new Set()
    editHoveredAtom = null
    editHoverGroupIndices = new Set()
    editTooltip = null
    showGizmo = false
    if (selHighlightViewId) {
      views = views.filter((v) => v.id !== selHighlightViewId)
      selHighlightViewId = null
    }
  }

  async function onAnimCaptureKeyframe() {
    await tick()
    try {
      // Commit live gizmo preview so the keyframe stores the pose on screen.
      commitGizmoPreviewIfAny()
      // Select-tool hover/outline/temp ball-stick must never enter the keyframe.
      clearEphemeralEditSelection()
      await tick()
      const persistViews = views.filter((v) => !v._isSelHighlight)
      const snap = captureViewerSnapshot({
        views: persistViews,
        filePath,
        structure,
        getFraming: () => camera,
        getViewport: () => ({ axesVisible, axesLinesVisible }),
        getLabels: () => atomLabels,
        getMeasurements: () => measurements
      })
      const time_s = Math.max(0, Math.min(animProject.duration_s, animPlayhead))
      const existing = animProject.keyframes.find((k) => Math.abs(k.time_s - time_s) < 0.05)
      ensureBaseAtomCoords(activeStructureId)
      const coordPatch = diffFromBase(baseAtomCoords, structure?.atoms ?? [])
      const prevKf = previousKeyframeAtTime(animProject.keyframes, time_s, existing?.id ?? null)
      const capturedEasing = easingForCapturedKeyframe({
        hasTrajectory: !!trajStructure,
        hasPrevious: !!prevKf,
        prevCamera: prevKf?.camera ?? null,
        nextCamera: snap.camera
      })
      const keyframe = existing
        ? {
            ...existing,
            camera: snap.camera,
            views: snap.views,
            scene: snap.scene,
            viewport: snap.viewport,
            labels: snap.labels,
            measurements: snap.measurements,
            ...(coordPatch ? { coordPatch } : { coordPatch: undefined }),
            ...(trajStructure
              ? { trajFrame: trajPlayhead }
              : {}),
            ...(capturedEasing
              ? { easing: capturedEasing, easingBezier: undefined }
              : {})
          }
        : {
            id: crypto.randomUUID(),
            name: `Keyframe ${animProject.keyframes.length + 1}`,
            time_s,
            camera: snap.camera,
            views: snap.views,
            scene: snap.scene,
            viewport: snap.viewport,
            labels: snap.labels,
            measurements: snap.measurements,
            ...(coordPatch ? { coordPatch } : {}),
            ...(trajStructure ? { trajFrame: trajPlayhead } : {}),
            ...(capturedEasing
              ? { easing: capturedEasing, easingBezier: undefined }
              : {})
          }
      if (!coordPatch) delete keyframe.coordPatch
      const persistIds = persistViews.map((x) => String(x.id))
      for (const v of persistViews) {
        registerViewTrack(animProject, String(v.id), persistIds)
      }
      animProject = {
        ...animProject,
        keyframes: existing
          ? animProject.keyframes.map((k) => (k.id === existing.id ? keyframe : k))
          : [...animProject.keyframes, keyframe]
      }
      sortKeyframes(animProject)
      propagateNewViewsToLaterKeyframes(
        animProject.keyframes,
        keyframe.id,
        animProject.viewTracks ?? []
      )
      syncProjectViewTracks(animProject)
      animProject = { ...animProject }
      await applyAnimFrameLive(animPlayhead)
      logEvent('info', 'view', 'Captured animation keyframe', keyframe.name)
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    }
  }

  function onAnimGoToKeyframe(id) {
    const kf = animProject.keyframes.find((k) => k.id === id)
    if (!kf) return
    animPlayhead = kf.time_s
    void applyAnimFrameLive(kf.time_s)
  }

  function onAnimDeleteKeyframe(id) {
    animProject = {
      ...animProject,
      keyframes: animProject.keyframes.filter((k) => k.id !== id)
    }
  }

  function onAnimClearKeyframes() {
    if (!animProject.keyframes.length) return
    stopAnimPlayback()
    lastAnimCoordSig = undefined
    animProject = { ...animProject, keyframes: [] }
    logEvent('info', 'view', 'Cleared animation keyframes', 'Duration and FPS stayed. Capture to start over.')
  }

  /** @param {string} id @param {string} name */
  function onAnimRenameKeyframe(id, name) {
    animProject = {
      ...animProject,
      keyframes: animProject.keyframes.map((k) => (k.id === id ? { ...k, name } : k))
    }
  }

  /** @param {string} id */
  function onAnimDuplicateKeyframe(id) {
    const src = animProject.keyframes.find((k) => k.id === id)
    if (!src) return
    let time_s = Math.min(animProject.duration_s, src.time_s + 0.25)
    const taken = new Set(animProject.keyframes.map((k) => k.time_s.toFixed(3)))
    while (taken.has(time_s.toFixed(3)) && time_s < animProject.duration_s) {
      time_s = Math.min(animProject.duration_s, time_s + 0.05)
    }
    const dup = JSON.parse(JSON.stringify(src))
    dup.id = crypto.randomUUID()
    dup.name = `${src.name || 'Keyframe'} copy`
    dup.time_s = time_s
    animProject = {
      ...animProject,
      keyframes: [...animProject.keyframes, dup]
    }
    sortKeyframes(animProject)
    propagateNewViewsToLaterKeyframes(
      animProject.keyframes,
      dup.id,
      animProject.viewTracks ?? []
    )
    animProject = { ...animProject }
    animPlayhead = time_s
    applyAnimFrame(time_s)
    logEvent('info', 'view', 'Duplicated keyframe', dup.name)
  }

  function onAnimMoveKeyframe(id, time_s) {
    onAnimKeyframeTimeChange(id, time_s)
  }

  /**
   * @param {string} toKeyframeId
   * @param {{ easing: import('../lib/animation/easing.js').AnimationEasingKind, easingBezier?: [number, number, number, number] }} next
   */
  function onAnimEasingChange(toKeyframeId, next) {
    animProject = {
      ...animProject,
      keyframes: animProject.keyframes.map((k) =>
        k.id === toKeyframeId
          ? {
              ...k,
              easing: next.easing,
              easingBezier: next.easing === 'bezier' ? next.easingBezier : undefined
            }
          : k
      )
    }
    applyAnimFrame(animPlayhead)
  }

  function onAnimKeyframeTimeChange(id, time_s) {
    const t = Math.max(0, Math.min(animProject.duration_s, time_s))
    animProject = {
      ...animProject,
      keyframes: animProject.keyframes.map((k) => (k.id === id ? { ...k, time_s: t } : k))
    }
    sortKeyframes(animProject)
    animProject = { ...animProject }
    animPlayhead = t
    applyAnimFrame(t)
  }

  function onAnimPlayheadChange(time_s) {
    onAnimScrub(Math.max(0, Math.min(animProject.duration_s, time_s)))
  }

  function onAnimScrub(time_s) {
    stopAnimPlayback()
    animPlayhead = Math.max(0, Math.min(animProject.duration_s, time_s))
    if (animProject.keyframes.length) applyAnimFrame(animPlayhead)
  }

  function toggleAnimPlayPause() {
    if (animPlaying) {
      stopAnimPlayback()
      return
    }
    if (!animProject.keyframes.length) return
    animPlaying = true
    animStopPlayback = startPlayback({
      keyframes: animProject.keyframes,
      duration_s: animProject.duration_s,
      fps: animProject.fps,
      getPlayhead: () => animPlayhead,
      setPlayhead: (t) => {
        animPlayhead = t
      },
      isPlaying: () => animPlaying,
      setPlaying: (v) => {
        animPlaying = v
      },
      onFrame: applyAnimFrame,
      onDone: () => {
        animStopPlayback = null
      }
    })
  }

  function onAnimStop() {
    stopAnimPlayback()
    animPlayhead = 0
    if (animProject.keyframes.length) applyAnimFrame(0)
  }

  function resolveAnimationOutputBase() {
    const folder =
      animProject.outputFolder?.trim() || defaultAnimationFolderName(filePath || '') || 'animation'
    if (workingDir) {
      const joined = outputFolderPath(workingDir, folder)
      if (joined) return joined
    }
    const parent = parentOfFile(filePath || '')
    if (!parent) {
      throw new Error('No output location: set a working directory or load a structure file')
    }
    return `${parent.replace(/[/\\]+$/, '')}/${folder}`
  }

  async function confirmAnimationOutputOverwrite(base) {
    const info = await window.api.animationInspectOutputDir(base)
    if (!info?.exists) return true
    if (!info.hasAnimationJson && !info.frameCount && !info.hasVideo) return true
    const parts = []
    if (info.hasAnimationJson) parts.push('animation.json')
    if (info.frameCount > 0) parts.push(`${info.frameCount} rendered frame(s)`)
    if (info.encodedFiles?.length) {
      parts.push(...info.encodedFiles)
    } else if (info.hasVideo) {
      parts.push('encoded animation file(s)')
    }
    return confirm(
      `This output folder already contains animation data:\n\n${base}\n\nFound: ${parts.join(', ')}\n\nContinue and overwrite existing files?`
    )
  }

  async function prepareAnimationOutputDir() {
    const requested = resolveAnimationOutputBase()
    if (!(await confirmAnimationOutputOverwrite(requested))) {
      throw new Error('Export cancelled — output folder not overwritten')
    }
    const created = await window.api.animationEnsureDir(requested)
    return typeof created === 'string' && created.trim() ? created : requested
  }

  async function onAnimSaveProject() {
    if (!confirmProceedWithoutWorkingDir('animation')) return
    try {
      const base = await prepareAnimationOutputDir()
      const path = `${base}/animation.json`
      await window.api.writeJson(
        path,
        serializeAnimationProject(
          {
            ...animProject,
            structures: structuresMetaForSave(),
            visibilityGroups: visibilityGroupsForSave()
          },
          {
            path: filePath ?? '',
            topology: topologyPath
          }
        )
      )
      logEvent('info', 'view', 'Saved animation project', path)
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    }
  }

  async function onAnimLoadProject() {
    const dlg = await window.api.openFileDialog(
      'Open animation project',
      [{ name: 'GateWizard animation', extensions: ['json'] }],
      workingDir || parentOfFile(filePath || '') || undefined
    )
    if (!dlg || dlg.canceled || !dlg.filePath) return
    sceneRestoring = true
    sceneRestoringPhase = 'Opening animation…'
    sceneRestoringDetail = ''
    sceneRestoringCurrent = 0
    sceneRestoringTotal = 0
    startOverlayElapsed()
    try {
      const data = await window.api.readJson(dlg.filePath)
      const project = normalizeProject(data)
      // Animation projects are tied to a specific structure. Load it automatically
      // (including its topology) so a project can be opened standalone without
      // requiring a PDB to already be loaded — matching the "all-in-one" load a user
      // expects from a saved animation file.
      const metas =
        Array.isArray(project.structures) && project.structures.length
          ? project.structures
          : project.structure?.path
            ? [project.structure]
            : []
      const sameSingle =
        metas.length === 1 &&
        structures.length === 1 &&
        structures[0].path === metas[0].path
      if (metas.length && !sameSingle) {
        reportStructureLoadProgress(0, metas.length, '')
        await loadStructuresFromMeta(metas, { onProgress: reportStructureLoadProgress })
        if (!structure) return
      }
      sceneRestoringCurrent = 0
      sceneRestoringTotal = 0
      sceneRestoringDetail = ''
      animProject = project
      syncProjectViewTracks(animProject)
      repairForwardViewInheritance(animProject.keyframes, animProject.viewTracks ?? [])
      // Drop any pre-existing representations (e.g. the default "all" view created on
      // PDB load) that aren't part of the loaded animation — otherwise they linger
      // forever as permanently-hidden phantom rows in the panel.
      const animatedTrackIds = new Set([
        ...(animProject.viewTracks ?? []),
        ...deriveViewTracks(animProject.keyframes)
      ])
      views = views.filter((v) => animatedTrackIds.has(String(v.id)))
      restoreVisibilityGroups(project.visibilityGroups)
      animPlayhead = 0
      if (animProject.keyframes.length) {
        sceneRestoringPhase = 'Restoring representations…'
        applyAnimFrame(0)
        await refreshAnimationViewAtoms()
        applyAnimFrame(animPlayhead)
      }
      animateMode = true
      sceneRestoringPhase = 'Finishing materials…'
      await waitForViewerIdle({ idleFrames: 4, timeoutMs: 20000, settleMs: 80 })
      logEvent('info', 'view', 'Loaded animation project', dlg.filePath)
    } catch (ex) {
      if (ex instanceof Error && ex.message.includes('cancelled')) return
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      clearSceneRestoreUi()
    }
  }

  function throwIfAnimExportCancelled() {
    if (animExportCancelRequested) {
      throw new Error('cancelled')
    }
  }

  function cancelAnimExport() {
    if (!animExporting) return
    animExportCancelRequested = true
    animExportPhase = 'Cancelling…'
    void window.api.animationCancelEncode?.()
  }

  async function onAnimExportVideo() {
    if (!animProject.keyframes.length) return
    if (!confirmProceedWithoutWorkingDir('animation')) return
    let requested
    try {
      requested = resolveAnimationOutputBase()
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
      return
    }
    if (!(await confirmAnimationOutputOverwrite(requested))) return
    const fps = animProject.fps > 0 ? animProject.fps : 30
    const duration = Number(animProject.duration_s)
    const frameCount = Math.max(
      1,
      Math.ceil((Number.isFinite(duration) ? duration : 0) * fps) || 1
    )
    animExportCancelRequested = false
    animExporting = true
    animExportPhase = 'Creating output folder…'
    animExportFrame = 0
    animExportTotal = frameCount
    const savedPlayhead = animPlayhead
    stopAnimPlayback()
    try {
      await tick()
      throwIfAnimExportCancelled()
      const created = await window.api.animationEnsureDir(requested)
      const base = typeof created === 'string' && created.trim() ? created : requested
      throwIfAnimExportCancelled()
      const framesDir = `${base}/frames`
      const exportFrame = animProject.exportFrame ?? {
        aspectPreset: '16:9',
        width: 1920,
        height: 1080,
        showGuide: true,
        exportFormat: 'mp4'
      }
      const exportFormat = exportFrame.exportFormat ?? 'mp4'
      const formatMeta = exportFormatMeta(exportFormat)
      const encodedFileName = animationOutputFileName(exportFormat)
      const encodedOutputPath = encodedFileName ? `${base}/${encodedFileName}` : ''
      const canvas = viewerEl?.querySelector('canvas')
      if (!canvas) throw new Error('Viewer canvas is not ready — wait for the structure to appear, then export again.')
      for (let i = 0; i < frameCount; i++) {
        throwIfAnimExportCancelled()
        const t = Math.min(animProject.duration_s, i / fps)
        animPlayhead = t
        animExportFrame = i + 1
        animExportPhase = `Rendering frame ${i + 1} of ${frameCount}…`
        await tick()
        throwIfAnimExportCancelled()
        applyAnimFrame(t)
        await trajSeekWaiter
        throwIfAnimExportCancelled()
        await renderFrame(() => mainViewerInvalidate.fn())
        await tick()
        throwIfAnimExportCancelled()
        const sourceRect = computeSafeAreaForCanvas(
          /** @type {HTMLCanvasElement} */ (canvas),
          exportFrame.width,
          exportFrame.height
        )
        const png = await captureCanvasWithOverlayPng(/** @type {HTMLCanvasElement} */ (canvas), {
          sourceRect,
          outputWidth: exportFrame.width,
          outputHeight: exportFrame.height,
          displayW: canvasWidth,
          displayH: canvasHeight,
          camera: mainViewerCamera.current,
          measurements: liveMeasurements,
          atomLabels: liveAtomLabels
        })
        throwIfAnimExportCancelled()
        await window.api.writeBinary(`${framesDir}/${frameFileName(i)}`, png)
      }
      throwIfAnimExportCancelled()
      if (exportFormat === 'png') {
        logEvent('info', 'view', 'Exported animation frames', framesDir)
        animExportPhase = 'Done'
        alert(`PNG frames saved to:\n${framesDir}`)
      } else {
        const ffmpeg = await window.api.animationCheckFfmpeg()
        throwIfAnimExportCancelled()
        if (ffmpeg.available && encodedOutputPath) {
          animExportPhase = `Encoding ${formatMeta?.label ?? exportFormat} with FFmpeg…`
          animExportFrame = frameCount
          await tick()
          throwIfAnimExportCancelled()
          const enc = await window.api.animationEncodeVideo({
            framesDir,
            outputPath: encodedOutputPath,
            fps,
            format: exportFormat
          })
          if (animExportCancelRequested || enc?.cancelled) {
            throw new Error('cancelled')
          }
          if (!enc?.ok) {
            throw new Error(enc?.error || 'FFmpeg failed to encode animation')
          }
          logEvent('info', 'view', 'Exported animation', encodedOutputPath)
          animExportPhase = 'Done'
          alert(`Animation saved to:\n${encodedOutputPath}`)
        } else {
          logEvent('info', 'view', 'Exported animation frames (no ffmpeg)', framesDir)
          animExportPhase = 'Done (frames only)'
          alert(
            `FFmpeg was not found in the GateWizard runtime (or on PATH).\n\nPNG frames were saved to:\n${framesDir}\n\nRestart the app to finish runtime setup, or install FFmpeg, then retry encoding ${formatMeta?.label ?? exportFormat.toUpperCase()}.`
          )
        }
      }
      throwIfAnimExportCancelled()
      animExportPhase = 'Saving project…'
      await tick()
      await window.api.writeJson(
        `${base}/animation.json`,
        serializeAnimationProject(
          {
            ...animProject,
            structures: structuresMetaForSave(),
            visibilityGroups: visibilityGroupsForSave()
          },
          {
            path: filePath ?? '',
            topology: topologyPath
          }
        )
      )
    } catch (ex) {
      if (ex instanceof Error && ex.message.includes('cancelled')) {
        logEvent('info', 'view', 'Animation export cancelled')
        return
      }
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      animExportCancelRequested = false
      animExporting = false
      animExportPhase = ''
      animExportFrame = 0
      animExportTotal = 0
      animPlayhead = savedPlayhead
      if (animProject.keyframes.length) applyAnimFrame(savedPlayhead)
    }
  }

  /**
   * Ask before running when the top-bar working directory is unset.
   * @param {'mempro' | 'packmol' | 'animation'} kind
   */
  function confirmProceedWithoutWorkingDir(kind) {
    if (workingDir) return true
    const detail =
      kind === 'mempro'
        ? 'MemPro job state will not be saved to disk and results may be lost if the app restarts.'
        : kind === 'packmol'
          ? 'Packmol output will be written next to the input PDB instead of under a project working directory.'
          : 'Animation projects and exports will be written next to the loaded structure file instead of under a project working directory.'
    return confirm(
      `No working directory is set.\n\n${detail}\n\nDo you want to proceed anyway?`
    )
  }

  async function openPackmolDialog() {
    toolsMenuOpen = false
    packmolError = ''
    packmolLog = ''
    if (filePath) packmolOutputFolder = defaultHydrationFolderName(filePath)
    packmolBusy = true
    try {
      packmolAvailable = await packmolCheck()
    } catch (ex) {
      packmolAvailable = { available: false }
      packmolError = ex instanceof Error ? ex.message : String(ex)
    } finally {
      packmolBusy = false
    }
    if (structure?.atoms?.length && !packmolBoxValid) fitPackmolBoxToStructure()
    packmolDialogOpen = true
    refreshPackmolJobs()
  }

  async function refreshPackmolJobs() {
    if (!workingDir) {
      packmolJobs = []
      return
    }
    try {
      const { jobs } = await packmolScanJobs({ workingDir })
      packmolJobs = jobs ?? []
    } catch {
      /* ignore scan errors; history is best-effort */
    }
  }

  /** @param {string} outputPdb */
  async function onPackmolLoadJob(outputPdb) {
    if (!outputPdb) return
    await loadStructure(outputPdb)
    closePackmolDialog()
    logEvent('info', 'view', 'Loaded hydration output', outputPdb)
  }

  async function onPackmolCalculateVolume() {
    if (!filePath || !packmolBoxValid) return
    packmolBusy = true
    packmolError = ''
    try {
      const r = await packmolEstimateVolume({
        path: filePath,
        boxMin: packmolBoxMinArr,
        boxMax: packmolBoxMaxArr,
        soluteRadius: packmolSoluteRadius,
        exclusionMode: packmolExclusionMode || null
      })
      packmolVolume = r
      packmolHydrogenStatus = r.hydrogen_status ?? ''
      packmolExclusionMode = r.exclusion_mode ?? ''
      packmolNWaters = r.suggested_waters ?? 0
      packmolVolumeBox = {
        min: [...packmolBoxMinArr],
        max: [...packmolBoxMaxArr]
      }
      logEvent(
        'info',
        'view',
        'Packmol volume calculated',
        `${r.suggested_waters} waters suggested`
      )
    } catch (ex) {
      packmolError = ex instanceof Error ? ex.message : String(ex)
    } finally {
      packmolBusy = false
    }
  }

  async function onPackmolHydrate() {
    if (!filePath || !packmolBoxValid) return
    if (!packmolAvailable?.available) return
    if (!confirmProceedWithoutWorkingDir('packmol')) return
    const outBase = workingDir || parentOfFile(filePath)
    if (!outBase) return
    if (!packmolBoxMatchesVolume) {
      const msg = packmolVolumeBox
        ? 'The hydration box changed since volume was last calculated. Recalculate volume for an updated water count.\n\nFill with water anyway?'
        : 'Cavity volume has not been calculated for the current box.\n\nFill with water anyway?'
      if (!confirm(msg)) return
    }
    const nWaters = packmolNWaters > 0 ? packmolNWaters : packmolVolume?.suggested_waters ?? 0
    if (nWaters < 1) return
    packmolBusy = true
    packmolError = ''
    visualizeStatus.packmolStatus = 'running'
    visualizeStatus.packmolStartedAt = new Date().toISOString()
    try {
      const r = await packmolHydrateCavity({
        path: filePath,
        workingDir: outBase,
        outputFolderName: packmolOutputFolder || defaultHydrationFolderName(filePath),
        boxMin: packmolBoxMinArr,
        boxMax: packmolBoxMaxArr,
        nWaters,
        soluteRadius: packmolSoluteRadius,
        exclusionMode: packmolExclusionMode || null,
        tolerance: packmolTolerance,
        nloop: packmolNloop
      })
      packmolResultPath = r.output_pdb ?? ''
      packmolLog = r.packmol_log ?? ''
      if (r.success) {
        visualizeStatus.packmolStatus = 'done'
        visualizeStatus.packmolMessage = r.message ?? 'Hydration complete'
        logEvent('info', 'view', 'Packmol hydration complete', packmolResultPath)
      } else {
        visualizeStatus.packmolStatus = 'error'
        visualizeStatus.packmolMessage = r.message ?? 'PACKMOL failed'
        packmolError = r.message ?? 'PACKMOL failed'
      }
    } catch (ex) {
      visualizeStatus.packmolStatus = 'error'
      visualizeStatus.packmolMessage = ex instanceof Error ? ex.message : String(ex)
      packmolError = visualizeStatus.packmolMessage
    } finally {
      packmolBusy = false
      refreshPackmolJobs()
    }
  }

  async function onPackmolLoadResult() {
    if (!packmolResultPath) return
    await loadStructure(packmolResultPath)
    closePackmolDialog()
    logEvent('info', 'view', 'Loaded hydrated PDB', packmolResultPath)
  }

  async function onPackmolPreviewCustomInp() {
    if (!filePath || !packmolBoxValid || packmolPreviewBusy) return
    const nWaters = Math.max(1, packmolNWaters || packmolVolume?.suggested_waters || 1)
    packmolPreviewBusy = true
    packmolError = ''
    try {
      const r = await packmolPreviewInp({
        path: filePath,
        workingDir: workingDir || null,
        boxMin: packmolBoxMinArr,
        boxMax: packmolBoxMaxArr,
        nWaters,
        soluteRadius: packmolSoluteRadius,
        tolerance: packmolTolerance,
        nloop: packmolNloop
      })
      packmolCustomInp = r.inp_text ?? ''
    } catch (ex) {
      packmolError = ex instanceof Error ? ex.message : String(ex)
    } finally {
      packmolPreviewBusy = false
    }
  }

  async function onPackmolRunCustom() {
    if (!packmolCustomInp.trim()) return
    if (!packmolAvailable?.available) return
    if (!confirmProceedWithoutWorkingDir('packmol')) return
    const outBase = workingDir || parentOfFile(filePath)
    if (!outBase) return
    packmolBusy = true
    packmolError = ''
    visualizeStatus.packmolStatus = 'running'
    visualizeStatus.packmolStartedAt = new Date().toISOString()
    try {
      const r = await packmolRunCustom({
        inpText: packmolCustomInp,
        workingDir: outBase,
        outputFolderName:
          packmolOutputFolder || defaultHydrationFolderName(filePath) || 'hydration_custom',
        path: filePath || null
      })
      packmolLog = r.packmol_log ?? ''
      packmolResultPath = r.output_pdb ?? ''
      if (r.success) {
        visualizeStatus.packmolStatus = 'done'
        visualizeStatus.packmolMessage = r.message ?? 'Custom PACKMOL complete'
      } else {
        visualizeStatus.packmolStatus = 'error'
        packmolError = r.message ?? 'PACKMOL failed'
      }
    } catch (ex) {
      visualizeStatus.packmolStatus = 'error'
      packmolError = ex instanceof Error ? ex.message : String(ex)
    } finally {
      packmolBusy = false
      refreshPackmolJobs()
    }
  }

  async function onMemproRun() {
    if (!filePath) return
    if (!confirmProceedWithoutWorkingDir('mempro')) return
    memproBusy = true
    try {
      const r = await memproRun({
        path: filePath,
        workingDir: workingDir || undefined,
        nIters: memproNIters,
        gridSize: memproGridSize,
        dualMembrane: memproDualMembrane,
        peripheral: memproPeripheral,
        useWeights: memproUseWeights,
        flip: memproFlip,
        membraneThickness: memproMembrane ? parseFloat(memproMembrane) : null
      })
      memproJobId = r.job_id
      memproJobStatus = 'running'
      memproResults = []
      memproError = null
      visualizeStatus.memproJobId = r.job_id
      visualizeStatus.memproStatus = 'running'
      visualizeStatus.memproStartedAt = r.start_time ?? new Date().toISOString()
      logEvent('info', 'view', 'MemPro started', filePath)
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      memproBusy = false
    }
  }

  async function onMemproApply(result) {
    if (!filePath) return
    editBusy = true
    try {
      const res = await memproApply({
        sourcePath: filePath,
        pdbPath: result.pdb_path
      })
      closeMemproDialog()
      await applyEditResult(res)
      logEvent(
        'info',
        'view',
        `Applied MemPro orientation rank ${result.rank}`,
        filePath
      )
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      editBusy = false
    }
  }

  /**
   * Chain ids on a loaded structure. Protein chains are the standard amino acids.
   * @param {import('../lib/visualizeStructures.js').StructureEntry | null | undefined} entry
   * @param {boolean} proteinOnly
   */
  function chainIdsOf(entry, proteinOnly) {
    /** @type {string[]} */
    const ids = []
    const seen = new Set()
    for (const atom of entry?.atoms || []) {
      if (proteinOnly && !PROTEIN_RESIDUES.has(String(atom.res_name || '').toUpperCase())) continue
      const id = String(atom.chain_id ?? '').trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      ids.push(id)
    }
    return ids
  }

  /** @param {import('../lib/visualizeStructures.js').StructureEntry | null | undefined} entry */
  function defaultProteinChain(entry) {
    return chainIdsOf(entry, true)[0] || chainIdsOf(entry, false)[0] || ''
  }

  /**
   * PDB the mutator and superposition tools can read.
   * A clean PDB is used as-is. A trajectory or unsaved edit is written to a temp PDB
   * (frame 0 for a movie).
   * @param {import('../lib/visualizeStructures.js').StructureEntry} entry
   */
  async function materializeEntryPdb(entry) {
    if (!entry?.path) throw new Error('No structure is loaded')
    const dirty = entry.id === activeStructureId && coordsDirty
    const traj = !!entry.trajectory
    const isPdb = /\.(pdb|ent)$/i.test(String(entry.path))
    if (isPdb && !dirty && !traj) return entry.path
    const scratch = await structureScratchPdb({
      path: entry.path,
      topology: entry.topologyPath || null
    })
    if (!dirty) return scratch.path
    /** @type {number[]} */
    const indices = []
    /** @type {number[]} */
    const xyz = []
    for (const atom of entry.atoms || []) {
      if (typeof atom.index !== 'number') continue
      indices.push(atom.index)
      xyz.push(atom.x, atom.y, atom.z)
    }
    if (!indices.length) return scratch.path
    await structureWriteCoords({
      source: scratch.path,
      dest: scratch.path,
      indices,
      xyz,
      topology: null
    })
    return scratch.path
  }

  function clearMutPreview() {
    mutPreviewAtoms = []
    mutPreviewBonds = []
  }

  /** @param {{ atoms?: Array<{ name: string, element: string, x: number, y: number, z: number }> } | null | undefined} rotamer */
  function setMutPreview(rotamer) {
    const atoms = (rotamer?.atoms || []).map((atom, index) => ({
      index,
      name: atom.name,
      element: atom.element,
      x: atom.x,
      y: atom.y,
      z: atom.z
    }))
    /** @type {number[][]} */
    const bonds = []
    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        const dx = atoms[i].x - atoms[j].x
        const dy = atoms[i].y - atoms[j].y
        const dz = atoms[i].z - atoms[j].z
        const dist2 = dx * dx + dy * dy + dz * dz
        const cut = atoms[i].element === 'S' && atoms[j].element === 'S' ? 2.15 : 1.95
        if (dist2 > 0.16 && dist2 < cut * cut) bonds.push([i, j])
      }
    }
    mutPreviewAtoms = atoms
    mutPreviewBonds = bonds
  }

  function closeMutateDialog() {
    mutateOpen = false
    clearMutPreview()
  }

  /** @type {string | null} */
  let mutateFocusViewId = null
  /** @type {ReturnType<typeof setTimeout> | 0} */
  let mutateFocusTimer = 0

  /** Atoms of the residue currently chosen in the mutator. */
  function mutateResidueAtoms() {
    const chain = String(mutateChain || '').trim()
    const resid = Number(mutateResid)
    if (!structure?.atoms?.length || !chain || !Number.isFinite(resid)) return []
    return structure.atoms.filter(
      (atom) => String(atom.chain_id || '').trim() === chain && Number(atom.res_id) === resid
    )
  }

  /**
   * One ball-and-stick of the chosen residue, reused when the resid changes.
   * @param {string} selection
   */
  function ensureMutateBallStick(selection) {
    const owner = structure
    if (!owner) return
    const existing = views.find(
      (view) => view.id === mutateFocusViewId && view.structureId === activeStructureId
    )
    const subset = resolveViewAtomSubset(owner, selection)
    if (existing) {
      existing.selection = selection
      existing.baseSelection = selection
      existing.representation = { type: 'ball-stick' }
      existing.componentKey = 'polymer'
      existing.visible = true
      existing.atoms = subset.atoms
      existing.bonds = subset.bonds
      existing.residues = subset.residues
      existing._bondOrderFetchDone = false
      views = [...views]
      return
    }
    addView(selection, { type: 'ball-stick' }, {
      structureId: activeStructureId,
      componentKey: 'polymer'
    })
    mutateFocusViewId = views[views.length - 1]?.id ?? null
  }

  /** Center and zoom on the residue, and show it as ball-and-stick. */
  function focusMutateResidue() {
    const atoms = mutateResidueAtoms()
    if (!atoms.length) return
    const chain = String(mutateChain || '').trim()
    const resid = Number(mutateResid)
    ensureMutateBallStick(`chainID ${chain} and resid ${resid}`)
    const next = getCameraForAtoms(atoms)
    if (!next) return
    camera = {
      ...next,
      framingZoom: 3,
      framingGeneration: (camera?.framingGeneration ?? 0) + 1,
      poseResetGeneration: camera?.poseResetGeneration ?? 0
    }
    syncControlsTarget(atoms)
  }

  function scheduleMutateResidueFocus() {
    if (mutateFocusTimer) clearTimeout(mutateFocusTimer)
    mutateFocusTimer = setTimeout(() => {
      mutateFocusTimer = 0
      focusMutateResidue()
    }, 200)
  }

  function openMutateDialog() {
    toolsMenuOpen = false
    const atom = selectedAtom
    if (atom?.chain_id) mutateChain = String(atom.chain_id).trim()
    else mutateChain = defaultProteinChain(structure)
    if (atom && Number.isFinite(atom.res_id)) mutateResid = atom.res_id
    mutateRows = []
    mutateError = ''
    mutatePhi = null
    mutatePsi = null
    clearMutPreview()
    mutateOpen = true
    focusMutateResidue()
  }

  function openSplitDialog() {
    toolsMenuOpen = false
    splitChainId = defaultProteinChain(structure)
    splitError = ''
    splitOpen = true
  }

  function openSuperimposeDialog() {
    toolsMenuOpen = false
    const ids = structures.map((entry) => entry.id)
    superRefId = activeStructureId || ids[0] || ''
    const splitId = lastSplit && ids.includes(lastSplit.id) ? lastSplit.id : ''
    superMobId = splitId && splitId !== superRefId ? splitId : ids.find((id) => id !== superRefId) || ''
    superRefChain = defaultProteinChain(structures.find((entry) => entry.id === superRefId))
    superMobChain =
      lastSplit && lastSplit.id === superMobId
        ? lastSplit.chain
        : defaultProteinChain(structures.find((entry) => entry.id === superMobId))
    superError = ''
    superResult = ''
    superOpen = true
  }

  /** @param {string} id */
  function onSuperRefChange(id) {
    superRefId = id
    const chains = chainIdsOf(structures.find((entry) => entry.id === id), true)
    const all = chains.length ? chains : chainIdsOf(structures.find((entry) => entry.id === id), false)
    if (!all.includes(superRefChain)) superRefChain = all[0] || ''
  }

  /** @param {string} id */
  function onSuperMobChange(id) {
    superMobId = id
    const prefer = lastSplit && lastSplit.id === id ? lastSplit.chain : ''
    const chains = chainIdsOf(structures.find((entry) => entry.id === id), true)
    const all = chains.length ? chains : chainIdsOf(structures.find((entry) => entry.id === id), false)
    superMobChain = prefer && all.includes(prefer) ? prefer : all.includes(superMobChain) ? superMobChain : all[0] || ''
  }

  async function onMutateList() {
    if (!structure) return
    mutateBusy = true
    mutateError = ''
    try {
      const path = await materializeEntryPdb(structure)
      const listed = await mutateRotamers({
        path,
        chain: mutateChain,
        resid: Number(mutateResid),
        mutateTo
      })
      mutateRows = listed.rotamers || []
      mutatePhi = listed.phi ?? null
      mutatePsi = listed.psi ?? null
      mutateSelected = mutateRows[0]?.index ?? 0
      setMutPreview(mutateRows[0] || null)
      focusMutateResidue()
    } catch (ex) {
      mutateRows = []
      clearMutPreview()
      mutateError = ex instanceof Error ? ex.message : String(ex)
    } finally {
      mutateBusy = false
    }
  }

  /** @param {number} index */
  function onMutateSelect(index) {
    mutateSelected = index
    setMutPreview(mutateRows.find((row) => row.index === index) || null)
  }

  async function onMutateApply() {
    if (!structure) return
    const row = mutateRows.find((item) => item.index === mutateSelected) || mutateRows[0]
    if (!row) return
    mutateBusy = true
    mutateError = ''
    try {
      const path = await materializeEntryPdb(structure)
      const result = await mutateApply({
        path,
        chain: mutateChain,
        resid: Number(mutateResid),
        mutateTo,
        rotamerIndex: row.index
      })
      closeMutateDialog()
      await applyEditResult(result)
    } catch (ex) {
      mutateError = ex instanceof Error ? ex.message : String(ex)
    } finally {
      mutateBusy = false
    }
  }

  async function onSplitChain() {
    if (!structure || !splitChainId) return
    splitBusy = true
    splitError = ''
    try {
      const path = await materializeEntryPdb(structure)
      const result = await structureSplitChain({
        path,
        chain: splitChainId,
        topology: structure.trajectory ? structure.topologyPath : null
      })
      const label = `${structure.label || 'structure'} chain ${splitChainId}`
      const added = await appendStructure(result.path, {
        label,
        resetCamera: false,
        needsSecondaryStructure: true
      })
      if (added) lastSplit = { id: added.id, chain: splitChainId }
      splitOpen = false
    } catch (ex) {
      splitError = ex instanceof Error ? ex.message : String(ex)
    } finally {
      splitBusy = false
    }
  }

  /**
   * Replace one workspace structure's coordinates without clearing the others.
   * @param {string} entryId
   * @param {string} newPath
   */
  async function reloadStructureInPlace(entryId, newPath) {
    const entry = structures.find((item) => item.id === entryId)
    if (!entry) return
    loadingPDB = true
    try {
      const raw = await getStructure({
        path: newPath,
        topology: entry.topologyPath || null,
        needs_bonds: false,
        needs_secondary_structure: false,
        save_dir: workingDir || null
      })
      structures = structures.map((item) =>
        item.id === entryId
          ? {
              ...item,
              path: raw.path,
              atoms: raw.atoms,
              bonds: raw.bonds,
              residues: raw.residues,
              bond_source: raw.bond_source
            }
          : item
      )
      const snap = snapshotAtomCoords(raw.atoms)
      baseAtomCoordsByStructure.set(entryId, snap)
      if (entryId === activeStructureId) {
        baseAtomCoords = snap
        coordsDirty = false
        coordsGeneration += 1
        coordUndoStack.clear()
        previewPositions = null
      }
      for (const view of views) {
        if (view.structureId !== entryId) continue
        view.path = raw.path
        view.atoms = []
        view.bonds = []
        view.residues = []
        view._prefetched = false
      }
      views = [...views]
    } finally {
      loadingPDB = false
    }
  }

  async function onSuperimpose() {
    const reference = structures.find((entry) => entry.id === superRefId)
    const mobile = structures.find((entry) => entry.id === superMobId)
    if (!reference || !mobile) return
    if (reference.id === mobile.id) {
      superError = 'Reference and mobile must be two loaded structures. Split a chain first if both are in one file.'
      return
    }
    superBusy = true
    superError = ''
    try {
      const referencePath = await materializeEntryPdb(reference)
      const mobilePath = await materializeEntryPdb(mobile)
      const result = await structureSuperimpose({
        referencePath,
        referenceChain: superRefChain,
        mobilePath,
        mobileChain: superMobChain,
        referenceTopology: reference.trajectory ? reference.topologyPath : null,
        mobileTopology: mobile.trajectory ? mobile.topologyPath : null
      })
      await reloadStructureInPlace(mobile.id, result.path)
      const rmsd = Number(result.rmsd)
      superResult = `${result.n_anchors} anchors, RMSD ${Number.isFinite(rmsd) ? rmsd.toFixed(2) : '—'} Å. The reference did not move.`
    } catch (ex) {
      superError = ex instanceof Error ? ex.message : String(ex)
    } finally {
      superBusy = false
    }
  }

  const activeChainIds = $derived(chainIdsOf(structure, false))
  const superimposeChoices = $derived(
    structures.map((entry) => ({
      id: entry.id,
      label: entry.label || 'structure',
      chains: chainIdsOf(entry, false),
      proteinChains: chainIdsOf(entry, true)
    }))
  )
</script>

<div class="flex min-w-0 flex-1 flex-col">
  <div class="flex min-h-0 min-w-0 flex-1">
    <div
      class="relative min-h-0 min-w-0 flex-1"
      style={sceneBackgroundStyle}
      bind:this={viewerEl}
      bind:clientWidth={canvasWidth}
      bind:clientHeight={canvasHeight}
    >
      {#if structure && camera}
        <Canvas
          onAtomClick={handleCanvasClick}
          onAtomContextMenu={handleCanvasContextMenu}
          onAtomHover={handleCanvasHover}
        >
          <TrajPlayBridge />
          <CameraRig framing={camera} />
          {#each views.filter((v) => v.visible !== false && (v.opacity ?? 1) > 0.001) as view (view.id)}
            {@const draw = viewDraw(view)}
            <T.Group visible={isOwnerStructureVisible(view)}>
            {#key `${view.representation.type}-${coordsGeneration}`}
            {#if view.representation.type === 'ball-stick'}
              <BallStick
                atoms={draw.atoms}
                xyz={draw.xyz}
                xyzEpoch={trajPlayhead + trajXyzEpoch}
                trajSmooth={clampTrajSmooth(view.trajSmooth)}
                trajSmoothRestoreH={trajSmoothRestoreHEnabled(view.trajSmoothRestoreH)}
                bonds={draw.bonds}
                getColor={view.colorScheme.resolver}
                quality={view.quality ?? 3}
                atomScale={view.atomScale ?? 1.0}
                bondScale={view.bondScale ?? 1.0}
                metalness={view.material?.metalness ?? 0.08}
                roughness={view.material?.roughness ?? 0.48}
                emissiveIntensity={view.material?.emissiveIntensity ?? 0.0}
                glowBulb={isGlowingMaterial(view.material)}
                goodsell={isGoodsellMaterial(view.material)}
                outlinesEnabled={view.material?.outlinesEnabled ?? GOODSELL_MATERIAL_DEFAULTS.outlinesEnabled}
                outlineColor={view.material?.outlineColor ?? GOODSELL_MATERIAL_DEFAULTS.outlineColor}
                outlineWidth={view.material?.outlineWidth ?? GOODSELL_MATERIAL_DEFAULTS.outlineWidth}
                highlightIndices={highlightIndicesForStructure(view.structureId, activeStructureId, editHoverGroupIndices)}
                opacity={view.opacity ?? 1}
                showMultipleBonds={view.showMultipleBonds !== false}
                bondColorMode={view.bondColorMode === 'atoms' ? 'atoms' : 'uniform'}
                bondColor={view.bondColor ?? '#b8b8bc'}
              />
            {:else if view.representation.type === 'licorice'}
              <Licorice
                atoms={draw.atoms}
                xyz={draw.xyz}
                xyzEpoch={trajPlayhead + trajXyzEpoch}
                trajSmooth={clampTrajSmooth(view.trajSmooth)}
                trajSmoothRestoreH={trajSmoothRestoreHEnabled(view.trajSmoothRestoreH)}
                bonds={draw.bonds}
                getColor={view.colorScheme.resolver}
                quality={view.quality ?? 3}
                bondScale={view.bondScale ?? 1.0}
                stickRoundness={view.stickRoundness ?? 1.0}
                metalness={view.material?.metalness ?? 0.08}
                roughness={view.material?.roughness ?? 0.48}
                emissiveIntensity={view.material?.emissiveIntensity ?? 0.0}
                glowBulb={isGlowingMaterial(view.material)}
                goodsell={isGoodsellMaterial(view.material)}
                outlinesEnabled={view.material?.outlinesEnabled ?? GOODSELL_MATERIAL_DEFAULTS.outlinesEnabled}
                outlineColor={view.material?.outlineColor ?? GOODSELL_MATERIAL_DEFAULTS.outlineColor}
                outlineWidth={view.material?.outlineWidth ?? GOODSELL_MATERIAL_DEFAULTS.outlineWidth}
                highlightIndices={highlightIndicesForStructure(view.structureId, activeStructureId, editHoverGroupIndices)}
                opacity={view.opacity ?? 1}
                showMultipleBonds={view.showMultipleBonds !== false}
              />
            {:else if view.representation.type === 'cartoon'}
              <Cartoon
                atoms={draw.atoms}
                xyz={draw.xyz}
                xyzEpoch={trajPlayhead + trajXyzEpoch}
                trajSmooth={clampTrajSmooth(view.trajSmooth)}
                trajSmoothRestoreH={trajSmoothRestoreHEnabled(view.trajSmoothRestoreH)}
                residues={draw.residues ?? []}
                getColor={view.colorScheme.resolver}
                helixWidth={view.helixWidth ?? 1.0}
                sheetWidth={view.sheetWidth ?? 0.875}
                coilWidth={view.coilWidth ?? 0.125}
                ssColors={view.ssColors}
                quality={view.quality ?? 3}
                metalness={view.material?.metalness ?? 0.08}
                roughness={view.material?.roughness ?? 0.48}
                emissiveIntensity={view.material?.emissiveIntensity ?? 0.0}
                goodsell={isGoodsellMaterial(view.material)}
                outlinesEnabled={view.material?.outlinesEnabled ?? GOODSELL_MATERIAL_DEFAULTS.outlinesEnabled}
                outlineColor={view.material?.outlineColor ?? GOODSELL_MATERIAL_DEFAULTS.outlineColor}
                outlineWidth={view.material?.outlineWidth ?? GOODSELL_MATERIAL_DEFAULTS.outlineWidth}
                highlightIndices={highlightIndicesForStructure(view.structureId, activeStructureId, editHoverGroupIndices)}
                opacity={view.opacity ?? 1}
              />
            {:else if view.representation.type === 'tube'}
              <Tube
                atoms={draw.atoms}
                xyz={draw.xyz}
                xyzEpoch={trajPlayhead + trajXyzEpoch}
                trajSmooth={clampTrajSmooth(view.trajSmooth)}
                trajSmoothRestoreH={trajSmoothRestoreHEnabled(view.trajSmoothRestoreH)}
                residues={draw.residues ?? []}
                getColor={view.colorScheme.resolver}
                tubeRadius={view.tubeRadius ?? 0.9}
                ssColors={view.ssColors}
                quality={view.quality ?? 3}
                metalness={view.material?.metalness ?? 0.08}
                roughness={view.material?.roughness ?? 0.48}
                emissiveIntensity={view.material?.emissiveIntensity ?? 0.0}
                goodsell={isGoodsellMaterial(view.material)}
                outlinesEnabled={view.material?.outlinesEnabled ?? GOODSELL_MATERIAL_DEFAULTS.outlinesEnabled}
                outlineColor={view.material?.outlineColor ?? GOODSELL_MATERIAL_DEFAULTS.outlineColor}
                outlineWidth={view.material?.outlineWidth ?? GOODSELL_MATERIAL_DEFAULTS.outlineWidth}
                highlightIndices={highlightIndicesForStructure(view.structureId, activeStructureId, editHoverGroupIndices)}
                opacity={view.opacity ?? 1}
              />
            {:else if view.representation.type === 'vdw'}
              <VdwSpheres
                atoms={draw.atoms}
                xyz={draw.xyz}
                xyzEpoch={trajPlayhead + trajXyzEpoch}
                trajSmooth={clampTrajSmooth(view.trajSmooth)}
                trajSmoothRestoreH={trajSmoothRestoreHEnabled(view.trajSmoothRestoreH)}
                getColor={view.colorScheme.resolver}
                quality={view.quality ?? 3}
                atomScale={view.atomScale ?? 1.0}
                metalness={view.material?.metalness ?? 0.12}
                roughness={view.material?.roughness ?? 0.45}
                emissiveIntensity={view.material?.emissiveIntensity ?? 0.0}
                glowBulb={isGlowingMaterial(view.material)}
                goodsell={isGoodsellMaterial(view.material)}
                outlinesEnabled={view.material?.outlinesEnabled ?? GOODSELL_MATERIAL_DEFAULTS.outlinesEnabled}
                outlineColor={view.material?.outlineColor ?? GOODSELL_MATERIAL_DEFAULTS.outlineColor}
                outlineWidth={view.material?.outlineWidth ?? GOODSELL_MATERIAL_DEFAULTS.outlineWidth}
                highlightIndices={highlightIndicesForStructure(view.structureId, activeStructureId, editHoverGroupIndices)}
                opacity={view.opacity ?? 1}
              />
            {:else if view.representation.type === 'surface'}
              <OrganicSurface
                atoms={draw.atoms}
                xyzEpoch={trajPlayhead + trajXyzEpoch}
                deferRemesh={!view.selectionEachFrame && (trajScrubbing || trajPlaying) && !animExporting}
                residues={draw.residues ?? []}
                getColor={view.colorScheme.resolver}
                quality={view.quality ?? 3}
                surfaceInflate={view.surfaceInflate ?? 0.25}
                surfaceSource={view.surfaceSource === 'backbone' ? 'backbone' : 'atoms'}
                surfaceSubdivision={view.surfaceSubdivision ?? 0}
                metalness={view.material?.metalness ?? 0.08}
                roughness={view.material?.roughness ?? 0.52}
                emissiveIntensity={view.material?.emissiveIntensity ?? 0.0}
                glowBulb={isGlowingMaterial(view.material)}
                goodsell={isGoodsellMaterial(view.material)}
                outlinesEnabled={view.material?.outlinesEnabled ?? GOODSELL_MATERIAL_DEFAULTS.outlinesEnabled}
                outlineColor={view.material?.outlineColor ?? GOODSELL_MATERIAL_DEFAULTS.outlineColor}
                outlineWidth={view.material?.outlineWidth ?? GOODSELL_MATERIAL_DEFAULTS.outlineWidth}
                highlightIndices={highlightIndicesForStructure(view.structureId, activeStructureId, editHoverGroupIndices)}
                opacity={view.opacity ?? 1}
              />
            {:else if view.representation.type === 'points'}
              <AtomPoints
                atoms={draw.atoms}
                xyz={draw.xyz}
                xyzEpoch={trajPlayhead + trajXyzEpoch}
                trajSmooth={clampTrajSmooth(view.trajSmooth)}
                trajSmoothRestoreH={trajSmoothRestoreHEnabled(view.trajSmoothRestoreH)}
                getColor={view.colorScheme.resolver}
                pointSize={view.pointSize ?? 3}
                atomScale={view.atomScale ?? 1.0}
                highlightIndices={highlightIndicesForStructure(view.structureId, activeStructureId, editHoverGroupIndices)}
                opacity={view.opacity ?? 1}
              />
            {/if}
            {/key}
            {#if isGlowingMaterial(view.material) && resolveGlowingMaterial(view.material).glowEmitLight !== false && (view.opacity ?? 1) > 0.001}
              <AtomGlowLights
                atoms={draw.atoms}
                getColor={view.colorScheme.resolver}
                intensity={(resolveGlowingMaterial(view.material).glowLightIntensity ?? GLOWING_MATERIAL_DEFAULTS.glowLightIntensity) * Math.min(1, view.opacity ?? 1)}
                distance={resolveGlowingMaterial(view.material).glowLightDistance ?? GLOWING_MATERIAL_DEFAULTS.glowLightDistance}
                decay={resolveGlowingMaterial(view.material).glowLightDecay ?? GLOWING_MATERIAL_DEFAULTS.glowLightDecay}
                maxLights={resolveGlowingMaterial(view.material).glowMaxLights ?? GLOWING_MATERIAL_DEFAULTS.glowMaxLights}
                atomFilter={resolveGlowingMaterial(view.material).glowAtomFilter ?? GLOWING_MATERIAL_DEFAULTS.glowAtomFilter}
                highlightIndices={highlightIndicesForStructure(view.structureId, activeStructureId, glowHighlightIndices)}
              />
            {/if}
            </T.Group>
          {/each}
          {#if mutPreviewAtoms.length}
            <BallStick
              atoms={mutPreviewAtoms}
              bonds={mutPreviewBonds}
              getColor={mutPreviewColor}
              quality={4}
              atomScale={0.72}
              bondScale={0.85}
              opacity={1}
            />
          {/if}
          <!-- Edit mode selected outline: scale adapted to the current representation -->
          {#if editSelectedAtoms.length > 0}
            {@const _selIdxSet = new Set(editSelectedAtoms.map((a) => a.index))}
            {#each views.filter((v) => v.visible && !v._isSelHighlight && isOwnerStructureVisible(v) && v.structureId === activeStructureId) as _sv}
              {@const _svAtoms = viewAtoms(_sv).filter((a) => _selIdxSet.has(a.index))}
              {#if _svAtoms.length > 0}
                {#if _sv.representation.type === 'vdw'}
                  <VdwSpheres
                    atoms={_svAtoms}
                    getColor={_outlineGetColor}
                    atomScale={(_sv.atomScale ?? 1.0) * 1.06}
                    metalness={0}
                    roughness={0.6}
                    emissiveIntensity={0.05}
                    quality={2}
                    renderOrder={8}
                    opacity={1}
                    outline={true}
                  />
                {:else if _sv.representation.type === 'surface'}
                  <OrganicSurface
                    atoms={_svAtoms}
                    residues={_sv.residues ?? []}
                    getColor={_outlineGetColor}
                    quality={2}
                    surfaceInflate={Math.min(1, (_sv.surfaceInflate ?? 0.25) + 0.12)}
                    surfaceSource={_sv.surfaceSource === 'backbone' ? 'backbone' : 'atoms'}
                    surfaceSubdivision={0}
                    metalness={0}
                    roughness={0.6}
                    emissiveIntensity={0.05}
                    renderOrder={8}
                    opacity={1}
                  />
                {:else if _sv.representation.type === 'points'}
                  <AtomPoints
                    atoms={_svAtoms}
                    getColor={_outlineGetColor}
                    pointSize={(_sv.pointSize ?? 3) * 1.4}
                    atomScale={_sv.atomScale ?? 1.0}
                    renderOrder={8}
                  />
                {:else if _sv.representation.type === 'ball-stick' || _sv.representation.type === 'licorice'}
                  <!-- Match covalent radius: BALL_STICK_ATOM_SCALE=0.5, VDW_C=1.7, coval_C=0.76 → ratio≈0.26 with margin -->
                  <VdwSpheres
                    atoms={_svAtoms}
                    getColor={_outlineGetColor}
                    atomScale={(_sv.atomScale ?? 1.0) * 0.3}
                    metalness={0}
                    roughness={0.6}
                    emissiveIntensity={0.05}
                    quality={2}
                    renderOrder={8}
                    opacity={1}
                    outline={true}
                  />
                {:else}
                  <!-- Cartoon / tube: small marker spheres at atom positions -->
                  <VdwSpheres
                    atoms={_svAtoms}
                    getColor={_outlineGetColor}
                    atomScale={(_sv.atomScale ?? 1.0) * 0.24}
                    metalness={0}
                    roughness={0.6}
                    emissiveIntensity={0.05}
                    quality={2}
                    renderOrder={8}
                    opacity={1}
                    outline={true}
                  />
                {/if}
              {/if}
            {/each}
          {/if}
          {#if axesLinesVisible}
            <AxesLines length={camera.extent * 2} />
          {/if}
          {#if packmolDialogOpen && packmolShowBox && packmolBoxValid}
            <HydrationBoxOverlay
              visible={true}
              ghostWaters={packmolShowGhost && !!packmolVolume}
              ghostPoints={packmolVolume?.free_grid_points ?? null}
            />
          {/if}
        </Canvas>
        {#if animateMode && animProject.exportFrame?.showGuide !== false}
          <AnimationSafeAreaOverlay
            {canvasWidth}
            {canvasHeight}
            frameWidth={animProject.exportFrame?.width ?? 1920}
            frameHeight={animProject.exportFrame?.height ?? 1080}
          />
        {/if}
        {#if viewerBusy.active && !sceneRestoring && !loadingPDB}
          <div
            class="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-neutral-950/35"
            style="backdrop-filter:blur(1px)"
            aria-live="polite"
            aria-busy="true"
          >
            <div
              class="flex items-center gap-2 rounded-lg border border-neutral-600/50 bg-neutral-900/90 px-4 py-2 text-sm text-neutral-100 shadow-lg"
            >
              <Spinner className="size-5 text-blue-400" />
              <span>{viewerBusy.label || 'Updating view…'}</span>
            </div>
          </div>
        {/if}
        {#if animExporting}
          <div
            class="absolute inset-0 z-40 flex items-center justify-center bg-neutral-950/55"
            style="backdrop-filter:blur(2px)"
            aria-live="polite"
            aria-busy="true"
          >
            <div
              class="flex min-w-[16rem] flex-col items-center gap-3 rounded-lg border border-yellow-600/40 bg-neutral-900/95 px-6 py-5 text-center shadow-xl"
            >
              <Spinner className="size-6 text-yellow-400" />
              <div>
                <p class="text-sm font-semibold text-yellow-100">Rendering animation</p>
                <p class="mt-1 text-xs text-neutral-400">{animExportPhase}</p>
              </div>
              {#if animExportTotal > 0}
                <div class="w-full">
                  <div class="mb-1 flex justify-between text-[10px] tabular-nums text-neutral-500">
                    <span>Frame {animExportFrame} / {animExportTotal}</span>
                    <span>{Math.round((animExportFrame / animExportTotal) * 100)}%</span>
                  </div>
                  <div class="h-1.5 overflow-hidden rounded-full bg-neutral-800">
                    <div
                      class="h-full rounded-full bg-yellow-500 transition-[width] duration-150"
                      style="width: {Math.round((animExportFrame / animExportTotal) * 100)}%"
                    ></div>
                  </div>
                </div>
              {/if}
              <button
                type="button"
                class="mt-1 rounded-md border border-neutral-500/60 bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-100 hover:bg-neutral-700 disabled:opacity-50"
                onclick={cancelAnimExport}
                disabled={animExportPhase === 'Cancelling…'}
              >
                {animExportPhase === 'Cancelling…' ? 'Cancelling…' : 'Cancel'}
              </button>
            </div>
          </div>
        {/if}
        {#if axesVisible}
          <AxesGizmo />
        {/if}
        <!-- Bottom-right atom info strip (hover/selection info in edit mode) -->
        {#if editMode}
          {@const displayAtom = editHoveredAtom ?? selectedAtom}
          {#if displayAtom}
            {@const groupCount = editHoveredAtom
              ? editHoverGroupIndices.size
              : selectedGroupIndices.size}
            <div
              class="pointer-events-none absolute right-2 bottom-2 z-20 rounded-lg border border-neutral-700/60 bg-neutral-950/85 px-3 py-2 text-[11px] shadow-lg"
              style="backdrop-filter:blur(4px)"
            >
              <div class="font-mono font-semibold text-white">
                {displayAtom.res_name}{displayAtom.res_id}<span
                  class="mx-1 font-normal text-neutral-500">·</span
                ><span class="text-neutral-300">Chain {displayAtom.chain_id}</span>
              </div>
              <div class="mt-0.5 text-[10px] text-neutral-400">
                <span class="font-mono">{displayAtom.name}</span>
                <span class="mx-0.5 text-neutral-600">·</span>
                {displayAtom.element}
                <span class="mx-0.5 text-neutral-600">·</span>
                <span class="font-mono">#{displayAtom.index}</span>
                {#if groupCount > 1}
                  <span class="ml-1 text-neutral-500">({groupCount} atoms)</span>
                {/if}
              </div>
            </div>
          {/if}
        {/if}
        <MeasureOverlay
          measurements={liveMeasurements}
          picks={liveMeasurePicks}
          atomLabels={liveAtomLabels}
          width={canvasWidth}
          height={canvasHeight}
        />
        {#if measureMode}
          <div
            class="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/80 px-4 py-1.5 text-xs text-yellow-300"
          >
            {measureMode} — pick atom {measurePicks.length + 1} / {MEASURE_NEEDS[measureMode]}
            · right-click to cancel
          </div>
        {/if}
        <!-- Loading spinner while editBusy -->
        {#if editBusy}
          <div class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            <div class="flex items-center gap-2 rounded-full bg-black/50 px-4 py-2 shadow-xl">
              <Spinner className="size-5 text-yellow-400" />
              <span class="text-xs font-medium text-yellow-300">Processing…</span>
            </div>
          </div>
        {/if}
        {#if autoGeneratingViews}
          <div class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            <div class="flex items-center gap-2 rounded-full bg-black/50 px-4 py-2 shadow-xl">
              <Spinner className="size-5 text-yellow-400" />
              <span class="text-xs font-medium text-yellow-300">Generating representations…</span>
            </div>
          </div>
        {/if}

        {#if packmolDialogOpen && packmolShowBox && packmolBoxValid}
          <HydrationBoxManipulatorOverlay
            visible={true}
            boxMin={packmolBoxMinArr}
            boxMax={packmolBoxMaxArr}
            width={canvasWidth}
            height={canvasHeight}
            onBoxChange={onPackmolBoxChange}
            onDragEnd={onPackmolBoxDragEnd}
          />
        {/if}

        <!-- Transform gizmo overlay (hidden while Packmol box editor is active) -->
        {#if gizmoCentroid && showGizmo && !measureMode && !editBusy && !packmolDialogOpen}
          <TransformGizmo
            centroid={gizmoCentroid}
            cameraContainer={mainViewerCamera}
            width={canvasWidth}
            height={canvasHeight}
            busy={editBusy}
            previewActive={!!previewPositions}
            undoAvailable={coordUndoStack.size > 0}
            onTranslate={_onGizmoTranslate}
            onRotate={_onGizmoRotate}
            onDragMove={_onGizmoDragMove}
            onReset={onGizmoUndo}
            onApply={onGizmoApply}
          />
        {/if}
      {/if}
      {#if loadingPDB || sceneRestoring}
        <div
          class="absolute inset-0 z-40 flex items-center justify-center bg-neutral-950/90"
          style="backdrop-filter:blur(3px)"
          aria-live="polite"
          aria-busy="true"
        >
          <div
            class="flex w-[min(22rem,90vw)] flex-col items-center gap-3 rounded-xl border border-neutral-600/50 bg-neutral-900/95 px-6 py-5 text-center text-neutral-100 shadow-xl"
          >
            <Spinner className="size-8 text-sky-400" />
            <div class="w-full space-y-1">
              <p class="text-sm font-medium">
                {#if loadingPDB}
                  {loadingPhase || 'Loading structure…'}
                {:else}
                  {sceneRestoringPhase || 'Restoring view…'}
                {/if}
              </p>
              {#if sceneRestoring && sceneRestoringDetail}
                <p class="truncate text-xs text-neutral-400" title={sceneRestoringDetail}>
                  {sceneRestoringDetail}
                </p>
              {/if}
              <p class="text-xs text-neutral-400">
                {#if loadingPDB}
                  {loadingElapsedSec < 1 ? 'Starting…' : `${loadingElapsedSec}s elapsed`}
                {:else if viewerBusy.active}
                  {viewerBusy.label || 'Preparing materials…'}
                  {loadingElapsedSec >= 1 ? ` · ${loadingElapsedSec}s` : ''}
                {:else if sceneRestoringPhase === 'Finishing materials…'}
                  Building 3D meshes…
                  {loadingElapsedSec >= 1 ? ` · ${loadingElapsedSec}s` : ''}
                {:else}
                  {loadingElapsedSec < 1 ? 'Starting…' : `${loadingElapsedSec}s elapsed`}
                {/if}
              </p>
            </div>
            {#if sceneRestoring && sceneRestoringTotal > 0}
              <div class="w-full">
                <div class="mb-1 flex justify-between text-[10px] tabular-nums text-neutral-500">
                  <span>{sceneRestoringCurrent} / {sceneRestoringTotal}</span>
                  <span
                    >{Math.min(
                      100,
                      Math.round((100 * sceneRestoringCurrent) / sceneRestoringTotal)
                    )}%</span
                  >
                </div>
                <div class="h-1.5 overflow-hidden rounded-full bg-neutral-800">
                  <div
                    class="h-full rounded-full bg-sky-500 transition-[width] duration-200"
                    style="width: {Math.min(
                      100,
                      (100 * sceneRestoringCurrent) / sceneRestoringTotal
                    )}%"
                  ></div>
                </div>
              </div>
            {/if}
          </div>
        </div>
      {:else if !structure || !camera}
        <div
          class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-5 px-6"
          aria-label="No structure loaded"
        >
          <img
            src={getAppWindowIconUrl(themeState.current)}
            alt=""
            width="160"
            height="160"
            draggable="false"
            class="size-28 max-h-[28vmin] max-w-[28vmin] select-none opacity-[0.14] sm:size-36 md:size-40 dark:opacity-[0.16]"
          />
          <p class="max-w-sm text-center text-sm text-neutral-500 dark:text-neutral-500">
            Use Open ▾ to load a structure, trajectory, animation, or saved view
          </p>
        </div>
      {/if}
    </div>

    <ResizableSidePanel
      side="right"
      storageKey="visualize"
      defaultWidth={320}
      maxWidth={560}
      minWidth={160}
      className="flex min-h-0 min-w-0 flex-col border-l border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"
    >
      <h2 class="shrink-0 border-b border-neutral-200 p-2 text-xs font-semibold text-neutral-800 dark:border-neutral-800 dark:text-neutral-100">
        Representations
        {#if structure?.atoms?.length}
          <span class="ml-1 font-normal text-neutral-500 tabular-nums dark:text-neutral-500"
            >· {structure.atoms.length.toLocaleString()} atoms</span
          >
        {/if}
      </h2>
      {#if views.length > 0 || filePath}
        <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <div class="flex shrink-0 gap-1 border-b border-neutral-200 p-2 dark:border-neutral-800">
          {#snippet toolbarBtn(title, onclick, Icon, className, disabled = false)}
            <button
              type="button"
              class="flex size-7 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-100 transition-colors hover:border-neutral-300 hover:bg-neutral-200 active:translate-y-0.5 disabled:pointer-events-none disabled:opacity-40 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700 dark:hover:bg-neutral-800"
              aria-label={title}
              {title}
              {onclick}
              {disabled}
            >
              <Icon {className} />
            </button>
          {/snippet}

          {@render toolbarBtn('Add representation', () => addView(), Plus, 'size-3 fill-neutral-800 dark:fill-white')}
          {#if autoGeneratingViews}
            <button
              type="button"
              class="flex size-7 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900"
              aria-label="Generating representations"
              title="Generating representations…"
              disabled
            >
              <Spinner className="size-3.5 text-neutral-700 dark:text-neutral-200" />
            </button>
          {:else}
            {@render toolbarBtn(
              'Auto-generate representations',
              onAutoGenerateViews,
              DetectIcon,
              'size-4 stroke-2 stroke-neutral-800 dark:stroke-white',
              !filePath
            )}
          {/if}
          {@render toolbarBtn(
            axesVisible ? 'Hide axes gizmo' : 'Show axes gizmo',
            () => (axesVisible = !axesVisible),
            Axes,
            `size-4 ${axesVisible ? 'fill-neutral-800 dark:fill-white' : 'fill-neutral-400 dark:fill-neutral-500'}`
          )}
          {@render toolbarBtn(
            axesLinesVisible ? 'Hide axes lines' : 'Show axes lines',
            () => (axesLinesVisible = !axesLinesVisible),
            AxesLinesIcon,
            `size-4 stroke-2 ${axesLinesVisible ? 'opacity-100' : 'opacity-45'}`
          )}
          {@render toolbarBtn('Reset camera', resetCamera, ResetIcon, 'size-3 fill-neutral-800 dark:fill-white')}
          {@render toolbarBtn(
            'Scene rendering settings',
            () => (sceneSettingsOpen = true),
            Sun,
            'size-4 stroke-2 stroke-neutral-800 dark:stroke-white'
          )}
          <button
            type="button"
            class="flex size-7 items-center justify-center rounded-lg border transition-colors
              {viewerSettings.dof?.enabled
                ? 'border-yellow-500 bg-yellow-500/10 text-yellow-400'
                : 'border-neutral-200 bg-neutral-100 text-neutral-600 hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400'}"
            title={selectedAtom || editHoveredAtom
              ? 'Focus depth of field on selected / hovered atom'
              : 'Enable depth of field (pick an atom via right-click → Focus here)'}
            aria-label="Depth of field focus"
            disabled={!structure}
            onclick={() => {
              const a = selectedAtom ?? editHoveredAtom
              if (a) {
                focusDofOnAtom(a)
                return
              }
              if (viewerSettings.dof?.enabled) dofFocusAtomIndex = null
              viewerSettings.dof = {
                ...(viewerSettings.dof ?? {
                  enabled: false,
                  focusDistance: 80,
                  focusRange: 20,
                  bokehScale: 2.5,
                  focusTarget: null
                }),
                enabled: !viewerSettings.dof?.enabled
              }
              mainViewerInvalidate.fn()
            }}
          >
            <svg viewBox="0 0 16 16" class="size-4" fill="currentColor" aria-hidden="true">
              <path
                d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13m0 1.5a5 5 0 1 1 0 10 5 5 0 0 1 0-10m0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6m0 1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3"
              />
              <path d="M8 0v2M8 14v2M0 8h2M14 8h2" stroke="currentColor" stroke-width="1.2" fill="none" />
            </svg>
          </button>
          {@render toolbarBtn(
            'Save view…',
            onSaveViewpoint,
            SaveIcon,
            'size-4 stroke-2 stroke-neutral-800 dark:stroke-white',
            !structure || !camera
          )}
          {@render toolbarBtn(
            'Open view…',
            onLoadViewpoint,
            LoadIcon,
            'size-4 stroke-2 stroke-neutral-800 dark:stroke-white',
            loadingPDB
          )}
          <!-- Measurement mode buttons -->
          <div class="mx-0.5 h-4 w-px bg-neutral-300 dark:bg-neutral-700"></div>
          {#snippet measureBtn(title, mode)}
            <button
              type="button"
              class="flex size-7 items-center justify-center rounded-lg border transition-colors active:translate-y-0.5
              {measureMode === mode
                ? 'border-yellow-500 bg-yellow-500/10 text-yellow-400'
                : 'border-neutral-200 bg-neutral-100 text-neutral-600 hover:border-neutral-300 hover:bg-neutral-200 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:bg-neutral-800'}"
              aria-label={title}
              {title}
              onclick={() => toggleMeasureMode(mode)}
            >
              {#if mode === 'distance'}
                <!-- Two filled circles connected by a stick -->
                <svg viewBox="0 0 16 8" class="size-4" fill="currentColor" aria-hidden="true">
                  <circle cx="2.5" cy="4" r="2.5" />
                  <line
                    x1="5"
                    y1="4"
                    x2="11"
                    y2="4"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                  />
                  <circle cx="13.5" cy="4" r="2.5" />
                </svg>
              {:else if mode === 'angle'}
                <!-- 45-degree angle: vertex at left, horizontal arm, diagonal arm -->
                <svg viewBox="0 0 16 14" class="size-4" fill="currentColor" aria-hidden="true">
                  <circle cx="2" cy="12" r="2" />
                  <circle cx="14" cy="12" r="2" />
                  <circle cx="11" cy="3" r="2" />
                  <line
                    x1="4"
                    y1="12"
                    x2="12"
                    y2="12"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                  />
                  <line
                    x1="3.4"
                    y1="10.6"
                    x2="9.6"
                    y2="4.4"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                  />
                </svg>
              {:else}
                <!-- Four dots in a zigzag -->
                <svg viewBox="0 0 16 12" class="size-4" fill="currentColor" aria-hidden="true">
                  <circle cx="2" cy="3" r="2" />
                  <circle cx="6.5" cy="9" r="2" />
                  <circle cx="9.5" cy="3" r="2" />
                  <circle cx="14" cy="9" r="2" />
                  <polyline
                    points="2,3 6.5,9 9.5,3 14,9"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              {/if}
            </button>
          {/snippet}
          {@render measureBtn('Distance — click 2 atoms', 'distance')}
          {@render measureBtn('Angle — click 3 atoms', 'angle')}
          {@render measureBtn('Dihedral — click 4 atoms', 'dihedral')}
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto">
          {#if applyRepsBusy}
            <div class="border-b border-neutral-200 px-2 py-1.5 text-[11px] text-neutral-500 dark:border-neutral-800">
              {applyRepsPhase || 'Applying…'}
            </div>
          {/if}

          {#snippet groupNameEdit(g)}
            {#if editingGroupId === g.id}
              <input
                bind:this={editingGroupInputEl}
                type="text"
                class="min-w-0 flex-1 rounded border border-yellow-500/70 bg-white px-1 py-0.5 text-[10px] font-semibold text-neutral-900 outline-none dark:bg-neutral-950 dark:text-neutral-100"
                bind:value={editingGroupName}
                onclick={(e) => e.stopPropagation()}
                onkeydown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitGroupRename()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    cancelGroupRename()
                  }
                }}
                onblur={() => commitGroupRename()}
              />
            {:else}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="min-w-0 flex-1 cursor-text truncate text-left text-[10px] font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-200"
                title="Double-click to rename"
                ondblclick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  beginGroupRename(g.id, g.name)
                }}
              >{g.name}</div>
            {/if}
          {/snippet}

          {#snippet groupNameEditNested(g, structureId)}
            {#if editingGroupId === g.id}
              <input
                bind:this={editingGroupInputEl}
                type="text"
                class="min-w-0 flex-1 rounded border border-yellow-500/70 bg-white px-1 py-0.5 text-[10px] font-semibold text-neutral-900 outline-none dark:bg-neutral-950 dark:text-neutral-100"
                bind:value={editingGroupName}
                onclick={(e) => e.stopPropagation()}
                onkeydown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitGroupRename()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    cancelGroupRename()
                  }
                }}
                onblur={() => commitGroupRename()}
              />
            {:else}
              <button
                type="button"
                class="min-w-0 flex-1 cursor-text truncate text-left text-[10px] font-semibold text-neutral-600 dark:text-neutral-300"
                title="Use this structure. Double-click to rename the group."
                onclick={() => setActiveStructure(structureId)}
                ondblclick={(e) => {
                  e.preventDefault()
                  beginGroupRename(g.id, g.name)
                }}
              >{g.name}</button>
            {/if}
          {/snippet}

          {#snippet eyeIcon(open)}

            {#if open}
              <svg viewBox="0 0 16 10" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
                <path d="M1,5 Q8,-1.5 15,5 Q8,11.5 1,5" />
                <circle cx="8" cy="5" r="2.5" fill="currentColor" stroke="none" />
              </svg>
            {:else}
              <svg viewBox="0 0 16 10" class="size-3.5 opacity-50" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
                <path d="M1,5 Q8,-1.5 15,5 Q8,11.5 1,5" />
                <circle cx="8" cy="5" r="2.5" fill="currentColor" stroke="none" />
                <line x1="2" y1="9" x2="14" y2="1" />
              </svg>
            {/if}
          {/snippet}

          {#snippet renderViewItems(st, items)}
            {@const buckets = (() => {
              const order = ['polymer', 'lipid', 'water', 'ion', 'other']
              /** @type {Record<string, Array<{ view: any, index: number }>>} */
              const map = {}
              for (const item of items) {
                const key =
                  item.view.componentKey || componentKeyFromSelection(item.view.selection)
                if (!map[key]) map[key] = []
                map[key].push(item)
              }
              return order.filter((k) => map[k]?.length).map((k) => ({ key: k, items: map[k] }))
            })()}
            {#each buckets as bucket (bucket.key)}
              <div class="px-2 pb-1">
                <p class="px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                  {componentLabel(bucket.key)}
                </p>
                {#each bucket.items as { view, index } (view.id)}
                  <div class="relative">
                    <ViewItem
                      bind:view={views[index]}
                      hasTrajectory={!!st.trajectory}
                      {animateMode}
                      onVisibilityChange={(visible) => persistAnimatedViewVisibility([view.id], visible)}
                      onSelectionEachFrameChange={(enabled) =>
                        persistAnimatedSelectionEachFrame(view.id, enabled)
                      }
                      onTrajSmoothRestoreHChange={(enabled) =>
                        persistAnimatedTrajSmoothRestoreH(view.id, enabled)
                      }
                      selected={selectedViewIds.has(view.id)}
                      onRowSelect={(e) => onViewRowSelect(view.id, e)}
                      onContextOpen={() => ensureViewInSelection(view.id)}
                      onCreateGroup={onCreateGroupFromSelection}
                      onShowSelection={showPanelSelection}
                      onHideSelection={hidePanelSelection}
                      onFadeEdit={() => {
                        overlayFadeEditor = { kind: 'view', id: view.id }
                      }}
                      sourceBonds={st.bonds ?? null}
                      sourceAtoms={st.atoms ?? null}
                      sourceResidues={st.residues ?? null}
                      topology={st.topologyPath}
                      onremove={() => removeView(view.id)}
                      onduplicate={() => duplicateView(view.id)}
                      onsplitby={(mode) => splitViewBy(view.id, mode)}
                      oncenter={() => centerCameraOnAtoms(viewDraw(view).atoms)}
                    />
                    {#if structures.length > 1}
                      <div class="flex justify-end px-2 pb-1">
                        <button
                          type="button"
                          class="text-[10px] text-neutral-500 hover:text-yellow-500"
                          disabled={applyRepsBusy}
                          onclick={() => {
                            applyMenu = { viewId: view.id, open: true }
                            applyMenuSelected = new Set(
                              structures.filter((s) => s.id !== view.structureId).map((s) => s.id)
                            )
                          }}
                        >Apply to…</button>
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/each}
            {#if items.length === 0}
              <p class="px-3 pb-2 text-[11px] text-neutral-500">No representations</p>
            {/if}
          {/snippet}

          {#snippet renderStructureBlock(st, inStructureGroup = false)}
            {@const allItems = viewsByStructureId.get(st.id) ?? []}
            {@const stGroups = groupsForStructure(visibilityGroupsPruned, st.id)}
            {@const ungroupedItems = allItems.filter(({ view }) => !claimedRepIds.has(view.id))}
            {@const collapsed = isStructureCollapsed(st.id)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="{inStructureGroup
                ? 'border-b border-neutral-200/80 last:border-b-0 dark:border-neutral-700/60'
                : 'border-b border-neutral-200 dark:border-neutral-800'} {activeStructureId === st.id
                ? 'bg-neutral-50/80 dark:bg-neutral-900/40'
                : ''} {selectedStructureIds.has(st.id) ? 'ring-1 ring-inset ring-yellow-500/60' : ''}"
              oncontextmenu={(e) => openStructureCtxMenu(st.id, e)}
            >
              <div class="flex items-center gap-1 px-2 py-1.5">
                <button
                  type="button"
                  class="text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                  title={collapsed ? 'Expand' : 'Collapse'}
                  onclick={() => toggleStructureCollapse(st.id)}
                >{collapsed ? '▸' : '▾'}</button>
                {#if editingStructureId === st.id}
                  <input
                    bind:this={editingStructureInputEl}
                    type="text"
                    class="min-w-0 flex-1 rounded border border-yellow-500/70 bg-white px-1 py-0.5 text-xs font-semibold text-neutral-900 outline-none dark:bg-neutral-950 dark:text-neutral-100"
                    bind:value={editingStructureName}
                    onclick={(e) => e.stopPropagation()}
                    onkeydown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        commitStructureRename()
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        cancelStructureRename()
                      }
                    }}
                    onblur={() => commitStructureRename()}
                  />
                {:else}
                  <button
                    type="button"
                    class="min-w-0 flex-1 truncate text-left text-xs font-semibold {activeStructureId === st.id
                      ? 'text-yellow-600 dark:text-yellow-400'
                      : 'text-neutral-800 dark:text-neutral-100'}"
                    title={st.label}
                    ondblclick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      beginStructureRename(st.id, st.label)
                    }}
                    onclick={(e) => {
                      if (e.ctrlKey || e.metaKey || e.shiftKey) {
                        onStructureRowSelect(st.id, e)
                        return
                      }
                      setActiveStructure(st.id)
                      onStructureRowSelect(st.id, e)
                    }}
                  >{st.label}</button>
                {/if}
                <button
                  type="button"
                  class="px-1 text-xs text-neutral-500 hover:text-neutral-200"
                  title={isStructureHidden(st.id) ? 'Show structure' : 'Hide structure'}
                  onclick={() => toggleStructureVisible(st.id)}
                >{isStructureHidden(st.id) ? '○' : '●'}</button>
                {#if structures.length > 1}
                  <button
                    type="button"
                    class="px-1 text-[10px] text-neutral-500 hover:text-yellow-500 disabled:opacity-40"
                    title="Replace representations on all other structures with this structure's views"
                    disabled={applyRepsBusy || allItems.length === 0}
                    onclick={() => applyStructureRepsToAll(st.id)}
                  >⇢all</button>
                {/if}
                <button
                  type="button"
                  class="px-1 text-xs text-neutral-500 hover:text-neutral-200 disabled:opacity-40"
                  title="Duplicate structure"
                  disabled={!!duplicatingStructureId}
                  onclick={(e) => {
                    e.stopPropagation()
                    duplicateStructure(st.id)
                  }}
                >⧉</button>
                <button
                  type="button"
                  class="px-1 text-xs text-neutral-500 hover:text-neutral-200"
                  title="Rename structure"
                  onmousedown={(e) => e.preventDefault()}
                  onclick={(e) => {
                    e.stopPropagation()
                    beginStructureRename(st.id, st.label)
                  }}
                >✎</button>
                <button
                  type="button"
                  class="px-1 text-xs text-neutral-500 hover:text-red-400"
                  title="Remove structure"
                  onclick={() => removeStructure(st.id)}
                >✕</button>
              </div>
              <div class:hidden={collapsed}>
                {#each stGroups as g, gi (g.id)}
                  {@const gItems = allItems.filter(({ view }) => (g.viewIds || []).includes(view.id))}
                  {@const gAnyVisible = gItems.some(({ view }) => view.visible !== false)}
                  <div class="mx-1 mb-1 rounded border border-neutral-200/80 dark:border-neutral-800">
                    <div class="flex items-center gap-1 bg-neutral-50/80 px-1.5 py-0.5 dark:bg-neutral-900/60">
                      <button
                        type="button"
                        class="text-xs text-neutral-500"
                        title={g.collapsed ? 'Expand group' : 'Collapse group'}
                        onclick={() => {
                          setActiveStructure(st.id)
                          toggleGroupCollapsed(g.id)
                        }}
                      >{g.collapsed ? '▸' : '▾'}</button>
                      {@render groupNameEditNested(g, st.id)}
                      <button
                        type="button"
                        class="flex size-6 items-center justify-center rounded text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        title="Rename group"
                        onmousedown={(e) => e.preventDefault()}
                        onclick={(e) => {
                          e.stopPropagation()
                          beginGroupRename(g.id, g.name)
                        }}
                      >✎</button>
                      <button
                        type="button"
                        class="flex size-6 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        title={gAnyVisible ? 'Hide group' : 'Show group'}
                        onclick={() => toggleGroupVisible(g)}
                      >{@render eyeIcon(gAnyVisible)}</button>
                      <button
                        type="button"
                        class="flex size-6 items-center justify-center rounded text-xs text-neutral-500 hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
                        title="Move group up"
                        disabled={gi <= 0}
                        onclick={() => onReorderGroup(g.id, -1)}
                      >↑</button>
                      <button
                        type="button"
                        class="flex size-6 items-center justify-center rounded text-xs text-neutral-500 hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
                        title="Move group down"
                        disabled={gi >= stGroups.length - 1}
                        onclick={() => onReorderGroup(g.id, 1)}
                      >↓</button>
                      <button
                        type="button"
                        class="flex size-6 items-center justify-center rounded text-xs text-neutral-500 hover:text-red-400"
                        title="Dissolve group"
                        onclick={() => onDissolveGroup(g.id)}
                      >✕</button>
                    </div>
                    <div class:hidden={g.collapsed}>
                      {@render renderViewItems(st, gItems)}
                    </div>
                  </div>
                {/each}
                {@render renderViewItems(st, ungroupedItems)}
              </div>
            </div>
          {/snippet}

          {#if structures.length > 1}
            <div class="flex items-center gap-1 border-b border-neutral-200 px-2 py-1 dark:border-neutral-800">
              <span class="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wide text-neutral-500"
                >Workspace</span
              >
              <button
                type="button"
                class="flex size-6 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                title={workspaceAnyVisible ? 'Hide everything' : 'Show everything'}
                onclick={toggleWorkspaceVisible}
              >{@render eyeIcon(workspaceAnyVisible)}</button>
            </div>
          {/if}

          <!-- Outer structure groups (select structures → Create group) -->
          {#each outerStructureGroups as sg, sgi (sg.id)}
            {@const memberStructs = (sg.structureIds || [])
              .map((id) => findStructure(structures, id))
              .filter(Boolean)}
            {@const sgAnyVisible = (sg.structureIds || []).some((id) => !structureHiddenIds.has(id))}
            <div
              class="mx-1.5 mb-2 overflow-hidden rounded-md border border-yellow-600/30 bg-yellow-500/[0.04] dark:border-yellow-500/25 dark:bg-yellow-500/[0.07]"
            >
              <div
                class="flex items-center gap-1 border-b border-yellow-600/20 bg-yellow-500/10 px-2 py-1.5 dark:border-yellow-500/20 dark:bg-yellow-500/15"
              >
                <button
                  type="button"
                  class="text-xs text-neutral-500"
                  title={sg.collapsed ? 'Expand structure group' : 'Collapse structure group'}
                  onclick={() => toggleGroupCollapsed(sg.id)}
                >{sg.collapsed ? '▸' : '▾'}</button>
                {@render groupNameEdit(sg)}
                <button
                  type="button"
                  class="flex size-6 items-center justify-center rounded text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  title="Rename group"
                  onmousedown={(e) => e.preventDefault()}
                  onclick={(e) => {
                    e.stopPropagation()
                    beginGroupRename(sg.id, sg.name)
                  }}
                >✎</button>
                <span class="shrink-0 text-[9px] tabular-nums text-neutral-500"
                  >{memberStructs.length}</span
                >
                <button
                  type="button"
                  class="flex size-6 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  title={sgAnyVisible ? 'Hide structures' : 'Show structures'}
                  onclick={() => toggleGroupVisible(sg)}
                >{@render eyeIcon(sgAnyVisible)}</button>
                <button
                  type="button"
                  class="flex size-6 items-center justify-center rounded text-xs text-neutral-500 hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
                  title="Move group up"
                  disabled={sgi <= 0}
                  onclick={() => onReorderGroup(sg.id, -1)}
                >↑</button>
                <button
                  type="button"
                  class="flex size-6 items-center justify-center rounded text-xs text-neutral-500 hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
                  title="Move group down"
                  disabled={sgi >= outerStructureGroups.length - 1}
                  onclick={() => onReorderGroup(sg.id, 1)}
                >↓</button>
                <button
                  type="button"
                  class="flex size-6 items-center justify-center rounded text-xs text-neutral-500 hover:text-red-400"
                  title="Dissolve structure group"
                  onclick={() => onDissolveGroup(sg.id)}
                >✕</button>
              </div>
              <div class:hidden={sg.collapsed}>
                <div
                  class="ml-2 border-l-2 border-yellow-500/45 bg-white/40 dark:border-yellow-500/35 dark:bg-neutral-950/30"
                >
                  {#each memberStructs as st (st.id)}
                    {@render renderStructureBlock(st, true)}
                  {/each}
                </div>
              </div>
            </div>
          {/each}

          <!-- Structures not in an outer structure group -->
          {#if outerStructureGroups.length > 0 && ungroupedStructures.length > 0}
            <div
              class="mx-1.5 mb-1 mt-0.5 border-t border-dashed border-neutral-300 px-1 pt-1.5 dark:border-neutral-700"
            >
              <p class="text-[9px] font-medium uppercase tracking-wide text-neutral-500">
                Ungrouped
              </p>
            </div>
          {/if}
          {#each ungroupedStructures as st (st.id)}
            {@render renderStructureBlock(st)}
          {/each}

          {#if structureCtxMenu}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="fixed inset-0 z-50"
              onpointerdown={() => {
                structureCtxMenu = null
              }}
            >
              <div
                bind:this={structureCtxMenuEl}
                class="absolute z-50 min-w-40 overflow-hidden rounded-md border border-neutral-200 bg-white py-1 text-xs shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
                style="left:{structureCtxMenuPos.x}px;top:{structureCtxMenuPos.y}px"
                role="menu"
                tabindex="-1"
                onpointerdown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  role="menuitem"
                  class="block w-full px-3 py-1.5 text-left text-neutral-800 hover:bg-neutral-100 disabled:opacity-40 dark:text-neutral-100 dark:hover:bg-neutral-800"
                  title="Copy this structure into its own PDB"
                  disabled={!!duplicatingStructureId}
                  onclick={() => {
                    const id = structureCtxMenu?.id
                    structureCtxMenu = null
                    if (id) duplicateStructure(id)
                  }}
                >Duplicate structure</button>
                <button
                  type="button"
                  role="menuitem"
                  class="block w-full px-3 py-1.5 text-left text-neutral-800 hover:bg-neutral-100 disabled:opacity-40 dark:text-neutral-100 dark:hover:bg-neutral-800"
                  title={selectedStructureIds.size < 2
                    ? 'Ctrl+click at least two structures, then merge them'
                    : `Merge ${selectedStructureIds.size} structures into one PDB. Originals stay loaded.`}
                  disabled={selectedStructureIds.size < 2 || mergeBusy}
                  onclick={() => {
                    structureCtxMenu = null
                    mergeSelectedStructures()
                  }}
                >Merge structures</button>
                <button
                  type="button"
                  role="menuitem"
                  class="block w-full px-3 py-1.5 text-left text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
                  title="Group selected structures into one outer group"
                  onclick={() => {
                    structureCtxMenu = null
                    onCreateGroupFromSelection()
                  }}
                >Create group</button>
                <button
                  type="button"
                  role="menuitem"
                  class="block w-full px-3 py-1.5 text-left text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
                  onclick={() => {
                    structureCtxMenu = null
                    showPanelSelection()
                  }}
                >Show</button>
                <button
                  type="button"
                  role="menuitem"
                  class="block w-full px-3 py-1.5 text-left text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
                  onclick={() => {
                    structureCtxMenu = null
                    hidePanelSelection()
                  }}
                >Hide</button>
              </div>
            </div>
          {/if}
        <!-- Measurements collapsible section (always shown; same chip style model as Labels) -->
        <div class="border-t border-neutral-800">
          <div class="flex items-center">
            <button
              class="flex flex-1 items-center justify-between px-2 py-1.5 hover:bg-neutral-800/40"
              onclick={() => (measExpanded = !measExpanded)}
            >
              <span class="text-xs font-semibold text-neutral-300">Measurements</span>
              <span class="text-xs text-neutral-500">{measExpanded ? '▾' : '▸'}</span>
            </button>
            {#if measurements.length > 0}
              <button
                type="button"
                onclick={() => setAllMeasurementsVisible(!measAnyVisible)}
                class="px-1.5 py-1.5 text-neutral-500 hover:text-neutral-200"
                title={measAnyVisible ? 'Hide all measurements' : 'Show all measurements'}
              >
                {#if measAnyVisible}
                  <svg
                    viewBox="0 0 16 10"
                    class="size-3"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    aria-hidden="true"
                  >
                    <path d="M1,5 Q8,-1.5 15,5 Q8,11.5 1,5" />
                    <circle cx="8" cy="5" r="2.5" fill="currentColor" stroke="none" />
                  </svg>
                {:else}
                  <svg
                    viewBox="0 0 16 10"
                    class="size-3 opacity-40"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    aria-hidden="true"
                  >
                    <path d="M1,5 Q8,-1.5 15,5 Q8,11.5 1,5" />
                    <circle cx="8" cy="5" r="2.5" fill="currentColor" stroke="none" />
                    <line x1="2" y1="9" x2="14" y2="1" />
                  </svg>
                {/if}
              </button>
              <button
                onclick={clearAllMeasurements}
                class="px-2 py-1.5 text-xs text-neutral-500 hover:text-red-400"
                title="Clear all measurements">&#x2715;</button
              >
            {/if}
          </div>
          {#if measExpanded}
            <div
              class="space-y-0.5 border-b border-neutral-200/80 px-2 py-1 dark:border-neutral-800/60"
            >
              <div class="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-1.5">
                <span class="truncate text-[10px] text-neutral-500">Size</span>
                <RangeInput
                  bind:value={measSize}
                  min={8}
                  max={40}
                  step={1}
                  decimals={0}
                  rangeClassName="h-3 flex-1 cursor-pointer accent-yellow-400"
                  inputClassName="w-10"
                  oninput={(v) => {
                    for (const m of measurements) m.size = v
                  }}
                />
                <div class="flex w-11 shrink-0 items-center justify-end gap-1">
                  <span class="text-[9px] text-neutral-500">Aa</span>
                  <input
                    type="color"
                    value={measColor}
                    title="Text / line color"
                    oninput={(e) => {
                      measColor = e.target.value
                      for (const m of measurements) m.color = measColor
                    }}
                    class="size-4 cursor-pointer rounded border border-neutral-600 bg-transparent p-0"
                  />
                </div>
              </div>
              <div class="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-1.5">
                <span class="truncate text-[10px] text-neutral-500">Opac</span>
                <RangeInput
                  bind:value={measBackgroundOpacity}
                  min={0}
                  max={1}
                  step={0.05}
                  decimals={2}
                  rangeClassName="h-3 flex-1 cursor-pointer accent-yellow-400"
                  inputClassName="w-10"
                  oninput={(v) => {
                    for (const m of measurements) m.backgroundOpacity = v
                  }}
                />
                <div class="flex w-11 shrink-0 items-center justify-end gap-1">
                  <span class="text-[9px] text-neutral-500">Bg</span>
                  <input
                    type="color"
                    value={measBackground}
                    title="Background color"
                    oninput={(e) => {
                      measBackground = e.target.value
                      for (const m of measurements) m.background = measBackground
                    }}
                    class="size-4 cursor-pointer rounded border border-neutral-600 bg-transparent p-0"
                  />
                </div>
              </div>
              <div class="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-1.5">
                <span class="truncate text-[10px] text-neutral-500" title="Background padding">Pad</span>
                <RangeInput
                  bind:value={measPadding}
                  min={0}
                  max={24}
                  step={1}
                  decimals={0}
                  rangeClassName="h-3 flex-1 cursor-pointer accent-yellow-400"
                  inputClassName="w-10"
                  oninput={(v) => {
                    for (const m of measurements) m.padding = v
                  }}
                />
                <div class="w-11 shrink-0"></div>
              </div>
              <div class="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-1.5">
                <span class="truncate text-[10px] text-neutral-500" title="Corner radius">Round</span>
                <RangeInput
                  bind:value={measRadius}
                  min={0}
                  max={24}
                  step={1}
                  decimals={0}
                  rangeClassName="h-3 flex-1 cursor-pointer accent-yellow-400"
                  inputClassName="w-10"
                  oninput={(v) => {
                    for (const m of measurements) m.radius = v
                  }}
                />
                <div class="w-11 shrink-0"></div>
              </div>
              <div class="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-1.5">
                <span class="truncate text-[10px] text-neutral-500" title="Lift distance from midpoint">Lift</span>
                <RangeInput
                  bind:value={measOffsetY}
                  min={0}
                  max={80}
                  step={1}
                  decimals={0}
                  rangeClassName="h-3 flex-1 cursor-pointer accent-yellow-400"
                  inputClassName="w-10"
                  oninput={(v) => {
                    patchMeasurementLift(undefined, { offsetY: v })
                  }}
                />
                <div class="grid w-9 shrink-0 grid-cols-2 gap-px" title="Lift direction">
                  {#each /** @type {const} */ (['up', 'down', 'left', 'right']) as dir}
                    <button
                      type="button"
                      class="flex size-4 items-center justify-center rounded text-[9px] leading-none
                        {measLiftDir === dir
                        ? 'bg-yellow-500/25 text-yellow-300'
                        : 'text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300'}"
                      title="Lift {dir}"
                      onclick={() => {
                        measLiftDir = dir
                        patchMeasurementLift(undefined, { liftDir: dir })
                      }}
                    >
                      {dir === 'up' ? '↑' : dir === 'down' ? '↓' : dir === 'left' ? '←' : '→'}
                    </button>
                  {/each}
                </div>
              </div>
              <div class="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-1.5">
                <span class="truncate text-[10px] text-neutral-500" title="Connector line width">Line</span>
                <RangeInput
                  bind:value={measLineWidth}
                  min={0.5}
                  max={6}
                  step={0.5}
                  decimals={1}
                  rangeClassName="h-3 flex-1 cursor-pointer accent-yellow-400"
                  inputClassName="w-10"
                  oninput={(v) => {
                    for (const m of measurements) m.lineWidth = v
                  }}
                />
                <div class="w-11 shrink-0"></div>
              </div>
            </div>
            {#if measurements.length > 0}
              <div class="max-h-48 space-y-0 overflow-y-auto px-1 py-0.5">
                {#each measurements as m, i (m.id)}
                  <div class="flex flex-col rounded hover:bg-neutral-100/70 dark:hover:bg-neutral-800/35">
                    <div class="flex items-center gap-1 px-1 py-0.5">
                      <span
                        class="shrink-0"
                        style="color:{m.color ?? '#facc15'};opacity:{m.visible !== false ? 1 : 0.35}"
                        title={m.type === 'distance' ? 'Distance' : m.type === 'angle' ? 'Angle' : 'Dihedral'}
                      >
                        {#if m.type === 'distance'}
                          <svg
                            viewBox="0 0 16 8"
                            class="size-3"
                            fill="currentColor"
                            aria-hidden="true"
                          >
                            <circle cx="2.5" cy="4" r="2.5" />
                            <line
                              x1="5"
                              y1="4"
                              x2="11"
                              y2="4"
                              stroke="currentColor"
                              stroke-width="1.5"
                              stroke-linecap="round"
                            />
                            <circle cx="13.5" cy="4" r="2.5" />
                          </svg>
                        {:else if m.type === 'angle'}
                          <svg
                            viewBox="0 0 16 14"
                            class="size-3"
                            fill="currentColor"
                            aria-hidden="true"
                          >
                            <circle cx="2" cy="12" r="2" />
                            <circle cx="14" cy="12" r="2" />
                            <circle cx="11" cy="3" r="2" />
                            <line
                              x1="4"
                              y1="12"
                              x2="12"
                              y2="12"
                              stroke="currentColor"
                              stroke-width="1.5"
                              stroke-linecap="round"
                            />
                            <line
                              x1="3.4"
                              y1="10.6"
                              x2="9.6"
                              y2="4.4"
                              stroke="currentColor"
                              stroke-width="1.5"
                              stroke-linecap="round"
                            />
                          </svg>
                        {:else}
                          <svg
                            viewBox="0 0 16 12"
                            class="size-3"
                            fill="currentColor"
                            aria-hidden="true"
                          >
                            <circle cx="2" cy="3" r="2" />
                            <circle cx="6.5" cy="9" r="2" />
                            <circle cx="9.5" cy="3" r="2" />
                            <circle cx="14" cy="9" r="2" />
                            <polyline
                              points="2,3 6.5,9 9.5,3 14,9"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="1.5"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                            />
                          </svg>
                        {/if}
                      </span>
                      <span
                        class="inline-flex size-3.5 shrink-0 items-center justify-center border border-neutral-600"
                        style="background:{m.background ?? '#000000'};border-radius:{Math.min(
                          m.radius ?? 4,
                          6
                        )}px;opacity:{m.visible !== false ? (m.backgroundOpacity ?? 0.75) : 0.25}"
                        title="Background"
                      >
                        <span
                          class="size-1.5 rounded-full"
                          style="background:{m.color ?? '#facc15'}"
                        ></span>
                      </span>
                      <span
                        class="min-w-0 flex-1 truncate font-mono text-[11px] leading-tight"
                        style="color:{m.color ?? '#facc15'};opacity:{m.visible !== false
                          ? 1
                          : 0.35}">{measurementLabel(liveMeasurements[i] ?? m)}</span
                      >
                      <button
                        onclick={() => {
                          measurements[i].visible = !(m.visible !== false)
                        }}
                        class="shrink-0 p-0.5 text-neutral-600 hover:text-neutral-200"
                        title={m.visible !== false ? 'Hide' : 'Show'}
                      >
                        {#if m.visible !== false}
                          <svg
                            viewBox="0 0 16 10"
                            class="size-3"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.5"
                            stroke-linecap="round"
                            aria-hidden="true"
                          >
                            <path d="M1,5 Q8,-1.5 15,5 Q8,11.5 1,5" />
                            <circle cx="8" cy="5" r="2.5" fill="currentColor" stroke="none" />
                          </svg>
                        {:else}
                          <svg
                            viewBox="0 0 16 10"
                            class="size-3 opacity-40"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.5"
                            stroke-linecap="round"
                            aria-hidden="true"
                          >
                            <path d="M1,5 Q8,-1.5 15,5 Q8,11.5 1,5" />
                            <circle cx="8" cy="5" r="2.5" fill="currentColor" stroke="none" />
                            <line x1="2" y1="0.5" x2="14" y2="9.5" />
                          </svg>
                        {/if}
                      </button>
                      <button
                        onclick={() => toggleGear('meas', m.id)}
                        class="shrink-0 p-0.5 text-[11px] leading-none text-neutral-600 hover:text-neutral-300"
                        title="Settings">&#x2699;</button
                      >
                      <button
                        onclick={() => removeMeasurement(m.id)}
                        class="shrink-0 p-0.5 text-[11px] leading-none text-neutral-600 hover:text-red-400"
                        >&#x2715;</button
                      >
                    </div>
                    {#if gearOpen?.kind === 'meas' && gearOpen.id === m.id}
                      <div class="space-y-0.5 border-t border-neutral-800/60 px-1.5 py-1">
                        <div class="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-1.5">
                          <span class="truncate text-[10px] text-neutral-500">Size</span>
                          <RangeInput
                            bind:value={
                              () => m.size,
                              (v) => {
                                measurements[i].size = v
                              }
                            }
                            min={8}
                            max={40}
                            step={1}
                            decimals={0}
                            rangeClassName="h-3 flex-1 cursor-pointer accent-yellow-400"
                            inputClassName="w-10"
                          />
                          <div class="flex w-11 shrink-0 items-center justify-end gap-1">
                            <span class="text-[9px] text-neutral-500">Aa</span>
                            <input
                              type="color"
                              bind:value={m.color}
                              title="Text / line color"
                              class="size-4 cursor-pointer rounded border border-neutral-600 bg-transparent p-0"
                            />
                          </div>
                        </div>
                        <div class="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-1.5">
                          <span class="truncate text-[10px] text-neutral-500">Opac</span>
                          <RangeInput
                            bind:value={
                              () => m.backgroundOpacity ?? 0.75,
                              (v) => {
                                measurements[i].backgroundOpacity = v
                              }
                            }
                            min={0}
                            max={1}
                            step={0.05}
                            decimals={2}
                            rangeClassName="h-3 flex-1 cursor-pointer accent-yellow-400"
                            inputClassName="w-10"
                          />
                          <div class="flex w-11 shrink-0 items-center justify-end gap-1">
                            <span class="text-[9px] text-neutral-500">Bg</span>
                            <input
                              type="color"
                              value={m.background ?? '#000000'}
                              title="Background color"
                              oninput={(e) => {
                                measurements[i].background = e.target.value
                              }}
                              class="size-4 cursor-pointer rounded border border-neutral-600 bg-transparent p-0"
                            />
                          </div>
                        </div>
                        <div class="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-1.5">
                          <span class="truncate text-[10px] text-neutral-500">Pad</span>
                          <RangeInput
                            bind:value={
                              () => m.padding ?? 6,
                              (v) => {
                                measurements[i].padding = v
                              }
                            }
                            min={0}
                            max={24}
                            step={1}
                            decimals={0}
                            rangeClassName="h-3 flex-1 cursor-pointer accent-yellow-400"
                            inputClassName="w-10"
                          />
                          <div class="w-11 shrink-0"></div>
                        </div>
                        <div class="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-1.5">
                          <span class="truncate text-[10px] text-neutral-500">Round</span>
                          <RangeInput
                            bind:value={
                              () => m.radius ?? 4,
                              (v) => {
                                measurements[i].radius = v
                              }
                            }
                            min={0}
                            max={24}
                            step={1}
                            decimals={0}
                            rangeClassName="h-3 flex-1 cursor-pointer accent-yellow-400"
                            inputClassName="w-10"
                          />
                          <div class="w-11 shrink-0"></div>
                        </div>
                        <div class="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-1.5">
                          <span class="truncate text-[10px] text-neutral-500">Lift</span>
                          <RangeInput
                            bind:value={
                              () => m.offsetY ?? 0,
                              (v) => {
                                patchMeasurementLift(i, { offsetY: v })
                              }
                            }
                            min={0}
                            max={80}
                            step={1}
                            decimals={0}
                            rangeClassName="h-3 flex-1 cursor-pointer accent-yellow-400"
                            inputClassName="w-10"
                          />
                          <div class="grid w-9 shrink-0 grid-cols-2 gap-px" title="Lift direction">
                            {#each /** @type {const} */ (['up', 'down', 'left', 'right']) as dir}
                              <button
                                type="button"
                                class="flex size-4 items-center justify-center rounded text-[9px] leading-none
                                  {(m.liftDir ?? 'up') === dir
                                  ? 'bg-yellow-500/25 text-yellow-300'
                                  : 'text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300'}"
                                title="Lift {dir}"
                                onclick={() => {
                                  patchMeasurementLift(i, { liftDir: dir })
                                }}
                              >
                                {dir === 'up' ? '↑' : dir === 'down' ? '↓' : dir === 'left' ? '←' : '→'}
                              </button>
                            {/each}
                          </div>
                        </div>
                        <div class="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-1.5">
                          <span class="truncate text-[10px] text-neutral-500">Line</span>
                          <RangeInput
                            bind:value={
                              () => m.lineWidth,
                              (v) => {
                                measurements[i].lineWidth = v
                              }
                            }
                            min={0.5}
                            max={6}
                            step={0.5}
                            decimals={1}
                            rangeClassName="h-3 flex-1 cursor-pointer accent-yellow-400"
                            inputClassName="w-10"
                          />
                          <div class="w-11 shrink-0"></div>
                        </div>
                        <button
                          type="button"
                          class="mt-0.5 w-full rounded border border-neutral-700 px-1.5 py-0.5 text-left text-[10px] leading-tight text-neutral-300 hover:bg-neutral-800"
                          onclick={() => {
                            overlayFadeEditor = { kind: 'meas', id: m.id }
                          }}
                        >
                          Fade… <span class="text-neutral-500">{fadeSummary(m)}</span>
                        </button>
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          {/if}
        </div>
        <!-- Labels collapsible section (collapsed by default) -->
        <div class="border-t border-neutral-800">
          <div class="flex items-center">
            <button
              class="flex flex-1 items-center justify-between px-2 py-1.5 hover:bg-neutral-800/40"
              onclick={() => (labelsExpanded = !labelsExpanded)}
            >
              <span class="text-xs font-semibold text-neutral-300">Labels</span>
              <span class="text-xs text-neutral-500">{labelsExpanded ? '▾' : '▸'}</span>
            </button>
            {#if atomLabels.length > 0}
              <button
                type="button"
                onclick={() => setAllLabelsVisible(!labelsAnyVisible)}
                class="px-1.5 py-1.5 text-neutral-500 hover:text-neutral-200"
                title={labelsAnyVisible ? 'Hide all labels' : 'Show all labels'}
              >
                {#if labelsAnyVisible}
                  <svg
                    viewBox="0 0 16 10"
                    class="size-3"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    aria-hidden="true"
                  >
                    <path d="M1,5 Q8,-1.5 15,5 Q8,11.5 1,5" />
                    <circle cx="8" cy="5" r="2.5" fill="currentColor" stroke="none" />
                  </svg>
                {:else}
                  <svg
                    viewBox="0 0 16 10"
                    class="size-3 opacity-40"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    aria-hidden="true"
                  >
                    <path d="M1,5 Q8,-1.5 15,5 Q8,11.5 1,5" />
                    <circle cx="8" cy="5" r="2.5" fill="currentColor" stroke="none" />
                    <line x1="2" y1="9" x2="14" y2="1" />
                  </svg>
                {/if}
              </button>
              <button
                onclick={clearAllLabels}
                class="px-2 py-1.5 text-xs text-neutral-500 hover:text-red-400"
                title="Clear all labels">&#x2715;</button
              >
            {/if}
          </div>
          {#if labelsExpanded}
            <!-- Global defaults: aligned label | slider+number | optional color -->
            <div
              class="space-y-0.5 border-b border-neutral-200/80 px-2 py-1 dark:border-neutral-800/60"
            >
              <div class="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-1.5">
                <span class="truncate text-[10px] text-neutral-500">Size</span>
                <RangeInput
                  bind:value={labelSize}
                  min={8}
                  max={40}
                  step={1}
                  decimals={0}
                  rangeClassName="h-3 flex-1 cursor-pointer accent-yellow-400"
                  inputClassName="w-10"
                  oninput={(v) => {
                    for (const l of atomLabels) l.size = v
                  }}
                />
                <div class="flex w-11 shrink-0 items-center justify-end gap-1">
                  <span class="text-[9px] text-neutral-500">Aa</span>
                  <input
                    type="color"
                    value={labelColor}
                    title="Text color"
                    oninput={(e) => {
                      labelColor = e.target.value
                      for (const l of atomLabels) l.color = labelColor
                    }}
                    class="size-4 cursor-pointer rounded border border-neutral-600 bg-transparent p-0"
                  />
                </div>
              </div>
              <div class="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-1.5">
                <span class="truncate text-[10px] text-neutral-500">Opac</span>
                <RangeInput
                  bind:value={labelBackgroundOpacity}
                  min={0}
                  max={1}
                  step={0.05}
                  decimals={2}
                  rangeClassName="h-3 flex-1 cursor-pointer accent-yellow-400"
                  inputClassName="w-10"
                  oninput={(v) => {
                    for (const l of atomLabels) l.backgroundOpacity = v
                  }}
                />
                <div class="flex w-11 shrink-0 items-center justify-end gap-1">
                  <span class="text-[9px] text-neutral-500">Bg</span>
                  <input
                    type="color"
                    value={labelBackground}
                    title="Background color"
                    oninput={(e) => {
                      labelBackground = e.target.value
                      for (const l of atomLabels) l.background = labelBackground
                    }}
                    class="size-4 cursor-pointer rounded border border-neutral-600 bg-transparent p-0"
                  />
                </div>
              </div>
              <div class="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-1.5">
                <span class="truncate text-[10px] text-neutral-500" title="Background padding">Pad</span>
                <RangeInput
                  bind:value={labelPadding}
                  min={0}
                  max={24}
                  step={1}
                  decimals={0}
                  rangeClassName="h-3 flex-1 cursor-pointer accent-yellow-400"
                  inputClassName="w-10"
                  oninput={(v) => {
                    for (const l of atomLabels) l.padding = v
                  }}
                />
                <div class="w-11 shrink-0"></div>
              </div>
              <div class="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-1.5">
                <span class="truncate text-[10px] text-neutral-500" title="Corner radius">Round</span>
                <RangeInput
                  bind:value={labelRadius}
                  min={0}
                  max={24}
                  step={1}
                  decimals={0}
                  rangeClassName="h-3 flex-1 cursor-pointer accent-yellow-400"
                  inputClassName="w-10"
                  oninput={(v) => {
                    for (const l of atomLabels) l.radius = v
                  }}
                />
                <div class="w-11 shrink-0"></div>
              </div>
              <div class="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-1.5">
                <span class="truncate text-[10px] text-neutral-500" title="Lift distance from atom">Lift</span>
                <RangeInput
                  bind:value={labelOffsetY}
                  min={0}
                  max={80}
                  step={1}
                  decimals={0}
                  rangeClassName="h-3 flex-1 cursor-pointer accent-yellow-400"
                  inputClassName="w-10"
                  oninput={(v) => {
                    patchLabelLift(undefined, { offsetY: v })
                  }}
                />
                <div class="grid w-9 shrink-0 grid-cols-2 gap-px" title="Lift direction">
                  {#each /** @type {const} */ (['up', 'down', 'left', 'right']) as dir}
                    <button
                      type="button"
                      class="flex size-4 items-center justify-center rounded text-[9px] leading-none
                        {labelLiftDir === dir
                        ? 'bg-yellow-500/25 text-yellow-300'
                        : 'text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300'}"
                      title="Lift {dir}"
                      onclick={() => {
                        labelLiftDir = dir
                        patchLabelLift(undefined, { liftDir: dir })
                      }}
                    >
                      {dir === 'up' ? '↑' : dir === 'down' ? '↓' : dir === 'left' ? '←' : '→'}
                    </button>
                  {/each}
                </div>
              </div>
            </div>
            {#if atomLabels.length > 0}
              <div class="space-y-0 px-1 py-0.5">
                {#each atomLabels as l, j (l.id)}
                  <div class="flex flex-col rounded hover:bg-neutral-100/70 dark:hover:bg-neutral-800/35">
                    <div class="flex items-center gap-1 px-1 py-0.5">
                      <span
                        class="inline-flex size-3.5 shrink-0 items-center justify-center border border-neutral-600"
                        style="background:{l.background ?? '#000000'};border-radius:{Math.min(
                          l.radius ?? 4,
                          6
                        )}px;opacity:{l.visible !== false ? (l.backgroundOpacity ?? 0.75) : 0.25}"
                        title="Background"
                      >
                        <span
                          class="size-1.5 rounded-full"
                          style="background:{l.color}"
                        ></span>
                      </span>
                      <span
                        class="min-w-0 flex-1 truncate font-mono text-[11px] leading-tight text-neutral-300"
                        style="opacity:{l.visible !== false ? 1 : 0.35}">{l.text}</span
                      >
                      <button
                        onclick={() => {
                          atomLabels[j].visible = !(l.visible !== false)
                        }}
                        class="shrink-0 p-0.5 text-neutral-600 hover:text-neutral-200"
                        title={l.visible !== false ? 'Hide' : 'Show'}
                      >
                        {#if l.visible !== false}
                          <svg
                            viewBox="0 0 16 10"
                            class="size-3"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.5"
                            stroke-linecap="round"
                            aria-hidden="true"
                          >
                            <path d="M1,5 Q8,-1.5 15,5 Q8,11.5 1,5" />
                            <circle cx="8" cy="5" r="2.5" fill="currentColor" stroke="none" />
                          </svg>
                        {:else}
                          <svg
                            viewBox="0 0 16 10"
                            class="size-3 opacity-40"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.5"
                            stroke-linecap="round"
                            aria-hidden="true"
                          >
                            <path d="M1,5 Q8,-1.5 15,5 Q8,11.5 1,5" />
                            <circle cx="8" cy="5" r="2.5" fill="currentColor" stroke="none" />
                            <line x1="2" y1="0.5" x2="14" y2="9.5" />
                          </svg>
                        {/if}
                      </button>
                      <button
                        onclick={() => toggleGear('label', l.id)}
                        class="shrink-0 p-0.5 text-[11px] leading-none text-neutral-600 hover:text-neutral-300"
                        title="Settings">&#x2699;</button
                      >
                      <button
                        onclick={() => removeAtomLabel(l.id)}
                        class="shrink-0 p-0.5 text-[11px] leading-none text-neutral-600 hover:text-red-400"
                        >&#x2715;</button
                      >
                    </div>
                    {#if gearOpen?.kind === 'label' && gearOpen.id === l.id}
                      <div class="space-y-0.5 border-t border-neutral-800/60 px-1.5 py-1">
                        <input
                          type="text"
                          bind:value={l.text}
                          class="mb-0.5 w-full rounded bg-neutral-800 px-1 py-0.5 font-mono text-[11px] text-neutral-200 outline-none"
                        />
                        <div class="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-1.5">
                          <span class="truncate text-[10px] text-neutral-500">Size</span>
                          <RangeInput
                            bind:value={
                              () => l.size,
                              (v) => {
                                atomLabels[j].size = v
                              }
                            }
                            min={8}
                            max={40}
                            step={1}
                            decimals={0}
                            rangeClassName="h-3 flex-1 cursor-pointer accent-yellow-400"
                            inputClassName="w-10"
                          />
                          <div class="flex w-11 shrink-0 items-center justify-end gap-1">
                            <span class="text-[9px] text-neutral-500">Aa</span>
                            <input
                              type="color"
                              bind:value={l.color}
                              title="Text color"
                              class="size-4 cursor-pointer rounded border border-neutral-600 bg-transparent p-0"
                            />
                          </div>
                        </div>
                        <div class="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-1.5">
                          <span class="truncate text-[10px] text-neutral-500">Opac</span>
                          <RangeInput
                            bind:value={
                              () => l.backgroundOpacity ?? 0.75,
                              (v) => {
                                atomLabels[j].backgroundOpacity = v
                              }
                            }
                            min={0}
                            max={1}
                            step={0.05}
                            decimals={2}
                            rangeClassName="h-3 flex-1 cursor-pointer accent-yellow-400"
                            inputClassName="w-10"
                          />
                          <div class="flex w-11 shrink-0 items-center justify-end gap-1">
                            <span class="text-[9px] text-neutral-500">Bg</span>
                            <input
                              type="color"
                              value={l.background ?? '#000000'}
                              title="Background color"
                              oninput={(e) => {
                                atomLabels[j].background = e.target.value
                              }}
                              class="size-4 cursor-pointer rounded border border-neutral-600 bg-transparent p-0"
                            />
                          </div>
                        </div>
                        <div class="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-1.5">
                          <span class="truncate text-[10px] text-neutral-500">Pad</span>
                          <RangeInput
                            bind:value={
                              () => l.padding ?? 6,
                              (v) => {
                                atomLabels[j].padding = v
                              }
                            }
                            min={0}
                            max={24}
                            step={1}
                            decimals={0}
                            rangeClassName="h-3 flex-1 cursor-pointer accent-yellow-400"
                            inputClassName="w-10"
                          />
                          <div class="w-11 shrink-0"></div>
                        </div>
                        <div class="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-1.5">
                          <span class="truncate text-[10px] text-neutral-500">Round</span>
                          <RangeInput
                            bind:value={
                              () => l.radius ?? 4,
                              (v) => {
                                atomLabels[j].radius = v
                              }
                            }
                            min={0}
                            max={24}
                            step={1}
                            decimals={0}
                            rangeClassName="h-3 flex-1 cursor-pointer accent-yellow-400"
                            inputClassName="w-10"
                          />
                          <div class="w-11 shrink-0"></div>
                        </div>
                        <div class="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-1.5">
                          <span class="truncate text-[10px] text-neutral-500">Lift</span>
                          <RangeInput
                            bind:value={
                              () => l.offsetY ?? 22,
                              (v) => {
                                patchLabelLift(j, { offsetY: v })
                              }
                            }
                            min={0}
                            max={80}
                            step={1}
                            decimals={0}
                            rangeClassName="h-3 flex-1 cursor-pointer accent-yellow-400"
                            inputClassName="w-10"
                          />
                          <div class="grid w-9 shrink-0 grid-cols-2 gap-px" title="Lift direction">
                            {#each /** @type {const} */ (['up', 'down', 'left', 'right']) as dir}
                              <button
                                type="button"
                                class="flex size-4 items-center justify-center rounded text-[9px] leading-none
                                  {(l.liftDir ?? 'up') === dir
                                  ? 'bg-yellow-500/25 text-yellow-300'
                                  : 'text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300'}"
                                title="Lift {dir}"
                                onclick={() => {
                                  patchLabelLift(j, { liftDir: dir })
                                }}
                              >
                                {dir === 'up' ? '↑' : dir === 'down' ? '↓' : dir === 'left' ? '←' : '→'}
                              </button>
                            {/each}
                          </div>
                        </div>
                        <button
                          type="button"
                          class="mt-0.5 w-full rounded border border-neutral-700 px-1.5 py-0.5 text-left text-[10px] leading-tight text-neutral-300 hover:bg-neutral-800"
                          onclick={() => {
                            overlayFadeEditor = { kind: 'label', id: l.id }
                          }}
                        >
                          Fade… <span class="text-neutral-500">{fadeSummary(l)}</span>
                        </button>
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          {/if}
        </div>

        {#if animateMode}
          <AnimationPanel
            {workingDir}
            outputFolder={animProject.outputFolder}
            projectName={animProject.name}
            fps={animProject.fps}
            duration_s={animProject.duration_s}
            exportFrame={animProject.exportFrame ?? {
              aspectPreset: '16:9',
              width: 1920,
              height: 1080,
              showGuide: true,
              exportFormat: 'mp4'
            }}
            playing={animPlaying}
            exporting={animExporting}
            keyframeCount={animProject.keyframes.length}
            expanded={animExpanded}
            onToggleExpanded={() => (animExpanded = !animExpanded)}
            onOutputFolderChange={(v) => {
              animProject = { ...animProject, outputFolder: v }
            }}
            onProjectNameChange={(v) => {
              animProject = { ...animProject, name: v }
            }}
            onFpsChange={(v) => {
              animProject = { ...animProject, fps: v }
            }}
            onDurationChange={(v) => {
              animProject = { ...animProject, duration_s: v }
              animPlayhead = Math.min(animPlayhead, v)
            }}
            onExportFrameChange={(frame) => {
              animProject = { ...animProject, exportFrame: frame }
            }}
            onCaptureKeyframe={onAnimCaptureKeyframe}
            onClearKeyframes={onAnimClearKeyframes}
            onSaveProject={onAnimSaveProject}
            onLoadProject={onAnimLoadProject}
            onExportVideo={onAnimExportVideo}
          />
        {/if}
        </div>
        </div>
      {:else}
        <div
          class="flex flex-1 items-center justify-center p-4 text-center text-xs text-neutral-500 dark:text-neutral-600"
        >
          Load a structure to add representations
        </div>
      {/if}
    </ResizableSidePanel>
  </div>
  <!-- end inner row -->

<TrajectoryOpenDialog
  open={trajDialogOpen}
  defaultPath={workingDir || ''}
  onConfirm={onOpenTrajectoryConfirm}
  onCancel={() => (trajDialogOpen = false)}
/>
<StructureEntryPicker
  open={entryPicker.open}
  sourcePath={entryPicker.sourcePath}
  entries={entryPicker.entries}
  onConfirm={(indices) => resolveEntryPicker(indices)}
  onCancel={() => resolveEntryPicker(null)}
/>

<ApplyRepresentationPicker
  open={applyMenu.open && !!applyMenu.viewId}
  sourceLabel={applyMenuSourceView?.selection ?? ''}
  targets={applyMenuTargets}
  selected={applyMenuSelected}
  busy={applyRepsBusy}
  onSelectedChange={(next) => (applyMenuSelected = next)}
  onCancel={() => (applyMenu = { viewId: null, open: false })}
  onConfirm={async () => {
    const vid = applyMenu.viewId
    const targets = [...applyMenuSelected]
    applyMenu = { viewId: null, open: false }
    if (vid) await applyViewToStructures(vid, targets)
  }}
/>



  {#if animateMode}
    <AnimationTimeline
      playhead={animPlayhead}
      duration_s={animProject.duration_s}
      fps={animProject.fps}
      playing={animPlaying}
      exporting={animExporting}
      keyframes={animProject.keyframes}
      viewTracks={animProject.viewTracks ?? []}
      liveViews={views}
      onPlayPause={toggleAnimPlayPause}
      onStop={onAnimStop}
      onScrub={onAnimScrub}
      onGoToKeyframe={onAnimGoToKeyframe}
      onMoveKeyframe={onAnimMoveKeyframe}
      onRenameKeyframe={onAnimRenameKeyframe}
      onDuplicateKeyframe={onAnimDuplicateKeyframe}
      onDeleteKeyframe={onAnimDeleteKeyframe}
      onClearKeyframes={onAnimClearKeyframes}
      onEasingChange={onAnimEasingChange}
      onCaptureKeyframe={onAnimCaptureKeyframe}
      onClose={toggleAnimateMode}
    />
  {/if}

  {#if overlayFadeEditor}
    {@const fadeItem =
      overlayFadeEditor.kind === 'label'
        ? atomLabels.find((l) => l.id === overlayFadeEditor.id)
        : overlayFadeEditor.kind === 'meas'
          ? measurements.find((m) => m.id === overlayFadeEditor.id)
          : views.find((v) => v.id === overlayFadeEditor.id)}
    {#if fadeItem}
      <AnimationFadeEditor
        itemLabel={overlayFadeEditor.kind === 'label'
          ? fadeItem.text
          : overlayFadeEditor.kind === 'meas'
            ? measurementLabel(/** @type {typeof measurements[0]} */ (fadeItem))
            : viewDisplayLabel(/** @type {typeof views[0]} */ (fadeItem))}
        fadeEnabled={fadeItem.fadeEnabled}
        fadeIn_s={fadeItem.fadeIn_s}
        fadeOut_s={fadeItem.fadeOut_s}
        fadeInEasing={fadeItem.fadeInEasing}
        fadeOutEasing={fadeItem.fadeOutEasing}
        fadeInBezier={fadeItem.fadeInBezier ?? null}
        fadeOutBezier={fadeItem.fadeOutBezier ?? null}
        onChange={onOverlayFadeChange}
        onClose={() => (overlayFadeEditor = null)}
      />
    {/if}
  {/if}

  <!-- Bottom toolbar: single row + horizontal scroll when cramped -->
  <div
    class="viz-bottom-toolbar relative flex h-8 shrink-0 items-center gap-1 overflow-x-auto overflow-y-hidden border-t border-neutral-200 bg-white px-2 text-[11px] dark:border-neutral-800 dark:bg-neutral-950"
    onscroll={closeAllToolbarMenus}
  >
    <!-- Open ▾ (structure / topology / animation / view) -->
    <div class="relative shrink-0">
      <button
        type="button"
        bind:this={openMenuBtnEl}
        class="flex h-[22px] items-center gap-1 whitespace-nowrap rounded border border-neutral-300 bg-neutral-100 px-2 py-0 text-neutral-700 transition-colors hover:border-neutral-400 hover:bg-neutral-200 disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:border-neutral-600 dark:hover:bg-neutral-800"
        disabled={loadingPDB}
        onpointerenter={() => {
          clearTimeout(_openHoverTimer)
          if (!loadingPDB) openMenuOpen = true
        }}
        onpointerleave={() => {
          _openHoverTimer = setTimeout(() => (openMenuOpen = false), 280)
        }}
        onclick={() => {
          selectMenuOpen = false
          editMenuOpen = false
          toolsMenuOpen = false
          openMenuOpen = !openMenuOpen
        }}
        title="Open structure, trajectory, animation, or saved view"
      >
        <!-- Lucide folder-open (stroke) -->
        <svg
          viewBox="0 0 24 24"
          class="size-3.5 shrink-0"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path
            d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"
          />
        </svg>
        Open
        <svg viewBox="0 0 10 6" class="size-2 fill-current opacity-60" aria-hidden="true"
          ><path d="M0 0l5 6 5-6z" /></svg
        >
      </button>
      {#if openMenuOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="viz-toolbar-menu"
          style={toolbarMenuFixedStyle(openMenuBtnEl)}
          onpointerenter={() => clearTimeout(_openHoverTimer)}
          onpointerleave={() => {
            _openHoverTimer = setTimeout(() => (openMenuOpen = false), 280)
          }}
        >
          <button
            type="button"
            class="viz-toolbar-menu-item"
            onclick={() => {
              openMenuOpen = false
              onOpenPdb()
            }}
            title="Open PDB/CIF (auto-uses companion .prmtop/.psf in the same folder when found)"
          >
            Structure (PDB / CIF)…
          </button>
          <button
            type="button"
            class="viz-toolbar-menu-item"
            onclick={() => {
              openMenuOpen = false
              onOpenWithTopology()
            }}
            title="Open topology (.prmtop/.psf) then a coordinate PDB"
          >
            With topology…
          </button>
          <button
            type="button"
            class="viz-toolbar-menu-item"
            onclick={() => {
              openMenuOpen = false
              trajDialogOpen = true
            }}
            title="Open a topology plus one or more trajectories (stride per file)"
          >
            Trajectory…
          </button>
          <div class="viz-toolbar-menu-sep"></div>
          <button
            type="button"
            class="viz-toolbar-menu-item"
            onclick={() => {
              openMenuOpen = false
              onAnimLoadProject()
            }}
            title="Load a saved animation project (its structure/topology is loaded automatically)"
          >
            Animation…
          </button>
          <button
            type="button"
            class="viz-toolbar-menu-item"
            onclick={() => {
              openMenuOpen = false
              onLoadViewpoint()
            }}
            title="Open a saved view (structure, representations, materials, lights, and camera are restored)"
          >
            View…
          </button>
          <div class="viz-toolbar-menu-sep"></div>
          <button
            type="button"
            class="viz-toolbar-menu-item viz-toolbar-menu-item-danger"
            onclick={() => {
              openMenuOpen = false
              clearWorkspace()
            }}
            disabled={!structure && views.length === 0 && !filePath}
            title="Remove the loaded structure and all representations from the viewer"
          >
            Clear scene
          </button>
        </div>
      {/if}
    </div>
    {#if filePath && !loadingPDB}
      <span
        class="max-w-36 shrink-0 truncate font-mono text-neutral-500 dark:text-neutral-400"
        title={filePath}
      >
        {filePath.split(/[/\\]/).at(-1)}
      </span>
      {#if loadBondStatus}
        <span
          class="max-w-48 shrink-0 truncate text-[10px] text-sky-600 dark:text-sky-400"
          title={loadBondStatus}
          >{loadBondStatus}</span
        >
      {/if}
    {/if}

    {#if trajStructure?.trajectory}
      {@const tf = trajStructure.trajectory}
      {@const trajDigits = String(tf.logicalFrameCount).length}
      <div
        class="flex h-[22px] shrink-0 items-center gap-1.5 border-l border-neutral-200 pl-2 dark:border-neutral-800"
        title={trajFileLabel(trajStructure)}
      >
        <button
          type="button"
          class="flex size-[22px] shrink-0 items-center justify-center rounded border border-neutral-300 bg-neutral-100 text-neutral-700 hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
          onclick={toggleTrajPlayback}
          disabled={!trajPlaying && !trajCanPlay}
          title={
            trajPlaying
              ? 'Pause trajectory'
              : !trajCanPlay
                ? trajCacheInfo?.error
                  ? `Trajectory cache failed: ${trajCacheInfo.error}`
                  : trajAdoptPending
                    ? `Loading frames into RAM${trajRamLoadLabel ? ` (${trajRamLoadLabel})` : ''}… play starts when ready`
                    : trajCacheInfo && !trajCacheInfo.complete
                      ? `Indexing ${trajCacheInfo.frames_ready}/${trajCacheInfo.frames_total}… play starts when the cache is ready`
                      : 'Waiting for the trajectory cache…'
                : 'Play trajectory'
          }
        >
          {#if trajPlaying}
            <span class="block h-2 w-2 bg-current"></span>
          {:else}
            <svg viewBox="0 0 10 10" class="size-2.5 fill-current" aria-hidden="true"
              ><path d="M2 1l7 4-7 4z" /></svg
            >
          {/if}
        </button>
        <input
          bind:this={trajSliderEl}
          type="range"
          class="h-1 w-36 shrink-0 accent-yellow-500"
          min="0"
          max={Math.max(0, tf.logicalFrameCount - 1)}
          step="1"
          onpointerdown={() => (trajScrubbing = true)}
          onpointerup={() => (trajScrubbing = false)}
          onpointercancel={() => (trajScrubbing = false)}
          oninput={(e) => {
            const v = Number(e.currentTarget.value)
            if (trajPlaying) rebaseTrajClock(v)
            void seekTrajFrame(v)
          }}
        />
        <span
          bind:this={trajFrameLabelEl}
          class="shrink-0 text-right font-mono tabular-nums text-neutral-500 dark:text-neutral-400"
          style={`width: ${trajDigits * 2 + 1}ch`}
        >
          {String(Math.round(trajPlayhead) + 1).padStart(trajDigits, '0')}/{tf.logicalFrameCount}
        </span>
        {#if trajCacheInfo && !trajCacheInfo.complete}
          <span class="shrink-0 text-[10px] text-neutral-500 dark:text-neutral-400">
            Indexing {trajCacheInfo.frames_ready}/{trajCacheInfo.frames_total}…
          </span>
        {:else if trajAdoptPending}
          <span class="shrink-0 text-[10px] text-neutral-500 dark:text-neutral-400">
            Loading frames into RAM{trajRamLoadLabel ? ` ${trajRamLoadLabel}` : ''}…
          </span>
        {:else if trajCacheError}
          <span
            class="max-w-56 shrink-0 truncate text-[10px] text-red-600 dark:text-red-400"
            title={trajCacheError}>Cache error — play stopped</span
          >
        {:else if trajCache?.preloaded}
          <span class="shrink-0 text-[10px] text-neutral-500 dark:text-neutral-400">All frames in RAM</span>
        {:else if trajSidecarReady}
          <span class="shrink-0 text-[10px] text-neutral-500 dark:text-neutral-400">Streaming from cache</span>
        {/if}
        {#if trajRmsdNow != null}
          <button
            type="button"
            class="shrink-0 font-mono text-[10px] text-yellow-700 hover:underline dark:text-yellow-400"
            title="Open Align / RMSD"
            onclick={openTrajAlignPanel}
          >
            {trajAlign.mode === 'align' ? 'Aligned' : 'RMSD'}
            {trajRmsdNow.toFixed(2)} Å
          </button>
        {/if}
      </div>
    {/if}

    <!-- PDB download -->
    <form
      class="flex h-[22px] shrink-0 items-center gap-0.5"
      onsubmit={(e) => {
        e.preventDefault()
        onFetchPDB()
      }}
    >
      <input
        type="text"
        placeholder="1CRN"
        maxlength="4"
        title="4-character PDB ID"
        class="h-[22px] w-14 rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0 font-mono text-[11px] text-neutral-800 uppercase outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
        bind:value={pdbId}
        oninput={(e) => {
          if (/** @type {HTMLInputElement} */ (e.target).value.length > 4)
            /** @type {HTMLInputElement} */ (e.target).value = /** @type {HTMLInputElement} */ (
              e.target
            ).value.slice(0, 4)
        }}
      />
      <button
        type="submit"
        class="flex h-[22px] items-center whitespace-nowrap rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0 text-neutral-700 transition-colors hover:border-neutral-400 hover:bg-neutral-200 disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:border-neutral-500 dark:hover:bg-neutral-800"
        disabled={!isPdbIdValid || loadingPDB}
        title="Download this PDB ID from RCSB. Uses the PDB file, or mmCIF when RCSB does not publish one (for example 5GOA)."
        >↓ PDB</button
      >
    </form>

    <div class="h-4 w-px shrink-0 bg-neutral-300 dark:bg-neutral-700"></div>

    <!-- Edit Mode: Select dropdown (hover to open, no backdrop) -->
    <div class="relative shrink-0">
      <button
        type="button"
        bind:this={selectMenuBtnEl}
        class="flex h-[22px] items-center gap-1 whitespace-nowrap rounded border px-2 py-0 text-[11px] transition-colors disabled:opacity-40
          {editMode
          ? 'border-orange-500/60 bg-orange-500/15 text-orange-300 hover:bg-orange-500/25'
          : 'border-neutral-300 bg-neutral-100 text-neutral-600 hover:border-neutral-400 hover:bg-neutral-200 hover:text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-200'}"
        onpointerenter={() => {
          clearTimeout(_selectHoverTimer)
          if (filePath) selectMenuOpen = true
        }}
        onpointerleave={() => {
          _selectHoverTimer = setTimeout(() => (selectMenuOpen = false), 280)
        }}
        onclick={() => {
          openMenuOpen = false
          editMenuOpen = false
          toolsMenuOpen = false
          selectMenuOpen = !selectMenuOpen
        }}
        disabled={!filePath}
        title={structure?.label
          ? `Interactive selection on ${structure.label} only`
          : 'Interactive selection mode'}
      >
        {editMode ? `Select · ${EDIT_LEVEL_LABEL[editSelectionLevel]}` : 'Select'}
        <svg viewBox="0 0 10 6" class="size-2 fill-current opacity-60" aria-hidden="true"
          ><path d="M0 0l5 6 5-6z" /></svg
        >
      </button>
      {#if selectMenuOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="viz-toolbar-menu"
          style={toolbarMenuFixedStyle(selectMenuBtnEl)}
          onpointerenter={() => clearTimeout(_selectHoverTimer)}
          onpointerleave={() => {
            _selectHoverTimer = setTimeout(() => (selectMenuOpen = false), 280)
          }}
        >
          {#each [['atom', 'Atom'], ['residue', 'Residue'], ['chain', 'Chain'], ['molecule', 'Molecule']] as [key, label]}
            <button
              type="button"
              class="viz-toolbar-menu-item {editMode && editSelectionLevel === key
                ? 'viz-toolbar-menu-item-active'
                : ''}"
              onclick={() => {
                if (editMode && editSelectionLevel === key) {
                  editMode = false
                } else {
                  adoptEditStructureFromPanel()
                  editSelectionLevel = key
                  editMode = true
                }
                selectMenuOpen = false
              }}
            >
              {#if editMode && editSelectionLevel === key}
                <svg viewBox="0 0 16 16" class="size-3 shrink-0 fill-orange-400" aria-hidden="true"
                  ><path
                    d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"
                  /></svg
                >
              {:else}
                <span class="size-3 shrink-0"></span>
              {/if}
              {label}
            </button>
          {/each}
          <p class="px-3 py-1 text-[10px] leading-snug text-neutral-500">
            {structure?.label
              ? `Only ${structure.label}. Other copies with the same chain stay unselected.`
              : 'Only the active structure.'}
          </p>
          <div class="viz-toolbar-menu-sep"></div>
          <button
            type="button"
            class="viz-toolbar-menu-item"
            onclick={() => {
              selectMenuOpen = false
              adoptEditStructureFromPanel()
              customSelInput = ''
              customSelError = ''
              dlgCustomSel?.showModal()
            }}
          >
            <span class="size-3 shrink-0"></span>
            Custom (MDAnalysis…)
          </button>
          {#if editMode}
            <div class="viz-toolbar-menu-sep"></div>
            <button
              type="button"
              class="viz-toolbar-menu-item"
              onclick={() => {
                editMode = false
                selectMenuOpen = false
              }}>Exit edit mode</button
            >
          {/if}
        </div>
      {/if}
    </div>

    <!-- Transform ▾ (includes Edit structure operations, hover to open) -->
    <div class="relative shrink-0">
      <button
        type="button"
        bind:this={editMenuBtnEl}
        class="flex h-[22px] items-center gap-0.5 whitespace-nowrap rounded border border-neutral-300 bg-neutral-100 px-2 py-0 text-neutral-700 transition-colors hover:border-neutral-400 hover:bg-neutral-200 disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:border-neutral-600 dark:hover:bg-neutral-800"
        onpointerenter={() => {
          clearTimeout(_editMenuHoverTimer)
          if (filePath && !editBusy) editMenuOpen = true
        }}
        onpointerleave={() => {
          _editMenuHoverTimer = setTimeout(() => (editMenuOpen = false), 280)
        }}
        onclick={() => {
          openMenuOpen = false
          selectMenuOpen = false
          toolsMenuOpen = false
          editMenuOpen = !editMenuOpen
        }}
        disabled={!filePath || editBusy}
        title="Transform / Edit structure">Transform ▾</button
      >
      {#if editMenuOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="viz-toolbar-menu"
          style={toolbarMenuFixedStyle(editMenuBtnEl)}
          onpointerenter={() => clearTimeout(_editMenuHoverTimer)}
          onpointerleave={() => {
            _editMenuHoverTimer = setTimeout(() => (editMenuOpen = false), 280)
          }}
        >
          <!-- Transform dialog -->
          <button
            type="button"
            class="viz-toolbar-menu-item"
            onclick={() => {
              editMenuOpen = false
              previewPositions = null
              const selStr = _selStringFromEditSelection()
              if (selStr) {
                tfSel = selStr
                tfAlignPrimSel = selStr
              }
              dlgTransform?.showModal()
            }}>Transform (rotate / translate / align)…</button
          >
          <div class="viz-toolbar-menu-sep"></div>
          <!-- Edit structure operations -->
          <div class="viz-toolbar-menu-label">Edit structure</div>
          <button
            type="button"
            class="viz-toolbar-menu-item"
            onclick={() => {
              editMenuOpen = false
              dlgRenameChain?.showModal()
            }}>Rename Chain…</button
          >
          <button
            type="button"
            class="viz-toolbar-menu-item"
            onclick={() => {
              editMenuOpen = false
              dlgRenameRes?.showModal()
            }}>Rename Residues…</button
          >
          <button
            type="button"
            class="viz-toolbar-menu-item"
            onclick={() => {
              editMenuOpen = false
              dlgRenumberRes?.showModal()
            }}>Renumber Residues…</button
          >
          <div class="viz-toolbar-menu-sep"></div>
          <button
            type="button"
            class="viz-toolbar-menu-item viz-toolbar-menu-item-danger"
            onclick={() => {
              editMenuOpen = false
              dlgDeleteAtoms?.showModal()
            }}>Delete Atoms…</button
          >
        </div>
      {/if}
    </div>

    <!-- Tools dropdown (MemPro + Packmol) -->
    <div class="relative shrink-0">
      <button
        type="button"
        bind:this={toolsMenuBtnEl}
        class="flex h-[22px] items-center whitespace-nowrap rounded border border-neutral-300 bg-neutral-100 px-2 py-0 text-neutral-700 transition-colors hover:border-neutral-400 hover:bg-neutral-200 disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:border-neutral-600 dark:hover:bg-neutral-800"
        disabled={!filePath || editBusy}
        onpointerenter={() => {
          clearTimeout(_toolsMenuHoverTimer)
          if (filePath && !editBusy) toolsMenuOpen = true
        }}
        onpointerleave={() => {
          _toolsMenuHoverTimer = setTimeout(() => (toolsMenuOpen = false), 280)
        }}
        onclick={() => {
          openMenuOpen = false
          selectMenuOpen = false
          editMenuOpen = false
          toolsMenuOpen = !toolsMenuOpen
        }}
        title="Structure tools">Tools ▾</button
      >
      {#if toolsMenuOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="viz-toolbar-menu"
          style={toolbarMenuFixedStyle(toolsMenuBtnEl)}
          onpointerenter={() => clearTimeout(_toolsMenuHoverTimer)}
          onpointerleave={() => {
            _toolsMenuHoverTimer = setTimeout(() => (toolsMenuOpen = false), 280)
          }}
        >
          <button type="button" class="viz-toolbar-menu-item" onclick={openMemproDialog}
            >MemPro orientation</button
          >
          <button
            type="button"
            class="viz-toolbar-menu-item"
            onclick={() => openPackmolDialog()}>Packmol hydration</button
          >
          <button
            type="button"
            class="viz-toolbar-menu-item {trajAlignOpen ? 'viz-toolbar-menu-item-on' : ''}"
            disabled={!trajStructure?.trajectory}
            onclick={openTrajAlignPanel}
            title="Calculate RMSD or align the loaded trajectory"
          >
            Align / RMSD…
          </button>
          <button
            type="button"
            class="viz-toolbar-menu-item {animateMode ? 'viz-toolbar-menu-item-on' : ''}"
            disabled={!structure || animExporting}
            onclick={toggleAnimateMode}
            title="Keyframe animation: capture views and export video"
          >
            {animateMode ? 'Animate (on)' : 'Animate'}
          </button>
          <button
            type="button"
            class="viz-toolbar-menu-item {mutateOpen ? 'viz-toolbar-menu-item-on' : ''}"
            disabled={!structure}
            onclick={openMutateDialog}
            title="Preview Dunbrack rotamers and replace one side chain"
          >
            Mutate residue…
          </button>
          <button
            type="button"
            class="viz-toolbar-menu-item {splitOpen ? 'viz-toolbar-menu-item-on' : ''}"
            disabled={!structure}
            onclick={openSplitDialog}
            title="Copy one chain into a new structure"
          >
            Split chain…
          </button>
          <button
            type="button"
            class="viz-toolbar-menu-item {superOpen ? 'viz-toolbar-menu-item-on' : ''}"
            disabled={structures.length < 2}
            onclick={openSuperimposeDialog}
            title="Superimpose one loaded structure onto another"
          >
            Superimpose…
          </button>
          <button
            type="button"
            class="viz-toolbar-menu-item"
            disabled={structures.length < 2 || mergeBusy}
            onclick={() => {
              toolsMenuOpen = false
              mergeSelectedStructures()
            }}
            title="Merge the structures selected in the panel into one PDB. Originals stay loaded. The same chain letter is kept when the residues are different kinds, such as protein and ions."
          >
            Merge structures
          </button>
        </div>
      {/if}
    </div>

    <div class="h-4 w-px shrink-0 bg-neutral-300 dark:bg-neutral-700"></div>

    <!-- Save PDB -->
    <button
      type="button"
      class="flex h-[22px] shrink-0 items-center whitespace-nowrap rounded border border-neutral-300 bg-neutral-100 px-2 py-0 text-neutral-700 transition-colors hover:border-neutral-400 hover:bg-neutral-200 disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:border-neutral-600 dark:hover:bg-neutral-800"
      onclick={onSavePdb}
      disabled={!filePath}
      title={coordsDirty
        ? 'Save working coordinates to PDB (unsaved transforms in memory)'
        : 'Save current PDB file'}>Save PDB{coordsDirty ? ' •' : ''}</button
    >

    <!-- Save Image -->
    <button
      type="button"
      class="flex h-[22px] shrink-0 items-center whitespace-nowrap rounded border border-neutral-300 bg-neutral-100 px-2 py-0 text-neutral-700 transition-colors hover:border-neutral-400 hover:bg-neutral-200 disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:border-neutral-600 dark:hover:bg-neutral-800"
      onclick={onSaveImage}
      disabled={!structure}
      title="Save viewport as PNG image">Save Image</button
    >

    <div class="min-w-3 flex-1 shrink"></div>

    <!-- Clear scene (structure + representations); distinct from status-bar "Clear chips" -->
    <button
      type="button"
      class="flex h-[22px] shrink-0 items-center whitespace-nowrap rounded border border-red-300 bg-red-50 px-2 py-0 text-red-600 transition-colors hover:border-red-400 hover:bg-red-100 hover:text-red-700 disabled:opacity-40 dark:border-red-900/40 dark:bg-neutral-900 dark:text-red-400/70 dark:hover:border-red-700/60 dark:hover:bg-red-900/20 dark:hover:text-red-300"
      onclick={clearWorkspace}
      disabled={!structure && views.length === 0 && !filePath}
      title="Clear scene — remove structure and all representations"
      >Clear scene</button
    >
  </div>
</div>

<!-- Radial context menu (replaces old rectangular right-click menu) -->
{#if ctxMenu}
  {@const atom = ctxMenu.atom}
  {@const ctxGroupIndices = editMode
    ? selectedGroupIndices.size > 0
      ? selectedGroupIndices
      : new Set(_editGroupIndices(atom, editSelectionLevel))
    : null}
  {@const infoTitle =
    editMode && ctxGroupIndices
      ? `${atom.res_name}${atom.res_id} · Chain ${atom.chain_id}`
      : `${atom.res_name}${atom.res_id} · ${atom.name}`}
  {@const infoSub =
    editMode && ctxGroupIndices
      ? `${ctxGroupIndices.size} atom${ctxGroupIndices.size !== 1 ? 's' : ''} selected`
      : `${atom.element} · #${atom.index}`}
  <RadialMenu
    x={ctxMenu.x}
    y={ctxMenu.y}
    items={_buildRadialItems(atom, ctxGroupIndices)}
    info={{ title: infoTitle, subtitle: infoSub }}
    onclose={() => (ctxMenu = null)}
  />
{/if}
<!-- Edit dialogs -->

<ViewerSettingsDialog bind:open={sceneSettingsOpen} />

<dialog
  bind:this={dlgRenameChain}
  class="rounded-lg border border-neutral-300 bg-white p-0 text-neutral-900 shadow-2xl backdrop:bg-black/60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
>
  <form
    method="dialog"
    class="min-w-72 p-4"
    onsubmit={(e) => {
      e.preventDefault()
      onEditRenameChain()
    }}
  >
    <h3 class="mb-3 text-sm font-semibold">Rename Chain</h3>
    {#if selectedGroupIndices.size > 0}
      <label class="mb-3 flex items-center gap-2 text-xs">
        <input type="checkbox" class="accent-yellow-500" bind:checked={rcApplyToSel} />
        <span class="text-neutral-300">Apply to selection ({selectedGroupIndices.size} atoms)</span>
      </label>
    {/if}
    <div class="space-y-2">
      {#if !rcApplyToSel}
        <label class="flex items-center gap-2 text-xs">
          <span class="w-24 text-neutral-400">Old chain ID</span>
          <input
            type="text"
            maxlength="1"
            class="w-20 field-input uppercase"
            bind:value={rcOldChain}
          />
        </label>
      {/if}
      <label class="flex items-center gap-2 text-xs">
        <span class="w-24 text-neutral-400">New chain ID</span>
        <input
          type="text"
          maxlength="1"
          class="w-20 field-input uppercase"
          bind:value={rcNewChain}
          required
        />
      </label>
    </div>
    <div class="mt-4 flex justify-end gap-2">
      <button
        type="button"
        class="dialog-btn-outline"
        onclick={() => dlgRenameChain?.close()}>Cancel</button
      >
      <button
        type="submit"
        class="flex items-center gap-1 rounded bg-yellow-600 px-3 py-1 text-xs font-semibold text-black hover:bg-yellow-500 disabled:opacity-40"
        disabled={editBusy || !rcNewChain || (!rcApplyToSel && !rcOldChain)}
        >{#if editBusy}<Spinner />{/if} Apply</button
      >
    </div>
  </form>
</dialog>

<dialog
  bind:this={dlgRenameRes}
  class="rounded-lg border border-neutral-300 bg-white p-0 text-neutral-900 shadow-2xl backdrop:bg-black/60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
>
  <form
    method="dialog"
    class="min-w-72 p-4"
    onsubmit={(e) => {
      e.preventDefault()
      onEditRenameResidues()
    }}
  >
    <h3 class="mb-3 text-sm font-semibold">Rename Residues</h3>
    {#if selectedGroupIndices.size > 0}
      <label class="mb-3 flex items-center gap-2 text-xs">
        <input type="checkbox" class="accent-yellow-500" bind:checked={rrApplyToSel} />
        <span class="text-neutral-300">Apply to selection ({selectedGroupIndices.size} atoms)</span>
      </label>
    {/if}
    <div class="space-y-2">
      {#if !rrApplyToSel}
        <label class="flex items-center gap-2 text-xs">
          <span class="w-24 text-neutral-400">Chain ID</span>
          <input
            type="text"
            maxlength="1"
            class="w-20 field-input uppercase"
            bind:value={rrChain}
          />
        </label>
        <label class="flex items-center gap-2 text-xs">
          <span class="w-24 text-neutral-400">Residue range</span>
          <input
            type="number"
            class="w-16 field-input"
            bind:value={rrStart}
          />
          <span class="text-neutral-500">–</span>
          <input
            type="number"
            class="w-16 field-input"
            bind:value={rrEnd}
          />
        </label>
      {/if}
      <label class="flex items-center gap-2 text-xs">
        <span class="w-24 text-neutral-400">New name</span>
        <input
          type="text"
          maxlength="4"
          class="w-20 field-input uppercase"
          bind:value={rrNewName}
          required
        />
      </label>
    </div>
    <div class="mt-4 flex justify-end gap-2">
      <button
        type="button"
        class="dialog-btn-outline"
        onclick={() => dlgRenameRes?.close()}>Cancel</button
      >
      <button
        type="submit"
        class="flex items-center gap-1 rounded bg-yellow-600 px-3 py-1 text-xs font-semibold text-black hover:bg-yellow-500 disabled:opacity-40"
        disabled={editBusy || !rrNewName || (!rrApplyToSel && !rrChain)}
        >{#if editBusy}<Spinner />{/if} Apply</button
      >
    </div>
  </form>
</dialog>

<dialog
  bind:this={dlgRenumberRes}
  class="rounded-lg border border-neutral-300 bg-white p-0 text-neutral-900 shadow-2xl backdrop:bg-black/60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
>
  <form
    method="dialog"
    class="min-w-72 p-4"
    onsubmit={(e) => {
      e.preventDefault()
      onEditRenumberResidues()
    }}
  >
    <h3 class="mb-3 text-sm font-semibold">Renumber Residues</h3>
    {#if selectedGroupIndices.size > 0}
      <label class="mb-3 flex items-center gap-2 text-xs">
        <input type="checkbox" class="accent-yellow-500" bind:checked={rnApplyToSel} />
        <span class="text-neutral-300">Apply to selection ({selectedGroupIndices.size} atoms)</span>
      </label>
    {/if}
    <div class="space-y-2">
      {#if !rnApplyToSel}
        <label class="flex items-center gap-2 text-xs">
          <span class="w-24 text-neutral-400">Chain ID</span>
          <input
            type="text"
            maxlength="1"
            class="w-20 field-input uppercase"
            bind:value={rnChain}
          />
        </label>
        <label class="flex items-center gap-2 text-xs">
          <span class="w-24 text-neutral-400">Residue range</span>
          <input
            type="number"
            class="w-16 field-input"
            bind:value={rnStart}
          />
          <span class="text-neutral-500">–</span>
          <input
            type="number"
            class="w-16 field-input"
            bind:value={rnEnd}
          />
        </label>
      {/if}
      <label class="flex items-center gap-2 text-xs">
        <span class="w-24 text-neutral-400">New start</span>
        <input
          type="number"
          class="w-20 field-input"
          bind:value={rnNewStart}
          required
        />
      </label>
    </div>
    <div class="mt-4 flex justify-end gap-2">
      <button
        type="button"
        class="dialog-btn-outline"
        onclick={() => dlgRenumberRes?.close()}>Cancel</button
      >
      <button
        type="submit"
        class="flex items-center gap-1 rounded bg-yellow-600 px-3 py-1 text-xs font-semibold text-black hover:bg-yellow-500 disabled:opacity-40"
        disabled={editBusy || (!rnApplyToSel && !rnChain)}
        >{#if editBusy}<Spinner />{/if} Apply</button
      >
    </div>
  </form>
</dialog>

<dialog
  bind:this={dlgDeleteAtoms}
  class="rounded-lg border border-neutral-300 bg-white p-0 text-neutral-900 shadow-2xl backdrop:bg-black/60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
>
  <form
    method="dialog"
    class="min-w-72 p-4"
    onsubmit={(e) => {
      e.preventDefault()
      onEditDeleteAtoms()
    }}
  >
    <h3 class="mb-3 text-sm font-semibold">Delete Atoms</h3>
    <div class="space-y-2">
      <label class="flex flex-col gap-1 text-xs">
        <span class="text-neutral-400">MDAnalysis selection</span>
        <input
          type="text"
          class="w-full field-input"
          bind:value={daSelection}
          placeholder="water"
          required
        />
        <span class="text-neutral-500">Examples: water · protein · resname LIG · name H*</span>
      </label>
    </div>
    <div class="mt-4 flex justify-end gap-2">
      <button
        type="button"
        class="dialog-btn-outline"
        onclick={() => dlgDeleteAtoms?.close()}>Cancel</button
      >
      <button
        type="submit"
        class="flex items-center gap-1 rounded bg-red-700 px-3 py-1 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-40"
        disabled={editBusy || !daSelection}
        >{#if editBusy}<Spinner />{/if} Delete</button
      >
    </div>
  </form>
</dialog>

<dialog
  bind:this={dlgTransform}
  class="rounded-lg border border-neutral-300 bg-white p-0 text-neutral-900 shadow-2xl backdrop:bg-black/60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
>
  <!-- Header -->
  <div class="flex items-center justify-between border-b dialog-divider px-4 py-2.5">
    <h3 class="text-sm font-semibold">Transform Structure</h3>
    {#if previewPositions}
      <span class="rounded bg-yellow-500/15 px-1.5 py-0.5 text-[10px] text-yellow-700 dark:text-yellow-400"
        >● Preview active</span
      >
    {/if}
    <button
      type="button"
      class="ml-2 text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
      onclick={() => {
        previewPositions = null
        dlgTransform?.close()
      }}>✕</button
    >
  </div>

  <!-- Tabs -->
  <div class="flex border-b dialog-divider text-xs">
    {#each ['rotate', 'translate', 'align'] as tab}
      <button
        type="button"
        class="px-4 py-2 transition-colors {transformTab === tab
          ? 'border-b-2 border-yellow-500 text-yellow-700 dark:border-yellow-400 dark:text-yellow-300'
          : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200'}"
        onclick={() => (transformTab = tab)}>{tab[0].toUpperCase() + tab.slice(1)}</button
      >
    {/each}
  </div>

  <div class="w-[420px] space-y-3 p-4">
    <!-- ── Shared selection row (rotate / translate) ── -->
    {#if transformTab !== 'align'}
      <div class="flex items-center gap-2">
        <label for="tf-sel" class="dialog-label w-20 shrink-0 text-xs">Selection</label>
        <input
          id="tf-sel"
          type="text"
          class="min-w-0 flex-1 field-input"
          bind:value={tfSel}
          placeholder="all atoms"
        />
        {#if tfSel.trim()}
          <span class="shrink-0 text-xs text-neutral-500">
            {tfSelCount !== null ? `${tfSelCount} atoms` : '…'}
          </span>
        {/if}
      </div>
    {/if}

    <!-- ── Rotate tab ── -->
    {#if transformTab === 'rotate'}
      <div class="flex items-center gap-2">
        <label for="tf-angle" class="dialog-label w-20 shrink-0 text-xs">Angle</label>
        <input
          id="tf-angle"
          type="number"
          step="any"
          class="w-20 field-input"
          bind:value={tfRotAngle}
          placeholder="0"
        />
        <span class="text-xs text-neutral-500">°</span>
        <div class="flex gap-0.5">
          {#each [90, 180, -90, 270] as a}
            <button
              type="button"
              class="rounded border border-neutral-300 px-1 py-0.5 text-[10px] text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              onclick={() => (tfRotAngle = a)}>{a}°</button
            >
          {/each}
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span class="w-20 shrink-0 text-xs dialog-label">Axis</span>
        <div class="flex gap-3">
          {#each ['x', 'y', 'z'] as ax}
            <label class="flex cursor-pointer items-center gap-1 text-xs">
              <input type="radio" bind:group={tfRotAxis} value={ax} class="accent-yellow-400" />
              {ax.toUpperCase()}
            </label>
          {/each}
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span class="w-20 shrink-0 text-xs dialog-label">Center</span>
        <div class="flex gap-3">
          <label class="flex cursor-pointer items-center gap-1 text-xs">
            <input
              type="radio"
              bind:group={tfRotCenter}
              value="selection"
              class="accent-yellow-400"
            />
            Centroid of selection
          </label>
          <label class="flex cursor-pointer items-center gap-1 text-xs">
            <input type="radio" bind:group={tfRotCenter} value="origin" class="accent-yellow-400" />
            Origin (0,0,0)
          </label>
        </div>
      </div>
    {/if}

    <!-- ── Translate tab ── -->
    {#if transformTab === 'translate'}
      <div class="flex items-center gap-1">
        <span class="w-20 shrink-0 text-xs dialog-label">Displacement</span>
        {#each [['X', 'tfTx'], ['Y', 'tfTy'], ['Z', 'tfTz']] as [lbl, field]}
          <span class="text-xs text-neutral-500">{lbl}</span>
          {#if field === 'tfTx'}
            <input
              type="number"
              step="any"
              class="w-16 field-input"
              bind:value={tfTx}
              placeholder="0"
            />
          {:else if field === 'tfTy'}
            <input
              type="number"
              step="any"
              class="w-16 field-input"
              bind:value={tfTy}
              placeholder="0"
            />
          {:else}
            <input
              type="number"
              step="any"
              class="w-16 field-input"
              bind:value={tfTz}
              placeholder="0"
            />
          {/if}
        {/each}
        <span class="text-xs text-neutral-500">Å</span>
      </div>
      <div>
        <button
          type="button"
          class="dialog-btn-outline flex items-center gap-1 disabled:opacity-40"
          disabled={editBusy}
          onclick={onCenterAtOrigin}
          title="Translate so the centroid of the selection is at origin (0,0,0)"
          >Center at origin</button
        >
      </div>
    {/if}

    <!-- ── Align tab ── -->
    {#if transformTab === 'align'}
      <!-- Primary selection -->
      <div class="flex items-center gap-2">
        <label for="tf-align-prim" class="dialog-label w-28 shrink-0 text-xs"
          >Primary selection</label
        >
        <input
          id="tf-align-prim"
          type="text"
          class="min-w-0 flex-1 field-input"
          bind:value={tfAlignPrimSel}
          placeholder="protein  (required)"
        />
        {#if tfAlignPrimSel.trim()}
          <span class="shrink-0 text-xs text-neutral-500">
            {tfAlignPrimCount !== null ? `${tfAlignPrimCount} atoms` : '…'}
          </span>
        {/if}
      </div>
      <div class="flex items-center gap-2">
        <span class="w-28 shrink-0 text-xs dialog-label">Target axis</span>
        <div class="flex gap-3">
          {#each ['x', 'y', 'z'] as ax}
            <label class="flex cursor-pointer items-center gap-1 text-xs">
              <input
                type="radio"
                bind:group={tfAlignTargetAxis}
                value={ax}
                class="accent-yellow-400"
              />
              {ax.toUpperCase()}
            </label>
          {/each}
        </div>
      </div>
      <div class="border-t border-neutral-200 pt-2 dark:border-neutral-800/60">
        <p class="mb-1.5 text-[10px] text-neutral-500">Secondary alignment (optional)</p>
        <div class="flex items-center gap-2">
          <label for="tf-align-sec" class="dialog-label w-28 shrink-0 text-xs"
            >Secondary sel.</label
          >
          <input
            id="tf-align-sec"
            type="text"
            class="min-w-0 flex-1 field-input"
            bind:value={tfAlignSecSel}
            placeholder="resname LIG  (optional)"
          />
          {#if tfAlignSecSel.trim()}
            <span class="shrink-0 text-xs text-neutral-500">
              {tfAlignSecCount !== null ? `${tfAlignSecCount} atoms` : '…'}
            </span>
          {/if}
        </div>
        <div class="mt-1.5 flex items-center gap-2">
          <span class="w-28 shrink-0 text-xs dialog-label">Secondary axis</span>
          <div class="flex gap-3">
            {#each ['x', 'y', 'z'] as ax}
              <label class="flex cursor-pointer items-center gap-1 text-xs">
                <input
                  type="radio"
                  bind:group={tfAlignSecAxis}
                  value={ax}
                  class="accent-yellow-400"
                />
                {ax.toUpperCase()}
              </label>
            {/each}
          </div>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <label for="tf-align-applyto" class="dialog-label w-28 shrink-0 text-xs"
          >Apply transform to</label
        >
        <input
          id="tf-align-applyto"
          type="text"
          class="min-w-0 flex-1 field-input"
          bind:value={tfAlignApplyTo}
          placeholder="all atoms  (default)"
        />
      </div>
    {/if}
  </div>

  <!-- Footer -->
  <div class="flex items-center justify-end gap-2 border-t dialog-divider px-4 py-3">
    <button
      type="button"
      class="dialog-btn-outline"
      onclick={() => {
        previewPositions = null
        dlgTransform?.close()
      }}>Cancel</button
    >
    <button
      type="button"
      class="dialog-btn-outline flex items-center gap-1 bg-neutral-100 hover:bg-neutral-200 disabled:opacity-40 dark:bg-neutral-800 dark:hover:bg-neutral-700"
      disabled={tfPreviewBusy || !filePath}
      onclick={onTransformPreview}
      title="Preview the transformation without saving"
      >{#if tfPreviewBusy}<Spinner />{/if} Preview</button
    >
    <button
      type="button"
      class="flex items-center gap-1 rounded bg-yellow-600 px-3 py-1 text-xs font-semibold text-black hover:bg-yellow-500 disabled:opacity-40"
      disabled={editBusy || !filePath}
      onclick={onTransformApply}
      >{#if editBusy}<Spinner />{/if} Apply</button
    >
  </div>
</dialog>

{#if mutateOpen}
  <MutateResiduePanel
    chains={activeChainIds}
    chain={mutateChain}
    resid={mutateResid}
    currentResname={mutateCurrentResname}
    mutateTo={mutateTo}
    rotamers={mutateRows}
    selectedIndex={mutateSelected}
    phi={mutatePhi}
    psi={mutatePsi}
    busy={mutateBusy}
    error={mutateError}
    trajectory={!!structure?.trajectory}
    onChain={(value) => {
      mutateChain = value
      mutateRows = []
      clearMutPreview()
      scheduleMutateResidueFocus()
    }}
    onResid={(value) => {
      mutateResid = value
      mutateRows = []
      clearMutPreview()
      scheduleMutateResidueFocus()
    }}
    onMutateTo={(value) => {
      mutateTo = value
      mutateRows = []
      clearMutPreview()
    }}
    onList={() => void onMutateList()}
    onSelect={onMutateSelect}
    onApply={() => void onMutateApply()}
    onClose={closeMutateDialog}
  />
{/if}

{#if splitOpen}
  <SplitChainPanel
    chains={activeChainIds}
    chain={splitChainId}
    busy={splitBusy}
    error={splitError}
    trajectory={!!structure?.trajectory}
    onChain={(value) => (splitChainId = value)}
    onSplit={() => void onSplitChain()}
    onClose={() => (splitOpen = false)}
  />
{/if}

{#if superOpen}
  <SuperimposePanel
    structures={superimposeChoices}
    referenceId={superRefId}
    mobileId={superMobId}
    referenceChain={superRefChain}
    mobileChain={superMobChain}
    busy={superBusy}
    error={superError}
    result={superResult}
    onReference={onSuperRefChange}
    onMobile={onSuperMobChange}
    onReferenceChain={(value) => (superRefChain = value)}
    onMobileChain={(value) => (superMobChain = value)}
    onApply={() => void onSuperimpose()}
    onClose={() => (superOpen = false)}
  />
{/if}

{#if trajAlignOpen}
  <TrajAlignPanel
    selection={trajAlign.selection}
    referenceFrame={trajAlign.referenceFrame}
    currentFrame={Math.round(trajPlayhead)}
    frameCount={trajStructure?.trajectory?.logicalFrameCount ?? 0}
    mode={trajAlign.mode}
    rmsd={trajAlign.rmsd}
    nMobile={trajAlign.nMobile}
    atomCount={trajAlignAtomCount}
    busy={trajAlignBusy}
    error={trajAlignError}
    onClose={() => (trajAlignOpen = false)}
    onComputeRmsd={() => void computeTrajRmsdOrAlign('rmsd')}
    onAlign={() => void computeTrajRmsdOrAlign('align')}
    onClear={clearTrajAlignment}
    onSelectionChange={(sel) => {
      trajAlign = { ...trajAlign, selection: sel }
      scheduleTrajAlignCount()
    }}
    onReferenceChange={(frame) => {
      const n = trajStructure?.trajectory?.logicalFrameCount ?? 1
      trajAlign = {
        ...trajAlign,
        referenceFrame: Math.max(0, Math.min(n - 1, Math.round(Number(frame) || 0)))
      }
    }}
    onSeekFrame={(frame) => {
      if (trajPlaying) rebaseTrajClock(frame)
      void seekTrajFrame(frame)
    }}
    onUseCurrentFrame={() => {
      trajAlign = { ...trajAlign, referenceFrame: Math.round(trajPlayhead) }
    }}
  />
{/if}

<!-- MemPro orientation panel (non-modal — viewer stays interactive) -->
{#if memproDialogOpen}
  <div
    class="viewer-side-panel--nonmodal fixed top-10 bottom-10 left-16 z-50 flex w-[520px] max-w-[calc(100vw-5rem)] flex-col overflow-hidden rounded-lg border border-neutral-300 bg-white p-0 text-neutral-900 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
    role="dialog"
    aria-labelledby="mempro-panel-title"
  >
  <!-- Header -->
  <div class="flex items-center justify-between border-b dialog-divider px-4 py-2.5">
    <h3 id="mempro-panel-title" class="text-sm font-semibold">MemPro Orientation</h3>
    <button
      type="button"
      class="text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
      onclick={closeMemproDialog}>✕</button
    >
  </div>

  {#if !workingDir}
    <div class="gw-notice gw-notice-warning mx-4 mb-2">
      No working directory selected. Set one in the top bar to save MemPro job state. You can still run
      MemPro, but you will be asked to confirm and results may not persist after restart.
    </div>
  {/if}

  {#if memproJobStatus === 'running'}
    <!-- Running -->
    <div class="flex flex-1 flex-col items-center gap-3 overflow-y-auto px-6 py-8 text-center">
      <Spinner className="size-6" />
      <p class="text-sm">Running MemPro orientation…</p>
      <p class="text-xs text-neutral-400">
        This may take several minutes depending on the structure size.
      </p>
      <p class="font-mono text-xs text-neutral-500">
        Iterations: {memproNIters} · Grid: {memproGridSize}
      </p>
    </div>
  {:else if memproJobStatus === 'done'}
    <!-- Results -->
    <div class="min-h-0 flex-1 overflow-y-auto p-4">
      <p class="mb-2 text-xs text-neutral-600 dark:text-neutral-400">
        Orientation results — Apply transforms the loaded structure (keeps ligands, water, etc.):
      </p>
      <div class="overflow-x-auto rounded border border-neutral-200 dark:border-neutral-800">
        <table class="w-full text-xs">
          <thead>
            <tr class="border-b border-neutral-200 text-left text-neutral-600 dark:border-neutral-800 dark:text-neutral-500">
              <th class="px-2 py-1">Rank</th>
              <th class="px-2 py-1">Rel. Potential</th>
              <th class="px-2 py-1">Hits %</th>
              <th class="px-2 py-1">Re-rank</th>
              <th class="px-2 py-1">Depth</th>
              <th class="px-2 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {#each memproResults as r}
              <tr class="border-b border-neutral-200/80 hover:bg-neutral-100 dark:border-neutral-800/50 dark:hover:bg-neutral-800/30">
                <td class="px-2 py-1 font-semibold text-yellow-700 dark:text-yellow-400">#{r.rank}</td>
                <td class="px-2 py-1 font-mono">{r.relative_potential?.toFixed(3) ?? '—'}</td>
                <td class="px-2 py-1 font-mono">{r.hits_pct?.toFixed(1) ?? '—'}%</td>
                <td class="px-2 py-1 font-mono">{r.rerank_value?.toFixed(3) ?? '—'}</td>
                <td class="px-2 py-1 font-mono">{r.rerank_depth?.toFixed(2) ?? '—'} Å</td>
                <td class="px-2 py-1">
                  <button
                    type="button"
                    class="flex items-center gap-1 rounded bg-yellow-600 px-2 py-0.5 text-xs font-semibold text-black hover:bg-yellow-500 disabled:opacity-40"
                    disabled={editBusy}
                    onclick={() => onMemproApply(r)}
                    >{#if editBusy}<Spinner />{/if} Apply</button
                  >
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {:else if memproJobStatus === 'error'}
    <!-- Error -->
    <div class="flex-1 overflow-y-auto p-4">
      <p class="mb-1 text-xs text-neutral-600 dark:text-neutral-400">MemPro failed:</p>
      <p class="gw-notice gw-notice-error font-mono">
        {memproError}
      </p>
    </div>
  {:else}
    <!-- Setup form -->
    <div class="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4">
      <div class="flex items-center gap-2">
        <label for="mp-iters" class="dialog-label w-36 shrink-0 text-xs">Iterations</label>
        <input
          id="mp-iters"
          type="number"
          min="10"
          class="w-20 field-input"
          bind:value={memproNIters}
        />
      </div>
      <div class="flex items-center gap-2">
        <label for="mp-grid" class="dialog-label w-36 shrink-0 text-xs">Grid size</label>
        <input
          id="mp-grid"
          type="number"
          min="4"
          class="w-20 field-input"
          bind:value={memproGridSize}
        />
      </div>
      <div class="flex items-center gap-2">
        <label for="mp-memthick" class="dialog-label w-36 shrink-0 text-xs"
          >Membrane thickness (Å)</label
        >
        <input
          id="mp-memthick"
          type="number"
          step="any"
          class="w-20 field-input"
          bind:value={memproMembrane}
          placeholder="auto"
        />
      </div>
      <div class="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-1">
        {#each [['memproDualMembrane', 'Dual membrane'], ['memproPeripheral', 'Peripheral protein'], ['memproUseWeights', 'Use weights'], ['memproFlip', 'Flip orientation']] as [field, label]}
          <label class="flex cursor-pointer items-center gap-1.5 text-xs">
            {#if field === 'memproDualMembrane'}
              <input type="checkbox" bind:checked={memproDualMembrane} class="accent-yellow-400" />
            {:else if field === 'memproPeripheral'}
              <input type="checkbox" bind:checked={memproPeripheral} class="accent-yellow-400" />
            {:else if field === 'memproUseWeights'}
              <input type="checkbox" bind:checked={memproUseWeights} class="accent-yellow-400" />
            {:else}
              <input type="checkbox" bind:checked={memproFlip} class="accent-yellow-400" />
            {/if}
            {label}
          </label>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Footer -->
  <div class="flex items-center justify-between border-t dialog-divider px-4 py-3">
    <div>
      {#if memproJobStatus === 'done'}
        <button
          type="button"
          class="dialog-btn-outline"
          onclick={() => {
            memproJobId = null
            memproJobStatus = null
            memproResults = []
            memproError = null
          }}>New run</button
        >
      {/if}
    </div>
    <div class="flex gap-2">
      {#if !memproJobStatus || memproJobStatus === 'error'}
        <button
          type="button"
          class="flex items-center gap-1 rounded bg-yellow-600 px-3 py-1 text-xs font-semibold text-black hover:bg-yellow-500 disabled:opacity-40"
          disabled={memproBusy || !filePath}
          onclick={onMemproRun}
          >{#if memproBusy}<Spinner />{/if} Run MemPro</button
        >
      {/if}
      <button type="button" class="dialog-btn-outline" onclick={closeMemproDialog}>Close</button>
    </div>
  </div>
  </div>
{/if}

{#snippet packmolJobsHistory()}
  <div class="mt-3 border-t dialog-divider pt-3">
    <div class="mb-1.5 flex items-center justify-between">
      <h4 class="font-semibold text-neutral-700 dark:text-neutral-300">Hydration outputs</h4>
      <button
        type="button"
        class="text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
        title="Refresh list"
        onclick={refreshPackmolJobs}
        aria-label="Refresh hydration outputs">↻</button
      >
    </div>
    {#if !workingDir}
      <p class="text-[11px] text-neutral-500">Select a working directory to see saved outputs.</p>
    {:else if packmolJobs.length === 0}
      <p class="text-[11px] text-neutral-500">
        No hydration outputs yet. Fill a cavity or run a custom job to create one.
      </p>
    {:else}
      <div class="space-y-1.5">
        {#each packmolJobs as job (job.job_dir)}
          <div class="sidebar-panel rounded-md p-2 text-[11px]">
            <div class="flex items-center justify-between gap-2">
              <div class="flex min-w-0 items-center gap-1.5">
                {#if job.success && job.output_exists}
                  <span class="inline-block h-2 w-2 shrink-0 rounded-full bg-green-500"></span>
                {:else if job.success}
                  <span
                    class="inline-block h-2 w-2 shrink-0 rounded-full bg-yellow-500"
                    title="Marked complete but output file missing"
                  ></span>
                {:else}
                  <span class="inline-block h-2 w-2 shrink-0 rounded-full bg-red-500"></span>
                {/if}
                <span class="truncate font-semibold" title={job.job_dir}>{job.name}</span>
                <span
                  class="shrink-0 rounded bg-neutral-200 px-1 text-[9px] uppercase text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                  >{job.type}</span
                >
              </div>
              <button
                type="button"
                class="dialog-btn-outline shrink-0 px-2 py-0.5 text-[10px] disabled:opacity-40"
                disabled={!job.output_exists}
                onclick={() => onPackmolLoadJob(job.output_pdb)}>Load</button
              >
            </div>
            <p class="mt-1 break-all text-neutral-500 dark:text-neutral-400">
              <span class="font-mono">{job.output_pdb_name || '(no output)'}</span>
              {#if job.n_waters}· {job.n_waters} waters{/if}
              {#if job.volumes?.free_volume_A3 != null}
                · {job.volumes.free_volume_A3.toFixed(0)} Å³ free
              {/if}
            </p>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

{#snippet packmolResultBlock()}
  {#if packmolResultPath}
    <div class="gw-notice gw-notice-success">
      <p class="font-semibold">PACKMOL run complete</p>
      <p class="mt-0.5 break-all font-mono text-[11px] text-neutral-600 dark:text-neutral-400">{packmolResultPath}</p>
    </div>
  {/if}
{/snippet}

<!-- Packmol hydration panel (non-modal — viewer stays interactive for box placement) -->
{#if packmolDialogOpen}
  <div
    class="viewer-side-panel--nonmodal fixed top-10 bottom-10 left-16 z-50 flex w-[520px] max-w-[calc(100vw-5rem)] flex-col overflow-hidden rounded-lg border border-neutral-300 bg-white p-0 text-neutral-900 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
    role="dialog"
    aria-labelledby="packmol-panel-title"
  >
  <div class="flex items-center justify-between border-b dialog-divider px-4 py-2.5">
    <div>
      <h3 id="packmol-panel-title" class="text-sm font-semibold">Packmol Hydration</h3>
      <p class="text-[10px] text-neutral-500 dark:text-neutral-400">
        Rotate and pan the structure in the viewer while this panel is open.
      </p>
    </div>
    <button
      type="button"
      class="text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
      onclick={closePackmolDialog}>✕</button
    >
  </div>

  <div class="flex border-b dialog-divider text-xs">
    <button
      type="button"
      class="px-4 py-2 {packmolTab === 'hydrate'
        ? 'border-b-2 border-yellow-500 font-semibold'
        : 'text-neutral-500'}"
      onclick={() => (packmolTab = 'hydrate')}>Hydrate cavity</button
    >
    <button
      type="button"
      class="px-4 py-2 {packmolTab === 'custom'
        ? 'border-b-2 border-yellow-500 font-semibold'
        : 'text-neutral-500'}"
      onclick={() => (packmolTab = 'custom')}>Custom input</button
    >
  </div>

  <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4 text-xs">
    {#if !workingDir}
      <div class="gw-notice gw-notice-warning mb-3">
        No working directory selected. Set one in the top bar before running Packmol when possible.
        You can still fill or run custom input; you will be asked to confirm, and output will go next
        to the input PDB.
      </div>
    {/if}

    {#if packmolAvailable && !packmolAvailable.available}
      <div class="gw-notice gw-notice-error mb-3">
        PACKMOL not found. Install AmberTools (e.g. <code class="font-mono">conda install -c conda-forge ambertools</code>).
      </div>
    {/if}

    {#if packmolHydrogenStatus === 'none' || packmolHydrogenStatus === 'partial'}
      <div class="gw-notice gw-notice-info mb-3">
        No (or minimal) hydrogens on protein. Using inflated exclusion radii to leave room for H added in Builder.
      </div>
    {/if}

    {#if packmolError}
      <p class="mb-2 text-red-600 dark:text-red-400">{packmolError}</p>
    {/if}

    {#if packmolTab === 'hydrate'}
      <div class="space-y-3">
        <div class="grid grid-cols-3 gap-2">
          <div class="col-span-3 flex flex-col gap-0.5">
            <span class="text-neutral-500">Box min (Å)</span>
            <div class="flex gap-1">
              <label class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="text-[10px] font-bold leading-none" style="color:{VIEWER_AXES[0].color}"
                  >{VIEWER_AXES[0].label}</span
                >
                <input
                  type="number"
                  step="0.1"
                  class="field-input w-full"
                  style={axisInputStyle(VIEWER_AXES[0].color)}
                  bind:value={packmolBoxMin.x}
                />
              </label>
              <label class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="text-[10px] font-bold leading-none" style="color:{VIEWER_AXES[1].color}"
                  >{VIEWER_AXES[1].label}</span
                >
                <input
                  type="number"
                  step="0.1"
                  class="field-input w-full"
                  style={axisInputStyle(VIEWER_AXES[1].color)}
                  bind:value={packmolBoxMin.y}
                />
              </label>
              <label class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="text-[10px] font-bold leading-none" style="color:{VIEWER_AXES[2].color}"
                  >{VIEWER_AXES[2].label}</span
                >
                <input
                  type="number"
                  step="0.1"
                  class="field-input w-full"
                  style={axisInputStyle(VIEWER_AXES[2].color)}
                  bind:value={packmolBoxMin.z}
                />
              </label>
            </div>
          </div>
          <div class="col-span-3 flex flex-col gap-0.5">
            <span class="text-neutral-500">Box max (Å)</span>
            <div class="flex gap-1">
              <label class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="text-[10px] font-bold leading-none" style="color:{VIEWER_AXES[0].color}"
                  >{VIEWER_AXES[0].label}</span
                >
                <input
                  type="number"
                  step="0.1"
                  class="field-input w-full"
                  style={axisInputStyle(VIEWER_AXES[0].color)}
                  bind:value={packmolBoxMax.x}
                />
              </label>
              <label class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="text-[10px] font-bold leading-none" style="color:{VIEWER_AXES[1].color}"
                  >{VIEWER_AXES[1].label}</span
                >
                <input
                  type="number"
                  step="0.1"
                  class="field-input w-full"
                  style={axisInputStyle(VIEWER_AXES[1].color)}
                  bind:value={packmolBoxMax.y}
                />
              </label>
              <label class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="text-[10px] font-bold leading-none" style="color:{VIEWER_AXES[2].color}"
                  >{VIEWER_AXES[2].label}</span
                >
                <input
                  type="number"
                  step="0.1"
                  class="field-input w-full"
                  style={axisInputStyle(VIEWER_AXES[2].color)}
                  bind:value={packmolBoxMax.z}
                />
              </label>
            </div>
          </div>
          <label class="flex flex-col gap-0.5">
            <span class="flex flex-wrap items-center gap-1 text-neutral-500">
              Padding (Å)
              <span class="font-semibold">
                {#each VIEWER_AXES as ax, i}
                  {#if i > 0}<span class="text-neutral-400">+</span>{/if}
                  <span style="color:{ax.color}">{ax.label}</span>
                {/each}
              </span>
            </span>
            <input
              type="number"
              step="0.5"
              min="0"
              class="field-input"
              style={PADDING_FIELD_STYLE}
              bind:value={packmolBoxPadding}
            />
          </label>
          <div class="col-span-2 flex items-end gap-1">
            <button type="button" class="dialog-btn-outline flex-1" onclick={fitPackmolBoxToStructure}
              >Fit to structure</button
            >
            <button
              type="button"
              class="dialog-btn-outline flex-1"
              onclick={fitPackmolBoxToSelection}>Fit to selection</button
            >
          </div>
          <p class="col-span-2 text-[10px] text-neutral-500 dark:text-neutral-400">
            Drag a box face to move the cavity; drag a colored handle to resize along
            <span class="font-semibold" style="color:{VIEWER_AXES[0].color}">X</span>,
            <span class="font-semibold" style="color:{VIEWER_AXES[1].color}">Y</span>, or
            <span class="font-semibold" style="color:{VIEWER_AXES[2].color}">Z</span>.
          </p>
        </div>

        <div class="flex flex-wrap gap-3">
          <label class="flex items-center gap-1.5">
            <input type="checkbox" bind:checked={packmolShowBox} class="accent-yellow-400" />
            Show hydration box
          </label>
          <label class="flex items-center gap-1.5">
            <input type="checkbox" bind:checked={packmolShowGhost} class="accent-yellow-400" />
            Ghost water grid
          </label>
        </div>

        {#if packmolVolume}
          <div class="rounded border border-neutral-200 p-2 font-mono dark:border-neutral-800">
            <div>Box: {packmolVolume.box_volume_A3?.toFixed(1)} Å³</div>
            <div>Free: {packmolVolume.free_volume_A3?.toFixed(1)} Å³</div>
            <div>Suggested waters: {packmolVolume.suggested_waters}</div>
            <div>Mode: {packmolExclusionMode || packmolVolume.exclusion_mode}</div>
          </div>
        {/if}

        <div class="grid grid-cols-2 gap-2">
          <label class="flex flex-col gap-0.5">
            <span class="text-neutral-500">Tolerance</span>
            <input type="number" step="0.1" class="field-input" bind:value={packmolTolerance} />
          </label>
          <label class="flex flex-col gap-0.5">
            <span class="text-neutral-500">nloop</span>
            <input type="number" step="1" min="1" class="field-input" bind:value={packmolNloop} />
          </label>
          <label class="flex flex-col gap-0.5">
            <span class="text-neutral-500">Solute radius (Å)</span>
            <input type="number" step="0.1" min="0.5" class="field-input" bind:value={packmolSoluteRadius} />
          </label>
          <label class="flex flex-col gap-0.5">
            <span class="text-neutral-500">Water count</span>
            <input type="number" step="1" min="0" class="field-input" bind:value={packmolNWaters} />
          </label>
          <label class="col-span-2 flex flex-col gap-0.5">
            <span class="text-neutral-500">Output folder</span>
            <input type="text" class="field-input" bind:value={packmolOutputFolder} />
          </label>
        </div>

        {@render packmolResultBlock()}
      </div>
    {:else}
      <div class="space-y-2">
        <div class="flex gap-2">
          <button
            type="button"
            class="dialog-btn-outline flex items-center gap-1.5"
            disabled={packmolPreviewBusy || !filePath || !packmolBoxValid}
            onclick={onPackmolPreviewCustomInp}
          >
            {#if packmolPreviewBusy}<Spinner className="size-3.5" />{/if}
            {packmolPreviewBusy ? 'Loading template…' : 'Load preset template'}
          </button>
        </div>
        <div class="relative">
          <textarea
            class="field-input h-48 w-full font-mono text-[11px]"
            bind:value={packmolCustomInp}
            placeholder="PACKMOL input…"
          ></textarea>
          {#if packmolPreviewBusy}
            <div
              class="absolute inset-0 flex items-center justify-center gap-2 rounded bg-white/70 text-xs text-neutral-600 dark:bg-neutral-900/70 dark:text-neutral-300"
            >
              <Spinner className="size-4" />
              <span>Preparing template…</span>
            </div>
          {/if}
        </div>
        <label class="flex flex-col gap-0.5">
          <span class="text-neutral-500">Output folder</span>
          <input type="text" class="field-input" bind:value={packmolOutputFolder} />
        </label>
        {@render packmolResultBlock()}
      </div>
    {/if}

    {@render packmolJobsHistory()}
  </div>

  <div class="flex flex-wrap justify-end gap-2 border-t dialog-divider px-4 py-2.5">
    {#if packmolTab === 'hydrate'}
      <button
        type="button"
        class="dialog-btn-outline"
        disabled={packmolBusy || !filePath || !packmolBoxValid}
        onclick={onPackmolCalculateVolume}
        >{#if packmolBusy}<Spinner />{/if} Calculate volume</button
      >
      <button
        type="button"
        class="flex items-center gap-1 rounded bg-yellow-600 px-3 py-1 text-xs font-semibold text-black hover:bg-yellow-500 disabled:opacity-40"
        disabled={packmolBusy ||
          !packmolAvailable?.available ||
          !packmolBoxValid ||
          (packmolNWaters < 1 && !(packmolVolume?.suggested_waters > 0))}
        onclick={onPackmolHydrate}
        >{#if packmolBusy}<Spinner />{/if} Fill with water</button
      >
      {#if packmolResultPath}
        <button type="button" class="dialog-btn-outline" onclick={onPackmolLoadResult}
          >Load result</button
        >
      {/if}
    {:else}
      <button
        type="button"
        class="flex items-center gap-1 rounded bg-yellow-600 px-3 py-1 text-xs font-semibold text-black hover:bg-yellow-500 disabled:opacity-40"
        disabled={packmolBusy || !packmolAvailable?.available || !packmolCustomInp.trim()}
        onclick={onPackmolRunCustom}
        >{#if packmolBusy}<Spinner />{/if} Run custom PACKMOL</button
      >
      {#if packmolResultPath}
        <button type="button" class="dialog-btn-outline" onclick={onPackmolLoadResult}
          >Load result</button
        >
      {/if}
    {/if}
    <button type="button" class="dialog-btn-outline" onclick={closePackmolDialog}>Close</button>
  </div>
  </div>
{/if}

<!-- Custom MDAnalysis selection dialog -->
<dialog
  bind:this={dlgCustomSel}
  class="rounded-lg border border-neutral-300 bg-white p-0 text-neutral-900 shadow-2xl backdrop:bg-black/60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
>
  <form
    method="dialog"
    class="min-w-80 p-4"
    onsubmit={(e) => {
      e.preventDefault()
      applyCustomSelection()
    }}
  >
    <h3 class="mb-3 text-sm font-semibold">Custom Selection</h3>
    <div class="space-y-2">
      <label class="flex flex-col gap-1 text-xs">
        <span class="text-neutral-400">MDAnalysis selection string</span>
        <input
          type="text"
          class="w-full field-input"
          bind:value={customSelInput}
          placeholder="resname HOH"
          use:focusOnMount
          required
        />
        <span class="text-neutral-500">Examples: resname HOH · protein · chainID A · name CA</span>
      </label>
      {#if customSelError}
        <p class="text-xs text-red-400">{customSelError}</p>
      {/if}
    </div>
    <div class="mt-4 flex justify-end gap-2">
      <button
        type="button"
        class="dialog-btn-outline"
        onclick={() => {
          dlgCustomSel?.close()
          customSelError = ''
        }}>Cancel</button
      >
      <button
        type="submit"
        class="flex items-center gap-1 rounded bg-yellow-600 px-3 py-1 text-xs font-semibold text-black hover:bg-yellow-500 disabled:opacity-40"
        disabled={customSelBusy || !customSelInput.trim()}
        >{#if customSelBusy}<Spinner />{/if} Select</button
      >
    </div>
  </form>
</dialog>
