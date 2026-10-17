<script>
  /** Arrow dropping into an energy well. */
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
  <path d="M1.4 13.2H4.6C5.8 13.2 6.4 14.2 7.2 16L9.6 20.2c.5 1 1 1.4 1.7 1.4h1.4c.7 0 1.2-.4 1.7-1.4l2.4-4.2c.8-1.8 1.4-2.8 2.6-2.8h3.2" />
  <path d="M12 2.2v6.4" />
  <path d="m9.8 6.2 2.2 2.6 2.2-2.6" />
</svg>
