'use strict'

/**
 * electron-builder afterPack: Windows icon embed + Linux runtime wrapper.
 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName === 'win32') {
    return require('./after-pack-win-icon.cjs')(context)
  }
  if (context.electronPlatformName === 'linux') {
    return require('./after-pack-linux-runtime.cjs')(context)
  }
}
