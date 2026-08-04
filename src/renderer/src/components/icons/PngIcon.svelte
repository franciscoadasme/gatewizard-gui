<script>
  /** @type {{ src: string, className?: string, title?: string }} */
  let { src, className = '', title } = $props()
</script>

<img
  {src}
  alt=""
  class="pointer-events-none object-contain dark:invert {className}"
  role={title ? 'img' : 'presentation'}
  aria-hidden={title ? undefined : true}
/>
