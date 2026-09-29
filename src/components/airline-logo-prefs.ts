/**
 * Whether AirlineLogo may load remote logos. A tiny module-level store (instead of a live
 * settings query per logo) because logos render by the hundred in the flights list; a single
 * AirlineLogoPrefs component mirrors the stored setting into it.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSettings } from '@/lib/db';

let showLogos = true;
const listeners = new Set<() => void>();

export function setShowAirlineLogos(v: boolean): void {
  if (v === showLogos) return;
  showLogos = v;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => showLogos;

export function useShowAirlineLogos(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Mount once (next to ThemeController) to keep the store in sync with Settings. */
export function AirlineLogoPrefs(): null {
  const show = useLiveQuery(async () => (await getSettings()).showAirlineLogos !== false, []);
  useEffect(() => {
    if (show !== undefined) setShowAirlineLogos(show);
  }, [show]);
  return null;
}
