<script>
  const platform = window.electron?.process?.platform
  // Linux/WSL lacks reliable external resize bands; Windows uses native thickFrame only.
  const enabled = platform === 'linux'
  const border = 8

  /** @param {string} edge @param {MouseEvent} event */
  function onPointerDown(edge, event) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()

    window.electron?.ipcRenderer?.send('window:resize-start', edge)

    const onMove = () => window.electron?.ipcRenderer?.send('window:resize-move')
    const onUp = () => {
      window.electron?.ipcRenderer?.send('window:resize-end')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
</script>

{#if enabled}
  <div class="window-resize-handles pointer-events-none fixed inset-0 z-40">
    <button
      type="button"
      tabindex="-1"
      class="resize-handle resize-n"
      style:height="{border}px"
      aria-label="Resize top edge"
      onmousedown={(e) => onPointerDown('n', e)}
    ></button>
    <button
      type="button"
      tabindex="-1"
      class="resize-handle resize-s"
      style:height="{border}px"
      aria-label="Resize bottom edge"
      onmousedown={(e) => onPointerDown('s', e)}
    ></button>
    <button
      type="button"
      tabindex="-1"
      class="resize-handle resize-w"
      style:width="{border}px"
      aria-label="Resize left edge"
      onmousedown={(e) => onPointerDown('w', e)}
    ></button>
    <button
      type="button"
      tabindex="-1"
      class="resize-handle resize-e"
      style:width="{border}px"
      aria-label="Resize right edge"
      onmousedown={(e) => onPointerDown('e', e)}
    ></button>
    <button
      type="button"
      tabindex="-1"
      class="resize-handle resize-nw"
      style:width="{border}px"
      style:height="{border}px"
      aria-label="Resize top-left corner"
      onmousedown={(e) => onPointerDown('nw', e)}
    ></button>
    <button
      type="button"
      tabindex="-1"
      class="resize-handle resize-ne"
      style:width="{border}px"
      style:height="{border}px"
      aria-label="Resize top-right corner"
      onmousedown={(e) => onPointerDown('ne', e)}
    ></button>
    <button
      type="button"
      tabindex="-1"
      class="resize-handle resize-sw"
      style:width="{border}px"
      style:height="{border}px"
      aria-label="Resize bottom-left corner"
      onmousedown={(e) => onPointerDown('sw', e)}
    ></button>
    <button
      type="button"
      tabindex="-1"
      class="resize-handle resize-se"
      style:width="{border}px"
      style:height="{border}px"
      aria-label="Resize bottom-right corner"
      onmousedown={(e) => onPointerDown('se', e)}
    ></button>
  </div>
{/if}

<style>
  .resize-handle {
    position: absolute;
    pointer-events: auto;
    -webkit-app-region: no-drag;
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
  }

  .resize-handle:focus {
    outline: none;
  }

  .resize-n {
    top: 0;
    left: 0;
    right: 0;
    cursor: ns-resize;
  }

  .resize-s {
    bottom: 0;
    left: 0;
    right: 0;
    cursor: ns-resize;
  }

  .resize-w {
    top: 0;
    bottom: 0;
    left: 0;
    cursor: ew-resize;
  }

  .resize-e {
    top: 0;
    bottom: 0;
    right: 0;
    cursor: ew-resize;
  }

  .resize-nw {
    top: 0;
    left: 0;
    cursor: nwse-resize;
  }

  .resize-ne {
    top: 0;
    right: 0;
    cursor: nesw-resize;
  }

  .resize-sw {
    bottom: 0;
    left: 0;
    cursor: nesw-resize;
  }

  .resize-se {
    bottom: 0;
    right: 0;
    cursor: nwse-resize;
  }
</style>
