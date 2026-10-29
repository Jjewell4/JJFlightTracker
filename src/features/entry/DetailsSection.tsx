import { useId } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { FLIGHT_OCCASIONS, OCCASION_ICON, OCCASION_LABELS, OCCASION_REASON } from '@/lib/occasions';
import type { CabinClass, DatePrecision, FlightReason, SeatType } from '@/lib/types';
import { inferSeatType, type FormValues } from './form-model';

const CABINS: { value: CabinClass; label: string }[] = [
  { value: 'economy', label: 'Economy' },
  { value: 'premium', label: 'Premium' },
  { value: 'business', label: 'Business' },
  { value: 'first', label: 'First' },
  { value: 'private', label: 'Private' },
];
const REASONS: { value: FlightReason; label: string }[] = [
  { value: 'leisure', label: 'Leisure' },
  { value: 'business', label: 'Business' },
  { value: 'crew', label: 'Crew' },
  { value: 'other', label: 'Other' },
];
const OCCASIONS = FLIGHT_OCCASIONS.map((value) => ({
  value,
  label: (
    <>
      <Icon name={OCCASION_ICON[value]} size={16} /> {OCCASION_LABELS[value]}
    </>
  ),
}));
const SEATS: { value: SeatType; label: string }[] = [
  { value: 'window', label: 'Window' },
  { value: 'middle', label: 'Middle' },
  { value: 'aisle', label: 'Aisle' },
];
const PRECISIONS: { value: DatePrecision; label: string }[] = [
  { value: 'day', label: 'Exact day' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year only' },
];

/** Radio group rendered as a segmented control or chips; tapping the selected option clears it when `clearable`. */
function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  variant = 'seg',
  clearable = true,
}: {
  label: string;
  options: { value: T; label: React.ReactNode }[];
  value: T | undefined;
  onChange: (v: T | undefined) => void;
  variant?: 'seg' | 'chips';
  clearable?: boolean;
}) {
  const id = useId();
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const i = Math.max(0, options.findIndex((o) => o.value === value));
    const next = options[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length];
    onChange(next.value);
    (e.currentTarget.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div className="entry-field">
      <span className="field__label" id={id}>
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={id} className={variant === 'seg' ? 'seg' : 'chip-group'} onKeyDown={onKeyDown}>
        {options.map((o) => {
          const checked = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              data-value={o.value}
              aria-checked={checked}
              tabIndex={checked || (!value && o === options[0]) ? 0 : -1}
              className={variant === 'seg' ? 'seg__opt' : 'chip choice-chip'}
              onClick={() => onChange(checked && clearable ? undefined : o.value)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PickerRow({ label, value, sub, icon, placeholder, filled, onClick }: { label: string; value?: string; sub?: string; icon: IconName; placeholder: string; filled?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`picker-row${filled ? ' is-filled' : ''}`} onClick={onClick} aria-haspopup="dialog">
      <span className="picker-row__icon" aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <span className="picker-row__main">
        <span className="picker-row__label">
          {label}
          {filled && <Icon name="sparkle" size={12} className="sparkle-icon" />}
        </span>
        <span className={`picker-row__value${value ? '' : ' is-placeholder'}`}>{value || placeholder}</span>
      </span>
      {sub && <span className="picker-row__sub mono">{sub}</span>}
      <Icon name="chevron" size={18} className="picker-row__chev" />
    </button>
  );
}

export function DetailsSection({
  v,
  open,
  onToggle,
  onPatch,
  onSeatType,
  onPrecision,
  onPickAircraft,
  filled,
}: {
  v: FormValues;
  open: boolean;
  onToggle: () => void;
  onPatch: (patch: Partial<FormValues>, key?: 'registration' | 'seat') => void;
  onSeatType: (t: SeatType | undefined) => void;
  onPrecision: (p: DatePrecision) => void;
  onPickAircraft: () => void;
  filled: { aircraft?: boolean; registration?: boolean; seat?: boolean };
}) {
  const panelId = useId();
  const seatGuess = inferSeatType(v.seatNumber, v.aircraftType);
  const summary = [
    v.aircraftName || v.aircraftType,
    v.seatNumber && `Seat ${v.seatNumber.toUpperCase()}`,
    CABINS.find((c) => c.value === v.cabinClass)?.label,
    REASONS.find((r) => r.value === v.reason)?.label,
    v.occasion && OCCASION_LABELS[v.occasion],
  ].filter(Boolean);

  return (
    <section className={`entry-card details${open ? ' is-open' : ''}`}>
      <button type="button" className="details__toggle" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
        <span className="details__toggle-main">
          <span className="details__title">More details</span>
          <span className="details__summary">{summary.length ? summary.join(' · ') : 'Aircraft, seat, class, notes'}</span>
        </span>
        <Icon name="chevron" size={20} className="details__chev" />
      </button>
      <div id={panelId} className="details__panel" hidden={!open}>
        <div className="details__inner">
          <PickerRow
            label="Aircraft"
            icon="plane"
            value={v.aircraftName || v.aircraftType}
            sub={v.aircraftType && v.aircraftName ? v.aircraftType : undefined}
            placeholder="Add aircraft type"
            filled={filled.aircraft}
            onClick={onPickAircraft}
          />

          <div className="details__row">
            <div className={`entry-field${filled.registration ? ' is-filled' : ''}`}>
              <label className="field__label" htmlFor="entry-reg">
                Registration {filled.registration && <Icon name="sparkle" size={12} className="sparkle-icon" />}
              </label>
              <input
                id="entry-reg"
                className="input mono entry-upper"
                value={v.registration}
                onChange={(e) => onPatch({ registration: e.target.value.toUpperCase() }, 'registration')}
                placeholder="N12345"
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                maxLength={10}
              />
            </div>
            <div className={`entry-field entry-field--seat${filled.seat ? ' is-filled' : ''}`}>
              <label className="field__label" htmlFor="entry-seat">
                Seat {filled.seat && <Icon name="sparkle" size={12} className="sparkle-icon" />}
              </label>
              <input
                id="entry-seat"
                className="input mono entry-upper"
                value={v.seatNumber}
                onChange={(e) => onPatch({ seatNumber: e.target.value.toUpperCase() }, 'seat')}
                placeholder="12A"
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                maxLength={5}
              />
            </div>
          </div>

          <div>
            <Choice label="Seat position" options={SEATS} value={v.seatType} onChange={onSeatType} />
            {seatGuess && v.seatType === seatGuess && <p className="field__hint details__hint">Guessed from seat {v.seatNumber.toUpperCase()} — tap to change</p>}
          </div>

          <Choice label="Cabin class" options={CABINS} value={v.cabinClass} onChange={(c) => onPatch({ cabinClass: c })} variant="chips" />
          <Choice label="Reason" options={REASONS} value={v.reason} onChange={(r) => onPatch({ reason: r })} />
          <Choice
            label="Occasion"
            options={OCCASIONS}
            value={v.occasion}
            // An occasion implies a reason when none was picked (a wedding is leisure, a conference business).
            onChange={(o) => onPatch({ occasion: o, ...(!v.reason && o && OCCASION_REASON[o] ? { reason: OCCASION_REASON[o] } : {}) })}
            variant="chips"
          />

          <div className="entry-field">
            <label className="field__label" htmlFor="entry-note">
              Notes
            </label>
            <textarea id="entry-note" className="input" rows={3} maxLength={2000} value={v.note} onChange={(e) => onPatch({ note: e.target.value })} placeholder="Upgrade, great views, delayed 2h…" />
          </div>

          <div>
            <Choice label="How exact is the date?" options={PRECISIONS} value={v.datePrecision} onChange={(p) => p && onPrecision(p)} clearable={false} />
            {v.datePrecision !== 'day' && <p className="field__hint details__hint">For old flights where you only remember the month or year. Times are hidden.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
