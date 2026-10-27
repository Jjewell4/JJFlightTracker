import { beforeAll, describe, expect, it, vi } from 'vitest';
import { extractScreenshot } from '../../../server/screenshot';
import { parseScreenshotResult } from './schema';
import { screenshotValues } from '@/features/entry/ScreenshotImport';
import { installReference } from '@/test/reference-fixture';
beforeAll(installReference);
const config = { geminiKey: 'test-only-secret', model: 'gemini-2.5-flash', supabaseUrl: 'https://test.invalid', supabaseKey: 'test-anon' };
const body = { image: Buffer.from([255,216,255,224,0,0]).toString('base64'), mimeType: 'image/jpeg' };
const auth = 'Bearer test.jwt.token';
const flight = { date: '2026-10-27', from: 'SAN', to: 'LAX', flightNumber: 'UA123', depTime: '08:20', arrTime: '09:30', arrDayOffset: 0, aircraftType: '', seatNumber: '12A' };
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
const provider = (f: unknown = flight) => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ flights: [f], warnings: [] }) }] } }] });
function mockFetch() { return vi.fn<typeof fetch>().mockResolvedValueOnce(json({ id: 'user-1' })).mockResolvedValueOnce(json(true)).mockResolvedValueOnce(json(provider())); }

describe('screenshot server', () => {
  it('reports incomplete setup without making network requests', async () => {
    const f = vi.fn<typeof fetch>();
    await expect(extractScreenshot(body, auth, { ...config, geminiKey: '' }, f)).rejects.toMatchObject({ status: 503 });
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
