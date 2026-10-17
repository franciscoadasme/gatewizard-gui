/** One-letter codes for residues drawn in the sequence bar. */
export const AA1 = {
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

const PROTEIN = new Set(Object.keys(AA1))

/** A gap of this many residues can be built. Longer holes are only a warning. */
export const SHORT_GAP_MAX = 6

/**
 * Protein residues of the loaded structure, one row per chain, with numbering holes marked.
 * @param {Array<{ res_name?: string, res_id?: number, chain_id?: string }> | null | undefined} atoms
 */
export function buildSequenceChains(atoms) {
  if (!atoms?.length) return []
  /** @type {Map<string, Array<{ kind: 'res', chain: string, resid: number, resname: string, letter: string, key: string }>>} */
  const chains = new Map()
  const seen = new Set()
  for (const atom of atoms) {
    const resname = String(atom.res_name || '').toUpperCase()
    if (!PROTEIN.has(resname)) continue
    const chain = String(atom.chain_id || '').trim() || '_'
    const resid = Number(atom.res_id)
    if (!Number.isFinite(resid)) continue
    const key = `${chain}|${resid}`
    if (seen.has(key)) continue
    seen.add(key)
    if (!chains.has(chain)) chains.set(chain, [])
    chains.get(chain).push({
      kind: 'res',
      chain,
      resid,
      resname,
      letter: AA1[resname] || 'X',
      key
    })
  }
  /** @type {Array<{ chain: string, items: object[] }>} */
  const rows = []
  for (const [chain, residues] of chains) {
    residues.sort((a, b) => a.resid - b.resid)
    /** @type {object[]} */
    const items = []
    for (let i = 0; i < residues.length; i++) {
      if (i > 0) {
        const prev = residues[i - 1]
        const gap = residues[i].resid - prev.resid - 1
        if (gap > 0) {
          items.push({
            kind: 'gap',
            chain,
            count: gap,
            after: prev.resid,
            before: residues[i].resid,
            fillable: gap >= 1 && gap <= SHORT_GAP_MAX,
            key: `${chain}|gap|${prev.resid}|${residues[i].resid}`
          })
        }
      }
      items.push(residues[i])
    }
    rows.push({ chain, items })
  }
  return rows
}

/**
 * Overlay the preparation scan so a short hole without SEQRES is not marked as fillable.
 * @param {Array<{ chain: string, items: object[] }>} chains
 * @param {{ gaps?: Array<{ chain: string, after_resid: number, before_resid: number, action: string, reason?: string }> } | null | undefined} report
 */
export function applyGapReport(chains, report) {
  if (!report?.gaps?.length) return chains
  const byGap = new Map(
    report.gaps.map((gap) => [`${gap.chain}|${gap.after_resid}|${gap.before_resid}`, gap])
  )
  return chains.map((row) => ({
    ...row,
    items: row.items.map((item) => {
      if (item.kind !== 'gap') return item
      const match = byGap.get(`${row.chain}|${item.after}|${item.before}`)
      if (!match) return item
      return {
        ...item,
        fillable: match.action === 'fill',
        reason: match.reason || '',
        sequence: Array.isArray(match.sequence) ? match.sequence : []
      }
    })
  }))
}

/**
 * @param {Array<{ chain: string, items: object[] }>} chains
 * @returns {Set<string>}
 */
export function allResidueKeys(chains) {
  const keys = new Set()
  for (const row of chains) {
    for (const item of row.items) {
      if (item.kind === 'res') keys.add(item.key)
    }
  }
  return keys
}

/**
 * Residues from `fromKey` through `toKey` on the same chain.
 * @param {Array<{ chain: string, items: object[] }>} chains
 * @param {string} fromKey
 * @param {string} toKey
 * @param {Set<string>} baseKeys
 * @param {boolean} additive
 */
export function keysInRange(chains, fromKey, toKey, baseKeys, additive) {
  const fromChain = fromKey.split('|')[0]
  const row = chains.find((item) => item.chain === fromChain)
  const next = additive ? new Set(baseKeys) : new Set()
  if (!row || fromKey.split('|')[0] !== toKey.split('|')[0]) {
    if (!additive) next.add(toKey)
    else next.add(toKey)
    return next
  }
  const residues = row.items.filter((item) => item.kind === 'res')
  const a = residues.findIndex((item) => item.key === fromKey)
  const b = residues.findIndex((item) => item.key === toKey)
  if (a < 0 || b < 0) {
    next.add(toKey)
    return next
  }
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  for (let i = lo; i <= hi; i++) next.add(residues[i].key)
  return next
}

/**
 * MDAnalysis selection for the residue keys (`chain|resid`).
 * @param {Iterable<string>} keys
 */
export function selectionFromKeys(keys) {
  /** @type {Map<string, number[]>} */
  const byChain = new Map()
  for (const key of keys) {
    const [chain, residStr] = String(key).split('|')
    const resid = Number(residStr)
    if (!chain || !Number.isFinite(resid)) continue
    if (!byChain.has(chain)) byChain.set(chain, [])
    byChain.get(chain).push(resid)
  }
  const parts = []
  for (const [chain, resids] of byChain) {
    resids.sort((a, b) => a - b)
    /** @type {string[]} */
    const ranges = []
    let start = resids[0]
    let end = resids[0]
    for (const resid of resids.slice(1)) {
      if (resid === end + 1) end = resid
      else {
        ranges.push(start === end ? `resid ${start}` : `resid ${start} to ${end}`)
        start = end = resid
      }
    }
    ranges.push(start === end ? `resid ${start}` : `resid ${start} to ${end}`)
    const chainTok = chain === '_' ? '' : `chainID ${chain} and `
    parts.push(`(${chainTok}(${ranges.join(' or ')}))`)
  }
  return parts.join(' or ')
}

/** One-letter code for a standard residue name. Variants of histidine stay H. */
const LETTER = {
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
  VAL: 'V'
}

const FROM_LETTER = Object.fromEntries(Object.entries(LETTER).map(([name, letter]) => [letter, name]))

/**
 * @param {string[] | undefined} names
 */
export function sequenceToText(names) {
  if (!names?.length) return ''
  const letters = names.map((name) => LETTER[String(name).toUpperCase()] || '')
  if (letters.every(Boolean)) return letters.join('')
  return names.join(' ')
}

/**
 * One-letter text of length `count`, or three-letter names separated by spaces.
 * @param {string} text
 * @param {number} count
 * @returns {{ sequence: string[] } | { error: string }}
 */
export function parseGapSequence(text, count) {
  const raw = String(text || '').trim().toUpperCase()
  if (!raw) return { error: 'Enter a sequence' }
  const tokens = /[\s,;/-]/.test(raw) ? raw.split(/[\s,;/-]+/).filter(Boolean) : [...raw]
  if (tokens.length !== count) {
    return { error: `Need ${count} residues` }
  }
  /** @type {string[]} */
  const sequence = []
  for (const token of tokens) {
    if (token.length === 1) {
      const name = FROM_LETTER[token]
      if (!name) return { error: `Unknown residue ${token}` }
      sequence.push(name)
    } else if (token.length === 3) {
      sequence.push(token)
    } else {
      return { error: `Unknown residue ${token}` }
    }
  }
  return { sequence }
}

/**
 * Click adds that residue. Clicking it again removes only that residue.
 * @param {Set<string>} selected
 * @param {string} key
 */
export function clickResidueSelection(selected, key) {
  const next = new Set(selected)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}
