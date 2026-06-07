<script>
  /** @type {{ className?: string, title?: string }} */
  let { className = '', title } = $props()
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 24 24"
  fill="currentColor"
  class={className}
  role={title ? 'img' : 'presentation'}
  aria-hidden={title ? undefined : true}
>
  {#if title}<title>{title}</title>{/if}

  <defs>
    <mask id="crystal-mask">
      <rect width="24" height="24" fill="white"/>
      <!-- small star, upper-left -->
      <path fill="black" d="
        M8.5 6.8
        L9.2 8.7 L11.1 9.4 L9.2 10.1 L8.5 12
        L7.8 10.1 L5.9 9.4 L7.8 8.7 Z
      "/>
      <!-- large star, center-right -->
      <path fill="black" d="
        M14.2 8.5
        L15.4 11.8 L18.7 13 L15.4 14.2 L14.2 17.5
        L13 14.2 L9.7 13 L13 11.8 Z
      "/>
    </mask>
  </defs>

  <!-- ball -->
  <circle mask="url(#crystal-mask)" cx="12" cy="10.5" r="8.8"/>

  <!-- base -->
  <rect x="5.5" y="19.7" width="13" height="3.2" rx="0.9"/>
</svg>