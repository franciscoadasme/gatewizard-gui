import assert from 'node:assert/strict'
import test from 'node:test'
import {
  effectiveViewSelection,
  isNamedSelectionKeyword,
  namedSelectionFromView,
  structureFetchSelection
} from './viewSelection.js'

test('empty selection + ion baseSelection is ion, not all', () => {
  const view = { selection: '', baseSelection: 'ion' }
  assert.equal(effectiveViewSelection(view), 'ion')
  assert.equal(namedSelectionFromView(view), 'ion')
  assert.equal(structureFetchSelection('other', view), 'ion')
  assert.equal(structureFetchSelection('ion', view), 'ion')
})

test('named protein / water follow the same empty-selection save pattern', () => {
  assert.equal(effectiveViewSelection({ selection: '', baseSelection: 'protein' }), 'protein')
  assert.equal(namedSelectionFromView({ selection: '', baseSelection: 'water' }), 'water')
  assert.equal(structureFetchSelection('other', { selection: '', baseSelection: 'protein' }), 'protein')
})

test('custom selections stay custom', () => {
  const view = { selection: 'resname DMU', baseSelection: 'resname DMU' }
  assert.equal(effectiveViewSelection(view), 'resname DMU')
  assert.equal(namedSelectionFromView(view), 'other')
  assert.equal(structureFetchSelection('other', view), 'resname DMU')
})

test('dropdown keyword wins over a stale empty custom field', () => {
  assert.equal(structureFetchSelection('ion', { selection: '', baseSelection: 'protein' }), 'ion')
})

test('isNamedSelectionKeyword is case-insensitive and ignores other', () => {
  assert.equal(isNamedSelectionKeyword('Ion'), true)
  assert.equal(isNamedSelectionKeyword('other'), false)
  assert.equal(namedSelectionFromView({ selection: 'Ion', baseSelection: '' }), 'ion')
})

test('missing fields default to all', () => {
  assert.equal(effectiveViewSelection({}), 'all')
  assert.equal(structureFetchSelection('other', {}), 'all')
  assert.equal(namedSelectionFromView({}), 'other')
})
