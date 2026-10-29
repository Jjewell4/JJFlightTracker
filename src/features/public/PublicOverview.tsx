import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { JourneyMap } from '@/features/flights/JourneyMap';
import { TrendBars } from '@/features/stats/charts/TrendBars';
import { trendData } from '@/features/stats/trend';
import { fmtCompact, fmtDistance, fmtInt, plural, toUnit } from '@/features/stats/format';
import { orientRoute } from '@/features/stats/TopLists';
import { airportCode } from '@/lib/flight-utils';
import type { FlightStats } from '@/lib/stats';
import { formatFlightDate } from '@/lib/time';
import type { Flight, Settings } from '@/lib/types';
import { JournalLink, type JournalNav } from './JournalLink';
import { PublicFlightRow } from './PublicFlightList';
import '@/features/stats/charts/charts.css';
import '@/features/flights/Overview.css';

function Highlight({ icon, label, value, detail, tone }: { icon: IconName; label: string; value: ReactNode; detail?: ReactNode; tone?: 'amber' }) {
  return (
    <div className="pj-highlight">
      <p className={`pj-highlight__label${tone ? ` pj-highlight__label--${tone}` : ''}`}>
        <Icon name={icon} size={14} />
        {label}
      </p>
      <p className="pj-highlight__value">{value}</p>
      {detail && <p className="pj-highlight__detail">{detail}</p>}
    </div>
  );
}

/** Landing view: totals, flights per year, a route preview, highlights and recent flights. */
export function PublicOverview({ flights, stats, unit, nav }: { flights: Flight[]; stats: FlightStats; unit: Settings['distanceUnit']; nav: JournalNav }) {
  const t = stats.totals;
  const trend = trendData(stats, 'all');
  const first = stats.byYear[0]?.year;
  const last = stats.byYear[stats.byYear.length - 1]?.year;
  const visits = new Map(stats.airports.map((a) => [a.key, a.count]));
  const topRoute = stats.routes[0] && orientRoute(visits)(stats.routes[0]);
  const home = stats.airports[0];
  const longest = stats.records.longestDistance;
  const airline = stats.airlines[0];
  const recent = flights.slice(0, 5);

  if (!flights.length)
    return (
      <section className="card pj-none">
        <span className="pj-none__icon" aria-hidden>
          <Icon name="plane" size={24} />
        </span>
        <h2>No flights shared yet</h2>
        <p>Flights appear here once they’ve been flown. This journal updates automatically.</p>
      </section>
    );

  return (
    <div className="pj-overview">
      <section className="pj-hero" aria-label="Summary">
        <p className="pj-hero__kicker">{first ? `Flying since ${first}` : 'Flight journal'}</p>
        <p className="pj-hero__main">
          <span className="pj-hero__big">{fmtInt(t.flights)}</span>
          <span className="pj-hero__unit">{plural(t.flights, 'flight')}</span>
        </p>
        <dl className="pj-totals">
          <div>
            <dt>Distance</dt>
            <dd>
              {fmtCompact(toUnit(t.distanceKm, unit))} <small>{unit}</small>
            </dd>
          </div>
          <div>
            <dt>Airports</dt>
            <dd>{fmtInt(stats.unique.airports)}</dd>
          </div>
          <div>
            <dt>Countries</dt>
            <dd>{fmtInt(stats.unique.countries)}</dd>
          </div>
          <div>
            <dt>Airlines</dt>
            <dd>{fmtInt(stats.unique.airlines)}</dd>
          </div>
        </dl>
        {trend.data.length > 1 && (
          <div className="pj-hero__trend">
            <TrendBars
              data={trend.data}
              highlightKey={trend.highlightKey}
              partialKey={trend.highlightKey}
              formatValue={(v) => `${fmtInt(v)} ${plural(v, 'flight')}`}
              label={`Flights per year, ${first}–${last}`}
              caption="flights per year"
              height={56}
            />
          </div>
        )}
        <JournalLink nav={nav} to={{ view: 'stats' }} className="pj-cta">
          All stats
          <Icon name="chevron" size={16} />
        </JournalLink>
      </section>

      <section className="card pj-mapcard" aria-labelledby="pj-routes-title">
        <div className="pj-card-head">
          <h2 id="pj-routes-title">Routes</h2>
          <span>
            {fmtInt(stats.unique.routes)} {plural(stats.unique.routes, 'route')} · {fmtInt(stats.unique.countries)} {plural(stats.unique.countries, 'country', 'countries')}
          </span>
        </div>
        <JournalLink nav={nav} to={{ view: 'map' }} className="pj-mapcard__preview" label="Open the interactive map">
          <JourneyMap flights={flights} />
        </JournalLink>
        <JournalLink nav={nav} to={{ view: 'map' }} className="btn btn--block">
          <Icon name="globe" size={18} /> Explore the map
        </JournalLink>
      </section>

      <section className="pj-highlights" aria-label="Highlights">
        {topRoute && (
          <Highlight
            icon="swap"
            label="Top route"
            value={
              <span className="code">
                {topRoute.airportA?.iata || topRoute.a} ⇄ {topRoute.airportB?.iata || topRoute.b}
              </span>
            }
            detail={`${fmtInt(topRoute.count)} ${plural(topRoute.count, 'flight')}${topRoute.distanceKm ? ` · ${fmtDistance(topRoute.distanceKm, unit)}` : ''}`}
          />
        )}
        {home && (
          <Highlight
            icon="map"
            label="Home base"
            value={<span className="code">{home.airport?.iata || home.key}</span>}
            detail={`${home.airport?.city ?? 'Unknown airport'} · ${fmtInt(home.count)} visits`}
          />
        )}
        {longest && (
          <Highlight
            icon="globe"
            label="Longest flight"
            tone="amber"
            value={fmtDistance(longest.value, unit)}
            detail={
              <>
                <span className="code">
                  {airportCode(longest.flight.from)} → {airportCode(longest.flight.to)}
                </span>{' '}
                · {formatFlightDate(longest.flight.date, longest.flight.datePrecision)}
              </>
            }
          />
        )}
        {airline && <Highlight icon="plane" label="Favorite airline" value={airline.name} detail={`${fmtInt(airline.count)} ${plural(airline.count, 'flight')}`} />}
      </section>

      <section className="card pj-recent" aria-labelledby="pj-recent-title">
        <div className="pj-card-head">
          <h2 id="pj-recent-title">Recent flights</h2>
        </div>
        <ul className="pj-flight-list">
          {recent.map((f) => (
            <PublicFlightRow key={f.id} f={f} />
          ))}
        </ul>
        <JournalLink nav={nav} to={{ view: 'flights' }} className="btn btn--block">
          All {fmtInt(flights.length)} flights
          <Icon name="chevron" size={16} />
        </JournalLink>
      </section>
    </div>
  );
}
