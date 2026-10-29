import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from 'react';
import { Link, useInRouterContext, useNavigate, type NavigateFunction } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { airportCode, parseFlightNumber } from '@/lib/flight-utils';
import { todayLocal } from '@/lib/time';
import { tripDates, tripTitle } from '@/lib/trips';
import type { YearScope } from '@/lib/stats';
import type { Flight } from '@/lib/types';
import { useTapOutside } from './hooks';
import { Section } from './parts';
import { fmtInt, fmtPct, plural } from './format';
import { buildTravelCalendar, monthStarts, pickItem, tripDays, yearLabel, yearSummary, type CalendarItem, type CalendarYear } from './travel-calendar';
import './TravelCalendar.css';

/** Strips shown before "Show earlier years". */
const VISIBLE_YEARS = 10;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Pointer slop around marks, in px (ticks are 2px wide). */
const TOUCH_SLOP = 14;
const MOUSE_SLOP = 6;

interface Active {
  year: number;
  index: number;
  via: 'pointer' | 'focus';
}

type Vars = CSSProperties & Record<`--${string}`, string | number>;

const fmtDay = (date: string, opts: Intl.DateTimeFormatOptions) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
const prettyFn = (fn: string | undefined) => {
  const p = parseFlightNumber(fn);
  return p ? `${p.prefix} ${p.number}` : (fn ?? '');
};
const route = (f: Flight) => `${airportCode(f.from)} → ${airportCode(f.to)}`;
const itemCenter = (it: CalendarItem, days: number) => (it.start + it.end + 1) / 2 / days;

function itemLabel(it: CalendarItem): string {
  if (it.kind === 'trip') {
    const t = it.span.trip;
    const days = tripDays(t);
    return `${tripTitle(t)}, ${tripDates(t)}, ${days} ${plural(days, 'day')} away, ${t.flights.length} ${plural(t.flights.length, 'flight')}`;
  }
  const fs = it.day.flights;
  return `${fmtDay(it.day.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}: ${fs.length} ${plural(fs.length, 'flight')}, ${fs.map((f) => `${airportCode(f.from)} to ${airportCode(f.to)}`).join(', ')}`;
}

/** Where Enter / a mouse click on a mark goes (owner only). */
function itemHref(it: CalendarItem): string | undefined {
  if (it.kind === 'trip') return `/trips/${encodeURIComponent(it.span.trip.id)}`;
  return it.day.flights.length === 1 ? `/flights/${it.day.flights[0].id}` : undefined;
}

/**
 * "Time away": one strip per year (newest first) with trips as soft spans and flight days as
 * amber ticks — taller when you flew more than once that day. Built for sparse data: the
 * whole year fits the width, so a phone shows a decade at a glance. Tap, hover or focus a
 * mark for details; the owner's view links to the trip or flight.
 */
export function TravelCalendar({ flights, scope, readOnly = false }: { flights: Flight[]; scope: YearScope; readOnly?: boolean }) {
  const model = useMemo(() => buildTravelCalendar(flights, scope, { today: todayLocal() }), [flights, scope]);
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState<Active | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const clear = useCallback(() => setActive(null), []);
  useTapOutside(wrapRef, active !== null, clear);
  // A new scope or new flights renumber the marks.
  useEffect(clear, [model, clear]);
  // Public journals render outside the app's router (and never link anywhere).
  const canLink = useInRouterContext() && !readOnly;
  const navRef = useRef<NavigateFunction | null>(null);
  const navigate = (href: string) => navRef.current?.(href);
  const hintId = useId();

  if (!model.years.length) return null;
  const single = scope !== 'all';
  const shown = single || expanded ? model.years : model.years.slice(0, VISIBLE_YEARS);
  const hidden = model.years.length - shown.length;

  const focusItem = (year: number, index: number) => {
    wrapRef.current?.querySelector<HTMLElement>(`[data-year="${year}"] [data-i="${index}"]`)?.focus();
  };

  const onItemKey = (e: KeyboardEvent, y: CalendarYear, i: number) => {
    const last = y.items.length - 1;
    const row = shown.indexOf(y);
    const step = (d: number) => {
      // Up/Down: the mark in the neighbouring year closest to this one's date.
      const next = shown[row + d];
      if (!next?.items.length) return;
      const c = itemCenter(y.items[i], y.days);
      let best = 0;
      next.items.forEach((it, j) => {
        if (Math.abs(itemCenter(it, next.days) - c) < Math.abs(itemCenter(next.items[best], next.days) - c)) best = j;
      });
      focusItem(next.year, best);
    };
    const keys: Record<string, () => void> = {
      ArrowRight: () => focusItem(y.year, Math.min(last, i + 1)),
      ArrowLeft: () => focusItem(y.year, Math.max(0, i - 1)),
      Home: () => focusItem(y.year, 0),
      End: () => focusItem(y.year, last),
      ArrowUp: () => step(-1),
      ArrowDown: () => step(1),
      Escape: clear,
      Enter: () => {
        const href = canLink ? itemHref(y.items[i]) : undefined;
        if (href) navigate(href);
      },
    };
    if (keys[e.key]) {
      e.preventDefault();
      keys[e.key]();
    }
  };

  const onBlur = (e: FocusEvent) => {
    if (active?.via === 'focus' && !wrapRef.current?.contains(e.relatedTarget as Node | null)) clear();
  };

  const avg = model.years.length ? Math.round(model.daysAway / model.years.length) : 0;
  const y0 = model.years[0];
  const longest = model.longest;

  return (
    <Section id="away" title="Time away">
      <article className={`card stats-card tcal${single ? ' tcal--single' : ''}`}>
        {canLink && <NavigatorRef navRef={navRef} />}
        <div className="tcal-figures">
          <div className="tcal-figure">
            <p className="tcal-figure__label">{single ? `Away in ${y0.year}` : 'Away from home'}</p>
            <p className="tcal-figure__value">
              {fmtInt(model.daysAway)}
              <span className="tcal-figure__unit"> {plural(model.daysAway, 'day')}</span>
            </p>
            <p className="tcal-figure__sub">
              {single
                ? `${fmtPct(model.daysAway / (y0.today !== undefined ? y0.today + 1 : y0.days))} of the year${y0.today !== undefined ? ' so far' : ''} · ${model.trips} ${plural(model.trips, 'trip')}`
                : `${model.trips} ${plural(model.trips, 'trip')}${model.years.length > 1 ? ` · ≈ ${avg} ${plural(avg, 'day')} a year` : ''}`}
            </p>
          </div>
          {longest && (
            <div className="tcal-figure">
              <p className="tcal-figure__label">Longest trip</p>
              <p className="tcal-figure__value">
                {longest.days}
                <span className="tcal-figure__unit"> {plural(longest.days, 'day')}</span>
              </p>
              <p className="tcal-figure__sub">
                {tripTitle(longest.trip)} · {fmtDay(longest.trip.start, { month: 'short', year: 'numeric' })}
              </p>
            </div>
          )}
        </div>

        <ul className="tcal-legend" aria-hidden="true">
          <li>
            <span className="tcal-key tcal-key--away" />
            Away on a trip
          </li>
          <li>
            <span className="tcal-key tcal-key--tick" />
            Flight day
          </li>
          <li>
            <span className="tcal-key tcal-key--tick tcal-key--tall" />
            2+ flights
          </li>
        </ul>

        <div ref={wrapRef} className="tcal-years" onBlur={onBlur} onPointerLeave={(e) => e.pointerType === 'mouse' && active?.via === 'pointer' && clear()}>
          <p id={hintId} className="visually-hidden">
            Arrow keys move between trips and flights; up and down change the year.{canLink ? ' Enter opens it.' : ''}
          </p>
          {!single && <MonthAxis year={y0.year} />}
          {shown.map((y) => (
            <YearRow
              key={y.year}
              y={y}
              single={single}
              readOnly={!canLink}
              hintId={hintId}
              activeIndex={active?.year === y.year ? active.index : null}
              onActivate={(index, via) => setActive(index === null ? null : { year: y.year, index, via })}
              onOpen={(href) => navigate(href)}
              onItemKey={(e, i) => onItemKey(e, y, i)}
            />
          ))}
          {single && <MonthAxis year={y0.year} below />}
        </div>

        {hidden > 0 && (
          <button type="button" className="tcal-more" onClick={() => setExpanded(true)}>
            Show {hidden} earlier {plural(hidden, 'year')}
            <Icon name="chevron" size={16} className="tcal-more__chev" />
          </button>
        )}
        {model.undated > 0 && (
          <p className="stats-card__foot">
            {fmtInt(model.undated)} {plural(model.undated, 'flight')} without an exact date {model.undated === 1 ? 'isn’t' : 'aren’t'} on the calendar.
          </p>
        )}
      </article>
    </Section>
  );
}

/** Hands the router's navigate() up (only mounted inside a router). */
function NavigatorRef({ navRef }: { navRef: RefObject<NavigateFunction | null> }) {
  const navigate = useNavigate();
  useLayoutEffect(() => {
    navRef.current = navigate;
  }, [navRef, navigate]);
  return null;
}

function MonthAxis({ year, below = false }: { year: number; below?: boolean }) {
  const starts = monthStarts(year);
  const days = starts[11] + 31;
  return (
    <div className={`tcal-axis${below ? ' tcal-axis--below' : ''}`} aria-hidden="true" style={{ gridTemplateColumns: starts.map((s, m) => `${(m < 11 ? starts[m + 1] : days) - s}fr`).join(' ') }}>
      {MONTHS.map((m) => (
        <span key={m}>{m}</span>
      ))}
    </div>
  );
}

function YearRow({
  y,
  single,
  readOnly,
  hintId,
  activeIndex,
  onActivate,
  onOpen,
  onItemKey,
}: {
  y: CalendarYear;
  single: boolean;
  readOnly: boolean;
  hintId: string;
  activeIndex: number | null;
  onActivate: (index: number | null, via: Active['via']) => void;
  onOpen: (href: string) => void;
  onItemKey: (e: KeyboardEvent, index: number) => void;
}) {
  const pointerType = useRef('mouse');
  const frac = (day: number) => day / y.days;
  const activeItem = activeIndex !== null ? y.items[activeIndex] : undefined;
  const activeSpan = activeItem?.kind === 'trip' ? activeItem.span.key : undefined;
  const activeDay = activeItem?.kind === 'day' ? activeItem.day.day : undefined;

  const pick = (e: PointerEvent | MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width) return -1;
    const x = Math.max(0, Math.min(r.width, e.clientX - r.left));
    const slop = pointerType.current === 'mouse' ? MOUSE_SLOP : TOUCH_SLOP;
    return pickItem(y.items, (x / r.width) * y.days, slop / (r.width / y.days));
  };

  const onClick = (e: MouseEvent) => {
    const i = pick(e);
    if (i < 0) return onActivate(null, 'pointer');
    if (pointerType.current === 'mouse') {
      // Mouse: hovering already shows the details, so a click opens the trip or flight.
      const href = readOnly ? undefined : itemHref(y.items[i]);
      if (href) return onOpen(href);
      return onActivate(i, 'pointer');
    }
    // Touch: tap shows the details; tapping the same mark again hides them.
    onActivate(activeIndex === i ? null : i, 'pointer');
  };

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const i = pick(e);
    if (i >= 0 && i !== activeIndex) onActivate(i, 'pointer');
  };

  const tabStop = activeIndex ?? 0;
  const multi = (n: number) => (n >= 3 ? ' tcal-tick--3' : n === 2 ? ' tcal-tick--2' : '');

  return (
    <div className="tcal-row" role="group" aria-label={yearLabel(y)} aria-describedby={hintId} data-year={y.year}>
      {!single && (
        <div className="tcal-row__head" aria-hidden="true">
          <span className="tcal-row__year">{y.year}</span>
          <span className="tcal-row__sum">{yearSummary(y)}</span>
        </div>
      )}
      <div className="tcal-plot">
        <div
          className={`tcal-strip${y.items.length ? '' : ' is-empty'}`}
          onPointerDown={(e) => (pointerType.current = e.pointerType)}
          onPointerMove={onPointerMove}
          onClick={onClick}
        >
          <div className="tcal-marks" aria-hidden="true">
            {monthStarts(y.year)
              .slice(1)
              .map((d) => (
                <span key={d} className="tcal-gap" style={{ '--s': frac(d) } as Vars} />
              ))}
            {y.today !== undefined && <span className="tcal-future" style={{ '--s': frac(y.today + 1) } as Vars} />}
            {y.spans.map((s) => (
              <span
                key={s.key}
                className={`tcal-span${s.fromPrev ? ' is-from-prev' : ''}${s.intoNext ? ' is-into-next' : ''}${s.key === activeSpan ? ' is-active' : ''}`}
                style={{ '--s': frac(s.start), '--w': frac(s.end - s.start + 1) } as Vars}
              />
            ))}
            {y.flightDays.map((d) => (
              <span
                key={d.day}
                className={`tcal-tick${multi(d.flights.length)}${d.day === activeDay ? ' is-active' : ''}`}
                style={{ '--c': frac(d.day + 0.5) } as Vars}
              />
            ))}
            {y.today !== undefined && <span className="tcal-today" style={{ '--c': frac(y.today + 1) } as Vars} />}
          </div>
          <div className="tcal-hits">
            {y.items.map((it, i) => (
              <button
                key={it.kind === 'trip' ? it.span.key : `d${it.day.day}`}
                type="button"
                data-i={i}
                className={`tcal-hit tcal-hit--${it.kind}`}
                style={{ '--s': frac(it.start), '--w': frac(it.end - it.start + 1) } as Vars}
                tabIndex={i === tabStop ? 0 : -1}
                aria-label={itemLabel(it)}
                onFocus={() => onActivate(i, 'focus')}
                onKeyDown={(e) => onItemKey(e, i)}
              />
            ))}
          </div>
        </div>
        {activeItem && <Popover y={y} item={activeItem} readOnly={readOnly} />}
      </div>
    </div>
  );
}

function Popover({ y, item, readOnly }: { y: CalendarYear; item: CalendarItem; readOnly: boolean }) {
  const style = { '--x': itemCenter(item, y.days) } as Vars;
  if (item.kind === 'trip') {
    const t = item.span.trip;
    const days = tripDays(t);
    return (
      <>
        <span className="tcal-caret" style={style} aria-hidden="true" />
        <div className="tcal-pop" style={style}>
          <p className="tcal-pop__title">{tripTitle(t)}</p>
          <p className="tcal-pop__meta">
            {tripDates(t)} · {days} {plural(days, 'day')} · {t.flights.length} {plural(t.flights.length, 'flight')}
          </p>
          <p className="tcal-pop__route">{[t.flights[0].from, ...t.flights.map((f) => f.to)].map(airportCode).join(' → ')}</p>
          {!readOnly && (
            <Link className="tcal-pop__link" to={`/trips/${encodeURIComponent(t.id)}`}>
              View trip
              <Icon name="chevron" size={14} strokeWidth={2.25} />
            </Link>
          )}
        </div>
      </>
    );
  }
  const fs = item.day.flights;
  const shown = fs.slice(0, 4);
  return (
    <>
      <span className="tcal-caret" style={style} aria-hidden="true" />
      <div className="tcal-pop" style={style}>
        <p className="tcal-pop__title">{fmtDay(item.day.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</p>
        <ul className="tcal-pop__flights">
          {shown.map((f) => {
            const body = (
              <>
                <span className="tcal-pop__fr">{route(f)}</span>
                {f.flightNumber && <span className="tcal-pop__fn">{prettyFn(f.flightNumber)}</span>}
                {!readOnly && <Icon name="chevron" size={14} className="tcal-pop__chev" />}
              </>
            );
            return (
              <li key={f.id}>
                {readOnly ? (
                  <span className="tcal-pop__flight">{body}</span>
                ) : (
                  <Link className="tcal-pop__flight tcal-pop__flight--link" to={`/flights/${f.id}`}>
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
        {fs.length > shown.length && <p className="tcal-pop__meta">+{fs.length - shown.length} more</p>}
      </div>
    </>
  );
}
