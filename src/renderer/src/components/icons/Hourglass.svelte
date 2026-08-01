<script>
  import PngIcon from './PngIcon.svelte'
  import equilibrationIcon from '../../../../../resources/brand/logos/stage-icons/equilibration.png'

  /** @type {{ className?: string, title?: string }} */
  let { className = '', title } = $props()
</script>

<PngIcon src={equilibrationIcon} {className} {title} />
