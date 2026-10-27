import { getSupabase } from '@/services/sync/supabase';
import { parseScreenshotResult } from './schema';

export async function prepareScreenshot(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG or WebP screenshot.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose an image smaller than 10 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error('Image dimensions are too large. Crop it to the flight details.');
    const scale = Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not prepare the screenshot.');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', 0.88);
    if (data.length > 2_800_000) throw new Error('Image is still too large. Crop it to the flight details.');
    return data;
  } finally { URL.revokeObjectURL(url); }
}

export async function readScreenshot(dataUrl: string, signal: AbortSignal) {
  if (!navigator.onLine) throw new Error('Reading screenshots needs a connection. You can still enter and save flights offline.');
  const sb = await getSupabase();
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('Sign in to import a screenshot.');
  signal.throwIfAborted();
  const response = await fetch('/api/extract-flight', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ mimeType: 'image/jpeg', image: dataUrl.split(',')[1] }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Screenshot import is unavailable on this host. Please try again later.');
  return parseScreenshotResult(body);
}
