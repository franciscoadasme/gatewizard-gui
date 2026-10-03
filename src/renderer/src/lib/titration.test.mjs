import test from 'node:test'
import assert from 'node:assert/strict'
import {
  deriveTitrationView,
  isProtonated,
  suggestTitrationCurveIds,
  titrationTypeColor
} from './titration.js'

const residues = [
  { id: 'ASP42:A', label: 'ASP42', residue: 'ASP', pka: 4.1 },
  { id: 'GLU10:A', label: 'GLU10', residue: 'GLU', pka: 4.4 },
  { id: 'HIS72:A', label: 'HIS72', residue: 'HIS', pka: 6.2 },
  { id: 'LYS569:A', label: 'LYS569', residue: 'LYS', pka: 10.4 },
  { id: 'ARG5:A', label: 'ARG5', residue: 'ARG', pka: 12.5 }
]

test('suggestTitrationCurveIds prefers residues near the target pH', () => {
  const ids = suggestTitrationCurveIds(residues, 6, 4)
  assert.ok(ids.includes('HIS72:A'))
  assert.equal(ids.includes('ARG5:A'), false)
})

test('deriveTitrationView groups types and applies color overrides', () => {
  assert.equal(isProtonated(6.2, 6), true)
  assert.equal(isProtonated(4.1, 6), false)
  const view = deriveTitrationView(
    {
      residues,
      curves: [
        { id: 'HIS72:A', label: 'HIS72', residue: 'HIS', ph: [0, 7, 14], y: [1, 0, 0] },
        { id: 'ASP42:A', label: 'ASP42', residue: 'ASP', ph: [0, 7, 14], y: [1, 0, 0] }
      ]
    },
    {
      targetPh: 6,
      typeFilter: ['ASP', 'HIS'],
      curveIds: ['HIS72:A'],
      colorOverrides: { 'type:HIS': '#112233', 'curve:HIS72:A': '#abcdef' }
    }
  )
  assert.deepEqual(
    view.types.map((t) => t.name),
    ['ASP', 'HIS']
  )
  const his = view.types.find((t) => t.name === 'HIS')
  assert.equal(his.color, '#112233')
  assert.equal(his.fraction, 1)
  assert.equal(view.curves.length, 1)
  assert.equal(view.curves[0].color, '#abcdef')
  assert.equal(titrationTypeColor('ASP', 0), '#e74c3c')
})

test('deriveTitrationView drops excluded residues from panels A and B', () => {
  const view = deriveTitrationView(
    {
      residues: [
        ...residues,
        { id: 'CYS77:A', label: 'CYS77', residue: 'CYS', pka: 99.99 },
        { id: 'CYS449:A', label: 'CYS449', residue: 'CYS', pka: 99.99 },
        { id: 'CYS12:A', label: 'CYS12', residue: 'CYS', pka: 8.4 }
      ],
      curves: []
    },
    { targetPh: 7, excludeIds: ['CYS77:A', 'CYS449:A'] }
  )
  const cys = view.types.find((t) => t.name === 'CYS')
  assert.deepEqual(cys.pka, [8.4])
  assert.equal(cys.points.some((p) => p.id === 'CYS77:A'), false)
})

test('deriveTitrationView always drops disulfide cysteines from panels A and B', () => {
  const view = deriveTitrationView(
    {
      residues: [
        { id: 'CYS77:A', label: 'CYS77', residue: 'CYS', pka: 99.99 },
        { id: 'CYS12:A', label: 'CYS12', residue: 'CYS', pka: 8.4 }
      ],
      curves: []
    },
    { targetPh: 7, disulfideIds: ['CYS77:A'] }
  )
  assert.deepEqual(view.types.find((t) => t.name === 'CYS').pka, [8.4])
})
