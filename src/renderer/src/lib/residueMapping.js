/**
 * Parse GateWizard / pdb4amber residue renumbering files.
 *
 * - `*_gatewizard_residue_mapping.txt`: ORIGINAL_ID … FINAL_ID (e.g. 21 → 2)
 * - `*_protonated_renum.txt` / `*_renum.txt`: FINAL_ID … ORIGINAL_ID (e.g. 2 → 21)
 *
 * Returns Map final resid → original resid.
 */

const MAPPING_LINE = /^\s*(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$/

/**
 * @param {string} text
 * @param {{ path?: string, columnOrder?: 'original_final' | 'final_original' }} [opts]
 * @returns {'original_final' | 'final_original'}
 */
export function detectResidueMappingColumnOrder(text, opts = {}) {
  if (opts.columnOrder === 'original_final' || opts.columnOrder === 'final_original') {
    return opts.columnOrder
  }
  const name = String(opts.path || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .toLowerCase()
  if (name.includes('gatewizard_residue_mapping') || name.includes('gatewizard_to_original')) {
    return 'original_final'
  }
  if (name.endsWith('_renum.txt') || name.endsWith('renum.txt') || name.includes('_renum.')) {
    return 'final_original'
  }

  const header = String(text || '')
    .split(/\r?\n/)
    .slice(0, 12)
    .filter((l) => l.trim().startsWith('#'))
    .join('\n')
    .toUpperCase()
  if (header.includes('ORIGINAL') && header.includes('FINAL')) return 'original_final'

  let origGt = 0
  let finalGt = 0
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const match = MAPPING_LINE.exec(line)
    if (!match) continue
    const aS = match[3]
    const bS = match[5]
    if (aS === '-' || aS === '.' || bS === '-' || bS === '.') continue
    const a = Number.parseInt(aS, 10)
    const b = Number.parseInt(bS, 10)
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) continue
    if (a > b) origGt += 1
    else finalGt += 1
  }
  if (origGt > finalGt) return 'original_final'
  if (finalGt > origGt) return 'final_original'
  return 'original_final'
}

/**
 * @param {string} text
 * @param {{ path?: string, columnOrder?: 'original_final' | 'final_original' }} [opts]
 * @returns {Map<number, number>} final resid → original resid
 */
export function parseResidueMappingText(text, opts = {}) {
  const order = detectResidueMappingColumnOrder(text, opts)
  /** @type {Map<number, number>} */
  const finalToOriginal = new Map()
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const match = MAPPING_LINE.exec(line)
    if (!match) continue
    const idAS = match[3]
    const idBS = match[5]
    const originalIdS = order === 'final_original' ? idBS : idAS
    const finalIdS = order === 'final_original' ? idAS : idBS
    if (originalIdS === '-' || originalIdS === '.') continue
    const originalId = Number.parseInt(originalIdS, 10)
    const finalId = Number.parseInt(finalIdS, 10)
    if (!Number.isFinite(originalId) || !Number.isFinite(finalId)) continue
    finalToOriginal.set(finalId, originalId)
  }
  return finalToOriginal
}

/**
 * @param {Array<number|null|undefined>} resids
 * @param {Map<number, number>|Record<string|number, number>|null|undefined} finalToOriginal
 */
export function shouldApplyResidueMapping(resids, finalToOriginal) {
  const map = asMap(finalToOriginal)
  if (!map.size) return false
  const nums = (resids || []).map((r) => Number(r)).filter((n) => Number.isFinite(n))
  if (!nums.length) return false
  const start = Math.min(...nums)
  if (start > 2) return false
  const mapped = map.get(start)
  return mapped != null && mapped !== start
}

/**
 * Inverse of final→original (first final wins when originals collide).
 * @param {Map<number, number>|Record<string|number, number>|null|undefined} finalToOriginal
 * @returns {Map<number, number>}
 */
export function invertResidueMapping(finalToOriginal) {
  /** @type {Map<number, number>} */
  const inv = new Map()
  for (const [finalId, originalId] of asMap(finalToOriginal)) {
    if (!inv.has(originalId)) inv.set(originalId, finalId)
  }
  return inv
}

/**
 * True when X looks like already-original (or repeatedly remapped) PDB numbers
 * rather than GateWizard finals starting near 1–2.
 * @param {number[]} nums
 * @param {Map<number, number>} map
 */
function looksLikeOriginalResidueAxis(nums, map) {
  if (!nums.length || !map.size) return false
  if (shouldApplyResidueMapping(nums, map)) return false
  const start = Math.min(...nums)
  if (start <= 2) return false
  const origSet = new Set(map.values())
  const minOrig = Math.min(...origSet)
  let origHits = 0
  for (const n of nums) {
    if (origSet.has(n)) origHits += 1
  }
  // Charmm / already-correct / over-remapped axes sit on original ids.
  return origHits >= nums.length * 0.75 || start >= minOrig
}

/**
 * Map topology (final) residue ids → original PDB numbers for plotting.
 *
 * - GateWizard finals (~1–2 start) → remapped
 * - Already-original axes (Charmm, or a prior correct remap) → left alone
 * - Over-remapped / corrupted X with the same point count as the map → rebuild
 *   from sorted finals (Y order is still residue order)
 *
 * Prefer passing stored topology `resids` (not display-remapped CSV X).
 *
 * @param {Array<number|null|undefined>} resids
 * @param {Map<number, number>|Record<string|number, number>|null|undefined} finalToOriginal
 * @param {{ force?: boolean }} [opts] force=true only for tests; prefer default
 * @returns {number[]}
 */
export function remapResidsToOriginal(resids, finalToOriginal, opts = {}) {
  const map = asMap(finalToOriginal)
  const nums = (resids || []).map((r) => Number(r)).filter((n) => Number.isFinite(n))
  if (!nums.length || !map.size) return [...nums]

  if (opts.force) {
    return nums.map((r) => {
      const o = map.get(r)
      return o != null ? o : r
    })
  }

  if (shouldApplyResidueMapping(nums, map)) {
    return nums.map((r) => {
      const o = map.get(r)
      return o != null ? o : r
    })
  }

  if (!looksLikeOriginalResidueAxis(nums, map)) return [...nums]

  const minOrig = Math.min(...map.values())
  const start = Math.min(...nums)
  const mono = nums.every((n, i) => i === 0 || n >= nums[i - 1])
  const unique = new Set(nums).size

  // Already on the canonical original axis (typical Charmm / one correct remap).
  if (start === minOrig && mono && unique === nums.length) return [...nums]

  // Full-protein (or same-length) series: rebuild X from sorted finals.
  // Survives repeated CSV remaps that scrambled X but kept Y in residue order.
  const finals = [...map.keys()].sort((a, b) => a - b)
  if (nums.length === finals.length) {
    return finals.map((f) => map.get(f) ?? f)
  }

  return [...nums]
}

/**
 * @param {string[]} labels
 * @param {Array<number|null|undefined>} resids
 * @param {Map<number, number>|Record<string|number, number>|null|undefined} finalToOriginal
 * @param {{ force?: boolean }} [opts]
 * @returns {string[]}
 */
export function remapResidueTypeLabels(labels, resids, finalToOriginal, opts = {}) {
  const labelList = (labels || []).map((x) => String(x))
  if (!labelList.length) return []
  const map = asMap(finalToOriginal)
  const useResids = Array.isArray(resids) && resids.length === labelList.length
  /** @type {number[]} */
  const topologyIds = useResids
    ? resids.map((r) => Number(r))
    : labelList.map((lab) => {
        const m = /(\d+)\s*$/.exec(lab)
        return m ? Number.parseInt(m[1], 10) : NaN
      })
  const forGate = topologyIds.filter((n) => Number.isFinite(n))
  if (!opts.force && !shouldApplyResidueMapping(forGate, map)) return [...labelList]

  return labelList.map((lab, i) => {
    const rid = topologyIds[i]
    if (!Number.isFinite(rid) || !map.has(rid)) return lab
    const orig = map.get(rid)
    const m = /^(.*?)(\d+)\s*$/.exec(lab)
    if (m) return `${m[1]}${orig}`
    return String(orig)
  })
}

/**
 * Topology residue ids for an RMSF result (stored resids, or residue_number x, or labels).
 * @param {{ resids?: number[], rawX?: number[], xLabels?: string[], lastAnalysisHasTimeX?: boolean }} res
 * @param {string} [rmsfXaxisType]
 * @returns {number[]}
 */
export function topologyResidsFromRmsfResult(res, rmsfXaxisType = 'residue_number') {
  if (!res) return []
  if (Array.isArray(res.resids) && res.resids.length) {
    return res.resids.map((r) => Number(r)).filter((n) => Number.isFinite(n))
  }
  if (rmsfXaxisType === 'residue_number' && Array.isArray(res.rawX) && res.rawX.length) {
    return res.rawX.map((r) => Number(r)).filter((n) => Number.isFinite(n))
  }
  const labels = res.xLabels || []
  return labels
    .map((lab) => {
      const m = /(\d+)\s*$/.exec(String(lab))
      return m ? Number.parseInt(m[1], 10) : NaN
    })
    .filter((n) => Number.isFinite(n))
}

/**
 * @param {Map<number, number>|Record<string|number, number>|null|undefined} finalToOriginal
 * @returns {Map<number, number>}
 */
function asMap(finalToOriginal) {
  if (finalToOriginal instanceof Map) return finalToOriginal
  /** @type {Map<number, number>} */
  const map = new Map()
  if (!finalToOriginal || typeof finalToOriginal !== 'object') return map
  for (const [k, v] of Object.entries(finalToOriginal)) {
    const fk = Number(k)
    const ov = Number(v)
    if (Number.isFinite(fk) && Number.isFinite(ov)) map.set(fk, ov)
  }
  return map
}

/**
 * @typedef {{
 *   id: string,
 *   path: string,
 *   enabled: boolean,
 *   setIds: string[]
 * }} ResidueMappingGroupSpec
 */

/**
 * Normalize session residue-mapping groups (supports legacy single-file fields).
 * @param {unknown} raw
 * @param {{ residueMappingPath?: string, useOriginalResidueNumbers?: boolean, setIds?: string[] }} [legacy]
 * @returns {ResidueMappingGroupSpec[]}
 */
export function normalizeResidueMappingGroups(raw, legacy = {}) {
  if (Array.isArray(raw) && raw.length) {
    /** @type {ResidueMappingGroupSpec[]} */
    const out = []
    raw.forEach((g, i) => {
      if (!g || typeof g !== 'object') return
      const obj = /** @type {Record<string, unknown>} */ (g)
      const path = String(obj.path || '').trim()
      if (!path) return
      const setIds = Array.isArray(obj.setIds)
        ? obj.setIds.map((id) => String(id)).filter(Boolean)
        : []
      out.push({
        id: String(obj.id || `rmap-${i + 1}`),
        path,
        enabled: obj.enabled !== false,
        setIds
      })
    })
    return out
  }
  const legacyPath = String(legacy.residueMappingPath || '').trim()
  if (!legacyPath) return []
  return [
    {
      id: 'rmap-1',
      path: legacyPath,
      enabled: Boolean(legacy.useOriginalResidueNumbers),
      setIds: Array.isArray(legacy.setIds) ? legacy.setIds.map((id) => String(id)) : []
    }
  ]
}

/**
 * @param {ResidueMappingGroupSpec[]} groups
 * @returns {ResidueMappingGroupSpec[]}
 */
export function serializeResidueMappingGroups(groups) {
  return (groups || [])
    .map((g) => ({
      id: String(g.id || ''),
      path: String(g.path || '').trim(),
      enabled: g.enabled !== false,
      setIds: Array.isArray(g.setIds) ? g.setIds.map((id) => String(id)).filter(Boolean) : []
    }))
    .filter((g) => g.path)
}
