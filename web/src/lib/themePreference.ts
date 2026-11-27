const KEY = 'axis.theme.v1';

export function readTheme(): 'light' | 'dark' {
  return readSavedTheme() ?? 'dark';
}

export function readSavedTheme(): 'light' | 'dark' | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch { return null; }
}

export function saveTheme(theme: 'light' | 'dark'): void {
  try { localStorage.setItem(KEY, theme); }
  catch { /* The theme remains active in this tab. */ }
}
