import {
  blendSchemeResolvers,
  chainScheme,
  constantScheme,
  cpkScheme,
  defaultColorScheme,
  goodsellChainScheme,
  residueNatureScheme,
  ssScheme
} from '../colorSchemes.js'

/**
 * @param {{ name?: string, color?: string } | null | undefined} colorScheme
 * @param {{ residues?: unknown[], ssColors?: Record<string, string> | null }} view
 */
export function rebuildColorScheme(colorScheme, view) {
  const name = colorScheme?.name ?? 'cpk'
  const color = colorScheme?.color
  if (name === 'constant' && color) {
    return { name, color, resolver: constantScheme(color) }
  }
  if (name === 'constant') {
    return { name, color: '#00aaff', resolver: constantScheme('#00aaff') }
  }
  if (name === 'cpk-carbon' && color) {
    return { name, color, resolver: cpkScheme({ carbonColor: color }) }
  }
  if (name === 'chain') return { name, resolver: chainScheme() }
  if (name === 'goodsell') return { name, resolver: goodsellChainScheme() }
  if (name === 'residue_nature') return { name, resolver: residueNatureScheme() }
  if (name === 'ss') {
    const residues = view.residues
    const ssColors = view.ssColors
    return {
      name,
      resolver: residues?.length ? ssScheme(residues, ssColors ?? {}) : cpkScheme()
    }
  }
  if (name === 'cpk') return { name, resolver: cpkScheme() }
  return { name: 'default', resolver: defaultColorScheme }
}

/**
 * Install a stable per-atom blend resolver. Returns false when there is no blend.
 * @param {Record<string, any>} live
 * @param {{ from?: { name?: string, color?: string }, to?: { name?: string, color?: string }, fromSs?: Record<string, string> | null, toSs?: Record<string, string> | null, t?: number } | null | undefined} blend
 */
export function installSchemeBlend(live, blend) {
  if (!blend?.from || !blend?.to || typeof blend.t !== 'number') return false
  const residueCount = /** @type {unknown[] | undefined} */ (live.residues)?.length ?? 0
  const endSig = JSON.stringify([
    blend.from.name ?? 'cpk',
    blend.from.color ?? null,
    blend.to.name ?? 'cpk',
    blend.to.color ?? null,
    blend.fromSs ?? null,
    blend.toSs ?? null,
    residueCount
  ])
  const t = Math.max(0, Math.min(1, blend.t))
  const liveResolver = live.colorScheme?.resolver
  if (live._blendEndSig === endSig && typeof liveResolver?.setBlendT === 'function') {
    liveResolver.setBlendT(t)
  } else {
    const fromBuilt = rebuildColorScheme(blend.from, {
      residues: live.residues,
      ssColors: blend.fromSs ?? null
    })
    const toBuilt = rebuildColorScheme(blend.to, {
      residues: live.residues,
      ssColors: blend.toSs ?? null
    })
    const resolver = blendSchemeResolvers(fromBuilt.resolver, toBuilt.resolver, t)
    live.colorScheme = {
      name: t < 0.5 ? fromBuilt.name : toBuilt.name,
      ...(t < 0.5
        ? fromBuilt.color
          ? { color: fromBuilt.color }
          : {}
        : toBuilt.color
          ? { color: toBuilt.color }
          : {}),
      resolver
    }
    live._blendEndSig = endSig
  }
  live._colorSchemeSig = `${endSig}:${t.toFixed(4)}`
  return true
}
