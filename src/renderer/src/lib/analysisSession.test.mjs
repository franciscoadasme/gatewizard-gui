import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
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
  deserializeAnalysisSession
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
  assert.equal(sets[0].structuralResults.rmsd.dataCsv, 'nvt_rmsd.csv')
  assert.equal(sets[1].structuralResults.rmsd.dataCsv, 'npt_rmsd.csv')
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
  assert.equal(sets[0].energeticResult.dataCsv, 'analysis_energetic.csv')
  assert.equal(csvFileNameForEnergeticSet({ label: 'Prod' }, 2), 'prod_energetic.csv')
})

test('normalizeEnergeticCompareLayout maps legacy grid to by_set', () => {
  assert.equal(normalizeEnergeticCompareLayout('grid'), 'by_set')
  assert.equal(normalizeEnergeticCompareLayout('by_property'), 'by_property')
  assert.equal(normalizeEnergeticCompareLayout('overlay'), 'overlay')
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
  assert.equal(session.energeticCompareLayout, 'by_property')
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

test('csvFileNameForAnalysisSet matches multi-set export naming', () => {
  assert.equal(csvFileNameForAnalysisSet({ label: 'NPAT' }, 'rmsd', 4), 'npat_rmsd.csv')
})

test('structuralResultHasPlotData detects empty slim results', () => {
  assert.equal(structuralResultHasPlotData({ rawY: [] }), false)
  assert.equal(structuralResultHasPlotData({ rawY: [1] }), true)
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

test('hydrateAnalysisSessionFromCsv restores plot arrays from csv', async () => {
  const sessionDir =
    '/mnt/c/Users/kcoru/OneDrive/Escritorio/gatewizard_dev/testing_wsl/v1_confs/analysis_openmm/04_analysis'
  const raw = JSON.parse(readFileSync(`${sessionDir}/analysis_session.json`, 'utf8'))
  const session = await hydrateAnalysisSessionFromCsv(
    raw,
    sessionDir,
    async (path) => readFileSync(path, 'utf8')
  )
  assert.equal(session.sets[0].structuralResults.rmsd.rawY.length, 475)
})

test('hydrateAnalysisSetsFromCsv updates in-memory sets', async () => {
  const sessionDir =
    '/mnt/c/Users/kcoru/OneDrive/Escritorio/gatewizard_dev/testing_wsl/v1_confs/analysis_openmm/04_analysis'
  const raw = JSON.parse(readFileSync(`${sessionDir}/analysis_session.json`, 'utf8'))
  const sets = await hydrateAnalysisSetsFromCsv(
    raw.sets,
    sessionDir,
    async (path) => readFileSync(path, 'utf8')
  )
  assert.equal(sets[0].structuralResults.rmsd.rawY.length, 475)
})
