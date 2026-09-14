import assert from 'node:assert/strict'
import {
  normalizeResidueMappingGroups,
  parseResidueMappingText,
  remapResidueTypeLabels,
  remapResidsToOriginal,
  serializeResidueMappingGroups,
  shouldApplyResidueMapping,
  topologyResidsFromRmsfResult
} from './residueMapping.js'

const CAPPED = `# GateWizard Residue Mapping File
# Format: ORIGINAL_RESNAME CHAIN ORIGINAL_ID FINAL_RESNAME FINAL_ID
  - A      -    ACE   1
VAL A     21    VAL   2
ALA A     22    ALA   3
GLY A     23    GLY   4
  - A      -    NME   5
`

const PROTONATED_RENUM = `ACE A     1    ACE     1
VAL A     2    VAL    21
ALA A     3    ALA    22
GLY A     4    GLY    23
`

const mapCapped = parseResidueMappingText(CAPPED, {
  path: '7aaq_capped_gatewizard_residue_mapping.txt'
})
assert.deepEqual([...mapCapped.entries()], [[2, 21], [3, 22], [4, 23]])

const mapRenum = parseResidueMappingText(PROTONATED_RENUM, {
  path: '7aaq_protonated_renum.txt'
})
assert.deepEqual([...mapRenum.entries()], [[1, 1], [2, 21], [3, 22], [4, 23]])

assert.equal(shouldApplyResidueMapping([2, 3, 4], mapCapped), true)
assert.equal(shouldApplyResidueMapping([21, 22, 100], mapCapped), false)
assert.deepEqual(remapResidsToOriginal([2, 3, 4], mapCapped), [21, 22, 23])
assert.deepEqual(remapResidsToOriginal([21, 22, 100], mapCapped), [21, 22, 100])
// Already-original axis must not be remapped again (legacy CSV double-apply bug).
assert.deepEqual(remapResidsToOriginal([21, 22, 23], mapCapped), [21, 22, 23])
// Over-remapped full-length series: rebuild from sorted finals (Y order intact).
assert.deepEqual(remapResidsToOriginal([40, 41, 42], mapCapped), [21, 22, 23])
assert.deepEqual(
  remapResidueTypeLabels(['VAL2', 'ALA3'], [2, 3], mapCapped),
  ['VAL21', 'ALA22']
)
assert.deepEqual(
  topologyResidsFromRmsfResult({ resids: [2, 3], rawX: [0, 1] }, 'residue_type_number'),
  [2, 3]
)

const groups = normalizeResidueMappingGroups(undefined, {
  residueMappingPath: '/tmp/a_protonated_renum.txt',
  useOriginalResidueNumbers: true,
  setIds: ['set-1', 'set-2']
})
assert.equal(groups.length, 1)
assert.deepEqual(groups[0].setIds, ['set-1', 'set-2'])
assert.equal(serializeResidueMappingGroups(groups)[0].path, '/tmp/a_protonated_renum.txt')

console.log('residueMapping.test.mjs: ok')
