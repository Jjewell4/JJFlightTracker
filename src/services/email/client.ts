/**
 * Email import, app side. Forwarded emails are read on the server into Supabase's email_inbox;
 * here they're pulled into the same device-only drafts as screenshots, so To review, multi-leg
 * saving and "save as a trip" work the same. Finishing one marks the server row done, so it
 * leaves To review on every device.
 */
import { db } from '@/lib/db';
import type { ImportDraft } from '@/lib/types';
import { parseScreenshotResult } from '@/services/screenshot/schema';
import { getSupabase } from '@/services/sync/supabase';

/** Where forwarding addresses live (Cloudflare Email Routing on this domain). */
export const EMAIL_DOMAIN = 'windowseat.me';
export const MAX_SENDERS = 10;

export const forwardingAddress = (token: string) => `flights-${token}@${EMAIL_DOMAIN}`;

/** Thrown when supabase/email-import.sql hasn't been run yet. */
export class EmailSetupError extends Error {}

async function client() {
  const sb = await getSupabase();
  const { data } = await sb.auth.getSession();
  if (!data.session) throw new Error('Sign in to use email import.');
  return { sb, email: data.session.user.email?.toLowerCase() ?? '' };
}

const missingTable = (e: { code?: string; message?: string } | null) => !!e && (e.code === 'PGRST202' || e.code === 'PGRST205' || e.code === '42P01' || /does not exist|schema cache/i.test(e.message ?? ''));

export async function getForwardingAddress(rotate = false): Promise<string> {
  const { sb } = await client();
  const { data, error } = await sb.rpc(rotate ? 'rotate_email_import_address' : 'email_import_address');
  if (missingTable(error)) throw new EmailSetupError('Email import isn’t installed yet. Run supabase/email-import.sql in Supabase.');
  if (error || typeof data !== 'string') throw new Error('Couldn’t load your forwarding address.');
  return forwardingAddress(data);
}

/** The account email (always allowed) and the extra senders the user added. */
export async function listSenders(): Promise<{ account: string; extra: string[] }> {
  const { sb, email } = await client();
  const { data, error } = await sb.from('email_senders').select('email').order('created_at');
  if (missingTable(error)) throw new EmailSetupError('Email import isn’t installed yet. Run supabase/email-import.sql in Supabase.');
  if (error) throw new Error('Couldn’t load your senders.');
  return { account: email, extra: (data ?? []).map((r: { email: string }) => r.email).filter((e: string) => e !== email) };
}

export function normalizeSender(input: string): string | null {
  const e = input.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length <= 254 ? e : null;
}

export async function addSender(input: string): Promise<void> {
  const email = normalizeSender(input);
  if (!email) throw new Error('Enter a valid email address.');
  const { sb } = await client();
  const { error } = await sb.from('email_senders').insert({ email });
  if (error?.code === '23505') return; // already there
  if (error) throw new Error(/row-level security/i.test(error.message) ? `You can add up to ${MAX_SENDERS} addresses.` : 'Couldn’t add that address.');
}

export async function removeSender(email: string): Promise<void> {
  const { sb } = await client();
  const { error } = await sb.from('email_senders').delete().eq('email', email);
  if (error) throw new Error('Couldn’t remove that address.');
}

// ---------- inbox → drafts ----------

const ACKS_KEY = 'emailAcks';

async function pendingAcks(): Promise<Record<string, 'done' | 'dismissed'>> {
  return ((await db.kv.get(ACKS_KEY))?.value as Record<string, 'done' | 'dismissed'>) ?? {};
}

/** Marks a server inbox row finished; retried on the next pull when offline. */
export async function ackEmail(remoteId: string, status: 'done' | 'dismissed'): Promise<void> {
  const acks = { ...(await pendingAcks()), [remoteId]: status };
  await db.kv.put({ key: ACKS_KEY, value: acks });
  await flushAcks().catch(() => undefined);
}

async function flushAcks(): Promise<void> {
  const acks = await pendingAcks();
  if (!Object.keys(acks).length) return;
  const { sb } = await client();
  const left = { ...acks };
  for (const [id, status] of Object.entries(acks)) {
    const { error } = await sb.from('email_inbox').update({ status }).eq('id', id);
    if (!error) delete left[id];
  }
  await db.kv.put({ key: ACKS_KEY, value: left });
}

interface InboxRow {
  id: string;
  received_at: string;
  subject: string | null;
  sender: string | null;
  status: 'ready' | 'failed';
  result: unknown;
  error: string | null;
}

export function rowToDraft(row: InboxRow, now = Date.now()): ImportDraft {
  let result: ImportDraft['result'];
  try {
    result = row.result ? parseScreenshotResult(row.result) : undefined;
  } catch {
    result = undefined;
  }
  const ready = row.status === 'ready' && !!result?.flights.length;
  return {
    id: `email-${row.id}`,
    source: 'email',
    status: ready ? 'ready' : 'failed',
    createdAt: Date.parse(row.received_at) || now,
    updatedAt: now,
    remoteId: row.id,
    subject: row.subject ?? undefined,
    sender: row.sender ?? undefined,
    result,
    handled: [],
    error: ready ? undefined : { code: 'unreadable', message: row.error || 'No flights found in this email.' },
  };
}

/**
 * Brings new forwarded emails into To review and drops ones finished on another device.
 * Silent when signed out, offline or not installed. Resolves with how many arrived.
 */
export async function pullEmailDrafts(): Promise<number> {
  let sb;
  try {
    ({ sb } = await client());
  } catch {
    return 0;
  }
  await flushAcks().catch(() => undefined);
  const { data, error } = await sb.from('email_inbox').select('id,received_at,subject,sender,status,result,error').in('status', ['ready', 'failed']).order('received_at', { ascending: false }).limit(50);
  if (error || !data) return 0;
  const rows = data as InboxRow[];
  const open = new Set(rows.map((r) => r.id));
  const acks = await pendingAcks();
  let added = 0;
  await db.transaction('rw', db.drafts, async () => {
    const local = (await db.drafts.toArray()).filter((d) => d.source === 'email');
    const have = new Set(local.map((d) => d.remoteId));
    for (const d of local) if (d.remoteId && !open.has(d.remoteId)) await db.drafts.delete(d.id);
    for (const row of rows) {
      if (have.has(row.id) || acks[row.id]) continue;
      await db.drafts.put(rowToDraft(row));
      added++;
    }
  });
  return added;
}
