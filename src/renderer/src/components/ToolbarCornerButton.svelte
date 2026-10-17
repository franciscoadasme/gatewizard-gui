<script>
  /**
   * Bottom-right corner control for a toolbar button that has extra options.
   * The parent button must be `relative overflow-hidden rounded-lg` so this
   * wedge is clipped to that same corner.
   *
   * @type {{
   *   title?: string,
   *   ariaLabel: string,
   *   onclick?: (event: MouseEvent) => void,
   *   disabled?: boolean,
   *   active?: boolean
   * }}
   */
  let { title = '', ariaLabel, onclick, disabled = false, active = false } = $props()
</script>

<button
  type="button"
  class="group absolute right-0 bottom-0 size-3 bg-transparent p-0 disabled:pointer-events-none disabled:opacity-40"
  style="clip-path: polygon(100% 0, 100% 100%, 0 100%)"
  {title}
  aria-label={ariaLabel}
  {onclick}
  {disabled}
>
  <span
    class="absolute inset-0 transition-colors {active
      ? 'bg-sky-600 dark:bg-sky-300'
      : 'bg-neutral-500 group-hover:bg-sky-600 dark:bg-neutral-400 dark:group-hover:bg-sky-300'}"
  ></span>
</button>
