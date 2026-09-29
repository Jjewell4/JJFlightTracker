import { startTransition, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { useReferenceReady } from '@/data/reference';
import { useFlights, useSettings } from '@/lib/db';
import { todayLocal } from '@/lib/time';
import type { Flight } from '@/lib/types';
import { EmptyState } from './EmptyState';
import {
  activeFilterCount,
  computeSummary,
  filterOptions,
  flightDistanceSum,
  flightSearchText,
  formatDistance,
  groupFlights,
  limitGroups,
  matchesFilters,
  matchesSearch,
  splitUpcoming,
  type FlightFilters,
} from './flight-logic';
import { FlightRow, FlightRowSkeleton } from './FlightRow';
import { SearchBar } from './SearchBar';
import { SummaryHero, SummaryHeroSkeleton } from './SummaryHero';
import { UpcomingCard } from './UpcomingCard';
import './FlightsPage.css';

// Survives navigating to a flight and back (module scope = this browser session).
const memory = { query: '', filters: {} as FlightFilters, scrollY: 0 };
const FIRST_PAINT = 40;

export function FlightsPage() {
  const flights = useFlights();
  const ready = useReferenceReady();
  const { distanceUnit: unit, clock } = useSettings();
  const [query, setQuery] = useState(memory.query);
  const [filters, setFilters] = useState<FlightFilters>(memory.filters);
  // Deep links such as /?airport=KSAN&year=2024 (from the map) apply filters once, then clear the URL.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const linked: FlightFilters = {};
    for (const key of ['year', 'airline', 'airport'] as const) {
      const v = searchParams.get(key);
      if (v) linked[key] = v;
    }
    if (Object.keys(linked).length) {
      setQuery('');
      setFilters(linked);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);
  const q = useDeferredValue(query);
  const searchRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    memory.query = query;
    memory.filters = filters;
  }, [query, filters]);

  // "Today" is fixed per visit; good enough for countdowns and upcoming split.
  const [{ today, now }] = useState(() => ({ today: todayLocal(), now: Date.now() }));

  const all = flights ?? [];
  const { upcoming, past } = useMemo(() => splitUpcoming(all, now, today), [all, now, today, ready]);
  const summary = useMemo(() => computeSummary(past, today), [past, today, ready]);
  const options = useMemo(() => filterOptions(all), [all, ready]);
  const index = useMemo(() => new Map(all.map((f) => [f.id, flightSearchText(f)])), [all, ready]);

  const filtering = q.trim() !== '' || activeFilterCount(filters) > 0;
  const match = (f: Flight) => matchesFilters(f, filters) && matchesSearch(index.get(f.id) ?? '', q);
  const shownUpcoming = useMemo(() => (filtering ? upcoming.filter(match) : upcoming), [upcoming, filtering, q, filters, index]);
  const shownPast = useMemo(() => (filtering ? past.filter(match) : past), [past, filtering, q, filters, index]);
  const allGroups = useMemo(() => groupFlights(shownPast), [shownPast, ready]);

  // Progressive rendering: paint the first screenful immediately, the rest in a transition.
  const [limit, setLimit] = useState(FIRST_PAINT);
  const complete = limit >= shownPast.length;
  useEffect(() => {
    if (complete) return;
    const t = setTimeout(() => startTransition(() => setLimit(Infinity)), 16);
    return () => clearTimeout(t);
  }, [complete]);
  const groups = useMemo(() => (complete ? allGroups : limitGroups(allGroups, limit)), [allGroups, limit, complete]);

  // Keep sticky year headers tucked under the sticky search bar.
  useLayoutEffect(() => {
    const el = searchRef.current;
    const page = pageRef.current;
    if (!el || !page || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => page.style.setProperty('--fsearch-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  });

  // Restore scroll position when coming back from a flight.
  const loaded = flights !== undefined && ready && complete;
  useEffect(() => {
    if (!loaded) return;
    if (memory.scrollY) window.scrollTo(0, memory.scrollY);
    const save = () => (memory.scrollY = window.scrollY);
    window.addEventListener('scroll', save, { passive: true });
    return () => window.removeEventListener('scroll', save);
  }, [loaded]);

  if (flights === undefined) return <FlightsSkeleton />;
  if (flights.length === 0) return <EmptyState />;
  if (!ready) return <FlightsSkeleton />;

  const resultCount = shownPast.length + shownUpcoming.length;

  return (
    <div className="flights" ref={pageRef}>
      <header className="page-header flights__header">
        <div>
          <h1 className="page-title">Flights</h1>
        </div>
        <Link to="/import" className="btn btn--ghost btn--icon flights__import" aria-label="Import flights">
          <Icon name="upload" size={20} />
        </Link>
      </header>

      <SummaryHero summary={summary} unit={unit} upcoming={upcoming.length} />

      <SearchBar ref={searchRef} query={query} onQuery={setQuery} filters={filters} onFilters={setFilters} options={options} />

      {filtering && (
        <p className="flights__results" aria-live="polite">
          {resultCount === 0 ? (
            'No matching flights'
          ) : (
            <>
              <strong>{resultCount}</strong> {resultCount === 1 ? 'flight' : 'flights'} · {formatDistance(flightDistanceSum([...shownPast, ...shownUpcoming]), unit)}
            </>
          )}
        </p>
      )}

      {shownUpcoming.length > 0 && (
        <section className="flights__upcoming" aria-labelledby="upcoming-title">
          <h2 id="upcoming-title" className="section-title">
            Upcoming <span className="flights__count">{shownUpcoming.length}</span>
          </h2>
          <div className="flights__upcoming-list">
            {shownUpcoming.map((f) => (
              <UpcomingCard key={f.id} flight={f} today={today} clock={clock} />
            ))}
          </div>
        </section>
      )}

      {resultCount === 0 && filtering ? (
        <div className="empty flights__none">
          <Icon name="search" size={28} />
          <div className="empty__title">Nothing found</div>
          <p>Try a flight number, airport code, city, airline or tail number.</p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setQuery('');
              setFilters({});
            }}
          >
            Clear search & filters
          </button>
        </div>
      ) : (
        groups.map((y) => (
          <section key={y.year} className="fyear" aria-labelledby={`year-${y.year}`}>
            <h2 id={`year-${y.year}`} className="fyear__head">
              <span className="fyear__year">{y.year}</span>
              <span className="fyear__meta tabular">
                {y.count} {y.count === 1 ? 'flight' : 'flights'}
                <span className="fyear__sep" aria-hidden>
                  ·
                </span>
                {formatDistance(y.distanceKm, unit)}
              </span>
            </h2>
            {y.months.map((m) => (
              <div key={m.key} className="fmonth" style={{ '--n': m.flights.length } as React.CSSProperties}>
                <h3 className="fmonth__label">
                  {m.label}
                  <span className="fmonth__count">{m.flights.length}</span>
                </h3>
                <div className="flist">
                  {m.flights.map((f) => (
                    <FlightRow key={f.id} flight={f} unit={unit} clock={clock} />
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}

function FlightsSkeleton() {
  return (
    <div className="flights" aria-busy="true" aria-label="Loading flights">
      <header className="page-header flights__header">
        <h1 className="page-title">Flights</h1>
      </header>
      <SummaryHeroSkeleton />
      <div className="fsearch fsearch--skeleton">
        <div className="skeleton" style={{ height: 44, borderRadius: 'var(--radius-md)' }} />
      </div>
      <div className="fmonth">
        <div className="skeleton" style={{ width: 90, height: 12, margin: 'var(--space-5) 0 var(--space-3)' }} />
        <div className="flist">
          {Array.from({ length: 6 }, (_, i) => (
            <FlightRowSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
