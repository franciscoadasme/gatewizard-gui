/**
 * Named Visualize selections vs custom MDAnalysis strings.
 *
 * The panel clears `view.selection` for dropdown keywords and keeps the keyword
 * on `baseSelection`. Reloading a session must not treat that empty string as
 * "all atoms" — `/get-structure` with no selection returns the whole structure.
 */

import { trySubsetBySelection } from './dynamicSelection.js'

/**
 * Attaching every atom of a solvated trajectory as a representation OOMs the renderer.
 * A static structure (a downloaded PDB/mmCIF entry) is not capped: points are one
 * GPU buffer, and entries such as 5GOA are larger than this without being a movie.
 */
export const LARGE_VIEW_ATOM_LIMIT = 80_000

/** Keywords the named-selection dropdown / backend aliases understand. */
export const NAMED_SELECTION_KEYWORDS = [
  'all',
  'protein',
  'peptide',
  'backbone',
  'sidechain',
  'polar',
  'water',
  'lipid',
  'ion',
  'ligand'
]

/**
 * @param {unknown} sel
 * @returns {boolean}
 */
export function isNamedSelectionKeyword(sel) {
  return NAMED_SELECTION_KEYWORDS.includes(String(sel || '').trim().toLowerCase())
}

/**
 * Selection string to send to `/get-structure` / MDAnalysis.
 * @param {{ selection?: string, baseSelection?: string } | null | undefined} view
 * @returns {string}
 */
export function effectiveViewSelection(view) {
  const sel = String(view?.selection || '').trim()
  if (sel) return sel
  const base = String(view?.baseSelection || '').trim()
  if (base) return base
  return 'all'
}

/**
 * Dropdown value for a saved / live view.
 * @param {{ selection?: string, baseSelection?: string } | null | undefined} view
 * @returns {string}
 */
export function namedSelectionFromView(view) {
  const sel = String(view?.selection || '').trim()
  if (isNamedSelectionKeyword(sel)) return sel.toLowerCase()
  const base = String(view?.baseSelection || '').trim()
  if (isNamedSelectionKeyword(base)) return base.toLowerCase()
  return 'other'
}

/**
 * Resolve the `/get-structure` selection from the panel dropdown + view fields.
 * Never returns an empty string (that means "all atoms" on the backend).
 * @param {string} namedSelection
 * @param {{ selection?: string, baseSelection?: string } | null | undefined} view
 * @returns {string}
 */
export function structureFetchSelection(namedSelection, view) {
  const named = String(namedSelection || '').trim()
  if (named && named !== 'other') return named
  return effectiveViewSelection(view)
}

/**
 * True when ``all`` would dump a solvated trajectory onto a heavy representation.
 * Points stay attached: they are one GPU buffer, and that is the default view.
 * Static structures are shown even when they are larger than the cap.
 * @param {number} atomCount
 * @param {string} [selection]
 * @param {{ trajectory?: unknown } | null | undefined} [owner]
 * @param {string | null | undefined} [representation]
 */
export function shouldDeferFullSystemSelection(atomCount, selection, owner = null, representation = null) {
  const query = String(selection || '').trim().toLowerCase() || 'all'
  if (query !== 'all') return false
  if (!owner?.trajectory) return false
  if (String(representation || '').trim().toLowerCase() === 'points') return false
  return (Number(atomCount) || 0) > LARGE_VIEW_ATOM_LIMIT
}

/**
 * Atoms/bonds/residues for a new or edited representation.
 * A heavy style of trajectory ``all`` stays empty until the user types a real subset.
 * Points of ``all`` are kept so the structure is visible when the trajectory opens.
 * @param {{ atoms?: object[], bonds?: unknown[], residues?: object[], trajectory?: unknown } | null | undefined} owner
 * @param {string} selection
 * @param {string | null | undefined} [representation]
 */
export function resolveViewAtomSubset(owner, selection, representation = null) {
  const atoms = owner?.atoms
  const bonds = owner?.bonds
  const residues = owner?.residues
  const query = String(selection || '').trim() || 'all'
  if (!atoms?.length) {
    return { atoms: [], bonds: bonds || [], residues: residues || [] }
  }
  if (shouldDeferFullSystemSelection(atoms.length, query, owner, representation)) {
    return { atoms: [], bonds: [], residues: [] }
  }
  const result = trySubsetBySelection(atoms, bonds, residues, query)
  if (result.ok) return result
  if (atoms.length > LARGE_VIEW_ATOM_LIMIT) {
    return { atoms: [], bonds: [], residues: [] }
  }
  return { atoms, bonds: bonds || [], residues: residues || [] }
}

/**
 * @param {unknown} bond
 * @returns {number}
 */
export function bondOrderValue(bond) {
  if (!Array.isArray(bond) || bond.length < 3) return 1
  const order = Number(bond[2])
  return Number.isFinite(order) && order >= 2 ? order : 1
}

/** @param {unknown} bonds */
export function bondsHaveMultiOrder(bonds) {
  return Array.isArray(bonds) && bonds.some((bond) => bondOrderValue(bond) >= 2)
}

/**
 * @param {number} atomCount
 * @param {number} bondCount
 */
export function bondsLookSparse(atomCount, bondCount) {
  const n = atomCount || 0
  if (!n) return true
  return (bondCount || 0) < n / 2
}

/**
 * @param {unknown[] | null | undefined} a
 * @param {unknown[] | null | undefined} b
 */
export function bondsAreEqual(a, b) {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const left = a[i]
    const right = b[i]
    if (left === right) continue
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    for (let k = 0; k < left.length; k++) {
      if (left[k] !== right[k]) return false
    }
  }
  return true
}

/**
 * True when a double/triple bond in `bonds` connects two of `atoms`.
 * A Thr/Ile fragment of a protein that also contains Phe does not.
 * @param {Array<{ index?: number }> | null | undefined} atoms
 * @param {unknown[] | null | undefined} bonds
 */
export function multiOrderTouchesAtoms(atoms, bonds) {
  if (!bondsHaveMultiOrder(bonds) || !atoms?.length) return false
  /** @type {Set<number>} */
  const indices = new Set()
  for (const atom of atoms) {
    if (typeof atom?.index === 'number') indices.add(atom.index)
  }
  return bonds.some((bond) => {
    if (!Array.isArray(bond) || bond.length < 2 || bondOrderValue(bond) < 2) return false
    return indices.has(Number(bond[0])) && indices.has(Number(bond[1]))
  })
}

/**
 * Whether ball-and-stick / licorice should call /get-structure for bond orders.
 * An all-single-bond residue is finished data, not a missing-order flag.
 * Treating it as missing rewrites `view.bonds` on every effect and crashes.
 * @param {{
 *   atoms?: Array<{ index?: number }> | null,
 *   bonds?: unknown[] | null,
 *   sourceBonds?: unknown[] | null,
 *   bondOrderFetchDone?: boolean
 * }} input
 */
export function bondRepresentationNeedsFetch(input) {
  if (input?.bondOrderFetchDone) return false
  const atoms = input?.atoms
  const bonds = input?.bonds
  const atomCount = atoms?.length || 0
  if (atomCount > 0 && bondsHaveMultiOrder(bonds)) return false
  const sparse = bondsLookSparse(atomCount, Array.isArray(bonds) ? bonds.length : 0)
  if (atomCount > 0 && !sparse && !multiOrderTouchesAtoms(atoms, input?.sourceBonds)) return false
  return atomCount === 0 || sparse || !bondsHaveMultiOrder(bonds)
}

/**
 * A local atom subset is not enough for ball-and-stick or licorice when it has
 * no covalent bonds. Mutation reloads a PDB without CONECT, so the parent bond
 * list is empty until bonds are guessed.
 * @param {{
 *   needsBonds?: boolean,
 *   atoms?: unknown[] | null,
 *   bonds?: unknown[] | null,
 *   bondOrderFetchDone?: boolean
 * }} input
 */
export function localSelectionStillNeedsBonds(input) {
  if (!input?.needsBonds || input.bondOrderFetchDone) return false
  const atomCount = input.atoms?.length || 0
  if (!atomCount) return false
  return bondsLookSparse(atomCount, Array.isArray(input.bonds) ? input.bonds.length : 0)
}
