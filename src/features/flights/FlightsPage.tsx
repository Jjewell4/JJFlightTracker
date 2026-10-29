import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { getAirport, useReferenceReady } from '@/data/reference';
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
  onThisDay,
  splitUpcoming,
  type FlightFilters,
} from './flight-logic';
import { FlightRow, FlightRowSkeleton } from './FlightRow';
import { SearchBar } from './SearchBar';
import { SummaryHero, SummaryHeroSkeleton } from './SummaryHero';
import { ReviewBanner } from '@/features/review/ReviewBanner';
import { ForeignFlights } from '@/features/settings/ForeignFlights';
import { UpcomingCard } from './UpcomingCard';
import { OnThisDay } from './OnThisDay';
import { LogViewSwitch, TripsList, useLogView } from '@/features/trips/TripsList';
import './FlightsPage.css';
import { JourneyMap } from './JourneyMap';
import './FlightDetailPage.css';
import './Overview.css';

// Survives navigating to a flight and back (module scope = this browser session).
const memory = { limit: 40, query: '', filters: {} as FlightFilters, scrollY: 0 };
const FIRST_PAINT = 40;

export function FlightsPage() {
  const { pathname } = useLocation();
  const archive = pathname === '/flights';
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
  // Log tab: "Flights | Trips" (?view=trips, else the view last used this session).
  const [view, setView] = useLogView(archive);
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
  const memories = useMemo(() => (archive ? [] : onThisDay(past, today)), [archive, past, today]);
  const options = useMemo(() => filterOptions(all), [all, ready]);
  const index = useMemo(() => new Map(all.map((f) => [f.id, flightSearchText(f)])), [all, ready]);

  const filtering = q.trim() !== '' || activeFilterCount(filters) > 0;
  const match = (f: Flight) => matchesFilters(f, filters) && matchesSearch(index.get(f.id) ?? '', q);
  const shownUpcoming = useMemo(() => (filtering ? upcoming.filter(match) : upcoming), [upcoming, filtering, q, filters, index]);
  const shownPast = useMemo(() => (filtering ? past.filter(match) : past), [past, filtering, q, filters, index]);
  const allGroups = useMemo(() => groupFlights(shownPast), [shownPast, ready]);

  // Keep the overview concise; the full log expands in bounded batches.
  const [limit, setLimit] = useState(memory.limit);
  const displayLimit = archive || filtering ? limit : 5;
  const complete = displayLimit >= shownPast.length;
  const previousFilter = useRef({ q, filters });
  useEffect(() => {
    if (previousFilter.current.q !== q || previousFilter.current.filters !== filters) { setLimit(FIRST_PAINT); memory.limit = FIRST_PAINT; }
    previousFilter.current = { q, filters };
  }, [q, filters]);
  const groups = useMemo(() => (complete ? allGroups : limitGroups(allGroups, displayLimit)), [allGroups, displayLimit, complete]);

  // Keep sticky year headers tucked under the sticky search bar.
  useLayoutEffect(() => {
    const el = searchRef.current;
    const page = pageRef.current;
    if (!el || !page || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => page.style.setProperty('--fsearch-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  });

  // Restore scroll position when coming back from a flight. Tracking stops the moment
  // this screen goes away, so the next screen's scroll-to-top doesn't overwrite it.
  const alive = useRef(true);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const loaded = flights !== undefined && ready;
  useEffect(() => {
    if (!loaded) return;
    if (memory.scrollY) window.scrollTo(0, memory.scrollY);
    const save = () => {
      if (alive.current) memory.scrollY = window.scrollY;
    };
    window.addEventListener('scroll', save, { passive: true });
    return () => window.removeEventListener('scroll', save);
  }, [loaded]);

  if (flights === undefined) return <FlightsSkeleton />;
  if (flights.length === 0) return <EmptyState />;
  if (!ready) return <FlightsSkeleton />;

  const featured = upcoming[0] ?? past[0];
  const from = featured && getAirport(featured.from);
  const to = featured && getAirport(featured.to);
  const resultCount = shownPast.length + shownUpcoming.length;
  // Home dashboard order: summary, upcoming, route map, recent journeys, memories, where to next.
  const home = !archive && !filtering;

  return (
    <div
      className="flights"
      ref={pageRef}
      onClickCapture={(e) => {
        // Leaving via a link (flight, stats…): pin the position now — the next screen may
        // suspend and hide this one, which clamps the scroll to 0 before we unmount.
        if ((e.target as Element).closest('a[href]')) {
          memory.scrollY = window.scrollY;
          alive.current = false;
        }
      }}
    >
      <header className="page-header flights__header">
        <div>
          <h1 className="page-title">{archive ? 'Flight log' : 'Your flight journal'}</h1>
          <p className="page-subtitle">{archive ? 'Every journey, easy to find.' : 'The places you’ve been. The journeys still ahead.'}</p>
        </div>
      </header>
      {archive && <LogViewSwitch value={view} onChange={setView} />}
      {view === 'trips' ? <TripsList flights={all} unit={unit} today={today} /> : <>

      {!archive && <SummaryHero summary={summary} unit={unit} upcoming={upcoming.length} />}

      {home && <ForeignFlights />}
      {home && <ReviewBanner className="rbanner--home" />}

      {!archive && !filtering && shownUpcoming.length > 0 && (
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

      {home && featured && from && to && (
        <Link to="/map" className="overview__map overview__map--solo card" aria-label="Open your route map">
          <div className="overview__heading"><Icon name="globe" size={20} /><span>Your route map</span><Icon name="chevron" size={16} /></div>
          <JourneyMap flights={past} />
          <div className="overview__caption">{summary.airports} airports · {summary.countries} countries<span>Open map</span></div>
        </Link>
      )}

      <div className="overview__section-head"><h2 className="section-title">{archive || filtering ? 'Your flights' : 'Recent journeys'}</h2>{!archive && <Link to="/flights">View full log <Icon name="chevron" size={14} /></Link>}</div>
      {(archive || filtering) && <SearchBar ref={searchRef} query={query} onQuery={setQuery} filters={filters} onFilters={setFilters} options={options} />}

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


      {(archive || filtering) && shownUpcoming.length > 0 && (
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
      {!complete && (archive || filtering) && <button className="btn btn--block" onClick={() => setLimit((n) => { memory.limit = n + FIRST_PAINT; return memory.limit; })}>Show more flights ({shownPast.length - limit} remaining)</button>}

      {home && <OnThisDay memories={memories} />}

      {home && featured && from && to && (
        <div className="overview__actions overview__actions--solo card">
          <h2>Where to next?</h2><p>{upcoming.length ? 'Next up' : 'Last flown'}: {from.iata || from.ident} → {to.iata || to.ident}. Add a new journey or reuse this route.</p>
          <Link className="btn btn--primary" to="/flights/new"><Icon name="plus" size={18} />Log a flight</Link>
          <Link className="btn" to={`/flights/new?return=${encodeURIComponent(featured.id)}`}><Icon name="swap" size={18} />Add the return</Link>
          <Link className="btn btn--ghost" to={`/flights/new?duplicate=${encodeURIComponent(featured.id)}`}>Fly this route again</Link>
        </div>
      )}
      </>}
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
