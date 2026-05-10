<script>
  let { className = '', message = '' } = $props()
</script>

{#if message}
  <div class="flex items-center gap-2">
    <hr class="flex-1 dark:border-neutral-800" />
    <span class="text-xs text-neutral-500">{message}</span>
    <hr class="flex-1 dark:border-neutral-800" />
  </div>
{:else}
  <hr class="dark:border-neutral-800" />
{/if}
