import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { formatOccasions, occasionsOf } from '@/lib/occasions';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AirlineLogo } from '@/components/AirlineLogo';
import { Icon, type IconName } from '@/components/Icon';
import { getAircraftType, getAirport, getCountry, useReferenceReady } from '@/data/reference';
import { deleteFlight, useFlight, useFlights, useSettings } from '@/lib/db';
import { airportCode, flightAircraftName, flightAirlineName, flightDistanceKm } from '@/lib/flight-utils';
import { estimateDurationMin } from '@/lib/geo';
import { addDays, formatDuration, formatFlightDate, formatTime } from '@/lib/time';
import type { Airport, Flight, FlightSource, SeatType, Settings } from '@/lib/types';
import { cabinLabel, flightHistory, formatDistance, ordinal, reasonLabel, tzAbbrev } from './flight-logic';
import { prettyFlightNumber, rowDate, shortCity } from './FlightRow';
import { RouteMap } from './RouteMap';
import { ConfirmSheet, Sheet } from '@/components/Sheet';
import { goBackScreens } from '@/components/useBackDismiss';
import { airlineKey, isUpcoming } from '@/lib/flight-utils';
import { airlineHref, airportHref } from '@/features/explore/links';
import '@/features/explore/links.css';
import { downloadText } from '@/services/import/download';
import { buildIcs, icsFileName, isTrackable, trackingLinks } from './flight-links';
import { shareFlightImage } from './share-card';
import { TripChip } from '@/features/trips/TripChip';
import './FlightDetailPage.css';

const SOURCE_LABEL: Record<FlightSource, string> = {
  manual: 'Logged manually',
  lookup: 'Logged with flight lookup',
  screenshot: 'Reviewed from a screenshot',
  fr24: 'Imported from Flightradar24',
  csv: 'Imported from CSV',
  backup: 'Restored from backup',
};
const SEAT_LABEL: Record<SeatType, string> = { window: 'Window', middle: 'Middle', aisle: 'Aisle' };

export default function FlightDetailPage() {
  const { id } = useParams();
  const flight = useFlight(id);
  const all = useFlights();
  const ready = useReferenceReady();
  const settings = useSettings();
  const navigate = useNavigate();

  const goBack = useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/');
  }, [navigate]);

  if (flight === undefined || !ready) return <DetailSkeleton onBack={goBack} />;
  if (flight === null) return <NotFound onBack={goBack} />;
  return <FlightDetail flight={flight} all={all ?? []} settings={settings} onBack={goBack} />;
}

function FlightDetail({ flight: f, all, settings, onBack }: { flight: Flight; all: Flight[]; settings: Settings; onBack: () => void }) {
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const closeMenu = useCallback(() => setMenu(false), []);
  const closeConfirm = useCallback(() => setConfirm(false), []);

  const from = getAirport(f.from);
  const to = getAirport(f.to);
  const fromCode = airportCode(f.from);
  const toCode = airportCode(f.to);
  const airline = flightAirlineName(f);
  const aircraft = flightAircraftName(f);
  const fn = prettyFlightNumber(f.flightNumber);
  const km = flightDistanceKm(f);
  const history = useMemo(() => flightHistory(f, all.length ? all : [f]), [f, all]);
  const clock = settings.clock;
  const unit = settings.distanceUnit;
  const other = unit === 'mi' ? 'km' : 'mi';
  const arrDate = addDays(f.date, f.arrDayOffset ?? 0);
  const duration = f.durationMin ?? (km ? estimateDurationMin(km) : undefined);
  const estimated = !f.durationMin && duration !== undefined;
  const title = [fn, `${fromCode} → ${toCode}`].filter(Boolean).join(' · ');

  const share = async () => {
    setMenu(false);
    const text = `${fn ? `${airline ? `${airline} ` : ''}${fn}: ` : ''}${fromCode} → ${toCode} · ${formatFlightDate(f.date, f.datePrecision, 'long')}${km ? ` · ${formatDistance(km, unit)}` : ''}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Flight', text });
      else {
        await navigator.clipboard.writeText(text);
        setToast('Copied to clipboard');
        setTimeout(() => setToast(null), 2000);
      }
    } catch {
      /* user cancelled */
    }
  };

  const shareImage = async () => {
    setMenu(false);
    try {
      const caption = history.routeCount > 1 ? `My ${ordinal(history.routeOrdinal)} flight on this route` : 'A new route for me';
      const how = await shareFlightImage(f, { unit, caption });
      if (how === 'downloaded') {
        setToast('Image saved');
        setTimeout(() => setToast(null), 2000);
      }
    } catch {
      setToast('Couldn’t create the image');
      setTimeout(() => setToast(null), 2500);
    }
  };

  const links = trackingLinks(f);
  const upcoming = isUpcoming(f);
  const trackable = isTrackable(f) && links.length > 0;
  const addToCalendar = () => {
    setMenu(false);
    const ics = buildIcs(f);
    if (!ics) return;
    downloadText(icsFileName(f), ics, 'text/calendar');
    setToast('Calendar file downloaded');
    setTimeout(() => setToast(null), 2500);
  };

  const remove = async () => {
    setDeleting(true);
    await deleteFlight(f.id);
    // Return to wherever the flight was opened from, so Back never shows the deleted flight.
    goBackScreens(1, () => navigate('/', { replace: true }));
  };

  return (
    <div className="detail">
      <header className="dbar">
        <button type="button" className="btn btn--ghost btn--icon dbar__btn" onClick={onBack} aria-label="Back">
          <Icon name="back" size={22} />
        </button>
        <div className="dbar__title">
          <span className="dbar__main">{title}</span>
          <span className="dbar__sub">{formatFlightDate(f.date, f.datePrecision)}</span>
        </div>
        <Link to={`/flights/${f.id}/edit`} className="btn btn--ghost btn--icon dbar__btn" aria-label="Edit flight">
          <Icon name="edit" size={20} />
        </Link>
        <button type="button" className="btn btn--ghost btn--icon dbar__btn" onClick={() => setMenu(true)} aria-label="More actions" aria-haspopup="dialog">
          <Icon name="more" size={22} strokeWidth={3} />
        </button>
      </header>

        {trackable && (
          <section className="track card animate-in" aria-label="Live tracking">
            <div className="track__head">
              <span className="track__pulse" aria-hidden />
              <div>
                <h2 className="track__title">Track this flight live</h2>
                <p className="track__sub">Gate, delays and the plane’s position on the day of travel.</p>
              </div>
            </div>
            <div className="track__links">
              {links.map((l) => (
                <a key={l.label} className="btn btn--block" href={l.url} target="_blank" rel="noopener noreferrer">
                  <Icon name="globe" size={16} /> {l.label}
                </a>
              ))}
            </div>
          </section>
        )}
      <TripChip flight={f} all={all} />
      <div className="detail__grid">
        <article className="pass animate-in" aria-label="Boarding pass">
          <div className="pass__top">
            <AirlineLogo iata={f.airlineIata} icao={f.airlineIcao} name={airline} size={40} />
            <div className="pass__airline">
              <span className="pass__airline-name">{airline ?? 'Unknown airline'}</span>
              {fn && <span className="pass__fn">{fn}</span>}
            </div>
            <span className="pass__date-chip">
              <span className="pass__date-main">{rowDate(f).main}</span>
              <span className="pass__date-year">{f.date.slice(0, 4)}</span>
            </span>
          </div>

          {from && to && (
            <div className="pass__map">
              <RouteMap from={from} to={to} fromLabel={fromCode} toLabel={toCode} />
            </div>
          )}

          <div className="pass__route">
            <Endpoint kind="from" code={fromCode} ident={f.from} airport={from} time={f.depTime} date={f.date} clock={clock} />
            <div className="pass__mid">
              <span className="pass__dur tabular">
                {duration !== undefined ? `${estimated ? '~' : ''}${formatDuration(duration)}` : '—'}
              </span>
              <span className="pass__track" aria-hidden>
                <Icon name="plane" size={16} className="pass__plane" />
              </span>
            </div>
            <Endpoint kind="to" code={toCode} ident={f.to} airport={to} time={f.arrTime} date={arrDate} clock={clock} dayOffset={f.arrDayOffset} />
          </div>

          <div className="pass__when">
            <Icon name="calendar" size={16} />
            <span>{formatFlightDate(f.date, f.datePrecision, 'long')}</span>
            {km !== undefined && (
              <span className="pass__alt tabular">
                {formatDistance(km, unit)} · {formatDistance(km, other)}
              </span>
            )}
          </div>

          <div className="pass__tear" aria-hidden />

          <div className="pass__stub">
            <dl className="pass__grid">
              <Field label="Flight" value={fn} mono />
              <Field label="Seat" value={f.seatNumber} mono sub={f.seatType ? SEAT_LABEL[f.seatType] : undefined} />
              <Field label="Class" value={cabinLabel(f.cabinClass)} />
              <Field
                label="Aircraft"
                wide
                value={aircraft}
                extra={f.aircraftType ? <span className="pass__type">{f.aircraftType}</span> : undefined}
              />
              <Field label="Registration" value={f.registration} mono />
              <Field
                label="Airline"
                wide
                value={airline}
                to={airlineKey(f) ? airlineHref(airlineKey(f)!) : undefined}
                extra={f.airlineIata || f.airlineIcao ? <span className="pass__type">{[f.airlineIata, f.airlineIcao].filter(Boolean).join(' / ')}</span> : undefined}
              />
              <Field label="Reason" value={reasonLabel(f.reason)} />
              <Field label="Occasion" value={formatOccasions(occasionsOf(f)) || undefined} />
              <Field label="Source" value={SOURCE_LABEL[f.source] ?? f.source} small wide />
            </dl>

            {f.note && (
              <div className="pass__note">
                <span className="pass__label">Notes</span>
                <p>{f.note}</p>
              </div>
            )}

            <Barcode seed={f.id} caption={`${fromCode}${toCode} ${f.date.replace(/-/g, '')} ${f.flightNumber ?? ''}`.trim()} />
          </div>
        </article>

        <aside className="detail__side">
          <HistoryCard flight={f} history={history} fromCode={fromCode} toCode={toCode} airline={airline} />
          <div className="detail__actions">
            <Link to={`/flights/new?return=${f.id}`} className="btn btn--block">
              <Icon name="return" size={18} /> Log return flight
            </Link>
            <Link to={`/flights/${f.id}/edit`} className="btn btn--block">
              <Icon name="edit" size={18} /> Edit flight
            </Link>
          </div>
        </aside>
      </div>

      <Sheet open={menu} onClose={closeMenu} label="Flight actions">
        <div className="sheet__title">{title}</div>
        <SheetItem icon="return" label="Log return flight" hint={`${toCode} → ${fromCode}`} to={`/flights/new?return=${f.id}`} />
        <SheetItem icon="copy" label="Duplicate" hint="Same route, new date" to={`/flights/new?duplicate=${f.id}`} />
        <SheetItem icon="image" label="Share as image" hint="A card with the route map" onClick={() => void shareImage()} />
        <SheetItem icon="share" label="Share as text" onClick={share} />
        {upcoming && f.datePrecision === 'day' && <SheetItem icon="calendar" label="Add to calendar" hint="Downloads a calendar event" onClick={addToCalendar} />}
        {links[0] && <SheetItem icon="globe" label={trackable ? 'Track live on Flightradar24' : 'Flight history on Flightradar24'} href={links[0].url} />}
        <SheetItem
          icon="trash"
          label="Delete flight"
          danger
          onClick={() => {
            setMenu(false);
            setConfirm(true);
          }}
        />
        <button type="button" className="btn btn--block sheet__cancel" onClick={closeMenu}>
          Cancel
        </button>
      </Sheet>

      <ConfirmSheet
        open={confirm}
        title="Delete this flight?"
        icon="trash"
        danger
        message={`${fn ? `${fn} · ` : ''}${fromCode} → ${toCode} on ${formatFlightDate(f.date, f.datePrecision)} will be permanently removed from your log.`}
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={remove}
        onCancel={closeConfirm}
      />

      {toast && (
        <div className="dtoast" role="status">
          <Icon name="check" size={16} /> {toast}
        </div>
      )}
    </div>
  );
}

function Endpoint({
  kind,
  code,
  ident,
  airport,
  time,
  date,
  clock,
  dayOffset,
}: {
  kind: 'from' | 'to';
  code: string;
  ident: string;
  airport: Airport | undefined;
  time: string | undefined;
  date: string;
  clock: Settings['clock'];
  dayOffset?: number;
}) {
  const t = formatTime(time, clock);
  const [hm, ampm] = t.split(' ');
  const tz = time ? tzAbbrev(date, time, airport?.tz) : '';
  const country = airport ? getCountry(airport.country)?.name : undefined;
  // "San Diego, CA" / "Paris, France" / "London" (long country names would crowd the ticket).
  const suffix = airport?.country === 'US' ? airport.region : country && country.length <= 12 ? country : undefined;
  const place = airport ? [airport.city, suffix].filter(Boolean).join(', ') : ident;
  return (
    <Link to={airportHref(ident)} className={`pass__end pass__end--${kind} pass__end--link`}>
      <span className="pass__label">{kind === 'from' ? 'Depart' : 'Arrive'}</span>
      <span className="pass__code">{code}</span>
      <span className="pass__city">
        {place || shortCity(ident)}
        <Icon name="chevron" size={13} className="xp-chev" />
      </span>
      {airport?.name && <span className="pass__airport">{airport.name}</span>}
      <span className="pass__time tabular">
        {t ? (
          <>
            {hm}
            {ampm && <span className="pass__ampm">{ampm}</span>}
            {dayOffset ? <sup className="pass__offset">{dayOffset > 0 ? `+${dayOffset}` : dayOffset}</sup> : null}
          </>
        ) : (
          <span className="pass__notime">--:--</span>
        )}
      </span>
      {tz && <span className="pass__tz">{tz}</span>}
    </Link>
  );
}

function Field({
  label,
  value,
  sub,
  mono,
  wide,
  small,
  extra,
  to,
}: {
  label: string;
  value: string | undefined;
  sub?: string;
  mono?: boolean;
  wide?: boolean;
  small?: boolean;
  extra?: ReactNode;
  /** Makes the value a link (e.g. the airline's history page). */
  to?: string;
}) {
  return (
    <div className={`pass__field${wide ? ' pass__field--wide' : ''}`}>
      <dt className="pass__label">{label}</dt>
      <dd className={`pass__value${mono ? ' pass__value--mono' : ''}${small ? ' pass__value--small' : ''}${value ? '' : ' pass__value--empty'}`}>
        {value && to ? (
          <Link to={to} className="pass__value-link">
            {value}
            <Icon name="chevron" size={14} className="xp-chev" />
          </Link>
        ) : (
          (value ?? '—')
        )}
        {value && sub && <span className="pass__sub">{sub}</span>}
        {value && extra}
      </dd>
    </div>
  );
}

/** Decorative barcode derived from the flight id (stable per flight). */
function Barcode({ seed, caption }: { seed: string; caption: string }) {
  const bars = useMemo(() => {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
    const out: { x: number; w: number }[] = [];
    let x = 0;
    while (x < 236) {
      h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
      const w = 1 + ((h >>> 3) & 3) * 0.8;
      const gap = 1.4 + ((h >>> 7) & 3) * 0.9;
      out.push({ x, w });
      x += w + gap;
    }
    return { out, width: x };
  }, [seed]);
  return (
    <div className="pass__barcode" aria-hidden>
      <svg viewBox={`0 0 ${bars.width} 40`} preserveAspectRatio="none">
        {bars.out.map((b, i) => (
          <rect key={i} x={b.x} y={0} width={b.w} height={40} />
        ))}
      </svg>
      <span>{caption}</span>
    </div>
  );
}

function HistoryCard({
  flight: f,
  history: h,
  fromCode,
  toCode,
  airline,
}: {
  flight: Flight;
  history: ReturnType<typeof flightHistory>;
  fromCode: string;
  toCode: string;
  airline: string | undefined;
}) {
  const [showAll, setShowAll] = useState(false);
  const aircraftShort = f.aircraftType ? (getAircraftType(f.aircraftType)?.name ?? f.aircraftName ?? f.aircraftType) : undefined;
  const tiles: { value: number; label: string; icon: IconName }[] = [{ value: h.routeCount, label: `${fromCode} ⇄ ${toCode}`, icon: 'swap' }];
  if (h.airlineCount && airline) tiles.push({ value: h.airlineCount, label: `with ${airline}`, icon: 'plane' });
  if (h.aircraftCount && aircraftShort) tiles.push({ value: h.aircraftCount, label: `on ${aircraftShort}`, icon: 'seat' });
  if (h.tailCount && f.registration) tiles.push({ value: h.tailCount, label: `on ${f.registration}`, icon: 'sparkle' });
  const list = showAll ? h.sameRoute : h.sameRoute.slice(0, 5);

  return (
    <section className="hist animate-in" aria-labelledby="hist-title">
      <h2 id="hist-title" className="hist__title">
        Your history
      </h2>
      <p className="hist__lead">
        {h.routeCount > 1 ? (
          <>
            {isUpcoming(f) ? 'This will be your' : 'Your'} <strong>{ordinal(h.routeOrdinal)}</strong> flight between {fromCode} and {toCode}.
          </>
        ) : (
          <>
            Your first flight between {fromCode} and {toCode}. <span className="hist__new">New route</span>
          </>
        )}
      </p>
      <div className="hist__tiles">
        {tiles.map((t) => (
          <div key={t.label} className="hist__tile">
            <span className="hist__num tabular">{t.value}</span>
            <span className="hist__unit">{t.value === 1 ? 'flight' : 'flights'}</span>
            <span className="hist__lbl">{t.label}</span>
          </div>
        ))}
      </div>
      {h.sameRoute.length > 0 && (
        <>
          <h3 className="hist__sub">Other flights on this route</h3>
          <div className="list hist__list">
            {list.map((o) => (
              <Link key={o.id} to={`/flights/${o.id}`} className="list__row hist__row">
                <span className="hist__date tabular">{formatFlightDate(o.date, o.datePrecision)}</span>
                <span className="hist__dir code">
                  {airportCode(o.from)} <span className="subtle">→</span> {airportCode(o.to)}
                </span>
                <span className="hist__meta">{prettyFlightNumber(o.flightNumber)}</span>
                <Icon name="chevron" size={16} className="hist__chev" />
              </Link>
            ))}
          </div>
          {h.sameRoute.length > 5 && (
            <button type="button" className="btn btn--ghost btn--block hist__more" onClick={() => setShowAll((s) => !s)}>
              {showAll ? 'Show fewer' : `Show all ${h.sameRoute.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function SheetItem({ icon, label, hint, to, href, onClick, danger }: { icon: IconName; label: string; hint?: string; to?: string; href?: string; onClick?: () => void; danger?: boolean }) {
  const content = (
    <>
      <span className="sheet__icon">
        <Icon name={icon} size={20} />
      </span>
      <span className="sheet__text">
        {label}
        {hint && <span className="sheet__hint">{hint}</span>}
      </span>
    </>
  );
  const cls = `sheet__item${danger ? ' sheet__item--danger' : ''}`;
  if (href) {
    return (
      <a href={href} className={cls} target="_blank" rel="noopener noreferrer">
        {content}
      </a>
    );
  }
  return to ? (
    <Link to={to} className={cls}>
      {content}
    </Link>
  ) : (
    <button type="button" className={cls} onClick={onClick}>
      {content}
    </button>
  );
}

function DetailSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <div className="detail" aria-busy="true" aria-label="Loading flight">
      <header className="dbar">
        <button type="button" className="btn btn--ghost btn--icon dbar__btn" onClick={onBack} aria-label="Back">
          <Icon name="back" size={22} />
        </button>
        <div className="dbar__title" />
      </header>
      <div className="detail__grid">
        <div className="pass pass--skeleton">
          <div className="pass__top">
            <div className="skeleton" style={{ width: 40, height: 40, borderRadius: 12 }} />
            <div className="skeleton" style={{ width: 140, height: 16 }} />
          </div>
          <div className="pass__map skeleton" style={{ borderRadius: 0 }} />
          <div className="pass__route">
            <div className="skeleton" style={{ width: 90, height: 56 }} />
            <div />
            <div className="skeleton" style={{ width: 90, height: 56, justifySelf: 'end' }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function NotFound({ onBack }: { onBack: () => void }) {
  return (
    <div className="detail">
      <header className="dbar">
        <button type="button" className="btn btn--ghost btn--icon dbar__btn" onClick={onBack} aria-label="Back">
          <Icon name="back" size={22} />
        </button>
      </header>
      <div className="empty">
        <span className="confirm__icon confirm__icon--muted" aria-hidden>
          <Icon name="plane" size={24} />
        </span>
        <div className="empty__title">Flight not found</div>
        <p>It may have been deleted, or the link is from another device.</p>
        <Link to="/" className="btn btn--primary">
          Back to your flights
        </Link>
      </div>
    </div>
  );
}
