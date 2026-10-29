import { Link } from 'react-router-dom';
import { AirlineLogo } from '@/components/AirlineLogo';
import { Icon } from '@/components/Icon';
import { airportCode, flightAirlineName } from '@/lib/flight-utils';
import { formatFlightDate } from '@/lib/time';
import type { Memory } from './flight-logic';
import { shortCity } from './FlightRow';

/** "On this day" memories: flights from this date (or this week) in earlier years. */
export function OnThisDay({ memories }: { memories: Memory[] }) {
  if (!memories.length) return null;
  const exact = memories[0].exact;
  return (
    <section className="memories card animate-in" aria-labelledby="memories-title">
      <div className="memories__head">
        <span className="memories__icon" aria-hidden>
          <Icon name="calendar" size={18} />
        </span>
        <h2 id="memories-title" className="memories__title">
          {exact ? 'On this day' : 'This week, years ago'}
        </h2>
      </div>
      <ul className="memories__list">
        {memories.map(({ flight: f, yearsAgo }) => {
          const airline = flightAirlineName(f);
          return (
            <li key={f.id}>
              <Link to={`/flights/${f.id}`} className="memories__row">
                <AirlineLogo iata={f.airlineIata} icao={f.airlineIcao} name={airline} size={32} />
                <span className="memories__text">
                  <span className="memories__route">
                    <span className="code">{airportCode(f.from)}</span> → <span className="code">{airportCode(f.to)}</span>
                    <span className="memories__cities">
                      {shortCity(f.from)} to {shortCity(f.to)}
                    </span>
                  </span>
                  <span className="memories__when">
                    {yearsAgo === 1 ? 'A year ago' : `${yearsAgo} years ago`}
                    {!exact && ` · ${formatFlightDate(f.date, 'day')}`}
                  </span>
                </span>
                <Icon name="chevron" size={16} className="memories__chev" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
