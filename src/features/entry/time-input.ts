/** Pure helpers for the time picker (typed input, 12h/24h parts, arrival estimate) — unit tested. */
import { getAirport } from '@/data/reference';
import { distanceKm, estimateDurationMin } from '@/lib/geo';
import { isValidTime, todayLocal, tzOffsetMinutes, zonedToUtc } from '@/lib/time';

export type Meridiem = 'am' | 'pm';

const pad = (n: number) => String(n).padStart(2, '0');

/** "HH:mm" from 24h hour + minute. */
export function toTime(h: number, m: number): string {
  return `${pad(h)}:${pad(m)}`;
}

/** { h, m } from "HH:mm" (0/0 when invalid). */
export function splitTime(t: string | undefined): { h: number; m: number } {
  if (!isValidTime(t)) return { h: 0, m: 0 };
  const [h, m] = t.split(':').map(Number);
  return { h, m };
}

/**
 * Reads a typed time: "735p", "7:35 pm", "7.35 p.m.", "1935", "19:35", "19h35", "7", "noon".
 * Returns "HH:mm" or null when it can't be read unambiguously as a time.
 *
 * Without am/pm a 1–12 hour uses `meridiem` when given (the picker's AM/PM toggle), otherwise
 * it is read as a 24-hour time ("7:35" → 07:35). Hours 0 and 13–23, and hours typed with a
 * leading zero ("0735"), are always 24-hour.
 */
export function parseTimeInput(raw: string, opts: { meridiem?: Meridiem } = {}): string | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;
  if (s === 'noon' || s === 'midday') return '12:00';
  if (s === 'midnight') return '00:00';
  const m = /^(\d{1,2})(?:\s?[:.h]\s?(\d{2})|(\d{2}))?\s?(?:([ap])\.?\s?(?:m\.?)?)?$/.exec(s);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2] ?? m[3] ?? 0);
  if (minute > 59) return null;
  const typed = m[4] === 'a' ? 'am' : m[4] === 'p' ? 'pm' : undefined;
  if (typed) {
    if (hour < 1 || hour > 12) return null;
    return toTime((hour % 12) + (typed === 'pm' ? 12 : 0), minute);
  }
  if (hour > 23) return null;
  // "07:35" / "0735" are 24-hour notation: a leading zero never takes the AM/PM toggle.
  if (opts.meridiem && hour >= 1 && hour <= 12 && !m[1].startsWith('0')) return toTime((hour % 12) + (opts.meridiem === 'pm' ? 12 : 0), minute);
  return toTime(hour, minute);
}

/** True when the text names its own am/pm (so a separate AM/PM toggle doesn't apply). */
export function hasMeridiem(raw: string): boolean {
  return /\d\s?[ap]\.?\s?(?:m\.?)?\s*$/i.test(raw.trim()) || /^(noon|midday|midnight)$/i.test(raw.trim());
}

/** True when a typed hour is 1–12, i.e. an AM/PM choice changes its meaning. */
export function needsMeridiem(raw: string): boolean {
  if (hasMeridiem(raw)) return false;
  const m = /^\s*(\d{1,2})(?:\s?[:.h]\s?\d{0,2}|\d{2})?\s*$/.exec(raw);
  if (!m) return true;
  const h = Number(m[1]);
  return h >= 1 && h <= 12 && !m[1].startsWith('0');
}

export interface ArrivalEstimate {
  /** Estimated local arrival time, "HH:mm" (rounded to 5 minutes). */
  time: string;
  /** Local arrival date relative to the departure date. */
  dayOffset: number;
  /** Estimated block time in minutes (same estimate as the route card's "~5h 14m"). */
  durationMin: number;
}

/**
 * Rough local arrival time from the departure time, great-circle distance and both airports'
 * time zones. undefined unless both airports and the departure time are known.
 */
export function estimateArrival(v: { date: string; depTime: string; from: string; to: string }): ArrivalEstimate | undefined {
  const a = getAirport(v.from);
  const b = getAirport(v.to);
  if (!a || !b || a.ident === b.ident || !isValidTime(v.depTime)) return undefined;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(v.date) ? v.date : todayLocal();
  const durationMin = estimateDurationMin(distanceKm(a, b));
  const fromTz = a.tz || b.tz || undefined;
  const toTz = b.tz || a.tz || undefined;
  const step = 5 * 60_000;
  const arrUtc = Math.round((zonedToUtc(date, v.depTime, fromTz) + durationMin * 60_000) / step) * step;
  const local = new Date(arrUtc + (toTz ? tzOffsetMinutes(toTz, new Date(arrUtc)) : 0) * 60_000);
  const dayOffset = Math.round((Date.parse(local.toISOString().slice(0, 10)) - Date.parse(date)) / 86_400_000);
  return { time: toTime(local.getUTCHours(), local.getUTCMinutes()), dayOffset, durationMin };
}
