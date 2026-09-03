'use strict'

const fs = require('fs')
const path = require('path')
const { buildWrapperScript } = require('./linux-runtime-libs.cjs')

/**
 * Wrap the Linux Electron ELF so a missing libasound.so.2 (or other Chromium
 * .so) prints apt/dnf install commands instead of the raw loader error.
 * The dynamic linker fails before any Node/Electron JS can run.
 *
 * @param {import('electron-builder').AfterPackContext} context
 */
module.exports = async function afterPackLinuxRuntime(context) {
  const exeName = context.packager.executableName
  const exePath = path.join(context.appOutDir, exeName)
  const realName = `${exeName}.bin`
  const realPath = path.join(context.appOutDir, realName)

  if (!fs.existsSync(exePath) && fs.existsSync(realPath)) {
    fs.writeFileSync(exePath, buildWrapperScript(realName), { mode: 0o755 })
    console.log(`[afterPack] Restored Linux runtime wrapper (${exeName})`)
    return
  }

  if (!fs.existsSync(exePath)) {
    throw new Error(`[afterPack] Missing Linux executable ${exePath}`)
  }

  const fd = fs.openSync(exePath, 'r')
  const headBuf = Buffer.alloc(16)
  fs.readSync(fd, headBuf, 0, 16, 0)
  fs.closeSync(fd)
  const head = headBuf.toString('utf8')
  if (fs.existsSync(realPath) && head.startsWith('#!/bin/sh')) {
    fs.writeFileSync(exePath, buildWrapperScript(realName), { mode: 0o755 })
    console.log(`[afterPack] Refreshed Linux runtime wrapper (${exeName})`)
    return
  }

  fs.renameSync(exePath, realPath)
  fs.chmodSync(realPath, 0o755)
  fs.writeFileSync(exePath, buildWrapperScript(realName), { mode: 0o755 })
  console.log(`[afterPack] Wrapped ${exeName} → ${realName} (missing-library check)`)
}
