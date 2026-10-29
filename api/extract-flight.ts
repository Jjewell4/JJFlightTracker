import type { IncomingMessage, ServerResponse } from 'node:http';
import { extractScreenshot, ImportError, screenshotStatus, type ScreenshotConfig } from '../server/screenshot.js';

/** Trims whitespace/newlines and surrounding quotes that often sneak in when pasting secrets. */
function clean(value: string | undefined): string {
  return (value ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();
}

const norm = (name: string) => name.trim().toUpperCase().replace(/[\s-]+/g, '_');

/** First non-empty value among `names`; also matches names that differ only in case, spaces or dashes. */
function first(env: NodeJS.ProcessEnv, names: string[]): string {
  for (const n of names) {
    const v = clean(env[n]);
    if (v) return v;
  }
  const wanted = new Set(names);
  for (const [n, raw] of Object.entries(env)) {
    const v = clean(raw);
    if (v && wanted.has(norm(n))) return v;
  }
  return '';
}

// GEMINI_API_KEY is documented; the others are common names for the same Google AI Studio key.
const KEY_NAMES = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_KEY'];
const BROWSER_KEY_NAMES = ['VITE_GEMINI_API_KEY', 'NEXT_PUBLIC_GEMINI_API_KEY'];

export function configFromEnv(env: NodeJS.ProcessEnv): ScreenshotConfig {
  const geminiKey = first(env, KEY_NAMES);
  const misnamed = BROWSER_KEY_NAMES.filter((n) => clean(env[n]));
  // Variables that look like a Gemini key but weren't usable (typos, empty values). Names only.
  const keyHints = geminiKey
    ? []
    : Object.keys(env)
        .filter((n) => /GEMINI|GENAI|GENERATIVE/.test(norm(n)) && norm(n) !== 'GEMINI_MODEL' && !misnamed.includes(n))
        .map((n) => (clean(env[n]) ? n : `${n} (empty)`))
        .slice(0, 5);
  return {
    geminiKey,
    model: clean(env.GEMINI_MODEL),
    supabaseUrl: first(env, ['SUPABASE_URL', 'VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']).replace(/\/$/, ''),
    supabaseKey: first(env, ['SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']),
    // Never used — reported by name so a browser-exposed key can be renamed.
    misnamed,
    keyHints,
    serviceKey: clean(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY) || undefined,
    // Vercel system variables: which deployment answered, so a stale or Preview build is obvious.
    deployment: {
      env: clean(env.VERCEL_ENV) || undefined,
      branch: clean(env.VERCEL_GIT_COMMIT_REF) || undefined,
      commit: clean(env.VERCEL_GIT_COMMIT_SHA).slice(0, 7) || undefined,
    },
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
