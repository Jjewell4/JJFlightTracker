import { Icon } from '@/components/Icon';
import { getAirport } from '@/data/reference';
import { formatDuration } from '@/lib/time';
import { timing, type FormValues } from './form-model';
import { tzAbbr } from './format';

const OFFSETS = [0, 1, 2, -1];
const offsetLabel = (n: number) => (n === 0 ? 'Same day' : n === 1 ? '+1 day' : n === -1 ? '−1 day' : `+${n} days`);

export function TimesCard({
  v,
  onChange,
  filled,
  error,
}: {
  v: FormValues;
  onChange: (patch: Pick<Partial<FormValues>, 'depTime' | 'arrTime' | 'arrDayOffset'>) => void;
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

  const cycle = () => {
    const i = OFFSETS.indexOf(effective);
    onChange({ arrDayOffset: OFFSETS[(i + 1) % OFFSETS.length] });
  };

  return (
    <section className={`entry-card times-card${filled ? ' is-filled' : ''}`} aria-label="Times">
      <div className="times-card__grid">
        <div className="time-field">
          <label className="time-field__label" htmlFor="entry-dep">
            Departs
            {depTz && <span className="time-field__tz">{depTz}</span>}
            {filled && <Icon name="sparkle" size={12} className="sparkle-icon" />}
          </label>
          <input
            id="entry-dep"
            className="time-field__input tabular"
            type="time"
            value={v.depTime}
            onChange={(e) => onChange({ depTime: e.target.value })}
            aria-invalid={!!error}
          />
        </div>
        <div className="times-card__arrow" aria-hidden="true">
          <Icon name="chevron" size={18} />
        </div>
        <div className="time-field">
          <label className="time-field__label" htmlFor="entry-arr">
            Arrives
            {arrTz && <span className="time-field__tz">{arrTz}</span>}
          </label>
          <div className="time-field__row">
            <input
              id="entry-arr"
              className="time-field__input tabular"
              type="time"
              value={v.arrTime}
              onChange={(e) => onChange({ arrTime: e.target.value })}
              aria-invalid={!!error}
            />
          </div>
        </div>
      </div>
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
      {error && (
        <p className="field__error times-card__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
