/**
 * Visibility groups for Visualize:
 * - kind ``structures``: outer groups of structures (panel-level)
 * - kind ``views``: nested groups of representations inside one structure
 *
 * Persisted in viewpoint v3 / animation v6 as ``visibilityGroups``.
 */

/**
 * @typedef {'structures' | 'views'} VisibilityGroupKind
 *
 * @typedef {Object} VisibilityGroup
 * @property {string} id
 * @property {string} name
 * @property {VisibilityGroupKind} kind
 * @property {string[]} structureIds Structures in an outer group (kind=structures).
 * @property {string} [structureId] Parent structure for a nested rep group (kind=views).
 * @property {string[]} viewIds Representation ids (kind=views).
 * @property {boolean} [collapsed]
 */

/**
 * @param {unknown} raw
 * @returns {VisibilityGroup[]}
 */
export function normalizeVisibilityGroups(raw) {
  if (!Array.isArray(raw) || !raw.length) return []
  /** @type {VisibilityGroup[]} */
  const out = []
  const seen = new Set()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = /** @type {Record<string, unknown>} */ (item)
    const id = typeof o.id === 'string' && o.id ? o.id : crypto.randomUUID()
    if (seen.has(id)) continue
    seen.add(id)
    const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : 'Group'
    const structureIds = uniqueStringIds(o.structureIds)
    const viewIds = uniqueStringIds(o.viewIds)
    const structureId =
      typeof o.structureId === 'string' && o.structureId
        ? o.structureId
        : structureIds[0] || ''

    /** @type {VisibilityGroupKind} */
    let kind
    if (o.kind === 'structures' || o.kind === 'views') {
      kind = o.kind
    } else if (viewIds.length > 0 || (structureId && !structureIds.length)) {
      // Nested rep group (or legacy structureId + views).
      kind = 'views'
    } else if (structureIds.length > 0) {
      kind = 'structures'
    } else {
      continue
    }

    if (kind === 'structures') {
      const ids = structureIds.length ? structureIds : structureId ? [structureId] : []
      if (!ids.length) continue
      out.push({
        id,
        name,
        kind: 'structures',
        structureIds: ids,
        viewIds: [],
        collapsed: o.collapsed === true
      })
    } else {
      const sid = structureId || structureIds[0] || ''
      if (!sid && !viewIds.length) continue
      out.push({
        id,
        name,
        kind: 'views',
        structureId: sid,
        structureIds: [],
        viewIds,
        collapsed: o.collapsed === true
      })
    }
  }
  return out
}

/**
 * @param {VisibilityGroup[]} groups
 */
export function serializeVisibilityGroups(groups) {
  return (groups || []).map((g) => {
    if (g.kind === 'structures') {
      return {
        id: g.id,
        name: g.name,
        kind: 'structures',
        structureIds: [...(g.structureIds || [])],
        viewIds: [],
        collapsed: g.collapsed === true
      }
    }
    return {
      id: g.id,
      name: g.name,
      kind: 'views',
      structureId: g.structureId || '',
      structureIds: [],
      viewIds: [...(g.viewIds || [])],
      collapsed: g.collapsed === true
    }
  })
}

/**
 * @param {VisibilityGroup[]} groups
 * @param {Iterable<string>} structureIds
 * @param {Iterable<string>} viewIds
 * @param {Map<string, string> | Record<string, string> | null} [viewToStructure]
 * @returns {VisibilityGroup[]}
 */
export function pruneVisibilityGroups(groups, structureIds, viewIds, viewToStructure = null) {
  const sOk = new Set(structureIds)
  const vOk = new Set(viewIds)
  /** @param {string} vid */
  const ownerOf = (vid) => {
    if (!viewToStructure) return null
    if (viewToStructure instanceof Map) return viewToStructure.get(vid) ?? null
    return viewToStructure[vid] ?? null
  }

  return (groups || [])
    .map((g) => {
      if (g.kind === 'structures') {
        return {
          ...g,
          kind: /** @type {VisibilityGroupKind} */ ('structures'),
          structureIds: (g.structureIds || []).filter((id) => sOk.has(id)),
          viewIds: []
        }
      }
      const views = (g.viewIds || []).filter((id) => vOk.has(id))
      let structureId = g.structureId || ''
      if (!structureId || !sOk.has(structureId)) {
        const fromView = views.map(ownerOf).find((sid) => sid && sOk.has(sid))
        structureId = fromView || ''
      }
      const scoped = views.filter((vid) => {
        const owner = ownerOf(vid)
        return !owner || owner === structureId
      })
      return {
        ...g,
        kind: /** @type {VisibilityGroupKind} */ ('views'),
        structureId,
        structureIds: [],
        viewIds: scoped
      }
    })
    .filter((g) => {
      if (g.kind === 'structures') return (g.structureIds || []).length > 0
      return !!(g.structureId && sOk.has(g.structureId) && (g.viewIds || []).length > 0)
    })
}

/**
 * Reorder among siblings of the same kind (and same parent structure for view groups).
 * @param {VisibilityGroup[]} groups
 * @param {string} groupId
 * @param {-1 | 1} delta
 * @returns {VisibilityGroup[]}
 */
export function reorderVisibilityGroup(groups, groupId, delta) {
  const list = groups || []
  const idx = list.findIndex((g) => g.id === groupId)
  if (idx < 0) return list
  const target = list[idx]
  const siblingIndexes = list
    .map((g, i) => {
      if (g.kind !== target.kind) return -1
      if (target.kind === 'views' && g.structureId !== target.structureId) return -1
      return i
    })
    .filter((i) => i >= 0)
  const pos = siblingIndexes.indexOf(idx)
  const swapPos = pos + delta
  if (swapPos < 0 || swapPos >= siblingIndexes.length) return list
  const j = siblingIndexes[swapPos]
  const next = [...list]
  const tmp = next[idx]
  next[idx] = next[j]
  next[j] = tmp
  return next
}

/**
 * Create groups from selection:
 * - Structures only → one outer ``structures`` group
 * - Representations → nested ``views`` groups (one per structure involved)
 * If both are selected, representation selection wins when viewIds are present.
 *
 * @param {VisibilityGroup[]} groups
 * @param {{
 *   name?: string,
 *   structureIds?: string[],
 *   viewIds?: string[],
 *   views?: Array<{ id: string, structureId?: string | null }>
 * }} opts
 * @returns {VisibilityGroup[]}
 */
export function createVisibilityGroup(groups, opts = {}) {
  const selectedStructures = uniqueStringIds(opts.structureIds)
  const selectedViews = uniqueStringIds(opts.viewIds)
  const views = opts.views || []
  const baseName =
    typeof opts.name === 'string' && opts.name.trim() ? opts.name.trim() : null

  // Prefer explicit representation selection when present.
  if (selectedViews.length > 0) {
    /** @type {Map<string, string[]>} */
    const byStructure = new Map()
    const selectedSet = new Set(selectedViews)
    for (const v of views) {
      if (!v?.id || !v.structureId || !selectedSet.has(v.id)) continue
      if (!byStructure.has(v.structureId)) byStructure.set(v.structureId, [])
      byStructure.get(v.structureId).push(v.id)
    }
    if (!byStructure.size) return groups || []

    const claimed = new Set([...byStructure.values()].flat())
    let cleaned = (groups || []).map((g) =>
      g.kind === 'views'
        ? { ...g, viewIds: (g.viewIds || []).filter((id) => !claimed.has(id)) }
        : g
    )
    cleaned = cleaned.filter((g) =>
      g.kind === 'structures' ? (g.structureIds || []).length > 0 : (g.viewIds || []).length > 0
    )

    let n = cleaned.filter((g) => g.kind === 'views').length
    /** @type {VisibilityGroup[]} */
    const created = []
    for (const [structureId, viewIds] of byStructure) {
      n += 1
      created.push({
        id: crypto.randomUUID(),
        name: baseName && byStructure.size === 1 ? baseName : `Group ${n}`,
        kind: 'views',
        structureId,
        structureIds: [],
        viewIds: uniqueStringIds(viewIds),
        collapsed: false
      })
    }
    return [...cleaned, ...created]
  }

  // Structures only → one outer group.
  if (selectedStructures.length > 0) {
    const sSet = new Set(selectedStructures)
    let cleaned = (groups || []).map((g) =>
      g.kind === 'structures'
        ? {
            ...g,
            structureIds: (g.structureIds || []).filter((id) => !sSet.has(id))
          }
        : g
    )
    cleaned = cleaned.filter((g) =>
      g.kind === 'structures' ? (g.structureIds || []).length > 0 : (g.viewIds || []).length > 0
    )
    const n = cleaned.filter((g) => g.kind === 'structures').length + 1
    return [
      ...cleaned,
      {
        id: crypto.randomUUID(),
        name: baseName || `Group ${n}`,
        kind: 'structures',
        structureIds: selectedStructures,
        viewIds: [],
        collapsed: false
      }
    ]
  }

  return groups || []
}

/**
 * @param {VisibilityGroup[]} groups
 * @param {string} groupId
 */
export function dissolveVisibilityGroup(groups, groupId) {
  return (groups || []).filter((g) => g.id !== groupId)
}

/**
 * @param {VisibilityGroup[]} groups
 * @returns {Set<string>}
 */
export function claimedViewIds(groups) {
  /** @type {Set<string>} */
  const viewIds = new Set()
  for (const g of groups || []) {
    if (g.kind !== 'views') continue
    for (const id of g.viewIds || []) viewIds.add(id)
  }
  return viewIds
}

/**
 * Structures claimed by outer structure groups.
 * @param {VisibilityGroup[]} groups
 * @returns {Set<string>}
 */
export function claimedStructureIds(groups) {
  /** @type {Set<string>} */
  const ids = new Set()
  for (const g of groups || []) {
    if (g.kind !== 'structures') continue
    for (const id of g.structureIds || []) ids.add(id)
  }
  return ids
}

/**
 * Nested representation groups for one structure.
 * @param {VisibilityGroup[]} groups
 * @param {string} structureId
 */
export function groupsForStructure(groups, structureId) {
  return (groups || []).filter((g) => g.kind === 'views' && g.structureId === structureId)
}

/**
 * Outer structure groups (panel order).
 * @param {VisibilityGroup[]} groups
 */
export function structureGroups(groups) {
  return (groups || []).filter((g) => g.kind === 'structures')
}

/**
 * Contiguous range select within an ordered id list (Shift+click).
 * @param {string[]} orderedIds
 * @param {string | null} anchorId
 * @param {string} targetId
 */
export function rangeSelectIds(orderedIds, anchorId, targetId) {
  const a = anchorId ? orderedIds.indexOf(anchorId) : -1
  const b = orderedIds.indexOf(targetId)
  if (b < 0) return [targetId]
  if (a < 0) return [targetId]
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  return orderedIds.slice(lo, hi + 1)
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
function uniqueStringIds(raw) {
  if (!Array.isArray(raw)) return []
  /** @type {string[]} */
  const out = []
  const seen = new Set()
  for (const x of raw) {
    if (typeof x !== 'string' || !x || seen.has(x)) continue
    seen.add(x)
    out.push(x)
  }
  return out
}
