<script>
  import Button from './ui/Button.svelte'
  import Input from './ui/Input.svelte'
  import { dirsEqual, outputFolderPath } from '../lib/outputFolders.js'

  let {
    parentDir = $bindable(''),
    folderName = $bindable(''),
    workingDir = '',
    folderPlaceholder = '',
    folderLabel = 'Folder name',
    extraHint = '',
    resolvedFolderName = ''
  } = $props()

  let lastFollowedWorkingDir = $state('')

  const resolvedParent = $derived((parentDir || '').trim())
  const previewName = $derived((resolvedFolderName || folderName || '').trim())
  const fullPath = $derived(outputFolderPath(resolvedParent, previewName))
  const usingWorkingDir = $derived(!!workingDir && dirsEqual(resolvedParent, workingDir))

  // Follow the top-bar working directory until the user picks a different path.
  $effect(() => {
    const wd = (workingDir || '').trim()
    if (!wd) return
    const current = (parentDir || '').trim()
    if (!current || dirsEqual(current, lastFollowedWorkingDir)) {
      if (!dirsEqual(current, wd) || lastFollowedWorkingDir !== wd) {
        parentDir = wd
        lastFollowedWorkingDir = wd
      }
    }
  })

  $effect(() => {
    if (workingDir && dirsEqual(parentDir, workingDir)) {
      lastFollowedWorkingDir = workingDir
    }
  })

  async function browseOutputPath() {
    const result = await window.api.openDirectoryDialog(
      'Select output path',
      resolvedParent || workingDir || undefined
    )
    if (!result.canceled && result.dirPath) {
      parentDir = result.dirPath
    }
  }

  function useWorkingDirectory() {
    parentDir = workingDir || ''
  }
</script>

<div class="space-y-2">
  <h2 class="sidebar-heading">Output folder</h2>
  <div class="space-y-1">
    {#if folderLabel}
      <p class="sidebar-label">{folderLabel}</p>
    {/if}
    <div class="flex gap-1">
      <Input
        type="text"
        size="sm"
        bind:value={folderName}
        className="min-w-0 flex-1"
        placeholder={folderPlaceholder}
      />
      <Button
        size="sm"
        variant="outline"
        className="shrink-0 px-2"
        onclick={browseOutputPath}
        title="Choose a different output path"
        aria-label="Choose a different output path"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="size-3.5"
          aria-hidden="true"
        >
          <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
        </svg>
      </Button>
    </div>
    <p
      class="rounded-md border border-neutral-200 p-2 wrap-break-word sidebar-label dark:border-neutral-800"
      title={fullPath || ''}
    >
      {#if fullPath}
        {fullPath}{#if extraHint}<span class="sidebar-hint">{extraHint}</span>{/if}
      {:else}
        Set a working directory in the top bar, or choose an output path
      {/if}
    </p>
    {#if workingDir && resolvedParent && !usingWorkingDir}
      <button
        type="button"
        class="sidebar-hint text-left underline-offset-2 hover:underline"
        onclick={useWorkingDirectory}
      >
        Use working directory
      </button>
    {/if}
  </div>
</div>
