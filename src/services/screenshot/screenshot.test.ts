import { beforeAll, describe, expect, it, vi } from 'vitest';
import { extractScreenshot, screenshotStatus } from '../../../server/screenshot';
import { parseScreenshotResult } from './schema';
import { screenshotValues } from '@/features/review/draft-legs';
import { installReference } from '@/test/reference-fixture';
beforeAll(installReference);
const config = { geminiKey: 'test-only-secret', model: 'gemini-2.5-flash', supabaseUrl: 'https://test.invalid', supabaseKey: 'test-anon', serviceKey: 'test-service' };
const body = { image: Buffer.from([255,216,255,224,0,0]).toString('base64'), mimeType: 'image/jpeg' };
const auth = 'Bearer test.jwt.token';
const flight = { date: '2026-10-27', from: 'SAN', to: 'LAX', flightNumber: 'UA123', depTime: '08:20', arrTime: '09:30', arrDayOffset: 0, aircraftType: '', seatNumber: '12A' };
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
const provider = (f: unknown = flight) => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ flights: [f], warnings: [] }) }] } }] });
function mockFetch() { return vi.fn<typeof fetch>().mockResolvedValueOnce(json({ id: 'user-1' })).mockResolvedValueOnce(json(true)).mockResolvedValueOnce(json(provider())); }

describe('screenshot server', () => {
  it('reports incomplete setup without making network requests', async () => {
    const f = vi.fn<typeof fetch>();
    await expect(extractScreenshot(body, auth, { ...config, geminiKey: '' }, f)).rejects.toMatchObject({ status: 503, message: expect.stringContaining('GEMINI_API_KEY') });
    expect(f).not.toHaveBeenCalled();
  });
  it('identifies missing Supabase settings without revealing any configured values', async () => {
    const f = vi.fn<typeof fetch>();
    try {
      await extractScreenshot(body, auth, { ...config, supabaseUrl: '', supabaseKey: '' }, f);
      expect.fail('Expected missing configuration');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('SUPABASE_URL');
      expect(message).toContain('SUPABASE_ANON_KEY');
      expect(message).not.toContain(config.geminiKey);
      expect(message).not.toContain('GEMINI_API_KEY');
    }
    expect(f).not.toHaveBeenCalled();
  });
  it('rejects a readable image with no flights rather than creating an empty record', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ id: 'user' })).mockResolvedValueOnce(json(true)).mockResolvedValueOnce(json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"flights":[],"warnings":[]}' }] } }] }));
    await expect(extractScreenshot(body, auth, config, f)).rejects.toMatchObject({ status: 422 });
  });
  it('checks auth and atomic quota before sending the image, returning only allowlisted fields', async () => {
    const f = mockFetch();
    expect((await extractScreenshot(body, auth, config, f)).flights[0]).toEqual(flight);
    expect(f.mock.calls.map(c => String(c[0]))).toEqual([`${config.supabaseUrl}/auth/v1/user`, `${config.supabaseUrl}/rest/v1/rpc/consume_screenshot_import`, expect.stringContaining('generateContent')]);
    const request = JSON.parse(f.mock.calls[2][1]!.body as string);
    expect(request.contents[0].parts[0].inlineData.data).toBe(body.image);
    expect(JSON.stringify(request)).not.toContain(auth);
    expect(f.mock.calls[0][1]?.headers).not.toHaveProperty('x-goog-api-key');
  });
  it('rejects unauthenticated, invalid and oversized uploads before using the provider', async () => {
    const f = vi.fn<typeof fetch>();
    await expect(extractScreenshot(body, undefined, config, f)).rejects.toMatchObject({ status: 401 });
    await expect(extractScreenshot({ ...body, image: 'a'.repeat(2_800_001) }, auth, config, f)).rejects.toMatchObject({ status: 400 });
    await expect(extractScreenshot({ ...body, mimeType: 'image/png' }, auth, config, f)).rejects.toMatchObject({ status: 400 });
    expect(f).not.toHaveBeenCalled();
  });
  it('rejects expired sessions before quota or Gemini', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(json({}, 401));
    await expect(extractScreenshot(body, auth, config, f)).rejects.toMatchObject({ status: 401 });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('fails closed when quotas are exhausted or not installed', async () => {
    for (const response of [json(false), json({}, 404)]) {
      const f = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ id: 'user' })).mockResolvedValueOnce(response);
      await expect(extractScreenshot(body, auth, config, f)).rejects.toBeInstanceOf(Error);
      expect(f).toHaveBeenCalledTimes(2);
    }
  });
  it('does not leak provider error payloads or accept truncated responses', async () => {
    for (const response of [json({ error: 'secret details' }, 403), json({ candidates: [{ finishReason: 'MAX_TOKENS' }] })]) {
      const f = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ id: 'user' })).mockResolvedValueOnce(json(true)).mockResolvedValueOnce(response);
      await expect(extractScreenshot(body, auth, config, f)).rejects.not.toThrow('secret details');
    }
  });
});

describe('screenshot review', () => {
  it('leaves missing/invalid years and times blank and strips unrelated personal fields', () => {
    const output = parseScreenshotResult({ flights: [{ ...flight, date: '2026-02-30', depTime: '29:10', passenger: 'Private name', bookingCode: 'SECRET' }], warnings: [] });
    expect(output.flights[0].date).toBe(''); expect(output.flights[0].depTime).toBe('');
    expect(JSON.stringify(output)).not.toContain('SECRET');
  });
  it('maps known airports and leaves unknown ones empty for manual review', () => {
    expect(screenshotValues(flight)).toMatchObject({ from: 'KSAN', to: 'KLAX', date: '2026-10-27' });
    expect(screenshotValues({ ...flight, date: '', from: 'ZZZ' })).toMatchObject({ date: '', from: '' });
  });
  it('preserves separate flight segments and rejects oversized result lists', () => {
    expect(parseScreenshotResult({ flights: [flight, { ...flight, from: 'LAX', to: 'SAN' }] }).flights).toHaveLength(2);
    expect(() => parseScreenshotResult({ flights: Array(7).fill(flight) })).toThrow();
  });
});

describe('screenshot server diagnostics and resilience', () => {
  const googleErr = (status: number, s: string, reason = '', message = '') => json({ error: { code: status, status: s, message, details: reason ? [{ reason }] : [] } }, status);
  const authOk = () => json({ id: 'user-1' });

  it('falls back to another model when the configured one is unavailable', async () => {
    const f = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(authOk()).mockResolvedValueOnce(json(true))
      .mockResolvedValueOnce(googleErr(404, 'NOT_FOUND'))
      .mockResolvedValueOnce(json(provider()));
    const out = await extractScreenshot(body, auth, { ...config, model: 'gemini-retired' }, f);
    expect(out.flights[0].from).toBe('SAN');
    expect(String(f.mock.calls[2][0])).toContain('gemini-retired');
    expect(String(f.mock.calls[3][0])).toContain('gemini-flash-latest');
  });

  it('explains a rejected key, refunds the attempt and never echoes the provider payload', async () => {
    const f = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(authOk()).mockResolvedValueOnce(json(true))
      .mockResolvedValueOnce(googleErr(400, 'INVALID_ARGUMENT', 'API_KEY_INVALID', 'secret provider text'))
      .mockResolvedValueOnce(json(true));
    await expect(extractScreenshot(body, auth, { ...config, model: 'gemini-x' }, f)).rejects.toMatchObject({ status: 503, code: 'setup', message: expect.stringContaining('GEMINI_API_KEY') });
    expect(String(f.mock.calls[3][0])).toContain('refund_screenshot_import');
    await expect(extractScreenshot(body, auth, config, vi.fn<typeof fetch>().mockResolvedValueOnce(authOk()).mockResolvedValueOnce(json(true)).mockResolvedValueOnce(googleErr(400, 'INVALID_ARGUMENT', 'API_KEY_INVALID', 'secret provider text')))).rejects.not.toThrow('secret provider text');
  });

  it('explains restricted keys (403) without trying other models', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(authOk()).mockResolvedValueOnce(json(true)).mockResolvedValueOnce(googleErr(403, 'PERMISSION_DENIED'));
    await expect(extractScreenshot(body, auth, config, f)).rejects.toMatchObject({ code: 'setup', message: expect.stringContaining('restrictions') });
    expect(f.mock.calls.filter((c) => String(c[0]).includes('generateContent'))).toHaveLength(1);
  });

  it('does not refund when the image itself was unreadable', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(authOk()).mockResolvedValueOnce(json(true)).mockResolvedValueOnce(json({ candidates: [{ finishReason: 'MAX_TOKENS' }] }));
    await expect(extractScreenshot(body, auth, config, f)).rejects.toMatchObject({ status: 422, code: 'unreadable' });
    expect(f.mock.calls.some((c) => String(c[0]).includes('refund'))).toBe(false);
  });

  it('caps thinking so answers are not truncated', async () => {
    const f = mockFetch();
    await extractScreenshot(body, auth, config, f);
    const request = JSON.parse(f.mock.calls[2][1]!.body as string);
    expect(request.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(request.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(8192);
    expect(request.generationConfig.temperature).toBe(0);
  });

  it('keeps Gemini 3 and -latest aliases on low thinking and their default temperature', async () => {
    for (const model of ['gemini-flash-latest', 'gemini-3-flash-preview']) {
      const f = mockFetch();
      await extractScreenshot(body, auth, { ...config, model }, f);
      const request = JSON.parse(f.mock.calls[2][1]!.body as string);
      expect(request.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
      expect(request.generationConfig).not.toHaveProperty('temperature');
    }
  });

  it('gives the rest of the time to a lighter model when the first one times out', async () => {
    const timeout = () => Promise.reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    const f = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(authOk()).mockResolvedValueOnce(json(true))
      .mockImplementationOnce(timeout)
      .mockResolvedValueOnce(json(provider()));
    const out = await extractScreenshot(body, auth, { ...config, model: 'gemini-slow-model' }, f);
    expect(out.flights[0].to).toBe('LAX');
    const models = f.mock.calls.filter((c) => String(c[0]).includes('generateContent')).map((c) => String(c[0]));
    expect(models[0]).toContain('gemini-slow-model');
    expect(models[1]).toContain('lite');
    // A timeout doesn't demote the preferred model for later requests.
    const next = mockFetch();
    await extractScreenshot(body, auth, { ...config, model: 'gemini-slow-model' }, next);
    expect(String(next.mock.calls[2][0])).toContain('gemini-slow-model');
  });

  it('reports a timeout as busy and refunds the attempt when every model runs long', async () => {
    const timeout = () => Promise.reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    const f = vi.fn<typeof fetch>((input) => (String(input).includes('generateContent') ? timeout() : Promise.resolve(json(String(input).includes('/auth/') ? { id: 'u' } : true))));
    await expect(extractScreenshot(body, auth, { ...config, model: 'gemini-timeout-model' }, f)).rejects.toMatchObject({ status: 504, code: 'busy', message: expect.stringContaining('took too long') });
    expect(f.mock.calls.some((c) => String(c[0]).includes('refund_screenshot_import'))).toBe(true);
    // Only the preferred model and the lite fallbacks were tried, not every model.
    const tried = f.mock.calls.filter((c) => String(c[0]).includes('generateContent')).map((c) => String(c[0]));
    expect(tried.slice(1).every((u) => u.includes('lite'))).toBe(true);
  });
});

describe('screenshot setup status', () => {
  it('reports missing configuration without network calls and names misplaced keys', async () => {
    const f = vi.fn<typeof fetch>();
    const status = await screenshotStatus(undefined, { ...config, geminiKey: '', misnamed: ['VITE_GEMINI_API_KEY'] }, f);
    expect(status.ready).toBe(false);
    expect(status.checks.find((c) => c.id === 'gemini_key')).toMatchObject({ ok: false, detail: expect.stringContaining('VITE_GEMINI_API_KEY') });
    expect(JSON.stringify(status)).not.toContain(config.supabaseKey);
    expect(f).not.toHaveBeenCalled();
  });

  it('verifies key, model and quota for a signed-in user', async () => {
    const f = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ id: 'user-1' }))
      .mockResolvedValueOnce(json({ name: 'models/gemini-2.5-flash' }))
      .mockResolvedValueOnce(json([{ day_remaining: 7, month_remaining: 93 }]));
    const status = await screenshotStatus(auth, config, f);
    expect(status).toMatchObject({ ready: true, model: 'gemini-2.5-flash' });
    expect(status.checks.find((c) => c.id === 'quota')?.detail).toContain('7 of 10');
    expect(JSON.stringify(status)).not.toContain(config.geminiKey);
  });

  it('explains a missing key with the deployment and look-alike names, only when signed in', async () => {
    const missing = { ...config, geminiKey: '', keyHints: ['Gemini_Api_Key_2'], deployment: { env: 'production', branch: 'main', commit: 'abc1234' } };
    const anon = await screenshotStatus(undefined, missing, vi.fn<typeof fetch>());
    expect(anon.checks[0].detail).not.toContain('abc1234');
    expect(anon.checks[0].detail).not.toContain('Gemini_Api_Key_2');

    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ id: 'user-1' })).mockResolvedValueOnce(json([{ day_remaining: 10, month_remaining: 100 }]));
    const signedIn = await screenshotStatus(auth, missing, f);
    expect(signedIn.checks.map((c) => c.id)).toEqual(['gemini_key', 'supabase', 'session', 'quota']);
    expect(signedIn.checks[0].detail).toContain('(Production · main · abc1234)');
    expect(signedIn.checks[0].detail).toContain('Found Gemini_Api_Key_2');
  });

  it('points out a Preview deployment and empty values', async () => {
    const f = () => vi.fn<typeof fetch>().mockResolvedValueOnce(json({ id: 'user-1' })).mockResolvedValueOnce(json([{}]));
    const preview = await screenshotStatus(auth, { ...config, geminiKey: '', deployment: { env: 'preview', branch: 'main' } }, f());
    expect(preview.checks[0].detail).toContain('Preview deployment');
    const empty = await screenshotStatus(auth, { ...config, geminiKey: '', keyHints: ['GEMINI_API_KEY (empty)'] }, f());
    expect(empty.checks[0].detail).toContain('GEMINI_API_KEY exists but is empty');
    const stale = await screenshotStatus(auth, { ...config, geminiKey: '', deployment: { env: 'production' } }, f());
    expect(stale.checks[0].detail).toContain('Redeploy');
  });

  it('flags an install that lacks the quota functions', async () => {
    const f = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ id: 'user-1' }))
      .mockResolvedValueOnce(json({ name: 'models/gemini-2.5-flash' }))
      .mockResolvedValueOnce(json({ code: 'PGRST202' }, 404));
    const status = await screenshotStatus(auth, config, f);
    expect(status.ready).toBe(false);
    expect(status.checks.find((c) => c.id === 'quota')).toMatchObject({ ok: false, detail: expect.stringContaining('screenshot-import.sql') });
  });
});

describe('server environment', () => {
  it('accepts common key names and strips pasted whitespace/quotes', async () => {
    const { configFromEnv } = await import('../../../api/extract-flight');
    const c = configFromEnv({ GOOGLE_API_KEY: ' "abc123"\n', SUPABASE_URL: 'https://x.supabase.co/', SUPABASE_ANON_KEY: 'anon', VITE_GEMINI_API_KEY: 'leaked' });
    expect(c).toMatchObject({ geminiKey: 'abc123', supabaseUrl: 'https://x.supabase.co', supabaseKey: 'anon', misnamed: ['VITE_GEMINI_API_KEY'] });
  });

  it('tolerates case/space typos in the key name and reports unusable look-alikes by name only', async () => {
    const { configFromEnv } = await import('../../../api/extract-flight');
    expect(configFromEnv({ 'gemini_api_key ': 'k1' }).geminiKey).toBe('k1');
    expect(configFromEnv({ 'Gemini-API-Key': 'k2' }).geminiKey).toBe('k2');
    const c = configFromEnv({ GEMINI_API_KEY: '  ', GEMINI_APIKEY: 'secret', GEMINI_MODEL: 'x', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'main', VERCEL_GIT_COMMIT_SHA: 'abcdef1234567' });
    expect(c.geminiKey).toBe('');
    expect(c.keyHints).toEqual(['GEMINI_API_KEY (empty)', 'GEMINI_APIKEY']);
    expect(c.deployment).toEqual({ env: 'preview', branch: 'main', commit: 'abcdef1' });
    expect(JSON.stringify(c)).not.toContain('secret');
  });
});
