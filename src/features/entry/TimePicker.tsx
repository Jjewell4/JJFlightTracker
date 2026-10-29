import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { formatDuration, formatTime, isValidTime } from '@/lib/time';
import { needsMeridiem, parseTimeInput, splitTime, toTime, type ArrivalEstimate, type Meridiem } from './time-input';
import './TimePicker.css';

/** Row height of a wheel option, in px (keep in sync with --wheel-item in TimePicker.css). */
const ITEM = 40;

const reduceMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const indexIn = (options: WheelOption[], value: number) =>
  Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

export interface WheelOption {
  value: number;
  label: string;
}

/**
 * One scroll-snap wheel column (listbox semantics). Touch scrolls natively with snapping; the
 * mouse wheel and arrow keys step one option at a time; tapping an option centres it. Reports
 * the centred value live while scrolling so the time display follows the finger.
 */
export function Wheel({
  label,
  options,
  value,
  onChange,
  onEnter,
  page = 5,
  className = '',
}: {
  label: string;
  options: WheelOption[];
  value: number;
  onChange: (value: number) => void;
  /** Enter while the wheel has focus (e.g. confirm the picker). */
  onEnter?: () => void;
  /** Options moved by PageUp/PageDown. */
  page?: number;
  className?: string;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const index = indexIn(options, value);
  /** Last value reported by (or pushed into) this wheel, to tell our own changes from outside ones. */
  const emitted = useRef(value);
  /** Index an animated programmatic scroll is heading to; scroll positions on the way are ignored. */
  const target = useRef<number | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frame = useRef(0);
  const live = useRef({ options, onChange });
  live.current = { options, onChange };

  const indexOf = (v: number) => indexIn(live.current.options, v);

  const commit = (i: number) => {
    const v = live.current.options[i]?.value;
    if (v === undefined || v === emitted.current) return;
    emitted.current = v;
    live.current.onChange(v);
  };

  const scrollToIndex = (i: number, smooth: boolean) => {
    const el = ref.current;
    if (!el) return;
    const top = i * ITEM;
    if (Math.abs(el.scrollTop - top) < 1) {
      target.current = null;
      return;
    }
    target.current = i;
    if (smooth && !reduceMotion() && typeof el.scrollTo === 'function') el.scrollTo({ top, behavior: 'smooth' });
    else {
      el.scrollTop = top;
      target.current = null;
    }
  };

  const select = (i: number) => {
    const c = clamp(i, 0, live.current.options.length - 1);
    scrollToIndex(c, true);
    commit(c);
  };

  // Start centred on the value, without animating.
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = index * ITEM;
  }, []);

  // A value set from outside (typed time, suggestion chip): bring it to the centre.
  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    scrollToIndex(index, true);
  }, [value, index]);

  // Mouse wheel / trackpad: one option per notch instead of a free-spinning fling.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // pinch-zoom
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * ITEM * 5 : e.deltaY;
      let steps = 0;
      if (Math.abs(dy) >= ITEM) steps = Math.sign(dy);
      else {
        acc += dy;
        if (Math.abs(acc) >= ITEM) {
          steps = Math.sign(acc);
          acc = 0;
        }
      }
      if (steps) select(indexOf(emitted.current) + steps);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(
    () => () => {
      clearTimeout(settle.current);
      cancelAnimationFrame(frame.current);
    },
    [],
  );

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const max = live.current.options.length - 1;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (target.current === null) commit(clamp(Math.round(el.scrollTop / ITEM), 0, max));
    });
    clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      const i = clamp(Math.round(el.scrollTop / ITEM), 0, max);
      target.current = null;
      commit(i);
      // Browsers without scroll snapping: finish on a whole option.
      if (Math.abs(el.scrollTop - i * ITEM) > 1) el.scrollTo?.({ top: i * ITEM, behavior: reduceMotion() ? 'auto' : 'smooth' });
    }, 140);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const cur = indexOf(emitted.current);
    const last = live.current.options.length - 1;
    let next: number;
    switch (e.key) {
      case 'ArrowUp':
        next = cur - 1;
        break;
      case 'ArrowDown':
        next = cur + 1;
        break;
      case 'PageUp':
        next = cur - page;
        break;
      case 'PageDown':
        next = cur + page;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      case 'Enter':
        if (onEnter) {
          e.preventDefault();
          onEnter();
        }
        return;
      default:
        return;
    }
    e.preventDefault();
    select(next);
  };

  return (
    <div
      ref={ref}
      className={`wheel ${className}`}
      role="listbox"
      tabIndex={0}
      aria-label={label}
      aria-activedescendant={`${id}-${index}`}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      onPointerDown={() => (target.current = null)}
      onTouchStart={() => (target.current = null)}
    >
      {options.map((o, i) => (
        <div
          key={o.value}
          id={`${id}-${i}`}
          role="option"
          aria-selected={i === index}
          className={`wheel__opt${i === index ? ' is-selected' : ''}`}
          onClick={() => select(i)}
        >
          {o.label}
        </div>
      ))}
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const HOURS_24: WheelOption[] = Array.from({ length: 24 }, (_, h) => ({ value: h, label: pad(h) }));
// 12h hours keyed by h % 12 so 12 comes first, as on a clock.
const HOURS_12: WheelOption[] = Array.from({ length: 12 }, (_, h) => ({ value: h, label: String(h || 12) }));
const MINUTES: WheelOption[] = Array.from({ length: 60 }, (_, m) => ({ value: m, label: pad(m) }));
const MERIDIEMS: WheelOption[] = [
  { value: 0, label: 'AM' },
  { value: 1, label: 'PM' },
];

export type TimeRole = 'dep' | 'arr';

export interface TimePickerProps {
  open: boolean;
  role: TimeRole;
  /** Stored time ('' when unset). */
  value: string;
  clock: '12h' | '24h';
  /** Wheel starting point when nothing is set yet. */
  fallback: string;
  /** "SAN · San Diego" style context line. */
  place?: string;
  tz?: string;
  /** Estimated arrival (arrival step only). */
  suggestion?: ArrivalEstimate;
  /** The departure time that was just set, when the sheet moved straight on to arrival. */
  chainedFrom?: string;
  onSet: (time: string) => void;
  onClear: () => void;
  onClose: () => void;
}

/** Bottom sheet with scroll wheels (or a typed time) for a departure or arrival time. */
export function TimePickerSheet(props: TimePickerProps) {
  const { open, role, onClose } = props;
  const titleId = useId();
  return (
    <Sheet open={open} onClose={onClose} labelledBy={titleId} className="entry-sheet">
      <TimePickerBody key={role} titleId={titleId} {...props} />
    </Sheet>
  );
}

function TimePickerBody({
  titleId,
  role,
  value,
  clock,
  fallback,
  place,
  tz,
  suggestion,
  chainedFrom,
  onSet,
  onClear,
  onClose,
}: TimePickerProps & { titleId: string }) {
  const start = splitTime(isValidTime(value) ? value : fallback);
  const [h, setH] = useState(start.h);
  const [m, setM] = useState(start.m);
  const [mode, setMode] = useState<'wheel' | 'type'>('wheel');
  const [text, setText] = useState('');
  const [mer, setMer] = useState<Meridiem>(start.h >= 12 ? 'pm' : 'am');
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const twelve = clock === '12h';

  // Moved straight on from departure: the button that had focus is gone, so start here.
  useEffect(() => {
    if (chainedFrom) rootRef.current?.focus({ preventScroll: true });
  }, [chainedFrom]);

  const wheelTime = toTime(h, m);
  const typed = useMemo(() => parseTimeInput(text, twelve ? { meridiem: mer } : {}), [text, twelve, mer]);
  const current = mode === 'type' ? typed : wheelTime;
  const merApplies = twelve && needsMeridiem(text);
  // When the text decides am/pm itself ("735p", "1935"), the dimmed toggle mirrors it.
  const shownMer: Meridiem = typed && !merApplies ? (splitTime(typed).h >= 12 ? 'pm' : 'am') : mer;

  const noun = role === 'dep' ? 'departure' : 'arrival';
  const setLabel = `Set ${noun} time`;

  const apply = (t: string) => {
    const p = splitTime(t);
    setH(p.h);
    setM(p.m);
    setMer(p.h >= 12 ? 'pm' : 'am');
  };

  const switchMode = (next: 'wheel' | 'type') => {
    if (next === mode) return;
    if (next === 'type') {
      // Render the field now and focus it inside the tap, so phones open the keyboard.
      flushSync(() => {
        setText(formatTime(wheelTime, clock));
        setMer(h >= 12 ? 'pm' : 'am');
        setMode('type');
      });
      inputRef.current?.focus();
      inputRef.current?.select();
    } else {
      if (typed) apply(typed);
      setMode('wheel');
    }
  };

  const confirm = () => {
    if (current) onSet(current);
  };

  const pickSuggestion = () => {
    if (!suggestion) return;
    apply(suggestion.time);
    if (mode === 'type') setText(formatTime(suggestion.time, clock));
  };

  const display = formatTime(current ?? wheelTime, clock);
  const [clockPart, suffix] = twelve ? display.split(' ') : [display, ''];
  const suggested = suggestion && current === suggestion.time;

  return (
    <div ref={rootRef} className={`tp${chainedFrom ? ' tp--chained' : ''}`} tabIndex={-1}>
      {chainedFrom && (
        <p className="tp__chained" role="status">
          <Icon name="check" size={16} strokeWidth={2.25} />
          Departure set · <strong className="tabular">{formatTime(chainedFrom, clock)}</strong>
        </p>
      )}
      <div className="tp__head">
        <div className="tp__titles">
          <h2 id={titleId} className="tp__title">
            {role === 'dep' ? 'Departure time' : 'Arrival time'}
          </h2>
          <p className="tp__sub">
            <Icon name={role === 'dep' ? 'takeoff' : 'landing'} size={14} />
            <span className="tp__place">{place || 'Local time at the airport'}</span>
            {tz && <span className="tp__tz">{tz}</span>}
          </p>
        </div>
        {isValidTime(value) && (
          <button type="button" className="btn btn--ghost tp__clear" onClick={onClear}>
            Clear
          </button>
        )}
      </div>

      <div className="seg tp__modes" role="group" aria-label="Input method">
        <button type="button" aria-pressed={mode === 'wheel'} className="seg__opt" onClick={() => switchMode('wheel')}>
          <Icon name="clock" size={16} /> Scroll
        </button>
        <button type="button" aria-pressed={mode === 'type'} className="seg__opt" onClick={() => switchMode('type')}>
          <Icon name="keyboard" size={16} /> Type
        </button>
      </div>

      {mode === 'wheel' ? (
        <>
          <p className="tp__display tabular" aria-live="polite" aria-atomic="true">
            <span className="visually-hidden">{role === 'dep' ? 'Departs' : 'Arrives'} </span>
            {clockPart}
            {suffix && (
              <>
                {' '}
                <span className="tp__suffix">{suffix}</span>
              </>
            )}
          </p>
          {suggestion && <SuggestionChip suggestion={suggestion} clock={clock} active={!!suggested} onUse={pickSuggestion} />}
          <div className={`tp__wheels${twelve ? ' tp__wheels--12' : ''}`}>
            <span className="tp__band" aria-hidden="true" />
            <Wheel
              label="Hour"
              options={twelve ? HOURS_12 : HOURS_24}
              value={twelve ? h % 12 : h}
              onChange={(v) => setH((cur) => (twelve ? v + (cur >= 12 ? 12 : 0) : v))}
              onEnter={confirm}
              page={twelve ? 3 : 6}
            />
            <span className="tp__colon" aria-hidden="true">
              :
            </span>
            <Wheel label="Minute" options={MINUTES} value={m} onChange={setM} onEnter={confirm} page={10} />
            {twelve && (
              <Wheel
                label="AM or PM"
                className="wheel--mer"
                options={MERIDIEMS}
                value={h >= 12 ? 1 : 0}
                onChange={(v) => setH((cur) => (cur % 12) + v * 12)}
                onEnter={confirm}
              />
            )}
          </div>
        </>
      ) : (
        <div className="tp__type">
          <label className="visually-hidden" htmlFor={`${titleId}-input`}>
            {role === 'dep' ? 'Departure time' : 'Arrival time'}
          </label>
          <div className="tp__type-row">
            <input
              ref={inputRef}
              id={`${titleId}-input`}
              className="tp__input tabular"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  confirm();
                }
              }}
              placeholder={twelve ? '7:35' : '19:35'}
              inputMode="numeric"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              aria-invalid={!!text.trim() && !typed}
              aria-describedby={`${titleId}-hint`}
            />
            {twelve && (
              <div className={`seg tp__mer${merApplies ? '' : ' is-inactive'}`} role="group" aria-label="AM or PM">
                {(['am', 'pm'] as const).map((x) => (
                  <button
                    key={x}
                    type="button"
                    aria-pressed={shownMer === x}
                    aria-disabled={!merApplies}
                    className="seg__opt"
                    onClick={() => {
                      setMer(x);
                      inputRef.current?.focus();
                    }}
                  >
                    {x.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p id={`${titleId}-hint`} className={`tp__hint${typed ? ' is-ok' : text.trim() ? ' is-bad' : ''}`} aria-live="polite">
            {typed ? (
              <>
                <Icon name="check" size={14} strokeWidth={2.25} /> {formatTime(typed, clock)}
              </>
            ) : text.trim() ? (
              `Try ${twelve ? '7:35 pm, 735p' : '7:35, 0735'} or 19:35`
            ) : twelve ? (
              'Type 735 and pick AM/PM, or 7:35 pm, 1935'
            ) : (
              'Type 1935, 19:35 or 7:35 pm'
            )}
          </p>
          {suggestion && <SuggestionChip suggestion={suggestion} clock={clock} active={!!suggested} onUse={pickSuggestion} />}
        </div>
      )}

      <div className="tp__actions">
        <button type="button" className="btn btn--lg" onClick={onClose}>
          {chainedFrom ? 'Later' : 'Cancel'}
        </button>
        <button type="button" className="btn btn--primary btn--lg" onClick={confirm} disabled={!current}>
          {setLabel}
        </button>
      </div>
    </div>
  );
}

function SuggestionChip({ suggestion, clock, active, onUse }: { suggestion: ArrivalEstimate; clock: '12h' | '24h'; active: boolean; onUse: () => void }) {
  const day = suggestion.dayOffset > 0 ? ` +${suggestion.dayOffset}` : suggestion.dayOffset < 0 ? ` ${suggestion.dayOffset}` : '';
  const time = formatTime(suggestion.time, clock);
  return (
    <div className="tp__suggest">
      <button
        type="button"
        className={`chip tp__chip${active ? ' is-active' : ''}`}
        onClick={onUse}
        aria-pressed={active}
        aria-label={`Use estimated arrival ${time}${day ? `, ${day.trim()} day` : ''} (about ${formatDuration(suggestion.durationMin)} flight)`}
      >
        <Icon name="sparkle" size={14} />
        <span className="tabular">
          ≈ {time}
          {day && <sup className="tp__chip-day">{day.trim()}</sup>}
        </span>
        <span className="tp__chip-est">est. {formatDuration(suggestion.durationMin)}</span>
      </button>
    </div>
  );
}
