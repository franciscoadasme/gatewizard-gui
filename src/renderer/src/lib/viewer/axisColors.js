/** Axis colors shared with TransformGizmo and hydration box UI. */
export const VIEWER_AXES = [
  { key: 'x', color: '#f05050', label: 'X' },
  { key: 'y', color: '#48c748', label: 'Y' },
  { key: 'z', color: '#5878f8', label: 'Z' }
]

/** @type {Record<string, string>} */
export const VIEWER_AXIS_COLORS = Object.fromEntries(VIEWER_AXES.map((a) => [a.key, a.color]))

/** @param {string} axis */
export function axisColor(axis) {
  return VIEWER_AXIS_COLORS[axis] ?? '#94a3b8'
}

/** Left accent stripe for axis-labeled numeric fields. */
export function axisInputStyle(color) {
  return `border-left: 3px solid ${color}; padding-left: 0.5rem;`
}

/** Tri-color stripe: padding applies equally to X, Y, and Z. */
export const PADDING_FIELD_STYLE =
  'box-shadow: inset 3px 0 0 #f05050, inset 6px 0 0 #48c748, inset 9px 0 0 #5878f8; padding-left: 0.75rem;'
