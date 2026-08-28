import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyPlotSourcesToResult,
  capturePlotSourceFiles,
  durationNs,
  linspaceInclusive
} from './analysisPlotSources.js'

test('linspaceInclusive matches numpy endpoints', () => {
  assert.deepEqual(linspaceInclusive(0, 50, 5), [0, 12.5, 25, 37.5, 50])
  assert.deepEqual(linspaceInclusive(10, 10, 3), [10, 10, 10])
  assert.equal(linspaceInclusive(0, 1, 0).length, 0)
})

test('capturePlotSourceFiles splits concatenated linspace files at the shared endpoint', () => {
  const x = [...linspaceInclusive(0, 50, 5), ...linspaceInclusive(50, 250, 5)]
  const segs = capturePlotSourceFiles(x, [
    { path: '/a/eq.dcd', timeNs: '50' },
    { path: '/a/prod.dcd', timeNs: '200' }
  ])
  assert.ok(segs)
  assert.equal(segs[0].nPoints, 5)
  assert.equal(segs[0].start, 0)
  assert.equal(segs[1].nPoints, 5)
  assert.equal(segs[1].start, 5)
  assert.equal(segs[0].basename, 'eq.dcd')
})

test('applyPlotSourcesToResult drops a removed trajectory and rescales remaining Time (ns)', () => {
  const x = [...linspaceInclusive(0, 50, 5), ...linspaceInclusive(50, 250, 5)]
  const y = [1, 2, 3, 4, 5, 10, 20, 30, 40, 50]
  const res = {
    lastAnalysisHasTimeX: true,
    rawX: x,
    rawY: y,
    extraSeries: [{ name: 'Upper leaflet', rawY: y.map((v) => v + 1) }],
    sourceFiles: capturePlotSourceFiles(x, [
      { path: 'eq.dcd', timeNs: '50' },
      { path: 'prod.dcd', timeNs: '200' }
    ])
  }
  const dropped = applyPlotSourcesToResult(res, [{ path: 'prod.dcd', timeNs: '200' }])
  assert.equal(dropped.rawY.length, 5)
  assert.deepEqual(dropped.rawY, [10, 20, 30, 40, 50])
  assert.equal(dropped.rawX[0], 0)
  assert.equal(dropped.rawX.at(-1), 200)
  assert.deepEqual(dropped.extraSeries[0].rawY, [11, 21, 31, 41, 51])

  const scaled = applyPlotSourcesToResult(res, [
    { path: 'eq.dcd', timeNs: '50' },
    { path: 'prod.dcd', timeNs: '400' }
  ])
  assert.equal(scaled.rawY.length, 10)
  assert.equal(scaled.rawX[0], 0)
  assert.equal(scaled.rawX[4], 50)
  assert.equal(scaled.rawX.at(-1), 450)
})

test('applyPlotSourcesToResult is a no-op when files and durations are unchanged', () => {
  const x = linspaceInclusive(0, 50, 4)
  const files = [{ path: 'a.dcd', timeNs: '50' }]
  const res = {
    rawX: x,
    rawY: [1, 2, 3, 4],
    sourceFiles: capturePlotSourceFiles(x, files)
  }
  const out = applyPlotSourcesToResult(res, [{ path: 'a.dcd', timeNs: '50.0' }])
  assert.equal(out, res)
  assert.equal(durationNs('50.0'), durationNs('50'))
})

test('capturePlotSourceFiles returns null without durations (cannot split)', () => {
  assert.equal(
    capturePlotSourceFiles([0, 1, 2], [{ path: 'a.dcd', timeNs: '' }]),
    null
  )
})
