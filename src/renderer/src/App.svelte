<script>
  import { onMount } from 'svelte'

  const pageModules = import.meta.glob('./pages/*.svelte', { eager: true })

  /**
   * Derives route id and nav label from the filename:
   * `FooBar.svelte` → id `fooBar`, label `FooBar`.
   * Optional `NN-FooBar.svelte` (e.g. `01-Visualize.svelte`) sets sort order (NN) and still
   * derives id/label from `FooBar`.
   * @param {string} file
   */
  function stageFromFile(file) {
    const basename = file.match(/\/([^/]+)\.svelte$/)?.[1] ?? ''
    const prefixed = /^(\d+)[-_](.+)$/.exec(basename)
    const order = prefixed ? parseInt(prefixed[1], 10) : Infinity
    const name = prefixed ? prefixed[2] : basename
    const id = name.charAt(0).toLowerCase() + name.slice(1)
    return { file, id, label: name, order }
  }

  const stages = Object.keys(pageModules)
    .map(stageFromFile)
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))

  const hashId = typeof location !== 'undefined' ? location.hash.replace(/^#/, '') : ''
  let currentId = $state(
    hashId && stages.some((s) => s.id === hashId) ? hashId : (stages[0]?.id ?? '')
  )
  /** @type {import('svelte').Component | null} */
  let ActivePage = $state(null)

  function loadPage(id) {
    const stage = stages.find((s) => s.id === id)
    if (!stage) return
    currentId = id
    if (typeof history !== 'undefined') {
      history.replaceState(null, '', `#${id}`)
    }
    const mod = pageModules[stage.file]
    if (!mod?.default) return
    ActivePage = mod.default
  }

  /**
   * @param {MouseEvent} e
   * @param {string} id
   */
  function onNavClick(e, id) {
    e.preventDefault()
    loadPage(id)
  }

  onMount(() => {
    if (currentId) loadPage(currentId)
  })
</script>

<div class="flex min-h-screen flex-col dark:bg-neutral-900 dark:text-white">
  <header class="px-4 py-2 dark:bg-neutral-800">
    <form class="flex items-center gap-2">
      <label for="directory" class="text-sm font-medium dark:text-neutral-400"
        >Working Directory:</label
      >
      <select
        id="directory"
        class="flex-1 rounded-md border border-neutral-300 p-2 disabled:bg-neutral-100 disabled:text-neutral-500 dark:bg-neutral-800 dark:disabled:bg-neutral-900 dark:border-neutral-700"
        disabled
      >
        <option value="">Select a directory</option>
        <option value="1">1</option>
        <option value="2">2</option>
        <option value="3">3</option>
      </select>
      <button type="submit" class="rounded-md dark:bg-neutral-700 px-4 py-2 text-white"
        >Browse</button
      >
    </form>
  </header>

  <nav class="flex items-center gap-2 p-4">
    <p class="dark:text-neutral-200">Stages:</p>
    <div class="flex divide-x divide-neutral-300 overflow-clip rounded-md dark:divide-neutral-700">
      {#each stages as stage (stage.id)}
        <a
          href="#{stage.id}"
          class="bg-neutral-200 px-4 py-2 text-neutral-900 no-underline transition-colors hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-600"
          class:!bg-neutral-200={currentId === stage.id}
          class:!text-black={currentId === stage.id}
          onclick={(e) => onNavClick(e, stage.id)}>{stage.label}</a
        >
      {/each}
    </div>
  </nav>

  <main class="flex-1 flex overflow-auto">
    {#if ActivePage}
      <ActivePage />
    {/if}
  </main>

  <footer class="border-t px-2 py-1 text-xs dark:border-neutral-800 dark:text-neutral-500">
    Status bar
  </footer>
</div>
