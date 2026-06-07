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

  <!-- book front cover -->
  <rect x="3.5" y="2" width="17" height="17" rx="0.5" />

  <!-- spine — offset slightly to show as distinct line from cover edge -->
  <line x1="6.5" y1="2" x2="6.5" y2="19" />

  <!-- bottom page ledge -->
  <path d="M3.5 19 Q3.5 21.5 6 21.5 L20.5 21.5 L20.5 19" fill="none" />

  <!-- small sparkle, upper-left -->
  <path
    fill="currentColor"
    stroke="none"
    d="M9 4.8 L9.6 6.4 L11.2 7 L9.6 7.6 L9 9.2 L8.4 7.6 L6.8 7 L8.4 6.4 Z"
  />

  <!-- large sparkle, center — moved up to sit clearly inside cover, away from ledge -->
  <path
    fill="currentColor"
    stroke="none"
    d="M15 10 L16 12.5 L18.5 13.4 L16 14.3 L15 16.8 L14 14.3 L11.5 13.4 L14 12.5 Z"
  />
</svg>