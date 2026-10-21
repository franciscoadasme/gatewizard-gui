import { DEFAULT_EASING } from './schema.js'
import { applyEasing } from './easing.js'
import { channelClock } from './channelClock.js'
import { coordPatchForStructure } from './schema.js'
import { computeOverlayOpacity } from './fade.js'
import { interpolateCameraPose } from './cameraPoseMath.js'
import { mergeTrackOrder, sortViewsByTracks, viewsById, cloneSerializedView, viewSnapshotAtOrBeforeTime, deriveViewTracks } from './tracks.js'
import { interpolateLabelLift } from '../viewer/labelStyle.js'
import { lerpPatches } from '../viewer/workingCoords.js'
import { interpolateTrajFrame } from './trajFrame.js'
import { normalizeClip } from '../viewer/viewClip.js'
import { buildMaterialFromPreset, GOODSELL_MATERIAL_DEFAULTS, GLOWING_MATERIAL_DEFAULTS } from '../colorSchemes.js'

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
  let background = a.background ?? b.background ?? '#000000'
  if (a.background?.startsWith('#') && b.background?.startsWith('#')) {
    background = lerpHex(a.background, b.background, t)
  } else if (t >= 0.5) {
    background = b.background ?? a.background ?? '#000000'
  }
  const atomIndices = t < 0.5 ? [...a.atomIndices] : [...b.atomIndices]
  const pick = t < 0.5
  // Measurements default lift to 0 (centroid); labels use 22 via labelOffsetY fallback.
  const lift = interpolateLabelLift(
    { offsetY: typeof a.offsetY === 'number' ? a.offsetY : 0, liftDir: a.liftDir },
    { offsetY: typeof b.offsetY === 'number' ? b.offsetY : 0, liftDir: b.liftDir },
    t
  )
  return {
    id: a.id,
    type: pick ? a.type : b.type,
    atomIndices,
    color,
    background,
    size: lerpNum(a.size ?? 15, b.size ?? 15, t),
    lineWidth: lerpNum(a.lineWidth ?? 3, b.lineWidth ?? 3, t),
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
 * @param {unknown} value
 * @returns {string | null} normalized #rrggbb or null
 */
function asHexColor(value) {
  if (typeof value !== 'string') return null
  const s = value.trim()
  if (!s) return null
  const withHash = s.startsWith('#') ? s : `#${s}`
  if (/^#[0-9a-fA-F]{3}$/.test(withHash) || /^#[0-9a-fA-F]{6}$/.test(withHash)) {
    return withHash
  }
  return null
}

/**
 * @param {unknown} a
 * @param {unknown} b
 * @param {number} t
 */
function lerpColorValue(a, b, t) {
  const ha = asHexColor(a)
  const hb = asHexColor(b)
  if (ha && hb) return lerpHex(ha, hb, t)
  if (t < 0.5) return ha ?? hb ?? (typeof a === 'string' ? a : typeof b === 'string' ? b : undefined)
  return hb ?? ha ?? (typeof b === 'string' ? b : typeof a === 'string' ? a : undefined)
}

/**
 * @param {{ name?: string, color?: string } | null | undefined} a
 * @param {{ name?: string, color?: string } | null | undefined} b
 * @param {number} t
 */
function interpolateColorScheme(a, b, t) {
  const ca = a && typeof a === 'object' ? a : {}
  const cb = b && typeof b === 'object' ? b : {}
  const name =
    ca.name === cb.name
      ? (ca.name ?? cb.name ?? 'cpk')
      : t < 0.5
        ? (ca.name ?? cb.name ?? 'cpk')
        : (cb.name ?? ca.name ?? 'cpk')
  const color = lerpColorValue(ca.color, cb.color, t)
  return { name, ...(color ? { color } : {}) }
}

/**
 * True when a material string field should be hex-lerped.
 * @param {string} key
 * @param {string} va
 * @param {string} vb
 */
function isLerpableMaterialColorKey(key, va, vb) {
  if (!asHexColor(va) || !asHexColor(vb)) return false
  return (
    key === 'color' ||
    key === 'outlineColor' ||
    key.endsWith('Color') ||
    key.endsWith('Hex') ||
    key.endsWith('colour')
  )
}

/**
 * @param {string | undefined} preset
 */
function shaderFamily(preset) {
  if (preset === 'Goodsell') return 'goodsell'
  if (preset === 'Glowing') return 'glowing'
  return 'standard'
}

/**
 * Fill omitted slider fields from the material preset so a Default key can
 * ease into Goodsell/Glowing numbers.
 * @param {Record<string, unknown>} material
 */
function materialWithDefaults(material) {
  const preset = typeof material.preset === 'string' ? material.preset : 'Default'
  const family = shaderFamily(preset)
  const built = buildMaterialFromPreset(preset)
  return {
    outlineWidth: family === 'goodsell' ? GOODSELL_MATERIAL_DEFAULTS.outlineWidth : 0,
    glowLightIntensity: family === 'glowing' ? GLOWING_MATERIAL_DEFAULTS.glowLightIntensity : 0,
    glowLightDistance: built.glowLightDistance ?? GLOWING_MATERIAL_DEFAULTS.glowLightDistance,
    glowLightDecay: built.glowLightDecay ?? GLOWING_MATERIAL_DEFAULTS.glowLightDecay,
    ...built,
    ...material,
    preset
  }
}

const MATERIAL_NUMERIC_KEYS = [
  'metalness',
  'roughness',
  'emissiveIntensity',
  'outlineWidth',
  'glowLightIntensity',
  'glowLightDistance',
  'glowLightDecay',
  'glowMaxLights'
]

/**
 * @param {Record<string, unknown> | null | undefined} a
 * @param {Record<string, unknown> | null | undefined} b
 * @param {number} t
 */
function interpolateMaterial(a, b, t) {
  const ma = materialWithDefaults(a && typeof a === 'object' ? a : {})
  const mb = materialWithDefaults(b && typeof b === 'object' ? b : {})
  const familyA = shaderFamily(/** @type {string} */ (ma.preset))
  const familyB = shaderFamily(/** @type {string} */ (mb.preset))
  // Goodsell / Glowing shaders stay on the source until the destination key.
  const preset =
    familyA !== familyB
      ? t >= 0.999
        ? mb.preset
        : ma.preset
      : t < 0.5
        ? ma.preset
        : mb.preset
  const out = { ...(t < 0.5 ? ma : mb), preset }
  for (const key of MATERIAL_NUMERIC_KEYS) {
    const va = ma[key]
    const vb = mb[key]
    if (typeof va === 'number' && typeof vb === 'number') out[key] = lerpNum(va, vb, t)
  }
  for (const key of new Set([...Object.keys(ma), ...Object.keys(mb)])) {
    if (MATERIAL_NUMERIC_KEYS.includes(key) || key === 'preset') continue
    const va = ma[key]
    const vb = mb[key]
    if (typeof va === 'boolean' && typeof vb === 'boolean') {
      out[key] = t < 0.5 ? va : vb
    } else if (typeof va === 'string' && typeof vb === 'string') {
      if (isLerpableMaterialColorKey(key, va, vb)) out[key] = lerpColorValue(va, vb, t)
      else out[key] = t < 0.5 ? va : vb
    } else if (t >= 0.5 && vb !== undefined) {
      out[key] = vb
    } else if (va !== undefined) {
      out[key] = va
    }
  }
  return out
}

/**
 * @param {{ name?: string } | null | undefined} scheme
 */
function schemeLabel(scheme) {
  const name = scheme?.name ?? 'cpk'
  return name === 'default' ? 'cpk' : name
}

/**
 * @param {import('./schema.js').AnimationKeyframe[]} keyframes
 * @param {number} time_s
 */
export function findKeyframeSegment(keyframes, time_s) {
  if (!keyframes.length) return null
  if (keyframes.length === 1) {
    return { from: keyframes[0], to: keyframes[0], localT: 0, cameraT: 0, motionT: 0, rawT: 0, segmentDuration: 0 }
  }
  let from = keyframes[0]
  for (let i = 1; i < keyframes.length; i++) {
    const to = keyframes[i]
    if (time_s <= to.time_s) {
      const segmentDuration = Math.max(0.001, to.time_s - from.time_s)
      const rawT = (time_s - from.time_s) / segmentDuration
      const { cameraT, motionT } = channelClock(rawT, to)
      return { from, to, localT: cameraT, cameraT, motionT, rawT, segmentDuration }
    }
    from = to
  }
  const last = keyframes[keyframes.length - 1]
  return { from: last, to: last, localT: 0, cameraT: 0, motionT: 0, rawT: 0, segmentDuration: 0 }
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
 * @param {import('./schema.js').SerializedView['clip']} ca
 * @param {import('./schema.js').SerializedView['clip']} cb
 * @param {number} t
 */
function interpolateClip(ca, cb, t) {
  const a = normalizeClip(ca)
  const b = normalizeClip(cb)
  const near = lerpNum(a.near, b.near, t)
  let far = lerpNum(a.far, b.far, t)
  if (far < near + 0.01) far = near + 0.01
  return normalizeClip({
    enabled: t < 0.5 ? a.enabled : b.enabled,
    mode: t < 0.5 ? a.mode : b.mode,
    axis: t < 0.5 ? a.axis : b.axis,
    near,
    far
  })
}

/**
 * @param {import('./schema.js').SerializedView} a
 * @param {import('./schema.js').SerializedView} b
 * @param {number} t
 */
export function interpolateView(a, b, t) {
  const fromType = a.representation?.type ?? 'points'
  const toType = b.representation?.type ?? fromType
  const typesDiffer = fromType !== toType
  const reprType = typesDiffer ? (t >= 0.999 ? toType : fromType) : t < 0.5 ? fromType : toType
  const namesDiffer = schemeLabel(a.colorScheme) !== schemeLabel(b.colorScheme)
  const colorScheme = namesDiffer
    ? {
        name: schemeLabel(t < 0.5 ? a.colorScheme : b.colorScheme),
        ...((t < 0.5 ? a.colorScheme?.color : b.colorScheme?.color)
          ? { color: t < 0.5 ? a.colorScheme?.color : b.colorScheme?.color }
          : {})
      }
    : interpolateColorScheme(a.colorScheme, b.colorScheme, t)
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
    ...(typesDiffer ? { reprBlend: { fromType, toType, t } } : {}),
    ...(namesDiffer
      ? {
          colorBlend: {
            from: a.colorScheme ?? { name: 'cpk' },
            to: b.colorScheme ?? { name: 'cpk' },
            fromSs: a.ssColors ?? null,
            toSs: b.ssColors ?? null,
            t
          }
        }
      : {}),
    visible: t < 0.5 ? a.visible : b.visible,
    colorScheme,
    ssColors,
    material,
    bondColorMode: t < 0.5 ? (a.bondColorMode ?? 'uniform') : (b.bondColorMode ?? a.bondColorMode ?? 'uniform'),
    bondColor: lerpColorValue(a.bondColor ?? '#b8b8bc', b.bondColor ?? '#b8b8bc', t) ?? '#b8b8bc',
    helixWidth: lerpNum(a.helixWidth ?? 1, b.helixWidth ?? 1, t),
    sheetWidth: lerpNum(a.sheetWidth ?? 0.875, b.sheetWidth ?? 0.875, t),
    coilWidth: lerpNum(a.coilWidth ?? 0.125, b.coilWidth ?? 0.125, t),
    tubeRadius: lerpNum(a.tubeRadius ?? 0.9, b.tubeRadius ?? 0.9, t),
    atomScale: lerpNum(a.atomScale ?? 1, b.atomScale ?? 1, t),
    bondScale: lerpNum(a.bondScale ?? 1, b.bondScale ?? 1, t),
    stickRoundness: lerpNum(a.stickRoundness ?? 1, b.stickRoundness ?? 1, t),
    meshSegments: Math.round(lerpNum(a.meshSegments ?? 48, b.meshSegments ?? 48, t)),
    pointSize: lerpNum(a.pointSize ?? 3, b.pointSize ?? 3, t),
    quality: Math.round(lerpNum(a.quality ?? 3, b.quality ?? 3, t)),
    surfaceInflate: lerpNum(a.surfaceInflate ?? 0.25, b.surfaceInflate ?? 0.25, t),
    surfaceSource: (t < 0.5 ? a.surfaceSource : b.surfaceSource) === 'backbone' ? 'backbone' : 'atoms',
    surfaceSubdivision: Math.max(
      0,
      Math.min(8, lerpNum(a.surfaceSubdivision ?? 0, b.surfaceSubdivision ?? 0, t))
    ),
    trajSmooth: Math.max(
      0,
      Math.min(8, lerpNum(a.trajSmooth ?? 0, b.trajSmooth ?? 0, t))
    ),
    trajSmoothRestoreH: (t < 0.5 ? a.trajSmoothRestoreH : b.trajSmoothRestoreH) !== false,
    selectionEachFrame: (t < 0.5 ? a.selectionEachFrame : b.selectionEachFrame) === true,
    opacity: lerpNum(
      typeof a.opacity === 'number' ? a.opacity : 1,
      typeof b.opacity === 'number' ? b.opacity : 1,
      t
    ),
    clip: interpolateClip(a.clip, b.clip, t),
    ...interpolateViewFade(a, b, t)
  }
}

/**
 * One layer, or two opacity-weighted copies when representation type changes.
 * @param {{ representation?: { type?: string }, opacity?: number, reprBlend?: { fromType: string, toType: string, t: number } }} view
 * @returns {{ key: string, type: string, opacity: number }[]}
 */
export function representationDrawLayers(view) {
  const base = typeof view?.opacity === 'number' ? view.opacity : 1
  const blend = view?.reprBlend
  const singleType = view?.representation?.type ?? 'points'
  if (!blend || blend.fromType === blend.toType || blend.t <= 0.001 || blend.t >= 0.999) {
    return [{ key: 'single', type: blend && blend.t >= 0.999 ? blend.toType : singleType, opacity: base }]
  }
  return [
    { key: 'from', type: blend.fromType, opacity: base * (1 - blend.t) },
    { key: 'to', type: blend.toType, opacity: base * blend.t }
  ].filter((layer) => layer.opacity > 0.001)
}

/**
 * @param {import('./schema.js').AnimationKeyframe[]} keyframes
 * @param {number} time_s
 * @param {import('./schema.js').AnimationKeyframe} from
 * @param {import('./schema.js').AnimationKeyframe} to
 * @param {number} localT
 * @param {number} motionT
 * @param {number} rawT
 * @param {number} segmentDuration
 * @param {string[]} viewTracks
 */
function interpolateViews(keyframes, time_s, from, to, localT, motionT, rawT, segmentDuration, viewTracks) {
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

    const fadeFactor = computeOverlayOpacity(fa, fb, rawT, segmentDuration)
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
    const baseOpacity = typeof base.opacity === 'number' ? base.opacity : 1
    const opacity = Math.max(0, Math.min(1, baseOpacity * fadeFactor))
    const trajSmooth = Math.max(
      0,
      Math.min(
        8,
        lerpNum(fa?.trajSmooth ?? base.trajSmooth ?? 0, fb?.trajSmooth ?? fa?.trajSmooth ?? 0, motionT)
      )
    )
    const restoreSrc = localT < 0.5 ? (fa ?? stepped ?? base) : (fb ?? fa ?? stepped ?? base)
    out.push({
      ...base,
      ...fade,
      trajSmooth,
      trajSmoothRestoreH: restoreSrc.trajSmoothRestoreH !== false,
      selectionEachFrame:
        (stepped?.selectionEachFrame ??
          fa?.selectionEachFrame ??
          fb?.selectionEachFrame ??
          base.selectionEachFrame) === true,
      opacity,
      visible: opacity > 0.001
    })
  }
  return sortViewsByTracks(out, orderedIds)
}

function isColorSceneKey(key) {
  const k = key.toLowerCase()
  return (
    k.includes('hex') ||
    k.includes('sky') ||
    k.includes('ground') ||
    k.includes('color') ||
    k === 'ambientcolor'
  )
}

/**
 * @param {Record<string, unknown>} a
 * @param {Record<string, unknown>} b
 * @param {number} t
 */
export function interpolateScene(a, b, t) {
  const out = { ...a }
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const va = a[key]
    const vb = b[key]
    if (typeof va === 'number' && typeof vb === 'number') {
      out[key] = lerpNum(va, vb, t)
    } else if (typeof va === 'string' && typeof vb === 'string' && isColorSceneKey(key)) {
      if (va.startsWith('#') && vb.startsWith('#')) out[key] = lerpHex(va, vb, t)
      else out[key] = t < 0.5 ? va : vb
    } else if (
      (key === 'backgroundMode' || key === 'lightMode' || key === 'theme') &&
      typeof va === 'string' &&
      typeof vb === 'string'
    ) {
      out[key] = t < 0.5 ? va : vb
    } else if (key === 'directionalLights' && Array.isArray(va) && Array.isArray(vb)) {
      out[key] = vb.map((light, i) => {
        const la = /** @type {Record<string, unknown>} */ (va[i] ?? light)
        const lb = /** @type {Record<string, unknown>} */ (light)
        const posA = /** @type {number[]} */ (la.position ?? [0, 0, 0])
        const posB = /** @type {number[]} */ (lb.position ?? [0, 0, 0])
        const colorA = typeof la.color === 'string' ? la.color : '#ffffff'
        const colorB = typeof lb.color === 'string' ? lb.color : '#ffffff'
        return {
          enabled: t < 0.5 ? la.enabled !== false : lb.enabled !== false,
          position: posA.map((v, j) => lerpNum(v, posB[j] ?? v, t)),
          intensity: lerpNum(
            typeof la.intensity === 'number' ? la.intensity : 0.4,
            typeof lb.intensity === 'number' ? lb.intensity : 0.4,
            t
          ),
          color:
            colorA.startsWith('#') && colorB.startsWith('#')
              ? lerpHex(colorA, colorB, t)
              : t < 0.5
                ? colorA
                : colorB
        }
      })
    } else if (
      key === 'fog' &&
      ((va && typeof va === 'object') || (vb && typeof vb === 'object'))
    ) {
      const fa = /** @type {Record<string, unknown>} */ (va && typeof va === 'object' ? va : {})
      const fb = /** @type {Record<string, unknown>} */ (vb && typeof vb === 'object' ? vb : {})
      /** @param {Record<string, unknown>} f */
      function fogNear(f) {
        if (typeof f.near === 'number' && Number.isFinite(f.near)) return f.near
        if (typeof f.density === 'number' && Number.isFinite(f.density)) {
          const s = Math.max(0, Math.min(1, f.density > 1 ? 1 : f.density))
          return Math.max(1, 80 - 20 * s)
        }
        return 70
      }
      /** @param {Record<string, unknown>} f */
      function fogFar(f) {
        if (typeof f.far === 'number' && Number.isFinite(f.far)) return f.far
        if (typeof f.density === 'number' && Number.isFinite(f.density)) {
          const s = Math.max(0, Math.min(1, f.density > 1 ? 1 : f.density))
          return 80 + 40 * s
        }
        return 140
      }
      const nearA = fogNear(fa)
      const farA = Math.max(fogFar(fa), nearA + 4)
      const nearB = fogNear(fb)
      const farB = Math.max(fogFar(fb), nearB + 4)
      const enA = fa.enabled === true
      const enB = fb.enabled === true
      let near
      let far
      let enabled
      if (enA === enB) {
        near = lerpNum(nearA, nearB, t)
        far = lerpNum(farA, farB, t)
        enabled = enA
      } else {
        // Off has no cue. Linear fog has no opacity, so stretch far until the
        // amount of fog at the enabled key's far distance equals the blend weight.
        const onNear = enB ? nearB : nearA
        const onFar = enB ? farB : farA
        const strength = enB ? t : 1 - t
        enabled = strength > 0.001
        near = onNear
        far = enabled ? onNear + (onFar - onNear) / strength : onFar
      }
      if (far <= near) far = near + 4
      const colorA = typeof fa.color === 'string' ? fa.color : '#0c0e12'
      const colorB = typeof fb.color === 'string' ? fb.color : '#0c0e12'
      out[key] = {
        enabled,
        near,
        far,
        color:
          colorA.startsWith('#') && colorB.startsWith('#')
            ? lerpHex(colorA, colorB, t)
            : t < 0.5
              ? colorA
              : colorB,
        matchBackground:
          t < 0.5 ? fa.matchBackground !== false : fb.matchBackground !== false
      }
    } else if (
      key === 'shadows' &&
      ((va && typeof va === 'object') || (vb && typeof vb === 'object'))
    ) {
      const sa = /** @type {Record<string, unknown>} */ (va && typeof va === 'object' ? va : {})
      const sb = /** @type {Record<string, unknown>} */ (vb && typeof vb === 'object' ? vb : {})
      const strA = sa.enabled === true && typeof sa.strength === 'number' ? sa.strength : 0
      const strB = sb.enabled === true && typeof sb.strength === 'number' ? sb.strength : 0
      const softA = typeof sa.softness === 'number' ? sa.softness : 0.45
      const softB = typeof sb.softness === 'number' ? sb.softness : 0.45
      const strength = lerpNum(strA, strB, t)
      out[key] = {
        enabled: strength > 0.001,
        strength,
        softness: lerpNum(softA, softB, t)
      }
    } else if (
      key === 'dof' &&
      ((va && typeof va === 'object') || (vb && typeof vb === 'object'))
    ) {
      // Fade DOF in/out by lerping blur strength (disabled side ⇒ bokeh 0),
      // so enable/disable is not a hard cut at mid-segment.
      const da = /** @type {Record<string, unknown>} */ (va && typeof va === 'object' ? va : {})
      const db = /** @type {Record<string, unknown>} */ (vb && typeof vb === 'object' ? vb : {})
      const ta = da.focusTarget && typeof da.focusTarget === 'object'
        ? /** @type {Record<string, number>} */ (da.focusTarget)
        : null
      const tb = db.focusTarget && typeof db.focusTarget === 'object'
        ? /** @type {Record<string, number>} */ (db.focusTarget)
        : null
      const bokehA =
        da.enabled === true
          ? typeof da.bokehScale === 'number'
            ? da.bokehScale
            : 2.5
          : 0
      const bokehB =
        db.enabled === true
          ? typeof db.bokehScale === 'number'
            ? db.bokehScale
            : 2.5
          : 0
      const bokehScale = lerpNum(bokehA, bokehB, t)
      out[key] = {
        enabled: bokehScale > 0.001,
        focusDistance: lerpNum(
          typeof da.focusDistance === 'number' ? da.focusDistance : 80,
          typeof db.focusDistance === 'number' ? db.focusDistance : 80,
          t
        ),
        focusRange: lerpNum(
          typeof da.focusRange === 'number' ? da.focusRange : 20,
          typeof db.focusRange === 'number' ? db.focusRange : 20,
          t
        ),
        bokehScale,
        focusTarget:
          ta && tb
            ? {
                x: lerpNum(ta.x ?? 0, tb.x ?? 0, t),
                y: lerpNum(ta.y ?? 0, tb.y ?? 0, t),
                z: lerpNum(ta.z ?? 0, tb.z ?? 0, t)
              }
            : t < 0.5
              ? ta
                ? { x: ta.x, y: ta.y, z: ta.z }
                : null
              : tb
                ? { x: tb.x, y: tb.y, z: tb.z }
                : null
      }
    } else if (t >= 0.5) {
      out[key] = vb
    }
  }
  return out
}

/**
 * @param {import('./schema.js').AnimationKeyframe} from
 * @param {import('./schema.js').AnimationKeyframe} to
 * @param {number} localT
 * @param {Map<number, [number, number, number]> | null} [baseCoords]
 * @param {string | null} [structureId]
 * @param {string | null} [primaryId]
 * @returns {{ indices: number[], xyz: number[] } | null}
 */
export function interpolateCoordPatch(
  from,
  to,
  localT,
  baseCoords = null,
  structureId = null,
  primaryId = null
) {
  const a = coordPatchForStructure(from, structureId, primaryId) ?? (!structureId ? from?.coordPatch : null)
  const b = coordPatchForStructure(to, structureId, primaryId) ?? (!structureId ? to?.coordPatch : null)
  return lerpPatches(a ?? null, b ?? null, localT, baseCoords)
}

/**
 * @param {import('./schema.js').AnimationKeyframe} from
 * @param {import('./schema.js').AnimationKeyframe} to
 * @param {number} rawT
 * @param {Map<number, [number, number, number]> | null} [baseCoords]
 * @param {string | null} [primaryId]
 * @returns {Record<string, { indices: number[], xyz: number[] }> | null}
 */
export function interpolateCoordPatches(from, to, rawT, baseCoords = null, primaryId = null) {
  /** @type {Set<string>} */
  const ids = new Set([
    ...Object.keys(from?.coordPatches || {}),
    ...Object.keys(to?.coordPatches || {})
  ])
  if (primaryId && (from?.coordPatch || to?.coordPatch)) ids.add(primaryId)
  if (!ids.size && (from?.coordPatch || to?.coordPatch)) {
    const patch = lerpPatches(from?.coordPatch ?? null, to?.coordPatch ?? null, channelClock(rawT, to).motionT, baseCoords)
    return patch ? { _primary: patch } : null
  }
  /** @type {Record<string, { indices: number[], xyz: number[] }>} */
  const out = {}
  for (const sid of ids) {
    const { motionT } = channelClock(rawT, to, sid)
    const patch = interpolateCoordPatch(from, to, motionT, baseCoords, sid, primaryId)
    if (patch) out[sid] = patch
  }
  return Object.keys(out).length ? out : null
}

/**
 * @param {import('./schema.js').AnimationKeyframe[]} keyframes
 * @param {number} time_s
 * @param {string[]} [viewTracks]
 * @param {Map<number, [number, number, number]> | null} [baseCoords]
 * @param {string | null} [primaryStructureId]
 */
export function interpolateAtTime(
  keyframes,
  time_s,
  viewTracks = [],
  baseCoords = null,
  primaryStructureId = null
) {
  const seg = findKeyframeSegment(keyframes, time_s)
  if (!seg) return null
  const { from, to, localT, motionT, rawT, segmentDuration } = seg

  const views = interpolateViews(
    keyframes,
    time_s,
    from,
    to,
    localT,
    motionT,
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

  const primaryMotionT = primaryStructureId
    ? channelClock(rawT, to, primaryStructureId).motionT
    : motionT
  const trajFrame = interpolateTrajFrame(from, to, primaryMotionT, keyframes)
  const coordPatches = interpolateCoordPatches(from, to, rawT, baseCoords, primaryStructureId)
  const coordPatch =
    (primaryStructureId && coordPatches?.[primaryStructureId]) ||
    coordPatches?._primary ||
    interpolateCoordPatch(from, to, primaryMotionT, baseCoords, primaryStructureId, primaryStructureId)

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
    ),
    coordPatch: coordPatch ?? null,
    ...(coordPatches
      ? {
          coordPatches: Object.fromEntries(
            Object.entries(coordPatches).filter(([k]) => k !== '_primary')
          )
        }
      : {}),
    ...(trajFrame != null ? { trajFrame } : {})
  }
}
