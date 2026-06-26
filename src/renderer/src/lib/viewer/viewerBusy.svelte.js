/** Global flag while the 3D viewer is doing heavy work (glow lights, mesh rebuild, etc.). */
export const viewerBusy = $state({
  active: false,
  label: ''
})

let _depth = 0

/** @param {string} [label] */
export function beginViewerBusy(label = 'Updating view…') {
  _depth += 1
  viewerBusy.active = true
  viewerBusy.label = label
}

/** @param {string} [label] */
export function endViewerBusy(label) {
  _depth = Math.max(0, _depth - 1)
  if (_depth === 0) {
    viewerBusy.active = false
    viewerBusy.label = ''
  } else if (label && viewerBusy.label === label) {
    viewerBusy.label = 'Updating view…'
  }
}
