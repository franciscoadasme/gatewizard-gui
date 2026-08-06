<script>
  let {
    /** @type {'default' | 'ghost'} */
    variant = 'default',
    /** @type {'default' | 'sm' | 'lg'} */
    size = 'default',
    value = $bindable(''),
    disabled = false,
    required = false,
    id,
    name,
    placeholder,
    className = '',
    children,
    ...restProps
  } = $props()

  const baseClass =
    'peer flex appearance-none rounded-md transition-colors [color-scheme:light] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 dark:[color-scheme:dark] dark:focus-visible:ring-neutral-600'

  const variantClasses = {
    default:
      'border border-neutral-300 bg-white text-neutral-900 hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-50 dark:hover:border-neutral-700',
    ghost:
      'border border-transparent bg-transparent text-neutral-900 hover:bg-neutral-100 dark:text-neutral-50 dark:hover:bg-neutral-800'
  }

  const sizeClasses = {
    sm: 'pl-2 pr-7 py-1 text-xs',
    default: 'pl-3 pr-8 py-2 text-sm',
    lg: 'pl-4 pr-9 py-3 text-base'
  }

  const chevronPositionClasses = {
    sm: 'right-2 h-3 w-3',
    default: 'right-3 h-4 w-4',
    lg: 'right-3 h-4 w-4'
  }

  const classes = $derived(
    `${baseClass} ${variantClasses[variant] ?? variantClasses.default} ${
      sizeClasses[size] ?? sizeClasses.default
    } ${className}`.trim()
  )

  const chevronClasses = $derived(
    `pointer-events-none absolute top-1/2 -translate-y-1/2 text-neutral-500 peer-disabled:opacity-50 dark:text-neutral-400 ${
      chevronPositionClasses[size] ?? chevronPositionClasses.default
    }`
  )
</script>

<div class="relative">
  <select
    class={classes}
    {value}
    {disabled}
    {required}
    id={id ?? name}
    {name}
    onchange={(e) => {
      value = e.currentTarget.value
      restProps.onchange?.(e)
    }}
    {...Object.fromEntries(Object.entries(restProps).filter(([key]) => key !== 'onchange'))}
  >
    {#if placeholder}
      <option value="" disabled hidden selected={value === '' || value == null}>
        {placeholder}
      </option>
    {/if}
    {@render children?.()}
  </select>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class={chevronClasses}
    aria-hidden="true"
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
</div>
