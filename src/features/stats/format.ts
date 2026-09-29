/** Number/unit formatting for the stats screen. */
import { kmToMiles } from '@/lib/geo';

export type DistanceUnit = 'mi' | 'km';

const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const oneFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const fmtInt = (n: number) => intFmt.format(Math.round(n));
export const fmt1 = (n: number) => oneFmt.format(n);

/** 1,284 / 12.9K / 4.2M */
export function fmtCompact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `${trim(n / 1e6)}M`;
  if (a >= 1e4) return `${trim(n / 1e3)}K`;
  return fmtInt(n);
}
const trim = (n: number) => (Math.abs(n) >= 100 ? fmtInt(n) : fmt1(n).replace(/\.0$/, ''));

export function toUnit(km: number, unit: DistanceUnit): number {
  return unit === 'mi' ? kmToMiles(km) : km;
}

export function fmtDistance(km: number, unit: DistanceUnit): string {
  return `${fmtInt(toUnit(km, unit))} ${unit}`;
}

export function fmtDistanceCompact(km: number, unit: DistanceUnit): string {
  return `${fmtCompact(toUnit(km, unit))} ${unit}`;
}

/** "1,224h 20m" */
export function fmtHoursMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return `${m}m`;
  return `${fmtInt(h)}h ${String(m).padStart(2, '0')}m`;
}

/** "2h" / "45m" for axis ticks. */
export function fmtHoursShort(min: number): string {
  return min >= 60 ? `${fmtCompact(min / 60)}h` : `${Math.round(min)}m`;
}

export function fmtPct(share: number): string {
  const p = share * 100;
  if (p > 0 && p < 1) return '<1%';
  return `${Math.round(p)}%`;
}

/** "×20.0" style multiple with sensible precision. */
export function fmtTimes(x: number): string {
  if (x >= 100) return fmtInt(x);
  if (x >= 10) return fmt1(x);
  return x.toFixed(2).replace(/0$/, '');
}

export function fmtTonnes(kg: number): string {
  const t = kg / 1000;
  if (t >= 100) return fmtInt(t);
  if (t >= 1) return fmt1(t);
  return t.toFixed(2);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

/** "Mar 2019" from "2019-03". */
export function fmtYearMonth(ym: string, style: 'short' | 'long' = 'short'): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: style, year: 'numeric', timeZone: 'UTC' });
}

/** "7 AM" / "7:00" labels for an hour index. */
export function fmtHour(h: number, clock: '12h' | '24h' = '12h'): string {
  if (clock === '24h') return `${String(h).padStart(2, '0')}:00`;
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12} ${suffix}`;
}
