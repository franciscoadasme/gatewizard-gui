<script>
  import SvgIcon from './SvgIcon.svelte'
  import markup from '../../../../../resources/brand/logos/stage-icons/tools.svg?raw'

  /** @type {{ className?: string, title?: string, strokeMode?: 'absolute' | 'relative', stroke?: number | null }} */
  let { className = '', title, strokeMode = 'absolute', stroke = null } = $props()
</script>

<SvgIcon {markup} {className} {title} {strokeMode} {stroke} />
