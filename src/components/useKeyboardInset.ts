import { useEffect, type RefObject } from 'react';

/**
 * While `active`, publishes the on-screen keyboard's height as `--kb` on `target`, so a bottom
 * sheet holding a text field sits above the keyboard as soon as it opens. Android Chrome (and
 * installed PWAs) only shrink the visual viewport when the keyboard opens, which would otherwise
 * leave the field and the sheet's buttons hidden behind it until the page scrolls.
 */
export function useKeyboardInset(active: boolean, target: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const el = target.current;
    if (!active || !vv || !el) return;
    const update = () => {
      const inset = window.innerHeight - vv.height - vv.offsetTop;
      // Ignore small changes (browser toolbars), only a keyboard is this tall.
      el.style.setProperty('--kb', inset > 80 ? `${Math.round(inset)}px` : '0px');
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      el.style.removeProperty('--kb');
    };
  }, [active, target]);
}
