import { useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { getAirport } from '@/data/reference';
import { formatDuration, formatTime, isValidTime } from '@/lib/time';
import { timing, type FormValues } from './form-model';
import { airportCity, tzAbbr } from './format';
import { estimateArrival, splitTime, toTime } from './time-input';
import { TimePickerSheet, type TimeRole } from './TimePicker';

const OFFSETS = [0, 1, 2, -1];
const offsetLabel = (n: number) => (n === 0 ? 'Same day' : n === 1 ? '+1 day' : n === -1 ? '−1 day' : `+${n} days`);

/** Starting wheel position for an unset time. */
function fallbackTime(role: TimeRole, v: FormValues, estimate: string | undefined): string {
  if (role === 'dep') return '09:00';
  if (estimate) return estimate;
  if (isValidTime(v.depTime)) {
    const { h, m } = splitTime(v.depTime);
    return toTime((h + 2) % 24, m);
  }
  return '12:00';
}

function TimeValue({ t, clock }: { t: string; clock: '12h' | '24h' }) {
  const [main, suffix] = formatTime(t, clock).split(' ');
  return (
    <>
      {main}
      {suffix && (
        <>
          {' '}
          <span className="time-btn__suffix">{suffix}</span>
        </>
      )}
    </>
  );
}

export function TimesCard({
  v,
  onChange,
  clock,
  filled,
  error,
}: {
  v: FormValues;
  onChange: (patch: Pick<Partial<FormValues>, 'depTime' | 'arrTime' | 'arrDayOffset'>) => void;
  clock: '12h' | '24h';
  filled?: boolean;
  error?: string;
}) {
  const fromA = getAirport(v.from);
  const toA = getAirport(v.to);
  const depTz = tzAbbr(fromA?.tz, v.date);
  const arrTz = tzAbbr(toA?.tz, v.date);
  const t = timing(v);
  const effective = v.arrDayOffset ?? t?.arrDayOffset ?? 0;
  const bothTimes = !!v.depTime && !!v.arrTime;

  const [picker, setPicker] = useState<{ role: TimeRole; chainedFrom?: string } | null>(null);
  // Keeps the sheet's content while it animates closed.
  const last = useRef<{ role: TimeRole; chainedFrom?: string }>({ role: 'dep' });
  if (picker) last.current = picker;
  const shown = picker ?? last.current;

  // While moving straight on to arrival, the new departure is held here and saved together
  // with the arrival (or when the sheet closes), so the form changes only as the sheet closes.
  // That keeps the unsaved-changes guard's Back handling in step with the sheet's.
  const depTime = shown.chainedFrom ?? v.depTime;
  const estimate = estimateArrival({ date: v.date, depTime, from: v.from, to: v.to });

  const cycle = () => {
    const i = OFFSETS.indexOf(effective);
    onChange({ arrDayOffset: OFFSETS[(i + 1) % OFFSETS.length] });
  };

  const setTime = (role: TimeRole, time: string) => {
    if (role === 'dep') {
      // Offer the arrival straight away while it is still empty.
      if (!isValidTime(v.arrTime)) {
        setPicker({ role: 'arr', chainedFrom: time });
        return;
      }
      onChange({ depTime: time });
    } else {
      onChange(picker?.chainedFrom ? { depTime: picker.chainedFrom, arrTime: time } : { arrTime: time });
    }
    setPicker(null);
  };

  const clear = (role: TimeRole) => {
    onChange(role === 'dep' ? { depTime: '' } : { arrTime: '' });
    setPicker(null);
  };

  /** Cancel / Later / Back: keeps a departure set on the way to arrival. */
  const close = () => {
    if (picker?.chainedFrom) onChange({ depTime: picker.chainedFrom });
    setPicker(null);
  };

  const place = (role: TimeRole) => {
    const a = role === 'dep' ? fromA : toA;
    return a ? `${a.iata || a.ident} · ${airportCity(a)}` : undefined;
  };

  const timeButton = (role: TimeRole) => {
    const value = role === 'dep' ? v.depTime : v.arrTime;
    const tz = role === 'dep' ? depTz : arrTz;
    const label = role === 'dep' ? 'Departs' : 'Arrives';
    const has = isValidTime(value);
    const dayNote = has && role === 'arr' && bothTimes && effective !== 0 ? `, ${offsetLabel(effective)}` : '';
    return (
      <button
        type="button"
        id={role === 'dep' ? 'entry-dep' : 'entry-arr'}
        className={`time-btn time-btn--${role}${has ? '' : ' is-empty'}${error ? ' has-error' : ''}`}
        onClick={() => setPicker({ role })}
        aria-haspopup="dialog"
        aria-invalid={!!error}
        aria-label={`${label}${tz ? ` (${tz})` : ''}: ${has ? formatTime(value, clock) : 'not set'}${dayNote}. ${has ? 'Change' : 'Set'} time`}
      >
        <span className="time-btn__label">
          <Icon name={role === 'dep' ? 'takeoff' : 'landing'} size={14} />
          {label}
          {tz && <span className="time-btn__tz">{tz}</span>}
          {filled && has && <Icon name="sparkle" size={12} className="sparkle-icon" />}
        </span>
        <span className="time-btn__value tabular">
          {has ? (
            <>
              <TimeValue t={value} clock={clock} />
              {dayNote && <sup className="time-btn__day">{effective > 0 ? `+${effective}` : `${effective}`}</sup>}
            </>
          ) : (
            <span className="time-btn__add">Add time</span>
          )}
        </span>
      </button>
    );
  };

  return (
    <section className={`entry-card times-card${filled ? ' is-filled' : ''}`} aria-label="Times">
      <div className="times-card__grid">
        {timeButton('dep')}
        <span className="times-card__arrow" aria-hidden="true">
          <Icon name="chevron" size={18} />
        </span>
        {timeButton('arr')}
      </div>
      {/* Nothing to summarise until a time is set: keep the empty card compact. */}
      {(v.depTime || v.arrTime) && (
        <div className="times-card__foot">
          <span className="times-card__duration">
            <Icon name="clock" size={16} />
            {t ? (
              <>
                <span className="subtle">Duration</span> <strong className="tabular">{formatDuration(t.durationMin)}</strong>
              </>
            ) : (
              <span className="subtle">{bothTimes ? 'Check the times' : 'Local times at each airport'}</span>
            )}
          </span>
          {bothTimes && (
            <button
              type="button"
              className={`chip chip--sm day-chip${effective !== 0 ? ' is-offset' : ''}`}
              onClick={cycle}
              aria-label={`Arrival day: ${offsetLabel(effective)}${v.arrDayOffset === undefined ? ' (automatic)' : ''}. Tap to change`}
            >
              {offsetLabel(effective)}
              {v.arrDayOffset === undefined && <span className="day-chip__auto">auto</span>}
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="field__error times-card__error" role="alert">
          {error}
        </p>
      )}

      <TimePickerSheet
        open={!!picker}
        role={shown.role}
        value={shown.role === 'dep' ? v.depTime : v.arrTime}
        clock={clock}
        fallback={fallbackTime(shown.role, { ...v, depTime }, estimate?.time)}
        place={place(shown.role)}
        tz={shown.role === 'dep' ? depTz : arrTz}
        suggestion={shown.role === 'arr' ? estimate : undefined}
        chainedFrom={shown.chainedFrom}
        onSet={(time) => setTime(shown.role, time)}
        onClear={() => clear(shown.role)}
        onClose={close}
      />
    </section>
  );
}
