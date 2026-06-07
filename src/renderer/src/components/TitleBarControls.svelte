<script>
  /** @param {string} action */
  function winAction(action) {
    window.electron?.ipcRenderer?.send('win:invoke', action)
  }
</script>

<div class="titlebar-controls flex shrink-0 items-stretch">
  <button
    type="button"
    class="titlebar-btn"
    aria-label="Minimize"
    onclick={() => winAction('min')}
  >
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <rect x="1" y="5.5" width="10" height="1" fill="currentColor" />
    </svg>
  </button>
  <button
    type="button"
    class="titlebar-btn"
    aria-label="Maximize"
    onclick={() => winAction('max')}
  >
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <rect
        x="1.75"
        y="1.75"
        width="8.5"
        height="8.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1"
      />
    </svg>
  </button>
  <button
    type="button"
    class="titlebar-btn titlebar-btn-close"
    aria-label="Close"
    onclick={() => winAction('close')}
  >
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M2.2 2.2 9.8 9.8M9.8 2.2 2.2 9.8"
        stroke="currentColor"
        stroke-width="1.2"
        stroke-linecap="round"
      />
    </svg>
  </button>
</div>

<style>
  .titlebar-controls {
    -webkit-app-region: no-drag;
    align-self: stretch;
  }

  .titlebar-btn {
    display: flex;
    width: 2.875rem;
    height: 100%;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: #a3a3a3;
    cursor: default;
    transition: background-color 0.15s ease, color 0.15s ease;
  }

  .titlebar-btn svg {
    width: 0.75rem;
    height: 0.75rem;
  }

  .titlebar-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #f5f5f5;
    cursor: default;
  }

  .titlebar-btn-close:hover {
    background: #e81123;
    color: #fff;
  }
</style>
