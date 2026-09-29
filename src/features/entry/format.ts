/** Small display helpers for the entry screen. */
import { getCountry } from '@/data/reference';
import type { Airport } from '@/lib/types';

/** "US" → 🇺🇸 */
export function flagEmoji(country: string | undefined): string {
  if (!country || !/^[A-Za-z]{2}$/.test(country)) return '';
  const base = 0x1f1e6;
  const up = country.toUpperCase();
  return String.fromCodePoint(base + up.charCodeAt(0) - 65, base + up.charCodeAt(1) - 65);
}

/** Short time-zone name at a given local date, e.g. "PDT", "GMT+9". '' when unknown. */
export function tzAbbr(tz: string | undefined, date?: string): string {
  if (!tz) return '';
  try {
    const at = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00Z`) : new Date();
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(at).find((p) => p.type === 'timeZoneName');
    return part?.value ?? '';
  } catch {
    return '';
  }
}

/** "Paris (Roissy-en-France)" → "Paris" */
export function airportCity(a: Airport): string {
  return (a.city || a.name).replace(/\s*\(.*\)\s*/g, ' ').trim();
}

/** "San Diego, CA" / "Paris, France" */
export function airportPlace(a: Airport): string {
  const tail = a.country === 'US' || a.country === 'CA' || a.country === 'AU' ? a.region : (getCountry(a.country)?.name ?? a.country);
  return [airportCity(a), tail].filter(Boolean).join(', ');
}

export function formatDistance(km: number, unit: 'mi' | 'km'): string {
  const v = unit === 'mi' ? km / 1.609344 : km;
  return `${Math.round(v).toLocaleString('en-US')} ${unit}`;
}
