const KEY = 'axis.theme.v1';

export function readTheme(): 'light' | 'dark' {
  try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; }
  catch { return 'dark'; }
}

export function saveTheme(theme: 'light' | 'dark'): void {
  try { localStorage.setItem(KEY, theme); }
  catch { /* The theme remains active in this tab. */ }
}
