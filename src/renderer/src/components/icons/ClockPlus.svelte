<script>
  /** @type {{ className?: string, title?: string }} */
  let { className = '', title } = $props()
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.85"
  stroke-linecap="round"
  stroke-linejoin="round"
  class={className}
  role={title ? 'img' : 'presentation'}
  aria-hidden={title ? undefined : true}
>
  {#if title}<title>{title}</title>{/if}

  <!-- Lucide-style clock-plus -->
  <path d="M12 6v6l3.5 2" />
  <path d="M18 16.001A8 8 0 1 0 12.5 20" />
  <path d="M16 19h6" />
  <path d="M19 16v6" />
</svg>
