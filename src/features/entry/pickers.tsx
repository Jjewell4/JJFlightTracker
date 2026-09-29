/** Domain pickers built on SearchSheet: airports, airlines, aircraft types. */
import { useCallback, useMemo } from 'react';
import { AirlineLogo } from '@/components/AirlineLogo';
import { getAircraftType, getAirline, getAirport, searchAircraftTypes, searchAirlines, searchAirports } from '@/data/reference';
import type { AircraftType, Airline, Airport } from '@/lib/types';
import type { AirlineInfo } from '@/services/lookup';
import { SearchSheet, type SheetSection } from './SearchSheet';
import { airportCity, airportPlace, flagEmoji } from './format';
import { routePartners, type UsageStats } from './history-stats';

/**
 * Moves items the user has flown before to the top of a ranked result list, unless the query
 * is an exact code match for the top hit (typing "LHR" must always put LHR first).
 */
export function boostUsed<T>(results: T[], used: readonly string[], key: (t: T) => string, isExact: (t: T) => boolean): T[] {
  if (!results.length || !used.length || isExact(results[0])) return results;
  const set = new Set(used);
  return [...results.filter((r) => set.has(key(r))), ...results.filter((r) => !set.has(key(r)))];
}

const toAirports = (idents: string[]) => idents.map((i) => getAirport(i)).filter((a): a is Airport => !!a);

export function AirportSheet({
  open,
  role,
  value,
  other,
  stats,
  onClose,
  onSelect,
}: {
  open: boolean;
  role: 'from' | 'to';
  value: string;
  /** The opposite endpoint (excluded from suggestions, used for "your routes"). */
  other: string;
  stats: UsageStats;
  onClose: () => void;
  onSelect: (ident: string) => void;
}) {
  const otherAirport = getAirport(other);
  const sections = useMemo(() => {
    if (!open) return [];
    const skip = new Set([otherAirport?.ident]);
    const take = (idents: string[], n: number) => {
      const out = toAirports(idents).filter((a) => !skip.has(a.ident)).slice(0, n);
      out.forEach((a) => skip.add(a.ident));
      return out;
    };
    const s: SheetSection<Airport>[] = [];
    if (otherAirport) {
      const partners = take(routePartners(stats, otherAirport.ident, role === 'from'), 4);
      const code = otherAirport.iata || otherAirport.ident;
      s.push({ title: role === 'to' ? `Your routes from ${code}` : `Your routes to ${code}`, items: partners });
    }
    s.push({ title: 'Recent', items: take(stats.recentAirports, 4) });
    s.push({ title: 'Frequent', items: take(stats.frequentAirports, 6) });
    return s;
  }, [open, otherAirport, role, stats]);

  const search = useCallback(
    (q: string) => {
      const upper = q.trim().toUpperCase();
      const hits = searchAirports(q, 20).filter((a) => a.ident !== otherAirport?.ident);
      return boostUsed(hits, stats.frequentAirports, (a) => a.ident, (a) => a.iata === upper || a.ident === upper);
    },
    [otherAirport, stats],
  );

  return (
    <SearchSheet<Airport>
      open={open}
      title={role === 'from' ? 'Departure airport' : 'Arrival airport'}
      placeholder="City, airport or code"
      onClose={onClose}
      onSelect={(a) => onSelect(a.ident)}
      search={search}
      sections={sections}
      getKey={(a) => a.ident}
      selectedKey={getAirport(value)?.ident}
      renderItem={(a) => <AirportOption a={a} />}
      emptyHint="Search by city, airport name, or IATA/ICAO code."
    />
  );
}

function AirportOption({ a }: { a: Airport }) {
  return (
    <>
      <span className="search-opt__code">{a.iata || a.ident}</span>
      <span className="search-opt__main">
        <span className="search-opt__title">
          {airportPlace(a)}
          <span className="search-opt__flag" aria-hidden="true">
            {flagEmoji(a.country)}
          </span>
        </span>
        <span className="search-opt__sub">
          {a.name !== airportCity(a) ? a.name : ''}
          {a.iata && a.ident !== a.iata ? <span className="search-opt__icao"> · {a.ident}</span> : null}
        </span>
      </span>
    </>
  );
}

export function AirlineSheet({
  open,
  value,
  stats,
  onClose,
  onSelect,
}: {
  open: boolean;
  value?: AirlineInfo;
  stats: UsageStats;
  onClose: () => void;
  onSelect: (a: AirlineInfo) => void;
}) {
  const sections = useMemo(
    () => (open ? [{ title: 'Your airlines', items: stats.airlines.map((c) => getAirline(c)).filter((a): a is Airline => !!a) }] : []),
    [open, stats],
  );
  const search = useCallback(
    (q: string) => {
      const upper = q.trim().toUpperCase();
      return boostUsed(searchAirlines(q, 20), stats.airlines, (a) => a.icao, (a) => a.iata === upper || a.icao === upper);
    },
    [stats],
  );
  return (
    <SearchSheet<Airline>
      open={open}
      title="Airline"
      placeholder="Airline name or code"
      onClose={onClose}
      onSelect={(a) => onSelect({ icao: a.icao, iata: a.iata || undefined, name: a.name })}
      search={search}
      sections={sections}
      getKey={(a) => a.icao}
      selectedKey={value?.icao}
      renderItem={(a) => (
        <>
          <AirlineLogo iata={a.iata} icao={a.icao} name={a.name} size={36} />
          <span className="search-opt__main">
            <span className="search-opt__title">{a.name}</span>
            <span className="search-opt__sub">
              {a.iata && <span className="mono">{a.iata}</span>}
              {a.iata && ' · '}
              <span className="mono">{a.icao}</span>
              {a.country ? ` · ${a.country}` : ''}
              {!a.active ? ' · defunct' : ''}
            </span>
          </span>
        </>
      )}
      custom={(q, results) =>
        results.some((r) => r.name.toLowerCase() === q.toLowerCase())
          ? undefined
          : { label: <>Use “{q}”</>, onPick: () => onSelect({ name: q }) }
      }
      emptyHint="Search by airline name, IATA (UA) or ICAO (UAL) code."
    />
  );
}

export function AircraftSheet({
  open,
  value,
  stats,
  onClose,
  onSelect,
}: {
  open: boolean;
  value: string;
  stats: UsageStats;
  onClose: () => void;
  onSelect: (a: { icao?: string; name: string }) => void;
}) {
  const sections = useMemo(
    () => (open ? [{ title: 'Your aircraft', items: stats.aircraft.map((c) => getAircraftType(c)).filter((a): a is AircraftType => !!a) }] : []),
    [open, stats],
  );
  const search = useCallback(
    (q: string) => {
      const upper = q.trim().toUpperCase();
      return boostUsed(searchAircraftTypes(q, 20), stats.aircraft, (a) => a.icao, (a) => a.icao === upper || a.iata === upper);
    },
    [stats],
  );
  return (
    <SearchSheet<AircraftType>
      open={open}
      title="Aircraft type"
      placeholder="e.g. 737-800, A321neo, B789"
      onClose={onClose}
      onSelect={(a) => onSelect({ icao: a.icao, name: a.name })}
      search={search}
      sections={sections}
      getKey={(a) => a.icao}
      selectedKey={value}
      renderItem={(a) => (
        <>
          <span className="search-opt__code search-opt__code--sm">{a.icao}</span>
          <span className="search-opt__main">
            <span className="search-opt__title">{a.name}</span>
            {a.iata && <span className="search-opt__sub">IATA {a.iata}</span>}
          </span>
        </>
      )}
      custom={(q, results) => (results.length && results[0].name.toLowerCase() === q.toLowerCase() ? undefined : { label: <>Use “{q}”</>, onPick: () => onSelect({ name: q }) })}
      emptyHint="Search by model name or ICAO type code."
    />
  );
}
