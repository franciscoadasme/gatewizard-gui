<script>
  import PngIcon from './PngIcon.svelte'
  import analysisIcon from '../../../../../resources/brand/logos/stage-icons/analysis.png'

  /** @type {{ className?: string, title?: string }} */
  let { className = '', title } = $props()
</script>

<PngIcon src={analysisIcon} {className} {title} />
