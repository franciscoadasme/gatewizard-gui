<script>
  let {
    className = '',
    /** Screen reader label (visually hidden). */
    label = 'Loading',
    ...restProps
  } = $props()

  const svgClass = $derived.by(() => {
    let cls = 'inline-block shrink-0 animate-spin text-current'
    if (!className.includes('size-') && !className.includes('w-') && !className.includes('h-')) {
      cls += ' size-4'
    }
    return `${cls} ${className}`.trim()
  })
</script>

<span role="status" class="inline-flex items-center justify-center">
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    aria-hidden="true"
    class={svgClass}
    {...restProps}
  >
    <path
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      d="M21 12a9 9 0 1 1-6.219-8.56"
    />
  </svg>
  <span class="sr-only">{label}</span>
</span>
