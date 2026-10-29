import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '@/components/Icon';
import { useFlightSource, withFlightSource, type FlightFields, type ViewParams } from '@/lib/flight-source';
import { useReferenceReady } from '@/data/reference';
import { flownFlights } from '@/lib/flight-utils';
import { availableYears, computeStats, filterByYear, flightYear, summarizeTotals, type Insight, type YearScope } from '@/lib/stats';
import type { Flight } from '@/lib/types';
import { insightAvailable, statsSections } from './sections';
import { Hero } from './Hero';
import { TimeCharts } from './TimeCharts';
import { TravelCalendar } from './TravelCalendar';
import { Breakdowns } from './Breakdowns';
import { TopLists } from './TopLists';
import { Records } from './Records';
import { Places } from './Places';
import { Footprint } from './Footprint';
import { fmtInt, plural } from './format';
import './charts/charts.css';
import './StatsPage.css';

interface StatsPageProps {
  /** Rendered inside another page (the public journal), which supplies its own heading. */
  embedded?: boolean;
}

function StatsPage({ embedded = false }: StatsPageProps) {
  const source = useFlightSource();
  const all = source.flights;
  const refReady = useReferenceReady();
  // Stats describe flights already flown; upcoming trips are listed on the Flights tab.
  const flights = useMemo(() => (all && refReady ? flownFlights(all) : undefined), [all, refReady]);

  if (!flights || !all) return <StatsSkeleton embedded={embedded} />;
  if (!flights.length) return <StatsEmpty upcoming={all.length} readOnly={source.readOnly} embedded={embedded} />;
  return (
    <StatsDashboard
      flights={flights}
      upcoming={all.length - flights.length}
      unit={source.unit}
      clock={source.clock}
      homeCountry={source.homeCountry}
      readOnly={source.readOnly}
      fields={source.fields}
      params={source.params}
      embedded={embedded}
    />
  );
}

export default withFlightSource(StatsPage);

function useScope(years: number[], params: ViewParams): [YearScope, (s: YearScope) => void] {
  const raw = params.get('year');
  const n = raw ? Number(raw) : NaN;
  const scope: YearScope = Number.isFinite(n) && years.includes(n) ? n : 'all';
  const set = (s: YearScope) => params.set('year', s === 'all' ? null : String(s));
  return [scope, set];
}

interface DashboardProps {
  flights: Flight[];
  upcoming: number;
  unit: 'mi' | 'km';
  clock: '12h' | '24h';
  homeCountry: string;
  readOnly: boolean;
  fields: FlightFields;
  params: ViewParams;
  embedded: boolean;
}

function StatsDashboard({ flights, upcoming, unit, clock, homeCountry, readOnly, fields, params, embedded }: DashboardProps) {
  const years = useMemo(() => availableYears(flights), [flights]);
  const [scope, setScope] = useScope(years, params);
  const scoped = useMemo(() => filterByYear(flights, scope), [flights, scope]);
  const stats = useMemo(
    () => computeStats(scoped, { homeCountry, distanceUnit: unit, audience: readOnly ? 'visitor' : 'owner' }),
    [scoped, homeCountry, unit, readOnly],
  );
  const sections = useMemo(() => statsSections(fields, stats), [fields, stats]);
  const insights = useMemo(() => stats.insights.filter((i) => insightAvailable(i.id, fields)), [stats.insights, fields]);
  const prev = useMemo(() => {
    if (scope === 'all') return undefined;
    const before = filterByYear(flights, scope - 1);
    return before.length ? summarizeTotals(before) : undefined;
  }, [flights, scope]);
  // Lifetime distance through the end of the selected year, for the Earth/Moon tile.
  const lifetimeKm = useMemo(
    () => (scope === 'all' ? undefined : summarizeTotals(flights.filter((f) => flightYear(f) <= scope)).distanceKm),
    [flights, scope],
  );
  const countsByYear = useMemo(() => {
    const m = new Map<number, number>();
    for (const f of flights) m.set(flightYear(f), (m.get(flightYear(f)) ?? 0) + 1);
    return m;
  }, [flights]);
  const currentYear = new Date().getFullYear();
  const q = stats.quality;
  const t = stats.totals;

  return (
    <div className={`stats${embedded ? ' stats--embedded' : ''}`}>
      {embedded ? (
        <h2 className="visually-hidden">Stats</h2>
      ) : (
        <header className="page-header stats-header">
          <div>
            <h1 className="page-title">Stats</h1>
            <p className="page-subtitle">
              {fmtInt(flights.length)} {plural(flights.length, 'flight')} flown
              {years.length > 1 ? ` · ${years[years.length - 1]}–${years[0]}` : years.length ? ` · ${years[0]}` : ''}
              {upcoming > 0 && <span title="Upcoming flights are counted once they depart">{` · ${upcoming} upcoming`}</span>}
            </p>
          </div>
        </header>
      )}

      <ScopeChips years={years} scope={scope} onChange={setScope} counts={countsByYear} total={flights.length} />

      <nav className="stats-jump" aria-label="Statistics sections">
        {['Summary', 'Patterns', 'Records', 'Favorites', 'Places'].map((label) => <button key={label} type="button" onClick={() => document.getElementById(`stats-${label.toLowerCase()}`)?.scrollIntoView({block: 'start'})}>{label}</button>)}
      </nav>
      <div className="stats-body" id="stats-summary">
        <div className="stats-top">
          <Hero stats={stats} scope={scope} unit={unit} prev={prev} firstYear={years[years.length - 1]} timeEstimated={sections.timeEstimated} lifetimeKm={lifetimeKm} />
        </div>

        {insights.length > 0 && <Insights items={insights} />}

        <div id="stats-patterns" /><TimeCharts stats={stats} scope={scope} unit={unit} clock={clock} currentYear={currentYear} sections={sections} readOnly={readOnly} />
        {sections.calendar && <TravelCalendar flights={flights} scope={scope} readOnly={readOnly} />}
        <Breakdowns stats={stats} unit={unit} sections={sections} readOnly={readOnly} />
        <Records stats={stats} unit={unit} sections={sections} readOnly={readOnly} />
        <div id="stats-favorites" /><TopLists stats={stats} unit={unit} sections={sections} readOnly={readOnly} />
        <Places stats={stats} homeCountry={homeCountry} />
        <Footprint stats={stats} readOnly={readOnly} />

        <footer className="stats-notes">
          <Icon name="info" size={14} />
          {readOnly ? (
            <p>
              Distances are great-circle between airports. Shared journals include only routes, {fields.exactDates ? 'dates' : 'months'}, airlines and aircraft, so time in the
              air is estimated from distance{fields.exactDates ? '' : ' and day-of-week patterns aren’t shown'}.
              {q.unknownAirports > 0 && ` ${q.unknownAirports} unrecognized ${plural(q.unknownAirports, 'airport')} ${q.unknownAirports === 1 ? 'is' : 'are'} excluded from distance and places.`}
            </p>
          ) : (
            <p>
              Distances are great-circle between airports.
              {t.estimatedDuration - q.implausibleDuration > 0 &&
                ` ${fmtInt(t.estimatedDuration - q.implausibleDuration)} ${plural(t.estimatedDuration - q.implausibleDuration, 'flight has', 'flights have')} no recorded time, so ${t.estimatedDuration - q.implausibleDuration === 1 ? 'its' : 'their'} time in the air is estimated from distance.`}
              {q.implausibleDuration > 0 && ` ${fmtInt(q.implausibleDuration)} recorded ${plural(q.implausibleDuration, 'time looks', 'times look')} off for the distance (likely a time-zone mix-up) and ${q.implausibleDuration === 1 ? 'was' : 'were'} replaced by an estimate.`}
              {q.unknownAirports > 0 && ` ${q.unknownAirports} unrecognized ${plural(q.unknownAirports, 'airport')} ${q.unknownAirports === 1 ? 'is' : 'are'} excluded from distance and places.`}
              {q.yearPrecision + q.monthPrecision > 0 && ` ${q.yearPrecision + q.monthPrecision} ${plural(q.yearPrecision + q.monthPrecision, 'flight')} without an exact date ${q.yearPrecision + q.monthPrecision === 1 ? 'is' : 'are'} left out of day-of-week charts.`}
            </p>
          )}
        </footer>
      </div>
    </div>
  );
}

function ScopeChips({ years, scope, onChange, counts, total }: { years: number[]; scope: YearScope; onChange: (s: YearScope) => void; counts: Map<number, number>; total: number }) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the selected chip in view (e.g. when opened via ?year=).
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [scope]);
  const opts: { value: YearScope; label: string; count: number }[] = [{ value: 'all', label: 'All time', count: total }, ...years.map((y) => ({ value: y as YearScope, label: String(y), count: counts.get(y) ?? 0 }))];
  return (
    <div className="stats-scope">
      <div ref={ref} className="stats-scope__track" role="radiogroup" aria-label="Time period">
        {opts.map((o) => (
          <button key={String(o.value)} type="button" role="radio" aria-checked={scope === o.value} className="stats-scope__chip" onClick={() => onChange(o.value)}>
            <span className="stats-scope__pill">
              {o.label}
              <span className="stats-scope__count">{o.count}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

const INSIGHT_ICONS: Record<string, IconName> = { seat: 'seat', weekday: 'calendar', hour: 'clock', reason: 'sparkle', haul: 'globe', cabin: 'sparkle' };

function Insights({ items }: { items: Insight[] }) {
  return (
    <section className="stats-insights" aria-label="Highlights">
      {items.map((i, n) => (
        <div key={i.id} className="stats-insight animate-in" style={{ animationDelay: `${120 + n * 60}ms` }}>
          <span className={`stats-insight__icon stats-insight__icon--${n % 2 ? 'amber' : 'sky'}`} aria-hidden>
            <Icon name={INSIGHT_ICONS[i.id] ?? 'sparkle'} size={18} />
          </span>
          <p className="stats-insight__title">{i.title}</p>
          <p className="stats-insight__detail">{i.detail}</p>
        </div>
      ))}
    </section>
  );
}

function StatsEmpty({ upcoming = 0, readOnly = false, embedded = false }: { upcoming?: number; readOnly?: boolean; embedded?: boolean }) {
  return (
    <div className="stats">
      {embedded ? (
        <h2 className="visually-hidden">Stats</h2>
      ) : (
        <header className="page-header">
          <h1 className="page-title">Stats</h1>
        </header>
      )}
      <div className="stats-empty card">
        <div className="stats-empty__art" aria-hidden>
          <svg viewBox="0 0 200 110" width="200" height="110">
            <path className="stats-empty__arc" d="M20,95 Q100,-5 180,95" />
            <circle className="stats-empty__dot" cx="20" cy="95" r="5" />
            <circle className="stats-empty__dot stats-empty__dot--amber" cx="180" cy="95" r="5" />
            <g transform="translate(88 32) rotate(62)">
              <Icon name="plane" size={24} />
            </g>
          </svg>
        </div>
        {readOnly ? (
          <>
            <h2 className="empty__title">No flights shared yet</h2>
            <p className="muted stats-empty__text">Statistics appear here once flights have been flown and shared.</p>
          </>
        ) : (
          <>
            <h2 className="empty__title">Your flying story starts here</h2>
            <p className="muted stats-empty__text">
              {upcoming > 0
                ? `Stats count flights you’ve flown. Your ${upcoming === 1 ? 'upcoming flight' : `${upcoming} upcoming flights`} will show up here once ${upcoming === 1 ? 'it departs' : 'they depart'} — or import your history now.`
                : 'Log a flight or import your history and this page fills up with distances, records, maps of where you’ve been and more.'}
            </p>
            <div className="stats-empty__actions">
              <Link to="/flights/new" className="btn btn--primary btn--lg">
                <Icon name="plus" size={18} /> Log a flight
              </Link>
              <Link to="/import" className="btn btn--lg">
                <Icon name="upload" size={18} /> Import history
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatsSkeleton({ embedded = false }: { embedded?: boolean }) {
  return (
    <div className="stats" aria-busy="true" aria-label="Loading statistics">
      {!embedded && (
        <header className="page-header">
          <h1 className="page-title">Stats</h1>
        </header>
      )}
      <div className="stats-skel-chips">
        {[80, 56, 56, 56, 56].map((w, i) => (
          <div key={i} className="skeleton stats-skel-chip" style={{ width: w }} />
        ))}
      </div>
      <div className="skeleton stats-skel-hero" />
      <div className="stats-tiles">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton stats-skel-tile" />
        ))}
      </div>
      <div className="skeleton stats-skel-chart" />
    </div>
  );
}
