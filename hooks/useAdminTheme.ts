// ═══════════════════════════════════════════════════════════════
// useAdminTheme - Unified Theme Hook for All Pages
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from 'react';
import { AppTheme, STORAGE_KEYS, SystemSettings } from '../types';
import { THEME_CONFIG } from '../components/admin/constants';

export interface ThemeConfig {
  name: string;
  nameEn: string;
  emoji: string;
  gradient: string;
  colors: string[];
  primary_400: string;
  primary_500: string;
  primary_600: string;
  secondary_400: string;
  secondary_500: string;
  secondary_600: string;
}

const parseThemeRgb = (value: string | undefined, fallback: [number, number, number]): [number, number, number] => {
  if (!value) return fallback;

  const parts = value
    .trim()
    .split(/\s+/)
    .map((part) => Number(part));

  if (
    parts.length !== 3 ||
    parts.some((part) => !Number.isFinite(part) || part < 0 || part > 255)
  ) {
    return fallback;
  }

  return [parts[0], parts[1], parts[2]];
};

const getSettingsAdminThemeKey = (settings?: SystemSettings | null) => {
  const key = settings?.admin_theme ?? (settings?.kiosk_settings as any)?.admin_theme;
  return typeof key === 'string' ? key : undefined;
};

const triggerThemeTransition = () => {
  document.body.classList.remove('theme-changing');
  const scheduleFrame = window.requestAnimationFrame || ((callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16));
  scheduleFrame(() => {
    document.body.classList.add('theme-changing');
    window.setTimeout(() => {
      document.body.classList.remove('theme-changing');
    }, 500);
  });
};

export const applyAdminThemeToDOM = (theme: AppTheme, animate = false) => {
  const root = document.documentElement;

  const [p300r, p300g, p300b] = parseThemeRgb(theme.primary_400, [69, 171, 161]);
  const [s300r, s300g, s300b] = parseThemeRgb(theme.secondary_400, [84, 188, 169]);
  const primary300: [number, number, number] = [
    Math.round(p300r * 0.7 + 255 * 0.3),
    Math.round(p300g * 0.7 + 255 * 0.3),
    Math.round(p300b * 0.7 + 255 * 0.3)
  ];
  const primary200: [number, number, number] = [
    Math.round(p300r * 0.45 + 255 * 0.55),
    Math.round(p300g * 0.45 + 255 * 0.55),
    Math.round(p300b * 0.45 + 255 * 0.55)
  ];
  const primary100: [number, number, number] = [
    Math.round(p300r * 0.25 + 255 * 0.75),
    Math.round(p300g * 0.25 + 255 * 0.75),
    Math.round(p300b * 0.25 + 255 * 0.75)
  ];
  const primary50: [number, number, number] = [
    Math.round(p300r * 0.12 + 255 * 0.88),
    Math.round(p300g * 0.12 + 255 * 0.88),
    Math.round(p300b * 0.12 + 255 * 0.88)
  ];
  const secondary300: [number, number, number] = [
    Math.round(s300r * 0.7 + 255 * 0.3),
    Math.round(s300g * 0.7 + 255 * 0.3),
    Math.round(s300b * 0.7 + 255 * 0.3)
  ];
  const secondary200: [number, number, number] = [
    Math.round(s300r * 0.45 + 255 * 0.55),
    Math.round(s300g * 0.45 + 255 * 0.55),
    Math.round(s300b * 0.45 + 255 * 0.55)
  ];
  const secondary100: [number, number, number] = [
    Math.round(s300r * 0.25 + 255 * 0.75),
    Math.round(s300g * 0.25 + 255 * 0.75),
    Math.round(s300b * 0.25 + 255 * 0.75)
  ];
  const secondary50: [number, number, number] = [
    Math.round(s300r * 0.12 + 255 * 0.88),
    Math.round(s300g * 0.12 + 255 * 0.88),
    Math.round(s300b * 0.12 + 255 * 0.88)
  ];

  root.style.setProperty('--color-primary-50', primary50.join(' '));
  root.style.setProperty('--color-primary-100', primary100.join(' '));
  root.style.setProperty('--color-primary-200', primary200.join(' '));
  root.style.setProperty('--color-primary-300', primary300.join(' '));
  root.style.setProperty('--color-primary-400', theme.primary_400 || '69 171 161');
  root.style.setProperty('--color-primary-500', theme.primary_500 || '43 156 146');
  root.style.setProperty('--color-primary-600', theme.primary_600 || '10 85 93');

  root.style.setProperty('--color-secondary-50', secondary50.join(' '));
  root.style.setProperty('--color-secondary-100', secondary100.join(' '));
  root.style.setProperty('--color-secondary-200', secondary200.join(' '));
  root.style.setProperty('--color-secondary-300', secondary300.join(' '));
  root.style.setProperty('--color-secondary-400', theme.secondary_400 || '84 188 169');
  root.style.setProperty('--color-secondary-500', theme.secondary_500 || '19 114 122');
  root.style.setProperty('--color-secondary-600', theme.secondary_600 || '6 47 53');

  const [r, g, b] = parseThemeRgb(theme.primary_500, [43, 156, 146]);
  const [r2, g2, b2] = parseThemeRgb(theme.secondary_500, [19, 114, 122]);
  const [r3, g3, b3] = parseThemeRgb(theme.primary_600, [10, 85, 93]);

  root.style.setProperty('--color-primary-700', `${Math.round(r3 * 0.82)} ${Math.round(g3 * 0.82)} ${Math.round(b3 * 0.82)}`);
  root.style.setProperty('--color-primary-800', `${Math.round(r3 * 0.68)} ${Math.round(g3 * 0.68)} ${Math.round(b3 * 0.68)}`);
  root.style.setProperty('--color-primary-900', `${Math.round(r3 * 0.54)} ${Math.round(g3 * 0.54)} ${Math.round(b3 * 0.54)}`);
  root.style.setProperty('--color-primary-950', `${Math.round(r3 * 0.38)} ${Math.round(g3 * 0.38)} ${Math.round(b3 * 0.38)}`);
  root.style.setProperty('--color-secondary-700', `${Math.round(r2 * 0.82)} ${Math.round(g2 * 0.82)} ${Math.round(b2 * 0.82)}`);
  root.style.setProperty('--color-secondary-800', `${Math.round(r2 * 0.68)} ${Math.round(g2 * 0.68)} ${Math.round(b2 * 0.68)}`);
  root.style.setProperty('--color-secondary-900', `${Math.round(r2 * 0.54)} ${Math.round(g2 * 0.54)} ${Math.round(b2 * 0.54)}`);
  root.style.setProperty('--color-secondary-950', `${Math.round(r2 * 0.38)} ${Math.round(g2 * 0.38)} ${Math.round(b2 * 0.38)}`);
  root.style.setProperty('--primary-rgb', `${r}, ${g}, ${b}`);
  root.style.setProperty('--secondary-rgb', `${r2}, ${g2}, ${b2}`);
  root.style.setProperty('--primary-dark-rgb', `${r3}, ${g3}, ${b3}`);

  root.style.setProperty('--glow-cyan', `rgba(${r}, ${g}, ${b}, 0.24)`);
  root.style.setProperty('--glass-border-hover', `rgba(${r}, ${g}, ${b}, 0.3)`);
  root.style.setProperty('--glass-shadow-glow', `0 20px 46px -34px rgba(${r3}, ${g3}, ${b3}, 0.45)`);
  root.style.setProperty('--input-focus-border', `rgba(${r}, ${g}, ${b}, 0.6)`);
  root.style.setProperty('--glow-blue', `rgba(${r2}, ${g2}, ${b2}, 0.5)`);
  root.style.setProperty('--glow-pink', `rgba(${r2}, ${g2}, ${b2}, 0.5)`);

  root.style.setProperty('--blob-1', `rgba(${r}, ${g}, ${b}, 0.25)`);
  root.style.setProperty('--blob-2', `rgba(${r2}, ${g2}, ${b2}, 0.2)`);
  root.style.setProperty('--blob-3', `rgba(${r3}, ${g3}, ${b3}, 0.15)`);
  root.style.setProperty('--ambient-blob-1', `rgba(${r}, ${g}, ${b}, 0.15)`);
  root.style.setProperty('--ambient-blob-2', `rgba(${r2}, ${g2}, ${b2}, 0.1)`);

  root.style.setProperty('--glass-border', `rgba(${r}, ${g}, ${b}, 0.08)`);
  root.style.setProperty('--neon-border-color', `rgba(${r}, ${g}, ${b}, 0.4)`);
  root.style.setProperty('--neon-glow-color', `rgba(${r}, ${g}, ${b}, 0.3)`);

  root.style.setProperty('--scrollbar-thumb-start', `rgba(${r}, ${g}, ${b}, 0.5)`);
  root.style.setProperty('--scrollbar-thumb-end', `rgba(${r2}, ${g2}, ${b2}, 0.4)`);
  root.style.setProperty('--scrollbar-thumb-hover-start', `rgba(${r}, ${g}, ${b}, 0.7)`);
  root.style.setProperty('--scrollbar-thumb-hover-end', `rgba(${r2}, ${g2}, ${b2}, 0.6)`);
  root.style.setProperty('--selection-bg', `rgba(${r}, ${g}, ${b}, 0.3)`);

  root.style.setProperty('--button-gradient-start', `rgb(${r3}, ${g3}, ${b3})`);
  root.style.setProperty('--button-gradient-end', `rgb(${r}, ${g}, ${b})`);
  root.style.setProperty('--button-shadow', `0 12px 28px -16px rgba(${r3}, ${g3}, ${b3}, 0.7)`);
  root.style.setProperty('--hover-glow', `0 16px 34px -24px rgba(${r}, ${g}, ${b}, 0.6)`);
  root.style.setProperty('--hover-border', `rgba(${r}, ${g}, ${b}, 0.5)`);
  root.style.setProperty('--focus-ring', `rgba(${r}, ${g}, ${b}, 0.5)`);

  root.style.setProperty('--light-blob-1', `rgba(${r}, ${g}, ${b}, 0.18)`);
  root.style.setProperty('--light-blob-2', `rgba(${r2}, ${g2}, ${b2}, 0.16)`);
  root.style.setProperty('--light-blob-3', `rgba(${r3}, ${g3}, ${b3}, 0.12)`);
  root.style.setProperty('--light-scrollbar-track', `rgba(${r}, ${g}, ${b}, 0.08)`);

  root.style.setProperty('--gradient-start', `${r} ${g} ${b}`);
  root.style.setProperty('--gradient-end', `${r2} ${g2} ${b2}`);
  root.style.setProperty('--pulse-glow-start', `0 0 20px rgba(${r}, ${g}, ${b}, 0.3)`);
  root.style.setProperty('--pulse-glow-end', `0 0 40px rgba(${r}, ${g}, ${b}, 0.5)`);
  root.style.setProperty('--glass-card-hover-shadow', `0 0 30px rgba(${r}, ${g}, ${b}, 0.1)`);
  root.style.setProperty('--mini-kiosk-glow-start', `rgba(${r}, ${g}, ${b}, 0.4)`);
  root.style.setProperty('--mini-kiosk-glow-mid', `rgba(${r2}, ${g2}, ${b2}, 0.4)`);
  root.style.setProperty('--mini-kiosk-glow-end', `rgba(${r}, ${g}, ${b}, 0.4)`);

  root.style.setProperty('--theme-tint-r', r.toString());
  root.style.setProperty('--theme-tint-g', g.toString());
  root.style.setProperty('--theme-tint-b', b.toString());

  const bgR = Math.floor(r * 0.05 + 4);
  const bgG = Math.floor(g * 0.09 + 8);
  const bgB = Math.floor(b * 0.1 + 9);
  const bgR2 = Math.floor(r * 0.07 + 8);
  const bgG2 = Math.floor(g * 0.12 + 13);
  const bgB2 = Math.floor(b * 0.13 + 15);

  root.style.setProperty('--bg-app', `rgb(${bgR}, ${bgG}, ${bgB})`);
  root.style.setProperty('--bg-app-secondary', `rgb(${bgR2}, ${bgG2}, ${bgB2})`);
  root.style.setProperty('--glass-bg', `rgba(${bgR2}, ${bgG2}, ${bgB2}, 0.82)`);
  root.style.setProperty('--glass-bg-light', `rgba(${r}, ${g}, ${b}, 0.045)`);

  if (animate) triggerThemeTransition();
};

export const applyAdminThemeKeyToDOM = (themeKey: string, animate = false) => {
  const theme = THEME_CONFIG[themeKey];
  if (!theme) return;

  applyAdminThemeToDOM(theme, animate);
  document.documentElement.style.setProperty('--theme-gradient', theme.gradient);
};

export interface UseAdminThemeReturn {
  selectedTheme: string;
  themeConfig: ThemeConfig;
  setTheme: (themeKey: string) => void;
  THEME_CONFIG: Record<string, ThemeConfig>;
}

/**
 * Unified theme hook that reads and applies admin theme across all pages
 * @param autoApply - Whether to automatically apply theme to DOM (default: true)
 */
export function useAdminTheme(autoApply = true): UseAdminThemeReturn {
  const [selectedTheme, setSelectedTheme] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.ADMIN_THEME);
      return saved && THEME_CONFIG[saved] ? saved : 'default';
    } catch {
      return 'default';
    }
  });

  const themeConfig = THEME_CONFIG[selectedTheme] || THEME_CONFIG.default;

  // Apply theme on mount and when theme changes
  useEffect(() => {
    if (autoApply) {
      applyAdminThemeKeyToDOM(selectedTheme);
    }
  }, [selectedTheme, autoApply]);

  // Listen for theme changes from other pages/tabs
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.ADMIN_THEME && e.newValue) {
        if (THEME_CONFIG[e.newValue]) {
          setSelectedTheme(e.newValue);
        }
      }
    };
    const handleSameTabChange = (event: Event) => {
      const themeKey = (event as CustomEvent<{ themeKey?: string }>).detail?.themeKey;
      if (themeKey && THEME_CONFIG[themeKey]) {
        setSelectedTheme(themeKey);
      }
    };
    const handleSettingsChange = (event: Event) => {
      const themeKey = getSettingsAdminThemeKey((event as CustomEvent<SystemSettings>).detail);
      if (themeKey && THEME_CONFIG[themeKey]) {
        setSelectedTheme(themeKey);
        try {
          localStorage.setItem(STORAGE_KEYS.ADMIN_THEME, themeKey);
          localStorage.removeItem(STORAGE_KEYS.SUPPORT_THEME);
          localStorage.removeItem('hader_current_theme');
        } catch {
          // Ignore localStorage errors
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('hader:admin-theme-change', handleSameTabChange);
    window.addEventListener('hader:settings-updated', handleSettingsChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('hader:admin-theme-change', handleSameTabChange);
      window.removeEventListener('hader:settings-updated', handleSettingsChange);
    };
  }, []);

  const setTheme = useCallback((themeKey: string) => {
    if (THEME_CONFIG[themeKey]) {
      setSelectedTheme(themeKey);
      try {
        localStorage.setItem(STORAGE_KEYS.ADMIN_THEME, themeKey);
        localStorage.removeItem(STORAGE_KEYS.SUPPORT_THEME);
        localStorage.removeItem('hader_current_theme');
      } catch {
        // Ignore localStorage errors
      }

      applyAdminThemeKeyToDOM(themeKey, true);
      window.dispatchEvent(new CustomEvent('hader:admin-theme-change', { detail: { themeKey } }));
    }
  }, []);

  return {
    selectedTheme,
    themeConfig,
    setTheme,
    THEME_CONFIG: THEME_CONFIG as Record<string, ThemeConfig>
  };
}

export default useAdminTheme;
