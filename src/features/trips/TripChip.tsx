import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { tripDates, tripOf, tripTitle } from '@/lib/trips';
import type { Flight } from '@/lib/types';
import { tripsFor } from './use-trips';
import './trips.css';

/**
 * "Part of a trip" link on a flight's page, shown when the flight belongs to a saved trip or a
 * suggested one (two or more legs). Renders nothing otherwise — or until the log has loaded.
 */
export function TripChip({ flight, all }: { flight: Flight; all: Flight[] }) {
  const trip = useMemo(() => (all.length ? tripOf(tripsFor(all), flight.id) : undefined), [all, flight.id]);
  if (!trip || (!trip.saved && trip.flights.length < 2)) return null;
  const leg = trip.flights.findIndex((f) => f.id === flight.id) + 1;
  return (
    <Link to={`/trips/${encodeURIComponent(trip.id)}`} className="tripchip animate-in">
      <span className="tripchip__icon" aria-hidden>
        <Icon name="suitcase" size={18} />
      </span>
      <span className="tripchip__text">
        <span className="tripchip__title">{tripTitle(trip)}</span>
        <span className="tripchip__label">
          {trip.saved ? 'Part of a trip' : 'Suggested trip'} · {tripDates(trip)}
        </span>
      </span>
      {trip.flights.length > 1 && (
        <span className="tripchip__leg">
          {leg} of {trip.flights.length}
        </span>
      )}
      <Icon name="chevron" size={16} className="tripchip__chev" />
    </Link>
  );
}
