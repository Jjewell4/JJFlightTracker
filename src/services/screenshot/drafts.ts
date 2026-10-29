/**
 * "To review" drafts for screenshot imports. Choosing a screenshot creates a draft right away and
 * it is read in the background, so the sheet can be closed while Gemini works. Drafts live in
 * IndexedDB on this device only; the prepared image stays there until the flights are read, so a
 * read interrupted by closing the app is retried the next time the app opens.
 */
import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, newId } from '@/lib/db';
import type { ImportDraft } from '@/lib/types';
import { prepareScreenshot, readScreenshot, ScreenshotError } from './client';

/** Client-side ceiling; the server gives Gemini ~50 s inside a 60 s function. */
const READ_TIMEOUT_MS = 65_000;
/** Interrupted reads older than this aren't retried automatically (they'd surprise the user). */
const RESUME_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Most screenshots chosen at once. */
export const MAX_BATCH = 6;

const running = new Map<string, AbortController>();
/** Drafts currently on screen (no "ready" toast for those). */
const watched = new Map<string, number>();

/** Small JPEG preview for the review list (a few KB). */
export async function makeThumbnail(dataUrl: string, edge = 240): Promise<string | undefined> {
  try {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    return undefined;
  }
}

/**
 * Prepares the image, saves a draft and starts reading it. Resolves with the draft id once the
 * draft exists (reading continues in the background); rejects if the image can't be used.
 */
export async function startScreenshotDraft(file: File): Promise<string> {
  const image = await prepareScreenshot(file);
  const now = Date.now();
  const draft: ImportDraft = { id: newId(), source: 'screenshot', status: 'reading', createdAt: now, updatedAt: now, image, thumb: await makeThumbnail(image) };
  await db.drafts.put(draft);
  void runDraft(draft.id);
  return draft.id;
}

/** Reads a draft's image (no-op if it is already being read). */
export async function runDraft(id: string): Promise<void> {
  if (running.has(id)) return;
  const controller = new AbortController();
  running.set(id, controller);
  const timeout = setTimeout(() => controller.abort('timeout'), READ_TIMEOUT_MS);
  try {
    const draft = await db.drafts.get(id);
    if (!draft) return;
    if (!draft.image) {
      await db.drafts.update(id, { status: 'failed', error: { code: 'image', message: 'The screenshot is no longer on this device. Choose it again.' }, updatedAt: Date.now() });
      return;
    }
    if (draft.status !== 'reading') await db.drafts.update(id, { status: 'reading', error: undefined, updatedAt: Date.now() });
    try {
      const result = await readScreenshot(draft.image, controller.signal);
      // The image has done its job; keep only the small preview.
      await db.drafts.update(id, { status: 'ready', result, image: undefined, error: undefined, handled: [], updatedAt: Date.now() });
    } catch (e) {
      if (controller.signal.aborted && controller.signal.reason !== 'timeout') return; // cancelled
      const error =
        controller.signal.reason === 'timeout'
          ? { code: 'busy', message: 'Reading took too long. Try again, or crop the image to the flight details.' }
          : { code: e instanceof ScreenshotError ? e.code : 'unknown', message: e instanceof Error && e.message ? e.message : 'Could not read the screenshot.' };
      await db.drafts.update(id, { status: 'failed', error, updatedAt: Date.now() });
    }
  } finally {
    clearTimeout(timeout);
    running.delete(id);
  }
}

export function isReading(id: string): boolean {
  return running.has(id);
}

export async function retryDraft(id: string): Promise<void> {
  await db.drafts.update(id, { status: 'reading', error: undefined, updatedAt: Date.now() });
  await runDraft(id);
}

/** Stops a read in progress and forgets the draft. */
export async function cancelDraft(id: string): Promise<void> {
  running.get(id)?.abort('cancel');
  await db.drafts.delete(id);
}

export async function dismissDraft(id: string): Promise<void> {
  running.get(id)?.abort('cancel');
  await db.drafts.delete(id);
}

/** Marks legs as saved/skipped; the draft disappears once every leg is handled. */
export async function markLegsHandled(id: string, indexes: number[]): Promise<void> {
  await db.transaction('rw', db.drafts, async () => {
    const draft = await db.drafts.get(id);
    if (!draft) return;
    const handled = [...new Set([...(draft.handled ?? []), ...indexes])].sort((a, b) => a - b);
    if (handled.length >= (draft.result?.flights.length ?? 0)) await db.drafts.delete(id);
    else await db.drafts.update(id, { handled, updatedAt: Date.now() });
  });
}

/**
 * Restarts reads that were interrupted (the app was closed mid-read). Older ones are marked as
 * failed instead, so nothing is sent to Gemini long after the user moved on.
 */
export async function resumeDrafts(now = Date.now()): Promise<void> {
  const stuck = await db.drafts.where('status').equals('reading').toArray();
  for (const d of stuck) {
    if (running.has(d.id)) continue;
    if (now - d.createdAt > RESUME_WINDOW_MS) {
      await db.drafts.update(d.id, { status: 'failed', error: { code: 'busy', message: 'Reading was interrupted. Try again.' }, updatedAt: now });
    } else {
      void runDraft(d.id);
    }
  }
}

export async function clearDrafts(): Promise<void> {
  for (const c of running.values()) c.abort('cancel');
  await db.drafts.clear();
}

/** Newest first. `undefined` while loading. */
export function useDrafts(): ImportDraft[] | undefined {
  return useLiveQuery(() => db.drafts.orderBy('createdAt').reverse().toArray(), []);
}

/**
 * One draft: `undefined` while loading, `null` once it no longer exists. After `id` changes the
 * live query briefly still holds the previous id's answer, so results are matched to their id.
 */
export function useDraft(id: string | null | undefined): ImportDraft | undefined | null {
  const res = useLiveQuery(async () => ({ id, draft: id ? ((await db.drafts.get(id)) ?? null) : null }), [id]);
  if (!res || res.id !== id) return id ? undefined : null;
  return res.draft;
}

/** While `active`, the draft counts as on screen, so finishing it doesn't raise a toast. */
export function useWatchDraft(id: string | null | undefined, active = true): void {
  useEffect(() => {
    if (!id || !active) return;
    watched.set(id, (watched.get(id) ?? 0) + 1);
    return () => {
      const n = (watched.get(id) ?? 1) - 1;
      if (n > 0) watched.set(id, n);
      else watched.delete(id);
    };
  }, [id, active]);
}

export function isWatched(id: string): boolean {
  return watched.has(id);
}

