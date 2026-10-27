/**
 * Runs cloud sync in the background: after sign-in, shortly after local changes, when the
 * app comes back online or to the foreground, and every few minutes while open.
 * UI reads state through `useCloudSync()`.
 */
import { useSyncExternalStore } from 'react';
import { liveQuery } from 'dexie';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { countPendingChanges, getSyncState, resetSyncState, syncOnce, type SyncResult } from './engine';
import { cleanAuthParamsFromUrl, getSupabase, isCloudConfigured, signOutCloud, supabaseRemote } from './supabase';

export interface CloudSyncState {
  phase: 'disabled' | 'loading' | 'signed-out' | 'signed-in';
  email?: string;
  userId?: string;
  status: 'idle' | 'syncing' | 'error' | 'offline';
  lastSyncAt?: number;
  lastResult?: SyncResult;
  error?: string;
  /** Local changes not yet in the cloud. */
  pending: number;
  /** One-off message for the app shell to show (e.g. after an email-link sign-in). */
  notice?: string;
}

let state: CloudSyncState = { phase: isCloudConfigured ? 'loading' : 'disabled', status: 'idle', pending: 0 };
const listeners = new Set<() => void>();
function setState(patch: Partial<CloudSyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useCloudSync(): CloudSyncState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

let client: SupabaseClient | null = null;
let running: Promise<void> | null = null;
let again = false;
let debounce: ReturnType<typeof setTimeout> | undefined;

function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (/relation .*flights.* does not exist|Could not find the table/i.test(msg)) return 'The flights table is missing — run supabase/schema.sql in the Supabase SQL editor.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Couldn’t reach the cloud. Will retry automatically.';
  return msg;
}

/** Sync now (coalesces overlapping requests). Resolves when the run finishes. */
export function syncNow(): Promise<void> {
  if (!client || !state.userId) return Promise.resolve();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setState({ status: 'offline' });
    return Promise.resolve();
  }
  if (running) {
    again = true;
    return running;
  }
  const sb = client;
  const userId = state.userId;
  running = (async () => {
    setState({ status: 'syncing', error: undefined });
    try {
      do {
        again = false;
        const result = await syncOnce(supabaseRemote(sb, userId), userId);
        setState({ lastResult: result, lastSyncAt: result.at });
      } while (again);
      setState({ status: 'idle', pending: await countPendingChanges() });
    } catch (e) {
      console.error('Cloud sync failed', e);
      setState({ status: 'error', error: errorMessage(e) });
    } finally {
      running = null;
    }
  })();
  return running;
}

function scheduleSync(delay = 1500) {
  clearTimeout(debounce);
  debounce = setTimeout(() => void syncNow(), delay);
}

export function clearNotice(): void {
  setState({ notice: undefined });
}

/** True once the stored session has been restored at startup. */
let initialized = false;

async function applySession(session: Session | null, announce = initialized) {
  if (session?.user) {
    const prev = state.userId;
    if (!prev && announce) setState({ notice: `Signed in as ${session.user.email ?? 'your account'} — syncing your flights` });
    const saved = await getSyncState();
    setState({
      phase: 'signed-in',
      email: session.user.email ?? undefined,
      userId: session.user.id,
      lastSyncAt: saved?.userId === session.user.id ? saved.lastSyncAt : undefined,
    });
    if (prev !== session.user.id) scheduleSync(0);
  } else {
    setState({ phase: 'signed-out', email: undefined, userId: undefined, status: 'idle', error: undefined });
  }
}

/** Signs out of the cloud on this device. Flights stay on the device. */
export async function signOut(): Promise<void> {
  await signOutCloud();
  await resetSyncState();
  await applySession(null);
}

let started = false;

/** Starts background sync once per page load. Safe to call repeatedly. */
export function startCloudSync(): void {
  if (started || !isCloudConfigured) return;
  started = true;

  void getSupabase()
    .then(async (sb) => {
      client = sb;
      const fromEmailLink = new URLSearchParams(window.location.search).has('code');
      const { data } = await sb.auth.getSession(); // also completes an email-link sign-in (?code=)
      cleanAuthParamsFromUrl();
      await applySession(data.session, fromEmailLink);
      initialized = true;
      sb.auth.onAuthStateChange((_event, session) => {
        // Don't call Supabase from inside this callback (it can deadlock); defer.
        setTimeout(() => void applySession(session), 0);
      });
    })
    .catch((e) => {
      console.error('Cloud sync init failed', e);
      setState({ phase: 'signed-out', status: 'error', error: errorMessage(e) });
    });

  // Push soon after any local change.
  liveQuery(() => countPendingChanges()).subscribe({
    next: (pending) => {
      setState({ pending });
      if (pending > 0 && state.phase === 'signed-in') scheduleSync();
    },
    error: (e) => console.error(e),
  });

  window.addEventListener('online', () => scheduleSync(500));
  window.addEventListener('offline', () => setState({ status: 'offline' }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync(300);
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow();
  }, 5 * 60 * 1000);
}
