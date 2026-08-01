<script>
  /** @type {'default' | 'outline' | 'ghost' | 'danger'} */
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
      'bg-neutral-800 text-neutral-100 hover:bg-neutral-700 dark:bg-neutral-50 dark:text-neutral-900 dark:hover:bg-neutral-200',
    outline:
      'border border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800 dark:hover:border-neutral-700',
    ghost:
      'bg-transparent text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-50',
    danger: 'bg-red-500/20 text-red-600 hover:bg-red-500/30 dark:text-red-400'
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
