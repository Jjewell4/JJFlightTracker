import { lazy, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { PageLoader } from '@/components/PageLoader';
import { useReferenceReady } from '@/data/reference';
import { FlightSourceProvider, type FlightSource } from '@/lib/flight-source';
import { computeStats } from '@/lib/stats';
import type { Settings } from '@/lib/types';
import { asFlights, defaultDistanceUnit, publicFields, type PublicProfile } from './profile';
import { applyPatch, JOURNAL_VIEWS, parseView, useJournalParams, type JournalView, type ParamPatch } from './journal-state';
import { JournalLink, type JournalNav } from './JournalLink';
import { PublicOverview } from './PublicOverview';
import { PublicFlightList } from './PublicFlightList';
import { PublicTripList } from './PublicTripList';
import './public.css';

// The full map and stats screens are shared with the owner's app and loaded on demand.
const MapPage = lazy(() => import('@/features/map/MapPage'));
const StatsPage = lazy(() => import('@/features/stats/StatsPage'));

const VIEW_META: Record<JournalView, { label: string; icon: IconName }> = {
  overview: { label: 'Overview', icon: 'home' },
  map: { label: 'Map', icon: 'globe' },
  stats: { label: 'Stats', icon: 'chart' },
  trips: { label: 'Trips', icon: 'suitcase' },
  flights: { label: 'Flights', icon: 'list' },
};

const updatedFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * A read-only flight journal: overview, interactive map, full stats and flight history
 * for one public profile. Used by the public `/<handle>` page and by the owner's preview
 * in Settings (`preview`), which shows exactly what visitors will see.
 */
export function PublicDashboard({
  profile,
  preview = false,
  brand,
  notice,
  unit: unitProp,
}: {
  profile: PublicProfile;
  preview?: boolean;
  /** Brand link shown in the page bar (public page only). */
  brand?: ReactNode;
  /** Status line shown under the header (e.g. connection interrupted). */
  notice?: ReactNode;
  /** Distance unit; defaults to the visitor's locale. */
  unit?: Settings['distanceUnit'];
}) {
  const ready = useReferenceReady();
  const params = useJournalParams(!preview);
  const view = parseView(params.get('view'));
  const unit = unitProp ?? defaultDistanceUnit();
  const flights = useMemo(() => asFlights(profile.flights).sort((a, b) => b.date.localeCompare(a.date)), [profile.flights]);
  const fields = useMemo(() => publicFields(profile.flights), [profile.flights]);
  // The Trips tab only appears when the owner has saved trips.
  const hasTrips = useMemo(() => flights.some((f) => f.tripId), [flights]);
  const views = JOURNAL_VIEWS.filter((v) => v !== 'trips' || hasTrips);
  // `ready` is a dependency because airport lookups only resolve once reference data loads.
  const stats = useMemo(() => (ready ? computeStats(flights, { distanceUnit: unit, audience: 'visitor' }) : undefined), [flights, unit, ready]);

  const nav = useMemo<JournalNav>(
    () => ({
      go: (patch) => params.update(patch, 'view' in patch ? 'push' : 'replace'),
      href: (patch) => (preview ? undefined : `${window.location.pathname}${applyPatch(window.location.search, patch)}`),
    }),
    [params, preview],
  );

  const source = useMemo<FlightSource>(
    () => ({
      flights,
      readOnly: true,
      unit,
      clock: '12h',
      homeCountry: '',
      fields,
      params,
      showFlights: ({ airport, year }) => params.update({ view: 'flights', airport: airport ?? null, year: year == null ? null : String(year) }, 'push'),
    }),
    [flights, unit, fields, params],
  );

  // Each view opens at its top.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (!preview) window.scrollTo(0, 0);
  }, [view, preview]);

  const years = stats?.byYear;
  const span = years?.length ? (years.length > 1 ? `${years[0].year}–${years[years.length - 1].year}` : String(years[0].year)) : '';
  const updated = updatedFmt.format(new Date(profile.published_at));
  const viewPatch = (v: JournalView): ParamPatch => ({ view: v === 'overview' ? null : v });

  return (
    <FlightSourceProvider value={source}>
      <article className={`pj${preview ? ' pj--preview' : ''}`} data-view={view}>
        <div className="pj-top">
          {brand && <div className="pj-brand">{brand}</div>}
          {preview && <p className="pj-eyebrow">Public journal preview</p>}
          <nav className="pj-nav" aria-label="Journal sections">
            <div className="pj-nav__track">
              {views.map((v) => (
                <JournalLink key={v} nav={nav} to={viewPatch(v)} current={view === v} className="pj-tab">
                  <Icon name={VIEW_META[v].icon} size={16} />
                  <span>{VIEW_META[v].label}</span>
                </JournalLink>
              ))}
            </div>
          </nav>
        </div>
        <header className="pj-title">
          <h1>{profile.display_name}</h1>
          <p className="pj-meta">
            <span>
              {flights.length.toLocaleString('en-US')} {flights.length === 1 ? 'flight' : 'flights'}
              {span && ` · ${span}`}
            </span>
            <span className="pj-meta__live">
              <i aria-hidden /> {preview ? 'Preview of your public journal' : `Updated ${updated}`}
            </span>
          </p>
          {notice}
        </header>

        <div className="pj-panel">
          {!ready || !stats ? (
            <p role="status" className="pj-loading">
              Loading airport information…
            </p>
          ) : view === 'map' ? (
            <div className="pj-map">
              <Suspense fallback={<PageLoader />}>
                <MapPage embedded />
              </Suspense>
            </div>
          ) : (
            <div className="pj-content">
              {view === 'overview' && <PublicOverview flights={flights} stats={stats} unit={unit} nav={nav} />}
              {view === 'stats' && (
                <Suspense fallback={<PageLoader />}>
                  <StatsPage embedded />
                </Suspense>
              )}
              {view === 'trips' && <PublicTripList flights={flights} unit={unit} />}
              {view === 'flights' && <PublicFlightList flights={flights} params={params} />}
              <footer className="pj-footer">
                {preview ? 'Visitors see this journal live' : `Updated ${updated} · Live journal`} · Shares routes, {fields.exactDates ? 'dates' : 'months'}, airlines,
                aircraft types and saved trips only.
              </footer>
            </div>
          )}
        </div>
      </article>
    </FlightSourceProvider>
  );
}
