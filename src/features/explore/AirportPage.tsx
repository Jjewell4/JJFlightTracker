import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { AirlineLogo } from '@/components/AirlineLogo';
import { Icon } from '@/components/Icon';
import { useReferenceReady } from '@/data/reference';
import { formatCompact } from '@/features/flights/flight-logic';
import { useFlights, useSettings } from '@/lib/db';
import { flagEmoji } from '@/lib/stats';
import { kmToMiles } from '@/lib/geo';
import { formatFlightDate } from '@/lib/time';
import type { Airport, Settings } from '@/lib/types';
import { airportHistory, airportPlace, resolveAirportParam, tzDeltaLabel, tzDeltaMinutes, type AirportHistory } from './explore-logic';
import { airlineHref, airportHref } from './links';
import { NetworkMap, type NetworkRoute } from './NetworkMap';
import { Card, CodeChip, EmptyCard, FlightList, PageSkeleton, plural, RankList, Tiles, TopBar, UpcomingList, useGoBack, YearChart, type RankItem } from './parts';
import '@/features/flights/FlightDetailPage.css';
import '@/features/flights/FlightsPage.css';
import '@/features/stats/charts/charts.css';
import './explore.css';

export default function AirportPage() {
  const { ident } = useParams();
  const flights = useFlights();
  const ready = useReferenceReady();
  const settings = useSettings();
  const goBack = useGoBack();
  const param = useMemo(() => (ready ? resolveAirportParam(ident) : undefined), [ident, ready]);
  const history = useMemo(() => (param && flights ? airportHistory(flights, param.key) : undefined), [param, flights]);

  if (param?.redirect) return <Navigate to={airportHref(param.redirect)} replace />;
  if (!param || !history) return <PageSkeleton onBack={goBack} label="Loading airport" />;
  if (!param.airport && !history.visits && !history.upcoming.length) return <UnknownAirport code={param.key} onBack={goBack} />;
  return <AirportView h={history} airport={param.airport} settings={settings} onBack={goBack} />;
}

function UnknownAirport({ code, onBack }: { code: string; onBack: () => void }) {
  return (
    <div className="xp">
      <TopBar title={code || 'Airport'} sub="Airport" onBack={onBack} />
      <EmptyCard
        icon="globe"
        title="Unknown airport"
        action={
          <Link to="/flights" className="btn btn--primary">
            Back to your flights
          </Link>
        }
      >
        There’s no airport with the code <span className="code">{code}</span>, and none of your flights use it.
      </EmptyCard>
    </div>
  );
}

/** Ticks once a minute (aligned to the minute) for the local clock. */
function useMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, []);
  return now;
}

function LocalClock({ tz, clock }: { tz: string; clock: Settings['clock'] }) {
  const now = useMinute();
  let time = '';
  try {
    time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: clock === '12h', timeZoneName: 'short' }).format(now);
  } catch {
    return null;
  }
  const delta = tzDeltaLabel(tzDeltaMinutes(tz, now));
  return (
    <p className="xp-hero__clock">
      <Icon name="clock" size={15} />
      <span className="xp-hero__time tabular">{time}</span>
      {delta && <span className="xp-hero__delta">{delta}</span>}
    </p>
  );
}

function AirportView({ h, airport: a, settings, onBack }: { h: AirportHistory; airport: Airport | undefined; settings: Settings; onBack: () => void }) {
  const unit = settings.distanceUnit;
  const code = a?.iata || h.key;
  const place = a ? airportPlace(a) : undefined;
  const currentYear = new Date().getFullYear();

  const routes = useMemo<NetworkRoute[]>(
    () => (a ? h.destinations.filter((d) => d.airport).map((d) => ({ key: d.key, a, b: d.airport!, count: d.count })) : []),
    [a, h.destinations],
  );

  const destinations = useMemo<RankItem[]>(
    () =>
      h.destinations.map((d) => {
        const dc = d.airport?.iata || d.key;
        const dir = d.outbound && d.inbound ? `${d.outbound} out · ${d.inbound} back` : d.outbound ? 'Outbound only' : 'Inbound only';
        return {
          key: d.key,
          lead: <CodeChip>{dc}</CodeChip>,
          primary: d.airport ? d.airport.city || d.airport.name : 'Unknown airport',
          secondary: [d.distanceKm ? fmtDist(d.distanceKm, unit) : undefined, dir].filter(Boolean).join(' · '),
          count: d.count,
          to: airportHref(d.key),
          label: `${dc}${d.airport ? `, ${d.airport.city || d.airport.name}` : ''}: ${d.count} ${plural(d.count, 'flight')}`,
        };
      }),
    [h.destinations, unit],
  );

  const airlines = useMemo<RankItem[]>(
    () =>
      h.airlines.map((al) => ({
        key: al.key,
        lead: <AirlineLogo iata={al.iata} icao={al.icao} name={al.name} size={32} />,
        primary: al.name,
        secondary: [al.iata, al.icao].filter(Boolean).join(' · ') || undefined,
        count: al.count,
        to: airlineHref(al.key),
        label: `${al.name}: ${al.count} ${plural(al.count, 'flight')}`,
      })),
    [h.airlines],
  );

  const aircraft = useMemo<RankItem[]>(
    () =>
      h.aircraft.map((ac) => ({
        key: ac.key,
        lead: <CodeChip tone="amber">{ac.icao ?? '—'}</CodeChip>,
        primary: ac.name,
        count: ac.count,
      })),
    [h.aircraft],
  );

  const visited = h.visits > 0;
  const first = h.firstFlight;
  const last = h.lastFlight;

  return (
    <div className="xp">
      <TopBar title={a ? `${code} · ${a.city || a.name}` : code} sub="Airport" onBack={onBack} />

      <div className="xp-layout">
        <div className="xp-main">
          <article className="xp-hero animate-in xp-o1" aria-label={`${code} airport`}>
            {a && (
              <div className="xp-hero__map">
                <NetworkMap routes={routes} focus={a} label={visited ? `Routes you’ve flown to and from ${code}` : `Location of ${code}`} />
              </div>
            )}
            <div className="xp-hero__id">
              <div className="xp-hero__row">
                <h1 className="xp-hero__code">{code}</h1>
                <div className="xp-hero__badges">
                  {a && flagEmoji(a.country) && (
                    <span className="xp-hero__flag" role="img" aria-label={place?.country}>
                      {flagEmoji(a.country)}
                    </span>
                  )}
                  {a && a.ident !== code && <span className="xp-hero__ident">{a.ident}</span>}
                </div>
              </div>
              <p className="xp-hero__name">{a?.name ?? 'Unknown airport'}</p>
              {place && (
                <p className="xp-hero__place">
                  {place.city}
                  {place.country && <span className="xp-hero__country"> · {place.country}</span>}
                </p>
              )}
              {a?.tz && <LocalClock tz={a.tz} clock={settings.clock} />}
            </div>

            {visited && (
              <div className="xp-hero__body">
                <Tiles
                  tiles={[
                    { label: 'Visits', value: h.visits.toLocaleString('en-US') },
                    { label: 'Departures', value: h.departures.toLocaleString('en-US') },
                    { label: 'Arrivals', value: h.arrivals.toLocaleString('en-US') },
                  ]}
                />
                <dl className="xp-facts">
                  <div>
                    <dt>First visit</dt>
                    <dd>{first ? formatFlightDate(first.date, first.datePrecision === 'year' ? 'year' : 'month') : '—'}</dd>
                  </div>
                  <div>
                    <dt>Last visit</dt>
                    <dd>{last ? formatFlightDate(last.date, last.datePrecision === 'year' ? 'year' : 'month') : '—'}</dd>
                  </div>
                  <div>
                    <dt>Distance</dt>
                    <dd className="tabular">
                      {formatCompact(Math.round(unit === 'mi' ? kmToMiles(h.distanceKm) : h.distanceKm))}
                      <small> {unit}</small>
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </article>

          {visited && h.perYear.length > 0 && (
            <Card title="Visits per year" subtitle="Departures + arrivals" className="xp-o2">
              <YearChart data={h.perYear} noun={['visit', 'visits']} caption="visits per year" currentYear={currentYear} />
            </Card>
          )}

          {!visited && (
            <div className="xp-o2">
              <EmptyCard
                icon="plane"
                title={h.upcoming.length ? 'Your first visit is coming up' : 'You haven’t flown here yet'}
                action={
                  !h.upcoming.length && (
                    <Link to="/flights/new" className="btn btn--primary">
                      <Icon name="plus" size={18} /> Log a flight
                    </Link>
                  )
                }
              >
                {h.upcoming.length
                  ? `Once your flight to or from ${code} departs, its history will build up here.`
                  : `Flights to or from ${code} will show up here, with routes, airlines and visits per year.`}
              </EmptyCard>
            </div>
          )}

          <div className="xp-o4">
            <UpcomingList flights={h.upcoming} settings={settings} />
          </div>

          {visited && (
            <section className="xp-section xp-o5" aria-label="Flights">
              <h2 className="xp-section__title">
                Flights
                <span className="xp-section__count">{h.flights.length}</span>
                <Link to={`/?airport=${encodeURIComponent(h.key)}`} className="xp-section__link">
                  Open in log
                  <Icon name="chevron" size={14} />
                </Link>
              </h2>
              <FlightList flights={h.flights} settings={settings} />
            </section>
          )}
        </div>

        {visited && (
          <aside className="xp-side xp-o3">
            {destinations.length > 0 && (
              <Card
                title="Destinations from here"
                subtitle={`${destinations.length} ${plural(destinations.length, 'airport')}${h.destinationCountries > 1 ? ` in ${h.destinationCountries} countries` : ''} · both directions`}
              >
                <RankList items={destinations} noun={['flight', 'flights']} initial={6} />
              </Card>
            )}
            {airlines.length > 0 && (
              <Card title="Airlines" subtitle={`${airlines.length} ${plural(airlines.length, 'airline')} flown here`}>
                <RankList items={airlines} noun={['flight', 'flights']} />
              </Card>
            )}
            {aircraft.length > 0 && (
              <Card title="Aircraft seen" subtitle={`${aircraft.length} ${plural(aircraft.length, 'type')}`}>
                <RankList items={aircraft} noun={['flight', 'flights']} />
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
