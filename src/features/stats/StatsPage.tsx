import '@/features/manage/manage.css';
import { compareYears } from './comparison';
import { todayLocal } from '@/lib/time';
import { STATS_SECTIONS } from './layout';
import { STATS_METRIC_EVENT } from './Hero';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { useFlightSource, withFlightSource, type FlightFields, type ViewParams } from '@/lib/flight-source';
import { useReferenceReady } from '@/data/reference';
import { flownFlights } from '@/lib/flight-utils';
import { availableYears, computeStats, filterByYear, flightYear, summarizeTotals, type Insight, type YearScope } from '@/lib/stats';
import type { Flight, StatsLayout } from '@/lib/types';
import { ArrangeSheet } from './ArrangeSheet';
import { resolveLayout, sectionNav, type StatsSectionId } from './layout';
import { Occasions } from './Occasions';
import { InsightsSection } from './Findings';
import { findInsights } from '@/lib/insights';
import { tripsFor } from '@/features/trips/use-trips';
import { savedTrips } from '@/features/public/PublicTripList';
import { insightAvailable, statsSections } from './sections';
import { insightIcon } from './insight-icons';
import { Hero } from './Hero';
import { TimeCharts } from './TimeCharts';
import { TravelCalendar } from './TravelCalendar';
import { Breakdowns } from './Breakdowns';
import { TopLists } from './TopLists';
import { Records } from './Records';
import { Places } from './Places';
import { Footprint } from './Footprint';
import { SeatMap } from './SeatMap';
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
      layout={source.statsLayout}
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
  layout: StatsLayout | undefined;
  embedded: boolean;
}

function StatsDashboard({ flights, upcoming, unit, clock, homeCountry, readOnly, fields, params, layout, embedded }: DashboardProps) {
  const [arranging, setArranging] = useState(false);
  const [expanded, setExpanded] = useState(new Set<string>(['highlights']));
  const expand = (id: string) => setExpanded(prev => new Set([...prev,id]));
  useEffect(() => { const show = () => expand('patterns'); window.addEventListener(STATS_METRIC_EVENT,show); return () => window.removeEventListener(STATS_METRIC_EVENT,show); }, []);
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
  // Trips for the findings: visitors of month-only journals get only the trips the owner saved.
  const trips = useMemo(() => {
    const all = readOnly && !fields.exactDates ? savedTrips(flights) : tripsFor(flights).filter((t) => t.saved || t.flights.length >= 2);
    return scope === 'all' ? all : all.filter((t) => Number(t.start.slice(0, 4)) === scope);
  }, [flights, readOnly, fields.exactDates, scope]);
  const findings = useMemo(
    () =>
      findInsights({ flights: scoped, trips, allFlights: flights, scope, unit, audience: readOnly ? 'visitor' : 'owner' }).filter((f) =>
        f.needs.every((n) => fields[n]),
      ),
    [scoped, trips, flights, scope, unit, readOnly, fields],
  );
  // Every movable section; null when it has nothing to show here.
  const blocks: Record<StatsSectionId, ReactNode> = {
    highlights:
      insights.length || findings.length ? (
        <InsightsSection highlights={insights.length > 0 ? <Insights items={insights} /> : null} findings={findings} readOnly={readOnly} />
      ) : null,
    patterns: <TimeCharts stats={stats} scope={scope} unit={unit} clock={clock} currentYear={currentYear} sections={sections} readOnly={readOnly} />,
    calendar: sections.calendar ? <TravelCalendar flights={flights} scope={scope} readOnly={readOnly} /> : null,
    mix: <Breakdowns year={scope} stats={stats} unit={unit} sections={sections} readOnly={readOnly} />,
    occasions: sections.occasion ? <Occasions stats={stats} unit={unit} readOnly={readOnly} /> : null,
    records: <Records stats={stats} unit={unit} sections={sections} readOnly={readOnly} />,
    favorites: <TopLists stats={stats} unit={unit} sections={sections} readOnly={readOnly} />,
    places: <Places stats={stats} homeCountry={homeCountry} />,
    seatmap: sections.seatMap ? <SeatMap flights={scoped} /> : null,
    footprint: <Footprint stats={stats} readOnly={readOnly} />,
  };
  const shown = resolveLayout(layout).filter((s) => !s.hidden && blocks[s.id]);
  const t = stats.totals;
  const comparisonYear = scope === 'all' ? currentYear : scope;
  const comparison = compareYears(flights, comparisonYear, todayLocal());

  return (
    <div className={`stats${embedded ? ' stats--embedded' : ''}`}>
      {embedded ? (
        <h2 className="visually-hidden">Stats</h2>
      ) : (
        <header className="page-header stats-header">
          <div className="stats-header__main">
            <h1 className="page-title">Stats</h1>
            <p className="page-subtitle">
              {fmtInt(flights.length)} {plural(flights.length, 'flight')} flown
              {years.length > 1 ? ` · ${years[years.length - 1]}–${years[0]}` : years.length ? ` · ${years[0]}` : ''}
              {upcoming > 0 && <span title="Upcoming flights are counted once they depart">{` · ${upcoming} upcoming`}</span>}
            </p>
          </div>
          {!readOnly && (
            <button type="button" className="btn btn--ghost stats-arrange-btn" onClick={() => setArranging(true)}>
              <Icon name="layers" size={18} /> Arrange
            </button>
          )}
        </header>
      )}

      <ScopeChips years={years} scope={scope} onChange={setScope} counts={countsByYear} total={flights.length} />

      <nav className="stats-jump" aria-label="Statistics sections">
        {[{ id: 'summary', label: 'Summary' }, ...shown.map((sec) => ({ id: sec.id, label: sectionNav(sec.id) }))].map(({ id, label }) => (
          <button key={id} type="button" onClick={() => { expand(id); requestAnimationFrame(() => document.getElementById(`stats-sec-${id}`)?.scrollIntoView({ block: 'start' })); }}>
            {label}
          </button>
        ))}
      </nav>
      <div className="stats-body" id="stats-sec-summary">
        <div className="stats-top">
          <Hero stats={stats} scope={scope} unit={unit} prev={prev} firstYear={years[years.length - 1]} timeEstimated={sections.timeEstimated} lifetimeKm={lifetimeKm} />
        </div>

        {(!readOnly || fields.exactDates || !comparison.partial) && <article className="card manage-card stats-comparison"><h2>{comparisonYear} vs {comparisonYear - 1}</h2><p>{comparison.partial ? `Through ${todayLocal().slice(5)} in both years · exact dates only` : 'Full calendar years'}</p><div className="manage-actions"><strong>{comparison.current.count} flights</strong><span>vs {comparison.previous.count}</span><span className="badge">{comparison.current.count - comparison.previous.count >= 0 ? '+' : ''}{comparison.current.count - comparison.previous.count} flights</span></div></article>}
        <div className="manage-actions"><button className="btn btn--ghost" onClick={() => setExpanded(new Set(shown.map(s => s.id)))}>Expand all sections</button><button className="btn btn--ghost" onClick={() => setExpanded(new Set(['highlights']))}>Compact view</button></div>
        {shown.map((sec) => (
          <details key={sec.id} id={`stats-sec-${sec.id}`} open={expanded.has(sec.id)} onToggle={e => { const open=e.currentTarget.open; setExpanded(prev => {if(prev.has(sec.id) === open) return prev; const next=new Set(prev); if(open) next.add(sec.id); else next.delete(sec.id); return next;}); }} className="stats-block stats-disclosure">
            <summary>{STATS_SECTIONS.find(s => s.id === sec.id)?.title}<span>Explore</span></summary>
            {blocks[sec.id]}
          </details>
        ))}

        <footer className="stats-notes">
          <Icon name="info" size={14} />
          {readOnly ? (
            <p>
              Distances are great-circle between airports.
              {!fields.durations && ' This journal has no recorded flight times, so time in the air is estimated from distance.'}
              {!fields.exactDates && ' Only months are shared, so day-of-week patterns aren’t shown.'}
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
      {!readOnly && <ArrangeSheet open={arranging} layout={layout} onClose={() => setArranging(false)} />}
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

function Insights({ items }: { items: Insight[] }) {
  return (
    <section className="stats-insights" aria-label="Highlights">
      {items.map((i, n) => (
        <div key={i.id} className="stats-insight animate-in" style={{ animationDelay: `${120 + n * 60}ms` }}>
          <span className={`stats-insight__icon stats-insight__icon--${n % 2 ? 'amber' : 'sky'}`} aria-hidden>
            {/* The busiest weekday reads best as the day itself, like a calendar page. */}
            {i.id === 'weekday' && i.kind ? <span className="stats-insight__day">{i.kind}</span> : <Icon name={insightIcon(i)} size={18} />}
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
