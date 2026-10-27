import { useMemo, useState } from 'react';
import { useReferenceReady, getAirline, getAirport } from '@/data/reference';
import { airportCode } from '@/lib/flight-utils';
import { todayLocal, formatFlightDate } from '@/lib/time';
import {
  computeSummary,
  formatDistance,
} from '@/features/flights/flight-logic';
import { JourneyMap } from '@/features/flights/JourneyMap';
import { asFlights, type PublicProfile } from './profile';
import './public.css';
import '@/features/flights/Overview.css';
export function PublicDashboard({
  profile,
  preview = false,
}: {
  profile: PublicProfile;
  preview?: boolean;
}) {
  const ready = useReferenceReady();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(30);
  const flights = useMemo(
    () =>
      asFlights(profile.flights).sort((a, b) => b.date.localeCompare(a.date)),
    [profile.flights],
  );
  const summary = useMemo(
    () => computeSummary(flights, todayLocal()),
    [flights, ready],
  );
  const filtered = useMemo(
    () =>
      flights.filter((f) =>
        `${airportCode(f.from)} ${airportCode(f.to)} ${getAirport(f.from)?.city || ''} ${getAirport(f.to)?.city || ''} ${getAirport(f.from)?.name || ''} ${getAirport(f.to)?.name || ''} ${getAirline(f.airlineIcao || f.airlineIata)?.name || ''} ${f.date} ${formatFlightDate(f.date, f.datePrecision)}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [flights, query, ready],
  );
  if (!ready) return <p role="status">Loading airport information…</p>;
  return (
    <article className="public-dashboard">
      <header className="public-hero">
        <p className="public-eyebrow">
          {preview ? 'PUBLIC PROFILE PREVIEW' : 'FLIGHT JOURNAL'}
        </p>
        <h1>{profile.display_name}</h1>
        <p>A life in flight.</p>
        <dl className="public-totals">
          <div>
            <dt>Flights</dt>
            <dd>{summary.flights.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Distance</dt>
            <dd>{formatDistance(summary.distanceKm, 'mi')}</dd>
          </div>
          <div>
            <dt>Airports</dt>
            <dd>{summary.airports}</dd>
          </div>
          <div>
            <dt>Countries</dt>
            <dd>{summary.countries}</dd>
          </div>
        </dl>
      </header>
      <section className="card public-map" aria-label="Flight routes">
        <JourneyMap flights={flights} />
        <p>{summary.airports} airports. Countless memories.</p>
      </section>
      <section>
        <div className="public-section-heading">
          <h2>Flight history</h2>
          <span>{filtered.length} flights</span>
        </div>
        <label className="field">
          <span className="field__label">Find a flight</span>
          <input
            className="input"
            type="search"
            placeholder="City, airport, airline or date"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(30);
            }}
          />
        </label>
        <ul className="public-flight-list">
          {filtered.slice(0, limit).map((f) => (
            <li key={f.id}>
              <div>
                <strong
                  className="code"
                  aria-label={`From ${getAirport(f.from)?.city || airportCode(f.from)} (${airportCode(f.from)}) to ${getAirport(f.to)?.city || airportCode(f.to)} (${airportCode(f.to)})`}
                >
                  {airportCode(f.from)} <span aria-hidden="true">→</span>{' '}
                  {airportCode(f.to)}
                </strong>
                <span>
                  {getAirport(f.from)?.city || f.from} →{' '}
                  {getAirport(f.to)?.city || f.to}
                </span>
                <span>
                  {getAirline(f.airlineIcao || f.airlineIata)?.name ||
                    'Airline not recorded'}
                  {f.aircraftType ? ` · ${f.aircraftType}` : ''}
                </span>
              </div>
              <time
                dateTime={
                  f.datePrecision === 'year'
                    ? f.date.slice(0, 4)
                    : f.datePrecision === 'month'
                      ? f.date.slice(0, 7)
                      : f.date
                }
              >
                {formatFlightDate(f.date, f.datePrecision)}
              </time>
            </li>
          ))}
        </ul>
        {!filtered.length && (
          <p className="public-empty">
            {query
              ? 'No flights match your search.'
              : 'No flights have been shared yet.'}
          </p>
        )}
        {filtered.length > limit && (
          <button
            className="btn btn--block"
            onClick={() => setLimit((n) => n + 30)}
          >
            Show more flights
          </button>
        )}
      </section>
      <footer className="public-footer">
        Published {new Date(profile.published_at).toLocaleDateString()} · A
        shared snapshot; recent changes may not appear.
      </footer>
    </article>
  );
}
