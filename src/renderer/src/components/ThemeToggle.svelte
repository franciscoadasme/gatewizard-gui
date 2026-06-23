<script>
  import Moon from './icons/Moon.svelte'
  import Sun from './icons/Sun.svelte'
  import { themeState, toggleTheme } from '../lib/theme.svelte.js'

  const isDark = $derived(themeState.current === 'dark')
</script>

<button
  type="button"
  role="switch"
  aria-checked={isDark}
  aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
  class="relative isolate flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:focus-visible:ring-neutral-600 {isDark
    ? 'bg-neutral-900'
    : 'bg-neutral-200'}"
  onclick={toggleTheme}
>
  <Sun
    className="pointer-events-none absolute left-1.5 z-0 size-3 transition-opacity {isDark
      ? 'text-neutral-500 opacity-40'
      : 'text-neutral-800 opacity-100'}"
  />
  <Moon
    className="pointer-events-none absolute right-1.5 z-0 size-3 transition-opacity {isDark
      ? 'text-neutral-100 opacity-100'
      : 'text-neutral-400 opacity-40'}"
  />
  <span
    class="relative z-10 size-5 rounded-full shadow-sm transition-transform duration-200 ease-out {isDark
      ? 'translate-x-0 bg-neutral-100'
      : 'translate-x-6 bg-neutral-900'}"
    aria-hidden="true"
  ></span>
</button>
