import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { CONTINENTS, CONTINENT_NAMES, type FlightStats } from '@/lib/stats';
import { formatFlightDate } from '@/lib/time';
import { CardHead, Section } from './parts';
import { fmtInt, plural } from './format';

const COUNTRY_INITIAL = 12;

export function Places({ stats, homeCountry }: { stats: FlightStats; homeCountry: string }) {
  const [open, setOpen] = useState(false);
  const { countries, continents } = stats;
  if (!countries.length) return null;
  const visible = open ? countries : countries.slice(0, COUNTRY_INITIAL);
  const visited = new Set(continents.map((c) => c.continent));
  const maxFlights = Math.max(1, ...continents.map((c) => c.flights));
  const abroad = stats.countriesAbroad;

  return (
    <Section id="places" title="Places">
      <div className="stats-grid">
        <article className="card stats-card stats-card--wide">
          <CardHead
            title={`${countries.length} ${plural(countries.length, 'country', 'countries')}`}
            subtitle={homeCountry && abroad > 0 ? `${abroad} beyond ${countries.find((c) => c.code === homeCountry.toUpperCase())?.name ?? 'home'} · sorted by flights` : 'Sorted by flights'}
          />
          <ul className="stats-flags">
            {visible.map((c) => (
              <li key={c.code} className="stats-flag" title={`First visit ${formatFlightDate(c.firstDate)}`}>
                <span className="stats-flag__emoji" aria-hidden>
                  {c.flag || c.code}
                </span>
                <span className="stats-flag__text">
                  <span className="stats-flag__name">{c.name}</span>
                  <span className="stats-flag__meta">
                    {c.code === homeCountry.toUpperCase() && <span className="stats-flag__home">Home · </span>}
                    {fmtInt(c.flights)} {plural(c.flights, 'flight')}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {countries.length > COUNTRY_INITIAL && (
            <button type="button" className="stats-rank__more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              {open ? 'Show less' : `Show all ${countries.length}`}
              <Icon name="chevron" size={16} className={open ? 'is-open' : undefined} />
            </button>
          )}
        </article>

        <article className="card stats-card stats-card--wide-lg">
          <CardHead title={`${continents.length} of 7 continents`} subtitle="Flights touching each continent" />
          <div className="stats-continent-pills" aria-hidden>
            {CONTINENTS.map((c) => (
              <span key={c} className="stats-continent-pill" data-on={visited.has(c) || undefined}>
                {c}
              </span>
            ))}
          </div>
          <ul className="stats-continents">
            {continents.map((c) => (
              <li key={c.continent} className="stats-continent">
                <div className="stats-continent__top">
                  <span className="stats-continent__name">{CONTINENT_NAMES[c.continent]}</span>
                  <span className="stats-continent__count">
                    {fmtInt(c.flights)} <span className="subtle">{plural(c.flights, 'flight')}</span>
                  </span>
                </div>
                <span className="stats-rank__bar" aria-hidden>
                  <span style={{ width: `${Math.max(2, (c.flights / maxFlights) * 100)}%` }} />
                </span>
                <span className="stats-continent__meta">
                  {c.airports} {plural(c.airports, 'airport')} · {c.countries} {plural(c.countries, 'country', 'countries')}
                </span>
              </li>
            ))}
          </ul>
        </article>
      </div>
    </Section>
  );
}
