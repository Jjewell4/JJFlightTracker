import { getSupabase } from '@/services/sync/supabase';
import { parseScreenshotResult, type ScreenshotResult } from './schema';

export type ScreenshotErrorCode = 'setup' | 'auth' | 'quota' | 'image' | 'unreadable' | 'network' | 'busy' | 'unknown';

/** A failure the UI can act on: `setup` means the deployment needs configuring (offer "Check setup"). */
export class ScreenshotError extends Error {
  code: ScreenshotErrorCode;
  constructor(code: ScreenshotErrorCode, message: string) {
    super(message);
    this.name = 'ScreenshotError';
    this.code = code;
  }
}

const SERVER_CODES: ScreenshotErrorCode[] = ['setup', 'auth', 'quota', 'image', 'unreadable', 'busy', 'unknown'];

function codeFromStatus(status: number): ScreenshotErrorCode {
  if (status === 401) return 'auth';
  if (status === 429) return 'quota';
  if (status === 400 || status === 413) return 'image';
  if (status === 422) return 'unreadable';
  if (status === 503) return 'setup';
  if (status === 404 || status === 405) return 'setup';
  return 'unknown';
}

/** Re-encodes any browser-decodable image as a metadata-free JPEG data URL under the upload limit. */
export async function prepareScreenshot(file: File): Promise<string> {
  if (file.type && !file.type.startsWith('image/')) throw new ScreenshotError('image', 'Choose an image (a screenshot or photo of your booking).');
  if (file.size > 15 * 1024 * 1024) throw new ScreenshotError('image', 'Choose an image smaller than 15 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new ScreenshotError('image', /heic|heif/i.test(file.type || file.name) ? 'This browser can’t open HEIC photos. Take a screenshot instead, or share it as JPEG.' : 'This image couldn’t be opened. Try a PNG or JPEG screenshot.');
    }
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 60_000_000) throw new ScreenshotError('image', 'Image dimensions are too large. Crop it to the flight details.');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new ScreenshotError('image', 'This browser could not prepare the screenshot.');
    // Long phone screenshots stay legible at 2400px on the long edge; shrink further only if needed.
    for (const [edge, quality] of [[2400, 0.88], [2000, 0.82], [1600, 0.78]] as const) {
      const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', quality);
      if (data.length <= 2_800_000) return data;
    }
    throw new ScreenshotError('image', 'Image is still too large. Crop it to the flight details.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function accessToken(): Promise<string | null> {
  try {
    const sb = await getSupabase();
    const { data } = await sb.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export async function readScreenshot(dataUrl: string, signal: AbortSignal): Promise<ScreenshotResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ScreenshotError('network', 'Reading screenshots needs a connection. You can still enter and save flights offline.');
  }
  const token = await accessToken();
  if (!token) throw new ScreenshotError('auth', 'Sign in to import a screenshot.');
  signal.throwIfAborted();
  let response: Response;
  try {
    response = await fetch('/api/extract-flight', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mimeType: 'image/jpeg', image: dataUrl.split(',')[1] }),
    });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new ScreenshotError('network', 'Couldn’t reach the server. Check your connection and retry.');
  }
  const body = (await response.json().catch(() => null)) as { error?: unknown; code?: unknown } | null;
  if (!response.ok) {
    const code = SERVER_CODES.includes(body?.code as ScreenshotErrorCode) ? (body!.code as ScreenshotErrorCode) : codeFromStatus(response.status);
    const message =
      typeof body?.error === 'string'
        ? body.error
        : response.status === 404
          ? 'Screenshot import isn’t deployed on this host (no /api/extract-flight function).'
          : 'Screenshot import is unavailable right now. Please try again later.';
    throw new ScreenshotError(code, message);
  }
  try {
    return parseScreenshotResult(body);
  } catch {
    throw new ScreenshotError('unreadable', 'The server returned an unexpected response. Please retry.');
  }
}

export interface ScreenshotSetupCheck {
  id: string;
  label: string;
  ok: boolean | null;
  detail?: string;
}
export interface ScreenshotSetupStatus {
  ready: boolean;
  checks: ScreenshotSetupCheck[];
  model?: string;
}

/** Runs the server's setup diagnostics (config presence, key validity, model, quota SQL). */
export async function checkScreenshotSetup(): Promise<ScreenshotSetupStatus> {
  const token = await accessToken();
  let response: Response;
  try {
    response = await fetch('/api/extract-flight', { method: 'GET', headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch {
    return { ready: false, checks: [{ id: 'network', label: 'Server reachable', ok: false, detail: 'Couldn’t reach the server. Check your connection.' }] };
  }
  const body = (await response.json().catch(() => null)) as ScreenshotSetupStatus | null;
  if (!body || !Array.isArray(body.checks)) {
    return {
      ready: false,
      checks: [
        {
          id: 'function',
          label: 'Screenshot function deployed',
          ok: false,
          detail: response.status === 404 ? 'No /api/extract-flight function on this host. Redeploy from the main branch on Vercel.' : `Unexpected response (${response.status}). Check the function logs in Vercel.`,
        },
      ],
    };
  }
  return {
    ready: !!body.ready,
    model: typeof body.model === 'string' ? body.model : undefined,
    checks: body.checks
      .filter((c) => c && typeof c.label === 'string')
      .map((c) => ({ id: String(c.id), label: c.label, ok: c.ok === true ? true : c.ok === false ? false : null, detail: typeof c.detail === 'string' ? c.detail : undefined })),
  };
}
