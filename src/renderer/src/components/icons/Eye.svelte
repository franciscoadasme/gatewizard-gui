<script>
  /** @type {{ className?: string, title?: string }} */
  let { className = '', title } = $props()
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  class={className}
  role={title ? 'img' : 'presentation'}
  aria-hidden={title ? undefined : true}
>
  {#if title}<title>{title}</title>{/if}
  <path
    stroke-linecap="round"
    stroke-linejoin="round"
    d="M3.5 12s4-6.5 8.5-6.5S20.5 12 20.5 12s-4 6.5-8.5 6.5S3.5 12 3.5 12Z"
  />
  <circle cx="12" cy="12" r="2.75" />
  <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
</svg>
