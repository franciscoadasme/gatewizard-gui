<script>
  import { mainViewerCamera } from './CameraRig.svelte'
  import { worldToScreen } from '../../lib/viewer/picking.js'
  import { measureDistance, measureAngle, measureDihedral } from '../../lib/viewer/measure.js'
  import {
    labelBackgroundCss,
    labelPadding,
    labelRadius,
    labelScreenPlacement
  } from '../../lib/viewer/labelStyle.js'

  /**
   * @typedef {{ x:number, y:number, z:number }} Pos
   * @typedef {{ id:string, type:'distance'|'angle'|'dihedral', atoms:Pos[], visible?: boolean, color?: string, size?: number, lineWidth?: number, background?: string, backgroundOpacity?: number, padding?: number, radius?: number, offsetY?: number, liftDir?: string, screenDX?: number, screenDY?: number, opacity?: number }} Measurement
   * @typedef {{ id:string, atom:Pos, text:string, visible?: boolean, size?: number, color?: string, background?: string, backgroundOpacity?: number, padding?: number, radius?: number, offsetY?: number, liftDir?: string, screenDX?: number, screenDY?: number, opacity?: number }} AtomLabel
   */

  /** @type {{ measurements?: Measurement[], picks?: Pos[], atomLabels?: AtomLabel[], width?: number, height?: number }} */
  let props = $props()

  /** Projected display state — updated every animation frame while content exists. */
  let proj = $state({ ms: [], pk: [], ls: [] })
  let rafId = 0

  function _valueStr(m) {
    if (m.type === 'distance') return `${measureDistance(m.atoms[0], m.atoms[1]).toFixed(2)} Å`
    if (m.type === 'angle') return `${measureAngle(m.atoms[0], m.atoms[1], m.atoms[2]).toFixed(1)}°`
    return `${measureDihedral(m.atoms[0], m.atoms[1], m.atoms[2], m.atoms[3]).toFixed(1)}°`
  }

  /** Read props each call so playback/export state is never stale in the RAF loop. */
  function _update() {
    const cam = mainViewerCamera.current
    const w = props.width ?? 0
    const h = props.height ?? 0
    if (!cam || !w || !h) return

    const picks = props.picks ?? []
    const atomLabels = (props.atomLabels ?? []).filter((l) => {
      if (l.visible === false) return false
      const op = typeof l.opacity === 'number' ? l.opacity : 1
      return op > 0.001
    })
    const measurements = (props.measurements ?? []).filter((m) => {
      if (m.visible === false) return false
      const op = typeof m.opacity === 'number' ? m.opacity : 1
      return op > 0.001
    })

    if (!atomLabels.length && !measurements.length && !picks.length) {
      proj = { ms: [], pk: [], ls: [] }
      return
    }

    proj = {
      pk: picks.map((a) => ({ ...worldToScreen(a, cam, w, h), atom: a })),
      ls: atomLabels.map((l) => ({
        ...worldToScreen(l.atom, cam, w, h),
        ...l,
        opacity: typeof l.opacity === 'number' ? l.opacity : 1
      })),
      ms: measurements.map((m) => {
        const pts = m.atoms.map((a) => worldToScreen(a, cam, w, h))
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
        return {
          id: m.id,
          pts,
          cx,
          cy,
          valueStr: _valueStr(m),
          color: m.color ?? '#facc15',
          size: m.size ?? 15,
          lineWidth: m.lineWidth ?? 1.5,
          background: m.background ?? '#000000',
          backgroundOpacity: m.backgroundOpacity ?? 0.75,
          padding: m.padding ?? 6,
          radius: m.radius ?? 4,
          // Missing offsetY must be 0 (centered), not the label default of 22.
          offsetY: typeof m.offsetY === 'number' ? m.offsetY : 0,
          liftDir: m.liftDir ?? 'up',
          screenDX: m.screenDX,
          screenDY: m.screenDY,
          opacity: typeof m.opacity === 'number' ? m.opacity : 1
        }
      })
    }
  }

  $effect(() => {
    function loop() {
      _update()
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
  })
</script>

<!-- Overlay covers the canvas exactly; pointer-events disabled so it doesn't block orbit/pan. -->
<div class="pointer-events-none absolute inset-0 overflow-hidden">
  <svg class="absolute inset-0 h-full w-full">
    <!-- Yellow rings on in-progress picks -->
    {#each proj.pk as p (`${p.atom.x},${p.atom.y},${p.atom.z}`)}
      <circle
        cx={p.x}
        cy={p.y}
        r="14"
        fill="none"
        stroke="#facc15"
        stroke-width="2"
        opacity="0.9"
      />
    {/each}

    <!-- Completed measurements (geometry only) -->
    {#each proj.ms as m (m.id)}
      {#each m.pts.slice(1) as pt, i}
        <line
          x1={m.pts[i].x}
          y1={m.pts[i].y}
          x2={pt.x}
          y2={pt.y}
          stroke={m.color}
          stroke-width={m.lineWidth}
          stroke-dasharray="5 3"
          opacity={(m.opacity ?? 1) * 0.9}
        />
      {/each}
      {#each m.pts as p}
        <circle cx={p.x} cy={p.y} r="4" fill={m.color} opacity={(m.opacity ?? 1) * 0.8} />
      {/each}
    {/each}
  </svg>

  <!-- Measurement value chips (same style model as atom labels) -->
  {#each proj.ms as m (m.id)}
    {@const pad = labelPadding(m)}
    {@const rad = labelRadius(m)}
    {@const place = labelScreenPlacement(m)}
    <div
      class="absolute font-mono leading-none"
      style="left:{m.cx + place.left}px;top:{m.cy + place.top}px;transform:{place.transform};font-size:{m.size ?? 15}px;color:{m.color ?? '#facc15'};background:{labelBackgroundCss(m)};padding:{Math.max(1, Math.round(pad * 0.45))}px {pad}px;border-radius:{rad}px;opacity:{m.opacity ?? 1}"
    >
      {m.valueStr}
    </div>
  {/each}

  <!-- Atom labels as HTML divs (CSS-positioned over the canvas) -->
  {#each proj.ls as l (l.id)}
    {@const pad = labelPadding(l)}
    {@const rad = labelRadius(l)}
    {@const place = labelScreenPlacement(l)}
    <div
      class="absolute font-mono leading-none"
      style="left:{l.x + place.left}px;top:{l.y + place.top}px;transform:{place.transform};font-size:{l.size ?? 12}px;color:{l.color ?? '#ffffff'};background:{labelBackgroundCss(l)};padding:{Math.max(1, Math.round(pad * 0.45))}px {pad}px;border-radius:{rad}px;opacity:{l.opacity ?? 1}"
    >
      {l.text}
    </div>
  {/each}
</div>
