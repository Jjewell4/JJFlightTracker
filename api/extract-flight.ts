import type { IncomingMessage, ServerResponse } from 'node:http';
import { extractScreenshot, ImportError } from '../server/screenshot.js';

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.statusCode = 405; res.end(JSON.stringify({ error: 'Use POST.' })); return;
  }
  try {
    if (Number(req.headers['content-length']) > 2_900_000) throw new ImportError(413, 'Image is too large.');
    const env = process.env;
    const result = await extractScreenshot(req.body, req.headers.authorization, {
      geminiKey: env.GEMINI_API_KEY || '', model: env.GEMINI_MODEL || 'gemini-2.5-flash',
      supabaseUrl: (env.SUPABASE_URL || env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, ''),
      supabaseKey: env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '',
    });
    res.statusCode = 200; res.end(JSON.stringify(result));
  } catch (error) {
    res.statusCode = error instanceof ImportError ? error.status : 503;
    // Do not log request bodies, images, tokens, or provider error payloads.
    res.end(JSON.stringify({ error: error instanceof ImportError ? error.message : 'Screenshot import timed out or could not connect. Please retry.' }));
  }
}
