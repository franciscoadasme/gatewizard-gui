import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeMaestroProperties,
  pickHeadlineProperty,
  formatHeadlineValue,
  formatHeadlineLine,
  displayPropertyLabel,
  compareStructuresByHeadline,
  groupPropertyColumns,
  propertyFamily,
  defaultVisibleColumns,
  formatPropertyCell,
  shortPropertyLabel
} from './maestroProperties.js'

test('normalizeMaestroProperties keeps typed values', () => {
  const props = normalizeMaestroProperties([
    { name: 'r_i_docking_score', type: 'real', value: '-8.5' },
    { name: 'i_i_glide_lignum', type: 'integer', value: 3.9 },
    { name: 'b_m_selected', type: 'boolean', value: 1 },
    { name: 's_user_note', type: 'string', value: 'ok' },
    { name: 'bad', type: 'real', value: 'x' },
    null
  ])
  assert.deepEqual(props, [
    { name: 'r_i_docking_score', type: 'real', value: -8.5 },
    { name: 'i_i_glide_lignum', type: 'integer', value: 3 },
    { name: 'b_m_selected', type: 'boolean', value: true },
    { name: 's_user_note', type: 'string', value: 'ok' }
  ])
})

test('pickHeadlineProperty prefers MMGBSA then docking score', () => {
  const props = normalizeMaestroProperties([
    { name: 'r_i_glide_gscore', type: 'real', value: -7 },
    { name: 'r_i_docking_score', type: 'real', value: -8 },
    { name: 'r_psp_MMGBSA_dG_Bind', type: 'real', value: -42.3 }
  ])
  assert.equal(pickHeadlineProperty(props)?.name, 'r_psp_MMGBSA_dG_Bind')
  assert.equal(
    pickHeadlineProperty(props.filter((p) => p.name !== 'r_psp_MMGBSA_dG_Bind'))?.name,
    'r_i_docking_score'
  )
  assert.equal(
    pickHeadlineProperty([{ name: 'r_custom_energy', type: 'real', value: 1.25 }])?.name,
    'r_custom_energy'
  )
  assert.equal(pickHeadlineProperty([]), null)
})

test('pickHeadlineProperty honors a preferred name', () => {
  const props = normalizeMaestroProperties([
    { name: 'r_i_docking_score', type: 'real', value: -8 },
    { name: 'r_psp_MMGBSA_dG_Bind', type: 'real', value: -42.3 }
  ])
  assert.equal(pickHeadlineProperty(props, 'r_i_docking_score')?.value, -8)
  assert.equal(pickHeadlineProperty(props, 'r_missing'), null)
})

test('formatHeadlineValue and line show name and kcal/mol', () => {
  const prop = { name: 'r_psp_MMGBSA_dG_Bind', type: 'real', value: -42.3 }
  assert.equal(formatHeadlineValue(prop), '-42.30 kcal/mol')
  assert.equal(
    formatHeadlineValue({ name: 'r_i_docking_score', type: 'real', value: -8.5 }),
    '-8.500 kcal/mol'
  )
  assert.equal(formatHeadlineValue(null), '')
  assert.equal(displayPropertyLabel('r_psp_MMGBSA_dG_Bind'), 'MMGBSA ΔG bind')
  assert.equal(formatHeadlineLine(prop), 'MMGBSA ΔG bind  -42.30 kcal/mol')
})

test('groupPropertyColumns orders families', () => {
  const groups = groupPropertyColumns([
    {
      properties: [
        { name: 's_user_note', type: 'string', value: 'a' },
        { name: 'r_i_docking_score', type: 'real', value: -8 },
        { name: 'r_psp_MMGBSA_dG_Bind', type: 'real', value: -40 },
        { name: 'r_custom', type: 'real', value: 1 }
      ]
    }
  ])
  assert.deepEqual(
    groups.map((g) => g.family),
    ['mmgbsa', 'glide', 'other_real', 'string']
  )
  assert.equal(propertyFamily('r_i_docking_score'), 'glide')
  assert.equal(shortPropertyLabel('r_i_docking_score'), 'i_docking_score')
  const visible = defaultVisibleColumns(groups)
  assert.ok(visible.includes('r_psp_MMGBSA_dG_Bind'))
  assert.ok(visible.includes('r_i_docking_score'))
})

test('compareStructuresByHeadline sorts missing last', () => {
  const a = {
    ctIndex: 0,
    properties: [{ name: 'r_i_docking_score', type: 'real', value: -8 }]
  }
  const b = {
    ctIndex: 1,
    properties: [{ name: 'r_i_docking_score', type: 'real', value: -5 }]
  }
  const c = { ctIndex: 2, properties: [] }
  assert.ok(compareStructuresByHeadline(a, b, 'r_i_docking_score', 'asc') < 0)
  assert.ok(compareStructuresByHeadline(a, b, 'r_i_docking_score', 'desc') > 0)
  assert.ok(compareStructuresByHeadline(c, a, 'r_i_docking_score', 'asc') > 0)
})

test('formatPropertyCell blanks missing values', () => {
  assert.equal(formatPropertyCell(null), '')
  assert.equal(
    formatPropertyCell({ name: 'r_i_docking_score', type: 'real', value: -8.5 }),
    '-8.500'
  )
  assert.equal(formatPropertyCell({ name: 'b_m_selected', type: 'boolean', value: false }), 'no')
})
