/**
 * Which Stats sections can render for a flight source.
 *
 * The owner's log can hold every field, so sections behave as they always have (cabin,
 * seat and reason cards stay visible with an "add …" prompt when empty). Public journals
 * only carry dates, airports, airlines and aircraft types, so sections that need anything
 * else are hidden instead of showing empty charts.
 */
import type { FlightFields } from '@/lib/flight-source';
import type { FlightStats } from '@/lib/stats';

export interface StatsSections {
  /** "Day of the week" chart — needs day-precision dates. */
  weekday: boolean;
  /** Departure-time clock — needs departure times. */
  departureHour: boolean;
  cabin: boolean;
  seat: boolean;
  reason: boolean;
  /** Tail-number ranking. */
  registrations: boolean;
  /** "Most time aloft" / "Quickest hop" records — need recorded times. */
  durationRecords: boolean;
  /** "Busiest day" record — needs day-precision dates. */
  busiestDay: boolean;
  /** Time in the air is always a distance-based estimate (no recorded times). */
  timeEstimated: boolean;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function statsSections(fields: FlightFields, stats: Pick<FlightStats, 'weekday' | 'hour' | 'registrations'>): StatsSections {
  return {
    weekday: fields.exactDates && sum(stats.weekday) > 0,
    departureHour: fields.times && sum(stats.hour) > 0,
    cabin: fields.cabin,
    seat: fields.seat,
    reason: fields.reason,
    registrations: fields.registration && stats.registrations.length > 0,
    durationRecords: fields.times,
    busiestDay: fields.exactDates,
    timeEstimated: !fields.times,
  };
}

/** Field each insight is derived from; insights about missing fields never show. */
const INSIGHT_FIELD: Record<string, keyof FlightFields | undefined> = {
  seat: 'seat',
  weekday: 'exactDates',
  hour: 'times',
  reason: 'reason',
  cabin: 'cabin',
};

export function insightAvailable(id: string, fields: FlightFields): boolean {
  const field = INSIGHT_FIELD[id];
  return field ? fields[field] : true;
}
