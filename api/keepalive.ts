import type { IncomingMessage, ServerResponse } from 'node:http';
import { keepAlive } from '../server/keepalive.js';
import { configFromEnv } from './extract-flight.js';

/** Daily cron (vercel.json): one small Supabase read so the free project never pauses. */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json');
  const { supabaseUrl, supabaseKey } = configFromEnv(process.env);
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim();
  const result = await keepAlive(req.headers.authorization, {
    supabaseUrl,
    supabaseKey,
    serviceKey,
    cronSecret: (process.env.CRON_SECRET ?? '').trim(),
  });
  res.statusCode = result.status;
  res.end(JSON.stringify(result.body));
}
