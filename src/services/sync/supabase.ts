/**
 * Supabase client + auth + the cloud side of sync.
 *
 * Configured at build time via Vite env vars (set them in Vercel → Settings → Environment
 * Variables, then redeploy):
 *   VITE_SUPABASE_URL       e.g. https://abcd1234.supabase.co
 *   VITE_SUPABASE_ANON_KEY  the project's anon / publishable key (safe to ship; RLS protects data)
 * Without them the app runs local-only and the sync UI explains how to enable it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Flight } from '@/lib/types';
import type { RemoteRow, SyncRemote } from './engine';

const URL_ = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const KEY = ((import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) as string | undefined)?.trim();

export const isCloudConfigured = !!URL_ && !!KEY;

let clientPromise: Promise<SupabaseClient> | null = null;

/** Lazily loads supabase-js (kept out of the main bundle) and creates the client once. */
export function getSupabase(): Promise<SupabaseClient> {
  if (!isCloudConfigured) return Promise.reject(new Error('Cloud sync is not configured'));
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(URL_!, KEY!, {
      auth: {
        // PKCE puts `?code=` in the query string, which doesn't clash with our #/ HashRouter routes.
        flowType: 'pkce',
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
        storageKey: 'flight-log-auth',
      },
    }),
  );
  return clientPromise;
}

/** Where the email link sends you back to: this app's root, without query/hash. */
function redirectUrl(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

export async function signInPassword(email: string, password: string): Promise<void> {
  const sb = await getSupabase();
  const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
}
export async function createPasswordAccount(email: string, password: string): Promise<boolean> {
  const sb = await getSupabase();
  const { data, error } = await sb.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: redirectUrl() } });
  if (error) throw error;
  return !!data.session;
}
export async function requestPasswordReset(email: string): Promise<void> {
  const sb = await getSupabase();
  const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${redirectUrl()}?passwordRecovery=1` });
  if (error) throw error;
}
export async function updatePassword(password: string): Promise<void> {
  const sb = await getSupabase();
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw error;
}

export async function signOutCloud(): Promise<void> {
  const sb = await getSupabase();
  await sb.auth.signOut({ scope: 'local' });
}

/** Removes the `?code=` left in the address bar after an email-link sign-in. */
export function cleanAuthParamsFromUrl(): void {
  const u = new URL(window.location.href);
  let changed = false;
  for (const k of ['code', 'passwordRecovery', 'error', 'error_code', 'error_description']) {
    if (u.searchParams.has(k)) {
      u.searchParams.delete(k);
      changed = true;
    }
  }
  if (changed) window.history.replaceState(window.history.state, '', u.toString());
}

const PAGE = 1000;
const DELETE_CHUNK = 100; // ids go in the URL of the PATCH request

/** Bound a stalled mobile connection so the background controller can retry. */
async function cloudRequest<T>(request: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    return await request(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export function supabaseRemote(sb: SupabaseClient, userId: string): SyncRemote {
  return {
    async pull(since) {
      // Keyset pagination on (server_updated_at, id): rows edited mid-pull move to the end
      // instead of shifting later pages, so none is skipped at a page boundary.
      const out: RemoteRow[] = [];
      let after: RemoteRow | undefined;
      const quote = (v: string) => `"${v.replace(/"/g, '\\"')}"`;
      for (;;) {
        let q = sb
          .from('flights')
          .select('id, data, updated_at, deleted, server_updated_at')
          .eq('user_id', userId)
          .order('server_updated_at', { ascending: true })
          .order('id', { ascending: true })
          .limit(PAGE);
        if (after) {
          const at = quote(after.server_updated_at);
          q = q.or(`server_updated_at.gt.${at},and(server_updated_at.eq.${at},id.gt.${quote(after.id)})`);
        } else if (since) q = q.gt('server_updated_at', since);
        const { data, error } = await cloudRequest((signal) => q.abortSignal(signal));
        if (error) throw error;
        const rows = (data ?? []) as RemoteRow[];
        out.push(...rows);
        if (rows.length < PAGE) break;
        after = rows[rows.length - 1];
      }
      return out;
    },
    async upsert(flights: Flight[]) {
      const rows = flights.map((f) => ({ user_id: userId, id: f.id, data: f, updated_at: f.updatedAt, deleted: false }));
      const { error } = await cloudRequest((signal) => sb.from('flights').upsert(rows, { onConflict: 'user_id,id' }).abortSignal(signal));
      if (error) throw error;
    },
    async markDeleted(ids, at) {
      for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
        const { error } = await cloudRequest((signal) => sb
          .from('flights')
          .update({ deleted: true, updated_at: at })
          .eq('user_id', userId)
          .in('id', ids.slice(i, i + DELETE_CHUNK)).abortSignal(signal));
        if (error) throw error;
      }
    },
  };
}
