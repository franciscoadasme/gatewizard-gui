<script>
  import { onMount } from 'svelte'

  /**
   * @typedef {{
   *   slot: number,
   *   label: string,
   *   icon: string,
   *   color?: string,
   *   bgColor?: string,
   *   disabled?: boolean,
   *   action?: () => void,
   *   submenu?: Array<{ text: string, action: () => void }>
   * }} RadialItem
   *
   * @type {{
   *   x: number,
   *   y: number,
   *   items: RadialItem[],
   *   info?: { title: string, subtitle?: string },
   *   onclose: () => void
   * }}
   */
  let { x, y, items, info, onclose } = $props()

  const RADIUS = 92
  const ICON_SIZE = 42

  /** Slot 0=top, 1=top-right, 2=right, 3=bottom-right, 4=bottom, 5=bottom-left, 6=left, 7=top-left */
  function slotXY(slot) {
    const a = (slot * 45 - 90) * (Math.PI / 180)
    return { x: RADIUS * Math.cos(a), y: RADIUS * Math.sin(a) }
  }

  /** Text-anchor for label on the outside of the icon */
  function labelAnchor(slot) {
    const a = (slot * 45 - 90) * (Math.PI / 180)
    const cos = Math.cos(a)
    if (cos > 0.25) return 'left'
    if (cos < -0.25) return 'right'
    return 'center'
  }

  /**
   * Label offset relative to the icon wrapper div's top-left corner.
   * The wrapper div has transform:translate(-50%,-50%), so its top-left is at
   * (pos.x - ICON_SIZE/2, pos.y - ICON_SIZE/2) on screen.
   * We position the label center at ICON_SIZE/2 + 35px from the icon center.
   */
  function labelOffset(slot) {
    const a = (slot * 45 - 90) * (Math.PI / 180)
    const half = ICON_SIZE / 2   // = 21px — icon center within wrapper div
    const dist = half + 16        // = 37px from icon center to label center
    return {
      x: half + dist * Math.cos(a),
      y: half + dist * Math.sin(a)
    }
  }

  let open = $state(false)
  /** @type {number} */
  let activeSubmenu = $state(-1)

  onMount(() => {
    // Double rAF so transition triggers after mount
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        open = true
      })
    )
  })

  function handleItemClick(item) {
    if (item.disabled) return
    if (item.submenu?.length) {
      activeSubmenu = activeSubmenu === item.slot ? -1 : item.slot
    } else {
      item.action?.()
    }
  }

  function handleKey(e) {
    if (e.key === 'Escape') onclose()
  }
</script>

<svelte:window onkeydown={handleKey} />

<!-- Backdrop (transparent, just for outside-click detection) -->
<div
  class="fixed inset-0 z-50"
  role="presentation"
  onpointerdown={(e) => {
    if (e.button === 0) onclose()
  }}
></div>

<!-- Radial container: centered on cursor -->
<div class="pointer-events-none fixed z-[51]" style="left:{x}px; top:{y}px">
  <!-- subtle glow/bg ring -->
  <div
    class="absolute rounded-full border border-white/5 bg-neutral-950/40"
    style="
      width:{RADIUS * 2 + ICON_SIZE + 4}px;
      height:{RADIUS * 2 + ICON_SIZE + 4}px;
      left:{-(RADIUS + ICON_SIZE / 2 + 2)}px;
      top:{-(RADIUS + ICON_SIZE / 2 + 2)}px;
      backdrop-filter: blur(2px);
      transition: opacity 180ms ease;
      opacity:{open ? 1 : 0};
    "
  ></div>

  <!-- Center info badge -->
  {#if info}
    <div
      class="pointer-events-none absolute z-10 rounded-full border border-neutral-600/60 bg-neutral-900/95 px-3 py-1.5 text-center shadow-lg"
      style="
        min-width: 74px;
        transform: translate(-50%, -50%) scale({open ? 1 : 0.6});
        opacity: {open ? 1 : 0};
        transition: transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 150ms ease;
      "
    >
      <div class="text-[11px] font-semibold tracking-wide text-orange-300">{info.title}</div>
      {#if info.subtitle}
        <div class="mt-0.5 text-[9px] text-neutral-400">{info.subtitle}</div>
      {/if}
    </div>
  {:else}
    <!-- Center dot -->
    <div
      class="pointer-events-none absolute h-2 w-2 rounded-full bg-white/30"
      style="transform: translate(-50%, -50%)"
    ></div>
  {/if}

  <!-- Radial items -->
  {#each items as item (item.slot)}
    {@const pos = slotXY(item.slot)}
    {@const loff = labelOffset(item.slot)}
    {@const lanch = labelAnchor(item.slot)}
    {@const delay = item.slot * 18}
    {@const isActive = activeSubmenu === item.slot}

    <div
      class="absolute"
      style="
        left: {pos.x}px;
        top: {pos.y}px;
        transform: translate(-50%, -50%) scale({open ? 1 : 0.15});
        opacity: {open ? 1 : 0};
        transition: transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1) {delay}ms,
                    opacity 150ms ease {delay}ms;
        pointer-events: auto;
      "
    >
      <!-- Icon button -->
      <button
        type="button"
        class="flex items-center justify-center rounded-full border shadow-lg transition-all duration-100
               active:scale-95 disabled:cursor-not-allowed disabled:opacity-30
               {isActive ? 'scale-110' : 'hover:scale-110'}"
        style="
          width: {ICON_SIZE}px;
          height: {ICON_SIZE}px;
          background: {item.bgColor ?? 'rgba(23,23,23,0.96)'};
          border-color: {item.disabled
          ? 'rgba(255,255,255,0.08)'
          : (item.color ?? 'rgba(255,255,255,0.18)')};
          box-shadow: 0 2px 14px rgba(0,0,0,0.55){isActive
          ? ', 0 0 0 2px ' + (item.color ?? '#fff')
          : ''};
        "
        onclick={() => handleItemClick(item)}
        disabled={item.disabled}
        title={item.label}
        aria-label={item.label}
      >
        <svg
          viewBox="0 0 16 16"
          class="pointer-events-none"
          style="width:18px;height:18px;fill:{item.color ?? '#d4d4d4'}"
          aria-hidden="true"
        >
          {@html item.icon}
        </svg>
        {#if item.submenu?.length}
          <!-- small sub-arrow indicator -->
          <svg
            viewBox="0 0 6 6"
            class="pointer-events-none absolute right-0.5 bottom-0.5"
            style="width:8px;height:8px;fill:{item.color ?? '#aaa'}"
            aria-hidden="true"
          >
            <path d="M0 0 L6 3 L0 6 Z" />
          </svg>
        {/if}
      </button>

      <!-- Label -->
      <div
        class="pointer-events-none absolute text-[10px] font-medium whitespace-nowrap text-neutral-200 drop-shadow"
        style="
          left: {loff.x}px;
          top: {loff.y}px;
          transform: translate({lanch === 'left'
          ? '0'
          : lanch === 'right'
            ? '-100%'
            : '-50%'}, -50%);
        "
      >
        {item.label}
      </div>

      <!-- Submenu dropdown (label formats) -->
      {#if isActive && item.submenu?.length}
        {@const subX = pos.x > 0 ? 'left-full ml-1' : 'right-full mr-1'}
        <div
          class="absolute top-0 z-10 min-w-36 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900/98 py-1 shadow-2xl {subX}"
          style="animation: fadeSlideIn 120ms ease forwards;"
        >
          {#each item.submenu as sub}
            <button
              type="button"
              class="w-full px-3 py-1.5 text-left font-mono text-xs text-neutral-200 transition-colors hover:bg-neutral-800 hover:text-white"
              onclick={sub.action}>{sub.text}</button
            >
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  @keyframes fadeSlideIn {
    from {
      opacity: 0;
      transform: scale(0.92) translateY(-4px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }
</style>
