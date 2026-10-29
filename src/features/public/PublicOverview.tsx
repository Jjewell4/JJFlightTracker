import { useMemo, type ReactNode } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { useReferenceReady } from '@/data/reference';
import { JourneyMap } from '@/features/flights/JourneyMap';
import { SummaryHero, type HeroLink } from '@/features/flights/SummaryHero';
import { computeSummary } from '@/features/flights/flight-logic';
import { fmtDistance, fmtInt, plural } from '@/features/stats/format';
import { orientRoute } from '@/features/stats/TopLists';
import { airportCode } from '@/lib/flight-utils';
import type { FlightStats } from '@/lib/stats';
import { formatFlightDate, todayLocal } from '@/lib/time';
import type { Flight, Settings } from '@/lib/types';
import { JournalLink, type JournalNav } from './JournalLink';
import { PublicFlightGroups } from './PublicFlightList';
import '@/features/flights/FlightsPage.css';
import '@/features/flights/Overview.css';

const RECENT = 5;

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

/**
 * Landing view, laid out like the owner's Home: the same summary hero, route map card and
 * recent journeys (same components, same numbers), plus a few highlights for visitors.
 */
export function PublicOverview({ flights, stats, unit, nav }: { flights: Flight[]; stats: FlightStats; unit: Settings['distanceUnit']; nav: JournalNav }) {
  const ready = useReferenceReady();
  // Shared flights are all in the past, so they're the app's "past" list as-is.
  // `ready` is a dependency because airport lookups only resolve once reference data loads.
  const summary = useMemo(() => computeSummary(flights, todayLocal()), [flights, ready]);
  const statsLink = useMemo<HeroLink>(
    () =>
      ({ className, label, children }) => (
        <JournalLink nav={nav} to={{ view: 'stats' }} className={className} label={label}>
          {children}
        </JournalLink>
      ),
    [nav],
  );

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

  const visits = new Map(stats.airports.map((a) => [a.key, a.count]));
  const topRoute = stats.routes[0] && orientRoute(visits)(stats.routes[0]);
  const home = stats.airports[0];
  const longest = stats.records.longestDistance;
  const airline = stats.airlines[0];

  return (
    <div className="flights pj-overview">
      {/* Shared journals carry no times: time in the air is the app's distance-based estimate. */}
      <SummaryHero summary={summary} unit={unit} upcoming={0} link={statsLink} estimatedTime />

      <JournalLink nav={nav} to={{ view: 'map' }} className="overview__map overview__map--solo card" label="Open the route map">
        <span className="overview__heading">
          <Icon name="globe" size={20} />
          <span>Route map</span>
          <Icon name="chevron" size={16} />
        </span>
        <JourneyMap flights={flights} />
        <span className="overview__caption">
          {summary.airports} airports · {summary.countries} countries<span>Open map</span>
        </span>
      </JournalLink>

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

      <div className="overview__section-head">
        <h2 className="section-title">Recent journeys</h2>
        <JournalLink nav={nav} to={{ view: 'flights' }} className="pj-more">
          View full log <Icon name="chevron" size={14} />
        </JournalLink>
      </div>
      <PublicFlightGroups flights={flights} unit={unit} limit={RECENT} />
    </div>
  );
}
