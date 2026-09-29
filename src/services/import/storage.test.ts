import { afterEach, describe, expect, it, vi } from 'vitest';

describe('requestPersistentStorageOnce', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('asks the browser only once per session', async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal('navigator', { storage: { persist, persisted: async () => false } });
    const { requestPersistentStorageOnce } = await import('./storage');
    expect(await requestPersistentStorageOnce()).toBe(true);
    await requestPersistentStorageOnce();
    expect(persist).toHaveBeenCalledOnce();
  });

  it('is harmless where the Storage API is missing', async () => {
    vi.stubGlobal('navigator', {});
    const { requestPersistentStorageOnce } = await import('./storage');
    expect(await requestPersistentStorageOnce()).toBe(false);
  });
});
