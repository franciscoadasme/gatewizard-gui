<script>
  let {
    /** @type {'default' | 'sm'} */
    size = 'default',
    checked = $bindable(false),
    disabled = false,
    id,
    name,
    value,
    required = false,
    className = '',
    ...restProps
  } = $props()

  const sizeClasses = {
    sm: 'h-3.5 w-3.5 [&_svg]:h-2.5 [&_svg]:w-2.5',
    default: 'h-4 w-4 [&_svg]:h-3 [&_svg]:w-3'
  }

  const boxSize = $derived(sizeClasses[size] ?? sizeClasses.default)
</script>

<div class="relative inline-flex shrink-0 items-center justify-center {boxSize} {className}">
  <input
    type="checkbox"
    class="peer absolute inset-0 z-10 cursor-pointer opacity-0 disabled:cursor-not-allowed"
    {checked}
    {disabled}
    id={id ?? name}
    {name}
    {value}
    {required}
    onchange={(e) => {
      checked = e.currentTarget.checked
      restProps.onchange?.(e)
    }}
    {...Object.fromEntries(Object.entries(restProps).filter(([key]) => key !== 'onchange'))}
  />
  <div
    class="pointer-events-none flex shrink-0 items-center justify-center rounded-[4px] border border-neutral-300 transition-colors peer-checked:border-neutral-900 peer-checked:bg-neutral-900 peer-focus-visible:ring-2 peer-focus-visible:ring-neutral-400 peer-focus-visible:ring-offset-2 peer-disabled:opacity-50 dark:border-neutral-600 dark:peer-checked:border-neutral-50 dark:peer-checked:bg-neutral-50 dark:peer-focus-visible:ring-neutral-600 dark:peer-focus-visible:ring-offset-neutral-950 peer-checked:[&_svg]:opacity-100 {boxSize}"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="text-white opacity-0 dark:text-neutral-900"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  </div>
</div>
