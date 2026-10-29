import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AirlineLogo } from '@/components/AirlineLogo';
import { Icon } from '@/components/Icon';
import type { FlightStats, RankedRoute } from '@/lib/stats';
import { airlineHref, airportHref } from '@/features/explore/links';
import { CardHead, Section } from './parts';
import { fmtDistance, fmtInt, plural, type DistanceUnit } from './format';
import type { StatsSections } from './sections';

interface Row {
  key: string;
  lead: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
  count: number;
  href?: string;
}

const INITIAL = 5;
const MAX_ALL = 100;

function RankList({ title, subtitle, rows, noun }: { title: string; subtitle?: string; rows: Row[]; noun: [string, string] }) {
  const [open, setOpen] = useState(false);
  if (!rows.length) return null;
  const max = rows[0].count || 1;
  const visible = open ? rows.slice(0, MAX_ALL) : rows.slice(0, INITIAL);
  return (
    <article className="card stats-card stats-rank">
      <CardHead title={title} subtitle={subtitle} />
      <ol className="stats-rank__list">
        {visible.map((r, i) => {
          const body = (
            <>
              <span className="stats-rank__n">{i + 1}</span>
              <span className="stats-rank__lead">{r.lead}</span>
              <span className="stats-rank__text">
                <span className="stats-rank__primary">{r.primary}</span>
                {r.secondary && <span className="stats-rank__secondary">{r.secondary}</span>}
                <span className="stats-rank__bar" aria-hidden>
                  <span style={{ width: `${Math.max(2, (r.count / max) * 100)}%` }} />
                </span>
              </span>
              <span className="stats-rank__count">
                {fmtInt(r.count)}
                <span className="visually-hidden"> {plural(r.count, noun[0], noun[1])}</span>
              </span>
            </>
          );
          return (
            <li key={r.key}>
              {r.href ? (
                <Link to={r.href} className="stats-rank__row stats-rank__row--link">
                  {body}
                </Link>
              ) : (
                <div className="stats-rank__row">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
      {rows.length > INITIAL && (
        <button type="button" className="stats-rank__more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Show less' : `Show all ${fmtInt(Math.min(rows.length, MAX_ALL))}`}
          <Icon name="chevron" size={16} className={open ? 'is-open' : undefined} />
        </button>
      )}
    </article>
  );
}

const Code = ({ children, tone }: { children: ReactNode; tone?: 'amber' }) => <span className={`stats-code${tone ? ' stats-code--amber' : ''}`}>{children}</span>;

const iata = (key: string, ap?: { iata: string }) => ap?.iata || key;

/** Shows the more-visited end (usually home) first: "SAN ⇄ SFO" rather than alphabetical. */
export const orientRoute =
  (visits: Map<string, number>) =>
  (r: RankedRoute): RankedRoute =>
    (visits.get(r.b) ?? 0) > (visits.get(r.a) ?? 0) ? { ...r, a: r.b, b: r.a, airportA: r.airportB, airportB: r.airportA } : r;

export function TopLists({ stats, unit, sections, readOnly = false }: { stats: FlightStats; unit: DistanceUnit; sections: StatsSections; readOnly?: boolean }) {
  const visits = new Map(stats.airports.map((a) => [a.key, a.count]));
  const airports: Row[] = stats.airports.map((a) => ({
    key: a.key,
    lead: <Code>{iata(a.key, a.airport)}</Code>,
    primary: a.airport?.city || a.airport?.name || a.key,
    secondary: a.airport ? `${a.airport.name} · ${a.departures} dep · ${a.arrivals} arr` : 'Unknown airport',
    count: a.count,
    // Public journals never link into the owner's app.
    href: readOnly ? undefined : airportHref(a.key),
  }));
  const airlines: Row[] = stats.airlines.map((a) => ({
    key: a.key,
    lead: <AirlineLogo iata={a.iata} icao={a.icao} name={a.name} size={32} />,
    primary: a.name,
    secondary: [a.iata, a.icao].filter(Boolean).join(' · ') + (a.distanceKm ? ` · ${fmtDistance(a.distanceKm, unit)}` : ''),
    count: a.count,
    href: readOnly ? undefined : airlineHref(a.key),
  }));
  const aircraft: Row[] = stats.aircraft.map((a) => ({
    key: a.key,
    lead: <Code tone="amber">{a.icao ?? '—'}</Code>,
    primary: a.name,
    secondary: a.distanceKm ? fmtDistance(a.distanceKm, unit) : undefined,
    count: a.count,
  }));
  const routes: Row[] = stats.routes.map(orientRoute(visits)).map((r) => ({
    key: r.key,
    lead: (
      <span className="stats-route-lead" aria-hidden>
        <Icon name="swap" size={16} />
      </span>
    ),
    primary: (
      <span className="stats-route">
        <span className="code">{iata(r.a, r.airportA)}</span>
        <span className="stats-route__sep">⇄</span>
        <span className="code">{iata(r.b, r.airportB)}</span>
      </span>
    ),
    secondary: [r.airportA?.city, r.airportB?.city].filter(Boolean).join(' – ') + (r.distanceKm ? ` · ${fmtDistance(r.distanceKm, unit)}` : ''),
    count: r.count,
  }));
  const regs: Row[] = stats.registrations.map((r) => ({
    key: r.key,
    lead: r.airlineIata || r.airlineIcao ? <AirlineLogo iata={r.airlineIata} icao={r.airlineIcao} name={r.airlineName} size={32} /> : <Code>{r.key.slice(0, 2)}</Code>,
    primary: <span className="code">{r.key}</span>,
    secondary: [r.aircraftName ?? r.aircraftType, r.airlineName].filter(Boolean).join(' · ') || undefined,
    count: r.count,
    href: readOnly ? undefined : `/flights/${r.lastFlightId}`,
  }));

  return (
    <Section id="top" title="Favorites">
      <div className="stats-grid">
        <RankList title="Airports" subtitle={`${fmtInt(stats.unique.airports)} visited · departures + arrivals`} rows={airports} noun={['visit', 'visits']} />
        <RankList title="Airlines" subtitle={`${fmtInt(stats.unique.airlines)} ${plural(stats.unique.airlines, 'airline')} flown`} rows={airlines} noun={['flight', 'flights']} />
        <RankList title="Routes" subtitle={`${fmtInt(stats.unique.routes)} unique · both directions combined`} rows={routes} noun={['flight', 'flights']} />
        <RankList title="Aircraft" subtitle={`${fmtInt(stats.unique.aircraft)} ${plural(stats.unique.aircraft, 'type')}`} rows={aircraft} noun={['flight', 'flights']} />
        {sections.registrations && (
          <RankList
            title="Tail numbers"
            subtitle={`${fmtInt(stats.unique.registrations)} individual ${plural(stats.unique.registrations, 'airframe')}${readOnly ? '' : ' · tap for the latest flight'}`}
            rows={regs}
            noun={['flight', 'flights']}
          />
        )}
      </div>
    </Section>
  );
}
