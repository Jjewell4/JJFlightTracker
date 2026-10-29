import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleInbound, verifySignature, type EmailConfig } from '../server/email.js';
import { ImportError } from '../server/screenshot.js';
import { configFromEnv } from './extract-flight.js';

/** Largest delivery accepted (the worker refuses bigger emails first). */
const MAX_BODY = 4_000_000;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new ImportError(413, 'Email is too large.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const clean = (v: string | undefined) => (v ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();

export function emailConfigFromEnv(env: NodeJS.ProcessEnv): EmailConfig {
  return {
    ...configFromEnv(env),
    inboundSecret: clean(env.INBOUND_SHARED_SECRET),
    serviceKey: clean(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY),
  };
}

/**
 * POST from the Cloudflare Email Worker: `{ raw, to, from }`, signed with
 * X-Timestamp + X-Signature (HMAC-SHA256 of "<timestamp>.<body>" with INBOUND_SHARED_SECRET).
 * GET reports whether the server side is configured (names only, never values).
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json');
  const config = emailConfigFromEnv(process.env);
  if (req.method === 'GET') {
    res.end(JSON.stringify({ secret: !!config.inboundSecret, serviceKey: !!config.serviceKey, gemini: !!config.geminiKey, supabase: !!config.supabaseUrl }));
    return;
  }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'Use POST.' }));
    return;
  }
  try {
    const body = await readBody(req);
    const ok = await verifySignature(config.inboundSecret, req.headers['x-timestamp'] as string | undefined, req.headers['x-signature'] as string | undefined, body);
    if (!ok) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: 'Bad signature.' }));
      return;
    }
    const result = await handleInbound(JSON.parse(body), config);
    res.statusCode = 200;
    res.end(JSON.stringify(result));
  } catch (error) {
    const known = error instanceof ImportError;
    res.statusCode = known ? error.status : 500;
    res.end(JSON.stringify({ error: known ? error.message : 'Could not process the email.' }));
  }
}
