<script>
  /** Lucide-style 2×2 grid with plus (custom mosaic). */
  /** @type {{ className?: string, title?: string }} */
  let { className = '', title } = $props()
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.7"
  stroke-linecap="round"
  stroke-linejoin="round"
  class={className}
  role={title ? 'img' : 'presentation'}
  aria-hidden={title ? undefined : true}
>
  {#if title}<title>{title}</title>{/if}
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M3 12h18" />
  <path d="M12 3v18" />
  <path d="M16 16h6" />
  <path d="M19 13v6" />
</svg>
