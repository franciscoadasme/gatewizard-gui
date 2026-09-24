<script module>
  /**
   * View IDs added here will have their next path-change-triggered
   * updateStructure() call suppressed (used by applyGizmoResult).
   */
  export const skipNextPathFetch = new Set()
  /**
   * Suppress the next atoms/bonds-driven structure refetch (in-memory coordinate commits).
   * Without this, replacing view.atoms after a transform re-triggers /get-structure and
   * overwrites working coordinates with the on-disk PDB.
   */
  export const skipNextAtomsFetch = new Set()
</script>

<script>
  import {
    constantScheme,
    cpkScheme,
    defaultColorScheme,
    chainScheme,
    goodsellChainScheme,
    residueNatureScheme,
    ssScheme,
    COLOR_PALETTE,
    SS_COLORS_DEFAULT,
    SS_LABELS,
    MATERIAL_PRESETS,
    buildMaterialFromPreset,
    isGoodsellMaterial,
    isGlowingMaterial,
    resolveGlowingMaterial,
    GLOWING_MATERIAL_DEFAULTS,
    GLOWING_UI_SLIDERS,
    GOODSELL_CHAIN_PALETTE_HEX
  } from '../lib/colorSchemes.js'
  import { countGlowPool, selectGlowLightAtoms, clampGlowMaxLights, GLOW_LIGHTS_HARD_MAX } from '../lib/viewer/glowLights.js'
  import { fadeSummary } from '../lib/animation/fade.js'
  import { SPLIT_VIEW_MODES } from '../lib/viewer/splitView.js'
  import {
    NAMED_SELECTION_KEYWORDS,
    bondRepresentationNeedsFetch,
    bondsAreEqual,
    bondsHaveMultiOrder,
    bondsLookSparse,
    localSelectionStillNeedsBonds,
    namedSelectionFromView,
    shouldDeferFullSystemSelection,
    structureFetchSelection
  } from '../lib/viewer/viewSelection.js'
  import { trySubsetBySelection } from '../lib/viewer/dynamicSelection.js'
  import { GLOW_LIGHTS_PERF_WARN } from '../lib/viewer/viewerDiagnostics.js'
  import { viewerBusy } from '../lib/viewer/viewerBusy.svelte.js'
  import { getStructure } from '../lib/backendApi'
  import { structureFetchPath } from '../lib/visualizeStructures.js'
  import { onDestroy, tick, untrack } from 'svelte'
  import Button from './ui/Button.svelte'
  import ColorInput from './ui/ColorInput.svelte'
  import Focus from './icons/Focus.svelte'
  import Gear from './icons/Gear.svelte'
  import Input from './ui/Input.svelte'
  import RangeInput from './ui/RangeInput.svelte'
  import Select from './ui/Select.svelte'
  import Spinner from './ui/Spinner.svelte'
  import { themeState } from '../lib/theme.svelte.js'

  const NAMED_SELECTIONS = [...NAMED_SELECTION_KEYWORDS, 'other']
  /** All heavy atoms + H bonded to O/N/S (hides non-polar hydrogens). Needs bonds. */
  const POLAR_SELECTION =
    '(not element H) or (element H and bonded element O N S)'
  const REPR_TYPES = ['points', 'ball-stick', 'licorice', 'cartoon', 'tube', 'vdw', 'surface']
  const REPR_LABELS = {
    points: 'Points',
    'ball-stick': 'Ball & Stick',
    licorice: 'Licorice',
    cartoon: 'Cartoon',
    tube: 'Tube',
    vdw: 'vdW',
    surface: 'Surface'
  }

  const MDA_HELP = `Basic:
  protein · backbone · nucleic · water
  resname ALA GLY       (residue names)
  resid 1 to 20         (residue numbers)
  name CA CB            (atom names)
  element C N O         (elements)
  all / none

Chain / Segment:
  segid A               (segment / chain A)
  chainID A             (MDAnalysis 2+)

Logic:
  protein and backbone
  protein or nucleic
  not water
  (resid 1 to 10) and name CA

Polar (heavy atoms + polar H only; hides C–H etc.):
  (not element H) or (element H and bonded element O N S)
  (resid 48) and ((not element H) or (element H and bonded element O N S))

Distance:
  around 5.0 protein    (within 5 Å of protein)
  byres (around 5 resname LIG)   (whole residues)

Coordinate clip (use Update each frame on a trajectory):
  byres ((resname PC OL) and prop y < 0)
  protein or byres (lipid and prop y < 0)
  Parentheses matter: (same residue as resname PC) and prop y < 0
  still slices lipids. Wrap the prop test inside byres.`

  /** @typedef {{ x: number, y: number, z: number, element: string, name: string, index?: number, res_name?: string, chain_id?: string }} Atom */
  /** @typedef {{ chain: string, resname: string, number: number, atom_indices: number[], ca_index?: number, sec?: string }} Residue */
  /** @typedef {{ type: 'cartoon' | 'ball-stick' | 'licorice' | 'vdw' | 'tube' | 'points' | 'surface' }} Representation */
  /** @typedef {{ name: string, color?: string, resolver: (atom: Atom) => import('three').Color }} ColorScheme */
  /**
   * @typedef {{
   *   id: string, path: string, selection: string,
   *   representation: Representation,
   *   atoms: Atom[], bonds?: [number,number][], residues?: Residue[],
   *   visible: boolean, colorScheme: ColorScheme,
   *   helixWidth: number, sheetWidth: number, coilWidth: number,
   *   ssColors: Record<string,string>|null,
   *   tubeRadius: number,
   *   atomScale: number,
   *   bondScale: number,
   *   stickRoundness?: number,
   *   pointSize: number,
   *   material: { preset?: string, metalness: number, roughness: number, emissiveIntensity: number },
   *   quality: number,
   *   opacity?: number,
   *   surfaceInflate?: number,
   *   surfaceSource?: 'atoms' | 'backbone',
   *   surfaceSubdivision?: number,
   *   trajSmooth?: number,
   *   trajSmoothRestoreH?: boolean,
   *   selectionEachFrame?: boolean
   * }} View
   */

  /**
   * @type {{
   *   view: View,
   *   onremove: () => void,
   *   onduplicate?: () => void,
   *   onsplitby?: (mode: import('../lib/viewer/splitView.js').SplitViewMode) => void,
   *   oncenter?: () => void,
   *   animateMode?: boolean,
   *   onVisibilityChange?: (visible: boolean) => void,
   *   onSelectionEachFrameChange?: (enabled: boolean) => void,
   *   onTrajSmoothRestoreHChange?: (enabled: boolean) => void,
   *   onFadeEdit?: () => void,
   *   sourceBonds?: [number, number][] | null,
   *   sourceAtoms?: Atom[] | null,
   *   sourceResidues?: Residue[] | null,
   *   topology?: string | null,
   *   selected?: boolean,
   *   onRowSelect?: (e: MouseEvent) => void,
   *   onContextOpen?: (e: MouseEvent) => void,
   *   onCreateGroup?: () => void,
   *   onShowSelection?: () => void,
   *   onHideSelection?: () => void,
   *   hasTrajectory?: boolean
   * }}
   */
  let {
    view = $bindable(),
    hasTrajectory = false,
    onremove,
    onduplicate,
    onsplitby,
    oncenter,
    animateMode = false,
    onVisibilityChange,
    onSelectionEachFrameChange,
    onTrajSmoothRestoreHChange,
    onFadeEdit,
    sourceBonds = null,
    sourceAtoms = null,
    sourceResidues = null,
    topology = null,
    selected = false,
    onRowSelect,
    onContextOpen,
    onCreateGroup,
    onShowSelection,
    onHideSelection
  } = $props()

  let colorPickerOpen = $state(false)
  /** @type {{ x: number, y: number } | null} */
  let rowCtxMenu = $state(null)
  let rowCtxSplitOpen = $state(false)
  let rowCtxMenuPos = $state({ x: 0, y: 0 })
  let rowCtxSplitOpenLeft = $state(true)
  let rowCtxSplitOffsetY = $state(0)
  /** @type {HTMLDivElement | null} */
  let rowCtxMenuEl = $state(null)
  /** @type {HTMLButtonElement | null} */
  let rowCtxSplitTriggerEl = $state(null)
  /** @type {HTMLDivElement | null} */
  let rowCtxSplitSubmenuEl = $state(null)
  /** @type {HTMLDialogElement|null} */
  let gearDialog = $state(null)
  /** @type {HTMLDialogElement|null} */
  let helpDialog = $state(null)

  let colorSchemeName = $state(view.colorScheme.name)
  let constantColorHex = $state(view.colorScheme.color || '#00aaff')
  let invalidSelection = $state(false)
  let loadingStructure = $state(false)
  let namedSelection = $state(namedSelectionFromView(view))
  let gearBackdropPointerDown = $state(false)
  let helpBackdropPointerDown = $state(false)
  // Dialogs are moved to document.body (outside #app), so they need their own .dark class.
  const isDark = $derived(themeState.current === 'dark')
  /** Inline selection edit (double-click the label). */
  let editingSelection = $state(false)
  let selectionDraft = $state('')
  /** @type {HTMLInputElement | null} */
  let selectionInputEl = $state(null)
  /** Ignore stale /get-structure responses when a newer request was started. */
  let structureFetchGen = 0

  function layoutSplitSubmenu() {
    if (!rowCtxSplitTriggerEl || !rowCtxSplitSubmenuEl) return
    const pad = 8
    const trigger = rowCtxSplitTriggerEl.getBoundingClientRect()
    const subW = rowCtxSplitSubmenuEl.offsetWidth || 160
    const subH = rowCtxSplitSubmenuEl.offsetHeight || 160
    const spaceRight = window.innerWidth - trigger.right - pad
    const spaceLeft = trigger.left - pad
    rowCtxSplitOpenLeft = spaceRight < subW ? spaceLeft >= subW || spaceLeft > spaceRight : false
    let offsetY = 0
    const bottom = trigger.top + subH
    if (bottom > window.innerHeight - pad) {
      offsetY = window.innerHeight - pad - bottom
    }
    rowCtxSplitOffsetY = offsetY
  }

  async function layoutRowContextMenu() {
    if (!rowCtxMenu || !rowCtxMenuEl) return
    await tick()
    if (!rowCtxMenu || !rowCtxMenuEl) return
    const pad = 8
    const rect = rowCtxMenuEl.getBoundingClientRect()
    let x = rowCtxMenu.x
    let y = rowCtxMenu.y
    if (x + rect.width > window.innerWidth - pad) {
      x = Math.max(pad, window.innerWidth - rect.width - pad)
    }
    if (y + rect.height > window.innerHeight - pad) {
      y = Math.max(pad, rowCtxMenu.y - rect.height)
    }
    rowCtxMenuPos = { x, y }
    layoutSplitSubmenu()
  }

  async function openSplitSubmenu() {
    rowCtxSplitOpen = true
    await tick()
    layoutSplitSubmenu()
  }

  $effect(() => {
    if (!rowCtxMenu) return
    void rowCtxSplitOpen
    layoutRowContextMenu()
  })

  // ── Reactivity ────────────────────────────────────────────────────────────

  let _selectionEffectReady = false
  let _lastSelection = view.selection
  $effect(() => {
    const sel = view.selection
    if (sel === '' || view._isSelHighlight) {
      _selectionEffectReady = true
      _lastSelection = sel
      return
    }
    // First run (mount / panel remount) must not refetch — atoms are already
    // on the view. Collapse/expand used to destroy these rows and spin surfaces.
    if (!_selectionEffectReady) {
      _selectionEffectReady = true
      _lastSelection = sel
      return
    }
    if (sel === _lastSelection) return
    _lastSelection = sel
    // New selection → allow one densify / bond-order pass again.
    view._bondOrderFetchDone = false
    const tid = setTimeout(() => {
      if (applyLocalSelection(sel) !== 'none') return
      scheduleStructureUpdate()
    }, 500)
    return () => clearTimeout(tid)
  })

  let _pathInitialized = false
  let _lastPath = view.path
  $effect(() => {
    const p = view.path
    if (!_pathInitialized) {
      _pathInitialized = true
      _lastPath = p
      return
    }
    if (p === _lastPath) return
    _lastPath = p
    if (view._isSelHighlight) return
    if (skipNextPathFetch.has(view.id)) {
      skipNextPathFetch.delete(view.id)
      return
    }
    const tid = setTimeout(scheduleStructureUpdate, 300)
    return () => clearTimeout(tid)
  })

  let _namedSelInit = false
  $effect(() => {
    const sel = namedSelection
    untrack(() => {
      if (sel !== 'other') {
        view.selection = ''
        view.baseSelection = sel
      }
      if (!_namedSelInit) {
        _namedSelInit = true
        // Parent (load / auto-generate) already populated atoms — skip redundant fetch.
        if (!view._prefetched && !view.atoms?.length) scheduleStructureUpdate()
        return
      }
      if (sel === 'other' && !String(view.selection || '').trim()) return
      const nextSel = structureFetchSelection(sel, view)
      if (applyLocalSelection(nextSel) !== 'none') return
      scheduleStructureUpdate()
    })
  })

  /**
   * @param {Atom[] | null | undefined} current
   * @param {Atom[] | null | undefined} next
   */
  function sameViewAtoms(current, next) {
    if (current === next) return true
    if (!current || !next || current.length !== next.length) return false
    for (let i = 0; i < current.length; i++) {
      if (current[i]?.index !== next[i]?.index) return false
    }
    return true
  }

  /**
   * @param {Array<{ atom_indices?: number[] }> | null | undefined} current
   * @param {Array<{ atom_indices?: number[] }> | null | undefined} next
   */
  function sameViewResidues(current, next) {
    if (current === next) return true
    if (!current || !next || current.length !== next.length) return false
    for (let i = 0; i < current.length; i++) {
      const left = current[i]?.atom_indices || []
      const right = next[i]?.atom_indices || []
      if (left.length !== right.length) return false
      for (let k = 0; k < left.length; k++) {
        if (left[k] !== right[k]) return false
      }
    }
    return true
  }

  /** @param {Atom[] | undefined | null} atoms */
  function filterSourceBonds(atoms) {
    if (!sourceBonds?.length || !atoms?.length) return null
    const idx = new Set(atoms.map((a) => a.index))
    return sourceBonds.filter(([i, j]) => idx.has(i) && idx.has(j))
  }

  /** @param {Atom[] | undefined | null} atoms @param {unknown[] | undefined | null} bonds */
  function viewBondsLookSparse(atoms, bonds) {
    return bondsLookSparse(atoms?.length || 0, bonds?.length || 0)
  }

  /** @param {string | undefined} type */
  function representationNeedsBonds(type) {
    return type === 'ball-stick' || type === 'licorice'
  }

  /** Prefer bonds already loaded with the full structure (e.g. from prmtop). */
  function tryApplySourceBonds() {
    if (!viewBondsLookSparse(view.atoms, view.bonds)) {
      if (bondsHaveMultiOrder(view.bonds)) return true
      // Dense CONECT pairs without orders: copy Maestro/source triples if available.
      if (bondsHaveMultiOrder(sourceBonds)) {
        const filtered = filterSourceBonds(view.atoms)
        if (filtered?.length) {
          if (!bondsAreEqual(view.bonds, filtered)) view.bonds = filtered
          return true
        }
      }
      // Still may need /get-structure so sidecar orders can be merged.
      return false
    }
    const filtered = filterSourceBonds(view.atoms)
    if (filtered && !viewBondsLookSparse(view.atoms, filtered)) {
      if (!bondsAreEqual(view.bonds, filtered)) view.bonds = filtered
      return bondsHaveMultiOrder(filtered) || !sourceBonds?.length
    }
    return false
  }

  $effect(() => {
    const repr = view.representation.type
    // Track repr / bonds / counts — not the atoms array identity. In-memory coordinate
    // commits replace view.atoms with the same indices; refetching would wipe those edits.
    void sourceBonds
    void sourceAtoms
    void sourceResidues
    void view.bonds
    void view._prefetched
    void view.surfaceSource
    const atomCount = view.atoms?.length ?? 0
    const residueCount = view.residues?.length ?? 0
    void atomCount
    if (skipNextAtomsFetch.has(view.id)) {
      skipNextAtomsFetch.delete(view.id)
      // Drop any in-flight /get-structure so a late disk response cannot
      // overwrite in-memory working coordinates after a transform commit.
      structureFetchGen += 1
      loadingStructure = false
      return
    }
    const needsFetch = untrack(() => {
      const residuesKnown = Boolean(sourceResidues?.length || residueCount > 0)
      if ((repr === 'cartoon' || repr === 'tube') && residueCount === 0) {
        return !residuesKnown && !view._residueFetchDone
      }
      if (repr === 'surface' && view.surfaceSource === 'backbone' && residueCount === 0) {
        return !residuesKnown
      }
      if (representationNeedsBonds(repr)) {
        // Copy parent bond orders once. A residue with only single bonds (Thr, Ile)
        // is not missing data just because the rest of the protein has aromatic bonds.
        // Rewriting view.bonds on every check loops until Svelte aborts.
        tryApplySourceBonds()
        return bondRepresentationNeedsFetch({
          atoms: view.atoms,
          bonds: view.bonds,
          sourceBonds,
          bondOrderFetchDone: view._bondOrderFetchDone
        })
      }
      return false
    })
    if (!needsFetch) return
    scheduleStructureUpdate()
  })

  // Sync panel color controls only when animation playback applies a keyframe (not on user edits).
  $effect(() => {
    const rev = view._animSyncRev
    if (!rev) return
    const cs = untrack(() => view.colorScheme)
    if (!cs?.name) return
    const name = cs.name === 'default' ? 'cpk' : cs.name
    colorSchemeName = name
    if (cs.color) constantColorHex = cs.color
  })

  $effect(() => {
    const name = colorSchemeName
    const color = constantColorHex
    let colorScheme = { name }
    if (name === 'constant') {
      colorScheme.color = color
      colorScheme.resolver = constantScheme(color)
    } else if (name === 'cpk') {
      colorScheme.resolver = cpkScheme()
    } else if (name === 'cpk-carbon') {
      colorScheme.color = color
      colorScheme.resolver = cpkScheme({ carbonColor: color })
    } else if (name === 'chain') {
      colorScheme.resolver = chainScheme()
    } else if (name === 'goodsell') {
      colorScheme.resolver = goodsellChainScheme()
    } else if (name === 'residue_nature') {
      colorScheme.resolver = residueNatureScheme()
    } else if (name === 'ss') {
      const residues = view.residues
      const ssColors = view.ssColors
      colorScheme.name = 'ss'
      colorScheme.resolver = residues?.length ? ssScheme(residues, ssColors ?? {}) : cpkScheme()
    } else {
      colorScheme.name = 'default'
      colorScheme.resolver = defaultColorScheme
    }
    untrack(() => (view.colorScheme = colorScheme))
  })

  // ── API ──────────────────────────────────────────────────────────────────

  /**
   * Subset from the already-loaded structure. Avoids /get-structure on a DCD
   * (which re-serializes the whole trajectory system and spins forever).
   * @param {string} sel
   * @returns {'applied' | 'invalid' | 'none'}
   */
  /** Only a playing trajectory is refused when ``all`` is huge. A PDB entry is not. */
  function trajectoryOwner() {
    return hasTrajectory ? { trajectory: true } : null
  }

  /** Write empty atom lists once. A new [] every effect pass exceeds Svelte's update depth. */
  function clearViewAtomsOnce() {
    if (!view.atoms?.length && !view.bonds?.length && !view.residues?.length) return
    view.atoms = []
    view.bonds = []
    view.residues = []
  }

  function applyLocalSelection(sel) {
    if (view._isSelHighlight) return 'none'
    const pool = sourceAtoms
    if (!pool?.length) return 'none'
    const result = trySubsetBySelection(
      pool,
      sourceBonds ?? view.bonds,
      sourceResidues ?? view.residues,
      sel
    )
    if (result.ok) {
      const query = String(sel || '').trim() || 'all'
      if (
        shouldDeferFullSystemSelection(
          pool.length,
          query,
          trajectoryOwner(),
          view.representation?.type
        )
      ) {
        // Assigning a fresh [] on every pass re-triggers this effect until Svelte aborts.
        clearViewAtomsOnce()
        invalidSelection = false
        loadingStructure = false
        return 'applied'
      }
      const repr = view.representation?.type
      const needsSS =
        repr === 'cartoon' ||
        repr === 'tube' ||
        (repr === 'surface' && view.surfaceSource === 'backbone')
      if (needsSS && !result.residues?.length && !sourceResidues?.length) return 'none'
      if (!sameViewAtoms(view.atoms, result.atoms)) view.atoms = result.atoms
      if (!bondsAreEqual(view.bonds, result.bonds)) view.bonds = result.bonds
      if (!sameViewResidues(view.residues, result.residues)) view.residues = result.residues
      invalidSelection = result.atoms.length === 0
      loadingStructure = false
      return 'applied'
    }
    if (result.invalid) {
      invalidSelection = true
      loadingStructure = false
      return 'invalid'
    }
    return 'none'
  }

  function updateStructure() {
    if (view._isSelHighlight) return
    const fetchSel = structureFetchSelection(namedSelection, view)
    const local = applyLocalSelection(fetchSel)
    const wantsBondsEarly = representationNeedsBonds(view.representation.type)
    const bondsMissing = localSelectionStillNeedsBonds({
      needsBonds: wantsBondsEarly,
      atoms: view.atoms,
      bonds: view.bonds,
      bondOrderFetchDone: view._bondOrderFetchDone
    })
    if (local === 'invalid') return
    if (local === 'applied' && !bondsMissing) return
    const needsResidues =
      (view.representation.type === 'cartoon' ||
        view.representation.type === 'tube' ||
        colorSchemeName === 'ss' ||
        (view.representation.type === 'surface' && view.surfaceSource === 'backbone')) &&
      !(view.residues?.length) &&
      !view._residueFetchDone
    // Atoms for "all" are already on the view after a split/append. Cartoon and tube
    // still need the residue list (Cα + secondary structure), which that load skips.
    if ((fetchSel === 'all' || !fetchSel) && view.atoms?.length && !needsResidues && !bondsMissing) {
      loadingStructure = false
      return
    }
    if (
      shouldDeferFullSystemSelection(
        sourceAtoms?.length ?? view.atoms?.length ?? 0,
        fetchSel,
        trajectoryOwner(),
        view.representation?.type
      )
    ) {
      loadingStructure = false
      return
    }
    const needsSS =
      view.representation.type === 'cartoon' ||
      view.representation.type === 'tube' ||
      colorSchemeName === 'ss' ||
      (view.representation.type === 'surface' && view.surfaceSource === 'backbone')
    const wantsBonds = representationNeedsBonds(view.representation.type)
    // If we already have (or can filter) enough bonds *with orders*, skip densify.
    // Otherwise force needs_bonds so Maestro sidecars can annotate doubles/triples.
    const canReuseBonds =
      wantsBonds && tryApplySourceBonds() && bondsHaveMultiOrder(view.bonds)
    const fetchGen = ++structureFetchGen
    loadingStructure = true
    getStructure({
      path: structureFetchPath(view.path, topology),
      topology: topology || null,
      selection: structureFetchSelection(namedSelection, view),
      needs_bonds: wantsBonds && !canReuseBonds,
      needs_secondary_structure: needsSS
    })
      .then((structure) => {
        if (fetchGen !== structureFetchGen) return
        if (structure.atoms?.length) view.atoms = structure.atoms
        if (structure.bonds?.length) {
          view.bonds = structure.bonds
        } else if (wantsBonds || viewBondsLookSparse(view.atoms, view.bonds)) {
          const filtered = filterSourceBonds(view.atoms)
          if (filtered?.length) view.bonds = filtered
        }
        if (structure.residues?.length) view.residues = structure.residues
        if (needsSS) view._residueFetchDone = true
        if (wantsBonds) view._bondOrderFetchDone = true
        invalidSelection = false
        loadingStructure = false
      })
      .catch(() => {
        if (fetchGen !== structureFetchGen) return
        if (needsSS) view._residueFetchDone = true
        if (wantsBonds) view._bondOrderFetchDone = true
        invalidSelection = true
        loadingStructure = false
      })
  }

  /** Skip redundant /get-structure while auto-generate data is still settling in. */
  function scheduleStructureUpdate() {
    const wantsBonds = representationNeedsBonds(view.representation.type)
    const needsBondsNow =
      wantsBonds && viewBondsLookSparse(view.atoms, view.bonds) && !tryApplySourceBonds()
    // Prefetched dense CONECT without orders still needs a sidecar merge pass.
    const needsBondOrders =
      wantsBonds && !view._bondOrderFetchDone && !bondsHaveMultiOrder(view.bonds)
    const needsResidues =
      (view.representation.type === 'cartoon' ||
        view.representation.type === 'tube' ||
        (view.representation.type === 'surface' && view.surfaceSource === 'backbone')) &&
      !(view.residues?.length) &&
      !view._residueFetchDone
    if (view._prefetched && !needsBondsNow && !needsBondOrders && !needsResidues) return
    if (needsBondsNow || needsBondOrders || needsResidues) view._prefetched = false
    updateStructure()
  }

  $effect(() => {
    if (!view._prefetched) return
    const tid = setTimeout(() => {
      view._prefetched = false
    }, 0)
    return () => clearTimeout(tid)
  })

  // ── Helpers ──────────────────────────────────────────────────────────────

  function cycleRepr() {
    const idx = REPR_TYPES.indexOf(view.representation.type)
    view.representation = { type: REPR_TYPES[(idx + 1) % REPR_TYPES.length] }
  }

  function currentSelectionLabel() {
    if (namedSelection === 'other' && view.selection) return view.selection
    if (namedSelection && namedSelection !== 'other') return namedSelection
    return view.selection || view.baseSelection || 'all'
  }

  function beginSelectionEdit() {
    selectionDraft = currentSelectionLabel()
    editingSelection = true
    requestAnimationFrame(() => {
      selectionInputEl?.focus()
      selectionInputEl?.select()
    })
  }

  function cancelSelectionEdit() {
    editingSelection = false
    selectionDraft = ''
  }

  function commitSelectionEdit() {
    if (!editingSelection) return
    const next = selectionDraft.trim()
    editingSelection = false
    if (!next) {
      selectionDraft = ''
      return
    }
    if (NAMED_SELECTIONS.includes(next) && next !== 'other') {
      namedSelection = next
      view.baseSelection = next
    } else {
      namedSelection = 'other'
      view.selection = next
      view.baseSelection = next
    }
    selectionDraft = ''
  }

  function applyMaterialPreset(preset) {
    view.material = buildMaterialFromPreset(preset)
    if (preset === 'Goodsell') {
      view.colorScheme = { name: 'goodsell', resolver: goodsellChainScheme() }
      colorSchemeName = 'goodsell'
    }
  }

  /** @param {HTMLDialogElement | null} dialog */
  function mountDialogToBody(dialog) {
    if (dialog && dialog.parentElement !== document.body) {
      document.body.appendChild(dialog)
    }
  }

  function openGearDialog() {
    mountDialogToBody(gearDialog)
    gearDialog?.showModal()
  }

  function closeGearDialog() {
    gearDialog?.close()
  }

  function openHelpDialog() {
    mountDialogToBody(helpDialog)
    helpDialog?.showModal()
  }

  function closeHelpDialog() {
    helpDialog?.close()
  }

  /** @param {MouseEvent} event */
  function onGearDialogClick(event) {
    if (event.target === gearDialog && gearBackdropPointerDown) closeGearDialog()
    gearBackdropPointerDown = false
  }

  /** @param {PointerEvent} event */
  function onGearDialogPointerDown(event) {
    gearBackdropPointerDown = event.target === gearDialog
  }

  /** @param {MouseEvent} event */
  function onHelpDialogClick(event) {
    if (event.target === helpDialog && helpBackdropPointerDown) closeHelpDialog()
    helpBackdropPointerDown = false
  }

  /** @param {PointerEvent} event */
  function onHelpDialogPointerDown(event) {
    helpBackdropPointerDown = event.target === helpDialog
  }

  onDestroy(() => {
    if (gearDialog?.open) gearDialog.close()
    if (helpDialog?.open) helpDialog.close()
  })

  const swatchColors = $derived(() => {
    if (colorSchemeName === 'chain') {
      return ['#e6194b', '#3cb44b', '#ffe119', '#0082c8']
    }
    if (colorSchemeName === 'goodsell') {
      return GOODSELL_CHAIN_PALETTE_HEX.slice(0, 4)
    }
    if (colorSchemeName === 'residue_nature') {
      return ['#e6c832', '#dc3c3c', '#4664dc', '#f09632']
    }
    if (colorSchemeName === 'ss') {
      const c = view.ssColors ?? SS_COLORS_DEFAULT
      return [c.H ?? '#7259ea', c.E ?? '#2196a6', c.C ?? '#e8e8e8', c.G ?? '#3fb4ea']
    }
    return null
  })

  const glowingBulbStats = $derived.by(() => {
    if (!isGlowingMaterial(view.material)) return null
    const m = resolveGlowingMaterial(view.material)
    if (!m.glowEmitLight) return { disabled: true }
    const atoms = view.atoms ?? []
    const maxRequested = m.glowMaxLights ?? GLOWING_MATERIAL_DEFAULTS.glowMaxLights
    const maxLights = clampGlowMaxLights(maxRequested)
    const filter = m.glowAtomFilter ?? GLOWING_MATERIAL_DEFAULTS.glowAtomFilter
    if (filter === 'highlighted') {
      return { filter, maxLights, maxRequested, needsSelection: true }
    }
    const pool = countGlowPool(atoms, filter)
    const active = selectGlowLightAtoms(atoms, {
      filter,
      maxLights,
      highlightIndices: new Set()
    }).length
    return {
      filter,
      pool,
      active,
      maxLights,
      maxRequested,
      gpuLimited: maxRequested > GLOW_LIGHTS_HARD_MAX,
      capped: pool > maxLights
    }
  })

  const glowingBulbsHeavy = $derived(
    glowingBulbStats &&
      !glowingBulbStats.disabled &&
      !glowingBulbStats.needsSelection &&
      glowingBulbStats.active > GLOW_LIGHTS_PERF_WARN
  )

  const SWATCH_ATOMS = [
    { element: 'C', name: 'CA', res_name: 'ALA', chain_id: 'A', index: 0 },
    { element: 'H', name: 'H', res_name: 'ALA', chain_id: 'A', index: 1 },
    { element: 'O', name: 'O', res_name: 'ALA', chain_id: 'A', index: 2 },
    { element: 'N', name: 'N', res_name: 'ALA', chain_id: 'A', index: 3 }
  ]
</script>

<!-- ── Main row ─────────────────────────────────────────────────────────────-->
{#if view._isSelHighlight}
  <!-- Compact read-only row for temporary selection highlight views -->
  <div
    class="flex items-center gap-2 border-b border-neutral-200 bg-yellow-500/5 px-2 py-1.5 select-none dark:border-neutral-800"
  >
    <div class="size-2 shrink-0 rounded-full bg-yellow-400/70"></div>
    <div class="min-w-0 flex-1 truncate text-[10px] text-yellow-300/80 italic">
      Selection ({view.atoms?.length ?? 0} atoms)
    </div>
    <button
      type="button"
      class="shrink-0 text-neutral-500 hover:text-red-400"
      aria-label="Remove selection view"
      onclick={onremove}>&times;</button
    >
  </div>
{:else}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="relative gap-2 border-b border-neutral-200 p-2 select-none dark:border-neutral-800 {view.visible
      ? 'bg-neutral-50 text-neutral-900 dark:bg-neutral-900 dark:text-white'
      : 'text-neutral-500 dark:text-neutral-400'} {selected
      ? 'ring-1 ring-inset ring-yellow-500/70 bg-yellow-500/5'
      : ''}"
    role="option"
    aria-selected={selected}
    tabindex="-1"
    onclick={(e) => {
      // Row multi-select (Ctrl/Shift); ignore clicks on interactive controls.
      const t = /** @type {HTMLElement} */ (e.target)
      if (t.closest('input,button,select,a,[role="button"]')) return
      onRowSelect?.(e)
    }}
    onkeydown={(e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      const t = /** @type {HTMLElement} */ (e.target)
      if (t !== e.currentTarget) return
      e.preventDefault()
      onRowSelect?.(/** @type {MouseEvent} */ (/** @type {unknown} */ (e)))
    }}
    oncontextmenu={(e) => {
      e.preventDefault()
      e.stopPropagation()
      onContextOpen?.(e)
      rowCtxMenu = { x: e.clientX, y: e.clientY }
      rowCtxMenuPos = { x: e.clientX, y: e.clientY }
      rowCtxSplitOpen = false
      rowCtxSplitOpenLeft = true
    }}
  >
    <div class="flex items-center gap-2">
      <!-- Visibility toggle + load indicator (kept left so it is not hidden by the color swatch) -->
      <div class="flex w-7 shrink-0 items-center gap-1" title={loadingStructure ? 'Loading structure / bonds…' : undefined}>
        <div class="relative size-3 shrink-0">
          <input
            type="checkbox"
            class="peer absolute inset-0 z-10 cursor-pointer opacity-0"
            checked={view.visible}
            aria-label="Show/hide"
            onchange={() => {
              const nextVisible = !view.visible
              view.visible = nextVisible
              if (animateMode) {
                if (nextVisible) delete view.opacity
                else view.opacity = 0
                onVisibilityChange?.(nextVisible)
              }
            }}
          />
          <div
            class="pointer-events-none h-full w-full rounded-full border-2 border-neutral-400 bg-transparent transition-[background-color,border-color] peer-checked:border-neutral-800 peer-checked:bg-neutral-800 peer-focus-visible:ring-2 peer-focus-visible:ring-neutral-400 dark:border-neutral-500 dark:peer-checked:border-neutral-100 dark:peer-checked:bg-neutral-100 dark:peer-focus-visible:ring-neutral-600"
            aria-hidden="true"
          ></div>
        </div>
        <div class="flex size-3 shrink-0 items-center justify-center" aria-hidden={!loadingStructure}>
          {#if loadingStructure}
            <Spinner className="size-3 text-amber-500 dark:text-amber-400" />
          {/if}
        </div>
      </div>

      <!-- Selection label — double-click to edit inline -->
      {#if editingSelection}
        <input
          bind:this={selectionInputEl}
          type="text"
          class="min-w-0 flex-1 rounded border border-yellow-500/70 bg-white px-1 py-0.5 font-mono text-xs text-neutral-900 outline-none select-text dark:bg-neutral-950 dark:text-neutral-100 {invalidSelection
            ? 'border-red-500'
            : ''}"
          bind:value={selectionDraft}
          placeholder="chainID A · resid 1:20"
          title="Enter MDAnalysis selection · Enter to apply · Esc to cancel"
          onclick={(e) => e.stopPropagation()}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitSelectionEdit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              cancelSelectionEdit()
            }
          }}
          onblur={() => commitSelectionEdit()}
        />
      {:else}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="min-w-0 flex-1 cursor-text truncate text-xs {namedSelection === 'other' &&
          view.selection
            ? 'font-mono'
            : 'capitalize'}"
          title="Double-click to edit selection"
          ondblclick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            beginSelectionEdit()
          }}
        >
          {currentSelectionLabel()}
        </div>
      {/if}

      <!-- Repr badge — click to cycle -->
      <button
        type="button"
        class="shrink-0 rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-800 transition-colors hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
        onclick={cycleRepr}
        title="Click to cycle representation"
      >
        {REPR_LABELS[view.representation.type]}
      </button>

      <!-- Color swatch — click to toggle quick picker -->
      <button
        type="button"
        class="flex h-4 shrink-0 items-stretch overflow-hidden rounded ring-1 ring-transparent transition-all hover:ring-neutral-600"
        onclick={() => (colorPickerOpen = !colorPickerOpen)}
        title="Click to change color scheme"
      >
        {#if swatchColors()}
          {#each swatchColors() as hex (hex)}
            <div class="w-2" style="background-color: {hex};"></div>
          {/each}
        {:else}
          {#each SWATCH_ATOMS as atom (atom.element)}
            <div
              class="w-2"
              style="background-color: #{view.colorScheme.resolver(atom).getHexString()};"
            ></div>
          {/each}
        {/if}
      </button>

      <!-- Focus -->
      <button
        type="button"
        onclick={() => oncenter?.()}
        class="focus-visible:outline-none active:translate-y-0.5 disabled:opacity-50"
        title="Center on this view"
        disabled={!view.atoms?.length}
      >
        <Focus className="size-4" />
      </button>

      <!-- Gear → opens dialog -->
      <button
        type="button"
        onclick={openGearDialog}
        class="focus-visible:outline-none active:translate-y-0.5"
        title="View settings"
      >
        <Gear className="size-4" />
      </button>
    </div>

    <!-- Quick color scheme picker ──────────────────────────────────────────-->
    {#if colorPickerOpen}
      <div class="mt-2 flex flex-col gap-2">
        <div class="flex flex-wrap gap-1">
          {#each [{ v: 'cpk', l: 'CPK' }, { v: 'chain', l: 'Chain' }, { v: 'goodsell', l: 'Pastel' }, { v: 'residue_nature', l: 'Residue' }, { v: 'ss', l: 'SS' }, { v: 'cpk-carbon', l: 'CPK+C' }, { v: 'constant', l: 'Uniform' }] as opt (opt.v)}
            <button
              type="button"
              class="rounded px-2 py-0.5 text-[10px] transition-colors {colorSchemeName === opt.v
                ? 'bg-blue-600 text-white'
                : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'}"
              onclick={() => {
                colorSchemeName = opt.v
              }}
            >
              {opt.l}
            </button>
          {/each}
        </div>
        {#if ['constant', 'cpk-carbon'].includes(colorSchemeName)}
          <div class="flex items-center gap-1">
            <ColorInput size="sm" bind:value={constantColorHex} />
            <Input type="text" size="sm" className="flex-1" bind:value={constantColorHex} />
          </div>
          <div class="grid grid-cols-8 gap-1">
            {#each COLOR_PALETTE as color (color.getHexString())}
              <button
                class="aspect-square w-full rounded-sm border border-neutral-200 bg-white p-0.5 hover:border-neutral-400 active:translate-y-0.5 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:border-neutral-600"
                aria-label="Select color #{color.getHexString()}"
                onclick={() => (constantColorHex = `#${color.getHexString()}`)}
              >
                <div
                  class="size-full rounded-sm"
                  style="background-color: #{color.getHexString()};"
                ></div>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  {#if rowCtxMenu}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 z-50"
      onpointerdown={() => {
        rowCtxMenu = null
      }}
    >
      <div
        bind:this={rowCtxMenuEl}
        class="absolute z-50 min-w-40 overflow-visible rounded-md border border-neutral-200 bg-white py-1 text-xs shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        style="left:{rowCtxMenuPos.x}px;top:{rowCtxMenuPos.y}px"
        role="menu"
        tabindex="-1"
        onpointerdown={(e) => e.stopPropagation()}
      >
        {#if onCreateGroup || onShowSelection || onHideSelection}
          {#if onCreateGroup}
            <button
              type="button"
              role="menuitem"
              class="block w-full px-3 py-1.5 text-left text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
              title="Group selected representations under each structure"
              onclick={() => {
                rowCtxMenu = null
                onCreateGroup()
              }}
            >
              Create group
            </button>
          {/if}
          {#if onShowSelection}
            <button
              type="button"
              role="menuitem"
              class="block w-full px-3 py-1.5 text-left text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
              onclick={() => {
                rowCtxMenu = null
                onShowSelection()
              }}
            >
              Show
            </button>
          {/if}
          {#if onHideSelection}
            <button
              type="button"
              role="menuitem"
              class="block w-full px-3 py-1.5 text-left text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
              onclick={() => {
                rowCtxMenu = null
                onHideSelection()
              }}
            >
              Hide
            </button>
          {/if}
          <div class="my-1 border-t border-neutral-200 dark:border-neutral-700" role="separator"></div>
        {/if}
        <button
          type="button"
          role="menuitem"
          class="block w-full px-3 py-1.5 text-left text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
          onclick={() => {
            rowCtxMenu = null
            onduplicate?.()
          }}
        >
          Duplicate representation
        </button>
        <div
          class="group/split relative"
          role="none"
          onmouseenter={() => {
            openSplitSubmenu()
          }}
          onmouseleave={() => {
            rowCtxSplitOpen = false
          }}
        >
          <button
            bind:this={rowCtxSplitTriggerEl}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={rowCtxSplitOpen}
            class="flex w-full items-center justify-between px-3 py-1.5 text-left text-neutral-800 hover:bg-neutral-100 group-hover/split:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800 dark:group-hover/split:bg-neutral-800"
            onclick={() => {
              rowCtxSplitOpen = !rowCtxSplitOpen
              if (rowCtxSplitOpen) layoutSplitSubmenu()
            }}
          >
            Split
            <span class="text-neutral-400">{rowCtxSplitOpenLeft ? '◂' : '▸'}</span>
          </button>
          <div
            bind:this={rowCtxSplitSubmenuEl}
            class="absolute z-[60] flex {rowCtxSplitOpenLeft
              ? 'right-full flex-row-reverse pr-0.5'
              : 'left-full pl-0.5'} {rowCtxSplitOpen
              ? 'pointer-events-auto visible'
              : 'pointer-events-none invisible group-hover/split:pointer-events-auto group-hover/split:visible'}"
            style="top:{rowCtxSplitOffsetY}px"
            role="menu"
          >
            <div
              class="min-w-40 overflow-hidden rounded-md border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
            >
              {#each SPLIT_VIEW_MODES as mode (mode.id)}
                <button
                  type="button"
                  role="menuitem"
                  class="block w-full px-3 py-1.5 text-left text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
                  title={mode.title}
                  onclick={() => {
                    rowCtxMenu = null
                    rowCtxSplitOpen = false
                    onsplitby?.(mode.id)
                  }}
                >
                  {mode.label}
                </button>
              {/each}
            </div>
          </div>
        </div>
        <button
          type="button"
          role="menuitem"
          class="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
          onclick={() => {
            rowCtxMenu = null
            onremove()
          }}
        >
          Remove
        </button>
      </div>
    </div>
  {/if}

  <!-- ── Gear dialog ──────────────────────────────────────────────────────────-->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <dialog
    bind:this={gearDialog}
    class="fixed top-10 bottom-10 left-16 z-50 m-0 w-80 max-w-[calc(100vw-5rem)] overflow-y-auto rounded-lg border border-neutral-300 bg-white p-0 text-xs text-neutral-900 shadow-2xl backdrop:bg-black/20 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 {isDark
      ? 'dark'
      : ''}"
    onpointerdown={onGearDialogPointerDown}
    onclick={onGearDialogClick}
    oncancel={(e) => {
      e.preventDefault()
      closeGearDialog()
    }}
  >
    <div class="flex flex-col gap-0">
      <div
        class="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-200 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
      >
        <span class="text-sm font-medium">View settings</span>
        <button
          type="button"
          class="relative z-20 -mr-1 min-h-8 min-w-8 rounded px-2 text-lg leading-none text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-white"
          aria-label="Close"
          onclick={(e) => {
            e.stopPropagation()
            closeGearDialog()
          }}>&times;</button
        >
      </div>

      <div class="flex flex-col gap-4 p-3">
        <!-- Selection -->
        <section class="space-y-1.5">
          <div class="flex items-center justify-between">
            <p class="font-medium text-neutral-800 dark:text-neutral-300">Selection</p>
            <span class="text-neutral-500">{view.atoms?.length ?? 0} atoms</span>
          </div>
          {#if hasTrajectory && !(view.atoms?.length) && (namedSelection === 'all' || !String(view.selection || view.baseSelection || '').trim())}
            <p class="text-[10px] leading-snug text-neutral-500 dark:text-neutral-400">
              Type a subset (for example <span class="font-mono">protein and resid 1</span>).
              Showing every atom of a solvated trajectory can crash the viewer.
            </p>
          {/if}
          <Select size="sm" className="w-full capitalize" bind:value={namedSelection}>
            {#each NAMED_SELECTIONS as sel (sel)}
              <option value={sel} class="capitalize">{sel}</option>
            {/each}
          </Select>
          {#if namedSelection === 'other'}
            <div class="flex gap-1">
              <Input
                type="text"
                size="sm"
                className="flex-1 {invalidSelection ? 'border-red-500!' : ''}"
                placeholder="chainID A  ·  resid 1:20  ·  ..."
                bind:value={view.selection}
              />
              <button
                type="button"
                class="shrink-0 rounded border border-neutral-300 px-1.5 py-0.5 text-[10px] text-neutral-600 transition-colors hover:border-yellow-500/60 hover:text-yellow-600 dark:border-neutral-600 dark:text-neutral-400 dark:hover:border-yellow-500/50 dark:hover:text-yellow-400"
                title="Keep heavy atoms + polar H only (hide non-polar hydrogens)"
                onclick={() => {
                  const base = String(view.selection || view.baseSelection || 'all').trim()
                  const wrapped =
                    !base || base === 'all'
                      ? POLAR_SELECTION
                      : `(${base}) and (${POLAR_SELECTION})`
                  view.selection = wrapped
                  view.baseSelection = wrapped
                }}
              >∩ polar</button>
              <button
                type="button"
                class="shrink-0 rounded border border-neutral-300 px-2 py-0.5 text-neutral-600 transition-colors hover:border-neutral-400 hover:text-neutral-900 dark:border-neutral-600 dark:text-neutral-400 dark:hover:border-neutral-400 dark:hover:text-white"
                title="MDAnalysis selection help"
                onclick={openHelpDialog}>?</button
              >
            </div>
          {/if}
          {#if hasTrajectory}
            <label class="flex items-start gap-2 pt-0.5 text-[11px] text-neutral-600 dark:text-neutral-400">
              <input
                type="checkbox"
                class="mt-0.5"
                checked={view.selectionEachFrame === true}
                onchange={() => {
                  view.selectionEachFrame = view.selectionEachFrame !== true
                  onSelectionEachFrameChange?.(view.selectionEachFrame === true)
                }}
              />
              <span>
                <span class="font-medium text-neutral-700 dark:text-neutral-300">Update each frame</span>
                — re-apply this selection as the trajectory plays (needed for
                <span class="font-mono">byres</span> /
                <span class="font-mono">prop y &lt; 0</span> clips).
              </span>
            </label>
          {/if}
          <div class="space-y-1">
            <p class="text-neutral-600 dark:text-neutral-400">Split into multiple representations</p>
            <div class="grid grid-cols-2 gap-1">
              {#each SPLIT_VIEW_MODES as mode (mode.id)}
                <button
                  type="button"
                  class="rounded border border-neutral-300 px-2 py-1 text-left text-neutral-700 transition-colors hover:border-neutral-400 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:border-neutral-500 dark:hover:bg-neutral-800"
                  title={mode.title}
                  onclick={() => {
                    closeGearDialog()
                    onsplitby?.(mode.id)
                  }}
                >
                  {mode.label}
                </button>
              {/each}
            </div>
          </div>
        </section>

        <!-- Representation -->
        <section class="space-y-1.5">
          <p class="font-medium text-neutral-800 dark:text-neutral-300">Representation</p>
          <Select
            size="sm"
            className="w-full"
            bind:value={
              () => view.representation.type,
              (reprType) => {
                view.representation = { type: reprType }
                if (representationNeedsBonds(reprType)) {
                  view._prefetched = false
                  if (!bondsHaveMultiOrder(view.bonds)) {
                    view._bondOrderFetchDone = false
                    if (!tryApplySourceBonds() || !bondsHaveMultiOrder(view.bonds)) {
                      updateStructure()
                    }
                  }
                }
              }
            }
          >
            <option value="points">Points</option>
            <option value="ball-stick">Ball &amp; Stick</option>
            <option value="licorice">Licorice</option>
            <option value="cartoon">Cartoon</option>
            <option value="tube">Tube</option>
            <option value="vdw">vdW</option>
            <option value="surface">Surface</option>
          </Select>
        </section>

        <!-- Points size -->
        {#if view.representation.type === 'points'}
          <section class="space-y-2">
            <p class="font-medium text-neutral-800 dark:text-neutral-300">Point size</p>
            <div class="flex items-center gap-2">
              <span class="w-10 shrink-0 text-neutral-600 dark:text-neutral-400">Size</span>
              <RangeInput
                bind:value={
                  () => view.pointSize ?? 3,
                  (v) => {
                    view.pointSize = v
                  }
                }
                min={1}
                max={10}
                step={0.5}
                decimals={1}
              />
            </div>
          </section>
        {/if}

        <!-- VdW atom size -->
        {#if view.representation.type === 'vdw'}
          <section class="space-y-2">
            <p class="font-medium text-neutral-800 dark:text-neutral-300">Atom size</p>
            <div class="flex items-center gap-2">
              <span class="w-10 shrink-0 text-neutral-600 dark:text-neutral-400">Scale</span>
              <RangeInput
                bind:value={
                  () => view.atomScale ?? 1.0,
                  (v) => {
                    view.atomScale = v
                  }
                }
                min={0.3}
                max={2.0}
                step={0.05}
                decimals={2}
              />
            </div>
          </section>
        {/if}

        {#if hasTrajectory}
          <section class="space-y-2">
            <p class="font-medium text-neutral-800 dark:text-neutral-300">Traj smooth</p>
            <div class="flex items-center gap-2">
              <span class="w-10 shrink-0 text-neutral-600 dark:text-neutral-400">Level</span>
              <RangeInput
                value={typeof view.trajSmooth === 'number' ? view.trajSmooth : 0}
                min={0}
                max={8}
                step={1}
                decimals={0}
                oninput={(v) => {
                  view.trajSmooth = Math.max(0, Math.min(8, Math.round(v)))
                }}
              />
            </div>
            <div class="flex justify-between text-[10px] text-neutral-500 dark:text-neutral-500">
              <span>Raw frames</span>
              <span>Blend</span>
            </div>
            <p class="text-[10px] leading-snug text-neutral-500 dark:text-neutral-400">
              0 snaps to the current frame. Higher levels blend neighboring frames for this
              representation only.
            </p>
            <label class="flex items-start gap-2 pt-0.5 text-[11px] text-neutral-600 dark:text-neutral-400">
              <input
                type="checkbox"
                class="mt-0.5"
                checked={view.trajSmoothRestoreH !== false}
                onchange={() => {
                  view.trajSmoothRestoreH = view.trajSmoothRestoreH === false
                  onTrajSmoothRestoreHChange?.(view.trajSmoothRestoreH !== false)
                }}
              />
              <span>
                <span class="font-medium text-neutral-700 dark:text-neutral-300">Restore hydrogens</span>
                — off keeps a VMD-style XYZ average (hydrogens collapse into the chain).
              </span>
            </label>
          </section>
        {/if}

        <!-- Organic surface options -->
        {#if view.representation.type === 'surface'}
          <section class="space-y-2">
            <p class="font-medium text-neutral-800 dark:text-neutral-300">Surface source</p>
            <Select
              size="sm"
              className="w-full"
              bind:value={
                () => view.surfaceSource ?? 'atoms',
                (v) => {
                  view.surfaceSource = v === 'backbone' ? 'backbone' : 'atoms'
                  if (view.surfaceSource === 'backbone') updateStructure()
                }
              }
            >
              <option value="atoms">Atoms (vdW)</option>
              <option value="backbone">Backbone (SS)</option>
            </Select>
            <p class="text-[10px] leading-snug text-neutral-500 dark:text-neutral-400">
              Atoms = van der Waals skin. Backbone = Cα path with helix/sheet/coil radii (needs
              protein residues). Play keeps this mesh on the last built frame; pause or export
              an image to rebuild it at the current coordinates.
            </p>
          </section>
          <section class="space-y-2">
            <p class="font-medium text-neutral-800 dark:text-neutral-300">Inflate</p>
            <div class="flex items-center gap-2">
              <span class="w-10 shrink-0 text-neutral-600 dark:text-neutral-400">Puff</span>
              <RangeInput
                value={view.surfaceInflate ?? 0.25}
                min={0}
                max={1}
                step={0.01}
                decimals={2}
                oninput={(v) => {
                  view.surfaceInflate = v
                }}
              />
            </div>
            <div class="flex justify-between text-[10px] text-neutral-500 dark:text-neutral-500">
              <span>vdW tight</span>
              <span>Puffy</span>
            </div>
          </section>
          <section class="space-y-2">
            <p class="font-medium text-neutral-800 dark:text-neutral-300">Smooth</p>
            <div class="flex items-center gap-2">
              <span class="w-10 shrink-0 text-neutral-600 dark:text-neutral-400">Level</span>
              <RangeInput
                value={typeof view.surfaceSubdivision === 'number' ? view.surfaceSubdivision : 0}
                min={0}
                max={8}
                step={0.05}
                decimals={2}
                oninput={(v) => {
                  view.surfaceSubdivision = Math.max(0, Math.min(8, v))
                }}
              />
            </div>
            <div class="flex justify-between text-[10px] text-neutral-500 dark:text-neutral-500">
              <span>Off</span>
              <span>Max</span>
            </div>
            <p class="text-[10px] leading-snug text-neutral-500 dark:text-neutral-400">
              Off keeps the raw isosurface. Higher levels round ridges and cream the lighting.
              Rebuild waits until you pause dragging.
            </p>
          </section>
        {/if}

        <!-- Ball-stick atom & bond size -->
        {#if view.representation.type === 'ball-stick'}
          <section class="space-y-2">
            <p class="font-medium text-neutral-800 dark:text-neutral-300">Atom &amp; Bond size</p>
            {#each [{ label: 'Atom', key: 'atomScale', min: 0.2, max: 2.0, step: 0.05, def: 1.0 }, { label: 'Bond', key: 'bondScale', min: 0.1, max: 4.0, step: 0.1, def: 1.0 }] as s (s.key)}
              <div class="flex items-center gap-2">
                <span class="w-10 shrink-0 text-neutral-600 dark:text-neutral-400">{s.label}</span>
                <RangeInput
                  bind:value={
                    () => view[s.key] ?? s.def,
                    (v) => {
                      view[s.key] = v
                    }
                  }
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  decimals={2}
                />
              </div>
            {/each}
            <div class="space-y-1.5 pt-1">
              <p class="text-[11px] font-medium text-neutral-700 dark:text-neutral-300">Bond color</p>
              <label class="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  class="radio radio-xs"
                  name="bond-color-{view.id}"
                  checked={(view.bondColorMode ?? 'uniform') === 'uniform'}
                  onchange={() => {
                    view.bondColorMode = 'uniform'
                  }}
                />
                <span class="text-neutral-700 dark:text-neutral-300">Uniform</span>
              </label>
              {#if (view.bondColorMode ?? 'uniform') === 'uniform'}
                <div class="flex items-center gap-2 pl-5">
                  <input
                    type="color"
                    class="h-6 w-8 cursor-pointer rounded border border-neutral-300 bg-transparent p-0 dark:border-neutral-600"
                    value={view.bondColor ?? '#b8b8bc'}
                    oninput={(e) => {
                      view.bondColor = e.currentTarget.value
                    }}
                  />
                  <span class="text-[10px] text-neutral-500">{view.bondColor ?? '#b8b8bc'}</span>
                </div>
              {/if}
              <label class="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  class="radio radio-xs"
                  name="bond-color-{view.id}"
                  checked={view.bondColorMode === 'atoms'}
                  onchange={() => {
                    view.bondColorMode = 'atoms'
                  }}
                />
                <span
                  class="text-neutral-700 dark:text-neutral-300"
                  title="Each half of the stick uses the atom color scheme (like licorice)"
                  >By atom (split)</span
                >
              </label>
            </div>
            <label class="flex cursor-pointer items-center gap-2 pt-1">
              <input
                type="checkbox"
                class="checkbox checkbox-xs"
                checked={view.showMultipleBonds !== false}
                onchange={(e) => {
                  view.showMultipleBonds = e.currentTarget.checked
                }}
              />
              <span class="text-neutral-700 dark:text-neutral-300">Show multiple bonds</span>
            </label>
          </section>
        {/if}

        <!-- Licorice bond width -->
        {#if view.representation.type === 'licorice'}
          <section class="space-y-2">
            <p class="font-medium text-neutral-800 dark:text-neutral-300">Bond width</p>
            <div class="flex items-center gap-2">
              <span class="w-10 shrink-0 text-neutral-600 dark:text-neutral-400">Bond</span>
              <RangeInput
                bind:value={
                  () => view.bondScale ?? 1.0,
                  (v) => {
                    view.bondScale = v
                  }
                }
                min={0.3}
                max={2.0}
                step={0.05}
                decimals={2}
              />
            </div>
            <label class="flex cursor-pointer items-center gap-2 pt-1">
              <input
                type="checkbox"
                class="checkbox checkbox-xs"
                checked={(view.stickRoundness ?? 1) > 0}
                onchange={(e) => {
                  view.stickRoundness = e.currentTarget.checked ? 1 : 0
                }}
              />
              <span
                class="text-neutral-700 dark:text-neutral-300"
                title="Round sphere caps on chain ends only. Bonds always form a continuous pipe (elbows / branch spheres)."
                >Round terminal ends</span
              >
            </label>
            <label class="flex cursor-pointer items-center gap-2 pt-1">
              <input
                type="checkbox"
                class="checkbox checkbox-xs"
                checked={view.showMultipleBonds !== false}
                onchange={(e) => {
                  view.showMultipleBonds = e.currentTarget.checked
                }}
              />
              <span class="text-neutral-700 dark:text-neutral-300">Show multiple bonds</span>
            </label>
          </section>
        {/if}

        <!-- Cartoon dimensions / Tube radius -->
        {#if view.representation.type === 'cartoon'}
          <section class="space-y-2">
            <p class="font-medium text-neutral-800 dark:text-neutral-300">Cartoon dimensions</p>
            {#each [{ label: 'Helix', key: 'helixWidth', min: 0.1, max: 2.5, step: 0.05 }, { label: 'Sheet', key: 'sheetWidth', min: 0.1, max: 2.5, step: 0.05 }, { label: 'Coil', key: 'coilWidth', min: 0.03, max: 0.5, step: 0.01 }] as s (s.key)}
              <div class="flex items-center gap-2">
                <span class="w-10 shrink-0 text-neutral-600 dark:text-neutral-400">{s.label}</span>
                <RangeInput
                  bind:value={
                    () => view[s.key],
                    (v) => {
                      view[s.key] = v
                    }
                  }
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  decimals={2}
                />
              </div>
            {/each}
          </section>
        {/if}

        <!-- SS colors (cartoon and tube) -->
        {#if view.representation.type === 'cartoon' || view.representation.type === 'tube'}
          <section class="space-y-2">
            <div class="flex items-center justify-between">
              <p class="font-medium text-neutral-800 dark:text-neutral-300">SS colors</p>
              <button
                type="button"
                class="text-[10px] text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-300"
                onclick={() => {
                  view.ssColors = null
                }}>Reset</button
              >
            </div>
            {#each Object.entries(SS_LABELS) as [code, label] (code)}
              {@const currentHex =
                (view.ssColors ?? SS_COLORS_DEFAULT)[code] ?? SS_COLORS_DEFAULT[code] ?? '#888888'}
              <div class="flex items-center gap-2">
                <div
                  class="size-3 shrink-0 rounded-sm border border-neutral-300 dark:border-neutral-700"
                  style="background-color: {currentHex};"
                ></div>
                <span class="w-20 shrink-0 text-neutral-600 dark:text-neutral-400">{label}</span>
                <input
                  type="color"
                  class="h-5 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
                  value={currentHex}
                  oninput={(e) => {
                    const prev = view.ssColors ?? { ...SS_COLORS_DEFAULT }
                    const updated = { ...prev, [code]: e.target.value }
                    if (code === 'H') updated.h = e.target.value
                    if (code === 'G') {
                      updated.g = e.target.value
                      updated.I = e.target.value
                      updated.i = e.target.value
                    }
                    view.ssColors = updated
                  }}
                />
              </div>
            {/each}
          </section>
        {/if}

        <!-- Tube radius -->
        {#if view.representation.type === 'tube'}
          <section class="space-y-2">
            <p class="font-medium text-neutral-800 dark:text-neutral-300">Tube radius</p>
            <div class="flex items-center gap-2">
              <span class="w-10 shrink-0 text-neutral-600 dark:text-neutral-400">Radius</span>
              <RangeInput
                bind:value={
                  () => view.tubeRadius ?? 0.9,
                  (v) => {
                    view.tubeRadius = v
                  }
                }
                min={0.05}
                max={2.0}
                step={0.05}
                decimals={2}
              />
            </div>
          </section>
        {/if}

        <!-- Material -->
        <section class="space-y-2">
          <p class="font-medium text-neutral-800 dark:text-neutral-300">Material</p>
          <div class="flex flex-wrap gap-1">
            {#each Object.keys(MATERIAL_PRESETS) as preset (preset)}
              <button
                type="button"
                class="rounded px-2 py-0.5 text-[10px] capitalize transition-colors {(view.material?.preset ??
                'Default') === preset
                  ? 'bg-blue-600 text-white'
                  : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'}"
                onclick={() => applyMaterialPreset(preset)}>{preset}</button
              >
            {/each}
          </div>
          {#if isGoodsellMaterial(view.material)}
            <div class="space-y-2 rounded border border-neutral-200 p-2 dark:border-neutral-700">
              <p class="text-[10px] font-medium text-neutral-700 dark:text-neutral-300">Outlines</p>
              <label class="flex items-center gap-2 text-neutral-700 dark:text-neutral-300">
                <input type="checkbox" bind:checked={view.material.outlinesEnabled} />
                Show outlines
              </label>
              <div class="flex items-center gap-2">
                <span class="w-12 shrink-0 text-neutral-600 dark:text-neutral-400">Color</span>
                <ColorInput size="sm" bind:value={view.material.outlineColor} />
                <Input type="text" size="sm" className="field-input flex-1" bind:value={view.material.outlineColor} />
              </div>
              <div class="flex items-center gap-2">
                <span class="w-12 shrink-0 text-neutral-600 dark:text-neutral-400">Width</span>
                <RangeInput bind:value={view.material.outlineWidth} min={0.04} max={0.35} step={0.01} decimals={2} />
              </div>
              <label class="flex items-center gap-2 text-neutral-700 dark:text-neutral-300">
                <input type="checkbox" bind:checked={view.material.useGoodsellLighting} />
                Flat Goodsell lighting
              </label>
              <p class="text-[10px] leading-snug text-neutral-500 dark:text-neutral-400">
                Lighting is restored automatically when you switch to another material or disable this
                option.
              </p>
            </div>
          {:else if isGlowingMaterial(view.material)}
            <div class="space-y-2 rounded border border-neutral-200 p-2 dark:border-neutral-700">
              <p class="text-[10px] leading-snug text-neutral-500 dark:text-neutral-400">
                Atoms act as colored bulbs: they emit light into the scene and tint nearby
                surfaces. Use a tight selection (e.g. ligand) or “Selected atoms only” for a few
                bright sources inside a protein.
              </p>
              <label class="flex items-center gap-2 text-neutral-700 dark:text-neutral-300">
                <input type="checkbox" bind:checked={view.material.glowEmitLight} />
                Emit scene light from atoms
              </label>
              <div class="flex items-center gap-2">
                <span class="w-16 shrink-0 text-neutral-600 dark:text-neutral-400">Bulb filter</span>
                <select
                  class="field-input flex-1 rounded px-1.5 py-0.5 text-[11px]"
                  bind:value={view.material.glowAtomFilter}
                >
                  <option value="non_hydrogen">Heavy atoms (no H)</option>
                  <option value="all">All atoms</option>
                  <option value="highlighted">Selected / hovered only</option>
                </select>
              </div>
              {#if glowingBulbStats}
                <p class="text-[10px] tabular-nums text-neutral-600 dark:text-neutral-400">
                  {#if glowingBulbStats.disabled}
                    Scene bulbs off (enable “Emit scene light”).
                  {:else if glowingBulbStats.needsSelection}
                    Scene bulbs: select atoms in the viewer (max {glowingBulbStats.maxLights}).
                  {:else}
                    Scene bulbs: {glowingBulbStats.active} active
                    {#if glowingBulbStats.capped}
                      (pool {glowingBulbStats.pool}, capped at {glowingBulbStats.maxLights})
                    {:else}
                      of {glowingBulbStats.pool} eligible atoms
                    {/if}
                  {/if}
                </p>
              {/if}
              {#if glowingBulbsHeavy}
                <p class="text-[10px] leading-snug text-amber-600 dark:text-amber-400">
                  Many scene bulbs can slow placement. For full proteins prefer Surface glow and
                  Light power; use “Selected atoms only” for localized highlights.
                </p>
              {/if}
              {#if glowingBulbStats?.gpuLimited}
                <p class="text-[10px] leading-snug text-amber-600 dark:text-amber-400">
                  Saved Max bulbs ({glowingBulbStats.maxRequested}) exceeds the GPU limit — only
                  {GLOW_LIGHTS_HARD_MAX} are used (higher values break WebGL shaders).
                </p>
              {/if}
              {#if viewerBusy.active && isGlowingMaterial(view.material)}
                <p class="flex items-center gap-1.5 text-[10px] text-blue-600 dark:text-blue-400">
                  <Spinner className="size-3" />
                  {viewerBusy.label || 'Updating material…'}
                </p>
              {/if}
              {#each GLOWING_UI_SLIDERS as s (s.key)}
                <div class="flex items-center gap-2">
                  <span class="w-16 shrink-0 text-neutral-600 dark:text-neutral-400">{s.label}</span>
                  <RangeInput
                    value={view.material[s.key] ??
                      (s.key === 'emissiveIntensity' ? 2.5 : GLOWING_MATERIAL_DEFAULTS[s.key])}
                    min={s.min}
                    max={s.max}
                    step={s.step}
                    decimals={s.decimals}
                    oninput={(val) => {
                      let v = s.key === 'glowMaxLights' ? clampGlowMaxLights(val) : val
                      view.material = {
                        ...view.material,
                        preset: 'Glowing',
                        [s.key]: v
                      }
                    }}
                  />
                </div>
              {/each}
              {#each [{ label: 'Metalness', key: 'metalness' }, { label: 'Roughness', key: 'roughness' }] as s (s.key)}
                <div class="flex items-center gap-2">
                  <span class="w-16 shrink-0 text-neutral-600 dark:text-neutral-400">{s.label}</span>
                  <RangeInput
                    value={view.material[s.key] ?? (s.key === 'roughness' ? 0.15 : 0)}
                    min={0}
                    max={1}
                    step={0.01}
                    decimals={2}
                    oninput={(val) => {
                      view.material = {
                        ...view.material,
                        preset: 'Glowing',
                        [s.key]: val
                      }
                    }}
                  />
                </div>
              {/each}
              <p class="text-[10px] leading-snug text-neutral-500 dark:text-neutral-400">
                Surface glow = atoms tint themselves (always all of them). Max bulbs = how many
                atoms also cast point light into the scene (capped at {GLOW_LIGHTS_HARD_MAX} for
                WebGL). If Surface glow is high, changing Max bulbs is hard to notice — lower
                Surface glow and raise Light power, or use a small selection / “Selected only”.
              </p>
            </div>
          {:else}
            {#each [{ label: 'Metalness', key: 'metalness', min: 0, max: 1, step: 0.01 }, { label: 'Roughness', key: 'roughness', min: 0, max: 1, step: 0.01 }, { label: 'Glow', key: 'emissiveIntensity', min: 0, max: 2, step: 0.05 }] as s (s.key)}
              <div class="flex items-center gap-2">
                <span class="w-16 shrink-0 text-neutral-600 dark:text-neutral-400">{s.label}</span>
                <RangeInput
                  value={view.material[s.key] ?? 0}
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  decimals={2}
                  oninput={(val) => {
                    view.material = {
                      ...view.material,
                      preset: view.material?.preset ?? 'Default',
                      [s.key]: val
                    }
                  }}
                />
              </div>
            {/each}
          {/if}
        </section>

        <!-- Opacity (shared for all representations) -->
        <section class="space-y-2">
          <p class="font-medium text-neutral-800 dark:text-neutral-300">Opacity</p>
          <div class="flex items-center gap-2">
            <span class="w-10 shrink-0 text-neutral-600 dark:text-neutral-400">Alpha</span>
            <RangeInput
              value={typeof view.opacity === 'number' ? view.opacity : 1}
              min={0}
              max={1}
              step={0.01}
              decimals={2}
              oninput={(v) => {
                view.opacity = Math.max(0, Math.min(1, v))
              }}
            />
          </div>
        </section>

        <!-- Quality (shared 1–5 for all representations) -->
        <section class="space-y-2">
          <p class="font-medium text-neutral-800 dark:text-neutral-300">Quality</p>
          <div class="flex items-center gap-2">
            <span class="w-10 shrink-0 text-neutral-600 dark:text-neutral-400">Level</span>
            <RangeInput
              value={view.quality ?? 3}
              min={1}
              max={5}
              step={1}
              decimals={0}
              inputClassName="w-10"
              oninput={(v) => {
                view.quality = Math.max(1, Math.min(5, Math.round(v)))
              }}
            />
          </div>
          <div class="flex justify-between text-[10px] text-neutral-500 dark:text-neutral-500">
            <span>Low</span>
            <span>Max</span>
          </div>
        </section>

        {#if animateMode && onFadeEdit}
          <button
            type="button"
            class="w-full rounded border border-neutral-300 px-2 py-1 text-left text-neutral-700 transition-colors hover:border-neutral-400 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:border-neutral-500 dark:hover:bg-neutral-800"
            onclick={() => {
              closeGearDialog()
              onFadeEdit()
            }}
          >
            Fade in/out…
            <span class="block text-neutral-500 dark:text-neutral-400">{fadeSummary(view)}</span>
          </button>
        {/if}

        <!-- Remove -->
        <Button
          variant="danger"
          size="sm"
          type="button"
          className="w-full"
          onclick={() => {
            closeGearDialog()
            onremove()
          }}
        >
          Remove
        </Button>
      </div>
    </div>
  </dialog>

  <!-- ── MDAnalysis help dialog ────────────────────────────────────────────────-->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <dialog
    bind:this={helpDialog}
    class="fixed top-1/2 left-1/2 m-0 max-h-[80vh] w-96 max-w-[90vw] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-neutral-300 bg-white p-0 text-xs text-neutral-900 shadow-2xl backdrop:bg-black/60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 {isDark
      ? 'dark'
      : ''}"
    onpointerdown={onHelpDialogPointerDown}
    onclick={onHelpDialogClick}
    oncancel={(e) => {
      e.preventDefault()
      closeHelpDialog()
    }}
  >
    <div class="flex flex-col">
      <div class="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-700">
        <span class="text-sm font-medium">MDAnalysis Selection Language</span>
        <button
          type="button"
          class="relative z-20 -mr-1 min-h-8 min-w-8 rounded px-2 text-lg leading-none text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-white"
          aria-label="Close"
          onclick={(e) => {
            e.stopPropagation()
            closeHelpDialog()
          }}>&times;</button
        >
      </div>
      <pre
        class="p-4 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">{MDA_HELP}</pre>
    </div>
  </dialog>
{/if}
