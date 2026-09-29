/** Per-device entry conveniences (localStorage, failure-tolerant). */
import type { CabinClass, FlightReason } from '@/lib/types';

const DEFAULTS_KEY = 'flightlog.entry.defaults';
const DETAILS_KEY = 'flightlog.entry.detailsOpen';

function read<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / storage blocked */
  }
}

export interface EntryDefaults {
  cabinClass?: CabinClass;
  reason?: FlightReason;
}

export const getEntryDefaults = (): EntryDefaults => read<EntryDefaults>(DEFAULTS_KEY) ?? {};
export const saveEntryDefaults = (d: EntryDefaults) => write(DEFAULTS_KEY, d);
export const getDetailsOpen = (): boolean => read<boolean>(DETAILS_KEY) ?? false;
export const saveDetailsOpen = (open: boolean) => write(DETAILS_KEY, open);
