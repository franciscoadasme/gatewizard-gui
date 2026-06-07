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

  <!-- outer eye shape — tighter, more almond-like with breathing room -->
  <path d="M4.5 12 C 6.5 8, 9 6.5 12 6.5 C 15 6.5 17.5 8 19.5 12 C 17.5 16 15 17.5 12 17.5 C 9 17.5 6.5 16 4.5 12 Z" />

  <!-- iris ring -->
  <circle cx="12" cy="12" r="2.6" />

  <!-- pupil -->
  <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
</svg>