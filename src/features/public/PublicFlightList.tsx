import { useMemo, useState } from 'react';
import { AirlineLogo } from '@/components/AirlineLogo';
import { Icon } from '@/components/Icon';
import { getAirline, getAirport } from '@/data/reference';
import { airportCode } from '@/lib/flight-utils';
import type { ViewParams } from '@/lib/flight-source';
import { formatFlightDate } from '@/lib/time';
import type { Flight } from '@/lib/types';

const PAGE = 40;

const dateTime = (f: Flight) => (f.datePrecision === 'year' ? f.date.slice(0, 4) : f.datePrecision === 'month' ? f.date.slice(0, 7) : f.date);

/** One shared flight. Public journals have no flight pages, so rows are never links. */
export function PublicFlightRow({ f }: { f: Flight }) {
  const from = getAirport(f.from);
  const to = getAirport(f.to);
  const airline = getAirline(f.airlineIcao || f.airlineIata);
  return (
    <li className="pj-flight">
      <AirlineLogo iata={airline?.iata || f.airlineIata} icao={airline?.icao || f.airlineIcao} name={airline?.name} size={36} />
      <div className="pj-flight__main">
        <strong
          className="pj-flight__route code"
          aria-label={`From ${from?.city || airportCode(f.from)} (${airportCode(f.from)}) to ${to?.city || airportCode(f.to)} (${airportCode(f.to)})`}
        >
          {airportCode(f.from)} <span aria-hidden="true">→</span> {airportCode(f.to)}
        </strong>
        <span className="pj-flight__cities">
          {from?.city || f.from} → {to?.city || f.to}
        </span>
        <span className="pj-flight__meta">
          {airline?.name || 'Airline not recorded'}
          {f.aircraftType ? ` · ${f.aircraftType}` : ''}
        </span>
      </div>
      <time className="pj-flight__date" dateTime={dateTime(f)}>
        {formatFlightDate(f.date, f.datePrecision)}
      </time>
    </li>
  );
}

function matches(f: Flight, q: string): boolean {
  if (!q) return true;
  const from = getAirport(f.from);
  const to = getAirport(f.to);
  return `${airportCode(f.from)} ${airportCode(f.to)} ${from?.city || ''} ${to?.city || ''} ${from?.name || ''} ${to?.name || ''} ${getAirline(f.airlineIcao || f.airlineIata)?.name || ''} ${f.aircraftType || ''} ${f.date} ${formatFlightDate(f.date, f.datePrecision)}`
    .toLowerCase()
    .includes(q);
}

/** Searchable flight history, grouped by year, with filters from the map or stats. */
export function PublicFlightList({ flights, params }: { flights: Flight[]; params: ViewParams }) {
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
      (f) =>
        (!year || f.date.startsWith(year)) &&
        (!key || [f.from, f.to].some((id) => (getAirport(id)?.ident ?? id.toUpperCase()) === key)) &&
        matches(f, q),
    );
  }, [flights, query, year, airport, airportInfo]);

  const groups = useMemo(() => {
    const out: { year: string; total: number; flights: Flight[] }[] = [];
    const totals = new Map<string, number>();
    for (const f of filtered) totals.set(f.date.slice(0, 4), (totals.get(f.date.slice(0, 4)) ?? 0) + 1);
    for (const f of filtered.slice(0, limit)) {
      const y = f.date.slice(0, 4);
      if (out[out.length - 1]?.year !== y) out.push({ year: y, total: totals.get(y) ?? 0, flights: [] });
      out[out.length - 1].flights.push(f);
    }
    return out;
  }, [filtered, limit]);

  const filters: { key: string; label: string }[] = [];
  if (airport) filters.push({ key: 'airport', label: airportInfo ? `${airportInfo.iata || airportInfo.ident} · ${airportInfo.city || airportInfo.name}` : airport });
  if (year) filters.push({ key: 'year', label: year });

  return (
    <section className="pj-flights" aria-labelledby="pj-flights-title">
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
      {groups.map((g) => (
        <div key={g.year} className="pj-year">
          <h3 className="pj-year__title">
            {g.year}
            <span>
              {g.total} {g.total === 1 ? 'flight' : 'flights'}
            </span>
          </h3>
          <ul className="pj-flight-list">
            {g.flights.map((f) => (
              <PublicFlightRow key={f.id} f={f} />
            ))}
          </ul>
        </div>
      ))}
      {!filtered.length && <p className="pj-empty">{query || filters.length ? 'No flights match your search.' : 'No flights have been shared yet.'}</p>}
      {filtered.length > limit && (
        <button className="btn btn--block" onClick={() => setLimit((n) => n + PAGE)}>
          Show more flights
        </button>
      )}
    </section>
  );
}
