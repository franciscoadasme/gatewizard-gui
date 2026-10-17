<script>
  /** Amino-acid letters in two short sequence rows. */
  /** @type {{ className?: string, title?: string }} */
  let { className = '', title } = $props()
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 24 24"
  fill="currentColor"
  class={className}
  role={title ? 'img' : 'presentation'}
  aria-hidden={title ? undefined : true}
>
  {#if title}<title>{title}</title>{/if}
  <text
    x="12"
    y="10"
    text-anchor="middle"
    font-size="9"
    font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    font-weight="700"
  >AVL</text>
  <text
    x="12"
    y="20.2"
    text-anchor="middle"
    font-size="9"
    font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    font-weight="700"
  >GKF</text>
</svg>
