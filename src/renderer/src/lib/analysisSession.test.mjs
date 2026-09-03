import test from 'node:test'
import assert from 'node:assert/strict'
import {
  computeStatsFromSeries,
  clonePlainAnalysisData,
  csvFileNameForAnalysisSet,
  csvFileNameForEnergeticSet,
  parseAnalysisResultCsv,
  parseEnergeticResultCsv,
  serializeAnalysisSession,
  slimSetsForSessionSave,
  applyCsvToStructuralResult,
  applyCsvToEnergeticResult,
  hydrateAnalysisSessionFromCsv,
  hydrateAnalysisSetsFromCsv,
  setsHaveAnyPlottableResults,
  normalizeEnergeticCompareLayout,
  inferEnergeticGridFill,
  deserializeAnalysisSession,
  hydratePlotColorFlags,
  resolvePlotColors,
  themePlotBackgroundHex
} from './analysisSession.js'
import { structuralResultHasPlotData } from './analysisSets.js'

test('clonePlainAnalysisData copies nested numeric arrays', () => {
  const sets = [
    {
      id: 'set-1',
      structuralResult: {
        analysisType: 'rmsd',
        rawX: [0, 1, 2],
        rawY: [0.9, 1.1, 0.8]
      }
    }
  ]
  const copy = clonePlainAnalysisData(sets)
  assert.notEqual(copy, sets)
  assert.deepEqual(copy[0].structuralResult.rawY, [0.9, 1.1, 0.8])
  copy[0].structuralResult.rawY.push(99)
  assert.equal(sets[0].structuralResult.rawY.length, 3)
})

test('computeStatsFromSeries does not spread huge arrays (renderer crash)', () => {
  const y = new Array(200_000)
  for (let i = 0; i < y.length; i++) y[i] = i
  const stats = computeStatsFromSeries(y)
  assert.equal(stats.min, 0)
  assert.equal(stats.max, 199_999)
  assert.ok(Math.abs(stats.mean - 99999.5) < 1e-6)
})

test('serializeAnalysisSession clones sets without structuredClone', () => {
  const session = serializeAnalysisSession({
    mode: 'structural',
    compareLayout: 'overlay',
    outputFolderName: '04_analysis',
    activeSetId: 'set-1',
    sets: [
      {
        id: 'set-1',
        label: 'Prod',
        structuralResult: { analysisType: 'rmsd', rawX: [1], rawY: [2] }
      }
    ]
  })
  assert.equal(session.version, 1)
  assert.equal(session.sets[0].label, 'Prod')
})

test('serializeAnalysisSession keeps multiple structural types per set', () => {
  const session = serializeAnalysisSession({
    mode: 'structural',
    compareLayout: 'overlay',
    outputFolderName: '04_analysis',
    activeSetId: 'set-1',
    sets: [
      {
        id: 'set-1',
        label: 'Prod',
        structuralResults: {
          membrane_thickness: { analysisType: 'membrane_thickness', rawX: [1], rawY: [2] },
          area_per_lipid: { analysisType: 'area_per_lipid', rawX: [1], rawY: [3] }
        },
        structuralResult: { analysisType: 'area_per_lipid', rawX: [1], rawY: [3] }
      }
    ]
  })
  assert.ok(session.sets[0].structuralResults.membrane_thickness)
  assert.ok(session.sets[0].structuralResults.area_per_lipid)
})

test('slimSetsForSessionSave strips coordinate arrays and records csv names', () => {
  const sets = slimSetsForSessionSave(
    [
      {
        id: 'a',
        label: 'NVT',
        structuralResults: {
          rmsd: { analysisType: 'rmsd', rawX: [0, 1], rawY: [1, 2], seriesName: 'RMSD' }
        },
        structuralResult: { analysisType: 'rmsd', rawX: [0, 1], rawY: [1, 2], seriesName: 'RMSD' }
      },
      {
        id: 'b',
        label: 'NPT',
        structuralResults: {
          rmsd: { analysisType: 'rmsd', rawX: [0, 1], rawY: [3, 4], seriesName: 'RMSD' }
        },
        structuralResult: { analysisType: 'rmsd', rawX: [0, 1], rawY: [3, 4], seriesName: 'RMSD' }
      }
    ],
    'structural'
  )
  assert.deepEqual(sets[0].structuralResults.rmsd.rawY, [])
  assert.equal(sets[0].structuralResults.rmsd.dataCsv, 'set1_rmsd.csv')
  assert.equal(sets[1].structuralResults.rmsd.dataCsv, 'set2_rmsd.csv')
  assert.equal(sets[0].csvStem, 'set1')
  assert.equal(sets[1].csvStem, 'set2')
})

test('slimSetsForSessionSave strips energetic series arrays', () => {
  const sets = slimSetsForSessionSave(
    [
      {
        id: 'e1',
        label: 'Prod',
        energeticResult: {
          rawX: [0, 1, 2],
          rawXTimeUnit: 'ns',
          rawSeries: [{ baseName: 'Temperature', unit: 'K', y: [300, 301, 302], key: 'temp' }],
          selectedProperties: ['Temperature'],
          chartTitle: 't',
          chartXLabel: 'Time',
          energeticEngine: 'openmm'
        }
      }
    ],
    'energetic'
  )
  assert.deepEqual(sets[0].energeticResult.rawX, [])
  assert.deepEqual(sets[0].energeticResult.rawSeries[0].y, [])
  assert.equal(sets[0].energeticResult.rawSeries[0].baseName, 'Temperature')
  assert.equal(sets[0].energeticResult.dataCsv, 'set1_energetic.csv')
  assert.equal(csvFileNameForEnergeticSet({ csvStem: 'set2', label: 'Prod' }, 1), 'set2_energetic.csv')
})

test('normalizeEnergeticCompareLayout maps legacy names to overlay|grid', () => {
  assert.equal(normalizeEnergeticCompareLayout('grid'), 'grid')
  assert.equal(normalizeEnergeticCompareLayout('by_property'), 'grid')
  assert.equal(normalizeEnergeticCompareLayout('by_set'), 'grid')
  assert.equal(normalizeEnergeticCompareLayout('overlay'), 'overlay')
  assert.equal(inferEnergeticGridFill('by_set'), 'by_set')
  assert.equal(inferEnergeticGridFill('by_property'), 'by_property')
})

test('deserializeAnalysisSession keeps structural compareLayout and energetic layout', () => {
  const session = deserializeAnalysisSession({
    version: 1,
    mode: 'energetic',
    compareLayout: 'overlay',
    energeticCompareLayout: 'by_property',
    outputFolderName: '04_analysis',
    activeSetId: 'a',
    sets: [{ id: 'a', label: 'A' }]
  })
  assert.equal(session.compareLayout, 'overlay')
  assert.equal(session.energeticCompareLayout, 'grid')
  assert.equal(session.energeticGridFill, 'by_property')
})

test('deserializeAnalysisSession migrates by_set and round-trips energeticGridLayout', () => {
  const old = deserializeAnalysisSession({
    version: 1,
    mode: 'energetic',
    compareLayout: 'overlay',
    energeticCompareLayout: 'by_set',
    outputFolderName: '04_analysis',
    activeSetId: 'a',
    sets: [{ id: 'a', label: 'A' }]
  })
  assert.equal(old.energeticCompareLayout, 'grid')
  assert.equal(old.energeticGridFill, 'by_set')
  const session = serializeAnalysisSession({
    mode: 'energetic',
    compareLayout: 'overlay',
    energeticCompareLayout: 'grid',
    outputFolderName: '04_analysis',
    activeSetId: 'set-1',
    sets: [{ id: 'set-1', label: 'A' }],
    energeticGridLayout: {
      cols: 2,
      rows: 1,
      cells: [{ setIds: ['set-1'], propertyKeys: ['Temperature'] }],
      edited: true
    }
  })
  const loaded = deserializeAnalysisSession(session)
  assert.equal(loaded.energeticCompareLayout, 'grid')
  assert.deepEqual(loaded.energeticGridLayout.cells[0].propertyKeys, ['Temperature'])
})

test('serializeAnalysisSession round-trips gridLayout', () => {
  const session = serializeAnalysisSession({
    mode: 'structural',
    compareLayout: 'grid',
    outputFolderName: '04_analysis',
    activeSetId: 'set-1',
    sets: [{ id: 'set-1', label: 'A' }, { id: 'set-2', label: 'B' }],
    gridLayout: {
      cols: 3,
      rows: 2,
      lastRowAlign: 'center',
      legendMode: 'outside',
      overlaySetIds: ['set-2', 'set-1'],
      cells: [{ setIds: ['set-1', 'set-2'] }, { setIds: ['set-2'] }],
      edited: true
    }
  })
  const loaded = deserializeAnalysisSession(session)
  assert.equal(loaded.compareLayout, 'grid')
  assert.equal(loaded.gridLayout.cols, 3)
  assert.equal(loaded.gridLayout.lastRowAlign, 'center')
  assert.deepEqual(loaded.gridLayout.cells[0].setIds, ['set-1', 'set-2'])
  assert.deepEqual(loaded.gridLayout.overlaySetIds, ['set-2', 'set-1'])
  assert.equal(loaded.gridLayout.edited, true)
})

test('slimSetsForSessionSave strips both structural and energetic in mixed session', () => {
  const sets = slimSetsForSessionSave(
    [
      {
        id: 'mixed',
        label: 'Prod',
        structuralResults: {
          rmsd: { analysisType: 'rmsd', rawX: [0, 1], rawY: [1, 2], seriesName: 'RMSD' }
        },
        structuralResult: { analysisType: 'rmsd', rawX: [0, 1], rawY: [1, 2], seriesName: 'RMSD' },
        energeticResult: {
          rawX: [0, 1],
          rawSeries: [{ baseName: 'Temperature', unit: 'K', y: [300, 301] }],
          selectedProperties: ['Temperature']
        }
      }
    ],
    'structural'
  )
  assert.deepEqual(sets[0].structuralResults.rmsd.rawY, [])
  assert.deepEqual(sets[0].energeticResult.rawX, [])
  assert.ok(setsHaveAnyPlottableResults(sets))
})

test('parseEnergeticResultCsv and applyCsvToEnergeticResult restore series', () => {
  const csv = `x,Temperature,Total Energy
0,300,1
1,301,2
2,302,3`
  const parsed = parseEnergeticResultCsv(csv)
  assert.equal(parsed.rawX.length, 3)
  const updated = applyCsvToEnergeticResult(
    {
      rawX: [],
      rawSeries: [
        { baseName: 'Temperature', unit: 'K', y: [] },
        { baseName: 'Total Energy', unit: 'kJ/mol', y: [] }
      ],
      selectedProperties: ['Temperature', 'Total Energy']
    },
    parsed
  )
  assert.deepEqual(updated.rawSeries[0].y, [300, 301, 302])
  assert.deepEqual(updated.rawSeries[1].y, [1, 2, 3])
})

test('parseAnalysisResultCsv reads multi-series bilayer exports', () => {
  const csv = `x,Mean area per lipid,Upper leaflet,Lower leaflet
0,34.6,37.1,32.4
1,35.2,38.0,33.1`
  const parsed = parseAnalysisResultCsv(csv, 'area_per_lipid')
  assert.equal(parsed.rawY[0], 34.6)
  assert.equal(parsed.extraSeries.length, 2)
  assert.equal(parsed.extraSeries[0].rawY[1], 38.0)
})

test('applyCsvToStructuralResult replaces stale embedded arrays', () => {
  const res = { analysisType: 'rmsd', rawX: [0], rawY: [9], seriesName: 'RMSD' }
  const updated = applyCsvToStructuralResult(res, {
    rawX: [0, 1],
    rawY: [0.1, 0.2]
  })
  assert.deepEqual(updated.rawY, [0.1, 0.2])
  assert.ok(Math.abs(updated.primaryStats.mean - 0.15) < 1e-9)
})

test('csvFileNameForAnalysisSet uses stable setN stems, not labels', () => {
  assert.equal(csvFileNameForAnalysisSet({ csvStem: 'set1', label: 'NPAT' }, 'rmsd'), 'set1_rmsd.csv')
  assert.equal(csvFileNameForAnalysisSet({ label: 'NPAT' }, 'rmsd', 0), 'set1_rmsd.csv')
  assert.equal(csvFileNameForAnalysisSet({ label: 'NPAT' }, 'rmsd', 2), 'set3_rmsd.csv')
})

test('slimSetsForSessionSave keeps the same CSV name after a set rename', () => {
  const result = {
    analysisType: 'rmsd',
    rawX: [0, 1],
    rawY: [1, 2],
    seriesName: 'RMSD'
  }
  const before = slimSetsForSessionSave([
    { id: 'a', label: 'NVT', csvStem: 'set1', structuralResults: { rmsd: result }, structuralResult: result }
  ])
  const after = slimSetsForSessionSave([
    { id: 'a', label: 'Production NPAT', csvStem: 'set1', structuralResults: { rmsd: result }, structuralResult: result }
  ])
  assert.equal(before[0].structuralResults.rmsd.dataCsv, 'set1_rmsd.csv')
  assert.equal(after[0].structuralResults.rmsd.dataCsv, 'set1_rmsd.csv')
})

test('structuralMeanY rebuilds average from leaflets when rawY is empty', async () => {
  const { structuralMeanY, aplSeriesLabel, aplSeriesColor } = await import('./analysisSets.js')
  assert.deepEqual(
    structuralMeanY({
      rawY: [],
      extraSeries: [
        { name: 'Upper leaflet', rawY: [2, 4] },
        { name: 'Lower leaflet', rawY: [4, 6] }
      ]
    }),
    [3, 5]
  )
  const set = { color: '#112233', aplMeanLabel: '', aplUpperLabel: 'Top' }
  assert.equal(aplSeriesLabel(set, 'mean'), 'Average')
  assert.equal(aplSeriesLabel(set, 'upper'), 'Top')
  assert.equal(aplSeriesColor(set, 'upper'), '#112233')
  assert.equal(aplSeriesColor({ ...set, aplUpperColor: '#abcdef' }, 'upper'), '#abcdef')
})

test('structuralResultNeedsCsvHydration detects stripped bilayer leaflets', async () => {
  const { structuralResultNeedsCsvHydration } = await import('./analysisSets.js')
  assert.equal(
    structuralResultNeedsCsvHydration({
      analysisType: 'area_per_lipid',
      rawY: [1, 2],
      extraSeries: [
        { name: 'Upper leaflet', rawY: [] },
        { name: 'Lower leaflet', rawY: [] }
      ]
    }),
    true
  )
})

function makeCsvReader(filesByName) {
  return async (path) => {
    const name = String(path).replace(/\\/g, '/').split('/').pop()
    const text = filesByName[name]
    if (text == null) throw new Error(`missing fixture ${name}`)
    return text
  }
}

const HYDRATE_SESSION_DIR = '/tmp/gw_tests/analysis'
const HYDRATE_RMSD_CSV = `x,RMSD
0,0.10
1,0.12
2,0.11
3,0.13`
const HYDRATE_SLIM_SET = {
  id: 'set-1',
  label: 'Prod',
  csvStem: 'set1',
  structuralResults: {
    rmsd: {
      analysisType: 'rmsd',
      rawX: [],
      rawY: [],
      seriesName: 'RMSD',
      dataCsv: 'set1_rmsd.csv'
    }
  }
}

test('hydrateAnalysisSessionFromCsv restores plot arrays from csv', async () => {
  const session = await hydrateAnalysisSessionFromCsv(
    {
      version: 1,
      mode: 'structural',
      outputFolderName: '04_analysis',
      activeSetId: 'set-1',
      sets: [structuredClone(HYDRATE_SLIM_SET)]
    },
    HYDRATE_SESSION_DIR,
    makeCsvReader({ 'set1_rmsd.csv': HYDRATE_RMSD_CSV })
  )
  assert.equal(session.sets[0].structuralResults.rmsd.rawY.length, 4)
  assert.equal(session.sets[0].structuralResults.rmsd.rawY[1], 0.12)
})

test('hydrateAnalysisSetsFromCsv updates in-memory sets', async () => {
  const sets = await hydrateAnalysisSetsFromCsv(
    [structuredClone(HYDRATE_SLIM_SET)],
    HYDRATE_SESSION_DIR,
    makeCsvReader({ 'set1_rmsd.csv': HYDRATE_RMSD_CSV })
  )
  assert.equal(sets[0].structuralResults.rmsd.rawY.length, 4)
  assert.equal(sets[0].structuralResults.rmsd.rawY[1], 0.12)
})

test('legacy plot colors follow theme until the user customizes them', () => {
  const legacy = hydratePlotColorFlags({ plotBg: '#0a0a0a', textColor: '#a3a3a3' })
  assert.equal(legacy.plotBgCustomized, false)
  assert.equal(legacy.textColorCustomized, false)
  const dark = resolvePlotColors(legacy, 'dark')
  const light = resolvePlotColors(legacy, 'light')
  assert.equal(dark.plotBg, themePlotBackgroundHex('dark'))
  assert.equal(light.plotBg, themePlotBackgroundHex('light'))
  assert.equal(light.plotBg, '#ffffff')
  assert.notEqual(light.plotBg, dark.plotBg)
})

test('custom plot colors are kept across themes and saved in the session', () => {
  const custom = hydratePlotColorFlags({
    plotBg: '#112233',
    textColor: '#eeeeee',
    plotBgCustomized: true,
    textColorCustomized: true
  })
  const dark = resolvePlotColors(custom, 'dark')
  const light = resolvePlotColors(custom, 'light')
  assert.equal(dark.plotBg, '#112233')
  assert.equal(light.plotBg, '#112233')
  const session = serializeAnalysisSession({
    mode: 'structural',
    compareLayout: 'overlay',
    outputFolderName: '04_analysis',
    activeSetId: 'set-1',
    sets: [{ id: 'set-1', label: 'Prod' }],
    plotSettings: {
      structural: { rmsd: custom },
      energeticGlobal: { plotBg: '#abcdef', plotBgCustomized: true }
    }
  })
  const loaded = deserializeAnalysisSession(session)
  assert.equal(loaded.plotSettings.structural.rmsd.plotBg, '#112233')
  assert.equal(loaded.plotSettings.energeticGlobal.plotBgCustomized, true)
})

test('deserializeAnalysisSession stringifies numeric trajectory timeNs and stride', async () => {
  const { normalizeAnalysisFileRow } = await import('./analysisSets.js')
  const row = normalizeAnalysisFileRow({
    path: '/tmp/a.dcd',
    timeNs: 200,
    stride: 50
  })
  assert.equal(row.timeNs, '200')
  assert.equal(row.stride, '50')
  assert.equal(typeof row.timeNs, 'string')
  assert.equal(typeof row.stride, 'string')
  const empty = normalizeAnalysisFileRow({ path: '/tmp/b.dcd', timeNs: '', stride: '1' })
  assert.equal(empty.timeNs, '')
  assert.equal(empty.stride, '1')

  const loaded = deserializeAnalysisSession({
    version: 1,
    mode: 'structural',
    compareLayout: 'overlay',
    outputFolderName: 'analysis_01',
    activeSetId: 'set-1',
    sets: [
      {
        id: 'set-1',
        label: 'NVT',
        trajectoryFiles: [{ path: '/tmp/prod.dcd', timeNs: 200, stride: 50 }],
        structuralResults: {
          rmsd: { analysisType: 'rmsd', rawX: [0], rawY: [1], dataCsv: 'set1_rmsd.csv' }
        }
      }
    ]
  })
  assert.equal(loaded.sets[0].trajectoryFiles[0].timeNs, '200')
  assert.equal(loaded.sets[0].trajectoryFiles[0].stride, '50')
})

test('deserializeAnalysisSession stringifies numeric plot tick counts', () => {
  const loaded = deserializeAnalysisSession({
    version: 1,
    mode: 'structural',
    compareLayout: 'overlay',
    outputFolderName: 'analysis_01',
    activeSetId: 'set-1',
    sets: [{ id: 'set-1', label: 'NVT' }],
    plotSettings: {
      structural: { area_per_lipid: { xTickCount: 5, yTickCount: 4 } },
      energeticGlobal: { xTickCount: 6 }
    }
  })
  assert.equal(loaded.plotSettings.structural.area_per_lipid.xTickCount, '5')
  assert.equal(loaded.plotSettings.structural.area_per_lipid.yTickCount, '4')
  assert.equal(loaded.plotSettings.energeticGlobal.xTickCount, '6')
})

test('hydrate restores the on-disk Charmm-gui vs GateWizard session', async (t) => {
  const { access, readFile } = await import('node:fs/promises')
  const dir =
    '/mnt/c/Users/kcoru/OneDrive/Escritorio/gatewizard_dev/testing_wsl/v6_analysis_gw_cg/analysis_01'
  try {
    await access(`${dir}/analysis_session.json`)
  } catch {
    t.skip('session folder not present')
    return
  }
  const raw = JSON.parse(await readFile(`${dir}/analysis_session.json`, 'utf8'))
  let session = deserializeAnalysisSession(raw)
  session = await hydrateAnalysisSessionFromCsv(session, dir, async (path) =>
    readFile(path, 'utf8')
  )
  assert.equal(session.sets.length, 11)
  assert.equal(session.compareLayout, 'grid')
  assert.equal(session.gridLayout?.cols, 4)
  const apl = session.sets[0].structuralResults.area_per_lipid
  assert.ok(apl.rawY.length > 10)
  assert.equal(apl.extraSeries.length, 2)
  assert.ok(apl.extraSeries[0].rawY.length > 10)
  assert.equal(typeof session.sets[0].trajectoryFiles[0].timeNs, 'string')
  assert.equal(typeof session.sets[0].trajectoryFiles[0].stride, 'string')
  assert.ok(setsHaveAnyPlottableResults(session.sets))
})
