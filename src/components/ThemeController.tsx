import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSettings } from '@/lib/db';

/** Mirrored to localStorage so index.html can apply the theme before first paint. */
export const THEME_KEY = 'flightlog.theme';

function syncThemeColor() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg || '#0a0e16');
}

/**
 * Applies the theme setting to <html data-theme> and keeps the browser/status-bar
 * `theme-color` in sync — including when the OS flips light/dark while the app is open.
 */
export function ThemeController() {
  // undefined until the stored settings load, so we never flash the default theme.
  const theme = useLiveQuery(async () => (await getSettings()).theme, []);
  useEffect(() => {
    if (!theme) return;
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage unavailable — only the pre-paint hint is lost */
    }
    syncThemeColor();
    if (theme !== 'system' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener?.('change', syncThemeColor);
    return () => mq.removeEventListener?.('change', syncThemeColor);
  }, [theme]);
  return null;
}
