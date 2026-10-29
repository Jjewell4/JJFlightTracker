import { memo } from 'react';
import { Link } from 'react-router-dom';
import { AirlineLogo } from '@/components/AirlineLogo';
import { Icon } from '@/components/Icon';
import { getAirport } from '@/data/reference';
import { airportCode, flightAircraftName, flightAirlineName, flightDistanceKm, parseFlightNumber } from '@/lib/flight-utils';
import { formatDuration, formatTime } from '@/lib/time';
import type { Flight, Settings } from '@/lib/types';
import { formatDistance } from './flight-logic';

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "UA1234" → "UA 1234" for readability. */
export function prettyFlightNumber(fn: string | undefined): string | undefined {
  if (!fn) return undefined;
  const p = parseFlightNumber(fn);
  return p ? `${p.prefix} ${p.number}` : fn;
}

export function rowDate(f: Pick<Flight, 'date' | 'datePrecision'>): { main: string; sub?: string } {
  const [y, m, d] = f.date.split('-').map(Number);
  if (f.datePrecision === 'year') return { main: String(y) };
  if (f.datePrecision === 'month') return { main: SHORT_MONTHS[m - 1], sub: String(y) };
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return { main: `${SHORT_MONTHS[m - 1]} ${d}`, sub: wd };
}

/** "Boeing 737-800" → "737-800", "Airbus A321neo" → "A321neo" (compact list display). */
export function shortAircraft(name: string | undefined): string | undefined {
  if (!name) return undefined;
  return name.replace(/^(Boeing|Airbus|Embraer|Bombardier|McDonnell Douglas|De Havilland Canada|Canadair)\s+/i, '');
}

export function shortCity(ident: string): string {
  const a = getAirport(ident);
  return a?.city || a?.name || ident;
}

interface Props {
  flight: Flight;
  unit: Settings['distanceUnit'];
  clock: Settings['clock'];
  /**
   * A row with no flight page to open (public journals): renders as plain content and,
   * since shared flights carry no times, names the airline where the times would be.
   */
  linkless?: boolean;
}

/** One flight in the list: airline mark, big route codes, cities, times and key facts. */
export const FlightRow = memo(function FlightRow({ flight: f, unit, clock, linkless = false }: Props) {
  const from = airportCode(f.from);
  const to = airportCode(f.to);
  const airline = flightAirlineName(f);
  const aircraft = shortAircraft(flightAircraftName(f));
  const fn = prettyFlightNumber(f.flightNumber);
  const date = rowDate(f);
  const dep = formatTime(f.depTime, clock);
  const arr = formatTime(f.arrTime, clock);
  const km = flightDistanceKm(f);
  const offset = f.arrDayOffset ?? 0;
  const airlineInTimes = linkless && !dep;
  const label = `${airline ? `${airline} ` : ''}${fn ?? ''} from ${shortCity(f.from)} to ${shortCity(f.to)}, ${date.main}${date.sub && f.datePrecision === 'month' ? ` ${date.sub}` : ''}`;

  const body = (
    <>
      <span className="frow__logo">
        <AirlineLogo iata={f.airlineIata} icao={f.airlineIcao} name={airline} size={36} />
      </span>
      <span className="frow__main">
        <span className="frow__route">
          <span className="frow__code">{from}</span>
          <span className="frow__line" aria-hidden>
            <Icon name="plane" size={12} className="frow__plane" />
          </span>
          <span className="frow__code">{to}</span>
        </span>
        <span className="frow__cities">
          <span>{shortCity(f.from)}</span>
          <span>{shortCity(f.to)}</span>
        </span>
      </span>
      <span className="frow__side">
        <span className="frow__date">{date.main}</span>
        <span className="frow__dur">{f.durationMin ? formatDuration(f.durationMin) : date.sub}</span>
      </span>
      <span className="frow__foot">
        {(!airlineInTimes || airline) && <span className="frow__times">
          {dep ? (
            <>
              {dep}
              {arr && (
                <>
                  <span className="frow__arrow">{"\u2009→\u2009"}</span>
                  {arr}
                  {offset !== 0 && <sup className="frow__offset">{offset > 0 ? `+${offset}` : offset}</sup>}
                </>
              )}
            </>
          ) : airlineInTimes ? (
            airline
          ) : (
            <span className="subtle">No times</span>
          )}
        </span>}
        <span className="frow__info">
          {fn && <span className="frow__fn">{fn}</span>}
          {aircraft && (
            <span className="frow__ac">
              <span className={f.aircraftType ? 'frow__ac-long' : undefined}>{aircraft}</span>
              {f.aircraftType && <span className="frow__ac-code">{f.aircraftType}</span>}
            </span>
          )}
          {!fn && !aircraft && airline && !airlineInTimes && <span className="frow__ac">{airline}</span>}
        </span>
      </span>
      <span className="frow__dist">{formatDistance(km, unit)}</span>
    </>
  );
  if (linkless)
    return (
      <div className="frow frow--static" role="group" aria-label={label}>
        {body}
      </div>
    );
  return (
    <Link to={`/flights/${f.id}`} className="frow" aria-label={label}>
      {body}
    </Link>
  );
});

export function FlightRowSkeleton() {
  return (
    <div className="frow frow--skeleton" aria-hidden>
      <span className="frow__logo skeleton" style={{ width: 36, height: 36, borderRadius: 10 }} />
      <span className="frow__main">
        <span className="skeleton" style={{ width: '70%', height: 20 }} />
        <span className="skeleton" style={{ width: '50%', height: 12, marginTop: 8 }} />
      </span>
      <span className="frow__side">
        <span className="skeleton" style={{ width: 44, height: 14 }} />
      </span>
      <span className="frow__foot">
        <span className="skeleton" style={{ width: '60%', height: 12 }} />
      </span>
    </div>
  );
}
