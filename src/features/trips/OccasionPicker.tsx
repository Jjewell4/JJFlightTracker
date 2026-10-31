import { Icon } from '@/components/Icon';
import { FLIGHT_OCCASIONS, MAX_OCCASIONS, OCCASION_ICON, OCCASION_LABELS, toggleOccasion } from '@/lib/occasions';
import type { FlightOccasion } from '@/lib/types';
import './trips.css';

/**
 * Occasion chips: up to two (a wedding plus a vacation). Tapping a picked chip removes it; a third
 * pick replaces the oldest.
 */
export function OccasionPicker({ value, onChange, label = 'Occasion' }: { value: readonly FlightOccasion[]; onChange: (list: FlightOccasion[]) => void; label?: string }) {
  return (
    <div className="occpick" role="group" aria-label={`${label} (up to ${MAX_OCCASIONS})`}>
      {FLIGHT_OCCASIONS.map((o) => (
        <button key={o} type="button" className="chip occpick__chip" aria-pressed={value.includes(o)} onClick={() => onChange(toggleOccasion(value, o))}>
          <Icon name={OCCASION_ICON[o]} size={16} /> {OCCASION_LABELS[o]}
        </button>
      ))}
    </div>
  );
}
