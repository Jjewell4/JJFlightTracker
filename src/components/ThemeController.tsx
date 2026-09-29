import { useEffect } from 'react';
import { useSettings } from '@/lib/db';

/** Applies the theme setting to <html data-theme> and keeps theme-color in sync. */
export function ThemeController() {
  const { theme } = useSettings();
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg || '#0a0e16');
  }, [theme]);
  return null;
}
