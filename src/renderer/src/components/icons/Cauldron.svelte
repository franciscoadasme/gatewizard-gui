<script>
  import PngIcon from './PngIcon.svelte'
  import preparationIcon from '../../../../../resources/brand/logos/stage-icons/preparation.png'

  /** @type {{ className?: string, title?: string }} */
  let { className = '', title } = $props()
</script>

<PngIcon src={preparationIcon} {className} {title} />
