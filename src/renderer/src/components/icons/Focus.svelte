<script>
  /** @type {{ className?: string, title?: string }} */
  let { className = '', title } = $props()
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  class={className}
  role={title ? 'img' : 'presentation'}
  aria-hidden={title ? undefined : true}
>
  {#if title}<title>{title}</title>{/if}
  <circle cx="12" cy="12" r="2.5" />
  <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v3M21 12h-3M12 21v-3M3 12h3" />
  <path
    stroke-linecap="round"
    stroke-linejoin="round"
    d="M7.5 7.5 9 9M16.5 7.5 15 9M16.5 16.5 15 15M7.5 16.5 9 15"
  />
</svg>
