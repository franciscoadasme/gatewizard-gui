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
  <rect fill="currentColor" stroke="none" x="2.5" y="1.5" width="19" height="3" rx="1.5" />

  <!-- bottom bar -->
  <rect fill="currentColor" stroke="none" x="2.5" y="19.5" width="19" height="3" rx="1.5" />

  <!-- left edge -->
  <path d="M3.5 3 C 3.5 9, 11 12, 12 13 C 13 14, 3.5 17, 3.5 21" fill="none" />

  <!-- right edge -->
  <path d="M20.5 3 C 20.5 9, 13 12, 12 13 C 11 14, 20.5 17, 20.5 21" fill="none" />
</svg>