import { Link } from 'react-router-dom';
import { AirlineLogo } from '@/components/AirlineLogo';
import { Icon } from '@/components/Icon';
import { airportCode, flightAirlineName } from '@/lib/flight-utils';
import { formatDuration, formatFlightDate, formatTime } from '@/lib/time';
import type { Flight, Settings } from '@/lib/types';
import { countdownLabel } from './flight-logic';
import { prettyFlightNumber, shortCity } from './FlightRow';

export function UpcomingCard({ flight: f, today, clock }: { flight: Flight; today: string; clock: Settings['clock'] }) {
  const airline = flightAirlineName(f);
  const fn = prettyFlightNumber(f.flightNumber);
  const countdown = countdownLabel(f.date, today);
  const soon = countdown === 'Today' || countdown === 'Tomorrow';
  return (
    <Link to={`/flights/${f.id}`} className="upcard" aria-label={`Upcoming: ${fn ?? ''} ${shortCity(f.from)} to ${shortCity(f.to)}, ${countdown}`}>
      <div className="upcard__head">
        <AirlineLogo iata={f.airlineIata} icao={f.airlineIcao} name={airline} size={28} />
        <span className="upcard__airline">
          {airline ?? 'Flight'}
          {fn && <span className="upcard__fn">{fn}</span>}
        </span>
        <span className={`upcard__count${soon ? ' upcard__count--soon' : ''}`}>{countdown}</span>
      </div>
      <div className="upcard__route">
        <div className="upcard__end">
          <span className="upcard__code">{airportCode(f.from)}</span>
          <span className="upcard__city">{shortCity(f.from)}</span>
          {f.depTime && <span className="upcard__time tabular">{formatTime(f.depTime, clock)}</span>}
        </div>
        <div className="upcard__mid" aria-hidden>
          <span className="upcard__track">
            <Icon name="plane" size={14} className="upcard__plane" />
          </span>
          {f.durationMin ? <span className="upcard__dur">{formatDuration(f.durationMin)}</span> : null}
        </div>
        <div className="upcard__end upcard__end--to">
          <span className="upcard__code">{airportCode(f.to)}</span>
          <span className="upcard__city">{shortCity(f.to)}</span>
          {f.arrTime && (
            <span className="upcard__time tabular">
              {formatTime(f.arrTime, clock)}
              {f.arrDayOffset ? <sup>{f.arrDayOffset > 0 ? `+${f.arrDayOffset}` : f.arrDayOffset}</sup> : null}
            </span>
          )}
        </div>
      </div>
      <div className="upcard__date">
        <Icon name="calendar" size={14} />
        {formatFlightDate(f.date, f.datePrecision, 'long')}
      </div>
    </Link>
  );
}
