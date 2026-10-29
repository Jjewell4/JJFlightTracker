import { MONTH_LABELS, type FlightStats, type YearScope } from '@/lib/stats';
import type { TrendDatum } from './charts/TrendBars';

const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Flights per year (all time) or per month (one year), with "now" as the highlighted bar. */
export function trendData(stats: Pick<FlightStats, 'byYear' | 'byMonth'>, scope: YearScope, now = new Date()): { data: TrendDatum[]; highlightKey?: string } {
  if (scope === 'all') {
    return {
      data: stats.byYear.map((y) => ({ key: String(y.year), label: String(y.year), value: y.flights })),
      highlightKey: String(now.getFullYear()),
    };
  }
  return {
    data: stats.byMonth.map((m) => ({ key: String(m.month), label: MONTH_LABELS[m.month - 1], value: m.flights, title: `${FULL_MONTHS[m.month - 1]} ${scope}` })),
    highlightKey: scope === now.getFullYear() ? String(now.getMonth() + 1) : undefined,
  };
}
