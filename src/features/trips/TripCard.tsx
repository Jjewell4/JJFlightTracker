import { memo, useId, useMemo } from 'react';
import { OCCASION_ICON, OCCASION_LABELS, tripOccasions } from '@/lib/occasions';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { airportCode } from '@/lib/flight-utils';
import { tripDates, tripRoute, tripTitle, type Trip } from '@/lib/trips';
import type { Settings } from '@/lib/types';
import { routeText, tripStatsLine } from './trip-format';
import { tripDrawing } from './trip-geometry';

const S = 72;

/** Tiny map of the trip: faint land dots, the legs and the airports. */
export const TripSketch = memo(function TripSketch({ trip }: { trip: Trip }) {
  const uid = useId().replace(/:/g, '');
  const g = useMemo(() => tripDrawing(trip, S, S, { padding: 0.24, minSpanDeg: 18, dotSpacing: 4, bow: 0.14, segments: 24 }), [trip]);
  return (
    <svg className="tsketch" viewBox={`0 0 ${S} ${S}`} aria-hidden="true">
      <defs>
        <radialGradient id={`v${uid}`} cx="0.5" cy="0.5" r="0.62">
          <stop offset="0.55" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id={`m${uid}`}>
          <rect width={S} height={S} fill={`url(#v${uid})`} />
        </mask>
      </defs>
      <path d={g.dots} className="tsketch__land" mask={`url(#m${uid})`} />
      {g.legs.map((l) => (
        <path key={l.n} d={l.d} className="tsketch__leg" />
      ))}
      {g.airports.map((a) => (
        <circle key={a.ident} cx={a.x} cy={a.y} r={a.role === 'connection' ? 1.6 : 2.4} className={`tsketch__pin tsketch__pin--${a.role}`} />
      ))}
    </svg>
  );
});

/**
 * "SAN → DEN → BOS → SAN" with connections set smaller, so destinations stand out. `compact`
 * lifts connections out to a trailing "via DEN" (when the remaining stops still tell the story).
 */
export function TripRouteLine({ trip, compact, className = '' }: { trip: Trip; compact?: boolean; className?: string }) {
  const route = tripRoute(trip);
  const main = route.filter((s) => s.role !== 'connection');
  const vias = [...new Set(route.filter((s) => s.role === 'connection').map((s) => airportCode(s.airport)))];
  const lift = compact && vias.length > 0 && main.length >= 3 && main.every((s, i) => i === 0 || s.airport !== main[i - 1].airport);
  const shown = lift ? main : route;
  return (
    <span className={`troute ${className}`} aria-label={routeText(trip)}>
      {shown.map((s, i) => (
        <span key={i} className={`troute__stop troute__stop--${s.role}`} aria-hidden>
          {airportCode(s.airport)}
          {i < shown.length - 1 ? <span className="troute__arrow">→</span> : lift && <span className="troute__via">via {vias.join(', ')}</span>}
        </span>
      ))}
    </span>
  );
}

/** One trip in the Log → Trips list. Suggestions are drawn a little lighter than saved trips. */
export const TripCard = memo(function TripCard({ trip, unit, upcoming }: { trip: Trip; unit: Settings['distanceUnit']; upcoming?: boolean }) {
  const title = tripTitle(trip);
  const { occasions } = tripOccasions(trip);
  return (
    <Link to={`/trips/${encodeURIComponent(trip.id)}`} className={`tcard${trip.saved ? ' tcard--saved' : ''}`}>
      <span className="tcard__map">
        <TripSketch trip={trip} />
      </span>
      <span className="tcard__body">
        <span className="tcard__top">
          {trip.saved && <Icon name="bookmark" size={14} className="tcard__saved-icon" strokeWidth={2.2} />}
          <span className="tcard__title">{title}</span>
          {upcoming ? <span className="tcard__tag tcard__tag--soon">Upcoming</span> : !trip.saved && <span className="tcard__tag">Suggested</span>}
        </span>
        <span className="tcard__dates">{tripDates(trip)}</span>
        {occasions.length > 0 && (
          <span className="tcard__occasions">
            {occasions.map((o) => (
              <span key={o} className="tcard__occasion">
                <Icon name={OCCASION_ICON[o]} size={13} strokeWidth={2} />
                {OCCASION_LABELS[o]}
              </span>
            ))}
          </span>
        )}
        <TripRouteLine trip={trip} compact className="tcard__route" />
        <span className="tcard__stats tabular">{tripStatsLine(trip, unit)}</span>
      </span>
      <Icon name="chevron" size={16} className="tcard__chev" />
    </Link>
  );
});
