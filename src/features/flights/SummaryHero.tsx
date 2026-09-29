import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import type { Settings } from '@/lib/types';
import { formatCompact, formatLongDuration, type FlightSummary } from './flight-logic';
import { kmToMiles } from '@/lib/geo';

/** Flights-per-year mini bar chart. The current year is highlighted in amber. */
function YearSparkline({ perYear, year }: { perYear: FlightSummary['perYear']; year: string }) {
  if (perYear.length < 2) return null;
  const W = 132;
  const H = 44;
  const gap = 2;
  const max = Math.max(1, ...perYear.map((p) => p.count));
  const bw = Math.max(3, (W - gap * (perYear.length - 1)) / perYear.length);
  const r = Math.min(2, bw / 2);
  return (
    <figure className="hero__spark">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} preserveAspectRatio="none" role="img" aria-label={`Flights per year, ${perYear[0].year}–${perYear[perYear.length - 1].year}`}>
        {perYear.map((p, i) => {
          const h = p.count ? Math.max(3, (p.count / max) * H) : 1.5;
          const x = i * (bw + gap);
          const y = H - h;
          // Rounded top, square bottom anchored to the baseline.
          const d = `M${x} ${H}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + bw - r}Q${x + bw} ${y} ${x + bw} ${y + r}V${H}Z`;
          return (
            <path key={p.year} d={d} className={p.year === year ? 'hero__bar hero__bar--now' : p.count ? 'hero__bar' : 'hero__bar hero__bar--zero'}>
              <title>{`${p.year}: ${p.count} flight${p.count === 1 ? '' : 's'}`}</title>
            </path>
          );
        })}
      </svg>
      <figcaption className="hero__spark-axis">
        <span>{`’${perYear[0].year.slice(2)}`}</span>
        <span>{`’${perYear[perYear.length - 1].year.slice(2)}`}</span>
      </figcaption>
    </figure>
  );
}

export function SummaryHero({ summary, unit, upcoming }: { summary: FlightSummary; unit: Settings['distanceUnit']; upcoming: number }) {
  const dist = unit === 'mi' ? kmToMiles(summary.distanceKm) : summary.distanceKm;
  const laps = summary.distanceKm / 40075;
  return (
    <Link to="/stats" className="hero animate-in" aria-label="Open statistics">
      <div className="hero__glow" aria-hidden />
      <div className="hero__top">
        <div>
          <div className="hero__eyebrow">{summary.firstYear ? `Since ${summary.firstYear}` : 'Lifetime'}</div>
          <div className="hero__big tabular">
            {summary.flights.toLocaleString('en-US')}
            <span className="hero__big-unit">{summary.flights === 1 ? 'flight' : 'flights'}</span>
          </div>
        </div>
        <YearSparkline perYear={summary.perYear} year={summary.year} />
      </div>

      <dl className="hero__stats">
        <div className="hero__stat">
          <dt>Distance</dt>
          <dd className="tabular">
            {formatCompact(Math.round(dist))}
            <small> {unit}</small>
          </dd>
        </div>
        <div className="hero__stat">
          <dt>In the air</dt>
          <dd className="tabular">{formatLongDuration(summary.minutes)}</dd>
        </div>
        <div className="hero__stat">
          <dt>Airports</dt>
          <dd className="tabular">{summary.airports}</dd>
        </div>
        <div className="hero__stat">
          <dt>Countries</dt>
          <dd className="tabular">{summary.countries}</dd>
        </div>
      </dl>

      <div className="hero__foot">
        <span className="hero__year">
          <span className="hero__dot" aria-hidden />
          <strong>{summary.thisYear}</strong>&nbsp;{summary.thisYear === 1 ? 'flight' : 'flights'} in {summary.year}
          {upcoming > 0 && <span className="subtle">&nbsp;· {upcoming} upcoming</span>}
        </span>
        {laps >= 0.5 && <span className="hero__laps">{laps.toFixed(1)}× around Earth</span>}
        <Icon name="chevron" size={16} className="hero__chev" />
      </div>
    </Link>
  );
}

export function SummaryHeroSkeleton() {
  return (
    <div className="hero hero--skeleton" aria-hidden>
      <div className="hero__top">
        <div>
          <div className="skeleton" style={{ width: 80, height: 12 }} />
          <div className="skeleton" style={{ width: 150, height: 44, marginTop: 10 }} />
        </div>
        <div className="skeleton" style={{ width: 132, height: 44 }} />
      </div>
      <div className="hero__stats">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="hero__stat">
            <div className="skeleton" style={{ width: '60%', height: 10 }} />
            <div className="skeleton" style={{ width: '80%', height: 20, marginTop: 8 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
