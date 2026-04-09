/** Must match `BACKEND_URL` in `src/main/index.js`. */
export const BACKEND_BASE_URL = 'http://127.0.0.1:8765'

// Add functions for the backend API here.
// Annotate the arguments and return type with the expected response shape.

/**
 * @param {string} filePath
 * @returns {Promise<{ n_atoms: number, positions: number[], elements: string[] }>}
 */
export function loadPdb(filePath) {
  return backendJson('/load-pdb', { path: filePath })
}

/**
 * @param {string} filePath
 * @param {string} selection
 * @returns {Promise<{ n_atoms: number, positions: number[], elements: string[] }>}
 */
export async function selectAtoms(filePath, selection) {
  return backendJson('/select', { path: filePath, selection })
}

// Helper functions for the backend API.

/**
 * @param {unknown} data
 * @param {Response} response
 */
function throwFromFastApiBody(data, response) {
  const detail =
    data && typeof data === 'object' && data !== null && 'detail' in data
      ? /** @type {{ detail: unknown }} */ (data).detail
      : undefined
  const msg =
    typeof detail === 'string'
      ? detail
      : Array.isArray(detail)
        ? detail
            .map((d) =>
              d && typeof d === 'object' && 'msg' in d ? String(d.msg) : JSON.stringify(d)
            )
            .join('; ')
        : detail != null
          ? JSON.stringify(detail)
          : `HTTP ${response.status}`
  throw new Error(msg)
}

/**
 * @template T
 * @param {string} path
 * @param {Record<string, unknown> | null | undefined} [payload] JSON-serialized when present and the method allows a body
 * @returns {Promise<T>}
 */
export async function backendJson(path, payload) {
  const url = `${BACKEND_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
  /** @type {RequestInit} */
  const init = { method: payload ? 'POST' : 'GET' }
  if (payload != null) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(payload)
  }

  let response
  try {
    response = await fetch(url, init)
  } catch (err) {
    console.error('[backendApi] fetch failed', { url, err })
    throw err
  }

  let data = {}
  try {
    data = await response.json()
  } catch {
    data = {}
  }
  if (!response.ok) {
    throwFromFastApiBody(data, response)
  }
  return /** @type {T} */ (data)
}
