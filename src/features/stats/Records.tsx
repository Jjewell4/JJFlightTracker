import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '@/components/Icon';
import { airportCode } from '@/lib/flight-utils';
import { formatDuration, formatFlightDate } from '@/lib/time';
import type { Flight } from '@/lib/types';
import type { FlightStats } from '@/lib/stats';
import { Section } from './parts';
import { orientRoute } from './TopLists';
import { fmtDistance, fmtInt, fmtYearMonth, plural, type DistanceUnit } from './format';
import type { StatsSections } from './sections';

interface Rec {
  id: string;
  icon: IconName;
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  flight?: Flight;
  tone?: 'accent' | 'amber';
}

const route = (f: Flight) => (
  <span className="stats-record__route">
    <span className="code">{airportCode(f.from)}</span>
    <Icon name="plane" size={12} className="stats-record__plane" />
    <span className="code">{airportCode(f.to)}</span>
  </span>
);
const when = (f: Flight) => formatFlightDate(f.date, f.datePrecision);

export function Records({ stats, unit, sections, readOnly = false }: { stats: FlightStats; unit: DistanceUnit; sections: StatsSections; readOnly?: boolean }) {
  const r = stats.records;
  const recs: Rec[] = [];
  if (r.longestDistance)
    recs.push({ id: 'longest', icon: 'globe', label: 'Longest flight', value: fmtDistance(r.longestDistance.value, unit), flight: r.longestDistance.flight, tone: 'amber' });
  if (r.shortestDistance && r.shortestDistance.flight.id !== r.longestDistance?.flight.id)
    recs.push({ id: 'shortest', icon: 'landing', label: 'Shortest flight', value: fmtDistance(r.shortestDistance.value, unit), flight: r.shortestDistance.flight });
  if (sections.durationRecords && r.longestDuration && r.longestDuration.flight.id !== r.longestDistance?.flight.id)
    recs.push({ id: 'longest-time', icon: 'clock', label: 'Most time aloft', value: `${r.longestDuration.estimated ? '≈ ' : ''}${formatDuration(r.longestDuration.value)}`, flight: r.longestDuration.flight, tone: 'amber' });
  if (sections.durationRecords && r.shortestDuration && r.shortestDuration.flight.id !== r.longestDuration?.flight.id && r.shortestDuration.flight.id !== r.shortestDistance?.flight.id)
    recs.push({ id: 'shortest-time', icon: 'clock', label: 'Quickest hop', value: `${r.shortestDuration.estimated ? '≈ ' : ''}${formatDuration(r.shortestDuration.value)}`, flight: r.shortestDuration.flight });
  if (r.first) recs.push({ id: 'first', icon: 'takeoff', label: 'First flight', value: when(r.first), flight: r.first });
  if (r.latest && r.latest.id !== r.first?.id) recs.push({ id: 'latest', icon: 'landing', label: 'Most recent', value: when(r.latest), flight: r.latest });
  if (r.busiestYear && stats.byYear.length > 1)
    recs.push({ id: 'year', icon: 'calendar', label: 'Busiest year', value: String(r.busiestYear.year), detail: `${fmtInt(r.busiestYear.flights)} ${plural(r.busiestYear.flights, 'flight')}` });
  if (r.busiestMonth)
    recs.push({ id: 'month', icon: 'calendar', label: 'Busiest month', value: fmtYearMonth(r.busiestMonth.month), detail: `${fmtInt(r.busiestMonth.flights)} ${plural(r.busiestMonth.flights, 'flight')}` });
  if (r.longestMonthStreak && r.longestMonthStreak.months > 1)
    recs.push({
      id: 'streak',
      icon: 'sparkle',
      label: 'Longest streak',
      value: `${r.longestMonthStreak.months} months`,
      detail: `${fmtYearMonth(r.longestMonthStreak.start)} – ${fmtYearMonth(r.longestMonthStreak.end)}, flying every month`,
    });
  if (sections.busiestDay && r.busiestDay)
    recs.push({ id: 'day', icon: 'refresh', label: 'Busiest day', value: `${r.busiestDay.flights} flights`, detail: formatFlightDate(r.busiestDay.date) });
  if (r.mostFlownRoute && r.mostFlownRoute.count > 1) {
    const route = orientRoute(new Map(stats.airports.map((a) => [a.key, a.count])))(r.mostFlownRoute);
    recs.push({
      id: 'route',
      icon: 'swap',
      label: 'Top route',
      value: `${route.airportA?.iata || route.a} ⇄ ${route.airportB?.iata || route.b}`,
      detail: `${fmtInt(route.count)} flights`,
    });
  }
  if (r.mostVisitedAirport)
    recs.push({
      id: 'airport',
      icon: 'map',
      label: 'Home base',
      value: r.mostVisitedAirport.airport?.iata || r.mostVisitedAirport.key,
      detail: `${r.mostVisitedAirport.airport?.city ?? 'Unknown'} · ${fmtInt(r.mostVisitedAirport.count)} visits`,
    });

  if (!recs.length) return null;
  return (
    <Section id="records" title="Records">
      <div className="stats-records">
        {recs.map((rec) => {
          const inner = (
            <>
              <p className={`stats-record__label${rec.tone === 'amber' ? ' stats-record__label--amber' : ''}`}>
                <Icon name={rec.icon} size={14} />
                {rec.label}
              </p>
              <p className="stats-record__value">{rec.value}</p>
              <p className="stats-record__detail">
                {rec.flight ? (
                  <>
                    {route(rec.flight)}
                    {rec.id !== 'first' && rec.id !== 'latest' && <span className="stats-record__date">{when(rec.flight)}</span>}
                  </>
                ) : (
                  rec.detail
                )}
              </p>
              {rec.flight && !readOnly && <Icon name="chevron" size={16} className="stats-record__chev" />}
            </>
          );
          // Shared journals have no flight pages, so records there never link anywhere.
          return rec.flight && !readOnly ? (
            <Link key={rec.id} to={`/flights/${rec.flight.id}`} className="stats-record card card--interactive" aria-label={`${rec.label}: ${typeof rec.value === 'string' ? rec.value : ''}, open flight`}>
              {inner}
            </Link>
          ) : (
            <div key={rec.id} className="stats-record card">
              {inner}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
