/**
 * Runs before the app mounts to avoid a light-theme flash (external file — no inline script for CSP).
 */
;(function () {
  try {
    var t = localStorage.getItem('gw_theme')
    if (t !== 'light') document.getElementById('app')?.classList.add('dark')
  } catch {
    document.getElementById('app')?.classList.add('dark')
  }
})()
