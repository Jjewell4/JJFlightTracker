import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ syncOnce: vi.fn() }));
vi.mock('dexie', () => ({ liveQuery: () => ({ subscribe: () => ({ unsubscribe() {} }) }) }));
vi.mock('./engine', () => ({
  syncOnce: mocks.syncOnce,
  getSyncState: async () => undefined,
  resetSyncState: async () => {},
  countPendingChanges: async () => 0,
}));
vi.mock('./supabase', () => ({
  isCloudConfigured: true,
  getSupabase: async () => ({ auth: {
    getSession: async () => ({ data: { session: { user: { id: 'test-user' } } } }),
    onAuthStateChange: () => {},
  } }),
  cleanAuthParamsFromUrl: () => {},
  supabaseRemote: () => ({}),
  signOutCloud: async () => {},
}));

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('retries a failed sync automatically with backoff, then stops retrying after success', async () => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.syncOnce
    .mockRejectedValueOnce(new Error('Failed to fetch'))
    .mockRejectedValueOnce(new Error('Failed to fetch'))
    .mockResolvedValue({ at: Date.now(), pushed: 1, pulled: 0, deleted: 0 });
  const { startCloudSync } = await import('./controller');
  startCloudSync();
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.syncOnce).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(mocks.syncOnce).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.syncOnce).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(mocks.syncOnce).toHaveBeenCalledTimes(3);
});
