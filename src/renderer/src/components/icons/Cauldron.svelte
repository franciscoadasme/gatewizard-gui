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
  <circle fill="currentColor" stroke="none" cx="9.2" cy="3.8" r="1.1" />

  <!-- large bubble, right -->
  <circle fill="currentColor" stroke="none" cx="14.2" cy="2.4" r="1.6" />

  <!-- single rim line -->
  <line x1="3" y1="8.5" x2="21" y2="8.5" />

  <!-- cauldron body: control points pulled in to stay well within viewBox -->
  <path d="
    M4.5 8.5
    C 2 11, 2 17, 6 20
    C 8 21.2, 10 21.8, 12 21.8
    C 14 21.8, 16 21.2, 18 20
    C 22 17, 22 11, 19.5 8.5
  " fill="none" />

  <!-- left leg — clearly visible with enough length -->
  <line x1="7" y1="20.5" x2="7" y2="22.8" />

  <!-- right leg -->
  <line x1="17" y1="20.5" x2="17" y2="22.8" />
</svg>