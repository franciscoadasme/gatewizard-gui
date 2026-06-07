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

  <!-- small bubble, left -->
  <circle fill="currentColor" stroke="none" cx="9.5" cy="3.5" r="1.3" />

  <!-- large bubble, right -->
  <circle fill="currentColor" stroke="none" cx="14.5" cy="1.8" r="1.9" />

  <!-- single rim line -->
  <line x1="2" y1="8.5" x2="22" y2="8.5" />

  <!-- cauldron body: bottom ends at ~19.5 to leave room for legs -->
  <path d="
    M3.8 8.5
    C 0.5 11, 0.2 17.5, 4.8 20.2
    C 7 21.5, 9.5 22, 12 22
    C 14.5 22, 17 21.5, 19.2 20.2
    C 23.8 17.5, 23.5 11, 20.2 8.5
  " fill="none" />

  <!-- left leg -->
  <line x1="6.2" y1="21" x2="6.2" y2="23.2" />

  <!-- right leg -->
  <line x1="17.8" y1="21" x2="17.8" y2="23.2" />
</svg>