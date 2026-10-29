// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { keepAlive, type KeepAliveConfig } from '../../../server/keepalive';

const config: KeepAliveConfig = { supabaseUrl: 'https://db.test', supabaseKey: 'anon', serviceKey: 'service', cronSecret: 'c' };

describe('supabase keep-alive', () => {
  it('runs one small read with the server key', async () => {
    const f = vi.fn<typeof fetch>(async () => new Response('[]'));
    expect(await keepAlive('Bearer c', config, f)).toEqual({ status: 200, body: { ok: true } });
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe('https://db.test/rest/v1/flights?select=id&limit=1');
    expect((init?.headers as Record<string, string>).apikey).toBe('service');
  });

  it('refuses calls without the cron secret, and reports a missing setup or a failed read', async () => {
    const f = vi.fn<typeof fetch>(async () => new Response('[]'));
    expect((await keepAlive('Bearer nope', config, f)).status).toBe(401);
    expect(f).not.toHaveBeenCalled();
    expect((await keepAlive(undefined, { ...config, cronSecret: '', supabaseUrl: '' }, f)).status).toBe(503);
    expect((await keepAlive(undefined, { ...config, cronSecret: '' }, async () => new Response('', { status: 500 }))).status).toBe(502);
    expect((await keepAlive(undefined, { ...config, cronSecret: '' }, async () => Promise.reject(new Error('down')))).status).toBe(502);
  });
});
