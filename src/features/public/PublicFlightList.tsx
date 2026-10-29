import { useMemo, useState, type CSSProperties } from 'react';
import { Icon } from '@/components/Icon';
import { getAirline, getAirport } from '@/data/reference';
import { FlightRow } from '@/features/flights/FlightRow';
import { formatDistance, groupFlights, limitGroups } from '@/features/flights/flight-logic';
import { airportCode } from '@/lib/flight-utils';
import type { ViewParams } from '@/lib/flight-source';
import { formatFlightDate } from '@/lib/time';
import type { Flight, Settings } from '@/lib/types';
import '@/features/flights/FlightsPage.css';

const PAGE = 40;

/**
 * Flights grouped by year and month exactly like the app's log, with the same rows.
 * Public journals have no flight pages, so rows are never links.
 */
export function PublicFlightGroups({ flights, unit, limit = Infinity }: { flights: Flight[]; unit: Settings['distanceUnit']; limit?: number }) {
  const groups = useMemo(() => {
    const all = groupFlights(flights);
    return limit >= flights.length ? all : limitGroups(all, limit);
  }, [flights, limit]);
  return (
    <>
      {groups.map((y) => (
        <section key={y.year} className="fyear" aria-label={`${y.year}: ${y.count} ${y.count === 1 ? 'flight' : 'flights'}`}>
          <h3 className="fyear__head">
            <span className="fyear__year">{y.year}</span>
            <span className="fyear__meta tabular">
              {y.count} {y.count === 1 ? 'flight' : 'flights'}
              <span className="fyear__sep" aria-hidden>
                ·
              </span>
              {formatDistance(y.distanceKm, unit)}
            </span>
          </h3>
          {y.months.map((m) => (
            <div key={m.key} className="fmonth" style={{ '--n': m.flights.length } as CSSProperties}>
              <h4 className="fmonth__label">
                {m.label}
                <span className="fmonth__count">{m.flights.length}</span>
              </h4>
              <div className="flist">
                {m.flights.map((f) => (
                  <FlightRow key={f.id} flight={f} unit={unit} clock="12h" linkless />
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}
    </>
  );
}

function matches(f: Flight, q: string): boolean {
  if (!q) return true;
  const from = getAirport(f.from);
  const to = getAirport(f.to);
  return `${airportCode(f.from)} ${airportCode(f.to)} ${from?.city || ''} ${to?.city || ''} ${from?.name || ''} ${to?.name || ''} ${getAirline(f.airlineIcao || f.airlineIata)?.name || ''} ${f.aircraftType || ''} ${f.flightNumber || ''} ${f.date} ${formatFlightDate(f.date, f.datePrecision)}`
    .toLowerCase()
    .includes(q);
}

/** Searchable flight history, grouped by year, with filters from the map or stats. */
export function PublicFlightList({ flights, params, unit }: { flights: Flight[]; params: ViewParams; unit: Settings['distanceUnit'] }) {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const airport = params.get('airport');
  const yearRaw = params.get('year');
  const year = yearRaw && /^\d{4}$/.test(yearRaw) ? yearRaw : null;
  const airportInfo = airport ? getAirport(airport) : undefined;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const key = airportInfo?.ident ?? airport?.toUpperCase();
    return flights.filter(
      (f) => (!year || f.date.startsWith(year)) && (!key || [f.from, f.to].some((id) => (getAirport(id)?.ident ?? id.toUpperCase()) === key)) && matches(f, q),
    );
  }, [flights, query, year, airport, airportInfo]);

  const filters: { key: string; label: string }[] = [];
  if (airport)
    filters.push({ key: 'airport', label: airportInfo ? `${airportInfo.iata || airportInfo.ident} · ${airportInfo.city || airportInfo.name}` : airport });
  if (year) filters.push({ key: 'year', label: year });

  return (
    <section className="flights pj-flights" aria-labelledby="pj-flights-title">
      <div className="pj-section-head">
        <h2 id="pj-flights-title">Flight history</h2>
        <span>
          {filtered.length === flights.length
            ? `${flights.length.toLocaleString('en-US')} ${flights.length === 1 ? 'flight' : 'flights'}`
            : `${filtered.length.toLocaleString('en-US')} of ${flights.length.toLocaleString('en-US')}`}
        </span>
      </div>
      <label className="field pj-search">
        <span className="field__label">Find a flight</span>
        <span className="pj-search__box">
          <Icon name="search" size={18} />
          <input
            className="input"
            type="search"
            placeholder="City, airport, airline or date"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
          />
        </span>
      </label>
      {filters.length > 0 && (
        <div className="pj-filters" aria-label="Active filters">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              className="chip pj-filter"
              aria-label={`Remove filter ${f.label}`}
              onClick={() => {
                params.set(f.key, null);
                setLimit(PAGE);
              }}
            >
              {f.label}
              <Icon name="close" size={14} />
            </button>
          ))}
        </div>
      )}
      <PublicFlightGroups flights={filtered} unit={unit} limit={limit} />
      {!filtered.length && <p className="pj-empty">{query || filters.length ? 'No flights match your search.' : 'No flights have been shared yet.'}</p>}
      {filtered.length > limit && (
        <button className="btn btn--block" onClick={() => setLimit((n) => n + PAGE)}>
          Show more flights
        </button>
      )}
    </section>
  );
}
