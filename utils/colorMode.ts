import { STORAGE_KEYS } from '../types';

export type ColorMode = 'dark' | 'light';

const THEME_COLORS: Record<ColorMode, string> = {
  dark: '#06191e',
  light: '#f4f8f7',
};

export const getStoredColorMode = (): ColorMode | null => {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.COLOR_MODE);
    return stored === 'dark' || stored === 'light' ? stored : null;
  } catch {
    return null;
  }
};

export const getCurrentColorMode = (): ColorMode => {
  const root = document.documentElement;
  if (root.classList.contains('light-mode')) return 'light';
  if (root.classList.contains('dark')) return 'dark';
  return getStoredColorMode() ?? 'dark';
};

export const applyColorMode = (mode: ColorMode, persist = true) => {
  const root = document.documentElement;
  const isDark = mode === 'dark';

  root.classList.toggle('dark', isDark);
  root.classList.toggle('light-mode', !isDark);
  root.dataset.colorMode = mode;
  root.style.colorScheme = mode;

  let themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
  if (!themeMeta) {
    themeMeta = document.createElement('meta');
    themeMeta.name = 'theme-color';
    document.head.appendChild(themeMeta);
  }
  themeMeta.content = THEME_COLORS[mode];

  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEYS.COLOR_MODE, mode);
    } catch {
      // The selected mode remains active for the current session.
    }
  }
};

export const applyDarkMode = (isDark: boolean, persist = true) => {
  applyColorMode(isDark ? 'dark' : 'light', persist);
};
