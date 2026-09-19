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
    bond_source: partial.bond_source
  }
}

/**
 * @param {string} path
 */
export function isMaestroPath(path) {
  const lower = String(path || '').toLowerCase()
  return lower.endsWith('.mae') || lower.endsWith('.maegz') || lower.endsWith('.mae.gz')
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
    return {
      id: s.id,
      sourcePath: sourcePath || durablePath,
      kind,
      ctIndex: s.ctIndex ?? null,
      modelIndex: s.modelIndex ?? null,
      label: s.label,
      path: durablePath,
      topology: s.topologyPath ?? null,
      visible: s.visible !== false
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
          visible: o.visible !== false
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
        visible: true
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
