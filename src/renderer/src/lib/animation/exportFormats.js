/** @typedef {'mp4' | 'webm' | 'mov' | 'gif' | 'png'} AnimationExportFormat */

/** @type {{ id: AnimationExportFormat, label: string, extension: string | null, needsFfmpeg: boolean }[]} */
export const ANIMATION_EXPORT_FORMATS = [
  { id: 'mp4', label: 'MP4 (H.264)', extension: 'mp4', needsFfmpeg: true },
  { id: 'webm', label: 'WebM (VP9)', extension: 'webm', needsFfmpeg: true },
  { id: 'mov', label: 'MOV (H.264)', extension: 'mov', needsFfmpeg: true },
  { id: 'gif', label: 'GIF', extension: 'gif', needsFfmpeg: true },
  { id: 'png', label: 'PNG frames only', extension: null, needsFfmpeg: false }
]

/** @type {AnimationExportFormat} */
export const DEFAULT_ANIMATION_EXPORT_FORMAT = 'mp4'

/** @param {unknown} raw */
export function normalizeExportFormat(raw) {
  const id = typeof raw === 'string' ? raw : ''
  return ANIMATION_EXPORT_FORMATS.some((f) => f.id === id)
    ? /** @type {AnimationExportFormat} */ (id)
    : DEFAULT_ANIMATION_EXPORT_FORMAT
}

/** @param {AnimationExportFormat} format */
export function exportFormatMeta(format) {
  return (
    ANIMATION_EXPORT_FORMATS.find((f) => f.id === format) ??
    ANIMATION_EXPORT_FORMATS.find((f) => f.id === DEFAULT_ANIMATION_EXPORT_FORMAT)
  )
}

/** @param {AnimationExportFormat} format */
export function animationOutputFileName(format) {
  const meta = exportFormatMeta(format)
  if (!meta?.extension) return null
  return `animation.${meta.extension}`
}

/** Encoded video files written beside frames/ and animation.json. */
export const ENCODED_ANIMATION_FILE_NAMES = ANIMATION_EXPORT_FORMATS.filter((f) => f.extension).map(
  (f) => `animation.${f.extension}`
)
