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

  <!-- wand body, rotated 45° pointing upper-right -->
  <g transform="translate(12,12) rotate(45) translate(-12,-12)">
    <rect x="10" y="3" width="4" height="17" rx="2" />
    <line x1="10" y1="7" x2="14" y2="7" />
  </g>

  <!-- sparkles near upper-right tip -->

  <!-- plus, upper (small) -->
  <line x1="16" y1="1.5" x2="16" y2="4.5" stroke-width="1.4" />
  <line x1="14.5" y1="3" x2="17.5" y2="3" stroke-width="1.4" />

  <!-- plus, right (large) -->
  <line x1="19.5" y1="4" x2="19.5" y2="8" stroke-width="1.4" />
  <line x1="17.5" y1="6" x2="21.5" y2="6" stroke-width="1.4" />

  <!-- plus, lower-right (small) -->
  <line x1="20.5" y1="9.5" x2="20.5" y2="12" stroke-width="1.4" />
  <line x1="19.2" y1="10.8" x2="21.8" y2="10.8" stroke-width="1.4" />
</svg>