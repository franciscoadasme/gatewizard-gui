<script>
  import {
    AxesGizmo,
    AxesLines,
    BallStick,
    CameraRig,
    Canvas,
    Cartoon,
    MeasureOverlay,
    Tube,
    VdwSpheres
  } from '../components/viewer'
  import { mainViewerCamera } from '../components/viewer/CameraRig.svelte'
  import { mainViewerControls } from '../components/viewer/Canvas.svelte'
  import Axes from '../components/icons/Axes.svelte'
  import AxesLinesIcon from '../components/icons/AxesLines.svelte'
  import { COLOR_PALETTE, cpkScheme, defaultColorScheme, ssScheme } from '../lib/colorSchemes.js'
  import { getCameraForAtoms } from '../lib/viewer/base.js'
  import { pickAtomFromViews } from '../lib/viewer/picking.js'
  import { measureDistance, measureAngle, measureDihedral } from '../lib/viewer/measure.js'
  import { Color } from 'three'
  import { untrack } from 'svelte'

  /** Reused Color instance for edit mode selection outline. */
  const OUTLINE_COLOR = new Color(0xffdd00) // yellow → BackSide outline for selected group
  const _outlineGetColor = () => OUTLINE_COLOR
  import {
    getStructure,
    detectMolecules,
    editRenameChain,
    editRenameResidues,
    editRenumberResidues,
    editDeleteAtoms,
    editDeleteByIndices,
    editSavePdb,
    transformCountSelection,
    transformPreview,
    transformApply,
    memproRun,
    memproStatus,
    memproApply
  } from '../lib/backendApi.js'
  import DetectIcon from '../components/icons/Detect.svelte'
  import Empty from '../components/ui/Empty.svelte'
  import Plus from '../components/icons/Plus.svelte'
  import ResetIcon from '../components/icons/Reset.svelte'
  import Spinner from '../components/ui/Spinner.svelte'
  import ViewItem from '../components/ViewItem.svelte'
  import RadialMenu from '../components/RadialMenu.svelte'
  import TransformGizmo from '../components/TransformGizmo.svelte'

  /** @typedef {{ x: number, y: number, z: number, element: string, name: string }} Atom */
  /** @typedef {{ chain: string, resname: string, number: number, atom_indices: number[], ca_index?: number, sec?: string }} Residue */
  /** @typedef {{ type: 'cartoon' | 'ball-stick' | 'vdw' }} Representation */
  /** @typedef {{ name: string, color?: string, resolver: (atom: Atom) => import('three').Color }} ColorScheme */
  /** @typedef {{ id: string, selection: string, representation: Representation, atoms: Atom[], bonds?: [number, number][], residues?: Residue[], visible: boolean, colorScheme: ColorScheme }} View */
  /** @typedef {ReturnType<typeof getCameraForAtoms> & { framingZoom: number, framingGeneration: number, poseResetGeneration: number }} ViewerFraming */

  /** @type {{ workingDir?: string }} */
  let { workingDir = '' } = $props()

  // form fields
  // TODO: do we need filepath? structure.path may be enough
  let filePath = $state(null)
  let pdbId = $state('')

  // state
  let axesLinesVisible = $state(false)
  let axesVisible = $state(false)
  /** @type {ViewerFraming | null} */
  let camera = $state(null)
  let loadingPDB = $state(false)
  /** @type {null | Awaited<ReturnType<typeof getStructure>>} */
  let structure = $state(null)
  /** @type {View[]} */
  let views = $state([])

  // ── Measurement & label state ────────────────────────────────────────
  /** @type {'distance'|'angle'|'dihedral'|null} */
  let measureMode = $state(null)
  /** @type {Atom[]} */
  let measurePicks = $state([])
  /** @type {Array<{ id:string, type:'distance'|'angle'|'dihedral', atoms:Atom[], color:string, size:number, lineWidth:number }>} */
  let measurements = $state([])
  /** @type {Array<{ id:string, atom:Atom, text:string, size:number, color:string }>} */
  let atomLabels = $state([])
  /** @type {{ x:number, y:number, atom:Atom } | null} */
  let ctxMenu = $state(null)
  let canvasWidth = $state(0)
  let canvasHeight = $state(0)
  // Label display settings — captured into each label at creation time
  let labelSize = $state(12)
  let labelColor = $state('#ffffff')
  // Panel section collapse state
  let measExpanded = $state(true)
  let labelsExpanded = $state(true)

  // Right panel resize
  let rightW = $state(240)
  let _rrX = 0,
    _rrW = 0
  function _startRightResize(e) {
    _rrX = e.clientX
    _rrW = rightW
    window.addEventListener('pointermove', _doRightResize)
    window.addEventListener('pointerup', _stopRightResize)
  }
  function _doRightResize(e) {
    rightW = Math.max(160, Math.min(480, _rrW - (e.clientX - _rrX)))
  }
  function _stopRightResize() {
    window.removeEventListener('pointermove', _doRightResize)
    window.removeEventListener('pointerup', _stopRightResize)
  }

  // Gear panel open state
  /** @type {{ kind: 'meas'|'label', id: string } | null} */
  let gearOpen = $state(null)
  function toggleGear(kind, id) {
    gearOpen = gearOpen?.kind === kind && gearOpen.id === id ? null : { kind, id }
  }

  // Bottom toolbar / edit state
  let editMenuOpen = $state(false)
  let editBusy = $state(false)
  /** Hover-open timers for dropdown menus */
  let _selectHoverTimer = null
  let _editMenuHoverTimer = null
  /** @type {HTMLElement | null} */
  let viewerEl = $state(null)

  // ── Interactive Edit Mode ────────────────────────────────────────────
  let editMode = $state(false)
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
  // Rename residues form fields
  let rrChain = $state('')
  let rrStart = $state(1)
  let rrEnd = $state(9999)
  let rrNewName = $state('')
  // Renumber residues form fields
  let rnChain = $state('')
  let rnStart = $state(1)
  let rnEnd = $state(9999)
  let rnNewStart = $state(1)
  // Delete atoms form field
  let daSelection = $state('water')
  // Transform form fields
  let tfRotAngle = $state(0)
  let tfRotAxis = $state('z')
  let tfTx = $state(0)
  let tfTy = $state(0)
  let tfTz = $state(0)
  // Transform enhanced state
  /** @type {HTMLDialogElement | null} */
  let dlgMempro = $state(null)
  let transformTab = $state('rotate') // 'rotate' | 'translate' | 'align'
  /** @type {number[][] | null} positions[atom.index] = [x,y,z] */
  let previewPositions = $state(null)
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

  // MemPro job polling
  $effect(() => {
    if (!memproJobId || memproJobStatus !== 'running') return
    const interval = setInterval(async () => {
      try {
        const r = await memproStatus(memproJobId)
        memproJobStatus = r.status
        if (r.status === 'done') {
          memproResults = r.results
          clearInterval(interval)
        } else if (r.status === 'error') {
          memproError = r.error
          clearInterval(interval)
        }
      } catch {
        /* ignore */
      }
    }, 3000)
    return () => clearInterval(interval)
  })

  async function onAutoGenerateViews() {
    const data = await detectMolecules(filePath)
    views.length = 0
    for (const [i, struc] of data.entries()) {
      const representation = struc.selection === 'protein' ? { type: 'cartoon' } : { type: 'vdw' }
      let colorScheme
      if (struc.selection === 'protein' && struc.residues?.length) {
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
      views.push({
        id: crypto.randomUUID(),
        selection: struc.selection,
        baseSelection: struc.selection,
        representation,
        path: filePath,
        atoms: struc.atoms,
        bonds: struc.bonds,
        residues: struc.residues,
        visible: struc.selection !== 'water',
        colorScheme,
        helixWidth: 1.0,
        sheetWidth: 0.875,
        coilWidth: 0.125,
        ssColors: null,
        tubeRadius: 0.9,
        atomScale: 1.0,
        bondScale: 1.0,
        quality: 3,
        material: { metalness: 0.08, roughness: 0.48, emissiveIntensity: 0.0 }
      })
    }
  }

  async function onFetchPDB() {
    if (!isPdbIdValid) return
    await loadStructure(pdbId)
    if (structure) {
      pdbId = ''
    }
  }

  async function onOpenPdb() {
    const dlg = await window.api.openPdbDialog()
    if (dlg.canceled) {
      return
    }
    await loadStructure(dlg.filePath)
  }

  /** @param {string} selection */
  /** @param {Representation} representation */
  function addView(selection = 'all', representation = { type: 'vdw' }) {
    views.push({
      id: crypto.randomUUID(),
      selection,
      baseSelection: selection,
      representation,
      path: filePath,
      atoms: structure?.atoms,
      bonds: structure?.bonds,
      residues: structure?.residues,
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
      quality: 3,
      material: { metalness: 0.08, roughness: 0.48, emissiveIntensity: 0.0 }
    })
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
  }

  /** @param {string} path */
  async function loadStructure(path, { resetCamera = true } = {}) {
    try {
      loadingPDB = true
      structure = await getStructure({
        path,
        needs_bonds: false,
        needs_secondary_structure: false,
        save_dir: workingDir || null
      })
      filePath = structure.path
      views.length = 0
      measurements = []
      measurePicks = []
      atomLabels = []
      measureMode = null
      ctxMenu = null
      addView('all', { type: 'vdw' })
      if (resetCamera || !camera) {
        const base = getCameraForAtoms(structure.atoms)
        camera = base
          ? { ...base, framingZoom: 1, framingGeneration: 0, poseResetGeneration: 0 }
          : null
      }
    } catch (ex) {
      structure = null
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      loadingPDB = false
    }
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
    // molecule — find the view that contains this atom
    const v = views.find((v) => v.atoms?.some((a) => a.index === atom.index))
    return v?.atoms?.map((a) => a.index) ?? []
  }

  function handleCanvasHover({ x, y, w, h, clientX, clientY }) {
    if (!editMode || measureMode) return
    const cam = mainViewerCamera.current
    if (!cam) return
    const atom = pickAtomFromViews(views, cam, w, h, x, y, 22)
    editHoveredAtom = atom
    editTooltip = atom ? { clientX, clientY } : null
    editHoverGroupIndices = atom ? new Set(_editGroupIndices(atom, editSelectionLevel)) : new Set()
  }

  function onEditModeCenterView() {
    const atoms = structure?.atoms.filter((a) => editHoverGroupIndices.has(a.index))
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
    dlgRenameRes?.showModal()
  }

  /** @param {{ chain_id:string }} atom */
  function onEditModeRenameChain(atom) {
    const a = atom ?? selectedAtom ?? editHoveredAtom
    if (!a) return
    rcOldChain = a.chain_id ?? ''
    rcNewChain = a.chain_id ?? ''
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

  function handleCanvasClick({ x, y, w, h }) {
    ctxMenu = null
    // In edit mode (not measuring): left-click locks the hovered group as selected
    if (editMode && !measureMode) {
      const cam = mainViewerCamera.current
      if (!cam) return
      const atom = pickAtomFromViews(views, cam, w, h, x, y)
      if (atom) {
        selectedAtom = atom
        selectedGroupIndices = new Set(_editGroupIndices(atom, editSelectionLevel))
        showGizmo = false
      } else {
        selectedAtom = null
        selectedGroupIndices = new Set()
        showGizmo = false
      }
      _syncSelHighlightView()
      return
    }
    if (!measureMode) return
    const cam = mainViewerCamera.current
    if (!cam) return
    const atom = pickAtomFromViews(views, cam, w, h, x, y)
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
          color: '#facc15',
          size: 11,
          lineWidth: 1.5
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
    const atom = pickAtomFromViews(views, cam, w, h, x, y)
    if (!atom) return
    ctxMenu = { x: clientX, y: clientY, atom, labelsOpen: false }
  }

  function addAtomLabel(atom, text) {
    atomLabels = [
      ...atomLabels,
      { id: crypto.randomUUID(), atom, text, size: labelSize, color: labelColor }
    ]
    ctxMenu = null
  }

  function removeMeasurement(id) {
    measurements = measurements.filter((m) => m.id !== id)
  }

  function removeAtomLabel(id) {
    atomLabels = atomLabels.filter((l) => l.id !== id)
  }

  function clearAllMeasurements() {
    measurements = []
    measurePicks = []
    gearOpen = null
  }

  function clearAllLabels() {
    atomLabels = []
    gearOpen = null
  }

  function measurementLabel(m) {
    if (m.type === 'distance') return `${measureDistance(m.atoms[0], m.atoms[1]).toFixed(2)} Å`
    if (m.type === 'angle') return `${measureAngle(m.atoms[0], m.atoms[1], m.atoms[2]).toFixed(1)}°`
    return `${measureDihedral(m.atoms[0], m.atoms[1], m.atoms[2], m.atoms[3]).toFixed(1)}°`
  }

  /** @param {string} id */
  function removeView(id) {
    views = views.filter((it) => it.id !== id)
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
    structure = null
    filePath = null
    views = []
    measurements = []
    measurePicks = []
    atomLabels = []
    camera = null
    measureMode = null
    ctxMenu = null
    previewPositions = null
  }

  function onSaveViewpoint() {
    if (!camera) return
    try {
      localStorage.setItem('gw_viewpoint', JSON.stringify(camera))
    } catch {}
  }

  function onLoadViewpoint() {
    try {
      const raw = localStorage.getItem('gw_viewpoint')
      if (!raw) return
      const vp = JSON.parse(raw)
      camera = {
        ...vp,
        framingGeneration: (camera?.framingGeneration ?? 0) + 1,
        poseResetGeneration: (camera?.poseResetGeneration ?? 0) + 1
      }
    } catch {}
  }

  async function onSavePdb() {
    if (!filePath) return
    const r = await window.api.saveFileDialog('Save PDB', [
      { name: 'PDB files', extensions: ['pdb'] }
    ])
    if (!r || r.canceled || !r.filePath) return
    try {
      await editSavePdb({ source: filePath, dest: r.filePath })
      filePath = r.filePath
      if (structure) structure.path = r.filePath
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    }
  }

  async function onSaveImage() {
    const canvas = viewerEl?.querySelector('canvas')
    if (!canvas) return
    const r = await window.api.saveFileDialog('Save Image', [
      { name: 'PNG Image', extensions: ['png'] }
    ])
    if (!r || r.canceled || !r.filePath) return
    const dataUrl = /** @type {HTMLCanvasElement} */ (canvas).toDataURL('image/png')
    const base64 = dataUrl.split(',')[1]
    await window.api.writeBinary(r.filePath, base64)
  }

  async function applyEditResult(result) {
    selectedGroupIndices = new Set()
    selectedAtom = null
    if (views.length === 0) {
      await loadStructure(result.path, { resetCamera: false })
      return
    }
    try {
      loadingPDB = true
      const [newStructure, detected] = await Promise.all([
        getStructure({
          path: result.path,
          needs_bonds: false,
          needs_secondary_structure: false,
          save_dir: workingDir || null
        }),
        detectMolecules(result.path)
      ])
      filePath = newStructure.path
      structure = newStructure
      measurements = []
      measurePicks = []
      atomLabels = []
      measureMode = null
      ctxMenu = null
      // Update each view's path; ViewItem's path $effect will re-fetch atoms
      // preserving all visual settings (representation, colors, etc.)
      for (const v of views) {
        v.atoms = []
        v.bonds = []
        v.residues = []
        v.path = filePath
      }
      // Add views for any newly detected molecule not covered by existing views
      const coveredSels = new Set(views.map((v) => v.baseSelection).filter(Boolean))
      if (!coveredSels.has('all')) {
        for (const [i, mol] of detected.entries()) {
          if (!coveredSels.has(mol.selection)) {
            const repr = mol.selection === 'protein' ? { type: 'cartoon' } : { type: 'vdw' }
            let colorScheme
            if (mol.selection === 'protein' && mol.residues?.length) {
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
            views.push({
              id: crypto.randomUUID(),
              selection: mol.selection,
              baseSelection: mol.selection,
              representation: repr,
              path: filePath,
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
              quality: 3,
              material: { metalness: 0.08, roughness: 0.48, emissiveIntensity: 0.0 }
            })
          }
        }
      }
    } catch (ex) {
      structure = null
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      loadingPDB = false
    }
  }

  async function onEditRenameChain() {
    if (!filePath || !rcOldChain || !rcNewChain) return
    editBusy = true
    try {
      const res = await editRenameChain({
        path: filePath,
        oldChain: rcOldChain,
        newChain: rcNewChain
      })
      dlgRenameChain?.close()
      await applyEditResult(res)
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      editBusy = false
    }
  }

  async function onEditRenameResidues() {
    if (!filePath || !rrChain || !rrNewName) return
    editBusy = true
    try {
      const res = await editRenameResidues({
        path: filePath,
        chainId: rrChain,
        start: rrStart,
        end: rrEnd,
        newName: rrNewName
      })
      dlgRenameRes?.close()
      await applyEditResult(res)
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      editBusy = false
    }
  }

  async function onEditRenumberResidues() {
    if (!filePath || !rnChain) return
    editBusy = true
    try {
      const res = await editRenumberResidues({
        path: filePath,
        chainId: rnChain,
        start: rnStart,
        end: rnEnd,
        newStart: rnNewStart
      })
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
      await applyEditResult(res)
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      editBusy = false
    }
  }

  // ── Preview helper ─────────────────────────────────────────────────
  /**
   * Return atoms with preview positions applied if a preview is active.
   * @param {import('../lib/backendApi.js').View} view
   */
  function viewAtoms(view) {
    if (!previewPositions || !view.atoms) return view.atoms
    return view.atoms.map((a) => {
      const pos = previewPositions[a.index]
      if (!pos) return a
      return { ...a, x: pos[0], y: pos[1], z: pos[2] }
    })
  }

  /**
   * Convert the current interactive selection (yellow highlights) to an
   * MDAnalysis selection string suitable for the transform dialog.
   * Returns '' when there is no selection.
   */
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
    let cx = 0, cy = 0, cz = 0
    for (const a of atoms) {
      const pos = previewPositions?.[a.index]
      cx += pos ? pos[0] : a.x
      cy += pos ? pos[1] : a.y
      cz += pos ? pos[2] : a.z
    }
    const n = atoms.length
    return { x: cx / n, y: cy / n, z: cz / n }
  })

  async function onGizmoTranslate({ axis, delta }) {
    if (!filePath) return
    editBusy = true
    try {
      const sel = _selStringFromEditSelection() || null
      const op =
        axis === 'view'
          ? { type: 'translate', dx: 0, dy: 0, dz: 0 } // view-plane: skip for now
          : {
              type: 'translate',
              dx: axis === 'x' ? delta : 0,
              dy: axis === 'y' ? delta : 0,
              dz: axis === 'z' ? delta : 0
            }
      if (axis === 'view') return
      const r = await transformPreview({ path: filePath, selection: sel, op })
      previewPositions = r.positions
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
      const r = await transformPreview({
        path: filePath,
        selection: sel,
        op: { type: 'rotate', angle, axis, center: 'selection' }
      })
      previewPositions = r.positions
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      editBusy = false
    }
  }

  async function onGizmoApply() {
    if (!filePath || !previewPositions) return
    editBusy = true
    try {
      // Re-apply the last gizmo operation permanently using the transform preview state
      // We use transformApply mirroring the last preview call parameters
      // Since we track these in gizmoLastOp, we can replay them
      const sel = _selStringFromEditSelection() || null
      if (_gizmoLastOp) {
        const res = await transformApply({ path: filePath, selection: sel, op: _gizmoLastOp })
        previewPositions = null
        _gizmoLastOp = null
        await applyEditResult(res)
      }
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      editBusy = false
    }
  }

  /** @type {{ type: string, [k: string]: any } | null} */
  let _gizmoLastOp = null
  /** File path to revert to on Undo (one-level undo for gizmo transforms). */
  let _undoFilePath = $state(null)
  /** Atom positions at the start of a drag gesture (for JS real-time preview). */
  let _dragStartPositions = null
  /** Whether the transform gizmo overlay is shown (toggled via radial menu). */
  let showGizmo = $state(false)
  /** ID of the temporary ball-stick view added for cartoon/tube selections, or null. */
  let selHighlightViewId = $state(null)

  // Gizmo handlers – auto-apply on drag release, one-level undo
  async function _onGizmoTranslate({ axis, delta }) {
    if (axis === 'view') return
    if (!filePath) return
    const op = {
      type: 'translate',
      dx: axis === 'x' ? delta : 0,
      dy: axis === 'y' ? delta : 0,
      dz: axis === 'z' ? delta : 0
    }
    _gizmoLastOp = op
    _dragStartPositions = null
    _undoFilePath = filePath
    editBusy = true
    try {
      const sel = _selStringFromEditSelection() || null
      const res = await transformApply({ path: filePath, selection: sel, op })
      previewPositions = null
      _gizmoLastOp = null
      await applyEditResult(res)
    } catch (ex) {
      _undoFilePath = null
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      editBusy = false
    }
  }

  async function _onGizmoRotate({ axis, angle }) {
    if (!filePath) return
    const op = { type: 'rotate', angle, axis, center: 'selection' }
    _gizmoLastOp = op
    _dragStartPositions = null
    _undoFilePath = filePath
    editBusy = true
    try {
      const sel = _selStringFromEditSelection() || null
      const res = await transformApply({ path: filePath, selection: sel, op })
      previewPositions = null
      _gizmoLastOp = null
      await applyEditResult(res)
    } catch (ex) {
      _undoFilePath = null
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      editBusy = false
    }
  }

  async function onGizmoUndo() {
    if (!_undoFilePath) return
    editBusy = true
    try {
      await applyEditResult({ path: _undoFilePath })
      previewPositions = null
      _undoFilePath = null
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      editBusy = false
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
      let cx = 0, cy = 0, cz = 0
      for (const a of selAtoms) { const [bx, by, bz] = base[a.index]; cx += bx; cy += by; cz += bz }
      cx /= selAtoms.length; cy /= selAtoms.length; cz /= selAtoms.length
      const rad = angle * (Math.PI / 180)
      const cos = Math.cos(rad), sin = Math.sin(rad)
      for (const a of selAtoms) {
        const [bx, by, bz] = base[a.index]
        const dx = bx - cx, dy = by - cy, dz = bz - cz
        let nx, ny, nz
        if (axis === 'x') {
          nx = dx; ny = dy * cos - dz * sin; nz = dy * sin + dz * cos
        } else if (axis === 'y') {
          nx = dx * cos + dz * sin; ny = dy; nz = -dx * sin + dz * cos
        } else {
          nx = dx * cos - dy * sin; ny = dx * sin + dy * cos; nz = dz
        }
        newPos[a.index] = [cx + nx, cy + ny, cz + nz]
      }
    }
    previewPositions = newPos
  }

  // ── Radial context menu helpers ──────────────────────────────────────
  /** Build radial menu items for the given atom context. */
  function _buildRadialItems(atom, ctxGroupIndices) {
    const hasEditSel = editMode && ctxGroupIndices && ctxGroupIndices.size > 0
    const isResOrAtom = editSelectionLevel === 'residue' || editSelectionLevel === 'atom'

    const items = []

    // Slot 0 – top: Center view (always)
    items.push({
      slot: 0,
      label: 'Center view',
      color: '#67e8f9',
      icon: '<path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0m0 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1m0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8m0 1a3 3 0 1 1 0 6 3 3 0 0 1 0-6m0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2"/>',
      action: () => {
        const atoms = structure?.atoms.filter((a) =>
          hasEditSel ? ctxGroupIndices.has(a.index) : a.index === atom.index
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
      // Slot 1 – top-right: Rename residue (residue/atom level only)
      if (isResOrAtom) {
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

      // Slot 3 – bottom-right: Renumber residues (residue/atom level only)
      if (isResOrAtom) {
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

      // Slot 5 – bottom-left: Transform (opens dialog with selection)
      items.push({
        slot: 5,
        label: 'Transform…',
        color: '#818cf8',
        icon: '<path d="M1.5 1a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4A1.5 1.5 0 0 1 1.5 0h4a.5.5 0 0 1 0 1h-4zM10 .5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 16 1.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5zM.5 10a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 0 14.5v-4a.5.5 0 0 1 .5-.5zm15 0a.5.5 0 0 1 .5.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5z"/><path d="M3 6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zm1 0v2h2V6zm5-1a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1zm0 1h2v2H9z"/>',
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

    // Slot 7 – top-left: Toggle gizmo (only when in edit mode with selection)
    if (hasEditSel) {
      items.push({
        slot: 7,
        label: showGizmo ? 'Move (on)' : 'Move',
        color: showGizmo ? '#facc15' : '#94a3b8',
        bgColor: showGizmo ? 'rgba(60,50,0,0.96)' : undefined,
        icon: '<path d="M7.646.146a.5.5 0 0 1 .708 0l2 2a.5.5 0 0 1-.708.708L8.5 1.707V5.5a.5.5 0 0 1-1 0V1.707L6.354 2.854a.5.5 0 1 1-.708-.708zm-6 6a.5.5 0 0 1 .708 0L3.5 7.293V4.5a.5.5 0 0 1 1 0v2.793l1.146-1.147a.5.5 0 1 1 .708.708l-2 2a.5.5 0 0 1-.708 0l-2-2a.5.5 0 0 1 0-.708zm9 0a.5.5 0 0 0-.708 0L9.5 7.293V4.5a.5.5 0 0 0-1 0v2.793l-1.146-1.147a.5.5 0 1 0-.708.708l2 2a.5.5 0 0 0 .708 0l2-2a.5.5 0 0 0 0-.708zM8 11a.5.5 0 0 1 .5.5v3.793l1.146-1.147a.5.5 0 0 1 .708.708l-2 2a.5.5 0 0 1-.708 0l-2-2a.5.5 0 1 1 .708-.708L7.5 15.293V11.5A.5.5 0 0 1 8 11"/>',
        action: () => {
          showGizmo = !showGizmo
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
      (v) => v.visible && (v.representation.type === 'cartoon' || v.representation.type === 'tube')
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
      material: { metalness: 0.08, roughness: 0.48, emissiveIntensity: 0.25 }
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
      const r = await transformPreview({
        path: filePath,
        selection: _buildTransformSel(),
        op: _buildTransformOp()
      })
      previewPositions = r.positions
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
      const res = await transformApply({
        path: filePath,
        selection: _buildTransformSel(),
        op: _buildTransformOp()
      })
      previewPositions = null
      dlgTransform?.close()
      await applyEditResult(res)
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
      const res = await transformApply({ path: filePath, selection: sel, op: { type: 'center' } })
      previewPositions = null
      dlgTransform?.close()
      await applyEditResult(res)
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      editBusy = false
    }
  }

  async function onMemproRun() {
    if (!filePath) return
    memproBusy = true
    try {
      const r = await memproRun({
        path: filePath,
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
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      memproBusy = false
    }
  }

  async function onMemproApply(result) {
    editBusy = true
    try {
      await loadStructure(result.pdb_path)
      dlgMempro?.close()
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : String(ex))
    } finally {
      editBusy = false
    }
  }
</script>

<div class="flex min-w-0 flex-1 flex-col">
  <div class="flex min-h-0 min-w-0 flex-1">
    <div
      class="relative min-h-0 min-w-0 flex-1 bg-black"
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
          <CameraRig framing={camera} />
          {#each views.filter((v) => v.visible) as view (view.id)}
            {#if view.representation.type === 'ball-stick'}
              <BallStick
                atoms={viewAtoms(view)}
                bonds={view.bonds}
                getColor={view.colorScheme.resolver}
                quality={view.quality ?? 3}
                atomScale={view.atomScale ?? 1.0}
                bondScale={view.bondScale ?? 1.0}
                metalness={view.material?.metalness ?? 0.08}
                roughness={view.material?.roughness ?? 0.48}
                emissiveIntensity={view.material?.emissiveIntensity ?? 0.0}
                highlightIndices={editHoverGroupIndices}
              />
            {:else if view.representation.type === 'cartoon'}
              <Cartoon
                atoms={viewAtoms(view)}
                residues={view.residues}
                getColor={view.colorScheme.resolver}
                helixWidth={view.helixWidth ?? 1.0}
                sheetWidth={view.sheetWidth ?? 0.875}
                coilWidth={view.coilWidth ?? 0.125}
                ssColors={view.ssColors}
                quality={view.quality ?? 3}
                metalness={view.material?.metalness ?? 0.08}
                roughness={view.material?.roughness ?? 0.48}
                emissiveIntensity={view.material?.emissiveIntensity ?? 0.0}
                highlightIndices={editHoverGroupIndices}
              />
            {:else if view.representation.type === 'tube'}
              <Tube
                atoms={viewAtoms(view)}
                residues={view.residues}
                getColor={view.colorScheme.resolver}
                tubeRadius={view.tubeRadius ?? 0.9}
                ssColors={view.ssColors}
                quality={view.quality ?? 3}
                metalness={view.material?.metalness ?? 0.08}
                roughness={view.material?.roughness ?? 0.48}
                emissiveIntensity={view.material?.emissiveIntensity ?? 0.0}
                highlightIndices={editHoverGroupIndices}
              />
            {:else if view.representation.type === 'vdw'}
              <VdwSpheres
                atoms={viewAtoms(view)}
                getColor={view.colorScheme.resolver}
                quality={view.quality ?? 3}
                atomScale={view.atomScale ?? 1.0}
                metalness={view.material?.metalness ?? 0.12}
                roughness={view.material?.roughness ?? 0.45}
                emissiveIntensity={view.material?.emissiveIntensity ?? 0.0}
                highlightIndices={editHoverGroupIndices}
              />
            {/if}
          {/each}
          <!-- Edit mode selected outline: scale adapted to the current representation -->
          {#if editSelectedAtoms.length > 0}
            {@const _selIdxSet = new Set(editSelectedAtoms.map((a) => a.index))}
            {#each views.filter((v) => v.visible && !v._isSelHighlight) as _sv}
              {@const _svAtoms = viewAtoms(_sv).filter((a) => _selIdxSet.has(a.index))}
              {#if _svAtoms.length > 0}
                {#if _sv.representation.type === 'vdw'}
                  <VdwSpheres
                    atoms={_svAtoms}
                    getColor={_outlineGetColor}
                    atomScale={(_sv.atomScale ?? 1.0) * 1.06}
                    metalness={0} roughness={0.6} emissiveIntensity={0.05}
                    quality={2} renderOrder={8} opacity={1} outline={true}
                  />
                {:else if _sv.representation.type === 'ball-stick'}
                  <!-- Match covalent radius: BALL_STICK_ATOM_SCALE=0.5, VDW_C=1.7, coval_C=0.76 → ratio≈0.26 with margin -->
                  <VdwSpheres
                    atoms={_svAtoms}
                    getColor={_outlineGetColor}
                    atomScale={(_sv.atomScale ?? 1.0) * 0.30}
                    metalness={0} roughness={0.6} emissiveIntensity={0.05}
                    quality={2} renderOrder={8} opacity={1} outline={true}
                  />
                {:else}
                  <!-- Cartoon / tube: small marker spheres at atom positions -->
                  <VdwSpheres
                    atoms={_svAtoms}
                    getColor={_outlineGetColor}
                    atomScale={(_sv.atomScale ?? 1.0) * 0.24}
                    metalness={0} roughness={0.6} emissiveIntensity={0.05}
                    quality={2} renderOrder={8} opacity={1} outline={true}
                  />
                {/if}
              {/if}
            {/each}
          {/if}
          {#if axesLinesVisible}
            <AxesLines length={camera.extent * 2} />
          {/if}
        </Canvas>
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
          {measurements}
          picks={measurePicks}
          {atomLabels}
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

        <!-- Transform gizmo overlay (shown when atoms are selected in edit mode) -->
        {#if gizmoCentroid && showGizmo && !measureMode && !editBusy}
          <TransformGizmo
            centroid={gizmoCentroid}
            cameraContainer={mainViewerCamera}
            width={canvasWidth}
            height={canvasHeight}
            busy={editBusy}
            previewActive={!!previewPositions}
            undoAvailable={!!_undoFilePath}
            onTranslate={_onGizmoTranslate}
            onRotate={_onGizmoRotate}
            onDragMove={_onGizmoDragMove}
            onReset={onGizmoUndo}
            onApply={onGizmoApply}
          />
        {/if}
      {/if}
    </div>

    <!-- Right-panel resize handle -->
    <div
      class="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-yellow-500/50"
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize panel"
      onpointerdown={_startRightResize}
    ></div>

    <div class="flex shrink-0 flex-col border-l border-neutral-800" style="width:{rightW}px">
      <h2 class="border-b border-neutral-800 p-2 text-xs font-semibold">Representations</h2>
      {#if views.length > 0 || filePath}
        <div class="min-h-0 flex-1 overflow-y-auto">
          {#each views as view, i (view.id)}
            <ViewItem
              bind:view={views[i]}
              onremove={() => removeView(view.id)}
              oncenter={() => centerCameraOnAtoms(view.atoms)}
            />
          {/each}
        </div>
        <div class="flex gap-1 border-t border-neutral-800 p-2">
          {#snippet toolbarBtn(title, onclick, Icon, className)}
            <button
              type="button"
              class="flex size-7 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 transition-colors hover:border-neutral-700 hover:bg-neutral-800 active:translate-y-0.5"
              aria-label={title}
              {title}
              {onclick}
            >
              <Icon {className} />
            </button>
          {/snippet}

          {@render toolbarBtn('Add view', () => addView(), Plus, 'size-3 fill-white')}
          {@render toolbarBtn(
            'Auto-generate representations',
            onAutoGenerateViews,
            DetectIcon,
            'size-4 stroke-2 stroke-white'
          )}
          {@render toolbarBtn(
            axesVisible ? 'Hide axes gizmo' : 'Show axes gizmo',
            () => (axesVisible = !axesVisible),
            Axes,
            `size-4 ${axesVisible ? 'fill-white' : 'fill-neutral-500'}`
          )}
          {@render toolbarBtn(
            axesLinesVisible ? 'Hide axes lines' : 'Show axes lines',
            () => (axesLinesVisible = !axesLinesVisible),
            AxesLinesIcon,
            `size-4 stroke-2 ${axesLinesVisible ? 'opacity-100' : 'opacity-45'}`
          )}
          {@render toolbarBtn('Reset camera', resetCamera, ResetIcon, 'size-3 fill-white')}
          <button
            type="button"
            class="flex h-7 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 px-1.5 text-xs text-neutral-400 transition-colors hover:border-neutral-700 hover:bg-neutral-800 active:translate-y-0.5 disabled:opacity-40"
            title="Save viewpoint"
            aria-label="Save viewpoint"
            onclick={onSaveViewpoint}
            disabled={!camera}>VP↑</button
          >
          <button
            type="button"
            class="flex h-7 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 px-1.5 text-xs text-neutral-400 transition-colors hover:border-neutral-700 hover:bg-neutral-800 active:translate-y-0.5 disabled:opacity-40"
            title="Load saved viewpoint"
            aria-label="Load saved viewpoint"
            onclick={onLoadViewpoint}>VP↓</button
          >
          <!-- Measurement mode buttons -->
          <div class="mx-0.5 h-4 w-px bg-neutral-700"></div>
          {#snippet measureBtn(title, mode)}
            <button
              type="button"
              class="flex size-7 items-center justify-center rounded-lg border transition-colors active:translate-y-0.5
              {measureMode === mode
                ? 'border-yellow-500 bg-yellow-500/10 text-yellow-400'
                : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-700 hover:bg-neutral-800'}"
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
        {#if measurements.length > 0}
          <!-- Measurements collapsible section -->
          <div class="border-t border-neutral-800">
            <div class="flex items-center">
              <button
                class="flex flex-1 items-center justify-between px-2 py-1.5 hover:bg-neutral-800/40"
                onclick={() => (measExpanded = !measExpanded)}
              >
                <span class="text-xs font-semibold text-neutral-300">Measurements</span>
                <span class="text-xs text-neutral-500">{measExpanded ? '▾' : '▸'}</span>
              </button>
              <button
                onclick={clearAllMeasurements}
                class="px-2 py-1.5 text-xs text-neutral-500 hover:text-red-400"
                title="Clear all measurements">&#x2715;</button
              >
            </div>
            {#if measExpanded}
              <div class="max-h-40 space-y-0.5 overflow-y-auto px-1.5 pb-1.5">
                {#each measurements as m (m.id)}
                  <div class="flex flex-col rounded hover:bg-neutral-800/40">
                    <div class="flex items-center gap-1.5 px-1 py-0.5">
                      <span class="shrink-0" style="color:{m.color ?? '#facc15'}">
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
                      <span class="flex-1 font-mono text-xs" style="color:{m.color ?? '#facc15'}"
                        >{measurementLabel(m)}</span
                      >
                      <button
                        onclick={() => toggleGear('meas', m.id)}
                        class="shrink-0 text-xs text-neutral-600 hover:text-neutral-300"
                        title="Settings">&#x2699;</button
                      >
                      <button
                        onclick={() => removeMeasurement(m.id)}
                        class="shrink-0 text-xs text-neutral-600 hover:text-red-400"
                        >&#x2715;</button
                      >
                    </div>
                    {#if gearOpen?.kind === 'meas' && gearOpen.id === m.id}
                      <div class="space-y-1 border-t border-neutral-800/60 px-2 py-1">
                        <div class="flex items-center gap-1.5">
                          <span class="text-xs text-neutral-500">Color</span>
                          <input
                            type="color"
                            bind:value={m.color}
                            class="size-5 cursor-pointer rounded border-0 bg-transparent p-0"
                          />
                        </div>
                        <div class="flex items-center gap-1.5">
                          <span class="text-xs text-neutral-500">Size</span>
                          <input
                            type="range"
                            min="8"
                            max="24"
                            step="1"
                            bind:value={m.size}
                            class="h-1 flex-1 accent-yellow-400"
                          />
                          <span class="w-5 text-right text-xs text-neutral-400 tabular-nums"
                            >{m.size}</span
                          >
                        </div>
                        <div class="flex items-center gap-1.5">
                          <span class="text-xs text-neutral-500">Line</span>
                          <input
                            type="range"
                            min="0.5"
                            max="4"
                            step="0.5"
                            bind:value={m.lineWidth}
                            class="h-1 flex-1 accent-yellow-400"
                          />
                          <span class="w-5 text-right text-xs text-neutral-400 tabular-nums"
                            >{m.lineWidth}</span
                          >
                        </div>
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
        <!-- Labels collapsible section (always shown when structure loaded) -->
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
                onclick={clearAllLabels}
                class="px-2 py-1.5 text-xs text-neutral-500 hover:text-red-400"
                title="Clear all labels">&#x2715;</button
              >
            {/if}
          </div>
          {#if labelsExpanded}
            <!-- Size + Color controls -->
            <div class="flex items-center gap-1.5 border-b border-neutral-800/60 px-2 py-1">
              <span class="text-xs text-neutral-500">Size</span>
              <input
                type="range"
                min="8"
                max="24"
                step="1"
                value={labelSize}
                oninput={(e) => {
                  labelSize = +e.target.value
                  for (const l of atomLabels) l.size = labelSize
                }}
                class="h-1 flex-1 accent-yellow-400"
              />
              <span class="w-5 text-right text-xs text-neutral-400 tabular-nums">{labelSize}</span>
              <span class="ml-1 text-xs text-neutral-500">Color</span>
              <input
                type="color"
                value={labelColor}
                oninput={(e) => {
                  labelColor = e.target.value
                  for (const l of atomLabels) l.color = labelColor
                }}
                class="size-5 cursor-pointer rounded border-0 bg-transparent p-0"
              />
            </div>
            {#if atomLabels.length > 0}
              <div class="max-h-32 space-y-0.5 overflow-y-auto px-1.5 pb-1.5">
                {#each atomLabels as l (l.id)}
                  <div class="flex flex-col rounded hover:bg-neutral-800/40">
                    <div class="flex items-center gap-1.5 px-1 py-0.5">
                      <span
                        class="inline-block size-2 shrink-0 rounded-full"
                        style="background:{l.color}"
                      ></span>
                      <span
                        class="flex-1 truncate font-mono text-neutral-300"
                        style="font-size:{l.size}px">{l.text}</span
                      >
                      <button
                        onclick={() => toggleGear('label', l.id)}
                        class="shrink-0 text-xs text-neutral-600 hover:text-neutral-300"
                        title="Settings">&#x2699;</button
                      >
                      <button
                        onclick={() => removeAtomLabel(l.id)}
                        class="shrink-0 text-xs text-neutral-600 hover:text-red-400"
                        >&#x2715;</button
                      >
                    </div>
                    {#if gearOpen?.kind === 'label' && gearOpen.id === l.id}
                      <div class="space-y-1 border-t border-neutral-800/60 px-2 py-1">
                        <input
                          type="text"
                          bind:value={l.text}
                          class="w-full rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-xs text-neutral-200 outline-none"
                        />
                        <div class="flex items-center gap-1.5">
                          <span class="text-xs text-neutral-500">Size</span>
                          <input
                            type="range"
                            min="8"
                            max="24"
                            step="1"
                            bind:value={l.size}
                            class="h-1 flex-1 accent-yellow-400"
                          />
                          <span class="w-5 text-right text-xs text-neutral-400 tabular-nums"
                            >{l.size}</span
                          >
                          <input
                            type="color"
                            bind:value={l.color}
                            class="size-5 cursor-pointer rounded border-0 bg-transparent p-0"
                          />
                        </div>
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          {/if}
        </div>
      {:else}
        <div class="flex-1 p-2">
          <Empty message="Load a PDB file to get started" className="text-sm h-full" />
        </div>
      {/if}
    </div>
  </div>
  <!-- end inner row -->

  <!-- Bottom toolbar -->
  <div
    class="relative flex h-8 shrink-0 items-center gap-1 border-t border-neutral-800 bg-neutral-950 px-2 text-[11px]"
  >
    <!-- Open file -->
    <button
      type="button"
      class="flex items-center gap-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-neutral-300 transition-colors hover:border-neutral-600 hover:bg-neutral-800 active:translate-y-0.5 disabled:opacity-40"
      onclick={onOpenPdb}
      disabled={loadingPDB}
      title="Open PDB file"
    >
      {#if loadingPDB}
        <Spinner />
        Loading…
      {:else}
        <svg viewBox="0 0 16 16" class="size-3 fill-current" aria-hidden="true">
          <path
            d="M1.5 3A1.5 1.5 0 0 0 0 4.5v8A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 14.5 5H7.707l-1.5-1.5H1.5z"
          />
        </svg>
        Open
      {/if}
    </button>
    {#if filePath && !loadingPDB}
      <span class="max-w-36 truncate font-mono text-neutral-400" title={filePath}>
        {filePath.split(/[/\\]/).at(-1)}
      </span>
    {/if}

    <!-- PDB download -->
    <form
      class="flex items-center gap-0.5"
      onsubmit={(e) => {
        e.preventDefault()
        onFetchPDB()
      }}
    >
      <input
        type="text"
        placeholder="1CRN"
        maxlength="4"
        class="w-14 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 font-mono text-[11px] text-neutral-200 uppercase outline-none focus:border-neutral-500"
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
        class="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-neutral-300 transition-colors hover:border-neutral-500 hover:bg-neutral-800 disabled:opacity-40"
        disabled={!isPdbIdValid || loadingPDB}
        title="Download PDB from RCSB">↓ PDB</button
      >
    </form>

    <div class="h-4 w-px bg-neutral-700"></div>

    <!-- Edit Mode: Select dropdown (hover to open, no backdrop) -->
    <div class="relative">
      <button
        type="button"
        class="flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition-colors disabled:opacity-40
          {editMode
          ? 'border-orange-500/60 bg-orange-500/15 text-orange-300 hover:bg-orange-500/25'
          : 'border-neutral-700 bg-neutral-900 text-neutral-400 hover:border-neutral-600 hover:bg-neutral-800 hover:text-neutral-200'}"
        onpointerenter={() => { clearTimeout(_selectHoverTimer); if (filePath) selectMenuOpen = true }}
        onpointerleave={() => { _selectHoverTimer = setTimeout(() => (selectMenuOpen = false), 280) }}
        onclick={() => (selectMenuOpen = !selectMenuOpen)}
        disabled={!filePath}
        title="Interactive selection mode"
      >
        {editMode ? `Select · ${EDIT_LEVEL_LABEL[editSelectionLevel]}` : 'Select'}
        <svg viewBox="0 0 10 6" class="size-2 fill-current opacity-60" aria-hidden="true"
          ><path d="M0 0l5 6 5-6z" /></svg
        >
      </button>
      {#if selectMenuOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="absolute bottom-full left-0 z-50 mb-0.5 min-w-32 overflow-hidden rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-xl"
          onpointerenter={() => clearTimeout(_selectHoverTimer)}
          onpointerleave={() => { _selectHoverTimer = setTimeout(() => (selectMenuOpen = false), 280) }}
        >
          {#each [['atom', 'Atom'], ['residue', 'Residue'], ['chain', 'Chain'], ['molecule', 'Molecule']] as [key, label]}
            <button
              type="button"
              class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors
                {editMode && editSelectionLevel === key
                ? 'bg-orange-500/15 text-orange-300'
                : 'text-neutral-200 hover:bg-neutral-800'}"
              onclick={() => {
                if (editMode && editSelectionLevel === key) {
                  editMode = false
                } else {
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
          {#if editMode}
            <div class="my-0.5 border-t border-neutral-800"></div>
            <button
              type="button"
              class="w-full px-3 py-1.5 text-left text-xs text-neutral-400 hover:bg-neutral-800 hover:text-white"
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
    <div class="relative">
      <button
        type="button"
        class="flex items-center gap-0.5 rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-neutral-300 transition-colors hover:border-neutral-600 hover:bg-neutral-800 disabled:opacity-40"
        onpointerenter={() => { clearTimeout(_editMenuHoverTimer); if (filePath && !editBusy) editMenuOpen = true }}
        onpointerleave={() => { _editMenuHoverTimer = setTimeout(() => (editMenuOpen = false), 280) }}
        onclick={() => (editMenuOpen = !editMenuOpen)}
        disabled={!filePath || editBusy}
        title="Transform / Edit structure">Transform ▾</button
      >
      {#if editMenuOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="absolute bottom-full left-0 z-40 mb-0.5 min-w-44 overflow-hidden rounded border border-neutral-700 bg-neutral-900 py-1 text-[11px] shadow-xl"
          onpointerenter={() => clearTimeout(_editMenuHoverTimer)}
          onpointerleave={() => { _editMenuHoverTimer = setTimeout(() => (editMenuOpen = false), 280) }}
        >
          <!-- Transform dialog -->
          <button
            type="button"
            class="w-full px-3 py-1 text-left hover:bg-neutral-800"
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
          <div class="my-0.5 border-t border-neutral-800"></div>
          <!-- Edit structure operations -->
          <div class="px-3 py-0.5 text-[10px] tracking-wide text-neutral-500 uppercase">
            Edit structure
          </div>
          <button
            type="button"
            class="w-full px-3 py-1 text-left hover:bg-neutral-800"
            onclick={() => {
              editMenuOpen = false
              dlgRenameChain?.showModal()
            }}>Rename Chain…</button
          >
          <button
            type="button"
            class="w-full px-3 py-1 text-left hover:bg-neutral-800"
            onclick={() => {
              editMenuOpen = false
              dlgRenameRes?.showModal()
            }}>Rename Residues…</button
          >
          <button
            type="button"
            class="w-full px-3 py-1 text-left hover:bg-neutral-800"
            onclick={() => {
              editMenuOpen = false
              dlgRenumberRes?.showModal()
            }}>Renumber Residues…</button
          >
          <div class="my-0.5 border-t border-neutral-800"></div>
          <button
            type="button"
            class="w-full px-3 py-1 text-left text-red-400 hover:bg-red-900/20"
            onclick={() => {
              editMenuOpen = false
              dlgDeleteAtoms?.showModal()
            }}>Delete Atoms…</button
          >
        </div>
      {/if}
    </div>

    <!-- MemPro orientation -->
    <button
      type="button"
      class="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-neutral-300 transition-colors hover:border-neutral-600 hover:bg-neutral-800 disabled:opacity-40"
      onclick={() => dlgMempro?.showModal()}
      disabled={!filePath || editBusy}
      title="MemPro membrane protein orientation">MemPro</button
    >

    <div class="h-4 w-px bg-neutral-700"></div>

    <!-- Save PDB -->
    <button
      type="button"
      class="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-neutral-300 transition-colors hover:border-neutral-600 hover:bg-neutral-800 disabled:opacity-40"
      onclick={onSavePdb}
      disabled={!filePath}
      title="Save current PDB file">Save PDB</button
    >

    <!-- Save Image -->
    <button
      type="button"
      class="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-neutral-300 transition-colors hover:border-neutral-600 hover:bg-neutral-800 disabled:opacity-40"
      onclick={onSaveImage}
      disabled={!structure}
      title="Save viewport as PNG image">Save Image</button
    >

    <div class="flex-1"></div>

    <!-- Clear workspace -->
    <button
      type="button"
      class="rounded border border-red-900/40 bg-neutral-900 px-2 py-0.5 text-red-400/70 transition-colors hover:border-red-700/60 hover:bg-red-900/20 hover:text-red-300 disabled:opacity-40"
      onclick={clearWorkspace}
      disabled={!structure}
      title="Clear workspace">Clear</button
    >
  </div>
</div>

<!-- Radial context menu (replaces old rectangular right-click menu) -->
{#if ctxMenu}
  {@const atom = ctxMenu.atom}
  {@const ctxGroupIndices = editMode ? new Set(_editGroupIndices(atom, editSelectionLevel)) : null}
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

<dialog
  bind:this={dlgRenameChain}
  class="rounded-lg border border-neutral-700 bg-neutral-900 p-0 text-neutral-200 shadow-2xl backdrop:bg-black/60"
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
    <div class="space-y-2">
      <label class="flex items-center gap-2 text-xs">
        <span class="w-24 text-neutral-400">Old chain ID</span>
        <input
          type="text"
          maxlength="1"
          class="w-20 rounded bg-neutral-800 px-2 py-1 font-mono text-xs uppercase ring-1 ring-neutral-700 outline-none focus:ring-yellow-500/50"
          bind:value={rcOldChain}
          required
        />
      </label>
      <label class="flex items-center gap-2 text-xs">
        <span class="w-24 text-neutral-400">New chain ID</span>
        <input
          type="text"
          maxlength="1"
          class="w-20 rounded bg-neutral-800 px-2 py-1 font-mono text-xs uppercase ring-1 ring-neutral-700 outline-none focus:ring-yellow-500/50"
          bind:value={rcNewChain}
          required
        />
      </label>
    </div>
    <div class="mt-4 flex justify-end gap-2">
      <button
        type="button"
        class="rounded border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800"
        onclick={() => dlgRenameChain?.close()}>Cancel</button
      >
      <button
        type="submit"
        class="flex items-center gap-1 rounded bg-yellow-600 px-3 py-1 text-xs font-semibold text-black hover:bg-yellow-500 disabled:opacity-40"
        disabled={editBusy || !rcOldChain || !rcNewChain}
        >{#if editBusy}<Spinner />{/if} Apply</button
      >
    </div>
  </form>
</dialog>

<dialog
  bind:this={dlgRenameRes}
  class="rounded-lg border border-neutral-700 bg-neutral-900 p-0 text-neutral-200 shadow-2xl backdrop:bg-black/60"
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
    <div class="space-y-2">
      <label class="flex items-center gap-2 text-xs">
        <span class="w-24 text-neutral-400">Chain ID</span>
        <input
          type="text"
          maxlength="1"
          class="w-20 rounded bg-neutral-800 px-2 py-1 font-mono text-xs uppercase ring-1 ring-neutral-700 outline-none focus:ring-yellow-500/50"
          bind:value={rrChain}
          required
        />
      </label>
      <label class="flex items-center gap-2 text-xs">
        <span class="w-24 text-neutral-400">Residue range</span>
        <input
          type="number"
          class="w-16 rounded bg-neutral-800 px-2 py-1 font-mono text-xs ring-1 ring-neutral-700 outline-none focus:ring-yellow-500/50"
          bind:value={rrStart}
          required
        />
        <span class="text-neutral-500">–</span>
        <input
          type="number"
          class="w-16 rounded bg-neutral-800 px-2 py-1 font-mono text-xs ring-1 ring-neutral-700 outline-none focus:ring-yellow-500/50"
          bind:value={rrEnd}
          required
        />
      </label>
      <label class="flex items-center gap-2 text-xs">
        <span class="w-24 text-neutral-400">New name</span>
        <input
          type="text"
          maxlength="4"
          class="w-20 rounded bg-neutral-800 px-2 py-1 font-mono text-xs uppercase ring-1 ring-neutral-700 outline-none focus:ring-yellow-500/50"
          bind:value={rrNewName}
          required
        />
      </label>
    </div>
    <div class="mt-4 flex justify-end gap-2">
      <button
        type="button"
        class="rounded border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800"
        onclick={() => dlgRenameRes?.close()}>Cancel</button
      >
      <button
        type="submit"
        class="flex items-center gap-1 rounded bg-yellow-600 px-3 py-1 text-xs font-semibold text-black hover:bg-yellow-500 disabled:opacity-40"
        disabled={editBusy || !rrChain || !rrNewName}
        >{#if editBusy}<Spinner />{/if} Apply</button
      >
    </div>
  </form>
</dialog>

<dialog
  bind:this={dlgRenumberRes}
  class="rounded-lg border border-neutral-700 bg-neutral-900 p-0 text-neutral-200 shadow-2xl backdrop:bg-black/60"
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
    <div class="space-y-2">
      <label class="flex items-center gap-2 text-xs">
        <span class="w-24 text-neutral-400">Chain ID</span>
        <input
          type="text"
          maxlength="1"
          class="w-20 rounded bg-neutral-800 px-2 py-1 font-mono text-xs uppercase ring-1 ring-neutral-700 outline-none focus:ring-yellow-500/50"
          bind:value={rnChain}
          required
        />
      </label>
      <label class="flex items-center gap-2 text-xs">
        <span class="w-24 text-neutral-400">Residue range</span>
        <input
          type="number"
          class="w-16 rounded bg-neutral-800 px-2 py-1 font-mono text-xs ring-1 ring-neutral-700 outline-none focus:ring-yellow-500/50"
          bind:value={rnStart}
          required
        />
        <span class="text-neutral-500">–</span>
        <input
          type="number"
          class="w-16 rounded bg-neutral-800 px-2 py-1 font-mono text-xs ring-1 ring-neutral-700 outline-none focus:ring-yellow-500/50"
          bind:value={rnEnd}
          required
        />
      </label>
      <label class="flex items-center gap-2 text-xs">
        <span class="w-24 text-neutral-400">New start</span>
        <input
          type="number"
          class="w-20 rounded bg-neutral-800 px-2 py-1 font-mono text-xs ring-1 ring-neutral-700 outline-none focus:ring-yellow-500/50"
          bind:value={rnNewStart}
          required
        />
      </label>
    </div>
    <div class="mt-4 flex justify-end gap-2">
      <button
        type="button"
        class="rounded border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800"
        onclick={() => dlgRenumberRes?.close()}>Cancel</button
      >
      <button
        type="submit"
        class="flex items-center gap-1 rounded bg-yellow-600 px-3 py-1 text-xs font-semibold text-black hover:bg-yellow-500 disabled:opacity-40"
        disabled={editBusy || !rnChain}
        >{#if editBusy}<Spinner />{/if} Apply</button
      >
    </div>
  </form>
</dialog>

<dialog
  bind:this={dlgDeleteAtoms}
  class="rounded-lg border border-neutral-700 bg-neutral-900 p-0 text-neutral-200 shadow-2xl backdrop:bg-black/60"
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
          class="w-full rounded bg-neutral-800 px-2 py-1 font-mono text-xs ring-1 ring-neutral-700 outline-none focus:ring-yellow-500/50"
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
        class="rounded border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800"
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
  class="rounded-lg border border-neutral-700 bg-neutral-900 p-0 text-neutral-200 shadow-2xl backdrop:bg-black/60"
>
  <!-- Header -->
  <div class="flex items-center justify-between border-b border-neutral-800 px-4 py-2.5">
    <h3 class="text-sm font-semibold">Transform Structure</h3>
    {#if previewPositions}
      <span class="rounded bg-yellow-500/15 px-1.5 py-0.5 text-[10px] text-yellow-400"
        >● Preview active</span
      >
    {/if}
    <button
      type="button"
      class="ml-2 text-neutral-500 hover:text-neutral-200"
      onclick={() => {
        previewPositions = null
        dlgTransform?.close()
      }}>✕</button
    >
  </div>

  <!-- Tabs -->
  <div class="flex border-b border-neutral-800 text-xs">
    {#each ['rotate', 'translate', 'align'] as tab}
      <button
        type="button"
        class="px-4 py-2 transition-colors {transformTab === tab
          ? 'border-b-2 border-yellow-400 text-yellow-300'
          : 'text-neutral-400 hover:text-neutral-200'}"
        onclick={() => (transformTab = tab)}>{tab[0].toUpperCase() + tab.slice(1)}</button
      >
    {/each}
  </div>

  <div class="w-[420px] space-y-3 p-4">
    <!-- ── Shared selection row (rotate / translate) ── -->
    {#if transformTab !== 'align'}
      <div class="flex items-center gap-2">
        <label for="tf-sel" class="w-20 shrink-0 text-xs text-neutral-400">Selection</label>
        <input
          id="tf-sel"
          type="text"
          class="min-w-0 flex-1 rounded bg-neutral-800 px-2 py-1 font-mono text-xs ring-1 ring-neutral-700 outline-none focus:ring-yellow-500/50"
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
        <label for="tf-angle" class="w-20 shrink-0 text-xs text-neutral-400">Angle</label>
        <input
          id="tf-angle"
          type="number"
          step="any"
          class="w-20 rounded bg-neutral-800 px-2 py-1 font-mono text-xs ring-1 ring-neutral-700 outline-none focus:ring-yellow-500/50"
          bind:value={tfRotAngle}
          placeholder="0"
        />
        <span class="text-xs text-neutral-500">°</span>
        <div class="flex gap-0.5">
          {#each [90, 180, -90, 270] as a}
            <button
              type="button"
              class="rounded border border-neutral-700 px-1 py-0.5 text-[10px] hover:bg-neutral-800"
              onclick={() => (tfRotAngle = a)}>{a}°</button
            >
          {/each}
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span class="w-20 shrink-0 text-xs text-neutral-400">Axis</span>
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
        <span class="w-20 shrink-0 text-xs text-neutral-400">Center</span>
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
        <span class="w-20 shrink-0 text-xs text-neutral-400">Displacement</span>
        {#each [['X', 'tfTx'], ['Y', 'tfTy'], ['Z', 'tfTz']] as [lbl, field]}
          <span class="text-xs text-neutral-500">{lbl}</span>
          {#if field === 'tfTx'}
            <input
              type="number"
              step="any"
              class="w-16 rounded bg-neutral-800 px-2 py-1 font-mono text-xs ring-1 ring-neutral-700 outline-none focus:ring-yellow-500/50"
              bind:value={tfTx}
              placeholder="0"
            />
          {:else if field === 'tfTy'}
            <input
              type="number"
              step="any"
              class="w-16 rounded bg-neutral-800 px-2 py-1 font-mono text-xs ring-1 ring-neutral-700 outline-none focus:ring-yellow-500/50"
              bind:value={tfTy}
              placeholder="0"
            />
          {:else}
            <input
              type="number"
              step="any"
              class="w-16 rounded bg-neutral-800 px-2 py-1 font-mono text-xs ring-1 ring-neutral-700 outline-none focus:ring-yellow-500/50"
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
          class="flex items-center gap-1 rounded border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800 disabled:opacity-40"
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
        <label for="tf-align-prim" class="w-28 shrink-0 text-xs text-neutral-400"
          >Primary selection</label
        >
        <input
          id="tf-align-prim"
          type="text"
          class="min-w-0 flex-1 rounded bg-neutral-800 px-2 py-1 font-mono text-xs ring-1 ring-neutral-700 outline-none focus:ring-yellow-500/50"
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
        <span class="w-28 shrink-0 text-xs text-neutral-400">Target axis</span>
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
      <div class="border-t border-neutral-800/60 pt-2">
        <p class="mb-1.5 text-[10px] text-neutral-500">Secondary alignment (optional)</p>
        <div class="flex items-center gap-2">
          <label for="tf-align-sec" class="w-28 shrink-0 text-xs text-neutral-400"
            >Secondary sel.</label
          >
          <input
            id="tf-align-sec"
            type="text"
            class="min-w-0 flex-1 rounded bg-neutral-800 px-2 py-1 font-mono text-xs ring-1 ring-neutral-700 outline-none focus:ring-yellow-500/50"
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
          <span class="w-28 shrink-0 text-xs text-neutral-400">Secondary axis</span>
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
        <label for="tf-align-applyto" class="w-28 shrink-0 text-xs text-neutral-400"
          >Apply transform to</label
        >
        <input
          id="tf-align-applyto"
          type="text"
          class="min-w-0 flex-1 rounded bg-neutral-800 px-2 py-1 font-mono text-xs ring-1 ring-neutral-700 outline-none focus:ring-yellow-500/50"
          bind:value={tfAlignApplyTo}
          placeholder="all atoms  (default)"
        />
      </div>
    {/if}
  </div>

  <!-- Footer -->
  <div class="flex items-center justify-end gap-2 border-t border-neutral-800 px-4 py-3">
    <button
      type="button"
      class="rounded border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800"
      onclick={() => {
        previewPositions = null
        dlgTransform?.close()
      }}>Cancel</button
    >
    <button
      type="button"
      class="flex items-center gap-1 rounded border border-neutral-700 bg-neutral-800 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-700 disabled:opacity-40"
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

<!-- MemPro orientation dialog -->
<dialog
  bind:this={dlgMempro}
  class="rounded-lg border border-neutral-700 bg-neutral-900 p-0 text-neutral-200 shadow-2xl backdrop:bg-black/60"
>
  <!-- Header -->
  <div class="flex items-center justify-between border-b border-neutral-800 px-4 py-2.5">
    <h3 class="text-sm font-semibold">MemPro Orientation</h3>
    <button
      type="button"
      class="text-neutral-500 hover:text-neutral-200"
      onclick={() => dlgMempro?.close()}>✕</button
    >
  </div>

  {#if memproJobStatus === 'running'}
    <!-- Running -->
    <div class="flex w-[380px] flex-col items-center gap-3 px-6 py-8 text-center">
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
    <div class="w-[520px] p-4">
      <p class="mb-2 text-xs text-neutral-400">
        Orientation results — click Apply to load a result:
      </p>
      <div class="overflow-x-auto rounded border border-neutral-800">
        <table class="w-full text-xs">
          <thead>
            <tr class="border-b border-neutral-800 text-left text-neutral-500">
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
              <tr class="border-b border-neutral-800/50 hover:bg-neutral-800/30">
                <td class="px-2 py-1 font-semibold text-yellow-400">#{r.rank}</td>
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
    <div class="w-[380px] p-4">
      <p class="mb-1 text-xs text-red-400">MemPro failed:</p>
      <p class="rounded bg-neutral-800 px-2 py-1.5 font-mono text-xs text-neutral-300">
        {memproError}
      </p>
    </div>
  {:else}
    <!-- Setup form -->
    <div class="w-[380px] space-y-2.5 p-4">
      <div class="flex items-center gap-2">
        <label for="mp-iters" class="w-36 shrink-0 text-xs text-neutral-400">Iterations</label>
        <input
          id="mp-iters"
          type="number"
          min="10"
          class="w-20 rounded bg-neutral-800 px-2 py-1 font-mono text-xs ring-1 ring-neutral-700 outline-none focus:ring-yellow-500/50"
          bind:value={memproNIters}
        />
      </div>
      <div class="flex items-center gap-2">
        <label for="mp-grid" class="w-36 shrink-0 text-xs text-neutral-400">Grid size</label>
        <input
          id="mp-grid"
          type="number"
          min="4"
          class="w-20 rounded bg-neutral-800 px-2 py-1 font-mono text-xs ring-1 ring-neutral-700 outline-none focus:ring-yellow-500/50"
          bind:value={memproGridSize}
        />
      </div>
      <div class="flex items-center gap-2">
        <label for="mp-memthick" class="w-36 shrink-0 text-xs text-neutral-400"
          >Membrane thickness (Å)</label
        >
        <input
          id="mp-memthick"
          type="number"
          step="any"
          class="w-20 rounded bg-neutral-800 px-2 py-1 font-mono text-xs ring-1 ring-neutral-700 outline-none focus:ring-yellow-500/50"
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
  <div class="flex items-center justify-between border-t border-neutral-800 px-4 py-3">
    <div>
      {#if memproJobStatus === 'done'}
        <button
          type="button"
          class="rounded border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800"
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
      <button
        type="button"
        class="rounded border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800"
        onclick={() => dlgMempro?.close()}>Close</button
      >
    </div>
  </div>
</dialog>
