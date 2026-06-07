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

  <defs>
    <mask id="hg-bite">
      <rect width="24" height="24" fill="white"/>
      <circle cx="19" cy="18" r="5.2" fill="black"/>
    </mask>
    <clipPath id="top-clip">
      <rect x="0" y="0" width="24" height="13"/>
    </clipPath>
  </defs>

  <!-- hourglass lines with bite -->
  <g mask="url(#hg-bite)">
    <line x1="3.5" y1="2.5" x2="18.5" y2="2.5" />
    <line x1="3.5" y1="21.5" x2="18.5" y2="21.5" />
    <path d="M4.5 2.5 C 4.5 8, 10.5 11.5, 11 13 C 11.5 14.5, 4.5 18, 4.5 21.5" fill="none" />
    <path d="M17.5 2.5 C 17.5 8, 11.5 11.5, 11 13 C 10.5 14.5, 17.5 18, 17.5 21.5" fill="none" />
  </g>

  <!-- sand fill — small mound in upper portion -->
  <path
    fill="currentColor"
    stroke="none"
    clip-path="url(#top-clip)"
    d="
      M5.2 3.5
      C 5.2 7, 9.5 9.5, 11 11.5
      C 12.5 9.5, 16.8 7, 16.8 3.5
      Q 11 6.5, 5.2 3.5 Z
    "
  />

  <!-- play button circle -->
  <circle cx="19" cy="18" r="4.5" />

  <!-- play triangle -->
  <path fill="currentColor" stroke="none" d="M17.4 15.8 L17.4 20.2 L21.4 18 Z" />
</svg>