/**
 * Shared reactive status for each page.
 * Pages write here when actions complete; App.svelte reads for the footer.
 * Using .svelte.js so $state runes work outside components.
 */

export const preparationStatus = $state({
  /** Whether PropKa has been run in this session */
  propkaDone: false,
  /** pH that was used for the last PropKa run */
  propkaPh: /** @type {number|null} */ (null),
  /** Whether the "Detect bonds" button was clicked at least once */
  bondsChecked: false,
  /** Number of disulfide bonds found in the last detection run */
  bondsCount: 0,
  /** Whether "Prepare PDB" completed successfully */
  prepareDone: false,
  /** Path of the output protonated file, if prepare succeeded */
  outputFile: '',
})
