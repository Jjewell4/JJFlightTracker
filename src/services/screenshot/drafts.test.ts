import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { markLegsHandled, resumeDrafts, retryDraft } from './drafts';

const mocks = vi.hoisted(() => ({ readScreenshot: vi.fn() }));
vi.mock('./client', async (importActual) => ({ ...(await importActual<typeof import('./client')>()), readScreenshot: mocks.readScreenshot }));

const leg = { date: '2026-10-21', from: 'MCO', to: 'SFO', flightNumber: '', depTime: '', arrTime: '', arrDayOffset: null, aircraftType: '', seatNumber: '' };
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(async () => {
  mocks.readScreenshot.mockReset();
  await db.drafts.clear();
});

describe('screenshot drafts', () => {
  it('resumes recent interrupted reads and fails old ones', async () => {
    const now = Date.now();
    mocks.readScreenshot.mockResolvedValue({ flights: [leg], warnings: [] });
    await db.drafts.bulkPut([
      { id: 'recent', source: 'screenshot', status: 'reading', createdAt: now - 60_000, updatedAt: now, image: 'data:image/jpeg;base64,AAAA' },
      { id: 'stale', source: 'screenshot', status: 'reading', createdAt: now - 3 * 86_400_000, updatedAt: now, image: 'data:image/jpeg;base64,AAAA' },
    ]);
    await resumeDrafts(now);
    await settle();
    expect(await db.drafts.get('recent')).toMatchObject({ status: 'ready', result: { flights: [leg] } });
    expect((await db.drafts.get('recent'))?.image).toBeUndefined();
    expect(await db.drafts.get('stale')).toMatchObject({ status: 'failed', error: { message: expect.stringContaining('interrupted') } });
    expect(mocks.readScreenshot).toHaveBeenCalledTimes(1);
  });

  it('keeps the image after a failure so it can be retried', async () => {
    mocks.readScreenshot.mockRejectedValueOnce(new Error('Gemini is busy'));
    await db.drafts.put({ id: 'd', source: 'screenshot', status: 'reading', createdAt: Date.now(), updatedAt: Date.now(), image: 'data:image/jpeg;base64,AAAA' });
    await resumeDrafts();
    await settle();
    expect(await db.drafts.get('d')).toMatchObject({ status: 'failed', image: 'data:image/jpeg;base64,AAAA', error: { message: 'Gemini is busy' } });
    mocks.readScreenshot.mockResolvedValueOnce({ flights: [leg], warnings: [] });
    await retryDraft('d');
    expect((await db.drafts.get('d'))?.status).toBe('ready');
  });

  it('removes a draft once every leg is handled', async () => {
    await db.drafts.put({ id: 'd', source: 'screenshot', status: 'ready', createdAt: 1, updatedAt: 1, result: { flights: [leg, leg], warnings: [] } });
    await markLegsHandled('d', [1]);
    expect((await db.drafts.get('d'))?.handled).toEqual([1]);
    await markLegsHandled('d', [0, 1]);
    expect(await db.drafts.get('d')).toBeUndefined();
  });
});
