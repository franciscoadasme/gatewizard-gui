<script>
  let {
    /** @type {'default' | 'sm' | 'lg'} */
    size = 'default',
    className = '',
    value = $bindable(''),
    ...restProps
  } = $props()

  const baseClass =
    'block transition-colors [&::-webkit-color-swatch]:rounded-sm [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:rounded-md [&::-webkit-color-swatch-wrapper]:border [&::-webkit-color-swatch-wrapper]:border-neutral-800 [&::-webkit-color-swatch-wrapper]:bg-neutral-950 [&::-webkit-color-swatch-wrapper]:transition-colors hover:[&::-webkit-color-swatch-wrapper]:border-neutral-700 disabled:opacity-50'

  const sizeClasses = {
    sm: 'size-6.5 [&::-webkit-color-swatch-wrapper]:p-1',
    default: 'size-8 [&::-webkit-color-swatch-wrapper]:p-1.5',
    lg: 'size-10 [&::-webkit-color-swatch-wrapper]:p-2'
  }

  const classes = $derived(
    `${baseClass} ${sizeClasses[size] ?? sizeClasses.default} ${className}`.trim()
  )
</script>

<input type="color" class={classes} bind:value {...restProps} />
