export type ThemeMode = 'light' | 'dark';

const KEY = 'theme';

function migrate(old: string | null): ThemeMode | null {
  if (old === 'light' || old === 'dark') return old;
  if (old === 'dim') return 'dark';
  if (old === 'cupcake') return 'light';
  return null;
}

export function loadTheme(): ThemeMode {
  try {
    const saved = migrate(localStorage.getItem(KEY));
    if (saved) return saved;
  } catch {
    // ignore
  }
  return 'light';
}

export function applyTheme(mode: ThemeMode) {
  document.documentElement.setAttribute('data-theme', 'kumo');
  document.documentElement.setAttribute('data-mode', mode);
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // ignore
  }
}
