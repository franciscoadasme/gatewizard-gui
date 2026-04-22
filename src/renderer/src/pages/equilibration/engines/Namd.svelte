<script module>
  export const label = 'NAMD'
</script>

<script>
  import Input from '../../../components/ui/Input.svelte'

  let executable = $state('namd3')
</script>

<div class="space-y-1">
  <p class="text-xs">Executable:</p>
  <Input type="text" bind:value={executable} className="w-full" />
</div>
