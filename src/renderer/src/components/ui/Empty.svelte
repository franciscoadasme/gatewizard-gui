<script>
  export let message = 'No data available'
  export let className = ''

  const baseClass =
    'flex flex-1 items-center justify-center rounded-lg border border-dashed border-neutral-800 text-neutral-700 text-center p-2'

  $: classes = `${baseClass} ${className}`.trim()
</script>

<p class={classes} {...$$restProps}>
  {message}
</p>
