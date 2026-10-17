import { existsSync, statSync } from 'fs'
import path from 'path'

/**
 * @param {string} dir
 */
function directoryExists(dir) {
  try {
    return existsSync(dir) && statSync(dir).isDirectory()
  } catch {
    return false
  }
}

/**
 * Folder of the console that started the app.
 * npm keeps that folder in INIT_CWD when the script itself runs from the package root.
 * The Linux launcher sets GATEWIZARD_LAUNCH_CWD from the terminal pwd.
 * A desktop start, whose cwd is the executable folder, is left unset.
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   cwd?: string,
 *   execDir?: string,
 *   isDirectory?: (dir: string) => boolean
 * }} [opts]
 * @returns {string}
 */
export function resolveLaunchCwd(opts = {}) {
  const env = opts.env ?? process.env
  const cwd = opts.cwd ?? ''
  const execDir = opts.execDir ?? ''
  const isDirectory = opts.isDirectory ?? directoryExists
  /** @param {string} dir */
  const resolved = (dir) => (dir && isDirectory(dir) ? path.resolve(dir) : '')

  const explicit =
    typeof env.GATEWIZARD_LAUNCH_CWD === 'string' ? env.GATEWIZARD_LAUNCH_CWD.trim() : ''
  const fromExplicit = resolved(explicit)
  if (fromExplicit) return fromExplicit

  const init = typeof env.INIT_CWD === 'string' ? env.INIT_CWD.trim() : ''
  const fromInit = resolved(init)
  if (fromInit) return fromInit

  if (!cwd || (execDir && path.resolve(cwd) === path.resolve(execDir))) return ''
  return resolved(cwd)
}
