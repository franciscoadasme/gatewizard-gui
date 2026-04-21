<script>
  /** @type {'default' | 'outline' | 'ghost'} */
  export let variant = 'default'
  /** @type {'default' | 'sm' | 'lg'} */
  export let size = 'default'
  export let type = 'button'
  export let disabled = false
  export let className = ''

  const baseClass =
    'inline-flex items-center justify-center rounded-lg font-medium transition-colors active:translate-y-0.5 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 dark:focus-visible:ring-neutral-600'

  const variantClasses = {
    default:
      'bg-neutral-100 text-neutral-900 hover:bg-neutral-200 dark:bg-neutral-50 dark:text-neutral-900 dark:hover:bg-neutral-200',
    outline:
      'border border-neutral-300 bg-neutral-900 hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-800 dark:hover:border-neutral-700',
    ghost: 'bg-transparent hover:bg-neutral-100 dark:hover:bg-neutral-800'
  }

  const sizeClasses = {
    sm: 'px-3 py-1 text-xs',
    default: 'px-4 py-2 text-sm',
    lg: 'px-8 py-3 text-base'
  }

  $: classes = `${baseClass} ${variantClasses[variant] ?? variantClasses.default} ${
    sizeClasses[size] ?? sizeClasses.default
  } ${className}`.trim()
</script>

<button {type} class={classes} {disabled} {...$$restProps}>
  <slot />
</button>
