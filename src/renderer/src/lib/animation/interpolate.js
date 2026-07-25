import { DEFAULT_EASING } from './schema.js'
import { applyEasing } from './easing.js'
import { computeOverlayOpacity } from './fade.js'
import { interpolateCameraPose } from './cameraPose.js'
import { mergeTrackOrder, sortViewsByTracks, viewsById, cloneSerializedView, viewSnapshotAtOrBeforeTime, deriveViewTracks } from './tracks.js'
import { interpolateLabelLift } from '../viewer/labelStyle.js'

/**
 * @param {import('./schema.js').AnimationCameraPose} cam
 * @returns {import('./schema.js').AnimationCameraFraming}
 */
function framingFromCamera(cam) {
  if (cam.framing) {
    return {
      center: [...cam.framing.center],
      extent: cam.framing.extent,
      framingZoom: cam.framing.framingZoom
    }
  }
  return {
    center: [...cam.target],
    extent: 50,
    framingZoom: cam.zoom ?? 1
  }
}

/**
 * @param {import('./schema.js').AnimationCameraPose} a
 * @param {import('./schema.js').AnimationCameraPose} b
 * @param {number} t
 */
function interpolateFraming(a, b, t) {
  const fa = framingFromCamera(a)
  const fb = framingFromCamera(b)
  return {
    center: [
      lerpNum(fa.center[0], fb.center[0], t),
      lerpNum(fa.center[1], fb.center[1], t),
      lerpNum(fa.center[2], fb.center[2], t)
    ],
    extent: lerpNum(fa.extent, fb.extent, t),
    framingZoom: lerpNum(fa.framingZoom, fb.framingZoom, t)
  }
}

/**
 * @param {import('./schema.js').AnimationCameraPose} a
 * @param {import('./schema.js').AnimationCameraPose} b
 * @param {number} t
 * @returns {import('./schema.js').AnimationCameraPose}
 */
function interpolateCameraState(a, b, t) {
  const pose = interpolateCameraPose(a, b, t)
  return {
    ...pose,
    framing: interpolateFraming(a, b, t)
  }
}

/**
 * @param {import('./schema.js').SerializedAtomLabel[] | undefined} labels
 * @returns {Map<string, import('./schema.js').SerializedAtomLabel>}
 */
function labelsById(labels) {
  return new Map((labels ?? []).map((l) => [l.id, l]))
}

/**
 * @param {import('./schema.js').SerializedMeasurement[] | undefined} measurements
 * @returns {Map<string, import('./schema.js').SerializedMeasurement>}
 */
function measurementsById(measurements) {
  return new Map((measurements ?? []).map((m) => [m.id, m]))
}

/**
 * @param {import('./schema.js').SerializedAtomLabel} a
 * @param {import('./schema.js').SerializedAtomLabel} b
 * @param {number} t
 */
function interpolateAtomLabel(a, b, t) {
  let color = a.color ?? b.color ?? '#ffffff'
  if (a.color?.startsWith('#') && b.color?.startsWith('#')) {
    color = lerpHex(a.color, b.color, t)
  } else if (t >= 0.5) {
    color = b.color ?? a.color ?? '#ffffff'
  }
  let background = a.background ?? b.background ?? '#000000'
  if (a.background?.startsWith('#') && b.background?.startsWith('#')) {
    background = lerpHex(a.background, b.background, t)
  } else if (t >= 0.5) {
    background = b.background ?? a.background ?? '#000000'
  }
  const pick = t < 0.5

  // Smooth label motion: lerp the lift vector in screen space so changing
  // direction (e.g. up → right) slides around the atom instead of snapping.
  const lift = interpolateLabelLift(a, b, t)

  return {
    id: a.id,
    atomIndex: pick ? a.atomIndex : b.atomIndex,
    text: pick ? a.text : b.text,
    size: lerpNum(a.size ?? 12, b.size ?? 12, t),
    color,
    background,
    backgroundOpacity: lerpNum(a.backgroundOpacity ?? 0.75, b.backgroundOpacity ?? 0.75, t),
    padding: lerpNum(a.padding ?? 6, b.padding ?? 6, t),
    radius: lerpNum(a.radius ?? 4, b.radius ?? 4, t),
    offsetY: lift.offsetY,
    liftDir: lift.liftDir,
    screenDX: lift.screenDX,
    screenDY: lift.screenDY,
    visible: pick ? a.visible !== false : b.visible !== false,
    fadeEnabled: pick ? a.fadeEnabled !== false : b.fadeEnabled !== false,
    fadeIn_s: t >= 0.5 ? (b.fadeIn_s ?? a.fadeIn_s) : (a.fadeIn_s ?? b.fadeIn_s),
    fadeOut_s: t >= 0.5 ? (b.fadeOut_s ?? a.fadeOut_s) : (a.fadeOut_s ?? b.fadeOut_s),
    fadeInEasing: t >= 0.5 ? (b.fadeInEasing ?? a.fadeInEasing) : (a.fadeInEasing ?? b.fadeInEasing),
    fadeOutEasing: t >= 0.5 ? (b.fadeOutEasing ?? a.fadeOutEasing) : (a.fadeOutEasing ?? b.fadeOutEasing),
    fadeInBezier: t >= 0.5 ? (b.fadeInBezier ?? a.fadeInBezier) : (a.fadeInBezier ?? b.fadeInBezier),
    fadeOutBezier: t >= 0.5 ? (b.fadeOutBezier ?? a.fadeOutBezier) : (a.fadeOutBezier ?? b.fadeOutBezier)
  }
}

/**
 * @param {import('./schema.js').SerializedMeasurement} a
 * @param {import('./schema.js').SerializedMeasurement} b
 * @param {number} t
 */
function interpolateMeasurement(a, b, t) {
  let color = a.color ?? b.color ?? '#facc15'
  if (a.color?.startsWith('#') && b.color?.startsWith('#')) {
    color = lerpHex(a.color, b.color, t)
  } else if (t >= 0.5) {
    color = b.color ?? a.color ?? '#facc15'
  }
  const atomIndices = t < 0.5 ? [...a.atomIndices] : [...b.atomIndices]
  return {
    id: a.id,
    type: t < 0.5 ? a.type : b.type,
    atomIndices,
    color,
    size: lerpNum(a.size ?? 15, b.size ?? 15, t),
    lineWidth: lerpNum(a.lineWidth ?? 3, b.lineWidth ?? 3, t),
    visible: t < 0.5 ? a.visible !== false : b.visible !== false,
    fadeEnabled: t < 0.5 ? a.fadeEnabled !== false : b.fadeEnabled !== false,
    fadeIn_s: t >= 0.5 ? (b.fadeIn_s ?? a.fadeIn_s) : (a.fadeIn_s ?? b.fadeIn_s),
    fadeOut_s: t >= 0.5 ? (b.fadeOut_s ?? a.fadeOut_s) : (a.fadeOut_s ?? b.fadeOut_s),
    fadeInEasing: t >= 0.5 ? (b.fadeInEasing ?? a.fadeInEasing) : (a.fadeInEasing ?? b.fadeInEasing),
    fadeOutEasing: t >= 0.5 ? (b.fadeOutEasing ?? a.fadeOutEasing) : (a.fadeOutEasing ?? b.fadeOutEasing),
    fadeInBezier: t >= 0.5 ? (b.fadeInBezier ?? a.fadeInBezier) : (a.fadeInBezier ?? b.fadeInBezier),
    fadeOutBezier: t >= 0.5 ? (b.fadeOutBezier ?? a.fadeOutBezier) : (a.fadeOutBezier ?? b.fadeOutBezier)
  }
}

/**
 * @param {import('./schema.js').SerializedAtomLabel[] | undefined} a
 * @param {import('./schema.js').SerializedAtomLabel[] | undefined} b
 * @param {number} localT
 * @param {number} rawT
 * @param {number} segmentDuration
 */
function interpolateLabels(a, b, localT, rawT, segmentDuration) {
  const fromMap = labelsById(a)
  const toMap = labelsById(b)
  const out = []
  for (const id of new Set([...fromMap.keys(), ...toMap.keys()])) {
    const fa = fromMap.get(id)
    const fb = toMap.get(id)
    const opacity = computeOverlayOpacity(fa, fb, rawT, segmentDuration)
    if (opacity <= 0.001) continue

    let item
    if (fa && fb) {
      item = interpolateAtomLabel(fa, fb, localT)
    } else if (fa) {
      item = { ...fa }
    } else if (fb) {
      item = { ...fb }
    } else {
      continue
    }
    out.push({ ...item, opacity, visible: true })
  }
  return out
}

/**
 * @param {import('./schema.js').SerializedMeasurement[] | undefined} a
 * @param {import('./schema.js').SerializedMeasurement[] | undefined} b
 * @param {number} localT
 * @param {number} rawT
 * @param {number} segmentDuration
 */
function interpolateMeasurements(a, b, localT, rawT, segmentDuration) {
  const fromMap = measurementsById(a)
  const toMap = measurementsById(b)
  const out = []
  for (const id of new Set([...fromMap.keys(), ...toMap.keys()])) {
    const fa = fromMap.get(id)
    const fb = toMap.get(id)
    const opacity = computeOverlayOpacity(fa, fb, rawT, segmentDuration)
    if (opacity <= 0.001) continue

    let item
    if (fa && fb) {
      item = interpolateMeasurement(fa, fb, localT)
    } else if (fa) {
      item = { ...fa, atomIndices: [...fa.atomIndices] }
    } else if (fb) {
      item = { ...fb, atomIndices: [...fb.atomIndices] }
    } else {
      continue
    }
    out.push({ ...item, opacity, visible: true })
  }
  return out
}

/**
 * @param {import('./schema.js').AnimationViewport | undefined} a
 * @param {import('./schema.js').AnimationViewport | undefined} b
 * @param {number} t
 */
function interpolateViewport(a, b, t) {
  const va = a ?? {}
  const vb = b ?? {}
  return {
    axesVisible: t < 0.5 ? va.axesVisible !== false : vb.axesVisible !== false,
    axesLinesVisible: t < 0.5 ? va.axesLinesVisible === true : vb.axesLinesVisible === true
  }
}

/**
 * @param {number} t
 * @param {import('./schema.js').AnimationEasingKind} easing
 * @param {[number, number, number, number] | undefined} [easingBezier]
 */
export function applySegmentEasing(t, easing = DEFAULT_EASING, easingBezier) {
  return applyEasing(t, easing, easingBezier)
}

/**
 * @param {number} t
 * @param {import('./schema.js').AnimationEasingKind} easing
 */
export function applyEasingLegacy(t, easing = DEFAULT_EASING) {
  return applySegmentEasing(t, easing)
}

/**
 * @param {number} a
 * @param {number} b
 * @param {number} t
 */
function lerpNum(a, b, t) {
  return a + (b - a) * t
}

/**
 * @param {string | undefined} hexA
 * @param {string | undefined} hexB
 * @param {number} t
 */
function lerpHex(hexA, hexB, t) {
  if (!hexA) return hexB
  if (!hexB) return hexA
  const parse = (h) => {
    const s = h.replace('#', '')
    const full =
      s.length === 3
        ? s
            .split('')
            .map((c) => c + c)
            .join('')
        : s.padStart(6, '0').slice(0, 6)
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16)
    ]
  }
  const [r1, g1, b1] = parse(hexA)
  const [r2, g2, b2] = parse(hexB)
  const r = Math.round(lerpNum(r1, r2, t))
  const g = Math.round(lerpNum(g1, g2, t))
  const b = Math.round(lerpNum(b1, b2, t))
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

/**
 * @param {Record<string, string> | null | undefined} a
 * @param {Record<string, string> | null | undefined} b
 * @param {number} t
 */
function interpolateSsColors(a, b, t) {
  if (!a && !b) return null
  if (!a) return b ? { ...b } : null
  if (!b) return { ...a }
  const out = /** @type {Record<string, string>} */ ({})
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const ca = a[key]
    const cb = b[key]
    if (ca?.startsWith('#') && cb?.startsWith('#')) out[key] = lerpHex(ca, cb, t)
    else out[key] = t < 0.5 ? (ca ?? cb) : (cb ?? ca)
  }
  return out
}

/**
 * @param {{ name: string, color?: string }} a
 * @param {{ name: string, color?: string }} b
 * @param {number} t
 */
function interpolateColorScheme(a, b, t) {
  const name = a.name === b.name ? a.name : t < 0.5 ? a.name : b.name
  let color = a.color ?? b.color
  if (a.color?.startsWith('#') && b.color?.startsWith('#')) {
    color = lerpHex(a.color, b.color, t)
  } else if (t >= 0.5) {
    color = b.color ?? a.color
  }
  return { name, ...(color ? { color } : {}) }
}

/**
 * @param {Record<string, unknown>} a
 * @param {Record<string, unknown>} b
 * @param {number} t
 */
function interpolateMaterial(a, b, t) {
  const out = { ...(t < 0.5 ? a : b) }
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const va = a[key]
    const vb = b[key]
    if (typeof va === 'number' && typeof vb === 'number') {
      out[key] = lerpNum(va, vb, t)
    } else if (typeof va === 'boolean' && typeof vb === 'boolean') {
      out[key] = t < 0.5 ? va : vb
    } else if (typeof va === 'string' && typeof vb === 'string') {
      if (
        (key === 'outlineColor' || key.endsWith('Color') || key.endsWith('Hex')) &&
        va.startsWith('#') &&
        vb.startsWith('#')
      ) {
        out[key] = lerpHex(va, vb, t)
      } else {
        out[key] = t < 0.5 ? va : vb
      }
    } else if (t >= 0.5 && vb !== undefined) {
      out[key] = vb
    } else if (va !== undefined) {
      out[key] = va
    }
  }
  if (a.preset !== b.preset) {
    out.preset = t < 0.5 ? a.preset : b.preset
  }
  return out
}

/**
 * @param {import('./schema.js').AnimationKeyframe[]} keyframes
 * @param {number} time_s
 */
export function findKeyframeSegment(keyframes, time_s) {
  if (!keyframes.length) return null
  if (keyframes.length === 1) {
    return { from: keyframes[0], to: keyframes[0], localT: 0, rawT: 0, segmentDuration: 0 }
  }
  let from = keyframes[0]
  for (let i = 1; i < keyframes.length; i++) {
    const to = keyframes[i]
    if (time_s <= to.time_s) {
      const segmentDuration = Math.max(0.001, to.time_s - from.time_s)
      const rawT = (time_s - from.time_s) / segmentDuration
      const localT = applySegmentEasing(rawT, to.easing ?? DEFAULT_EASING, to.easingBezier)
      return { from, to, localT, rawT, segmentDuration }
    }
    from = to
  }
  const last = keyframes[keyframes.length - 1]
  return { from: last, to: last, localT: 0, rawT: 0, segmentDuration: 0 }
}

/**
 * @param {import('./schema.js').SerializedView} a
 * @param {import('./schema.js').SerializedView} b
 * @param {number} t
 */
function interpolateViewFade(a, b, t) {
  return {
    fadeEnabled: t < 0.5 ? a.fadeEnabled !== false : b.fadeEnabled !== false,
    fadeIn_s: t >= 0.5 ? (b.fadeIn_s ?? a.fadeIn_s) : (a.fadeIn_s ?? b.fadeIn_s),
    fadeOut_s: t >= 0.5 ? (b.fadeOut_s ?? a.fadeOut_s) : (a.fadeOut_s ?? b.fadeOut_s),
    fadeInEasing: t >= 0.5 ? (b.fadeInEasing ?? a.fadeInEasing) : (a.fadeInEasing ?? b.fadeInEasing),
    fadeOutEasing: t >= 0.5 ? (b.fadeOutEasing ?? a.fadeOutEasing) : (a.fadeOutEasing ?? b.fadeOutEasing),
    fadeInBezier: t >= 0.5 ? (b.fadeInBezier ?? a.fadeInBezier) : (a.fadeInBezier ?? b.fadeInBezier),
    fadeOutBezier: t >= 0.5 ? (b.fadeOutBezier ?? a.fadeOutBezier) : (a.fadeOutBezier ?? b.fadeOutBezier)
  }
}

/**
 * @param {import('./schema.js').SerializedView} a
 * @param {import('./schema.js').SerializedView} b
 * @param {number} t
 */
function interpolateView(a, b, t) {
  const reprType = t < 0.5 ? a.representation.type : b.representation.type
  const colorScheme = interpolateColorScheme(a.colorScheme, b.colorScheme, t)
  const ssColors = interpolateSsColors(a.ssColors, b.ssColors, t)
  const material = interpolateMaterial(
    /** @type {Record<string, unknown>} */ (a.material),
    /** @type {Record<string, unknown>} */ (b.material),
    t
  )

  return {
    ...a,
    id: a.id,
    selection: t < 0.5 ? a.selection : b.selection,
    baseSelection: t < 0.5 ? a.baseSelection : b.baseSelection,
    representation: { type: reprType },
    visible: t < 0.5 ? a.visible : b.visible,
    colorScheme,
    ssColors,
    material,
    helixWidth: lerpNum(a.helixWidth ?? 1, b.helixWidth ?? 1, t),
    sheetWidth: lerpNum(a.sheetWidth ?? 0.875, b.sheetWidth ?? 0.875, t),
    coilWidth: lerpNum(a.coilWidth ?? 0.125, b.coilWidth ?? 0.125, t),
    tubeRadius: lerpNum(a.tubeRadius ?? 0.9, b.tubeRadius ?? 0.9, t),
    atomScale: lerpNum(a.atomScale ?? 1, b.atomScale ?? 1, t),
    bondScale: lerpNum(a.bondScale ?? 1, b.bondScale ?? 1, t),
    pointSize: lerpNum(a.pointSize ?? 3, b.pointSize ?? 3, t),
    quality: Math.round(lerpNum(a.quality ?? 3, b.quality ?? 3, t)),
    ...interpolateViewFade(a, b, t)
  }
}

/**
 * @param {import('./schema.js').AnimationKeyframe[]} keyframes
 * @param {number} time_s
 * @param {import('./schema.js').AnimationKeyframe} from
 * @param {import('./schema.js').AnimationKeyframe} to
 * @param {number} localT
 * @param {number} rawT
 * @param {number} segmentDuration
 * @param {string[]} viewTracks
 */
function interpolateViews(keyframes, time_s, from, to, localT, rawT, segmentDuration, viewTracks) {
  const fromMap = viewsById(from.views)
  const toMap = viewsById(to.views)
  const orderedIds = mergeTrackOrder(viewTracks, [
    ...from.views,
    ...to.views,
    ...deriveViewTracks(keyframes).map((id) => ({ id }))
  ])
  const out = []
  for (const id of orderedIds) {
    const fa = fromMap.get(id)
    const fb = toMap.get(id)
    if (!fa && !fb) continue

    const opacity = computeOverlayOpacity(fa, fb, rawT, segmentDuration)
    const stepped = viewSnapshotAtOrBeforeTime(keyframes, id, time_s)
    /** @type {import('./schema.js').SerializedView} */
    let base
    if (stepped) {
      base = cloneSerializedView(stepped)
    } else if (fb) {
      base = cloneSerializedView(fb)
    } else if (fa) {
      base = cloneSerializedView(fa)
    } else {
      continue
    }

    const fade = interpolateViewFade(
      fa ?? stepped ?? base,
      fb ?? stepped ?? base,
      localT
    )
    out.push({
      ...base,
      ...fade,
      opacity,
      visible: opacity > 0.001
    })
  }
  return sortViewsByTracks(out, orderedIds)
}

function isColorSceneKey(key) {
  const k = key.toLowerCase()
  return k.includes('hex') || k.includes('sky') || k.includes('ground')
}

/**
 * @param {Record<string, unknown>} a
 * @param {Record<string, unknown>} b
 * @param {number} t
 */
function interpolateScene(a, b, t) {
  const out = { ...a }
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const va = a[key]
    const vb = b[key]
    if (typeof va === 'number' && typeof vb === 'number') {
      out[key] = lerpNum(va, vb, t)
    } else if (typeof va === 'string' && typeof vb === 'string' && isColorSceneKey(key)) {
      if (va.startsWith('#') && vb.startsWith('#')) out[key] = lerpHex(va, vb, t)
      else out[key] = t < 0.5 ? va : vb
    } else if (key === 'backgroundMode' && typeof va === 'string' && typeof vb === 'string') {
      out[key] = t < 0.5 ? va : vb
    } else if (key === 'directionalLights' && Array.isArray(va) && Array.isArray(vb)) {
      out[key] = vb.map((light, i) => {
        const la = /** @type {Record<string, unknown>} */ (va[i] ?? light)
        const lb = /** @type {Record<string, unknown>} */ (light)
        const posA = /** @type {number[]} */ (la.position ?? [0, 0, 0])
        const posB = /** @type {number[]} */ (lb.position ?? [0, 0, 0])
        return {
          enabled: t < 0.5 ? la.enabled !== false : lb.enabled !== false,
          position: posA.map((v, j) => lerpNum(v, posB[j] ?? v, t)),
          intensity: lerpNum(
            typeof la.intensity === 'number' ? la.intensity : 0.4,
            typeof lb.intensity === 'number' ? lb.intensity : 0.4,
            t
          )
        }
      })
    } else if (t >= 0.5) {
      out[key] = vb
    }
  }
  return out
}

/**
 * @param {import('./schema.js').AnimationKeyframe[]} keyframes
 * @param {number} time_s
 * @param {string[]} [viewTracks]
 */
export function interpolateAtTime(keyframes, time_s, viewTracks = []) {
  const seg = findKeyframeSegment(keyframes, time_s)
  if (!seg) return null
  const { from, to, localT, rawT, segmentDuration } = seg

  const views = interpolateViews(
    keyframes,
    time_s,
    from,
    to,
    localT,
    rawT,
    segmentDuration,
    viewTracks
  )

  const sceneFrom = from.scene ?? {}
  const sceneTo = to.scene ?? {}
  const scene =
    Object.keys(sceneFrom).length || Object.keys(sceneTo).length
      ? interpolateScene(sceneFrom, sceneTo, localT)
      : sceneFrom

  return {
    camera: interpolateCameraState(from.camera, to.camera, localT),
    views,
    scene,
    viewport: interpolateViewport(from.viewport, to.viewport, localT),
    labels: interpolateLabels(from.labels, to.labels, localT, rawT, segmentDuration),
    measurements: interpolateMeasurements(
      from.measurements,
      to.measurements,
      localT,
      rawT,
      segmentDuration
    )
  }
}
