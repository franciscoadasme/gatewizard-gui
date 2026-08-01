<script>
  import PngIcon from './PngIcon.svelte'
  import builderIcon from '../../../../../resources/brand/logos/stage-icons/builder.png'

  /** @type {{ className?: string, title?: string }} */
  let { className = '', title } = $props()
</script>

<PngIcon src={builderIcon} {className} {title} />
