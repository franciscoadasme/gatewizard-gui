/**
 * Runs before the app module loads to avoid a light-theme flash (must stay external — no inline script for CSP).
 */
;(function () {
  try {
    var t = localStorage.getItem('gw_theme')
    if (t !== 'light') document.getElementById('app')?.classList.add('dark')
  } catch {
    document.getElementById('app')?.classList.add('dark')
  }
})()
