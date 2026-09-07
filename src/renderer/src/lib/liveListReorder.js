/**
 * Shared FLIP duration for live drag-reorder lists (sets / trajectories).
 * Keep in sync with `animate:flip` on those rows.
 */
export const LIST_REORDER_FLIP = { duration: 200 }

/**
 * Live-reorder a list during HTML5 drag (move when pointer crosses row midpoint).
 * @template T
 * @param {T[]} items
 * @param {number} fromIndex
 * @param {number} overIndex
 * @param {number} clientY
 * @param {Element} rowEl
 * @returns {T[] | null} new array when order changes, otherwise null
 */
export function liveReorderAtMidpoint(items, fromIndex, overIndex, clientY, rowEl) {
  if (fromIndex < 0 || overIndex < 0 || fromIndex === overIndex) return null
  if (!rowEl || typeof rowEl.getBoundingClientRect !== 'function') return null
  const rect = rowEl.getBoundingClientRect()
  const midY = rect.top + rect.height / 2
  if (fromIndex < overIndex && clientY < midY) return null
  if (fromIndex > overIndex && clientY > midY) return null
  const next = [...items]
  const [item] = next.splice(fromIndex, 1)
  next.splice(overIndex, 0, item)
  return next
}
