import { Fragment } from 'react';
import { AirlineLogo } from '@/components/AirlineLogo';
import { Icon } from '@/components/Icon';
import { getAircraftType, getAirline, getAirport } from '@/data/reference';
import { airportCode } from '@/lib/flight-utils';
import { formatTime } from '@/lib/time';
import type { FlightLookupResult, LookupOutcome } from '@/services/lookup';
import { prettyFlightNumber, type FillKey } from './form-model';
import { airportCity } from './format';

const FIELD_NAMES: Record<FillKey, string> = {
  airline: 'airline',
  from: 'origin',
  to: 'destination',
  times: 'times',
  aircraft: 'aircraft',
  registration: 'registration',
};

function describeFilled(keys: FillKey[]): string {
  const names = keys.filter((k) => k !== 'to' || !keys.includes('from')).map((k) => (k === 'from' && keys.includes('to') ? 'route' : FIELD_NAMES[k]));
  if (names.length <= 2) return names.join(' & ');
  if (names.length > 3) return `${names.length} details`;
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

export function LookupCard({
  outcome,
  active,
  filledKeys,
  diff,
  clock,
  onChoose,
  onApply,
  onUndo,
  onDismiss,
}: {
  outcome: LookupOutcome;
  active: FlightLookupResult;
  /** Groups currently auto-filled from `active`. */
  filledKeys: FillKey[];
  /** Groups that applying `active` would change. */
  diff: FillKey[];
  clock: '12h' | '24h';
  onChoose: (key: string) => void;
  onApply: () => void;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const r = active;
  const airline = getAirline(r.airline?.icao) ?? getAirline(r.airline?.iata);
  const airlineName = airline?.name ?? r.airline?.name;
  const from = getAirport(r.from);
  const to = getAirport(r.to);
  const aircraft = r.aircraftName ?? getAircraftType(r.aircraftType)?.name;
  const times = r.depTime && r.arrTime ? `${formatTime(r.depTime, clock)}–${formatTime(r.arrTime, clock)}${r.arrDayOffset ? ` +${r.arrDayOffset}` : ''}` : undefined;
  const details = [airlineName ? `${airlineName} ${prettyFlightNumber(r.flightNumber)}` : prettyFlightNumber(r.flightNumber), aircraft, times, r.registration].filter(Boolean);
  const others = outcome.results.filter((x) => x.key !== r.key);

  return (
    <section className={`lookup-card${r.dateSpecific ? ' is-exact' : ''}`} aria-live="polite" aria-label="Flight lookup suggestion">
      <div className="lookup-card__head">
        <span className="lookup-card__kicker">
          <Icon name="sparkle" size={14} />
          {r.dateSpecific ? 'Found' : 'Suggested'}
          <span className="lookup-card__source">· {r.sourceLabel}</span>
        </span>
        {r.status && <span className="badge">{r.status}</span>}
        <button type="button" className="lookup-card__dismiss" onClick={onDismiss} aria-label="Dismiss suggestion">
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="lookup-card__body">
        <AirlineLogo iata={airline?.iata || r.airline?.iata} icao={r.airline?.icao} name={airlineName} size={40} />
        <div className="lookup-card__main">
          <div className="lookup-card__route">
            <span className="code">{r.from ? airportCode(r.from) : '???'}</span>
            <span className="lookup-card__arrow" aria-label="to">
              <Icon name="plane" size={14} />
            </span>
            <span className="code">{r.to ? airportCode(r.to) : '???'}</span>
          </div>
          <div className="lookup-card__sub">
            {[from ? airportCity(from) : r.from, to ? airportCity(to) : r.to].filter(Boolean).join(' → ')}
          </div>
          {details.length > 0 && (
            <div className="lookup-card__details">
              {details.map((d, i) => (
                <Fragment key={i}>
                  {i > 0 && ' · '}
                  <span className="lookup-card__detail">{d}</span>
                </Fragment>
              ))}
            </div>
          )}
        </div>
      </div>

      {others.length > 0 && (
        <div className="lookup-card__alts" role="group" aria-label="Other matches">
          <span className="lookup-card__alts-label">{r.dateSpecific && others.every((o) => o.dateSpecific) ? 'Which leg?' : 'Or'}</span>
          {others.slice(0, 3).map((o) => (
            <button key={o.key} type="button" className="chip chip--sm" onClick={() => onChoose(o.key)}>
              <span className="mono">
                {o.from ? airportCode(o.from) : '?'} → {o.to ? airportCode(o.to) : '?'}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="lookup-card__foot">
        {filledKeys.length > 0 ? (
          <>
            <span className="lookup-card__done">
              <Icon name="check" size={16} strokeWidth={2.25} />
              Filled {describeFilled(filledKeys)}
            </span>
            <button type="button" className="btn btn--ghost lookup-card__undo" onClick={onUndo}>
              Undo
            </button>
          </>
        ) : diff.length > 0 ? (
          <button type="button" className="btn btn--primary btn--block lookup-card__apply" onClick={onApply}>
            <Icon name="sparkle" size={16} />
            Use these details
          </button>
        ) : (
          <span className="lookup-card__done lookup-card__done--muted">
            <Icon name="check" size={16} strokeWidth={2.25} />
            Your details are kept
          </span>
        )}
      </div>
    </section>
  );
}
