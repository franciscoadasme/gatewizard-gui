<script>
  import {
    AxesGizmo,
    AxesLines,
    BallStick,
    CameraRig,
    Canvas,
    Cartoon,
    MeasureOverlay,
    VdwSpheres
  } from '../components/viewer'
  import { mainViewerCamera } from '../components/viewer/CameraRig.svelte'
  import Axes from '../components/icons/Axes.svelte'
  import AxesLinesIcon from '../components/icons/AxesLines.svelte'
  import { COLOR_PALETTE, cpkScheme, defaultColorScheme } from '../lib/colorSchemes.js'
  import { getCameraForAtoms } from '../lib/viewer/base.js'
  import { pickAtomFromViews } from '../lib/viewer/picking.js'
  import { measureDistance, measureAngle, measureDihedral } from '../lib/viewer/measure.js'
  import { getStructure, detectMolecules } from '../lib/backendApi.js'
  import Button from '../components/ui/Button.svelte'
  import DetectIcon from '../components/icons/Detect.svelte'
  import Divider from '../components/ui/Divider.svelte'
  import Empty from '../components/ui/Empty.svelte'
  import Input from '../components/ui/Input.svelte'
  import Plus from '../components/icons/Plus.svelte'
  import ResetIcon from '../components/icons/Reset.svelte'
  import Spinner from '../components/ui/Spinner.svelte'
  import ViewItem from '../components/ViewItem.svelte'

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

  // Left panel resize
  let leftW = $state(280)
  let _rsX = 0,
    _rsW = 0
  function _startResize(e) {
    _rsX = e.clientX
    _rsW = leftW
    window.addEventListener('pointermove', _doResize)
    window.addEventListener('pointerup', _stopResize)
  }
  function _doResize(e) {
    leftW = Math.max(180, Math.min(480, _rsW + e.clientX - _rsX))
  }
  function _stopResize() {
    window.removeEventListener('pointermove', _doResize)
    window.removeEventListener('pointerup', _stopResize)
  }

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

  // derived state
  const isPdbIdValid = $derived.by(() => pdbId.trim().length === 4)

  $effect(() => {
    const base = getCameraForAtoms(structure?.atoms)
    camera = base ? { ...base, framingZoom: 1, framingGeneration: 0, poseResetGeneration: 0 } : null
  })

  async function onAutoGenerateViews() {
    const data = await detectMolecules(filePath)
    views.length = 0
    for (const [i, struc] of data.entries()) {
      const representation = struc.selection === 'protein' ? { type: 'cartoon' } : { type: 'vdw' }
      let colorScheme = { name: 'cpk', resolver: cpkScheme() }
      if (struc.selection.startsWith('resname')) {
        const color = `#${COLOR_PALETTE[i % COLOR_PALETTE.length].getHexString()}`
        colorScheme = {
          name: 'cpk-carbon',
          color,
          resolver: cpkScheme({ carbonColor: color })
        }
      }
      views.push({
        id: crypto.randomUUID(),
        selection: struc.selection,
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
  async function loadStructure(path) {
    try {
      loadingPDB = true
      structure = await getStructure({
        path,
        needs_bonds: false,
        needs_secondary_structure: false
      })
      filePath = structure.path
      views.length = 0
      measurements = []
      measurePicks = []
      atomLabels = []
      measureMode = null
      ctxMenu = null
      addView('all', { type: 'vdw' })
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

  function handleCanvasClick({ x, y, w, h }) {
    ctxMenu = null
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
    ctxMenu = { x: clientX, y: clientY, atom }
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
</script>

<div class="flex min-w-0 flex-1">
  <div
    class="flex shrink-0 flex-col gap-2 overflow-y-auto border-r border-neutral-800 p-4"
    style="width:{leftW}px"
  >
    <div class="space-y-2">
      <p class="mb-1 text-xs">Structure file:</p>
      {#if filePath && !loadingPDB}
        <div
          class="w-full rounded-md border border-neutral-800 p-2 font-mono text-xs wrap-anywhere"
        >
          {filePath}
        </div>
        <Button variant="outline" className="w-full" onclick={onOpenPdb}
          >Select another file...</Button
        >
      {:else}
        <Button
          variant="outline"
          className="w-full flex items-center gap-1"
          onclick={onOpenPdb}
          disabled={loadingPDB}
        >
          {#if loadingPDB}
            <Spinner />
            Loading...
          {:else}
            Select a file...
          {/if}
        </Button>
      {/if}
    </div>

    {#if !loadingPDB}
      <Divider message="or" />

      <form class="flex gap-2" onsubmit={onFetchPDB}>
        <Input
          placeholder="1crn"
          className="w-[calc(4ch+--spacing(3.5)*2)] font-mono"
          bind:value={pdbId}
          oninput={(e) => {
            if (e.target.value.length > 4) e.target.value = e.target.value.slice(0, 4)
          }}
        />
        <Button
          className="w-full"
          variant="outline"
          type="submit"
          disabled={loadingPDB || !isPdbIdValid}>Download PDB</Button
        >
      </form>
    {/if}
  </div>

  <!-- Left-panel resize handle -->
  <div
    class="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-yellow-500/50"
    role="separator"
    aria-orientation="vertical"
    title="Drag to resize panel"
    onpointerdown={_startResize}
  ></div>

  <div
    class="relative min-h-100 min-w-100 flex-1 bg-black"
    bind:clientWidth={canvasWidth}
    bind:clientHeight={canvasHeight}
  >
    {#if structure && camera}
      <Canvas onAtomClick={handleCanvasClick} onAtomContextMenu={handleCanvasContextMenu}>
        <CameraRig framing={camera} />
        {#each views.filter((v) => v.visible) as view (view.id)}
          {#if view.representation.type === 'ball-stick'}
            <BallStick
              atoms={view.atoms}
              bonds={view.bonds}
              getColor={view.colorScheme.resolver}
              metalness={view.material?.metalness ?? 0.08}
              roughness={view.material?.roughness ?? 0.48}
              emissiveIntensity={view.material?.emissiveIntensity ?? 0.0}
            />
          {:else if view.representation.type === 'cartoon'}
            <Cartoon
              atoms={view.atoms}
              residues={view.residues}
              helixWidth={view.helixWidth ?? 1.0}
              sheetWidth={view.sheetWidth ?? 0.875}
              coilWidth={view.coilWidth ?? 0.125}
              ssColors={view.ssColors}
              metalness={view.material?.metalness ?? 0.08}
              roughness={view.material?.roughness ?? 0.48}
              emissiveIntensity={view.material?.emissiveIntensity ?? 0.0}
            />
          {:else if view.representation.type === 'vdw'}
            <VdwSpheres
              atoms={view.atoms}
              getColor={view.colorScheme.resolver}
              metalness={view.material?.metalness ?? 0.12}
              roughness={view.material?.roughness ?? 0.45}
              emissiveIntensity={view.material?.emissiveIntensity ?? 0.0}
            />
          {/if}
        {/each}
        {#if axesLinesVisible}
          <AxesLines length={camera.extent * 2} center={camera.center} />
        {/if}
      </Canvas>
      {#if axesVisible}
        <AxesGizmo />
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
                      class="shrink-0 text-xs text-neutral-600 hover:text-red-400">&#x2715;</button
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
                      class="shrink-0 text-xs text-neutral-600 hover:text-red-400">&#x2715;</button
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

<!-- Right-click atom label context menu (fixed to viewport) -->
{#if ctxMenu}
  {@const atom = ctxMenu.atom}
  <!-- backdrop — closes menu on outside click -->
  <div class="fixed inset-0 z-40" role="presentation" onpointerdown={() => (ctxMenu = null)}></div>
  <div
    class="fixed z-50 min-w-36 overflow-hidden rounded-md border border-neutral-700 bg-neutral-900 py-1 text-xs shadow-xl"
    style="left:{ctxMenu.x}px;top:{ctxMenu.y}px"
  >
    <div class="border-b border-neutral-800 px-2 py-1 text-neutral-500">Add label</div>
    {#each atomLabelFormats(atom) as fmt}
      <button
        class="w-full px-2 py-1 text-left font-mono hover:bg-neutral-800"
        onclick={() => addAtomLabel(atom, fmt)}>{fmt}</button
      >
    {/each}
    <div class="mt-1 border-t border-neutral-800">
      <button
        class="w-full px-2 py-1 text-left text-neutral-500 hover:bg-neutral-800 hover:text-white"
        onclick={() => (ctxMenu = null)}>Cancel</button
      >
    </div>
  </div>
{/if}
