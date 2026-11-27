(() => {
  let saved;
  let legacy;
  try { legacy = localStorage.getItem('axis.theme.v1'); } catch { /* storage unavailable */ }
  try { saved = JSON.parse(localStorage.getItem('axis.appearance.v1') || 'null'); } catch { /* invalid preference */ }
  const valid = saved && typeof saved === 'object' && !Array.isArray(saved);
  const preference = valid ? saved : { themeMode: legacy };
  const mode = preference.themeMode;
  const light = mode === 'light' || (mode === 'system' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches);
  const prism = preference.uiStyle === 'obsidian-prism';
  const root = document.documentElement.dataset;
  root.theme = light ? 'light' : 'dark';
  root.uiStyle = prism ? 'obsidian-prism' : 'default';
  root.prismPalette = light ? (preference.prismLightPalette === 'alabaster' || (!preference.prismLightPalette && preference.prismPalette === 'alabaster') ? 'alabaster' : 'crystal')
    : (preference.prismDarkPalette === 'warm' || (!preference.prismDarkPalette && preference.prismPalette === 'warm') ? 'warm' : 'obsidian');
  root.prismAccent = ['cobalt', 'iris', 'amber', 'mono'].includes(preference.prismAccent) ? preference.prismAccent : 'default';
  root.motionTier = preference.motionTier === 'focus' ? 'focus' : 'standard';
  if (prism && !/^#\/(?:runtime(?:\/|$)|research-demo$)/.test(location.hash)) root.prismPending = '';
})();
