<script>
  import Versions from './components/Versions.svelte'
  import electronLogo from './assets/electron.svg'

  const ipcHandle = () => window.electron.ipcRenderer.send('ping')
</script>

<img
  alt="logo"
  class="mb-5 h-32 w-32 select-none transition-[filter] duration-300 [-webkit-user-drag:none] hover:drop-shadow-[0_0_1.2em_#6988e6aa]"
  src={electronLogo}
/>
<div class="mb-2.5 text-sm font-semibold leading-4 text-ev-text-2">Powered by electron-vite</div>
<div
  class="mx-2.5 py-4 text-center text-[28px] font-bold leading-8 text-ev-text-1 max-[720px]:text-xl"
>
  Build an Electron app with
  <span
    class="bg-[linear-gradient(315deg,#ff3e00_35%,#647eff)] bg-clip-text font-bold text-transparent"
    >Svelte</span
  >
</div>
<p class="text-base font-semibold leading-6 text-ev-text-2 max-[350px]:hidden">
  Please try pressing <code
    class="rounded-sm bg-ev-black-mute px-1.5 py-0.5 font-mono text-[85%] font-semibold">F12</code
  > to open the devTool
</p>
<div class="-m-1.5 flex flex-wrap justify-start pt-8 max-[350px]:hidden">
  <div class="shrink-0 p-1.5">
    <a
      class="inline-block cursor-pointer rounded-full border border-transparent bg-ev-gray-3 px-5 text-center text-sm leading-[38px] font-semibold whitespace-nowrap text-ev-text-1 no-underline hover:bg-ev-gray-2"
      href="https://electron-vite.org/"
      target="_blank"
      rel="noreferrer">Documentation</a
    >
  </div>
  <div class="shrink-0 p-1.5">
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions a11y-missing-attribute-->
    <a
      class="inline-block cursor-pointer rounded-full border border-transparent bg-ev-gray-3 px-5 text-center text-sm leading-[38px] font-semibold whitespace-nowrap text-ev-text-1 no-underline hover:bg-ev-gray-2"
      target="_blank"
      rel="noreferrer"
      on:click={ipcHandle}>Send IPC</a
    >
  </div>
</div>
<Versions />
