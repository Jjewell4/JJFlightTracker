/** Bottom sheet (phones) / floating card (desktop) with airport or route details. */
import { forwardRef, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { getCountry } from '@/data/reference';
import { flightAirlineName } from '@/lib/flight-utils';
import { kmToMiles } from '@/lib/geo';
import { formatFlightDate, formatTime } from '@/lib/time';
import type { Airport, Flight, Settings } from '@/lib/types';
import { flagEmoji, routeKey, type AirportAgg, type RouteAgg } from './map-data';

interface SheetProps {
  onClose: () => void;
  children: ReactNode;
  label: string;
}

/** Glass sheet with a drag-to-dismiss handle. */
const Sheet = forwardRef<HTMLDivElement, SheetProps>(function Sheet({ onClose, children, label }, ref) {
  const [dy, setDy] = useState(0);
  const start = useRef<number | null>(null);
  const onDown = (e: PointerEvent) => {
    start.current = e.clientY;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (start.current != null) setDy(Math.max(0, e.clientY - start.current));
  };
  const onUp = () => {
    if (dy > 80) onClose();
    start.current = null;
    setDy(0);
  };
  return (
    <section
      ref={ref}
      className="map-sheet"
      role="dialog"
      aria-label={label}
      style={dy ? { transform: `translateY(${dy}px)`, transition: 'none' } : undefined}
    >
      <div className="map-sheet__grip" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} aria-hidden>
        <span />
      </div>
      <button type="button" className="map-sheet__close" onClick={onClose} aria-label="Close">
        <Icon name="close" size={18} />
      </button>
      <div className="map-sheet__body">{children}</div>
    </section>
  );
});

const fmtDist = (km: number, unit: Settings['distanceUnit']) =>
  `${Math.round(unit === 'mi' ? kmToMiles(km) : km).toLocaleString('en-US')} ${unit}`;

const place = (a: Airport) => [a.city, a.region && a.country === 'US' ? a.region : getCountry(a.country)?.name ?? a.country].filter(Boolean).join(', ');

const times = (n: number) => `${n} ${n === 1 ? 'flight' : 'flights'}`;

// ---------- airport ----------

export const AirportSheet = forwardRef<
  HTMLDivElement,
  { agg: AirportAgg; year: number | null; onClose: () => void; onSelectRoute: (key: string) => void }
>(function AirportSheet({ agg, year, onClose, onSelectRoute }, ref) {
  const { airport: a } = agg;
  const top = agg.destinations.slice(0, 6);
  const max = top[0]?.count ?? 1;
  const code = a.iata || a.ident;
  const params = new URLSearchParams({ airport: a.ident });
  if (year) params.set('year', String(year));
  return (
    <Sheet ref={ref} onClose={onClose} label={`${code} airport details`}>
      <header className="map-card__head">
        <div className="map-card__code code">{code}</div>
        <div className="map-card__title">
          <h2>{a.name}</h2>
          <p className="muted">
            <span className="map-card__flag" aria-hidden>
              {flagEmoji(a.country)}
            </span>{' '}
            {place(a)}
          </p>
        </div>
      </header>

      <dl className="map-card__stats">
        <div>
          <dt>Visits</dt>
          <dd>{agg.visits}</dd>
        </div>
        <div>
          <dt>Departures</dt>
          <dd>{agg.departures}</dd>
        </div>
        <div>
          <dt>Arrivals</dt>
          <dd>{agg.arrivals}</dd>
        </div>
      </dl>
      <div className="map-card__dates">
        <span>
          <span className="subtle">First</span> {formatFlightDate(agg.firstDate, 'month')}
        </span>
        <span>
          <span className="subtle">Last</span> {formatFlightDate(agg.lastDate, 'month')}
        </span>
      </div>

      {top.length > 0 && (
        <>
          <h3 className="map-card__section">Top destinations{year ? ` in ${year}` : ''}</h3>
          <ul className="map-dest">
            {top.map((d) => (
              <li key={d.airport.ident}>
                <button type="button" className="map-dest__row" onClick={() => onSelectRoute(routeKey(a.ident, d.airport.ident))}>
                  <span className="map-dest__code code">{d.airport.iata || d.airport.ident}</span>
                  <span className="map-dest__city">{d.airport.city || d.airport.name}</span>
                  <span className="map-dest__bar" aria-hidden>
                    <span style={{ width: `${Math.max(8, (d.count / max) * 100)}%` }} />
                  </span>
                  <span className="map-dest__count">{d.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <Link to={`/?${params}`} className="btn btn--block map-card__cta">
        View {times(agg.visits)}
        <Icon name="chevron" size={16} />
      </Link>
    </Sheet>
  );
});

// ---------- route ----------

function FlightRow({ f, route, clock }: { f: Flight; route: RouteAgg; clock: Settings['clock'] }) {
  const forward = f.from === route.a.ident;
  const [from, to] = forward ? [route.a, route.b] : [route.b, route.a];
  const airline = flightAirlineName(f);
  const dep = formatTime(f.depTime, clock);
  return (
    <li>
      <Link to={`/flights/${f.id}`} className="map-flight">
        <span className="map-flight__date">{formatFlightDate(f.date, f.datePrecision)}</span>
        <span className="map-flight__dir code">
          {from.iata || from.ident} → {to.iata || to.ident}
        </span>
        <span className="map-flight__meta subtle">{[f.flightNumber, airline, dep].filter(Boolean).join(' · ')}</span>
        <Icon name="chevron" size={16} className="map-flight__chev" />
      </Link>
    </li>
  );
}

export const RouteSheet = forwardRef<
  HTMLDivElement,
  { route: RouteAgg; year: number | null; settings: Settings; onClose: () => void; onSelectAirport: (ident: string) => void }
>(function RouteSheet({ route, year, settings, onClose, onSelectAirport }, ref) {
  const [all, setAll] = useState(false);
  const shown = all ? route.flights : route.flights.slice(0, 8);
  const { a, b } = route;
  return (
    <Sheet ref={ref} onClose={onClose} label={`Route ${a.iata || a.ident} to ${b.iata || b.ident}`}>
      <header className="map-route__head">
        <button type="button" className="map-route__end" onClick={() => onSelectAirport(a.ident)}>
          <span className="map-route__code code">{a.iata || a.ident}</span>
          <span className="map-route__city">
            {flagEmoji(a.country)} {a.city || a.name}
          </span>
        </button>
        <span className="map-route__arc" aria-hidden>
          <svg viewBox="0 0 64 24" width="64" height="24">
            <path d="M4 20 Q32 -6 60 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeDasharray="2 4" strokeLinecap="round" />
            <circle cx="4" cy="20" r="2.5" fill="currentColor" />
            <circle cx="60" cy="20" r="2.5" fill="currentColor" />
          </svg>
          <span>{fmtDist(route.distanceKm, settings.distanceUnit)}</span>
        </span>
        <button type="button" className="map-route__end map-route__end--right" onClick={() => onSelectAirport(b.ident)}>
          <span className="map-route__code code">{b.iata || b.ident}</span>
          <span className="map-route__city">
            {flagEmoji(b.country)} {b.city || b.name}
          </span>
        </button>
      </header>

      <dl className="map-card__stats">
        <div>
          <dt>Flown{year ? ` in ${year}` : ''}</dt>
          <dd>{route.count}×</dd>
        </div>
        <div>
          <dt>First</dt>
          <dd className="map-card__small">{formatFlightDate(route.firstDate, 'month')}</dd>
        </div>
        <div>
          <dt>Last</dt>
          <dd className="map-card__small">{formatFlightDate(route.lastDate, 'month')}</dd>
        </div>
      </dl>

      {route.airlines.length > 0 && (
        <div className="map-route__airlines">
          {route.airlines.map((al) => (
            <span key={al.key} className="badge">
              {al.label}
              <span className="subtle">{al.count}</span>
            </span>
          ))}
        </div>
      )}

      <h3 className="map-card__section">Flights</h3>
      <ul className="map-flights">
        {shown.map((f) => (
          <FlightRow key={f.id} f={f} route={route} clock={settings.clock} />
        ))}
      </ul>
      {route.flights.length > shown.length && (
        <button type="button" className="btn btn--ghost btn--block" onClick={() => setAll(true)}>
          Show all {route.flights.length}
        </button>
      )}
    </Sheet>
  );
});
