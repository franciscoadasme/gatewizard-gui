<script>
  /** @type {{ className?: string }} */
  let { className = '' } = $props()
</script>

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class={className} role="presentation">
  <g stroke-linecap="square" stroke-linejoin="miter">
    <line x1="3" y1="21" x2="12" y2="16" stroke="currentColor" />
    <line x1="21" y1="21" x2="12" y2="16" stroke="currentColor" />
    <line x1="12" y1="3" x2="12" y2="16" stroke="currentColor" />
  </g>
</svg>
