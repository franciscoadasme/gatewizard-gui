/**
 * Multi-structure workspace helpers for Visualize.
 */

/**
 * @typedef {Object} StructureEntry
 * @property {string} id
 * @property {string} sourcePath
 * @property {'file' | 'maestro_ct' | 'pdb_model'} kind
 * @property {number | null} [ctIndex]
 * @property {number | null} [modelIndex]
 * @property {string} label
 * @property {string} path
 * @property {string | null} [topologyPath]
 * @property {object[]} atoms
 * @property {Array<[number, number] | [number, number, number]>} bonds
 * @property {object[]} [residues]
 * @property {boolean} visible
 * @property {boolean} [collapsed]
 * @property {boolean} [componentsCollapsed]
 * @property {string} [bond_source]
 * @property {{
 *   files: Array<{ path: string, stride: number }>,
 *   logicalFrame: number,
 *   logicalFrameCount: number,
 *   rawFrameCounts: number[],
 *   box?: [number, number, number] | null,
 *   alignment?: {
 *     mode: 'align' | 'rmsd',
 *     apply: boolean,
 *     selection: string,
 *     referenceFrame: number
 *   } | null
 * } | null} [trajectory]
 */

/**
 * @param {Partial<StructureEntry> & { path: string, atoms: object[] }} partial
 * @returns {StructureEntry}
 */
export function createStructureEntry(partial) {
  const id = partial.id || crypto.randomUUID()
  const sourcePath = String(partial.sourcePath || partial.path)
  const kind = /** @type {StructureEntry['kind']} */ (partial.kind || 'file')
  return {
    id,
    sourcePath,
    kind,
    ctIndex: partial.ctIndex ?? null,
    modelIndex: partial.modelIndex ?? null,
    label: partial.label || sourcePath.split(/[/\\]/).pop() || 'structure',
    path: String(partial.path),
    topologyPath: partial.topologyPath ?? null,
    atoms: partial.atoms || [],
    bonds: partial.bonds || [],
    residues: partial.residues,
    visible: partial.visible !== false,
    collapsed: partial.collapsed === true,
    componentsCollapsed: partial.componentsCollapsed === true,
    bond_source: partial.bond_source,
    trajectory: normalizeTrajectoryMeta(partial.trajectory)
  }
}

/**
 * @param {unknown} raw
 * @returns {[number, number, number] | null}
 */
function normalizeBoxLengths(raw) {
  if (!Array.isArray(raw) || raw.length < 3) return null
  const lx = Number(raw[0])
  const ly = Number(raw[1])
  const lz = Number(raw[2])
  if (!(lx > 0) || !(ly > 0) || !(lz > 0)) return null
  if (![lx, ly, lz].every((v) => Number.isFinite(v))) return null
  return [lx, ly, lz]
}

/**
 * @param {unknown} raw
 * @returns {{
 *   files: Array<{ path: string, stride: number }>,
 *   logicalFrame: number,
 *   logicalFrameCount: number,
 *   rawFrameCounts: number[],
 *   box: [number, number, number] | null,
 *   alignment: {
 *     mode: 'align' | 'rmsd',
 *     apply: boolean,
 *     selection: string,
 *     referenceFrame: number
 *   } | null
 * } | null}
 */
export function normalizeTrajectoryMeta(raw) {
  if (!raw || typeof raw !== 'object') return null
  const o = /** @type {Record<string, unknown>} */ (raw)
  const files = Array.isArray(o.files)
    ? o.files
        .filter((f) => f && typeof f === 'object' && typeof /** @type {any} */ (f).path === 'string')
        .map((f) => {
          const row = /** @type {Record<string, unknown>} */ (f)
          return {
            path: String(row.path),
            stride: Math.max(1, Math.round(Number(row.stride) || 1))
          }
        })
    : []
  if (!files.length) return null
  const rawCounts = Array.isArray(o.rawFrameCounts)
    ? o.rawFrameCounts.map((n) => Math.max(0, Math.round(Number(n) || 0)))
    : files.map(() => 0)
  const logicalFrameCount = Math.max(0, Math.round(Number(o.logicalFrameCount) || 0))
  const logicalFrame = Math.max(
    0,
    Math.min(
      Math.max(0, logicalFrameCount - 1),
      Math.round(Number(o.logicalFrame) || 0)
    )
  )
  return {
    files,
    logicalFrame,
    logicalFrameCount,
    rawFrameCounts: rawCounts,
    box: normalizeBoxLengths(o.box),
    alignment: normalizeTrajAlignment(o.alignment)
  }
}

/**
 * @param {unknown} raw
 * @returns {{
 *   mode: 'align' | 'rmsd',
 *   apply: boolean,
 *   selection: string,
 *   referenceFrame: number
 * } | null}
 */
export function normalizeTrajAlignment(raw) {
  if (!raw || typeof raw !== 'object') return null
  const o = /** @type {Record<string, unknown>} */ (raw)
  const mode = o.mode === 'align' || o.mode === 'rmsd' ? o.mode : null
  if (!mode) return null
  const selection = String(o.selection || '').trim() || 'protein and backbone'
  const referenceFrame = Math.max(0, Math.round(Number(o.referenceFrame) || 0))
  return {
    mode,
    apply: mode === 'align' && o.apply !== false,
    selection,
    referenceFrame
  }
}

/**
 * @param {StructureEntry['trajectory']} traj
 */
export function serializeTrajectoryMeta(traj) {
  const n = normalizeTrajectoryMeta(traj)
  return n || undefined
}

/**
 * @param {string} path
 */
export function isMaestroPath(path) {
  const lower = String(path || '').toLowerCase()
  return lower.endsWith('.mae') || lower.endsWith('.maegz') || lower.endsWith('.mae.gz')
}

const COORD_TRAJ_EXT = /\.(dcd|xtc|trr|nc|mdcrd|crd|dtr|lammpstrj|h5md)$/i

/** True for MD coordinate files (DCD/XTC/…). PRMTOP/PSF are not. */
export function isCoordinateTrajectoryPath(path) {
  return COORD_TRAJ_EXT.test(String(path || ''))
}

/**
 * Path /get-structure should open. Prefer the coordinate file (DCD/XTC) so
 * frame-0 xyz exist; Amber PRMTOP/PSF alone have no positions.
 * @param {string | null | undefined} path
 * @param {string | null | undefined} topology
 */
export function structureFetchPath(path, topology) {
  const p = String(path || '')
  const top = String(topology || '')
  if (p) return p
  return top
}

/**
 * @param {StructureEntry[]} structures
 * @param {string | null | undefined} structureId
 */
export function findStructure(structures, structureId) {
  if (!structureId) return structures[0] ?? null
  return structures.find((s) => s.id === structureId) ?? null
}

/**
 * Display label for a duplicated structure. Repeats stay unique
 * (`name copy`, then `name copy 2`, …).
 * @param {string[]} labels
 * @param {string} sourceLabel
 */
const EMPTY_HIGHLIGHT = new Set()

/**
 * Atom indices repeat on every split or duplicate, so a chain selection must
 * only highlight the structure it belongs to.
 * @param {string | null | undefined} viewStructureId
 * @param {string | null | undefined} activeStructureId
 * @param {Set<number> | null | undefined} indices
 * @returns {Set<number>}
 */
export function highlightIndicesForStructure(viewStructureId, activeStructureId, indices) {
  if (!activeStructureId || viewStructureId !== activeStructureId) return EMPTY_HIGHLIGHT
  return indices || EMPTY_HIGHLIGHT
}

/**
 * Structure the Select tools should edit. A representation selection wins when
 * every selected row belongs to one structure; otherwise a single selected
 * structure. Mixed selections return null so the caller keeps the active one.
 * @param {{
 *   selectedViewIds?: Iterable<string>,
 *   viewStructureById?: Map<string, string>,
 *   selectedStructureIds?: Set<string> | Iterable<string>
 * }} panel
 * @returns {string | null}
 */
export function editStructureIdFromPanel(panel) {
  const owners = new Set()
  const byView = panel?.viewStructureById
  for (const id of panel?.selectedViewIds || []) {
    const sid = byView?.get(id)
    if (sid) owners.add(sid)
  }
  if (owners.size === 1) return [...owners][0]
  if (owners.size > 1) return null
  const structs = [...(panel?.selectedStructureIds || [])]
  if (structs.length === 1) return structs[0]
  return null
}

export function nextDuplicateLabel(labels, sourceLabel) {
  const raw = String(sourceLabel || 'structure').trim() || 'structure'
  const base = raw.replace(/ copy(?: \d+)?$/i, '') || raw
  const taken = new Set((labels || []).map((label) => String(label)))
  if (!taken.has(`${base} copy`)) return `${base} copy`
  let n = 2
  while (taken.has(`${base} copy ${n}`)) n += 1
  return `${base} copy ${n}`
}

/**
 * Serialize structures for viewpoint / animation files.
 * Multi-entry kinds store the durable ``sourcePath`` as ``path`` so reopening
 * does not depend on ephemeral ``structure_cache`` PDB copies.
 * @param {StructureEntry[]} structures
 */
export function serializeStructuresMeta(structures) {
  return (structures || []).map((s) => {
    const kind = s.kind || 'file'
    const sourcePath = String(s.sourcePath || s.path || '')
    const isMulti = kind === 'maestro_ct' || kind === 'pdb_model'
    const durablePath = isMulti && sourcePath ? sourcePath : String(s.path || sourcePath)
    const trajectory = serializeTrajectoryMeta(s.trajectory)
    return {
      id: s.id,
      sourcePath: sourcePath || durablePath,
      kind,
      ctIndex: s.ctIndex ?? null,
      modelIndex: s.modelIndex ?? null,
      label: s.label,
      path: durablePath,
      topology: s.topologyPath ?? null,
      visible: s.visible !== false,
      ...(trajectory ? { trajectory } : {})
    }
  })
}

/**
 * True when meta should be re-materialized from a multi-entry source file.
 * @param {{ kind?: string, sourcePath?: string, path?: string, ctIndex?: number | null, modelIndex?: number | null }} meta
 */
export function isMultiEntryMeta(meta) {
  if (!meta) return false
  const kind = meta.kind || 'file'
  if (kind === 'maestro_ct' || kind === 'pdb_model') return true
  const src = meta.sourcePath || meta.path || ''
  if (kind === 'file' && isMaestroPath(src) && typeof meta.ctIndex === 'number') return true
  return false
}

/**
 * Group multi-entry metas by source file for a single import call.
 * @param {Array<{ id?: string, path: string, sourcePath?: string, kind?: string, ctIndex?: number | null, modelIndex?: number | null, label?: string, topology?: string | null, visible?: boolean }>} metas
 * @returns {{ singles: typeof metas, maestro: Map<string, typeof metas>, models: Map<string, typeof metas> }}
 */
export function groupStructureMetasForLoad(metas) {
  /** @type {typeof metas} */
  const singles = []
  /** @type {Map<string, typeof metas>} */
  const maestro = new Map()
  /** @type {Map<string, typeof metas>} */
  const models = new Map()
  for (const m of metas || []) {
    if (!m?.path && !m?.sourcePath) continue
    const src = String(m.sourcePath || m.path)
    const kind = m.kind || 'file'
    if (kind === 'maestro_ct' || (isMaestroPath(src) && typeof m.ctIndex === 'number')) {
      if (!maestro.has(src)) maestro.set(src, [])
      maestro.get(src).push(m)
      continue
    }
    if (kind === 'pdb_model' && typeof m.modelIndex === 'number') {
      if (!models.has(src)) models.set(src, [])
      models.get(src).push(m)
      continue
    }
    singles.push(m)
  }
  return { singles, maestro, models }
}

/**
 * Normalize viewpoint/animation `structures` or legacy singular `structure`.
 * @param {unknown} raw
 * @returns {Array<{ id?: string, path: string, topology?: string | null, sourcePath?: string, kind?: string, label?: string, ctIndex?: number | null, modelIndex?: number | null, visible?: boolean }>}
 */
export function normalizeStructuresMeta(raw) {
  if (Array.isArray(raw) && raw.length) {
    return raw
      .filter((s) => s && typeof s === 'object' && typeof /** @type {any} */ (s).path === 'string')
      .map((s) => {
        const o = /** @type {Record<string, unknown>} */ (s)
        return {
          id: typeof o.id === 'string' ? o.id : crypto.randomUUID(),
          path: String(o.path),
          topology:
            typeof o.topology === 'string'
              ? o.topology
              : o.topologyPath != null
                ? String(o.topologyPath)
                : null,
          sourcePath: typeof o.sourcePath === 'string' ? o.sourcePath : String(o.path),
          kind: typeof o.kind === 'string' ? o.kind : 'file',
          label: typeof o.label === 'string' ? o.label : undefined,
          ctIndex: typeof o.ctIndex === 'number' ? o.ctIndex : null,
          modelIndex: typeof o.modelIndex === 'number' ? o.modelIndex : null,
          visible: o.visible !== false,
          trajectory: normalizeTrajectoryMeta(o.trajectory)
        }
      })
  }
  if (raw && typeof raw === 'object' && typeof /** @type {any} */ (raw).path === 'string') {
    const o = /** @type {Record<string, unknown>} */ (raw)
    return [
      {
        id: typeof o.id === 'string' ? o.id : crypto.randomUUID(),
        path: String(o.path),
        topology: typeof o.topology === 'string' ? o.topology : null,
        sourcePath: String(o.path),
        kind: 'file',
        visible: true,
        trajectory: normalizeTrajectoryMeta(o.trajectory)
      }
    ]
  }
  return []
}

/**
 * Group auto-detect molecule kinds for panel subsections.
 * @param {string} selection
 */
export function componentKeyFromSelection(selection) {
  const s = String(selection || '').toLowerCase()
  if (s === 'protein' || s.includes('protein')) return 'polymer'
  if (s === 'peptide' || s.includes('peptide')) return 'polymer'
  if (s === 'water' || s.includes('resname tip') || s.includes('resname wat')) return 'water'
  if (s.includes('lipid') || s.includes('popc') || s.includes('pope')) return 'lipid'
  if (s.includes('ion') || s.includes(' na ') || s.includes('resname na')) return 'ion'
  return 'other'
}

/**
 * @param {string} key
 */
export function componentLabel(key) {
  switch (key) {
    case 'polymer':
      return 'Polymer'
    case 'water':
      return 'Water'
    case 'lipid':
      return 'Lipids'
    case 'ion':
      return 'Ions'
    default:
      return 'Other'
  }
}

/**
 * Bond row helpers: support [i,j] or [i,j,order].
 * @param {unknown} bond
 * @returns {{ i: number, j: number, order: number } | null}
 */
export function parseBondRow(bond) {
  if (!Array.isArray(bond) || bond.length < 2) return null
  const i = Number(bond[0])
  const j = Number(bond[1])
  if (!Number.isFinite(i) || !Number.isFinite(j)) return null
  let order = 1
  if (bond.length > 2 && Number.isFinite(Number(bond[2]))) {
    const raw = Number(bond[2])
    const rounded = Math.round(raw)
    // Integer 2/3 only; aromatic (~1.5) and others → single stick
    if (rounded >= 2 && rounded <= 3 && Math.abs(raw - rounded) < 1e-6) order = rounded
  }
  return { i, j, order }
}
