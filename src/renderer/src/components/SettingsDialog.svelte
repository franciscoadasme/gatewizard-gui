<script>
  import Button from './ui/Button.svelte'
  import Spinner from './ui/Spinner.svelte'
  import SceneDefaultsForm from './SceneDefaultsForm.svelte'
  import { appSettings, updateAppSettings } from '../lib/appSettings.svelte.js'
  import {
    clearPersistedViewerSettings,
    persistViewerSettings
  } from '../lib/viewerSettings.svelte.js'
  import { setPreferredTheme, themeState } from '../lib/theme.svelte.js'
  import { getDependencyVersions, listEngineExecutables } from '../lib/backendApi'
  import pkg from '../../../../package.json'

  /**
   * @type {{
   *   open?: boolean,
   *   updatesPending?: boolean,
   *   initialSection?: 'notifications' | 'appearance' | 'scene' | 'versions',
   *   onUpdatesResult?: (result: any) => void,
   *   onClose?: () => void
   * }}
   */
  let {
    open = $bindable(false),
    updatesPending = false,
    initialSection = 'notifications',
    onUpdatesResult = () => {},
    onClose = () => {}
  } = $props()

  /** @type {'notifications' | 'appearance' | 'scene' | 'versions'} */
  let section = $state('notifications')

  let versionsLoading = $state(false)
  /** @type {string | null} */
  let versionsError = $state(null)
  /** @type {Awaited<ReturnType<typeof getDependencyVersions>> | null} */
  let versionsData = $state(null)
  /**
   * All discovered MD engine installs (same discovery as Equilibration picker).
   * @type {Array<{
   *   engine: string,
   *   id: string,
   *   label: string,
   *   executable: string,
   *   version?: string|null,
   *   source?: string,
   *   gmxrc?: string|null,
   *   available?: boolean
   * }>}
   */
  let mdEngineCandidates = $state([])

  let updatesChecking = $state(false)
  let updatesUpgrading = $state(false)
  /** @type {string | null} */
  let updatesMessage = $state(null)
  /** @type {string | null} */
  let updatesError = $state(null)
  /** @type {Awaited<ReturnType<NonNullable<typeof window.api>['checkForUpdates']>> | null} */
  let updatesResult = $state(null)

  $effect(() => {
    if (!open) return
    // Sync section only from props when the dialog is open / initialSection changes.
    // Do not read `section` here — that would reset the tab after every click.
    section = initialSection
    if (initialSection === 'versions') loadVersions()
  })

  async function loadVersions() {
    versionsLoading = true
    versionsError = null
    try {
      const [deps, namd, gromacs, openmm] = await Promise.all([
        getDependencyVersions(),
        listEngineExecutables('namd').catch(() => ({ candidates: [] })),
        listEngineExecutables('gromacs').catch(() => ({ candidates: [] })),
        listEngineExecutables('openmm').catch(() => ({ candidates: [] }))
      ])
      versionsData = deps
      /** @type {typeof mdEngineCandidates} */
      const rows = []
      for (const [engine, result] of [
        ['namd', namd],
        ['gromacs', gromacs],
        ['openmm', openmm]
      ]) {
        const list = Array.isArray(result?.candidates) ? result.candidates : []
        if (list.length === 0) {
          rows.push({
            engine,
            id: `${engine}-missing`,
            label: `${toolDisplayName(engine)} (not found)`,
            executable: '',
            version: null,
            source: '',
            gmxrc: null,
            available: false
          })
          continue
        }
        for (const c of list) {
          rows.push({
            engine,
            id: c.id,
            label: c.label,
            executable: c.executable,
            version: c.version ?? null,
            source: c.source ?? '',
            gmxrc: c.gmxrc ?? null,
            available: c.available !== false
          })
        }
      }
      mdEngineCandidates = rows
    } catch (err) {
      versionsData = null
      mdEngineCandidates = []
      versionsError = err instanceof Error ? err.message : 'Failed to load dependency versions'
    } finally {
      versionsLoading = false
    }
  }

  function close() {
    open = false
    onClose()
  }

  /** @param {boolean} checked */
  function onRememberViewerChange(checked) {
    updateAppSettings({ rememberViewerDefaults: checked })
    if (checked) {
      persistViewerSettings()
    } else {
      clearPersistedViewerSettings()
    }
  }

  /** @param {boolean} checked */
  function onJobNotificationsChange(checked) {
    updateAppSettings({ jobNotificationsEnabled: checked })
  }

  /** @param {boolean} checked */
  function onUpdateCheckLaunchChange(checked) {
    updateAppSettings({ updateCheckOnLaunch: checked })
  }

  /** @param {'dark' | 'light'} theme */
  function onThemePick(theme) {
    setPreferredTheme(theme)
  }

  function onScenePersist() {
    persistViewerSettings()
  }

  /** @param {Record<string, import('../lib/backendApi').DependencyInfo>} dependencies */
  function sortedDependencies(dependencies) {
    return Object.entries(dependencies).sort(([aName, aInfo], [bName, bInfo]) => {
      const groupOrder = { core: 0, md: 1, orientation: 2, gui: 3 }
      const aGroup = groupOrder[aInfo.install_group] ?? 9
      const bGroup = groupOrder[bInfo.install_group] ?? 9
      if (aGroup !== bGroup) return aGroup - bGroup
      return aName.localeCompare(bName)
    })
  }

  /** Packages shown here; OpenMM → MD Engines, MemPrO → External tools. */
  const PYTHON_PKG_EXCLUDE = new Set(['openmm', 'mempro'])

  /** @param {Record<string, import('../lib/backendApi').DependencyInfo>} dependencies */
  function pythonPackageRows(dependencies) {
    return sortedDependencies(dependencies).filter(([name]) => !PYTHON_PKG_EXCLUDE.has(name))
  }

  const EXTERNAL_TOOL_ORDER = ['mempro', 'packmol', 'packmol-memgen', 'ambertools']

  /** @param {string} name */
  function toolDisplayName(name) {
    switch (name) {
      case 'namd':
        return 'NAMD'
      case 'gromacs':
        return 'GROMACS'
      case 'openmm':
        return 'OpenMM'
      case 'mempro':
        return 'MemPrO'
      case 'packmol':
        return 'Packmol'
      case 'packmol-memgen':
        return 'packmol-memgen'
      case 'ambertools':
        return 'AmberTools'
      default:
        return name
    }
  }

  /**
   * @param {Array<{ name: string, version?: string|null, path?: string|null, available?: boolean }>|undefined} executables
   * @param {string[]} order
   */
  function orderedToolRows(executables, order) {
    const byName = new Map((executables || []).map((exe) => [exe.name, exe]))
    return order.map((name) => {
      const exe = byName.get(name)
      return {
        name,
        version: exe?.version ?? null,
        path: exe?.path ?? null,
        available: exe?.available ?? false
      }
    })
  }

  /** @param {string | undefined} source */
  function engineSourceLabel(source) {
    switch (source) {
      case 'conda':
        return 'conda'
      case 'path':
        return 'PATH'
      case 'gmxrc':
        return 'GMXRC'
      case 'prefix':
        return 'prefix'
      case 'python':
        return 'Python'
      default:
        return source || '—'
    }
  }

  /** @param {string} group */
  function installGroupLabel(group) {
    switch (group) {
      case 'md':
        return 'MD extra'
      case 'orientation':
        return 'Orientation extra'
      case 'gui':
        return 'GUI'
      default:
        return 'Core'
    }
  }

  async function onCheckForUpdates() {
    if (!window.api?.checkForUpdates) {
      updatesError = 'Update API is not available in this build.'
      return
    }
    updatesChecking = true
    updatesError = null
    updatesMessage = null
    try {
      updatesResult = await window.api.checkForUpdates()
      onUpdatesResult(updatesResult)
      if (updatesResult.error) {
        updatesError = updatesResult.error
        return
      }
      if (!updatesResult.gui.updateAvailable && !updatesResult.gatewizard.updateAvailable) {
        updatesMessage = 'You are up to date.'
      } else {
        const parts = []
        if (updatesResult.gui.updateAvailable) {
          parts.push(`GUI ${updatesResult.remote.gui} available (installed ${updatesResult.local.gui})`)
        }
        if (updatesResult.gatewizard.updateAvailable) {
          parts.push(
            `gatewizard ${updatesResult.remote.gatewizard} available` +
              (updatesResult.local.gatewizard ? ` (installed ${updatesResult.local.gatewizard})` : '')
          )
        }
        updatesMessage = parts.join(' · ')
      }
    } catch (err) {
      updatesResult = null
      updatesError = err instanceof Error ? err.message : 'Failed to check for updates'
    } finally {
      updatesChecking = false
    }
  }

  async function onDownloadGuiUpdate() {
    const url = updatesResult?.gui.downloadUrl || updatesResult?.gui.releasePage || null
    if (!url || !window.api?.openExternalUrl) return
    await window.api.openExternalUrl(url)
  }

  async function onUpgradeGatewizard() {
    if (!window.api?.upgradeGatewizard) return
    updatesUpgrading = true
    updatesError = null
    try {
      const installSpec = updatesResult?.gatewizard.installSpec ?? undefined
      const result = await window.api.upgradeGatewizard(installSpec)
      updatesMessage = result.gatewizardVersion
        ? `gatewizard upgraded to ${result.gatewizardVersion}. Backend restarted.`
        : 'gatewizard upgrade finished. Backend restarted.'
      updatesResult = null
      onUpdatesResult(null)
      await loadVersions()
      await onCheckForUpdates()
    } catch (err) {
      updatesError = err instanceof Error ? err.message : 'Failed to upgrade gatewizard'
    } finally {
      updatesUpgrading = false
    }
  }

  const navItems = [
    { id: 'notifications', label: 'Notifications' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'scene', label: 'Scene defaults' },
    { id: 'versions', label: 'Versions & updates' }
  ]
</script>

{#if open}
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="settings-title"
    tabindex="-1"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    onmousedown={(e) => {
      if (e.target === e.currentTarget) close()
    }}
  >
    <div
      class="mx-4 flex h-[min(720px,90vh)] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-neutral-300 bg-white text-xs dark:border-neutral-700 dark:bg-neutral-900"
    >
      <div class="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
        <h2 id="settings-title" class="text-base font-semibold text-neutral-900 dark:text-neutral-100">
          Settings
        </h2>
        <p class="mt-1 text-neutral-500 dark:text-neutral-500">
          Notifications, appearance, scene startup defaults, and software versions.
        </p>
      </div>

      <div class="flex min-h-0 flex-1 overflow-hidden">
        <nav
          class="flex w-40 shrink-0 flex-col gap-0.5 border-r border-neutral-200 p-2 dark:border-neutral-800"
          aria-label="Settings sections"
        >
          {#each navItems as item (item.id)}
            <button
              type="button"
              class="relative rounded px-2.5 py-2 text-left text-[11px] transition-colors
                {section === item.id
                  ? 'bg-neutral-200 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100'
                  : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800/80'}"
              onclick={() => {
                section = /** @type {typeof section} */ (item.id)
                if (item.id === 'versions' && !versionsData && !versionsLoading) loadVersions()
              }}
            >
              {item.label}
              {#if item.id === 'versions' && updatesPending}
                <span
                  class="absolute top-2 right-2 size-1.5 rounded-full bg-amber-500"
                  aria-hidden="true"
                ></span>
              {/if}
            </button>
          {/each}
        </nav>

        <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {#if section === 'notifications'}
            <section class="space-y-3">
              <h3 class="text-sm font-semibold text-neutral-800 dark:text-neutral-200">Notifications</h3>
              <label class="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  class="mt-0.5"
                  checked={appSettings.jobNotificationsEnabled}
                  onchange={(e) => onJobNotificationsChange(e.currentTarget.checked)}
                />
                <span>
                  <span class="font-medium text-neutral-800 dark:text-neutral-200"
                    >Notify when jobs finish</span
                  >
                  <span class="mt-0.5 block text-neutral-500 dark:text-neutral-400">
                    Show an in-app banner when a job finishes if the window is minimized/unfocused,
                    or if you are on a different sidebar tab than the one that produced the result
                    (for example Analysis finishes while you are on Visualize). System notifications
                    are also attempted when the whole window is away (not reliable under WSL).
                  </span>
                </span>
              </label>
            </section>
          {:else if section === 'appearance'}
            <section class="space-y-3">
              <h3 class="text-sm font-semibold text-neutral-800 dark:text-neutral-200">Appearance</h3>
              <p class="text-neutral-500 dark:text-neutral-400">
                Theme used when the app starts. The sidebar toggle only switches light/dark for the
                current session and does not change this preference.
              </p>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="rounded px-3 py-1.5 text-[11px] transition-colors {themeState.preferred === 'dark'
                    ? 'bg-blue-600 text-white'
                    : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-300'}"
                  onclick={() => onThemePick('dark')}
                >
                  Dark
                </button>
                <button
                  type="button"
                  class="rounded px-3 py-1.5 text-[11px] transition-colors {themeState.preferred === 'light'
                    ? 'bg-blue-600 text-white'
                    : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-300'}"
                  onclick={() => onThemePick('light')}
                >
                  Light
                </button>
              </div>
            </section>
          {:else if section === 'scene'}
            <section class="space-y-4">
              <div>
                <h3 class="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                  Scene defaults
                </h3>
                <p class="mt-1 text-neutral-500 dark:text-neutral-400">
                  These are the startup scene defaults. The Visualize sun panel changes the current
                  session only.
                </p>
              </div>
              <label class="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  class="mt-0.5"
                  checked={appSettings.rememberViewerDefaults}
                  onchange={(e) => onRememberViewerChange(e.currentTarget.checked)}
                />
                <span>
                  <span class="font-medium text-neutral-800 dark:text-neutral-200"
                    >Remember scene defaults</span
                  >
                  <span class="mt-0.5 block text-neutral-500 dark:text-neutral-400">
                    When on, values below are saved and restored on the next launch. When off, each
                    launch starts from factory scene settings.
                  </span>
                </span>
              </label>
              <SceneDefaultsForm
                persistOnChange={appSettings.rememberViewerDefaults}
                onPersist={onScenePersist}
              />
            </section>
          {:else if section === 'versions'}
            <section class="space-y-4">
              <div>
                <h3 class="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                  Versions & updates
                </h3>
                <p class="mt-1 text-neutral-500 dark:text-neutral-400">
                  Record these versions for reproducibility, compatibility checks, or citations.
                </p>
              </div>

              <label class="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  class="mt-0.5"
                  checked={appSettings.updateCheckOnLaunch}
                  onchange={(e) => onUpdateCheckLaunchChange(e.currentTarget.checked)}
                />
                <span>
                  <span class="font-medium text-neutral-800 dark:text-neutral-200"
                    >Check for updates on launch</span
                  >
                  <span class="mt-0.5 block text-neutral-500 dark:text-neutral-400">
                    Quietly compare installed GUI and API versions with the public manifest when the
                    app starts.
                  </span>
                </span>
              </label>

              {#if versionsLoading}
                <div class="flex items-center justify-center gap-2 py-8 text-neutral-500 dark:text-neutral-400">
                  <Spinner />
                  Loading dependency versions...
                </div>
              {:else if versionsError}
                <p class="rounded-md border border-red-700/50 bg-red-950/30 p-3 text-red-300">
                  {versionsError}
                </p>
              {:else if versionsData}
                <div class="space-y-4">
                  <div class="grid grid-cols-2 gap-2 md:grid-cols-3">
                    <div class="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
                      <p class="text-neutral-500">GUI</p>
                      <p class="font-semibold text-neutral-800 dark:text-neutral-200">{pkg.version}</p>
                    </div>
                    {#if versionsData.platform?.python_version}
                      <div class="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
                        <p class="text-neutral-500">Python</p>
                        <p class="font-semibold text-neutral-800 dark:text-neutral-200">
                          {versionsData.platform.python_version}
                        </p>
                      </div>
                    {/if}
                    {#if versionsData.platform?.platform}
                      <div
                        class="rounded-md border border-neutral-200 p-2 md:col-span-1 dark:border-neutral-800"
                      >
                        <p class="text-neutral-500">Platform</p>
                        <p
                          class="truncate font-semibold text-neutral-800 dark:text-neutral-200"
                          title={versionsData.platform.platform}
                        >
                          {versionsData.platform.platform}
                        </p>
                      </div>
                    {/if}
                  </div>

                  <div>
                    <h4 class="mb-2 font-semibold text-neutral-700 dark:text-neutral-300">
                      External Python Packages
                    </h4>
                    <div
                      class="overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800"
                    >
                      <table class="w-full">
                        <thead
                          class="bg-neutral-100 text-neutral-500 dark:bg-neutral-950 dark:text-neutral-500"
                        >
                          <tr>
                            <th class="px-3 py-2 text-left font-medium">Package</th>
                            <th class="px-3 py-2 text-left font-medium">Version</th>
                            <th class="px-3 py-2 text-left font-medium">Install set</th>
                            <th class="px-3 py-2 text-left font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody class="divide-y divide-neutral-200 dark:divide-neutral-800">
                          {#each pythonPackageRows(versionsData.dependencies) as [name, info] (name)}
                            <tr>
                              <td class="px-3 py-2 font-medium text-neutral-800 dark:text-neutral-200"
                                >{name}</td
                              >
                              <td class="px-3 py-2 font-mono text-neutral-600 dark:text-neutral-300">
                                {info.version ?? '—'}
                              </td>
                              <td class="px-3 py-2 text-neutral-400">
                                {installGroupLabel(info.install_group ?? 'core')}
                              </td>
                              <td class="px-3 py-2">
                                {#if info.available}
                                  <span class="text-green-400">installed</span>
                                {:else}
                                  <span class="text-neutral-500">not installed</span>
                                {/if}
                              </td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div>
                    <h4 class="mb-2 font-semibold text-neutral-700 dark:text-neutral-300">
                      External tools
                    </h4>
                    <p class="mb-2 text-neutral-500 dark:text-neutral-400">
                      Orientation and system-building CLIs (MemPrO, Packmol, AmberTools).
                    </p>
                    <div
                      class="overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800"
                    >
                      <table class="w-full">
                        <thead
                          class="bg-neutral-100 text-neutral-500 dark:bg-neutral-950 dark:text-neutral-500"
                        >
                          <tr>
                            <th class="px-3 py-2 text-left font-medium">Tool</th>
                            <th class="px-3 py-2 text-left font-medium">Version</th>
                            <th class="px-3 py-2 text-left font-medium">Path</th>
                          </tr>
                        </thead>
                        <tbody class="divide-y divide-neutral-200 dark:divide-neutral-800">
                          {#each orderedToolRows(versionsData.executables, EXTERNAL_TOOL_ORDER) as tool (tool.name)}
                            <tr>
                              <td
                                class="px-3 py-2 font-medium text-neutral-800 dark:text-neutral-200"
                              >
                                {toolDisplayName(tool.name)}
                              </td>
                              <td class="px-3 py-2 font-mono text-neutral-600 dark:text-neutral-300">
                                {tool.version ?? '—'}
                              </td>
                              <td
                                class="max-w-48 truncate px-3 py-2 text-neutral-500"
                                title={tool.path ?? ''}
                              >
                                {tool.path ?? '—'}
                              </td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div>
                    <h4 class="mb-2 font-semibold text-neutral-700 dark:text-neutral-300">
                      MD Engines
                    </h4>
                    <p class="mb-2 text-neutral-500 dark:text-neutral-400">
                      All NAMD / GROMACS / OpenMM installs found on this machine (same scan as
                      Equilibration).
                    </p>
                    <div
                      class="overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800"
                    >
                      <table class="w-full">
                        <thead
                          class="bg-neutral-100 text-neutral-500 dark:bg-neutral-950 dark:text-neutral-500"
                        >
                          <tr>
                            <th class="px-3 py-2 text-left font-medium">Engine</th>
                            <th class="px-3 py-2 text-left font-medium">Version</th>
                            <th class="px-3 py-2 text-left font-medium">Source</th>
                            <th class="px-3 py-2 text-left font-medium">Path</th>
                          </tr>
                        </thead>
                        <tbody class="divide-y divide-neutral-200 dark:divide-neutral-800">
                          {#each mdEngineCandidates as row (row.id)}
                            <tr>
                              <td
                                class="px-3 py-2 font-medium text-neutral-800 dark:text-neutral-200"
                              >
                                {toolDisplayName(row.engine)}
                              </td>
                              <td class="px-3 py-2 font-mono text-neutral-600 dark:text-neutral-300">
                                {row.version ?? '—'}
                              </td>
                              <td class="px-3 py-2 text-neutral-400">
                                {engineSourceLabel(row.source)}
                              </td>
                              <td
                                class="max-w-56 truncate px-3 py-2 text-neutral-500"
                                title={row.gmxrc
                                  ? `${row.executable || ''} (GMXRC: ${row.gmxrc})`
                                  : row.executable || row.label}
                              >
                                {row.executable || '—'}
                              </td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              {/if}

              <div class="space-y-3 border-t border-neutral-200 pt-3 dark:border-neutral-800">
                {#if updatesMessage}
                  <p
                    class="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-green-800 dark:border-green-800/60 dark:bg-green-950/20 dark:text-green-300"
                  >
                    {updatesMessage}
                  </p>
                {/if}
                {#if updatesError}
                  <p
                    class="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-800 dark:border-red-700/50 dark:bg-red-950/30 dark:text-red-300"
                  >
                    {updatesError}
                  </p>
                {/if}
                <div class="flex flex-wrap gap-2">
                  <Button
                    className="min-w-[8rem] flex-1"
                    disabled={updatesChecking || updatesUpgrading}
                    onclick={onCheckForUpdates}
                  >
                    {#if updatesChecking}
                      <Spinner className="mr-1.5" />
                      Checking...
                    {:else}
                      Check for updates
                    {/if}
                  </Button>
                  {#if updatesResult?.gui.updateAvailable}
                    <Button className="min-w-[8rem] flex-1" variant="outline" onclick={onDownloadGuiUpdate}>
                      Download GUI
                    </Button>
                  {/if}
                  {#if updatesResult?.gatewizard.updateAvailable}
                    <Button
                      className="min-w-[8rem] flex-1"
                      variant="outline"
                      disabled={updatesUpgrading}
                      onclick={onUpgradeGatewizard}
                    >
                      {#if updatesUpgrading}
                        <Spinner className="mr-1.5" />
                        Updating API...
                      {:else}
                        Update API
                      {/if}
                    </Button>
                  {/if}
                </div>
                <p class="text-center text-[10px] text-neutral-600">
                  Compares installed versions with the public update manifest on GitHub.
                </p>
              </div>
            </section>
          {/if}
        </div>
      </div>

      <div class="flex justify-end border-t border-neutral-200 px-5 py-3 dark:border-neutral-800">
        <Button onclick={close}>Close</Button>
      </div>
    </div>
  </div>
{/if}
