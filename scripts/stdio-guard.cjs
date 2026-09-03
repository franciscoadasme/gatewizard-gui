'use strict'

/**
 * WSL/WSLg often attaches Electron stdio to a socket. When that reader goes
 * away, process.stderr.write() emits EPIPE. With no listener, Electron shows
 * "A JavaScript error occurred in the main process" and each OK / window
 * place logs again — a stack of dialogs.
 */

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isBrokenPipeError(err) {
  const code = err && typeof err === 'object' && 'code' in err ? err.code : ''
  return code === 'EPIPE' || code === 'EIO' || code === 'ERR_STREAM_DESTROYED'
}

/**
 * @param {NodeJS.WriteStream | null | undefined} stream
 * @param {string} chunk
 * @returns {boolean}
 */
function writeStdioSafe(stream, chunk) {
  try {
    if (!stream || stream.destroyed || stream.writableEnded) return false
    stream.write(chunk)
    return true
  } catch (err) {
    if (isBrokenPipeError(err)) return false
    throw err
  }
}

function ignoreBrokenStdio() {
  for (const stream of [process.stdout, process.stderr]) {
    if (!stream || typeof stream.on !== 'function') continue
    stream.on('error', (err) => {
      if (isBrokenPipeError(err)) return
    })
  }
}

module.exports = {
  isBrokenPipeError,
  writeStdioSafe,
  ignoreBrokenStdio
}
