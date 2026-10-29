// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { dmarcFailed, emailText, handleInbound, sign, tokenFrom, verifySignature, type EmailConfig } from '../../../server/email';

const config: EmailConfig = { geminiKey: 'g', model: 'gemini-2.5-flash', supabaseUrl: 'https://db.test', supabaseKey: 'anon', inboundSecret: 's3cret', serviceKey: 'service' };
const json = (v: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(v), { status: 200, ...init });
const raw = (from: string, extra = '') =>
  `From: Jordan <${from}>\r\nTo: flights-abc123@windowseat.me\r\nSubject: Fwd: Your United trip\r\nMessage-ID: <m1@mail>\r\nDate: Wed, 21 Oct 2026 10:00:00 +0000\r\n${extra}Content-Type: text/plain; charset=utf-8\r\n\r\nUA 2620 Orlando (MCO) to San Francisco (SFO) Wed 21 Oct 2026 18:59-21:50\r\n`;
const leg = { date: '2026-10-21', from: 'MCO', to: 'SFO', flightNumber: 'UA2620', depTime: '18:59', arrTime: '21:50', arrDayOffset: 0, aircraftType: '', seatNumber: '' };
const gemini = (flights: unknown[]) => json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ flights, warnings: [] }) }] } }] });

/** Routes fake Supabase/Gemini calls by URL. */
function server(opts: { senders?: string[]; account?: string; today?: number; existing?: boolean; flights?: unknown[] } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('email_import_addresses')) return json(url.includes('abc123') ? [{ user_id: 'u1' }] : []);
    if (url.includes('/auth/v1/admin/users/')) return json({ email: opts.account ?? 'jordan@gmail.com' });
    if (url.includes('email_senders')) return json((opts.senders ?? []).map((email) => ({ email })));
    if (url.includes('email_inbox') && url.includes('received_at')) return new Response('[]', { headers: { 'content-range': `0-0/${opts.today ?? 0}` } });
    if (url.includes('email_inbox') && url.includes('message_id=eq')) return json(opts.existing ? [{ id: 'x' }] : []);
    if (url.includes('generateContent')) return gemini(opts.flights ?? [leg]);
    if (url.includes('email_inbox')) return json([{ id: 'new' }], { status: 201 });
    return json({}, { status: 404 });
  });
  return { f, calls };
}
const to = 'flights-abc123@windowseat.me';
const inserted = (calls: { url: string; init?: RequestInit }[]) => JSON.parse(calls.find((c) => c.init?.method === 'POST' && c.url.includes('email_inbox'))!.init!.body as string);
const usedGemini = (calls: { url: string }[]) => calls.some((c) => c.url.includes('generateContent'));

describe('inbound email', () => {
  it('signs and verifies deliveries, refusing stale or altered ones', async () => {
    const now = Date.now();
    const sig = await sign('s3cret', String(now), '{"a":1}');
    expect(await verifySignature('s3cret', String(now), sig, '{"a":1}', now)).toBe(true);
    expect(await verifySignature('s3cret', String(now), sig, '{"a":2}', now)).toBe(false);
    expect(await verifySignature('s3cret', String(now - 10 * 60_000), sig, '{"a":1}', now)).toBe(false);
    expect(await verifySignature('', String(now), sig, '{"a":1}', now)).toBe(false);
  });

  it('reads the token from the address and text from HTML', () => {
    expect(tokenFrom('flights-AbC123@windowseat.me')).toBe('abc123');
    expect(tokenFrom('hello@windowseat.me')).toBeNull();
    expect(emailText('', '<style>x{}</style><p>UA&nbsp;123</p><div>MCO &amp; SFO</div>')).toContain('MCO & SFO');
    expect(dmarcFailed([{ key: 'authentication-results', value: 'mx; dmarc=fail header.from=x.com' }])).toBe(true);
  });

  it('accepts mail from the account email and stores only what was read', async () => {
    const { f, calls } = server();
    expect((await handleInbound({ raw: raw('jordan@gmail.com'), to }, config, f)).outcome).toBe('accepted');
    const row = inserted(calls);
    expect(row).toMatchObject({ user_id: 'u1', status: 'ready', subject: 'Fwd: Your United trip', sender: 'jordan@gmail.com', message_id: '<m1@mail>' });
    expect(row.result.flights[0]).toMatchObject({ from: 'MCO', to: 'SFO' });
    expect(JSON.stringify(row)).not.toContain('Orlando (MCO)'); // never the body
    const prompt = JSON.parse(calls.find((c) => c.url.includes('generateContent'))!.init!.body as string);
    expect(prompt.contents[0].parts[0].text).toContain('UA 2620');
  });

  it('accepts any extra sender the user added, and refuses others', async () => {
    const work = server({ senders: ['me@work.com'] });
    expect((await handleInbound({ raw: raw('me@work.com'), to }, config, work.f)).outcome).toBe('accepted');
    const stranger = server({ senders: ['me@work.com'] });
    expect((await handleInbound({ raw: raw('someone@else.com'), to }, config, stranger.f)).outcome).toBe('sender-not-allowed');
    expect(usedGemini(stranger.calls)).toBe(false);
  });

  it('refuses unknown addresses, forged senders, duplicates and over-limit days before using Gemini', async () => {
    const unknown = server();
    expect((await handleInbound({ raw: raw('jordan@gmail.com'), to: 'flights-zzz999@windowseat.me' }, config, unknown.f)).outcome).toBe('unknown-address');
    const forged = server();
    expect((await handleInbound({ raw: raw('jordan@gmail.com', 'Authentication-Results: mx.cloudflare.net; dmarc=fail\r\n'), to }, config, forged.f)).outcome).toBe('sender-not-allowed');
    const dup = server({ existing: true });
    expect((await handleInbound({ raw: raw('jordan@gmail.com'), to }, config, dup.f)).outcome).toBe('duplicate');
    const busy = server({ today: 30 });
    expect((await handleInbound({ raw: raw('jordan@gmail.com'), to }, config, busy.f)).outcome).toBe('limit');
    for (const s of [unknown, forged, dup, busy]) expect(usedGemini(s.calls)).toBe(false);
  });

  it('stores emails without flights as failed items with the reason', async () => {
    const { f, calls } = server({ flights: [] });
    await handleInbound({ raw: raw('jordan@gmail.com'), to }, config, f);
    const row = inserted(calls);
    expect(row.status).toBe('failed');
    expect(row.error).toBeTruthy();
  });
});
