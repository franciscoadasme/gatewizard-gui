<script>
  import PngIcon from './PngIcon.svelte'
  import visualizeIcon from '../../../../../resources/brand/logos/stage-icons/visualize.png'

  /** @type {{ className?: string, title?: string }} */
  let { className = '', title } = $props()
</script>

<PngIcon src={visualizeIcon} {className} {title} />
