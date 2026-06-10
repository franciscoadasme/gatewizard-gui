'use strict'

const fs = require('fs')
const path = require('path')
const ResEdit = require('resedit')

/**
 * Embed GateWizard icon into the Windows .exe after packaging.
 * Used with signAndEditExecutable: false to avoid winCodeSign symlink extraction
 * (which fails on Windows without Developer Mode / admin).
 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') {
    return
  }

  const exeName = `${context.packager.appInfo.productFilename}.exe`
  const exePath = path.join(context.appOutDir, exeName)
  const iconPath = path.join(context.packager.info.projectDir, 'build', 'icon.ico')

  if (!fs.existsSync(iconPath)) {
    throw new Error(`Missing ${iconPath}. Run npm run sync:icons before packaging.`)
  }
  if (!fs.existsSync(exePath)) {
    throw new Error(`Missing ${exePath}`)
  }

  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath))
  const executable = ResEdit.NtExecutable.from(fs.readFileSync(exePath))
  const resource = ResEdit.NtExecutableResource.from(executable)

  const iconGroups = ResEdit.Resource.IconGroupEntry.fromEntries(resource.entries)
  const iconGroupId = iconGroups.length > 0 ? iconGroups[0].id : 1

  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    resource.entries,
    iconGroupId,
    1033,
    iconFile.icons.map((item) => item.data)
  )

  resource.outputResource(executable)
  fs.writeFileSync(exePath, Buffer.from(executable.generate()))
  console.log(`[afterPack] Applied GateWizard icon to ${exeName}`)
}
