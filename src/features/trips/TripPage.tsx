import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon, type IconName } from '@/components/Icon';
import { ConfirmSheet, Sheet } from '@/components/Sheet';
import { useReferenceReady } from '@/data/reference';
import { renameTrip, saveTrip, setOccasion, unsaveTrip, useFlights, useSettings } from '@/lib/db';
import { OCCASION_ICON, OCCASION_LABELS, tripOccasion } from '@/lib/occasions';
import { todayLocal } from '@/lib/time';
import { resolveTrip, suggestTripName, tripCounts, tripDates, tripMinutes, tripTitle, type Trip } from '@/lib/trips';
import type { FlightOccasion, Settings } from '@/lib/types';
import { formatDistance } from '@/features/flights/flight-logic';
import { FlightRow } from '@/features/flights/FlightRow';
import { TripRouteLine } from './TripCard';
import { OccasionPicker } from './OccasionPicker';
import { TripMap } from './TripMap';
import { nightsLabel, placeName, plural, routeText, stopLabel, tripShareText } from './trip-format';
import { useTrips } from './use-trips';
import './trips.css';
import './TripPage.css';

const TRIPS_LIST = '/flights?view=trips';

export default function TripPage() {
  const { id = '' } = useParams();
  const flights = useFlights();
  const ready = useReferenceReady();
  const settings = useSettings();
  const trips = useTrips(flights, ready);
  const navigate = useNavigate();

  // The legs last shown, so the page can follow its trip when the id under it changes
  // (a suggestion saved, a saved trip ungrouped).
  const shown = useRef<{ id: string; flightIds: string[] }>({ id: '', flightIds: [] });
  const ungrouped = useRef('');
  const resolved = useMemo(() => (trips ? resolveTrip(trips, id, shown.current.id === id ? shown.current.flightIds : []) : undefined), [trips, id]);

  // A sheet that just closed still owns a history entry it is about to pop; replacing the URL
  // before that would strand the entry (Back would land on this trip again). Retry after the pop.
  const [pops, setPops] = useState(0);
  const afterOverlayPop = () => {
    if (!(window.history.state as { __overlay?: string } | null)?.__overlay) return undefined;
    const retry = () => setPops((n) => n + 1);
    window.addEventListener('popstate', retry, { once: true });
    return () => window.removeEventListener('popstate', retry);
  };

  // Keep the URL on the trip actually shown (stale suggestion id, just saved, just ungrouped).
  useEffect(() => {
    if (!resolved) return;
    shown.current = { id: resolved.trip.id, flightIds: resolved.trip.flights.map((f) => f.id) };
    if (resolved.trip.id === id) return;
    const wait = afterOverlayPop();
    if (wait) return wait;
    navigate(`/trips/${encodeURIComponent(resolved.trip.id)}`, { replace: true });
  }, [resolved, id, pops, navigate]);

  // Ungrouping a trip no suggestion covers (e.g. a single leg): nothing left to show here.
  useEffect(() => {
    if (!trips || resolved || ungrouped.current !== id) return;
    const wait = afterOverlayPop();
    if (wait) return wait;
    navigate(TRIPS_LIST, { replace: true });
  }, [trips, resolved, id, pops, navigate]);

  const goBack = useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(TRIPS_LIST);
  }, [navigate]);

  if (!trips) return <TripSkeleton onBack={goBack} />;
  if (!resolved) return <TripNotFound onBack={goBack} />;
  return <TripView trip={resolved.trip} settings={settings} onBack={goBack} onUngrouped={() => (ungrouped.current = resolved.trip.id)} />;
}

function TripView({ trip, settings, onBack, onUngrouped }: { trip: Trip; settings: Settings; onBack: () => void; onUngrouped: () => void }) {
  const [menu, setMenu] = useState(false);
  const [naming, setNaming] = useState<'save' | 'rename' | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [today] = useState(todayLocal);
  const unit = settings.distanceUnit;
  const title = tripTitle(trip);
  const dates = tripDates(trip);
  const nights = nightsLabel(trip);
  const counts = useMemo(() => tripCounts(trip), [trip]);
  const minutes = useMemo(() => tripMinutes(trip), [trip]);
  const upcoming = trip.start > today;
  const closeMenu = useCallback(() => setMenu(false), []);
  const closeNaming = useCallback(() => setNaming(null), []);
  const closeConfirm = useCallback(() => setConfirm(false), []);
  const closePicking = useCallback(() => setPicking(false), []);
  // One occasion for the whole trip; legs tagged differently read as "mixed".
  const occasion = tripOccasion(trip);
  const mixed = new Set(trip.flights.map((f) => f.occasion).filter(Boolean)).size > 1;

  const pickOccasion = async (o: FlightOccasion | undefined) => {
    setPicking(false);
    try {
      await setOccasion(
        trip.flights.map((f) => f.id),
        o,
      );
      flash(o ? `Tagged as ${OCCASION_LABELS[o].toLowerCase()}` : 'Occasion cleared');
    } catch {
      flash('Couldn’t save the occasion');
    }
  };

  const flash = (msg: string) => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const submitName = async (name: string, chosen?: FlightOccasion) => {
    setBusy(true);
    try {
      if (naming === 'save') {
        // The page follows the legs to their new saved id (see resolveTrip).
        await saveTrip(trip.flights.map((f) => f.id), name);
        if (chosen !== occasion) await setOccasion(trip.flights.map((f) => f.id), chosen);
        flash('Trip saved');
      } else {
        await renameTrip(trip.id, name);
        flash('Trip renamed');
      }
      setNaming(null);
    } catch {
      flash('Couldn’t save the trip');
    } finally {
      setBusy(false);
    }
  };

  const ungroup = async () => {
    setBusy(true);
    try {
      onUngrouped();
      await unsaveTrip(trip.id);
      setConfirm(false);
      flash('Trip removed · flights kept');
    } catch {
      flash('Couldn’t remove the trip');
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    setMenu(false);
    const text = tripShareText(trip, unit);
    try {
      if (navigator.share) await navigator.share({ title, text });
      else {
        await navigator.clipboard.writeText(text);
        flash('Copied to clipboard');
      }
    } catch {
      /* cancelled */
    }
  };

  const tiles: { value: string; unit?: string; label: string }[] = [
    { value: String(trip.flights.length), label: trip.flights.length === 1 ? 'flight' : 'flights' },
    { value: trip.nights ? String(trip.nights) : '—', label: trip.nights === 1 ? 'night' : 'nights' },
    { value: formatDistance(trip.distanceKm, unit, false), unit, label: 'distance' },
    { value: minutes ? hoursMinutes(minutes) : '—', label: 'in the air' },
    { value: String(counts.airlines || '—'), label: counts.airlines === 1 ? 'airline' : 'airlines' },
    { value: String(counts.airports), label: 'airports' },
  ];

  return (
    <div className="trip">
      <header className="tbar">
        <button type="button" className="btn btn--ghost btn--icon tbar__btn" onClick={onBack} aria-label="Back">
          <Icon name="back" size={22} />
        </button>
        <div className="tbar__title">
          <span className="tbar__main">{title}</span>
          <span className="tbar__sub">{dates}</span>
        </div>
        <button type="button" className="btn btn--ghost btn--icon tbar__btn" onClick={() => void share()} aria-label="Share trip">
          <Icon name="share" size={20} />
        </button>
        <button type="button" className="btn btn--ghost btn--icon tbar__btn" onClick={() => setMenu(true)} aria-label="More actions" aria-haspopup="dialog">
          <Icon name="more" size={22} strokeWidth={3} />
        </button>
      </header>

      <div className="trip__grid">
        <div className="trip__main">
          <section className={`thero animate-in${trip.saved ? ' thero--saved' : ''}`} aria-labelledby="trip-title">
            <div className="thero__map">
              <TripMap trip={trip} label={`Map of the trip: ${routeText(trip)}`} />
            </div>
            <div className="thero__body">
              <span className={`thero__eyebrow${trip.saved ? ' thero__eyebrow--saved' : ''}`}>
                <Icon name={trip.saved ? 'bookmark' : 'sparkle'} size={13} strokeWidth={2.2} />
                {trip.saved ? 'Saved trip' : 'Suggested trip'}
                {upcoming && <span className="thero__soon">Upcoming</span>}
              </span>
              <h1 id="trip-title" className="thero__title">
                {title}
              </h1>
              <p className="thero__dates">
                {dates}
                {nights && (
                  <>
                    <span className="thero__sep" aria-hidden>
                      ·
                    </span>
                    {nights}
                  </>
                )}
              </p>
              <TripRouteLine trip={trip} className="thero__route" />
            </div>
          </section>

          {!trip.saved && (
            <section className="tsuggest animate-in" aria-label="Save this trip">
              <p>
                <strong>Keep this trip?</strong> Give it a name and it stays grouped as your log changes.
              </p>
              <button type="button" className="btn btn--primary" onClick={() => setNaming('save')}>
                <Icon name="bookmark" size={16} /> Save trip
              </button>
            </section>
          )}

          {trip.saved && trip.flights.length === 1 && (
            <section className="tsuggest tsuggest--warn animate-in" aria-label="One flight left">
              <p>
                <strong>Only one flight left in this trip.</strong> The others were deleted or moved. Keep it, or remove the trip grouping.
              </p>
              <button type="button" className="btn" onClick={() => setConfirm(true)}>
                Remove grouping
              </button>
            </section>
          )}

          <button type="button" className="toccasion animate-in" onClick={() => setPicking(true)} aria-haspopup="dialog">
            <span className="toccasion__label">Occasion</span>
            <span className={`toccasion__value${occasion ? '' : ' is-placeholder'}`}>
              {occasion && <Icon name={OCCASION_ICON[occasion]} size={16} className="toccasion__icon" />}
              <span className="toccasion__text">{occasion ? OCCASION_LABELS[occasion] : mixed ? 'Mixed' : 'Vacation, wedding, conference…'}</span>
            </span>
            <Icon name="chevron" size={16} className="toccasion__chev" />
          </button>

          <dl className="tstats animate-in">
            {tiles.map((t) => (
              <div key={t.label} className="tstat">
                <dt>{t.label}</dt>
                <dd className="tabular">
                  {t.value}
                  {t.unit && t.value !== '—' && <small> {t.unit}</small>}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <section className="titin animate-in" aria-labelledby="itin-title">
          <h2 id="itin-title" className="section-title titin__title">
            Itinerary
          </h2>
          <ol className="titin__list">
            {trip.flights.map((f, i) => {
              const stop = trip.stops[i];
              const next = trip.flights[i + 1];
              const label = stop && next ? stopLabel(stop, f, next) : undefined;
              return (
                <Fragment key={f.id}>
                  <li className="titin__leg">
                    <span className="titin__num" aria-hidden>
                      {i + 1}
                    </span>
                    <div className="flist titin__card">
                      <FlightRow flight={f} unit={unit} clock={settings.clock} />
                    </div>
                  </li>
                  {label && (
                    <li className={`titin__stop titin__stop--${label.kind}`}>
                      <span className="titin__icon" aria-hidden>
                        <Icon name={STOP_ICON[label.kind]} size={14} strokeWidth={2} />
                      </span>
                      <span className="titin__text">
                        {label.text}
                        {label.detail && <span className="titin__detail"> · {label.detail}</span>}
                      </span>
                    </li>
                  )}
                </Fragment>
              );
            })}
            <li className="titin__stop titin__stop--end">
              <span className="titin__icon" aria-hidden>
                <Icon name={trip.roundTrip ? 'home' : 'landing'} size={14} strokeWidth={2} />
              </span>
              <span className="titin__text">
                {trip.roundTrip
                  ? `Home again in ${placeName(trip.finish)}`
                  : trip.returnLogged === false
                    ? `Last logged in ${placeName(trip.finish)} · the way home isn’t in your log`
                    : `Trip ends in ${placeName(trip.finish)}`}
              </span>
            </li>
          </ol>

          {trip.saved && trip.flights.length > 1 && (
            <div className="trip__actions">
              <button type="button" className="btn btn--block" onClick={() => setNaming('rename')}>
                <Icon name="edit" size={18} /> Rename
              </button>
              <button type="button" className="btn btn--block btn--ghost" onClick={() => setConfirm(true)}>
                Remove trip
              </button>
            </div>
          )}
        </section>
      </div>

      <Sheet open={menu} onClose={closeMenu} label="Trip actions">
        <div className="sheet__title">{title}</div>
        {trip.saved ? (
          <>
            <MenuItem icon="edit" label="Rename trip" onClick={() => (setMenu(false), setNaming('rename'))} />
            <MenuItem icon="share" label="Share trip" hint="As text, with every leg" onClick={() => void share()} />
            <MenuItem icon="trash" label="Remove trip grouping" hint="The flights stay in your log" danger onClick={() => (setMenu(false), setConfirm(true))} />
          </>
        ) : (
          <>
            <MenuItem icon="bookmark" label="Save trip" hint="Name it and keep it grouped" onClick={() => (setMenu(false), setNaming('save'))} />
            <MenuItem icon="share" label="Share trip" hint="As text, with every leg" onClick={() => void share()} />
          </>
        )}
        <button type="button" className="btn btn--block sheet__cancel" onClick={closeMenu}>
          Cancel
        </button>
      </Sheet>

      <Sheet open={picking} onClose={closePicking} label="Trip occasion">
        <div className="sheet__title">What was this trip for?</div>
        <p className="toccasion__lead">{trip.flights.length === 1 ? 'Tags this trip’s flight.' : `Tags all ${plural(trip.flights.length, 'flight')} of this trip.`}</p>
        <div className="toccasion__chips">
          <OccasionPicker value={occasion} onChange={(o) => void pickOccasion(o)} />
        </div>
        {(occasion || mixed) && (
          <button type="button" className="btn btn--block btn--ghost" onClick={() => void pickOccasion(undefined)}>
            Clear occasion
          </button>
        )}
        <button type="button" className="btn btn--block sheet__cancel" onClick={closePicking}>
          Cancel
        </button>
      </Sheet>

      <TripNameSheet
        open={naming !== null}
        mode={naming ?? 'save'}
        initial={trip.saved ? (trip.name ?? '') : title}
        placeholder={suggestTripName(trip)}
        legs={trip.flights.length}
        occasion={occasion}
        busy={busy}
        onSubmit={submitName}
        onClose={closeNaming}
      />

      <ConfirmSheet
        open={confirm}
        title="Remove this trip?"
        icon="suitcase"
        message={
          <>
            <strong>{title}</strong> will no longer be grouped. {trip.flights.length === 1 ? 'Its flight stays' : `All ${trip.flights.length} flights stay`} in your log
            {trip.flights.length > 1 ? ' and may show up again as a suggestion.' : '.'}
          </>
        }
        confirmLabel="Remove trip"
        danger
        busy={busy}
        onConfirm={() => void ungroup()}
        onCancel={closeConfirm}
      />

      {toast && (
        <div className="ttoast" role="status">
          <Icon name="check" size={16} /> {toast}
        </div>
      )}
    </div>
  );
}

const STOP_ICON: Record<'connection' | 'overnight' | 'stay', IconName> = { connection: 'clock', overnight: 'moon', stay: 'moon' };

/** "11h 20m"; whole hours once it runs to triple digits. */
function hoursMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h >= 100) return `${h}h`;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

function TripNameSheet({
  open,
  mode,
  initial,
  placeholder,
  legs,
  occasion: initialOccasion,
  busy,
  onSubmit,
  onClose,
}: {
  open: boolean;
  mode: 'save' | 'rename';
  initial: string;
  placeholder: string;
  legs: number;
  occasion?: FlightOccasion;
  busy: boolean;
  onSubmit: (name: string, occasion?: FlightOccasion) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial);
  const [occasion, setOccasionChoice] = useState(initialOccasion);
  // Prefill each time the sheet opens (not on background updates while typing).
  useEffect(() => {
    if (open) {
      setName(initial);
      setOccasionChoice(initialOccasion);
    }
  }, [open]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy) onSubmit(name, occasion);
  };
  return (
    <Sheet open={open} onClose={onClose} labelledBy="trip-name-title" initialFocus={inputRef} dismissible={!busy}>
      <form className="tname" onSubmit={submit}>
        <h2 id="trip-name-title" className="tname__title">
          {mode === 'save' ? 'Save trip' : 'Rename trip'}
        </h2>
        <p className="tname__lead">
          {mode === 'save'
            ? `Keeps these ${plural(legs, 'flight')} together as one trip. The flights themselves don’t change.`
            : `Leave it empty to use the suggested name, “${placeholder}”.`}
        </p>
        <label className="field">
          <span className="field__label">Trip name</span>
          <input
            ref={inputRef}
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            maxLength={80}
            autoComplete="off"
            enterKeyHint="done"
            placeholder={placeholder}
          />
        </label>
        {mode === 'save' && (
          <div className="tname__occasion">
            <span className="field__label">What was it for? (optional)</span>
            <OccasionPicker value={occasion} onChange={setOccasionChoice} />
          </div>
        )}
        <div className="tname__actions">
          <button type="button" className="btn btn--lg" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn--lg btn--primary" disabled={busy}>
            {busy ? 'Saving…' : mode === 'save' ? 'Save trip' : 'Save'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

function MenuItem({ icon, label, hint, onClick, danger }: { icon: IconName; label: string; hint?: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" className={`sheet__item${danger ? ' sheet__item--danger' : ''}`} onClick={onClick}>
      <span className="sheet__icon">
        <Icon name={icon} size={20} />
      </span>
      <span className="sheet__text">
        {label}
        {hint && <span className="sheet__hint">{hint}</span>}
      </span>
    </button>
  );
}

function TripSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <div className="trip" aria-busy="true" aria-label="Loading trip">
      <header className="tbar">
        <button type="button" className="btn btn--ghost btn--icon tbar__btn" onClick={onBack} aria-label="Back">
          <Icon name="back" size={22} />
        </button>
        <div className="tbar__title" />
      </header>
      <div className="thero">
        <div className="thero__map skeleton" style={{ borderRadius: 0 }} />
        <div className="thero__body">
          <div className="skeleton" style={{ width: 90, height: 12 }} />
          <div className="skeleton" style={{ width: 180, height: 28, marginTop: 10 }} />
          <div className="skeleton" style={{ width: 140, height: 14, marginTop: 10 }} />
        </div>
      </div>
    </div>
  );
}

function TripNotFound({ onBack }: { onBack: () => void }) {
  return (
    <div className="trip">
      <header className="tbar">
        <button type="button" className="btn btn--ghost btn--icon tbar__btn" onClick={onBack} aria-label="Back">
          <Icon name="back" size={22} />
        </button>
      </header>
      <div className="empty">
        <span className="trips-empty__icon" aria-hidden>
          <Icon name="suitcase" size={26} />
        </span>
        <div className="empty__title">Trip not found</div>
        <p>Suggested trips update as you log, edit or delete flights, so this one may have changed or been removed.</p>
        <Link to={TRIPS_LIST} className="btn btn--primary" replace>
          See your trips
        </Link>
      </div>
    </div>
  );
}
