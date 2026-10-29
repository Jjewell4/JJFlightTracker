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
    // Some keyboards finish opening without a final resize event: check again as it settles.
    let timers: number[] = [];
    const settle = () => {
      timers.forEach(clearTimeout);
      timers = [100, 300, 600].map((ms) => window.setTimeout(update, ms));
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    el.addEventListener('focusin', settle);
    settle();
    return () => {
      timers.forEach(clearTimeout);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      el.removeEventListener('focusin', settle);
      el.style.removeProperty('--kb');
    };
  }, [active, target]);
}

const TEXT_FIELD = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit]), textarea, select';

/**
 * App-wide: once the keyboard has opened, scrolls the focused text field into view if it ended up
 * behind the keyboard (or a fixed bar). Browsers do this unreliably, notably in installed PWAs.
 */
export function keepFocusedFieldVisible(): () => void {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!vv) return () => {};
  let timer = 0;
  const check = () => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || !el.matches(TEXT_FIELD)) return;
    const r = el.getBoundingClientRect();
    // Client coordinates of what's actually visible (iOS pans the visual viewport).
    if (r.bottom > vv.offsetTop + vv.height - 16 || r.top < vv.offsetTop + 8) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  // After the keyboard (and any sheet riding on it) has settled.
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(check, 350);
  };
  vv.addEventListener('resize', schedule);
  document.addEventListener('focusin', schedule);
  return () => {
    window.clearTimeout(timer);
    vv.removeEventListener('resize', schedule);
    document.removeEventListener('focusin', schedule);
  };
}
