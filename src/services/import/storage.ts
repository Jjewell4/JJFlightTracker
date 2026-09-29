/** Small wrappers around the Storage API (all safe to call where it is unavailable). */

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function isStoragePersisted(): Promise<boolean | undefined> {
  try {
    return await navigator.storage?.persisted?.();
  } catch {
    return undefined;
  }
}

export async function getStorageEstimate(): Promise<{ usage: number; quota: number } | undefined> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e && e.quota ? { usage: e.usage ?? 0, quota: e.quota } : undefined;
  } catch {
    return undefined;
  }
}

/** "1.4 MB" / "820 KB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
