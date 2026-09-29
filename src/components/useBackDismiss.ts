import { useEffect, useRef } from 'react';

// An overlay that was just closed from the UI hands its history entry to one that opens
// in the same tick (e.g. an action menu that opens a confirm sheet), instead of popping it.
let pendingPop: { id: string; timer: ReturnType<typeof setTimeout> } | null = null;

/**
 * Makes the system Back gesture/button close an overlay (sheet, panel) instead of
 * leaving the screen — essential for an installed PWA on Android.
 *
 * While `open`, one extra history entry (same URL) is pushed. Back pops it and calls
 * `onClose`. Closing the overlay any other way removes that entry again. The pushed
 * state copies the router's own state, so the router sees no location change.
 */
export function useBackDismiss(open: boolean, onClose: () => void): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Id of the history entry we own (kept across StrictMode's double effects).
  const owned = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      const id = owned.current;
      owned.current = null;
      // Closed via the UI: drop our entry if it is still the current one.
      if (id && window.history.state?.__overlay === id) {
        if (pendingPop) clearTimeout(pendingPop.timer);
        pendingPop = {
          id,
          timer: setTimeout(() => {
            pendingPop = null;
            if (window.history.state?.__overlay === id) window.history.back();
          }, 0),
        };
      }
      return;
    }
    if (!owned.current) {
      if (pendingPop && window.history.state?.__overlay === pendingPop.id) {
        clearTimeout(pendingPop.timer);
        owned.current = pendingPop.id;
        pendingPop = null;
      } else {
        const id = Math.random().toString(36).slice(2);
        owned.current = id;
        window.history.pushState({ ...(window.history.state ?? {}), __overlay: id }, '');
      }
    }
    const onPop = () => {
      const id = owned.current;
      if (!id || window.history.state?.__overlay === id) return;
      owned.current = null;
      closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [open]);
}

/**
 * Goes back `steps` screens in the app's history (also popping an open overlay's entry),
 * or runs `fallback` when there isn't that much history (e.g. opened from a deep link).
 * Used after deleting/saving so Back never lands on a stale screen.
 */
export function goBackScreens(steps: number, fallback: () => void): void {
  const st = window.history.state as { idx?: number; __overlay?: string } | null;
  if ((st?.idx ?? 0) >= steps) window.history.go(-(steps + (st?.__overlay ? 1 : 0)));
  else fallback();
}
