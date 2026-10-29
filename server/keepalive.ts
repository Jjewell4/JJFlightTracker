/**
 * Keeps a free Supabase project from pausing after a week without activity. A daily Vercel cron
 * (vercel.json → /api/keepalive) runs one tiny database read; nothing is written or returned.
 */
export interface KeepAliveConfig {
  supabaseUrl: string;
  /** Anon key (fallback): still runs a real query, RLS just returns no rows. */
  supabaseKey: string;
  /** Service-role key, server-only (never sent to browsers). */
  serviceKey: string;
  /** Vercel sends `Authorization: Bearer <CRON_SECRET>` on cron calls when it is set. */
  cronSecret: string;
}

export type KeepAliveResult = { status: number; body: { ok: boolean; error?: string } };

export async function keepAlive(authorization: string | undefined, config: KeepAliveConfig, fetcher: typeof fetch = fetch): Promise<KeepAliveResult> {
  if (config.cronSecret && authorization !== `Bearer ${config.cronSecret}`) return { status: 401, body: { ok: false, error: 'Unauthorized.' } };
  const key = config.serviceKey || config.supabaseKey;
  if (!config.supabaseUrl || !key) return { status: 503, body: { ok: false, error: 'Supabase isn’t configured (SUPABASE_URL and a key).' } };
  try {
    const res = await fetcher(`${config.supabaseUrl}/rest/v1/flights?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? { status: 200, body: { ok: true } } : { status: 502, body: { ok: false, error: `Supabase answered ${res.status}.` } };
  } catch {
    return { status: 502, body: { ok: false, error: 'Supabase didn’t answer.' } };
  }
}
