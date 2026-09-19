import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  claimedStructureIds,
  claimedViewIds,
  createVisibilityGroup,
  dissolveVisibilityGroup,
  groupsForStructure,
  normalizeVisibilityGroups,
  pruneVisibilityGroups,
  rangeSelectIds,
  reorderVisibilityGroup,
  serializeVisibilityGroups,
  structureGroups
} from './visualizeGroups.js'

test('normalize migrates legacy and sets kind', () => {
  const g = normalizeVisibilityGroups([
    { id: 'a', name: 'Mol', structureIds: ['s1', 's2'], viewIds: [] },
    { id: 'b', name: 'Rep', structureId: 's1', viewIds: ['v1'] }
  ])
  assert.equal(g[0].kind, 'structures')
  assert.deepEqual(g[0].structureIds, ['s1', 's2'])
  assert.equal(g[1].kind, 'views')
  assert.equal(g[1].structureId, 's1')
})

test('create structure group is one outer group', () => {
  const next = createVisibilityGroup([], {
    name: 'Set A',
    structureIds: ['s1', 's2', 's3'],
    views: []
  })
  assert.equal(next.length, 1)
  assert.equal(next[0].kind, 'structures')
  assert.equal(next[0].name, 'Set A')
  assert.deepEqual(next[0].structureIds, ['s1', 's2', 's3'])
})

test('create representation groups nest under each structure', () => {
  const views = [
    { id: 'v1', structureId: 's1' },
    { id: 'v2', structureId: 's1' },
    { id: 'v3', structureId: 's2' }
  ]
  const next = createVisibilityGroup([], {
    name: 'Ligands',
    viewIds: ['v1', 'v3'],
    views
  })
  assert.equal(next.length, 2)
  assert.ok(next.every((g) => g.kind === 'views'))
  assert.equal(next[0].structureId, 's1')
  assert.deepEqual(next[0].viewIds, ['v1'])
  assert.equal(next[1].structureId, 's2')
})

test('selecting structures does not expand into nested view groups', () => {
  const views = [
    { id: 'v1', structureId: 's1' },
    { id: 'v2', structureId: 's2' }
  ]
  const next = createVisibilityGroup([], {
    structureIds: ['s1', 's2'],
    viewIds: [],
    views
  })
  assert.equal(next.length, 1)
  assert.equal(next[0].kind, 'structures')
  assert.equal(structureGroups(next).length, 1)
  assert.equal(groupsForStructure(next, 's1').length, 0)
})

test('prune keeps both kinds', () => {
  const map = new Map([
    ['v1', 's1'],
    ['v2', 's2']
  ])
  const pruned = pruneVisibilityGroups(
    [
      { id: 'g1', name: 'M', kind: 'structures', structureIds: ['s1', 'gone'], viewIds: [] },
      { id: 'g2', name: 'V', kind: 'views', structureId: 's1', viewIds: ['v1', 'gone'], structureIds: [] }
    ],
    ['s1', 's2'],
    ['v1', 'v2'],
    map
  )
  assert.equal(pruned.length, 2)
  assert.deepEqual(pruned[0].structureIds, ['s1'])
  assert.deepEqual(pruned[1].viewIds, ['v1'])
})

test('reorder / claimed / dissolve', () => {
  let groups = [
    { id: 'g1', name: 'A', kind: 'structures', structureIds: ['s1'], viewIds: [] },
    { id: 'g2', name: 'B', kind: 'structures', structureIds: ['s2'], viewIds: [] },
    { id: 'g3', name: 'C', kind: 'views', structureId: 's1', structureIds: [], viewIds: ['v1'] }
  ]
  groups = reorderVisibilityGroup(groups, 'g1', 1)
  assert.equal(groups[0].id, 'g2')
  assert.ok(claimedStructureIds(groups).has('s1'))
  assert.ok(claimedViewIds(groups).has('v1'))
  groups = dissolveVisibilityGroup(groups, 'g3')
  assert.equal(claimedViewIds(groups).size, 0)
  assert.equal(serializeVisibilityGroups(groups)[0].kind, 'structures')
})

test('rangeSelectIds', () => {
  assert.deepEqual(rangeSelectIds(['a', 'b', 'c'], 'a', 'c'), ['a', 'b', 'c'])
})
