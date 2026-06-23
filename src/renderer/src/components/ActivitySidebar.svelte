<script>
  import Cauldron from './icons/Cauldron.svelte'
  import CrystalBall from './icons/CrystalBall.svelte'
  import Eye from './icons/Eye.svelte'
  import Grimoire from './icons/Grimoire.svelte'
  import MagicWand from './icons/MagicWand.svelte'
  import Hourglass from './icons/Hourglass.svelte'
  import ThemeToggle from './ThemeToggle.svelte'

  /** @type {{ id: string, label: string }[], currentId?: string, onNavigate?: (id: string) => void, onVersions?: () => void }} */
  let { stages = [], currentId = '', onNavigate = (_id) => {}, onVersions = () => {} } = $props()

  /** @type {Record<string, typeof Eye>} */
  const STAGE_ICONS = {
    visualize: Eye,
    preparation: Cauldron,
    builder: MagicWand,
    equilibration: Hourglass,
    analysis: CrystalBall
  }

  /**
   * @param {MouseEvent} e
   * @param {string} id
   */
  function handleNav(e, id) {
    e.preventDefault()
    onNavigate(id)
  }
</script>

<aside
  class="activity-bar flex w-14 shrink-0 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"
  aria-label="Application stages"
>
  <nav class="flex flex-1 flex-col items-center gap-0.5 py-2">
    {#each stages as stage (stage.id)}
      {@const Icon = STAGE_ICONS[stage.id] ?? Eye}
      {@const active = currentId === stage.id}
      <a
        href="#{stage.id}"
        class="activity-item group relative flex size-12 items-center justify-center rounded-md text-neutral-500 no-underline transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200
          {active ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100' : ''}"
        aria-current={active ? 'page' : undefined}
        aria-label={stage.label}
        onclick={(e) => handleNav(e, stage.id)}
      >
        {#if active}
          <span
            class="absolute top-1/2 left-0 h-6 w-0.5 -translate-y-1/2 rounded-r bg-neutral-800 dark:bg-neutral-100"
            aria-hidden="true"
          ></span>
        {/if}
        <Icon className="size-8" />
        <span class="activity-tooltip" role="tooltip">{stage.label}</span>
      </a>
    {/each}
  </nav>

  <div class="flex flex-col items-center gap-2 border-t border-neutral-200 py-2 dark:border-neutral-800">
    <ThemeToggle />
    <button
      type="button"
      class="activity-item group relative flex size-12 items-center justify-center rounded-md border-0 bg-transparent text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
      aria-label="Dependency versions"
      onclick={onVersions}
    >
      <Grimoire className="size-8" />
      <span class="activity-tooltip" role="tooltip">Dependency versions</span>
    </button>
  </div>
</aside>

<style>
  .activity-item:hover .activity-tooltip,
  .activity-item:focus-visible .activity-tooltip {
    opacity: 1;
    visibility: visible;
  }

  .activity-tooltip {
    position: absolute;
    left: calc(100% + 10px);
    top: 50%;
    z-index: 60;
    transform: translateY(-50%);
    white-space: nowrap;
    border-radius: 0.375rem;
    border: 1px solid rgb(229 229 229);
    background: rgb(255 255 255);
    padding: 0.25rem 0.625rem;
    font-size: 0.75rem;
    line-height: 1rem;
    color: rgb(23 23 23);
    pointer-events: none;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.12s ease;
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.12);
  }

  :global(.dark) .activity-tooltip {
    border-color: rgb(64 64 64);
    background: rgb(23 23 23);
    color: rgb(245 245 245);
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.35);
  }

  .activity-tooltip::before {
    content: '';
    position: absolute;
    right: 100%;
    top: 50%;
    transform: translateY(-50%);
    border: 5px solid transparent;
    border-right-color: rgb(229 229 229);
  }

  :global(.dark) .activity-tooltip::before {
    border-right-color: rgb(64 64 64);
  }
</style>
