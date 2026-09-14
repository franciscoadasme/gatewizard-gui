import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ANALYSIS_OPTIONS_CATALOG,
  rankAnalysisOptions,
  resolveOptionHighlightId
} from './analysisOptionsCatalog.js'
import { STRUCTURAL_TYPE_GROUPS } from './analysisSets.js'

describe('analysisOptionsCatalog', () => {
  it('includes catalog entries and structural type aliases', () => {
    assert.ok(ANALYSIS_OPTIONS_CATALOG.length > 10)
    assert.ok(ANALYSIS_OPTIONS_CATALOG.some((e) => e.id === 'x-tick-step'))
    for (const g of STRUCTURAL_TYPE_GROUPS) {
      for (const t of g.types) {
        assert.ok(
          ANALYSIS_OPTIONS_CATALOG.some((e) => e.structuralType === t),
          `missing type ${t}`
        )
      }
    }
  })

  it('ranks current mode/type hits first', () => {
    const hits = rankAnalysisOptions('legend', {
      mode: 'structural',
      structuralType: 'rmsd'
    })
    assert.ok(hits.length > 0)
    assert.equal(hits[0].panel, 'analysis')
  })

  it('prefers APL method when searching fatslim under APL type', () => {
    const hits = rankAnalysisOptions('fatslim', {
      mode: 'structural',
      structuralType: 'area_per_lipid'
    })
    assert.ok(hits.some((h) => h.id === 'apl-method' || h.structuralType === 'area_per_lipid'))
  })

  it('maps type-* catalog ids to the structural-type control', () => {
    assert.equal(resolveOptionHighlightId({ id: 'type-rmsd', label: 'RMSD' }), 'structural-type')
    assert.equal(resolveOptionHighlightId({ id: 'x-tick-step', label: 'X tick step' }), 'x-tick-step')
  })
})
