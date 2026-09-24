/**
 * Client-side MDAnalysis subset used to re-evaluate Visualize selections each
 * trajectory frame (clip planes, byres, topology keywords).
 *
 * Supported: and/or/not, parentheses, byres / same residue as, prop [abs] x|y|z,
 * resname, resid, name, element, segid/chainID, and named keywords
 * (protein, lipid, water, ion, backbone, all, none, …).
 */

import { readAtomXyz } from './trajectoryFrames.js'
import { PEPTIDE_EXTRA_RESNAMES } from '../peptideResidues.js'

const BACKBONE_NAMES = new Set([
  'N',
  'CA',
  'C',
  'O',
  'OXT',
  'H',
  'H1',
  'H2',
  'H3',
  'HA',
  'HA2',
  'HA3'
])

function isBackboneName(name) {
  return BACKBONE_NAMES.has(String(name ?? '').trim().toUpperCase())
}

const PROTEIN_RESNAMES = new Set(
  [
    'ALA',
    'ARG',
    'ASN',
    'ASP',
    'CYS',
    'GLN',
    'GLU',
    'GLY',
    'HIS',
    'ILE',
    'LEU',
    'LYS',
    'MET',
    'PHE',
    'PRO',
    'SER',
    'THR',
    'TRP',
    'TYR',
    'VAL',
    'HID',
    'HIE',
    'HIP',
    'HSD',
    'HSE',
    'HSP',
    'CYX',
    'CYM',
    'ASH',
    'GLH',
    'LYN',
    ...PEPTIDE_EXTRA_RESNAMES
  ].map((n) => n.toUpperCase())
)

const WATER_RESNAMES = new Set([
  'HOH',
  'WAT',
  'SOL',
  'TIP',
  'TIP3',
  'TIP4',
  'TIP5',
  'T3P',
  'T4P',
  'T5P',
  'OPC',
  'SPC',
  'SPCE'
])

const ION_RESNAMES = new Set([
  'NA',
  'NA+',
  'SOD',
  'K',
  'K+',
  'POT',
  'CL',
  'CL-',
  'CLA',
  'MG',
  'MG2',
  'CA',
  'CA2',
  'ZN',
  'LI',
  'RB',
  'CS',
  'F',
  'BR',
  'I'
])

const LIPID_RESNAMES = new Set([
  'POPC',
  'POPE',
  'POPS',
  'POPG',
  'DOPC',
  'DOPE',
  'DPPC',
  'DMPC',
  'DSPC',
  'CHL',
  'CHOL',
  'CHL1',
  'SM',
  'PA',
  'PC',
  'OL',
  'PE',
  'PS',
  'PG',
  'PI'
])

const NUCLEIC_RESNAMES = new Set([
  'A',
  'C',
  'G',
  'U',
  'DA',
  'DC',
  'DG',
  'DT',
  'ADE',
  'CYT',
  'GUA',
  'THY',
  'URA'
])

/**
 * @param {unknown} sel
 */
export function selectionUsesCoordinates(sel) {
  const s = String(sel || '')
  return (
    /\bprop\s+(abs\s+)?[xyz]\b/i.test(s) ||
    /\bprop\s+[xyz]\s*[<>!=]/i.test(s) ||
    /\b(around|point|sphzone|cylayer|cyzone)\b/i.test(s)
  )
}

/**
 * @param {unknown} sel
 */
export function selectionUsesByres(sel) {
  return /\bbyres\b/i.test(String(sel || '')) || /\bsame\s+residue\s+as\b/i.test(String(sel || ''))
}

/**
 * True when Each-frame evaluation can change membership as coords move.
 * @param {unknown} sel
 */
export function selectionNeedsEachFrame(sel) {
  return selectionUsesCoordinates(sel)
}

/**
 * @param {{ res_name?: string, res_id?: number, chain_id?: string, resid?: number }} atom
 */
export function residueKey(atom) {
  const chain = String(atom?.chain_id ?? '')
  const resid = atom?.res_id ?? atom?.resid ?? ''
  const resn = String(atom?.res_name ?? '').toUpperCase()
  return `${chain}|${resid}|${resn}`
}

/**
 * @param {string} raw
 * @returns {string[]}
 */
function tokenize(raw) {
  const s = String(raw || '').replace(/\bsame\s+residue\s+as\b/gi, 'byres')
  const out = []
  const re =
    /\s+|([()])|([<>]=|==|!=|<|>)|(:)|(-?\d+\.?\d*(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_']*)/g
  let m
  while ((m = re.exec(s))) {
    if (m[0].trim() === '') continue
    out.push(m[0])
  }
  return out
}

/**
 * @param {string} sel
 * @returns {object | null}
 */
export function parseDynamicSelection(sel) {
  const tokens = tokenize(sel)
  if (!tokens.length) return { type: 'all' }
  let i = 0

  const peek = () => tokens[i] ?? ''
  const take = () => tokens[i++] ?? ''
  const atEnd = () => i >= tokens.length

  function parseOr() {
    let left = parseAnd()
    while (!atEnd() && peek().toLowerCase() === 'or') {
      take()
      left = { type: 'or', left, right: parseAnd() }
    }
    return left
  }

  function parseAnd() {
    let left = parseNot()
    while (!atEnd() && peek().toLowerCase() === 'and') {
      take()
      left = { type: 'and', left, right: parseNot() }
    }
    return left
  }

  function parseNot() {
    if (peek().toLowerCase() === 'not') {
      take()
      return { type: 'not', inner: parseNot() }
    }
    return parsePrimary()
  }

  function parsePrimary() {
    const t = peek()
    if (t === '(') {
      take()
      const inner = parseOr()
      if (peek() !== ')') throw new Error('Missing )')
      take()
      return inner
    }
    if (t.toLowerCase() === 'byres') {
      take()
      return { type: 'byres', inner: parsePrimary() }
    }
    return parsePredicate()
  }

  function takeNames() {
    /** @type {string[]} */
    const names = []
    while (!atEnd() && isNameToken(peek())) {
      const n = take()
      if (isKeyword(n)) {
        i -= 1
        break
      }
      names.push(n)
    }
    return names
  }

  function parseResidList() {
    /** @type {Array<[number, number]>} */
    const ranges = []
    while (!atEnd() && (isNumberToken(peek()) || peek() === ':')) {
      if (!isNumberToken(peek())) break
      const lo = Number(take())
      let hi = lo
      if (peek().toLowerCase() === 'to' || peek() === ':') {
        take()
        if (!isNumberToken(peek())) throw new Error('Expected residue number')
        hi = Number(take())
      }
      ranges.push([Math.min(lo, hi), Math.max(lo, hi)])
    }
    if (!ranges.length) throw new Error('resid needs numbers')
    return ranges
  }

  function parsePredicate() {
    const t = take()
    const key = t.toLowerCase()
    if (key === 'prop') {
      let abs = false
      if (peek().toLowerCase() === 'abs') {
        take()
        abs = true
      }
      const axisTok = take().toLowerCase()
      if (axisTok !== 'x' && axisTok !== 'y' && axisTok !== 'z') {
        throw new Error('prop needs x, y, or z')
      }
      const op = take()
      if (!['<', '>', '<=', '>=', '==', '!='].includes(op)) {
        throw new Error('prop needs a comparison')
      }
      if (!isNumberToken(peek())) throw new Error('prop needs a number')
      return { type: 'prop', axis: axisTok, op, value: Number(take()), abs }
    }
    if (key === 'resname') {
      const ids = takeNames()
      if (!ids.length) throw new Error('resname needs a name')
      return { type: 'resname', ids }
    }
    if (key === 'name') {
      const ids = takeNames()
      if (!ids.length) throw new Error('name needs a name')
      return { type: 'name', ids }
    }
    if (key === 'element') {
      const ids = takeNames()
      if (!ids.length) throw new Error('element needs a name')
      return { type: 'element', ids }
    }
    if (key === 'segid' || key === 'chainid') {
      const ids = takeNames()
      if (!ids.length) throw new Error('chain needs a name')
      return { type: 'chain', ids }
    }
    if (key === 'resid') {
      return { type: 'resid', ranges: parseResidList() }
    }
    if (
      key === 'protein' ||
      key === 'peptide' ||
      key === 'backbone' ||
      key === 'sidechain' ||
      key === 'nucleic' ||
      key === 'water' ||
      key === 'lipid' ||
      key === 'ion' ||
      key === 'ligand' ||
      key === 'all' ||
      key === 'none'
    ) {
      return { type: 'keyword', name: key }
    }
    throw new Error(`Unsupported selection token: ${t}`)
  }

  const ast = parseOr()
  if (!atEnd()) throw new Error(`Unexpected token: ${peek()}`)
  return ast
}

function isNumberToken(t) {
  return /^-?\d/.test(t)
}

function isNameToken(t) {
  return /^[A-Za-z_]/.test(t)
}

function isKeyword(t) {
  return /^(and|or|not|byres|prop|abs|same|residue|as)$/i.test(t)
}

/**
 * @param {object} ast
 * @param {Array<{ index?: number, x: number, y: number, z: number, name?: string, element?: string, res_name?: string, res_id?: number, chain_id?: string }>} atoms
 * @param {Float32Array | null | undefined} xyz
 * @returns {(i: number) => boolean}
 */
function compile(ast, atoms, xyz) {
  switch (ast.type) {
    case 'and': {
      const a = compile(ast.left, atoms, xyz)
      const b = compile(ast.right, atoms, xyz)
      return (i) => a(i) && b(i)
    }
    case 'or': {
      const a = compile(ast.left, atoms, xyz)
      const b = compile(ast.right, atoms, xyz)
      return (i) => a(i) || b(i)
    }
    case 'not': {
      const inner = compile(ast.inner, atoms, xyz)
      return (i) => !inner(i)
    }
    case 'byres': {
      const inner = compile(ast.inner, atoms, xyz)
      const keys = new Set()
      for (let i = 0; i < atoms.length; i++) {
        if (inner(i)) keys.add(residueKey(atoms[i]))
      }
      return (i) => keys.has(residueKey(atoms[i]))
    }
    case 'prop': {
      const axis = ast.axis
      return (i) => {
        const atom = atoms[i]
        const p = readAtomXyz(atom, xyz)
        let v = axis === 'x' ? p.x : axis === 'y' ? p.y : p.z
        if (ast.abs) v = Math.abs(v)
        return compare(v, ast.op, ast.value)
      }
    }
    case 'resname': {
      const ids = new Set(ast.ids.map((n) => String(n).toUpperCase()))
      return (i) => ids.has(String(atoms[i].res_name || '').toUpperCase())
    }
    case 'name': {
      const ids = new Set(ast.ids.map((n) => String(n).toUpperCase()))
      return (i) => ids.has(String(atoms[i].name || '').toUpperCase())
    }
    case 'element': {
      const ids = new Set(ast.ids.map((n) => String(n).toUpperCase()))
      return (i) => ids.has(String(atoms[i].element || '').toUpperCase())
    }
    case 'chain': {
      const ids = new Set(ast.ids.map((n) => String(n)))
      return (i) => ids.has(String(atoms[i].chain_id ?? ''))
    }
    case 'resid': {
      const ranges = ast.ranges
      return (i) => {
        const r = Number(atoms[i].res_id)
        if (!Number.isFinite(r)) return false
        return ranges.some(([lo, hi]) => r >= lo && r <= hi)
      }
    }
    case 'keyword':
      return compileKeyword(ast.name, atoms)
    case 'all':
      return () => true
    default: {
      const _x = /** @type {never} */ (ast)
      void _x
      return () => false
    }
  }
}

function compileKeyword(name, atoms) {
  switch (name) {
    case 'all':
      return () => true
    case 'none':
      return () => false
    case 'protein':
    case 'peptide':
      return (i) => PROTEIN_RESNAMES.has(String(atoms[i].res_name || '').toUpperCase())
    case 'nucleic':
      return (i) => NUCLEIC_RESNAMES.has(String(atoms[i].res_name || '').toUpperCase())
    case 'water':
      return (i) => WATER_RESNAMES.has(String(atoms[i].res_name || '').toUpperCase())
    case 'ion':
      return (i) => ION_RESNAMES.has(String(atoms[i].res_name || '').toUpperCase())
    case 'lipid':
      return (i) => LIPID_RESNAMES.has(String(atoms[i].res_name || '').toUpperCase())
    case 'backbone':
      return (i) =>
        PROTEIN_RESNAMES.has(String(atoms[i].res_name || '').toUpperCase()) &&
        isBackboneName(atoms[i].name)
    case 'sidechain':
      return (i) =>
        PROTEIN_RESNAMES.has(String(atoms[i].res_name || '').toUpperCase()) &&
        !isBackboneName(atoms[i].name)
    case 'ligand':
      return (i) => {
        const rn = String(atoms[i].res_name || '').toUpperCase()
        return (
          !PROTEIN_RESNAMES.has(rn) &&
          !WATER_RESNAMES.has(rn) &&
          !ION_RESNAMES.has(rn) &&
          !LIPID_RESNAMES.has(rn) &&
          !NUCLEIC_RESNAMES.has(rn)
        )
      }
    default:
      return () => false
  }
}

function compare(value, op, rhs) {
  switch (op) {
    case '<':
      return value < rhs
    case '>':
      return value > rhs
    case '<=':
      return value <= rhs
    case '>=':
      return value >= rhs
    case '==':
      return Math.abs(value - rhs) < 1e-4
    case '!=':
      return Math.abs(value - rhs) >= 1e-4
    default:
      return false
  }
}

/**
 * Atom indices matching ``selection`` on current xyz, or null if unsupported.
 * @param {Array<{ index?: number, x: number, y: number, z: number, name?: string, element?: string, res_name?: string, res_id?: number, chain_id?: string }>} atoms
 * @param {string} selection
 * @param {Float32Array | null | undefined} xyz
 * @returns {Set<number> | null}
 */
export function evaluateSelectionIndices(atoms, selection, xyz = null) {
  if (!atoms?.length) return new Set()
  const result = trySubsetBySelection(atoms, [], [], selection, xyz)
  if (!result.ok) return null
  return new Set(
    result.atoms.map((a) => a.index).filter((idx) => typeof idx === 'number')
  )
}

/**
 * Filter an already-loaded structure by an MDAnalysis-like string.
 * Use this instead of ``/get-structure`` when atoms are in memory (trajectories).
 *
 * ``fallback: true`` means the client parser cannot handle the string (around,
 * bonded, …) and the backend should run it. Incomplete typing is ``invalid``.
 *
 * @param {object[]} atoms
 * @param {unknown[]} [bonds]
 * @param {Array<{ atom_indices?: number[] }>} [residues]
 * @param {string} selection
 * @param {Float32Array | null | undefined} [xyz]
 * @returns {{
 *   ok: true,
 *   atoms: object[],
 *   bonds: unknown[],
 *   residues: object[]
 * } | {
 *   ok: false,
 *   fallback: boolean,
 *   invalid?: boolean
 * }}
 */
export function trySubsetBySelection(atoms, bonds, residues, selection, xyz = null) {
  const query = String(selection || '').trim() || 'all'
  if (!atoms?.length) return { ok: false, fallback: true }
  if (query.toLowerCase() === 'all') {
    return {
      ok: true,
      atoms,
      bonds: bonds || [],
      residues: residues || []
    }
  }
  try {
    const ast = parseDynamicSelection(query)
    const pred = compile(ast, atoms, xyz)
    /** @type {Set<number>} */
    const indexSet = new Set()
    for (let i = 0; i < atoms.length; i++) {
      if (!pred(i)) continue
      const idx = atoms[i].index
      if (typeof idx === 'number') indexSet.add(idx)
    }
    return { ok: true, ...filterByIndexSet(atoms, bonds, residues, indexSet) }
  } catch (err) {
    const msg = String(err && err.message ? err.message : err)
    if (/Unsupported selection token/i.test(msg)) {
      return { ok: false, fallback: true }
    }
    return { ok: false, fallback: false, invalid: true }
  }
}

/**
 * @param {object[]} atoms
 * @param {unknown[]} [bonds]
 * @param {Array<{ atom_indices?: number[] }>} [residues]
 * @param {Set<number>} indexSet
 */
export function filterByIndexSet(atoms, bonds, residues, indexSet) {
  const nextAtoms = (atoms || []).filter(
    (a) => typeof a.index === 'number' && indexSet.has(a.index)
  )
  const nextBonds = (bonds || []).filter((b) => {
    if (!Array.isArray(b) || b.length < 2) return false
    return indexSet.has(Number(b[0])) && indexSet.has(Number(b[1]))
  })
  const nextResidues = (residues || []).filter((r) =>
    (r.atom_indices || []).some((idx) => indexSet.has(idx))
  )
  return { atoms: nextAtoms, bonds: nextBonds, residues: nextResidues }
}
