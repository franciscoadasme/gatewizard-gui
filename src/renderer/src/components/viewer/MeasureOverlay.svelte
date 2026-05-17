<script>
  import { mainViewerCamera } from './CameraRig.svelte'
  import { worldToScreen } from '../../lib/viewer/picking.js'
  import { measureDistance, measureAngle, measureDihedral } from '../../lib/viewer/measure.js'

  /**
   * @typedef {{ x:number, y:number, z:number }} Pos
   * @typedef {{ id:string, type:'distance'|'angle'|'dihedral', atoms:Pos[] }} Measurement
   * @typedef {{ id:string, atom:Pos, text:string }} AtomLabel
   */

  /** @type {{ measurements: Measurement[], picks: Pos[], atomLabels: AtomLabel[], width: number, height: number }} */
  let { measurements = [], picks = [], atomLabels = [], width = 0, height = 0 } = $props()

  /** Projected display state — updated every animation frame while content exists. */
  let proj = $state({ ms: [], pk: [], ls: [] })
  let rafId = 0

  function _valueStr(m) {
    if (m.type === 'distance') return `${measureDistance(m.atoms[0], m.atoms[1]).toFixed(2)} Å`
    if (m.type === 'angle') return `${measureAngle(m.atoms[0], m.atoms[1], m.atoms[2]).toFixed(1)}°`
    return `${measureDihedral(m.atoms[0], m.atoms[1], m.atoms[2], m.atoms[3]).toFixed(1)}°`
  }

  function _update() {
    const cam = mainViewerCamera.current
    const w = width
    const h = height
    if (!cam || !w || !h) return

    proj = {
      pk: picks.map((a) => ({ ...worldToScreen(a, cam, w, h), atom: a })),
      ls: atomLabels.map((l) => ({ ...worldToScreen(l.atom, cam, w, h), ...l })),
      ms: measurements.map((m) => {
        const pts = m.atoms.map((a) => worldToScreen(a, cam, w, h))
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
        return { id: m.id, pts, cx, cy, valueStr: _valueStr(m) }
      })
    }
  }

  $effect(() => {
    const hasContent = measurements.length > 0 || picks.length > 0 || atomLabels.length > 0
    if (!hasContent) {
      cancelAnimationFrame(rafId)
      proj = { ms: [], pk: [], ls: [] }
      return
    }
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

    <!-- Completed measurements -->
    {#each proj.ms as m (m.id)}
      <!-- Dashed lines connecting atoms -->
      {#each m.pts.slice(1) as pt, i}
        <line
          x1={m.pts[i].x}
          y1={m.pts[i].y}
          x2={pt.x}
          y2={pt.y}
          stroke="#facc15"
          stroke-width="1.5"
          stroke-dasharray="5 3"
          opacity="0.9"
        />
      {/each}
      <!-- Dots at each picked atom -->
      {#each m.pts as p}
        <circle cx={p.x} cy={p.y} r="4" fill="#facc15" opacity="0.8" />
      {/each}
      <!-- Value label with dark background -->
      {@const lw = m.valueStr.length * 7 + 10}
      <rect x={m.cx - lw / 2} y={m.cy - 10} width={lw} height="18" rx="3" fill="rgba(0,0,0,0.72)" />
      <text
        x={m.cx}
        y={m.cy + 4}
        text-anchor="middle"
        fill="#facc15"
        font-size="11"
        font-family="monospace">{m.valueStr}</text
      >
    {/each}
  </svg>

  <!-- Atom labels as HTML divs (CSS-positioned over the canvas) -->
  {#each proj.ls as l (l.id)}
    <div
      class="absolute -translate-x-1/2 rounded bg-black/75 px-1.5 py-0.5 font-mono"
      style="left:{l.x}px;top:{l.y - 22}px;font-size:{l.size ?? 12}px;color:{l.color ?? '#ffffff'}"
    >
      {l.text}
    </div>
  {/each}
</div>
