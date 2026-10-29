import { Icon } from '@/components/Icon';
import { addDays, todayLocal } from '@/lib/time';
import type { DatePrecision } from '@/lib/types';

function displayDate(date: string, precision: DatePrecision): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (precision === 'year') return String(y);
  if (precision === 'month') return dt.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function relativeLabel(date: string): string | undefined {
  const today = todayLocal();
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  if (date === addDays(today, 1)) return 'Tomorrow';
  return undefined;
}

/** First powered flight — the earliest year the picker offers by default. */
const FIRST_YEAR = 1903;

/** Year choices, newest first: next year down to 1903, or further down to the flight's own year. */
export function yearOptions(thisYear: number, date: string): number[] {
  const own = Number(date.slice(0, 4));
  const first = Number.isInteger(own) && own > 0 ? Math.min(FIRST_YEAR, own) : FIRST_YEAR;
  const last = Math.max(thisYear + 1, Number.isInteger(own) ? own : 0);
  return Array.from({ length: last - first + 1 }, (_, i) => last - i);
}

function openPicker(el: HTMLInputElement | HTMLSelectElement) {
  try {
    (el as HTMLInputElement).showPicker?.();
  } catch {
    /* not supported or not allowed – native tap behaviour still works */
  }
}

/**
 * Big tappable date with a transparent native input on top (so phones get their native
 * wheel/calendar), plus Today/Yesterday quick chips. Honors month/year precision.
 */
export function DateField({
  id,
  date,
  precision,
  onChange,
  error,
  filled,
}: {
  id: string;
  date: string;
  precision: DatePrecision;
  onChange: (date: string) => void;
  error?: string;
  /** Just filled in for the user (quick entry / screenshot): highlight it. */
  filled?: boolean;
}) {
  const today = todayLocal();
  const yesterday = addDays(today, -1);
  const text = displayDate(date, precision);
  const rel = precision === 'day' ? relativeLabel(date) : undefined;
  const thisYear = Number(today.slice(0, 4));
  const years = yearOptions(thisYear, date);

  return (
    <div className="entry-field">
      <div className="entry-field__label-row">
        <label className="field__label" htmlFor={id}>
          Date {filled && <Icon name="sparkle" size={12} className="sparkle-icon" />}
        </label>
        {precision === 'day' && (
          <div className="entry-quick" role="group" aria-label="Quick dates">
            <button type="button" className="chip chip--sm" aria-pressed={date === today} onClick={() => onChange(today)}>
              Today
            </button>
            <button type="button" className="chip chip--sm" aria-pressed={date === yesterday} onClick={() => onChange(yesterday)}>
              Yesterday
            </button>
          </div>
        )}
      </div>
      <div className={`date-field${error ? ' has-error' : ''}${filled ? ' is-filled' : ''}`}>
        <span className="date-field__icon" aria-hidden="true">
          <Icon name="calendar" size={20} />
        </span>
        <span className="date-field__text" aria-hidden="true">
          {text || <span className="date-field__placeholder">Choose a date</span>}
        </span>
        {rel && rel !== 'Today' && rel !== 'Yesterday' && (
          <span className="badge" aria-hidden="true">
            {rel}
          </span>
        )}
        <Icon name="chevron" size={18} className="date-field__chev" />
        {precision === 'day' && (
          <input
            id={id}
            className="date-field__native"
            type="date"
            value={date}
            max={addDays(today, 366)}
            onChange={(e) => onChange(e.target.value)}
            onClick={(e) => openPicker(e.currentTarget)}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-err` : undefined}
          />
        )}
        {precision === 'month' && (
          <input
            id={id}
            className="date-field__native"
            type="month"
            value={date.slice(0, 7)}
            onChange={(e) => e.target.value && onChange(`${e.target.value}-01`)}
            onClick={(e) => openPicker(e.currentTarget)}
            aria-invalid={!!error}
          />
        )}
        {precision === 'year' && (
          <select id={id} className="date-field__native" value={date.slice(0, 4)} onChange={(e) => onChange(`${e.target.value}-01-01`)} aria-invalid={!!error}>
            {!date && <option value="">Choose a year</option>}
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        )}
      </div>
      {error && (
        <p id={`${id}-err`} className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
