import { useEffect } from 'react';

/**
 * While `active`, publishes the on-screen keyboard's height as `--entry-kb` on <html>, so a
 * bottom sheet holding a text field can sit above the keyboard. Android Chrome (and installed
 * PWAs) only shrink the visual viewport when the keyboard opens, which would otherwise leave the
 * sheet's buttons hidden behind it.
 */
export function useKeyboardInset(active: boolean): void {
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!active || !vv) return;
    const root = document.documentElement;
    const update = () => {
      const inset = window.innerHeight - vv.height - vv.offsetTop;
      // Ignore small changes (browser toolbars), only a keyboard is this tall.
      root.style.setProperty('--entry-kb', inset > 80 ? `${Math.round(inset)}px` : '0px');
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.removeProperty('--entry-kb');
    };
  }, [active]);
}
