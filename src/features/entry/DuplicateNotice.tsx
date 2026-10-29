import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { airportCode } from '@/lib/flight-utils';
import type { Flight } from '@/lib/types';
import { duplicateDate, type DuplicateMatch } from './duplicates';
import { prettyFlightNumber } from './form-model';

/** Keeps short phrases ("Oct 29", "AS 1234", "SAN → JFK") on one line. */
const nb = (s: string) => s.replace(/ /g, '\u00a0');

/** "SAN → JFK" */
export const routeLabel = (f: Pick<Flight, 'from' | 'to'>) => nb(`${airportCode(f.from)} → ${airportCode(f.to)}`);

/** "You already logged SAN → JFK on Oct 29 (AS 1234)" — shared by the notice and the save confirmation. */
export function duplicateSentence(f: Flight): string {
  const fn = nb(prettyFlightNumber(f.flightNumber));
  const date = nb(duplicateDate(f));
  const on = (f.datePrecision ?? 'day') === 'day' ? 'on' : 'in';
  return `You already logged ${routeLabel(f)} ${on} ${date}${fn ? ` (${fn})` : ''}`;
}

/**
 * Inline note at the top of the form when it matches a flight already in the log. A likely
 * duplicate gets a calm amber card with "View it" and "Different flight" (which acknowledges
 * it, so Save won't ask again); a near match (±1 day) is a single quiet line.
 */
export function DuplicateNotice({
  matches,
  hint,
  onAcknowledge,
  onView,
}: {
  /** Unacknowledged matches, most certain first. */
  matches: DuplicateMatch[];
  /** Second line of the duplicate card (what saving would do). */
  hint: string;
  onAcknowledge: () => void;
  /** When set, "View it" is a button calling this (e.g. to confirm leaving unsaved edits) instead of a link. */
  onView?: (flight: Flight) => void;
}) {
  const first = matches[0];
  if (!first) return null;
  const f = first.flight;
  const view = (label: string) => {
    const body = (
      <>
        {label}
        <Icon name="chevron" size={14} strokeWidth={2.25} />
      </>
    );
    return onView ? (
      <button type="button" className="dup-note__link" onClick={() => onView(f)}>
        {body}
      </button>
    ) : (
      <Link to={`/flights/${f.id}`} className="dup-note__link">
        {body}
      </Link>
    );
  };

  if (first.kind === 'similar') {
    const fn = prettyFlightNumber(f.flightNumber);
    return (
      <div className="dup-note dup-note--soft" role="status">
        <Icon name="info" size={16} className="dup-note__icon" />
        <p className="dup-note__text">
          <span className="dup-note__lead">
            Similar flight {(f.datePrecision ?? 'day') === 'day' ? 'on' : 'in'} {nb(duplicateDate(f))}
          </span>
          <span className="dup-note__meta">
            {routeLabel(f)}
            {fn && ` · ${nb(fn)}`}
          </span>
        </p>
        {view('View')}
      </div>
    );
  }

  const more = matches.filter((m) => m.kind === 'duplicate').length - 1;
  return (
    <div className="dup-note dup-note--warn" role="status">
      <span className="dup-note__badge" aria-hidden="true">
        <Icon name="copy" size={18} />
      </span>
      <div className="dup-note__body">
        <p className="dup-note__title">
          {duplicateSentence(f)}
          {more > 0 && <span className="dup-note__meta"> and {more === 1 ? 'one more' : `${more} more`}</span>}
        </p>
        <p className="dup-note__hint">{hint}</p>
        <div className="dup-note__actions">
          {view('View it')}
          <button type="button" className="dup-note__ack" onClick={onAcknowledge}>
            It’s a different flight
          </button>
        </div>
      </div>
    </div>
  );
}
