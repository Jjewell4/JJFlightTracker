/** Time-zone aware date/time helpers built on Intl (no dependencies). */

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

/** Offset of `tz` from UTC in minutes at the given instant (e.g. -420 for PDT). */
export function tzOffsetMinutes(tz: string, at: Date): number {
  try {
    const parts = Object.fromEntries(dtf(tz).formatToParts(at).map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
    return Math.round((asUtc - at.getTime()) / 60000);
  } catch {
    return 0;
  }
}

/** Converts a wall-clock time in `tz` to a UTC epoch (ms). date: YYYY-MM-DD, time: HH:mm. */
export function zonedToUtc(date: string, time: string, tz: string | undefined): number {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  if (!tz) return naive;
  // Two passes handle DST transitions correctly.
  let offset = tzOffsetMinutes(tz, new Date(naive));
  let utc = naive - offset * 60000;
  const offset2 = tzOffsetMinutes(tz, new Date(utc));
  if (offset2 !== offset) {
    offset = offset2;
    utc = naive - offset * 60000;
  }
  return utc;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function isValidTime(t: string | undefined): t is string {
  return !!t && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

/**
 * Duration in minutes between local departure and local arrival, accounting for time zones.
 * If arrDayOffset is undefined, infers the smallest non-negative offset (0 or +1 day).
 */
export function computeDuration(opts: {
  date: string;
  depTime?: string;
  arrTime?: string;
  arrDayOffset?: number;
  fromTz?: string;
  toTz?: string;
}): { durationMin: number; arrDayOffset: number } | undefined {
  const { date, depTime, arrTime, fromTz, toTz } = opts;
  if (!isValidTime(depTime) || !isValidTime(arrTime) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const dep = zonedToUtc(date, depTime, fromTz);
  const tryOffset = (off: number) => (zonedToUtc(addDays(date, off), arrTime, toTz) - dep) / 60000;
  if (opts.arrDayOffset !== undefined) {
    const dur = tryOffset(opts.arrDayOffset);
    return dur > 0 ? { durationMin: Math.round(dur), arrDayOffset: opts.arrDayOffset } : undefined;
  }
  for (const off of [0, 1, -1, 2]) {
    const dur = tryOffset(off);
    if (dur > 0 && dur < 24 * 60) return { durationMin: Math.round(dur), arrDayOffset: off };
  }
  return undefined;
}

/** "5h 20m" / "45m". */
export function formatDuration(min: number | undefined): string {
  if (min === undefined || !Number.isFinite(min)) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m}m`;
}

/** Formats "HH:mm" as 12h ("5:20 PM") or 24h ("17:20"). */
export function formatTime(t: string | undefined, clock: '12h' | '24h' = '12h'): string {
  if (!isValidTime(t)) return '';
  if (clock === '24h') return t;
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${suffix}`;
}

/** Formats a flight date honoring precision: "Mar 4, 2024" / "Mar 2024" / "2024". */
export function formatFlightDate(date: string, precision: 'day' | 'month' | 'year' = 'day', style: 'short' | 'long' = 'short'): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  if (precision === 'year') return String(y);
  if (precision === 'month') return dt.toLocaleDateString('en-US', { month: style === 'long' ? 'long' : 'short', year: 'numeric', timeZone: 'UTC' });
  return dt.toLocaleDateString('en-US', {
    weekday: style === 'long' ? 'long' : undefined,
    month: style === 'long' ? 'long' : 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Today's date in the user's local zone, YYYY-MM-DD. */
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
