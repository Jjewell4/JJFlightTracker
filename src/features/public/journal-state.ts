/**
 * View state of a public journal, deep-linkable through the page's own query string:
 * `/<handle>?view=map`, `/<handle>?view=stats&year=2019`, `/<handle>?view=flights&airport=KSAN`.
 *
 * Public journals live outside the app's HashRouter (the Vercel `/:slug` rewrite serves
 * index.html), so the query string never clashes with `#/…` app routes. The owner's
 * in-app preview keeps the same state in memory instead of touching the Settings URL.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ViewParams } from '@/lib/flight-source';

export const JOURNAL_VIEWS = ['overview', 'map', 'stats', 'trips', 'flights'] as const;
export type JournalView = (typeof JOURNAL_VIEWS)[number];

export function parseView(raw: string | null): JournalView {
  return (JOURNAL_VIEWS as readonly string[]).includes(raw ?? '') ? (raw as JournalView) : 'overview';
}

export type ParamPatch = Record<string, string | null>;

export interface JournalParams extends ViewParams {
  /** Applies several changes at once; `push` adds a history entry (view changes). */
  update(patch: ParamPatch, mode?: 'push' | 'replace'): void;
}

export function applyPatch(search: string, patch: ParamPatch): string {
  const next = new URLSearchParams(search);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
  }
  const str = next.toString();
  return str ? `?${str}` : '';
}

export function useJournalParams(syncUrl: boolean): JournalParams {
  const [search, setSearch] = useState(() => (syncUrl ? window.location.search : ''));
  const current = useRef(search);
  current.current = search;

  useEffect(() => {
    if (!syncUrl) return;
    const onPop = () => setSearch(window.location.search);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [syncUrl]);

  const update = useCallback(
    (patch: ParamPatch, mode: 'push' | 'replace' = 'replace') => {
      const next = applyPatch(current.current, patch);
      if (next === current.current) return;
      current.current = next;
      if (syncUrl) {
        const url = `${window.location.pathname}${next}${window.location.hash}`;
        if (mode === 'push') window.history.pushState(null, '', url);
        else window.history.replaceState(window.history.state, '', url);
      }
      setSearch(next);
    },
    [syncUrl],
  );

  return useMemo(() => {
    const params = new URLSearchParams(search);
    return {
      get: (key: string) => params.get(key),
      set: (key: string, value: string | null) => update({ [key]: value }),
      update,
    };
  }, [search, update]);
}
