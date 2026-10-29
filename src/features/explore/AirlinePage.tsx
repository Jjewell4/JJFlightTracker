import { useMemo } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { AirlineLogo } from '@/components/AirlineLogo';
import { Icon } from '@/components/Icon';
import { useReferenceReady } from '@/data/reference';
import { formatCompact, formatLongDuration } from '@/features/flights/flight-logic';
import { SegmentBar, type PartItem } from '@/features/stats/charts/PartToWhole';
import { useFlights, useSettings } from '@/lib/db';
import { kmToMiles } from '@/lib/geo';
import type { Breakdown } from '@/lib/stats';
import { formatFlightDate } from '@/lib/time';
import type { Settings } from '@/lib/types';
import { airlineHistory, resolveAirlineParam, type AirlineHistory } from './explore-logic';
import { airlineHref, airportHref } from './links';
import { NetworkMap, type NetworkRoute } from './NetworkMap';
import { Card, CodeChip, EmptyCard, FlightList, PageSkeleton, plural, RankList, Tiles, TopBar, UpcomingList, useGoBack, YearChart, type RankItem } from './parts';
import '@/features/flights/FlightDetailPage.css';
import '@/features/flights/FlightsPage.css';
import '@/features/stats/charts/charts.css';
import './explore.css';

export default function AirlinePage() {
  const { key } = useParams();
  const flights = useFlights();
  const ready = useReferenceReady();
  const settings = useSettings();
  const goBack = useGoBack();
  const param = useMemo(() => (ready ? resolveAirlineParam(key) : undefined), [key, ready]);
  const history = useMemo(() => (param && flights ? airlineHistory(flights, param.key) : undefined), [param, flights]);

  if (param?.redirect) return <Navigate to={airlineHref(param.redirect)} replace />;
  if (!param || !history) return <PageSkeleton onBack={goBack} label="Loading airline" />;
  if (!param.airline && !history.flights.length && !history.upcoming.length) return <UnknownAirline code={param.key} onBack={goBack} />;
  return <AirlineView h={history} settings={settings} onBack={goBack} />;
}

function UnknownAirline({ code, onBack }: { code: string; onBack: () => void }) {
  const shown = code.startsWith('name:') ? code.slice(5) : code;
  return (
    <div className="xp">
      <TopBar title={shown || 'Airline'} sub="Airline" onBack={onBack} />
      <EmptyCard
        icon="plane"
        title="Unknown airline"
        action={
          <Link to="/flights" className="btn btn--primary">
            Back to your flights
          </Link>
        }
      >
        We couldn’t find <span className="code">{shown || 'this airline'}</span> in the airline database or in your flights.
      </EmptyCard>
    </div>
  );
}

/** Stable color slots per category so a color always means the same cabin / seat. */
function toParts<K extends string>(b: Breakdown<K>): PartItem[] {
  return b.items.map((it, i) => ({ key: it.key, label: it.label, count: it.count, slot: i + 1 }));
}

function AirlineView({ h, settings, onBack }: { h: AirlineHistory; settings: Settings; onBack: () => void }) {
  const unit = settings.distanceUnit;
  const currentYear = new Date().getFullYear();
  const flown = h.flights.length;
  const codes = [h.iata, h.icao].filter(Boolean).join(' · ');

  const network = useMemo<NetworkRoute[]>(
    () => h.routes.filter((r) => r.airportA && r.airportB).map((r) => ({ key: r.key, a: r.airportA!, b: r.airportB!, count: r.count })),
    [h.routes],
  );

  const routes = useMemo<RankItem[]>(
    () =>
      h.routes.map((r) => ({
        key: r.key,
        lead: (
          <span className="xp-route-lead" aria-hidden>
            <Icon name="swap" size={16} />
          </span>
        ),
        primary: (
          <span className="xp-route">
            <span className="code">{r.airportA?.iata || r.a}</span>
            <span className="xp-route__sep">⇄</span>
            <span className="code">{r.airportB?.iata || r.b}</span>
          </span>
        ),
        secondary: [[r.airportA?.city, r.airportB?.city].filter(Boolean).join(' – '), r.distanceKm ? fmtDist(r.distanceKm, unit) : undefined].filter(Boolean).join(' · '),
        count: r.count,
      })),
    [h.routes, unit],
  );

  const aircraft = useMemo<RankItem[]>(
    () =>
      h.aircraft.map((ac) => ({
        key: ac.key,
        lead: <CodeChip tone="amber">{ac.icao ?? '—'}</CodeChip>,
        primary: ac.name,
        secondary: ac.distanceKm ? fmtDist(ac.distanceKm, unit) : undefined,
        count: ac.count,
      })),
    [h.aircraft, unit],
  );

  const airports = useMemo<RankItem[]>(
    () =>
      h.airports.map((ap) => {
        const c = ap.airport?.iata || ap.key;
        return {
          key: ap.key,
          lead: <CodeChip>{c}</CodeChip>,
          primary: ap.airport ? ap.airport.city || ap.airport.name : 'Unknown airport',
          secondary: `${ap.departures} dep · ${ap.arrivals} arr`,
          count: ap.count,
          to: airportHref(ap.key),
          label: `${c}: ${ap.count} ${plural(ap.count, 'visit')}`,
        };
      }),
    [h.airports],
  );

  const first = h.firstFlight;
  const last = h.lastFlight;
  const estimated = h.estimatedDuration > flown * 0.5;
  const dist = unit === 'mi' ? kmToMiles(h.distanceKm) : h.distanceKm;
  const pct = Math.round(h.share * 100);

  return (
    <div className="xp">
      <TopBar title={h.name} sub={codes ? `Airline · ${codes}` : 'Airline'} onBack={onBack} />

      <div className="xp-layout">
        <div className="xp-main">
          <article className="xp-hero animate-in xp-o1" aria-label={h.name}>
            {network.length > 0 && (
              <div className="xp-hero__map">
                <NetworkMap routes={network} labels={5} label={`Routes you’ve flown with ${h.name}`} />
              </div>
            )}
            <div className="xp-hero__id xp-hero__id--airline">
              <AirlineLogo iata={h.iata} icao={h.icao} name={h.name} size={56} />
              <div className="xp-hero__airline">
                <h1 className="xp-hero__title">{h.name}</h1>
                <p className="xp-hero__place">
                  {[h.iata, h.icao].filter(Boolean).map((c, i) => (
                    <span key={c}>
                      {i > 0 && ' · '}
                      <span className="xp-hero__codes">{c}</span>
                    </span>
                  ))}
                  {codes && h.country && ' · '}
                  {h.country}
                  {!codes && !h.country && 'Airline'}
                </p>
              </div>
            </div>

            {flown > 0 && (
              <div className="xp-hero__body">
                <Tiles
                  tiles={[
                    { label: 'Flights', value: flown.toLocaleString('en-US') },
                    { label: 'Distance', value: formatCompact(Math.round(dist)), unit },
                    { label: estimated ? 'Est. in the air' : 'In the air', value: `${estimated ? '≈' : ''}${formatLongDuration(h.durationMin)}` },
                  ]}
                />
                <div className="xp-share">
                  <div className="xp-share__text">
                    <strong className="tabular">{h.share > 0 && pct < 1 ? '<1' : pct}%</strong> of your {h.totalFlights.toLocaleString('en-US')} flights
                  </div>
                  <div className="xp-share__bar" role="img" aria-label={`${pct}% of all your flights`}>
                    <span style={{ width: `${Math.max(1.5, h.share * 100)}%` }} />
                  </div>
                </div>
                <dl className="xp-facts xp-facts--two">
                  <div>
                    <dt>First flight</dt>
                    <dd>{first ? formatFlightDate(first.date, first.datePrecision) : '—'}</dd>
                  </div>
                  <div>
                    <dt>Last flight</dt>
                    <dd>{last ? formatFlightDate(last.date, last.datePrecision) : '—'}</dd>
                  </div>
                </dl>
              </div>
            )}
          </article>

          {flown > 0 && h.perYear.length > 0 && (
            <Card title="Flights per year" className="xp-o2">
              <YearChart data={h.perYear} noun={['flight', 'flights']} caption="flights per year" currentYear={currentYear} />
            </Card>
          )}

          {flown === 0 && (
            <div className="xp-o2">
              <EmptyCard
                icon="plane"
                title={h.upcoming.length ? `Your first ${h.name} flight is coming up` : `You haven’t flown with ${h.name} yet`}
                action={
                  !h.upcoming.length && (
                    <Link to="/flights/new" className="btn btn--primary">
                      <Icon name="plus" size={18} /> Log a flight
                    </Link>
                  )
                }
              >
                {h.upcoming.length
                  ? 'Once it departs, routes, aircraft and your history with them will build up here.'
                  : 'Flights with this airline will show up here, with routes, aircraft and flights per year.'}
              </EmptyCard>
            </div>
          )}

          <div className="xp-o4">
            <UpcomingList flights={h.upcoming} settings={settings} />
          </div>

          {flown > 0 && (
            <section className="xp-section xp-o5" aria-label="Flights">
              <h2 className="xp-section__title">
                Flights
                <span className="xp-section__count">{flown}</span>
                <Link to={`/?airline=${encodeURIComponent(h.key)}`} className="xp-section__link">
                  Open in log
                  <Icon name="chevron" size={14} />
                </Link>
              </h2>
              <FlightList flights={h.flights} settings={settings} />
            </section>
          )}
        </div>

        {flown > 0 && (
          <aside className="xp-side xp-o3">
            {routes.length > 0 && (
              <Card title="Top routes" subtitle={`${routes.length} ${plural(routes.length, 'route')} · both directions`}>
                <RankList items={routes} noun={['flight', 'flights']} />
              </Card>
            )}
            {aircraft.length > 0 && (
              <Card title="Aircraft" subtitle={`${aircraft.length} ${plural(aircraft.length, 'type')} flown with them`}>
                <RankList items={aircraft} noun={['flight', 'flights']} />
              </Card>
            )}
            {airports.length > 0 && (
              <Card title="Airports" subtitle={`${airports.length} ${plural(airports.length, 'airport')} · departures + arrivals`}>
                <RankList items={airports} noun={['visit', 'visits']} />
              </Card>
            )}
            {(h.cabin.known > 0 || h.seat.known > 0) && (
              <Card title="Cabin & seat" subtitle="Where you sat with them" className="xp-mix">
                {h.cabin.known > 0 && (
                  <div className="xp-mix__part">
                    <h3 className="xp-mix__label">Cabin</h3>
                    <SegmentBar items={toParts(h.cabin)} unknown={h.cabin.unknown} label="Cabin class" />
                  </div>
                )}
                {h.seat.known > 0 && (
                  <div className="xp-mix__part">
                    <h3 className="xp-mix__label">Seat</h3>
                    <SegmentBar items={toParts(h.seat)} unknown={h.seat.unknown} label="Seat type" />
                  </div>
                )}
              </Card>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function fmtDist(km: number, unit: Settings['distanceUnit']): string {
  return `${Math.round(unit === 'mi' ? kmToMiles(km) : km).toLocaleString('en-US')} ${unit}`;
}
