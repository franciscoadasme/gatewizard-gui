<script>
  let {
    /** @type {'default' | 'ghost'} */
    variant = 'default',
    /** @type {'default' | 'sm' | 'lg'} */
    size = 'default',
    type = 'text',
    value = $bindable(''),
    disabled = false,
    readonly = false,
    required = false,
    id,
    name,
    placeholder,
    className = '',
    ...restProps
  } = $props()

  const baseClass =
    'flex rounded-md text-sm transition-colors placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 dark:placeholder:text-neutral-400 dark:focus-visible:ring-neutral-600'

  const variantClasses = {
    default:
      'border border-neutral-300 bg-transparent text-neutral-900 hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-50 dark:hover:border-neutral-700',
    ghost:
      'border border-transparent bg-transparent text-neutral-900 hover:bg-neutral-100 dark:text-neutral-50 dark:hover:bg-neutral-800'
  }

  const sizeClasses = {
    sm: 'px-2 py-1 text-xs',
    default: 'px-3 py-2 text-sm',
    lg: 'py-3 px-4 text-base'
  }

  const classes = $derived(
    `${baseClass} ${variantClasses[variant] ?? variantClasses.default} ${
      sizeClasses[size] ?? sizeClasses.default
    } ${className}`.trim()
  )
</script>

<input
  {type}
  class={classes}
  bind:value
  {disabled}
  {readonly}
  {required}
  id={id ?? name}
  {name}
  {placeholder}
  spellcheck="false"
  {...restProps}
/>
