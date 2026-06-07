<script>
  /** @type {{ className?: string, title?: string }} */
  let { className = '', title } = $props()
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.6"
  stroke-linecap="round"
  stroke-linejoin="round"
  class={className}
  role={title ? 'img' : 'presentation'}
  aria-hidden={title ? undefined : true}
>
  {#if title}<title>{title}</title>{/if}

  <!-- top bar -->
  <rect fill="currentColor" stroke="none" x="3.5" y="1.5" width="17" height="2.2" rx="0.6"/>

  <!-- bottom bar -->
  <rect fill="currentColor" stroke="none" x="3.5" y="20.3" width="17" height="2.2" rx="0.6"/>

  <!-- hourglass left edge -->
  <path d="M3.5 2.6 C 3.5 8.5, 10.8 12, 12 13.2 C 13.2 14.4, 3.5 18, 3.5 21.4" fill="none"/>
  <!-- hourglass right edge -->
  <path d="M20.5 2.6 C 20.5 8.5, 13.2 12, 12 13.2 C 10.8 14.4, 20.5 18, 20.5 21.4" fill="none"/>

  <!-- filled sand top half -->
  <path fill="currentColor" stroke="none" d="
    M4.2 3.5
    C 4.2 8.5, 11 11.8, 12 13
    C 13 11.8, 19.8 8.5, 19.8 3.5
    Q 12 7.2, 4.2 3.5 Z
  "/>

  <!-- sand stream -->
  <rect fill="currentColor" stroke="none" x="11.3" y="13" width="1.4" height="2" rx="0.5"/>

  <!-- small sparkle, left -->
  <path fill="currentColor" stroke="none" d="
    M8 17 L8.5 18.5 L10 19 L8.5 19.5 L8 21
    L7.5 19.5 L6 19 L7.5 18.5 Z
  "/>

  <!-- large sparkle, center-right -->
  <path fill="currentColor" stroke="none" d="
    M14.5 15.5 L15.3 17.8 L17.6 18.6 L15.3 19.4 L14.5 21.7
    L13.7 19.4 L11.4 18.6 L13.7 17.8 Z
  "/>
</svg>
