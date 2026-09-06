/**
 * Peptide polymer residue helpers (mirrors gatewizard.utils.peptide_residues).
 * Used for Analysis / Tools MDA selections where bare `protein` misses D-aa / caps.
 */

/** Extra CCD / Amber-style names beyond MDA standard L-aa. */
export const PEPTIDE_EXTRA_RESNAMES = [
  'DLE',
  'DVA',
  'DAL',
  'DAR',
  'DAS',
  'DCY',
  'DGL',
  'DGN',
  'DHI',
  'DIL',
  'DLY',
  'DPN',
  'DPR',
  'DSN',
  'DTH',
  'DTR',
  'DTY',
  'FVA',
  'FOR',
  'ETA',
  'ACE',
  'NME',
  'NMA',
  'NHE',
  'NH2'
]

/** Markers that classify a polymer as Peptide (not Protein). */
export const PEPTIDE_CLASS_MARKERS = [
  'DLE',
  'DVA',
  'DAL',
  'DAR',
  'DAS',
  'DCY',
  'DGL',
  'DGN',
  'DHI',
  'DIL',
  'DLY',
  'DPN',
  'DPR',
  'DSN',
  'DTH',
  'DTR',
  'DTY',
  'FVA',
  'FOR',
  'ETA',
  'NH2'
]

/** MDAnalysis selection covering protein + common peptide polymer residues. */
export function peptideOrProteinSelection() {
  return `protein or resname ${PEPTIDE_EXTRA_RESNAMES.join(' ')}`
}

/** Default APL/EVAPL exclude set for peptide-in-membrane systems. */
export function defaultPeptideExcludeSelection() {
  return peptideOrProteinSelection()
}

/** True for Visualize biopolymer selections (cartoon / SS). */
export function isBiopolymerSelection(sel) {
  return sel === 'protein' || sel === 'peptide'
}
