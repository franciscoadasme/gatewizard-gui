/**
 * Resolve saved labels / measurements onto the correct structure.
 * Atom indices are per-structure (MDAnalysis 0-based), so two PDBs can share
 * the same index for different residues.
 */

/**
 * Parse "LYS73" / "A:LYS73" style chip text into a residue hint.
 * @param {string | undefined} text
 * @returns {{ resName: string, resid: number } | null}
 */
export function residueHintFromLabelText(text) {
  const t = String(text ?? '')
    .trim()
    .toUpperCase()
  if (!t) return null
  const stripped = t.replace(/^[A-Z0-9]:/, '')
  // Letters-only resname + trailing resid so LYS73 is LYS/73, not LYS7/3.
  const m = stripped.match(/([A-Z]{1,4})(\d+)\s*$/)
  if (!m) return null
  return { resName: m[1], resid: Number(m[2]) }
}

/**
 * @param {{ res_name?: string, res_id?: number }} atom
 * @param {{ resName: string, resid: number } | null} hint
 */
export function atomMatchesResidueHint(atom, hint) {
  if (!hint || !atom) return false
  const rn = String(atom.res_name ?? '')
    .trim()
    .toUpperCase()
  return rn === hint.resName && Number(atom.res_id) === hint.resid
}

/**
 * Last two path segments, slash-normalized, so WSL and Windows paths compare.
 * @param {string | undefined} path
 */
export function overlayPathTail(path) {
  return String(path || '')
    .replace(/\\/g, '/')
    .toLowerCase()
    .split('/')
    .filter(Boolean)
    .slice(-2)
    .join('/')
}

/**
 * Map a saved structureId onto the live workspace (id first, then path tail).
 * @param {string | undefined} sid
 * @param {OverlayStructure[]} live
 * @param {Array<{ id?: string, path?: string, sourcePath?: string }>} [metas]
 */
export function remapSavedStructureId(sid, live, metas) {
  if (!sid) return sid
  const structures = Array.isArray(live) ? live : []
  if (structures.some((s) => s.id === sid)) return sid
  const meta = (metas || []).find((m) => m.id === sid)
  if (!meta) return sid
  const want = overlayPathTail(meta.path) || overlayPathTail(meta.sourcePath)
  if (!want) return sid
  const match = structures.find(
    (s) => overlayPathTail(s.path) === want || overlayPathTail(s.sourcePath) === want
  )
  return match?.id || sid
}

/**
 * @typedef {{ id?: string, path?: string, sourcePath?: string, atoms?: Array<{ index: number, res_name?: string, res_id?: number }> }} OverlayStructure
 * @typedef {{
 *   fallbackAtoms?: Array<{ index: number, x: number, y: number, z: number, element?: string, name?: string, res_name?: string, res_id?: number }>
 *   structures?: OverlayStructure[]
 * }} OverlayAtomSource
 */

/**
 * Pick the atom list for a saved label/measurement.
 * Prefer structureId, then a residue-name match on the label text
 * (LYS73 on 6rv2, not VAL76 on 9g9v at the same index).
 * @param {{ structureId?: string, atomIndex?: number, atomIndices?: number[], text?: string }} data
 * @param {OverlayAtomSource | Array<{ index: number }> | null | undefined} source
 * @returns {{ atoms: Array<{ index: number }>, structureId?: string }}
 */
export function atomsForOverlayRecord(data, source) {
  const opts = Array.isArray(source)
    ? { fallbackAtoms: source, structures: [] }
    : source && typeof source === 'object'
      ? source
      : { fallbackAtoms: [], structures: [] }
  const structures = Array.isArray(opts.structures) ? opts.structures : []
  const fallback = Array.isArray(opts.fallbackAtoms) ? opts.fallbackAtoms : []
  const sid = typeof data.structureId === 'string' ? data.structureId : ''
  if (sid) {
    const owned = structures.find((s) => s.id === sid)
    if (owned?.atoms?.length) return { atoms: owned.atoms, structureId: owned.id }
  }
  const index =
    typeof data.atomIndex === 'number'
      ? data.atomIndex
      : Array.isArray(data.atomIndices)
        ? data.atomIndices[0]
        : undefined
  const hint = residueHintFromLabelText(data.text)
  if (typeof index === 'number' && structures.length) {
    /** @type {Array<{ atoms: NonNullable<OverlayStructure['atoms']>, id?: string, match: boolean }>} */
    const owners = []
    for (const st of structures) {
      const atom = st.atoms?.find((a) => a.index === index)
      if (!atom || !st.atoms) continue
      owners.push({
        atoms: st.atoms,
        id: st.id,
        match: atomMatchesResidueHint(atom, hint)
      })
    }
    const matched = owners.filter((o) => o.match)
    if (matched.length >= 1) {
      return { atoms: matched[0].atoms, structureId: matched[0].id }
    }
    if (owners.length === 1) {
      return { atoms: owners[0].atoms, structureId: owners[0].id }
    }
  }
  if (hint && structures.length) {
    const residueOwners = structures.filter((st) =>
      st.atoms?.some((a) => atomMatchesResidueHint(a, hint))
    )
    if (residueOwners.length === 1 && residueOwners[0].atoms) {
      return { atoms: residueOwners[0].atoms, structureId: residueOwners[0].id }
    }
  }
  if (hint && fallback.length) {
    const fallbackAtom =
      typeof index === 'number' ? fallback.find((a) => a.index === index) : null
    if (
      fallbackAtom &&
      fallbackAtom.res_name &&
      !atomMatchesResidueHint(fallbackAtom, hint)
    ) {
      return { atoms: [] }
    }
  }
  return { atoms: fallback }
}
