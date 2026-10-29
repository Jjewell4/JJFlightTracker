import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { groupTripsByYear } from '@/lib/trips';
import type { Flight, Settings } from '@/lib/types';
import { TripCard } from './TripCard';
import { plural } from './trip-format';
import { useTrips } from './use-trips';
import './trips.css';

export type LogView = 'flights' | 'trips';

// The Log tab reopens on the view last used this session (module scope).
const remembered: { view: LogView } = { view: 'flights' };

/**
 * The Log tab's current view: `?view=trips|flights` when present (Back from a trip, links),
 * else the one last used. Always 'flights' when `enabled` is false (Home).
 */
export function useLogView(enabled: boolean): [LogView, (v: LogView) => void] {
  const [params, setParams] = useSearchParams();
  const p = params.get('view');
  const view: LogView = !enabled ? 'flights' : p === 'trips' || p === 'flights' ? p : remembered.view;
  if (enabled) remembered.view = view;
  const set = useCallback(
    (v: LogView) => {
      remembered.view = v;
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (v === 'trips') next.set('view', 'trips');
          else next.delete('view');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return [view, set];
}

/** The Log tab's quiet "Flights | Trips" switch. */
export function LogViewSwitch({ value, onChange }: { value: LogView; onChange: (v: LogView) => void }) {
  return (
    <div className="seg logswitch" role="radiogroup" aria-label="Show">
      {(['flights', 'trips'] as const).map((v) => (
        <button key={v} type="button" role="radio" className="seg__opt" aria-checked={value === v} onClick={() => onChange(v)}>
          {v === 'flights' ? 'Flights' : 'Trips'}
        </button>
      ))}
    </div>
  );
}

const INTRO_KEY = 'flightlog.tripsIntroDismissed';
const BATCH = 24;
// Survives opening a trip and coming back (module scope = this browser session).
const memory = { limit: BATCH, savedOnly: false };

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** Log → Trips: saved and suggested trips, newest first, grouped by year. */
export function TripsList({ flights, unit, today }: { flights: Flight[]; unit: Settings['distanceUnit']; today: string }) {
  const trips = useTrips(flights, true) ?? [];
  const savedCount = useMemo(() => trips.filter((t) => t.saved).length, [trips]);
  const [savedFilter, setSavedOnly] = useState(memory.savedOnly);
  // The filter only exists while there are saved trips; ungrouping the last one shows all again.
  const savedOnly = savedFilter && savedCount > 0;
  const shown = useMemo(() => (savedOnly ? trips.filter((t) => t.saved) : trips), [trips, savedOnly]);
  const [limit, setLimit] = useState(memory.limit);
  const [introHidden, setIntroHidden] = useState(() => readFlag(INTRO_KEY));
  // Year totals cover every trip; only the first `limit` cards are mounted.
  const years = useMemo(() => {
    let budget = limit;
    return groupTripsByYear(shown)
      .map((y) => {
        const visible = y.trips.slice(0, Math.max(0, budget));
        budget -= visible.length;
        return { ...y, visible };
      })
      .filter((y) => y.visible.length > 0);
  }, [shown, limit]);
  const more = shown.length > limit;

  useEffect(() => {
    memory.limit = limit;
    memory.savedOnly = savedOnly;
  }, [limit, savedOnly]);

  // Render progressively: the next batch mounts as the end of the list scrolls into view.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setLimit((n) => n + BATCH);
    }, { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [more, limit]);

  const dismissIntro = () => {
    setIntroHidden(true);
    try {
      localStorage.setItem(INTRO_KEY, '1');
    } catch {
      /* private mode: dismissed for this visit only */
    }
  };

  if (!trips.length) {
    return (
      <div className="empty trips-empty">
        <span className="trips-empty__icon" aria-hidden>
          <Icon name="suitcase" size={26} />
        </span>
        <div className="empty__title">No trips yet</div>
        <p>When flights chain together — out, any connections, and home again — they’re grouped into trips here automatically.</p>
      </div>
    );
  }

  return (
    <div className="trips">
      {!introHidden && savedCount === 0 && (
        <aside className="trips-intro animate-in" aria-label="About trips">
          <span className="trips-intro__icon" aria-hidden>
            <Icon name="sparkle" size={18} />
          </span>
          <p className="trips-intro__text">
            <strong>We found {plural(trips.length, 'trip')} in your log.</strong> Flights that chain together are grouped automatically — open one to save it with a name.
          </p>
          <button type="button" className="btn btn--ghost btn--icon trips-intro__close" onClick={dismissIntro} aria-label="Dismiss">
            <Icon name="close" size={18} />
          </button>
        </aside>
      )}

      {savedCount > 0 && (
        <div className="trips-filter" role="radiogroup" aria-label="Which trips">
          <button type="button" role="radio" className="chip" aria-checked={!savedOnly} aria-pressed={!savedOnly} onClick={() => setSavedOnly(false)}>
            All <span className="trips-filter__n">{trips.length}</span>
          </button>
          <button type="button" role="radio" className="chip" aria-checked={savedOnly} aria-pressed={savedOnly} onClick={() => setSavedOnly(true)}>
            <Icon name="bookmark" size={14} /> Saved <span className="trips-filter__n">{savedCount}</span>
          </button>
        </div>
      )}

      {years.map((y) => (
        <section key={y.year} className="tyear" aria-labelledby={`tyear-${y.year}`}>
          <h2 id={`tyear-${y.year}`} className="tyear__head">
            <span className="tyear__year">{y.year}</span>
            <span className="tyear__meta tabular">
              {plural(y.trips.length, 'trip')}
              {y.nights > 0 && (
                <>
                  <span className="tyear__sep" aria-hidden>
                    ·
                  </span>
                  {plural(y.nights, 'night')} away
                </>
              )}
            </span>
          </h2>
          <div className="tyear__list">
            {y.visible.map((t) => (
              <TripCard key={t.id} trip={t} unit={unit} upcoming={t.start > today} />
            ))}
          </div>
        </section>
      ))}

      {more && (
        <div ref={sentinel} className="trips-more">
          <button type="button" className="btn btn--block" onClick={() => setLimit((n) => n + BATCH)}>
            Show more trips ({shown.length - limit} more)
          </button>
        </div>
      )}
    </div>
  );
}
