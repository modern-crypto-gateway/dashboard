(function () {
  try {
    var mode = localStorage.getItem('gw:theme') || 'system'
    var accent = localStorage.getItem('gw:accent') || 'blue'
    var isDark =
      mode === 'dark' ||
      (mode === 'system' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches)
    if (isDark) document.documentElement.classList.add('dark')
    document.documentElement.setAttribute('data-accent', accent)
  } catch (e) {}
})()
