<script>
  import { onMount } from 'svelte'
  import Button from './ui/Button.svelte'
  import Input from './ui/Input.svelte'
  import Spinner from './ui/Spinner.svelte'
  import {
    WORKDIR_STRATEGIES,
    emptyClusterProfile,
    listSshIdentityFiles,
    loadClusterProfiles,
    saveClusterProfiles
  } from '../lib/clusterProfiles.js'
  import {
    clusterConnect,
    clusterDefaultTemplate,
    clusterDisconnect,
    clusterProbe
  } from '../lib/backendApi'

  /** @type {{ onProfilesChanged?: (profiles: any[]) => void }} */
  let { onProfilesChanged = () => {} } = $props()

  /** @type {import('../lib/clusterProfiles.js').ClusterProfile[]} */
  let profiles = $state([])
  let loading = $state(true)
  let saving = $state(false)
  /** @type {'idle' | 'dirty' | 'saving' | 'saved' | 'error'} */
  let saveState = $state(/** @type {'idle' | 'dirty' | 'saving' | 'saved' | 'error'} */ ('idle'))
  let error = $state(/** @type {string|null} */ (null))
  let message = $state(/** @type {string|null} */ (null))
  let selectedId = $state('')
  let password = $state('')
  let connecting = $state(false)
  let probing = $state(false)
  /** @type {string|null} */
  let sessionId = $state(null)
  let showTemplate = $state(false)
  let templateDraft = $state('')
  /** @type {{ name: string, path: string }[]} */
  let sshIdentityOptions = $state([])
  let sshIdentityScanned = $state(false)
  let sshDirExists = $state(false)

  const selected = $derived(profiles.find((p) => p.id === selectedId) || null)
  const saveStatusLabel = $derived(
    saveState === 'saving'
      ? 'Saving…'
      : saveState === 'dirty'
        ? 'Unsaved changes…'
        : saveState === 'saved'
          ? 'All changes saved'
          : saveState === 'error'
            ? 'Save failed'
            : ''
  )

  onMount(() => {
    void reload()
    void refreshSshIdentityFiles()
  })

  async function refreshSshIdentityFiles() {
    try {
      const result = await listSshIdentityFiles()
      sshIdentityOptions = result.keys
      sshDirExists = result.exists
    } catch {
      sshIdentityOptions = []
      sshDirExists = false
    } finally {
      sshIdentityScanned = true
    }
  }

  async function reload() {
    loading = true
    error = null
    try {
      profiles = await loadClusterProfiles()
      if (!selectedId && profiles.length) selectedId = profiles[0].id
      onProfilesChanged(profiles)
      saveState = 'idle'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function persist(next, { quiet = false } = {}) {
    saving = true
    saveState = 'saving'
    if (!quiet) {
      error = null
    }
    try {
      profiles = await saveClusterProfiles(next)
      onProfilesChanged(profiles)
      saveState = 'saved'
      if (!quiet) message = null
    } catch (err) {
      saveState = 'error'
      error = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      saving = false
    }
  }

  function addProfile() {
    const p = emptyClusterProfile({ name: `Cluster ${profiles.length + 1}` })
    const next = [...profiles, p]
    selectedId = p.id
    void persist(next)
  }

  function removeSelected() {
    if (!selected) return
    const next = profiles.filter((p) => p.id !== selected.id)
    selectedId = next[0]?.id || ''
    void persist(next)
  }

  /**
   * @param {string} key
   * @param {any} value
   */
  function patchSelected(key, value) {
    if (!selected) return
    profiles = profiles.map((p) => (p.id === selected.id ? { ...p, [key]: value } : p))
    saveState = 'dirty'
    scheduleAutosave()
  }

  /** @type {ReturnType<typeof setTimeout> | null} */
  let autosaveTimer = null

  function scheduleAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer)
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null
      void persist(profiles, { quiet: true }).catch(() => {})
    }, 400)
  }

  /** Flush pending edits to disk before connect / probe / close. */
  async function flushSave() {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer)
      autosaveTimer = null
    }
    if (saveState === 'dirty' || saveState === 'error') {
      await persist(profiles, { quiet: true })
    }
  }

  const fieldClass =
    'w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-xs text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-50'

  async function onConnectAndProbe() {
    if (!selected) return
    if (!selected.host?.trim() || !selected.username?.trim()) {
      error = 'Enter host and username first (they autosave as you type).'
      return
    }
    connecting = true
    probing = false
    error = null
    message = null
    try {
      await flushSave()
      const profile = profiles.find((p) => p.id === selectedId)
      if (!profile) throw new Error('Profile not found after save')
      if (sessionId) {
        await clusterDisconnect({ session_id: sessionId }).catch(() => {})
        sessionId = null
      }
      const result = await clusterConnect({
        profile: JSON.parse(JSON.stringify(profile)),
        password: password || null
      })
      sessionId = result.session_id
      password = ''
      connecting = false
      probing = true
      const probed = await clusterProbe({
        session_id: sessionId,
        profile: JSON.parse(JSON.stringify(profile))
      })
      // Keep user Settings paths; only store probe snapshot (+ fill empty templates from API).
      profiles = profiles.map((p) => {
        if (p.id !== profile.id) return p
        const api = probed.profile || {}
        const keepSubmit = (p.submit_root || '').trim() && !String(p.submit_root).includes('$')
        const keepScratch =
          (p.scratch_root || '').trim() &&
          !['$SCRATCH_DIR', '${SCRATCH_DIR}'].includes(String(p.scratch_root).trim()) &&
          !String(p.scratch_root).includes('$')
        return {
          ...p,
          submit_root: keepSubmit ? p.submit_root : api.submit_root || p.submit_root,
          scratch_root: keepScratch ? p.scratch_root : api.scratch_root || p.scratch_root,
          last_probe: probed.probe || api.last_probe || p.last_probe
        }
      })
      await persist(profiles, { quiet: true })
      const nMods = probed.probe?.modules?.length ?? 0
      const nPart = probed.probe?.partitions?.length ?? 0
      message = `Connected to ${result.username}@${result.host} · probe: ${nMods} modules, ${nPart} partitions`
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      connecting = false
      probing = false
    }
  }

  async function onEditTemplate() {
    if (!selected) return
    showTemplate = true
    if (selected.batch_template) {
      templateDraft = selected.batch_template
      return
    }
    try {
      const res = await clusterDefaultTemplate(selected)
      templateDraft = res.template || ''
    } catch {
      templateDraft = ''
    }
  }

  async function applyTemplate() {
    if (!selected) return
    profiles = profiles.map((p) =>
      p.id === selected.id
        ? { ...p, batch_template: templateDraft || null, workdir_strategy: 'custom_template' }
        : p
    )
    showTemplate = false
    await persist(profiles)
  }
</script>

<section class="space-y-3">
  <h3 class="text-sm font-semibold text-neutral-800 dark:text-neutral-200">Clusters</h3>
  <p class="text-neutral-500 dark:text-neutral-500">
    Profiles autosave as you edit. Use <strong>Connect &amp; probe</strong> at the bottom to test the
    cluster — no separate Save step. Passwords are never stored.
  </p>

  {#if loading}
    <div class="flex items-center gap-2 text-neutral-500">
      <Spinner /> Loading profiles…
    </div>
  {:else}
    <div class="flex flex-wrap items-center gap-2">
      <Button variant="outline" onclick={addProfile}>Add cluster</Button>
      <Button variant="outline" disabled={!selected} onclick={removeSelected}>Remove</Button>
      {#if saveStatusLabel}
        <span
          class="text-[10px]
            {saveState === 'error'
              ? 'text-red-500'
              : saveState === 'dirty' || saveState === 'saving'
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-neutral-500'}"
          aria-live="polite"
        >
          {#if saveState === 'saving'}
            <Spinner className="mr-1 inline-block" />
          {/if}
          {saveStatusLabel}
        </span>
      {/if}
    </div>

    {#if profiles.length === 0}
      <p class="text-neutral-500">No clusters yet. Add one to get started.</p>
    {:else}
      <div class="grid gap-3 md:grid-cols-[10rem_1fr]">
        <div class="flex flex-col gap-0.5">
          {#each profiles as p (p.id)}
            <button
              type="button"
              class="rounded px-2 py-1.5 text-left text-[11px]
                {selectedId === p.id
                  ? 'bg-neutral-200 font-medium dark:bg-neutral-800'
                  : 'hover:bg-neutral-100 dark:hover:bg-neutral-800/80'}"
              onclick={() => (selectedId = p.id)}
            >
              {p.name || p.id}
            </button>
          {/each}
        </div>

        {#if selected}
          <div class="space-y-2">
            <label class="block space-y-0.5">
              <span class="sidebar-label">Name</span>
              <input
                class={fieldClass}
                value={selected.name}
                oninput={(e) => patchSelected('name', e.currentTarget.value)}
              />
            </label>
            <div class="grid grid-cols-2 gap-2">
              <label class="block space-y-0.5">
                <span class="sidebar-label">Host</span>
                <input
                  class={fieldClass}
                  value={selected.host}
                  oninput={(e) => patchSelected('host', e.currentTarget.value)}
                />
              </label>
              <label class="block space-y-0.5">
                <span class="sidebar-label">Port</span>
                <input
                  class={fieldClass}
                  type="number"
                  value={String(selected.port ?? 22)}
                  oninput={(e) => patchSelected('port', Number(e.currentTarget.value) || 22)}
                />
              </label>
            </div>
            <label class="block space-y-0.5">
              <span class="sidebar-label">Username</span>
              <input
                class={fieldClass}
                value={selected.username}
                oninput={(e) => patchSelected('username', e.currentTarget.value)}
              />
            </label>
            <label class="block space-y-0.5">
              <span class="sidebar-label">SSH identity file (optional)</span>
              <input
                class={fieldClass}
                value={selected.identity_file || ''}
                placeholder="~/.ssh/id_ed25519"
                list="gw-ssh-identity-files"
                oninput={(e) => patchSelected('identity_file', e.currentTarget.value)}
              />
              <datalist id="gw-ssh-identity-files">
                {#each sshIdentityOptions as key (key.path)}
                  <option value={key.path}>{key.name}</option>
                {/each}
              </datalist>
              {#if sshIdentityScanned && sshIdentityOptions.length > 0}
                <p class="text-[10px] text-neutral-500">
                  Detected on this computer:
                  {#each sshIdentityOptions as key, index (key.path)}
                    {#if index > 0},
                    {/if}
                    <button
                      type="button"
                      class="text-neutral-700 underline underline-offset-2 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
                      onclick={() => patchSelected('identity_file', key.path)}
                    >
                      {key.name}
                    </button>
                  {/each}
                </p>
              {:else if sshIdentityScanned && sshDirExists}
                <p class="text-[10px] text-neutral-500">
                  No private keys found in ~/.ssh. Generate one (see README → Cluster profiles).
                </p>
              {:else if sshIdentityScanned}
                <p class="text-[10px] text-neutral-500">
                  No ~/.ssh folder on this computer yet. Generate a key (see README → Cluster profiles).
                </p>
              {/if}
            </label>
            <label class="block space-y-0.5">
              <span class="sidebar-label">Scheduler</span>
              <select
                class={fieldClass}
                value={selected.scheduler || 'slurm'}
                onchange={(e) => patchSelected('scheduler', e.currentTarget.value)}
              >
                <option value="slurm">Slurm</option>
                <option value="pbs">PBS (future)</option>
                <option value="sge">SGE (future)</option>
              </select>
            </label>
            <label class="block space-y-0.5">
              <span class="sidebar-label">Submit root (durable)</span>
              <input
                class={fieldClass}
                value={selected.submit_root || ''}
                oninput={(e) => patchSelected('submit_root', e.currentTarget.value)}
              />
            </label>
            <label class="block space-y-0.5">
              <span class="sidebar-label">Scratch root</span>
              <input
                class={fieldClass}
                value={selected.scratch_root || ''}
                oninput={(e) => patchSelected('scratch_root', e.currentTarget.value)}
              />
            </label>
            <label class="block space-y-0.5">
              <span class="sidebar-label">Workdir strategy</span>
              <select
                class={fieldClass}
                value={selected.workdir_strategy || 'scratch_job_id'}
                onchange={(e) => patchSelected('workdir_strategy', e.currentTarget.value)}
              >
                {#each WORKDIR_STRATEGIES as s (s.id)}
                  <option value={s.id}>{s.label}</option>
                {/each}
              </select>
            </label>
            <label class="block space-y-0.5">
              <span class="sidebar-label">Default job time limit (#SBATCH -t)</span>
              <input
                class="{fieldClass} font-mono"
                value={selected.default_time_limit || '24:00:00'}
                placeholder="24:00:00 or 10-00:00:00"
                spellcheck="false"
                oninput={(e) => patchSelected('default_time_limit', e.currentTarget.value)}
              />
              <span class="text-[10px] text-neutral-500">
                Used as the starting time limit in Remote job (Slurm D-HH:MM:SS or HH:MM:SS).
              </span>
            </label>
            <label class="block space-y-0.5">
              <span class="sidebar-label">Mail user</span>
              <input
                class={fieldClass}
                value={selected.mail_user || ''}
                oninput={(e) => patchSelected('mail_user', e.currentTarget.value)}
              />
            </label>
            <label class="block space-y-0.5">
              <span class="sidebar-label">Mail type</span>
              <select
                class={fieldClass}
                value={selected.mail_type || 'NONE'}
                onchange={(e) => patchSelected('mail_type', e.currentTarget.value)}
              >
                <option value="NONE">NONE</option>
                <option value="ALL">ALL</option>
                <option value="END">END</option>
                <option value="FAIL">FAIL</option>
              </select>
            </label>
            <label class="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!selected.purge_modules}
                onchange={(e) => patchSelected('purge_modules', e.currentTarget.checked)}
              />
              <span>module purge before load</span>
            </label>
            <label class="block space-y-0.5">
              <span class="sidebar-label">Extra #SBATCH lines (one per line)</span>
              <textarea
                class="{fieldClass} min-h-[4rem] font-mono text-[11px]"
                value={(selected.extra_sbatch_lines || []).join('\n')}
                oninput={(e) =>
                  patchSelected(
                    'extra_sbatch_lines',
                    e.currentTarget.value
                      .split('\n')
                      .map((l) => l.trim())
                      .filter(Boolean)
                  )}
              ></textarea>
            </label>
            <div class="flex flex-wrap gap-2">
              <Button variant="outline" onclick={onEditTemplate}>Edit batch template</Button>
            </div>

            <div class="mt-2 space-y-2 rounded border border-neutral-200 p-2 dark:border-neutral-700">
              <p class="sidebar-heading">Test connection</p>
              <p class="text-[10px] text-neutral-500">
                Saves the profile, connects over SSH, then probes modules and partitions.
              </p>
              <label class="block space-y-0.5">
                <span class="sidebar-label">Password (session only, optional if using keys)</span>
                <Input type="password" size="sm" bind:value={password} autocomplete="off" className="w-full" />
              </label>
              <div class="flex flex-wrap gap-2">
                <Button disabled={connecting || probing || saving} onclick={onConnectAndProbe}>
                  {#if connecting || probing}
                    <Spinner className="mr-1" />
                    {connecting ? 'Connecting…' : 'Probing…'}
                  {:else}
                    Connect &amp; probe
                  {/if}
                </Button>
              </div>
              {#if sessionId}
                <p class="text-[10px] text-green-600 dark:text-green-400">Session active</p>
              {/if}
              {#if selected.last_probe}
                <p class="text-[10px] text-neutral-500">
                  Last probe: {selected.last_probe.probed_at || '—'} · host
                  {selected.last_probe.hostname || '—'} · data
                  {selected.last_probe.data_dir || '—'} · scratch
                  {selected.last_probe.scratch_dir || '—'}
                </p>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  {/if}

  {#if message}
    <p class="gw-notice gw-notice-ok">{message}</p>
  {/if}
  {#if error}
    <p class="gw-notice gw-notice-error">{error}</p>
  {/if}
</section>

{#if showTemplate}
  <div
    class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
    role="dialog"
    aria-modal="true"
  >
    <div
      class="mx-4 flex max-h-[85vh] w-full max-w-3xl flex-col rounded border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900"
    >
      <div class="border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
        <h4 class="font-semibold">Batch template</h4>
        <p class="text-[10px] text-neutral-500">
          Placeholders: &#123;&#123;job_name&#125;&#125;, &#123;&#123;cpus&#125;&#125;, &#123;&#123;module_loads&#125;&#125;,
          &#123;&#123;run_command&#125;&#125;, &#123;&#123;scratch_root&#125;&#125;, …
        </p>
      </div>
      <textarea
        class="min-h-[20rem] flex-1 bg-neutral-50 p-3 font-mono text-[11px] dark:bg-neutral-950"
        bind:value={templateDraft}
      ></textarea>
      <div class="flex justify-end gap-2 border-t border-neutral-200 px-4 py-2 dark:border-neutral-800">
        <Button variant="outline" onclick={() => (showTemplate = false)}>Cancel</Button>
        <Button onclick={applyTemplate}>Apply</Button>
      </div>
    </div>
  </div>
{/if}
