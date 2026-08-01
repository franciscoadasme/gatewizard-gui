<script>
  /**
   * Compact local-vs-remote folder sync indicator for remote job cards.
   * @type {{
   *   localBytes?: number|null,
   *   remoteBytes?: number|null,
   *   localLabel?: string,
   *   remoteLabel?: string,
   *   loading?: boolean,
   *   pulling?: boolean,
   *   compact?: boolean,
   *   className?: string
   * }}
   */
  let {
    localBytes = null,
    remoteBytes = null,
    localLabel = '',
    remoteLabel = '',
    loading = false,
    pulling = false,
    compact = false,
    className = ''
  } = $props()

  const size = $derived(compact ? 36 : 40)
  const stroke = 3.5
  const radius = $derived((size - stroke) / 2)
  const circumference = $derived(2 * Math.PI * radius)

  const ratio = $derived.by(() => {
    const local = Number(localBytes)
    const remote = Number(remoteBytes)
    if (!Number.isFinite(remote) || remote <= 0) return null
    if (!Number.isFinite(local) || local < 0) return 0
    return Math.max(0, Math.min(1, local / remote))
  })

  const percent = $derived(ratio == null ? null : Math.round(ratio * 100))
  const dashOffset = $derived(
    ratio == null ? circumference : circumference * (1 - ratio)
  )

  const title = $derived.by(() => {
    const local = localLabel || formatFallback(localBytes)
    const remote = remoteLabel || formatFallback(remoteBytes)
    if (remoteBytes == null && localBytes == null) return 'Folder sizes unknown'
    if (remoteBytes == null) return `Local ${local} · remote size unknown`
    return `Local ${local} of remote ${remote}`
  })

  /** @param {number|null|undefined} n */
  function formatFallback(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let v = Math.max(0, Number(n))
    let i = 0
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024
      i += 1
    }
    if (i === 0) return `${Math.round(v)} ${units[i]}`
    return `${v.toFixed(1)} ${units[i]}`
  }
</script>

<div
  class="inline-flex w-[7.75rem] shrink-0 items-center gap-1.5 {className}"
  title={title}
  role="img"
  aria-label={title}
>
  <div class="relative shrink-0" style:width="{size}px" style:height="{size}px">
    <svg width={size} height={size} viewBox="0 0 {size} {size}" class="-rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        stroke-width={stroke}
        class="text-neutral-300 dark:text-neutral-700"
      />
      {#if ratio != null}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          stroke-width={stroke}
          stroke-linecap="round"
          stroke-dasharray={circumference}
          stroke-dashoffset={dashOffset}
          class="text-sky-500 transition-[stroke-dashoffset] duration-300 ease-out dark:text-sky-400"
          class:animate-pulse={pulling}
        />
      {/if}
    </svg>
    <span
      class="absolute inset-0 flex items-center justify-center text-[9px] font-semibold tabular-nums text-neutral-700 dark:text-neutral-200"
    >
      {#if loading}
        …
      {:else if percent != null}
        {percent}%
      {:else}
        —
      {/if}
    </span>
  </div>
  <div class="min-w-0 flex-1 leading-tight">
    <div class="grid grid-cols-[auto_1fr] gap-x-1 text-[10px] text-neutral-600 dark:text-neutral-300">
      <span class="text-neutral-400 dark:text-neutral-500">{compact ? 'L' : 'Local'}</span>
      <span class="truncate text-right font-medium tabular-nums"
        >{localLabel || formatFallback(localBytes)}</span
      >
      <span class="text-neutral-400 dark:text-neutral-500">{compact ? 'R' : 'Remote'}</span>
      <span class="truncate text-right font-medium tabular-nums"
        >{remoteLabel || formatFallback(remoteBytes)}</span
      >
    </div>
  </div>
</div>
