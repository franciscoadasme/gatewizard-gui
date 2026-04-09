<script>
  const versions = window.electron.process.versions
</script>

<ul
  class="absolute bottom-[30px] left-1/2 inline-flex -translate-x-1/2 items-center overflow-hidden rounded-[22px] bg-[#202127] px-0 py-[15px] font-mono backdrop-blur-xl max-[620px]:hidden"
>
  <li class="border-r border-ev-gray-1 px-5 py-0 text-sm leading-[14px] opacity-80 last:border-0">
    Electron v{versions.electron}
  </li>
  <li class="border-r border-ev-gray-1 px-5 py-0 text-sm leading-[14px] opacity-80 last:border-0">
    Chromium v{versions.chrome}
  </li>
  <li class="px-5 py-0 text-sm leading-[14px] opacity-80">Node v{versions.node}</li>
</ul>
