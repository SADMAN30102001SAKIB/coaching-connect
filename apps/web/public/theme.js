(() => {
  let preference = 'system';
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch {
    // Use the device theme when browser storage is unavailable.
  }
  const root = document.documentElement;
  root.dataset.themePreference = preference;
  root.dataset.theme =
    preference === 'system'
      ? matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : preference;
})();
