/**
 * conda-meta records are `{name}-{version}-{build}.json`.
 * AmberTools 26.0 is `ambertools-26.0-<build>.json`, not `ambertools-26-<build>.json`.
 * @param {string} filename
 * @param {string} packageName
 * @param {string} versionPrefix
 */
export function condaMetaNameMatches(filename, packageName, versionPrefix) {
  if (!filename.endsWith('.json')) return false
  const base = filename.slice(0, -'.json'.length)
  const head = `${packageName}-`
  if (!base.startsWith(head)) return false
  const rest = base.slice(head.length)
  return (
    rest === versionPrefix ||
    rest.startsWith(`${versionPrefix}.`) ||
    rest.startsWith(`${versionPrefix}-`)
  )
}
