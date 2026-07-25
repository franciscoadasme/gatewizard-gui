import { DEFAULT_VIEW_MATERIAL } from '../colorSchemes.js'

/** @typedef {'chain' | 'residue' | 'resname' | 'molecule' | 'element'} SplitViewMode */

/** @type {{ id: SplitViewMode, label: string, title: string }[]} */
export const SPLIT_VIEW_MODES = [
  { id: 'chain', label: 'Chain', title: 'One representation per chainID' },
  { id: 'residue', label: 'Residue', title: 'One representation per residue (chain + number)' },
  { id: 'resname', label: 'Residue name', title: 'One representation per resname' },
  { id: 'molecule', label: 'Molecule', title: 'One representation per bonded fragment' },
  { id: 'element', label: 'Element', title: 'One representation per element type' }
]

/**
 * @param {SplitViewMode} mode
 * @returns {string}
 */
export function splitViewModeLabel(mode) {
  return SPLIT_VIEW_MODES.find((m) => m.id === mode)?.label ?? mode
}

/** @param {any} view */
function effectiveViewSelection(view) {
  const sel = String(view?.selection || '').trim()
  if (sel) return sel
  const base = String(view?.baseSelection || '').trim()
  if (base) return base
  return 'all'
}

/** @param {string} effective @param {string} partSel */
function combineSelection(effective, partSel) {
  if (!partSel) return effective || 'all'
  if (!effective || effective === 'all') return partSel
  if (/^chainID\s+\S+$/i.test(effective) && /^chainID\s+\S+$/i.test(partSel)) return partSel
  return `(${effective}) and (${partSel})`
}

/**
 * @param {unknown[] | undefined} bonds
 * @param {Set<number>} atomIdx
 * @returns {[number, number][] | undefined}
 */
function filterBonds(bonds, atomIdx) {
  if (!Array.isArray(bonds)) return undefined
  return bonds.filter(([i, j]) => atomIdx.has(i) && atomIdx.has(j))
}

/**
 * @param {any} src
 * @param {string} selection
 * @param {any[]} atoms
 * @param {unknown[] | undefined} bonds
 * @param {unknown[] | null | undefined} residues
 */
function cloneViewPart(src, selection, atoms, bonds, residues) {
  return {
    ...src,
    id: crypto.randomUUID(),
    selection,
    baseSelection: selection,
    representation: { ...src.representation },
    colorScheme: { ...src.colorScheme },
    material: src.material ? { ...src.material } : { ...DEFAULT_VIEW_MATERIAL },
    ssColors: src.ssColors ? { ...src.ssColors } : null,
    atoms,
    bonds,
    residues,
    visible: true,
    _prefetched: true
  }
}

/**
 * @param {number[]} indices
 * @param {[number, number][] | undefined} bonds
 * @returns {number[][]}
 */
function connectedComponents(indices, bonds) {
  const indexSet = new Set(indices)
  /** @type {Map<number, number>} */
  const parent = new Map()
  for (const idx of indices) parent.set(idx, idx)

  /** @param {number} a */
  function find(a) {
    let root = parent.get(a)
    if (root == null) return a
    while (root !== parent.get(root)) {
      const next = parent.get(root)
      if (next == null) break
      parent.set(a, next)
      root = next
    }
    return root
  }

  /** @param {number} a @param {number} b */
  function union(a, b) {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  if (Array.isArray(bonds)) {
    for (const [i, j] of bonds) {
      if (indexSet.has(i) && indexSet.has(j)) union(i, j)
    }
  }

  /** @type {Map<number, number[]>} */
  const groups = new Map()
  for (const idx of indices) {
    const root = find(idx)
    const list = groups.get(root)
    if (list) list.push(idx)
    else groups.set(root, [idx])
  }
  return [...groups.values()]
}

/**
 * @param {any[]} atoms
 * @param {SplitViewMode} mode
 * @param {string} effective
 * @param {[number, number][] | undefined} bonds
 * @returns {{ key: string, label: string, selection: string, atoms: any[], atomIdx: Set<number> }[]}
 */
function groupAtoms(atoms, mode, effective, bonds) {
  /** @type {Map<string, { label: string, selection: string, atoms: any[], atomIdx: Set<number> }>} */
  const groups = new Map()

  /** @param {string} key @param {string} label @param {string} partSel @param {any} atom */
  function addAtom(key, label, partSel, atom) {
    let group = groups.get(key)
    if (!group) {
      group = {
        label,
        selection: combineSelection(effective, partSel),
        atoms: [],
        atomIdx: new Set()
      }
      groups.set(key, group)
    }
    group.atoms.push(atom)
    group.atomIdx.add(atom.index)
  }

  if (mode === 'molecule') {
    const indices = atoms.map((a) => a.index)
    const components = connectedComponents(indices, bonds)
    components.sort((a, b) => Math.min(...a) - Math.min(...b))
    return components.map((component, i) => {
      const componentSet = new Set(component)
      const componentAtoms = atoms.filter((a) => componentSet.has(a.index))
      const partSel = `index ${component.join(' ')}`
      return {
        key: `mol-${i}`,
        label: `Molecule ${i + 1}`,
        selection: combineSelection(effective, partSel),
        atoms: componentAtoms,
        atomIdx: componentSet
      }
    })
  }

  for (const atom of atoms) {
    const chain = String(atom.chain_id ?? '').trim()
    const resId = atom.res_id
    const resName = String(atom.res_name ?? '').trim()
    const element = String(atom.element ?? '').trim()

    if (mode === 'chain') {
      const key = chain || '__empty__'
      const label = chain || '(no chain)'
      let partSel = chain ? `chainID ${chain}` : ''
      if (chain && effective && effective !== 'all' && /^chainID\s+\S+$/i.test(effective)) {
        partSel = `chainID ${chain}`
      }
      addAtom(key, label, partSel, atom)
      continue
    }

    if (mode === 'residue') {
      const key = `${chain}|${resId}`
      const label = chain ? `${resName}${resId}:${chain}` : `${resName}${resId}`
      const partSel = chain
        ? `(chainID ${chain} and resid ${resId})`
        : `resid ${resId}`
      addAtom(key, label, partSel, atom)
      continue
    }

    if (mode === 'resname') {
      const key = resName || '__empty__'
      const label = resName || '(no resname)'
      const partSel = resName ? `resname ${resName}` : ''
      addAtom(key, label, partSel, atom)
      continue
    }

    if (mode === 'element') {
      const key = element || '__empty__'
      const label = element || '(no element)'
      const partSel = element ? `element ${element}` : ''
      addAtom(key, label, partSel, atom)
    }
  }

  /** @type {{ key: string, label: string, selection: string, atoms: any[], atomIdx: Set<number> }[]} */
  const out = [...groups.entries()].map(([key, group]) => ({ key, ...group }))

  if (mode === 'chain') {
    const nonEmpty = out.filter((g) => g.key !== '__empty__').map((g) => g.label)
    for (const group of out) {
      if (group.key !== '__empty__') continue
      if (nonEmpty.length === 0) {
        group.selection = effective === 'all' ? 'all' : effective
        continue
      }
      const exclude = nonEmpty.map((c) => `chainID ${c}`).join(' or ')
      const partSel = `not (${exclude})`
      group.selection = combineSelection(effective, partSel)
    }
    out.sort((a, b) => {
      if (a.key === '__empty__' && b.key !== '__empty__') return 1
      if (b.key === '__empty__' && a.key !== '__empty__') return -1
      return a.label.localeCompare(b.label, undefined, { numeric: true })
    })
    return out
  }

  out.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
  return out
}

/**
 * @param {unknown[] | null | undefined} residues
 * @param {SplitViewMode} mode
 * @param {{ key: string, atoms: any[], atomIdx: Set<number> }[]} groups
 */
function filterResiduesForGroup(residues, mode, group) {
  if (!Array.isArray(residues)) return residues
  if (mode === 'chain') {
    const chain = group.key === '__empty__' ? '' : group.label
    return residues.filter((r) => String(r.chain ?? r.chain_id ?? '').trim() === chain)
  }
  if (mode === 'residue') {
    const [chain, residRaw] = group.key.split('|')
    const resid = Number(residRaw)
    return residues.filter((r) => {
      const rChain = String(r.chain ?? r.chain_id ?? '').trim()
      const rNum = Number(r.number ?? r.resid)
      return rChain === chain && rNum === resid
    })
  }
  if (mode === 'resname') {
    const resname = group.key === '__empty__' ? '' : group.key
    return residues.filter((r) => String(r.resname ?? '').trim() === resname)
  }
  return residues.filter((r) =>
    (r.atom_indices ?? []).some((/** @type {number} */ idx) => group.atomIdx.has(idx))
  )
}

/**
 * Split a live view into multiple copies that differ only by selection/atoms.
 * @param {any} src
 * @param {SplitViewMode} mode
 * @returns {{ parts: any[] } | { error: string }}
 */
export function splitViewIntoParts(src, mode) {
  if (!src?.atoms?.length) {
    return { error: 'This representation has no atoms to split.' }
  }

  const effective = effectiveViewSelection(src)
  const bonds = filterBonds(src.bonds, new Set(src.atoms.map((/** @type {{ index: number }} */ a) => a.index)))
  const groups = groupAtoms(src.atoms, mode, effective, bonds)

  if (groups.length <= 1) {
    return {
      error: `Only one ${splitViewModeLabel(mode).toLowerCase()} group in this representation — nothing to split.`
    }
  }

  const parts = groups.map((group) => {
    const partBonds = filterBonds(src.bonds, group.atomIdx)
    const partResidues = filterResiduesForGroup(src.residues, mode, group)
    return cloneViewPart(src, group.selection, group.atoms, partBonds, partResidues)
  })

  return { parts }
}
