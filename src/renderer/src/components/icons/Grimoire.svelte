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

  <!-- book front cover — taller -->
  <rect x="3.5" y="2" width="17" height="17" rx="0.5" />

  <!-- spine -->
  <line x1="3.5" y1="2" x2="3.5" y2="19" />

  <!-- bottom page ledge -->
  <path d="M3.5 19 Q3.5 21.5 6 21.5 L20.5 21.5 L20.5 19" fill="none" />

  <!-- small sparkle, upper-left -->
  <path
    fill="currentColor"
    stroke="none"
    d="M8.5 4.8 L9.1 6.4 L10.7 7 L9.1 7.6 L8.5 9.2 L7.9 7.6 L6.3 7 L7.9 6.4 Z"
  />

  <!-- large sparkle, lower-right -->
  <path
    fill="currentColor"
    stroke="none"
    d="M15 10.5 L16 13.2 L18.7 14.2 L16 15.2 L15 17.9 L14 15.2 L11.3 14.2 L14 13.2 Z"
  />
</svg>