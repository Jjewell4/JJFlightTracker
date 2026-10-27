/** Untrusted model output: only explicit, validated flight fields cross this boundary. */
export interface ScreenshotFlight {
  date: string;
  from: string;
  to: string;
  flightNumber: string;
  depTime: string;
  arrTime: string;
  arrDayOffset: number | null;
  aircraftType: string;
  seatNumber: string;
}
export interface ScreenshotResult { flights: ScreenshotFlight[]; warnings: string[] }
const text = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const match = (v: unknown, pattern: RegExp, max = 20) => {
  const s = text(v, max).toUpperCase();
  return pattern.test(s) ? s : '';
};
export function parseScreenshotResult(raw: unknown): ScreenshotResult {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as ScreenshotResult).flights)) throw new Error('Invalid extraction response');
  const r = raw as { flights: unknown[]; warnings?: unknown[] };
  if (r.flights.length > 6) throw new Error('Too many flights');
  const warnings = Array.isArray(r.warnings) ? r.warnings.slice(0, 8).map(w => text(w, 200)).filter(Boolean) : [];
  const flights = r.flights.map(item => {
    if (!item || typeof item !== 'object') throw new Error('Invalid flight');
    const f = item as Record<string, unknown>;
    const date = match(f.date, /^\d{4}-\d{2}-\d{2}$/);
    const validDate = date && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
    return {
      date: validDate ? date : '', from: match(f.from, /^[A-Z]{3,4}$/), to: match(f.to, /^[A-Z]{3,4}$/),
      flightNumber: match(f.flightNumber, /^(?:[A-Z]{2,3}|[A-Z]\d|\d[A-Z])\d{1,4}[A-Z]?$/),
      depTime: match(f.depTime, /^(?:[01]\d|2[0-3]):[0-5]\d$/), arrTime: match(f.arrTime, /^(?:[01]\d|2[0-3]):[0-5]\d$/),
      arrDayOffset: typeof f.arrDayOffset === 'number' && Number.isInteger(f.arrDayOffset) && f.arrDayOffset >= -1 && f.arrDayOffset <= 3 ? f.arrDayOffset : null,
      aircraftType: match(f.aircraftType, /^[A-Z0-9]{2,4}$/), seatNumber: match(f.seatNumber, /^\d{1,3}[A-Z]$/),
    };
  }).filter(f => f.from || f.to || f.flightNumber);
  return { flights, warnings };
}
