import { Icon } from '@/components/Icon';
import { FLIGHT_OCCASIONS, OCCASION_ICON, OCCASION_LABELS } from '@/lib/occasions';
import type { FlightOccasion } from '@/lib/types';
import './trips.css';

/** Occasion chips (one or none); tapping the selected chip clears it. */
export function OccasionPicker({ value, onChange, label = 'Occasion' }: { value: FlightOccasion | undefined; onChange: (o: FlightOccasion | undefined) => void; label?: string }) {
  return (
    <div className="occpick" role="group" aria-label={label}>
      {FLIGHT_OCCASIONS.map((o) => (
        <button key={o} type="button" className="chip occpick__chip" aria-pressed={o === value} onClick={() => onChange(o === value ? undefined : o)}>
          <Icon name={OCCASION_ICON[o]} size={16} /> {OCCASION_LABELS[o]}
        </button>
      ))}
    </div>
  );
}
