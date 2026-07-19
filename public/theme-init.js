// Applies the saved theme before first paint. Kept as an external classic
// script because the CSP (script-src 'self') forbids inline scripts.
(function () {
  try {
    var stored = localStorage.getItem('velocityDesk.theme') // 'light' | 'dark' | null = system
    var dark = stored === 'dark' || (stored !== 'light' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)
    if (dark) document.documentElement.classList.add('dark')
  } catch (error) { /* storage unavailable (private mode); system default applies */ }
})()
