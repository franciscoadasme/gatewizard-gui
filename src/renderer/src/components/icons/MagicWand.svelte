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

  <!-- wand body rotated 45° upper-right, slightly thicker and longer -->
  <g transform="translate(12,12) rotate(45) translate(-12,-12)">
    <rect x="10.5" y="4" width="3.5" height="16" rx="1.75" />
    <line x1="10.5" y1="8" x2="14" y2="8" />
  </g>

  <!-- sparkles spread around the upper-right tip area -->

  <!-- plus top (small) -->
  <line x1="14.5" y1="2" x2="14.5" y2="5" stroke-width="1.4" />
  <line x1="13" y1="3.5" x2="16" y2="3.5" stroke-width="1.4" />

  <!-- plus right (large) -->
  <line x1="19" y1="5" x2="19" y2="9.5" stroke-width="1.4" />
  <line x1="16.8" y1="7.2" x2="21.2" y2="7.2" stroke-width="1.4" />

  <!-- plus lower-right (small) -->
  <line x1="20.5" y1="11" x2="20.5" y2="14" stroke-width="1.4" />
  <line x1="19" y1="12.5" x2="22" y2="12.5" stroke-width="1.4" />
</svg>