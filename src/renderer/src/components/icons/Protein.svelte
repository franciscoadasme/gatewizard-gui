<script>
  /**
   * Protein secondary-structure icon (α-helix + β-strand).
   * Masked PNG so the silhouette matches the design asset; color via currentColor.
   */
  import proteinUrl from '../../assets/protein-icon.png'

  /** @type {{ className?: string, title?: string }} */
  let { className = '', title } = $props()

  const maskStyle = $derived(
    [
      `mask-image: url(${proteinUrl})`,
      `-webkit-mask-image: url(${proteinUrl})`,
      'mask-size: contain',
      '-webkit-mask-size: contain',
      'mask-repeat: no-repeat',
      '-webkit-mask-repeat: no-repeat',
      'mask-position: center',
      '-webkit-mask-position: center'
    ].join(';')
  )
</script>

<span
  class="inline-block bg-current {className}"
  style={maskStyle}
  role={title ? 'img' : 'presentation'}
  aria-hidden={title ? undefined : true}
  aria-label={title}
  title={title}
></span>
