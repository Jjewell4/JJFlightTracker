/** Earth-lap / Moon-distance comparisons for the stats "journey" tile, aware of the year scope. */
import type { YearScope } from '@/lib/stats';
import { fmtInt, fmtTimes, toUnit, type DistanceUnit } from './format';

export const EARTH_LAP_KM = 40_075;
export const MOON_KM = 384_400;

export interface Comparison {
  /** "15.0" or "18" */
  value: string;
  /** "×" or "%" */
  suffix: '×' | '%';
  caption: string;
}

export interface JourneyModel {
  km: number;
  laps: number;
  moon: number;
  /** Headline, e.g. "Lifetime distance" / "2023 distance". */
  heading: string;
  distanceLabel: string;
  earth: Comparison;
  moonCmp: Comparison;
  /** Position of the plane along the Earth→Moon arc for this scope (0..1). */
  arcProgress: number;
  /** Fraction of the current lap around the Earth (0..1). */
  lapProgress: number;
  /** Progress bar: lifetime (through the selected year) toward the next lunar distance. */
  milestone: string;
  percent: number;
  /** Right-hand label for the progress bar, e.g. "57%" or "17% to 2×". */
  percentLabel: string;
  /** Extra context for a single year, e.g. "▲ 0.4 Earth laps vs 2022". */
  context?: string;
}

const pct = (x: number) => Math.min(99, Math.max(x > 0 ? 1 : 0, Math.round(x * 100)));

function compare(ratio: number, whole: string, partial: string): Comparison {
  return ratio >= 1 ? { value: fmtTimes(ratio), suffix: '×', caption: whole } : { value: String(pct(ratio)), suffix: '%', caption: partial };
}

/**
 * @param km distance flown in the selected scope
 * @param lifetimeKm lifetime distance through the end of the selected year (defaults to km)
 * @param prevKm previous year's distance (single-year scope only)
 */
export function journeyModel(km: number, opts: { scope?: YearScope; unit: DistanceUnit; lifetimeKm?: number; prevKm?: number }): JourneyModel {
  const scope = opts.scope ?? 'all';
  const safe = Number.isFinite(km) && km > 0 ? km : 0;
  const laps = safe / EARTH_LAP_KM;
  const moon = safe / MOON_KM;
  const lifetime = Math.max(safe, Number.isFinite(opts.lifetimeKm) ? (opts.lifetimeKm as number) : safe);
  const lifeMoon = lifetime / MOON_KM;
  const completed = Math.floor(lifeMoon);
  const progress = lifeMoon - completed;

  const year = scope !== 'all';
  const milestone = year
    ? completed
      ? `Lifetime through ${scope}: ${fmtTimes(lifeMoon)}× to the Moon`
      : `Lifetime through ${scope}: ${pct(lifeMoon)}% of your first lunar distance`
    : completed
      ? `${completed} complete · next: ${completed + 1}× to the Moon`
      : 'Your first lunar distance';

  let context: string | undefined;
  if (year && opts.prevKm !== undefined) {
    const d = (safe - opts.prevKm) / EARTH_LAP_KM;
    context = Math.abs(d) < 0.05 ? `About the same as ${scope - 1}` : `${d > 0 ? '▲' : '▼'} ${fmtTimes(Math.abs(d))} Earth ${Math.abs(d) >= 0.95 && Math.abs(d) < 1.05 ? 'lap' : 'laps'} vs ${scope - 1}`;
  }

  return {
    km: safe,
    laps,
    moon,
    heading: year ? `${scope} distance` : 'Lifetime distance',
    distanceLabel: `${fmtInt(toUnit(safe, opts.unit))} ${opts.unit}`,
    earth: compare(laps, 'around the Earth', 'of a lap around the Earth'),
    moonCmp: compare(moon, 'the distance to the Moon', 'of the way to the Moon'),
    // Lifetime: the current lunar leg; a single year: how far that year's flying would get you.
    arcProgress: year ? Math.min(1, moon) : moon >= 1 ? moon - Math.floor(moon) || 1 : moon,
    lapProgress: laps - Math.floor(laps),
    milestone,
    percent: Math.min(99, Math.round(progress * 100)),
    percentLabel: year && completed ? `${Math.min(99, Math.round(progress * 100))}% to ${completed + 1}×` : `${Math.min(99, Math.round(progress * 100))}%`,
    context,
  };
}

// ---------- arc geometry (quadratic Bézier Earth → Moon in the 400×178 illustration) ----------

const P0 = [83, 94] as const;
const P1 = [203, -7] as const;
const P2 = [324, 66] as const;
export const ARC_PATH = `M${P0[0]} ${P0[1]}Q${P1[0]} ${P1[1]} ${P2[0]} ${P2[1]}`;

function bezier(t: number): [number, number] {
  const u = 1 - t;
  return [u * u * P0[0] + 2 * u * t * P1[0] + t * t * P2[0], u * u * P0[1] + 2 * u * t * P1[1] + t * t * P2[1]];
}

const SAMPLES = (() => {
  const pts: { t: number; len: number }[] = [{ t: 0, len: 0 }];
  let prev = bezier(0);
  let len = 0;
  for (let i = 1; i <= 96; i++) {
    const t = i / 96;
    const p = bezier(t);
    len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    pts.push({ t, len });
    prev = p;
  }
  return pts;
})();

/** Point and heading (degrees, SVG coordinates) at a fraction of the arc's length. */
export function pointOnArc(fraction: number): { x: number; y: number; angle: number } {
  const total = SAMPLES[SAMPLES.length - 1].len;
  const target = Math.min(1, Math.max(0, fraction)) * total;
  let i = SAMPLES.findIndex((s) => s.len >= target);
  if (i <= 0) i = 1;
  const a = SAMPLES[i - 1];
  const b = SAMPLES[i];
  const t = a.t + ((target - a.len) / Math.max(1e-9, b.len - a.len)) * (b.t - a.t);
  const [x, y] = bezier(t);
  const [x2, y2] = bezier(Math.min(1, t + 0.01));
  const [x1, y1] = bezier(Math.max(0, t - 0.01));
  return { x, y, angle: (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI };
}
