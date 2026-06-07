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
  <div class="window-resize-handles pointer-events-none fixed inset-0 z-40" aria-hidden="true">
    <div
      class="resize-handle resize-n"
      style:height="{border}px"
      onmousedown={(e) => onPointerDown('n', e)}
    ></div>
    <div
      class="resize-handle resize-s"
      style:height="{border}px"
      onmousedown={(e) => onPointerDown('s', e)}
    ></div>
    <div
      class="resize-handle resize-w"
      style:width="{border}px"
      onmousedown={(e) => onPointerDown('w', e)}
    ></div>
    <div
      class="resize-handle resize-e"
      style:width="{border}px"
      onmousedown={(e) => onPointerDown('e', e)}
    ></div>
    <div
      class="resize-handle resize-nw"
      style:width="{border}px"
      style:height="{border}px"
      onmousedown={(e) => onPointerDown('nw', e)}
    ></div>
    <div
      class="resize-handle resize-ne"
      style:width="{border}px"
      style:height="{border}px"
      onmousedown={(e) => onPointerDown('ne', e)}
    ></div>
    <div
      class="resize-handle resize-sw"
      style:width="{border}px"
      style:height="{border}px"
      onmousedown={(e) => onPointerDown('sw', e)}
    ></div>
    <div
      class="resize-handle resize-se"
      style:width="{border}px"
      style:height="{border}px"
      onmousedown={(e) => onPointerDown('se', e)}
    ></div>
  </div>
{/if}

<style>
  .resize-handle {
    position: absolute;
    pointer-events: auto;
    -webkit-app-region: no-drag;
    background: transparent;
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
