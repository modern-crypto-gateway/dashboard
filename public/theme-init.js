(function () {
  try {
    var mode = localStorage.getItem('gw:theme') || 'system'
    var stored = localStorage.getItem('gw:accent')
    var accent = stored === 'violet' || stored === 'iris' ? 'iris' : stored === 'blue' ? 'blue' : 'lime'
    var isDark =
      mode === 'dark' ||
      (mode === 'system' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches)
    if (isDark) document.documentElement.classList.add('dark')
    document.documentElement.setAttribute('data-accent', accent)
  } catch (e) {}
})()
