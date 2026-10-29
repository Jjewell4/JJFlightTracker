import type { IncomingMessage, ServerResponse } from 'node:http';
import { extractScreenshot, ImportError, screenshotStatus, type ScreenshotConfig } from '../server/screenshot.js';

/** Trims whitespace/newlines and surrounding quotes that often sneak in when pasting secrets. */
function clean(value: string | undefined): string {
  return (value ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();
}

function first(env: NodeJS.ProcessEnv, names: string[]): string {
  for (const n of names) {
    const v = clean(env[n]);
    if (v) return v;
  }
  return '';
}

export function configFromEnv(env: NodeJS.ProcessEnv): ScreenshotConfig {
  return {
    // GEMINI_API_KEY is documented; the others are common names for the same Google AI Studio key.
    geminiKey: first(env, ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_KEY']),
    model: clean(env.GEMINI_MODEL),
    supabaseUrl: first(env, ['SUPABASE_URL', 'VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']).replace(/\/$/, ''),
    supabaseKey: first(env, ['SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']),
    // Never used — reported by name so a browser-exposed key can be renamed.
    misnamed: ['VITE_GEMINI_API_KEY', 'NEXT_PUBLIC_GEMINI_API_KEY'].filter((n) => clean(env[n])),
  };
}

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const config = configFromEnv(process.env);

  if (req.method === 'GET') {
    // Setup diagnostics for the in-app "Check setup" button (names and yes/no only, never values).
    try {
      res.statusCode = 200;
      res.end(JSON.stringify(await screenshotStatus(req.headers.authorization, config)));
    } catch {
      res.statusCode = 503;
      res.end(JSON.stringify({ ready: false, checks: [{ id: 'server', label: 'Server check', ok: false, detail: 'The setup check failed. Retry in a moment.' }] }));
    }
    return;
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'Use POST.' }));
    return;
  }
  try {
    if (Number(req.headers['content-length']) > 2_900_000) throw new ImportError(413, 'Image is too large.');
    const result = await extractScreenshot(req.body, req.headers.authorization, config);
    res.statusCode = 200;
    res.end(JSON.stringify(result));
  } catch (error) {
    const known = error instanceof ImportError;
    res.statusCode = known ? error.status : 503;
    // Do not log request bodies, images, tokens, or provider error payloads.
    res.end(JSON.stringify({
      error: known ? error.message : 'Screenshot import timed out or could not connect. Please retry.',
      code: known ? error.code : 'busy',
    }));
  }
}
