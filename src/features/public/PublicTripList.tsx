import { useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { airportCode, flightAirlineName } from '@/lib/flight-utils';
import { formatFlightDate } from '@/lib/time';
import { groupTripsByYear, tripDates, tripFromLegs, tripTitle, type Trip } from '@/lib/trips';
import type { Flight, Settings } from '@/lib/types';
import { TripRouteLine, TripSketch } from '@/features/trips/TripCard';
import { formatDistance } from '@/features/flights/flight-logic';
import { plural, tripStatsLine } from '@/features/trips/trip-format';
import '@/features/trips/trips.css';

/**
 * Trips the owner saved (never automatic suggestions), newest first. Built from the saved
 * grouping itself, so they show even when the journal only shares months.
 */
export function savedTrips(flights: Flight[]): Trip[] {
  const groups = new Map<string, Flight[]>();
  for (const f of flights) if (f.tripId) groups.set(f.tripId, [...(groups.get(f.tripId) ?? []), f]);
  return [...groups.entries()]
    .map(([id, legs]) => ({ ...tripFromLegs(legs), id, saved: true, name: legs.find((l) => l.tripName)?.tripName }))
    .sort((a, b) => b.start.localeCompare(a.start));
}

const monthFmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' });

/** Journals that share only months can't say how many nights a trip was. */
function exact(t: Trip) {
  return t.flights.every((f) => f.datePrecision === 'day');
}

export function PublicTripList({ flights, unit }: { flights: Flight[]; unit: Settings['distanceUnit'] }) {
  const years = useMemo(() => groupTripsByYear(savedTrips(flights)), [flights]);
  const [open, setOpen] = useState<string | null>(null);
  if (!years.length) {
    return (
      <div className="empty">
        <Icon name="suitcase" size={32} />
        <p className="empty__title">No trips shared yet</p>
        <p>Trips appear here once they’re saved in the journal.</p>
      </div>
    );
  }
  return (
    <div className="flights trips pj-trips">
      {years.map((y) => (
        <section key={y.year} className="tyear" aria-labelledby={`pj-trips-${y.year}`}>
          <h2 id={`pj-trips-${y.year}`} className="tyear__head">
            <span className="tyear__year">{y.year}</span>
            <span className="tyear__meta tabular">{plural(y.trips.length, 'trip')}</span>
          </h2>
          <ul className="tyear__list pj-trips__list">
            {y.trips.map((t) => {
              const expanded = open === t.id;
              return (
                <li key={t.id}>
                  <button type="button" className="tcard tcard--saved pj-trip" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : t.id)}>
                    <span className="tcard__map">
                      <TripSketch trip={t} />
                    </span>
                    <span className="tcard__body">
                      <span className="tcard__top">
                        <Icon name="bookmark" size={14} className="tcard__saved-icon" strokeWidth={2.2} />
                        <span className="tcard__title">{tripTitle(t)}</span>
                      </span>
                      <span className="tcard__dates">
                        {exact(t) ? tripDates(t) : t.start.slice(0, 7) === t.end.slice(0, 7) ? monthFmt(t.start) : `${monthFmt(t.start)} – ${monthFmt(t.end)}`}
                      </span>
                      <TripRouteLine trip={t} compact className="tcard__route" />
                      <span className="tcard__stats tabular">
                        {exact(t)
                          ? tripStatsLine(t, unit)
                          : [plural(t.flights.length, 'flight'), t.distanceKm > 0 ? formatDistance(t.distanceKm, unit) : ''].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <Icon name="chevron" size={16} className={`tcard__chev pj-trip__chev${expanded ? ' is-open' : ''}`} />
                  </button>
                  {expanded && (
                    <ol className="pj-trip__legs">
                      {t.flights.map((f) => (
                        <li key={f.id}>
                          <span className="pj-trip__route">
                            {airportCode(f.from)} → {airportCode(f.to)}
                          </span>
                          <span className="pj-trip__meta">{[formatFlightDate(f.date, f.datePrecision), flightAirlineName(f)].filter(Boolean).join(' · ')}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
