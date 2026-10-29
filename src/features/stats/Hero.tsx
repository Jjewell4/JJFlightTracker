import { useId } from 'react';
import { isLand } from '@/features/flights/projection';
import type { FlightStats, Totals, YearScope } from '@/lib/stats';
import { Icon } from '@/components/Icon';
import { TrendBars } from './charts/TrendBars';
import { trendData } from './trend';
import { CountUp } from './parts';
import {
  fmt1,
  fmtInt,
  fmtTimes,
  plural,
  toUnit,
  type DistanceUnit,
} from './format';

interface Props {
  stats: FlightStats;
  scope: YearScope;
  unit: DistanceUnit;
  prev?: Totals;
  firstYear?: number;
  /** No recorded times (public journals): time in the air is a distance estimate. */
  timeEstimated?: boolean;
}

function Delta({
  now,
  before,
  format = fmtInt,
  year,
}: {
  now: number;
  before?: number;
  format?: (n: number) => string;
  year: number;
}) {
  if (before === undefined) return null;
  const d = now - before;
  const flat = Math.abs(d) < 0.5;
  const dir = flat ? 'flat' : d > 0 ? 'up' : 'down';
  return (
    <span className={`stats-delta stats-delta--${dir}`}>
      <span aria-hidden>{flat ? '=' : d > 0 ? '▲' : '▼'}</span>
      {flat ? 'Same' : format(Math.abs(d))} vs {year}
    </span>
  );
}

export function Hero({ stats, scope, unit, prev, firstYear, timeEstimated = false }: Props) {
  const t = stats.totals;
  const other: DistanceUnit = unit === 'mi' ? 'km' : 'mi';
  const trend = trendData(stats, scope);
  const perYear = scope === 'all';
  const trendLabel = perYear
    ? `Flights per year, ${trend.data[0]?.label ?? ''}–${trend.data[trend.data.length - 1]?.label ?? ''}`
    : `Flights per month in ${scope}`;
  const prevYear = typeof scope === 'number' ? scope - 1 : 0;
  const hours = Math.floor(t.durationMin / 60);
  const mins = Math.round(t.durationMin % 60);
  const topAirline = stats.airlines[0];
  const topAircraft = stats.aircraft[0];

  return (
    <>
      <section className="stats-hero animate-in" aria-label="Summary">
        <div className="stats-hero__glow" aria-hidden />
        <p className="stats-hero__kicker">
          {scope === 'all'
            ? `All time${firstYear ? ` · since ${firstYear}` : ''}`
            : `${scope} in the air`}
        </p>
        <div className="stats-hero__main">
          <CountUp
            value={t.flights}
            format={fmtInt}
            className="stats-hero__big"
          />
          <span className="stats-hero__unit">
            {plural(t.flights, 'flight')}
          </span>
        </div>
        <p className="stats-hero__split">
          <span>
            <i className="stats-dot stats-dot--s1" aria-hidden />
            {fmtInt(t.domestic)} domestic
          </span>
          <span>
            <i className="stats-dot stats-dot--s2" aria-hidden />
            {fmtInt(t.international)} international
          </span>
          {prev && (
            <Delta now={t.flights} before={prev.flights} year={prevYear} />
          )}
        </p>
        {trend.data.length > 1 && trend.data.some((d) => d.value > 0) && (
          <div className="stats-hero__trend">
            <TrendBars
              data={trend.data}
              highlightKey={trend.highlightKey}
              partialKey={trend.highlightKey}
              formatValue={(v) => `${fmtInt(v)} ${plural(v, 'flight')}`}
              label={trendLabel}
              caption={perYear ? 'flights per year' : 'flights per month'}
              height={52}
            />
          </div>
        )}
      </section>

      <div className="stats-tiles">
        <Tile
          icon="globe"
          label="Distance"
          value={toUnit(t.distanceKm, unit)}
          unit={unit}
        >
          {fmtInt(toUnit(t.distanceKm, other))} {other}
          {prev && (
            <Delta
              now={toUnit(t.distanceKm, unit)}
              before={toUnit(prev.distanceKm, unit)}
              year={prevYear}
              format={(n) => `${fmtInt(n)} ${unit}`}
            />
          )}
        </Tile>
        <Tile
          icon="clock"
          label={timeEstimated ? 'Est. time in the air' : 'Time in the air'}
          value={hours}
          unit="h"
          approx={timeEstimated || t.estimatedDuration > t.flights * 0.1}
        >
          {timeEstimated ? (
            `From distance · ${t.days >= 2 ? `${fmt1(t.days)} days` : `${fmt1(t.durationMin / 60)} hours`}`
          ) : (
            <>
              {mins} min ·{' '}
              {t.days >= 2
                ? `${fmt1(t.days)} days`
                : `${fmt1(t.durationMin / 60)} hours`}
            </>
          )}
          {prev && (
            <Delta
              now={t.durationMin / 60}
              before={prev.durationMin / 60}
              year={prevYear}
              format={(n) => `${fmtInt(n)} h`}
            />
          )}
        </Tile>
        <Tile icon="takeoff" label="Airports" value={stats.unique.airports}>
          {fmtInt(stats.unique.routes)} unique{' '}
          {plural(stats.unique.routes, 'route')}
        </Tile>
        <Tile icon="map" label="Countries" value={stats.unique.countries}>
          {stats.unique.continents}{' '}
          {plural(stats.unique.continents, 'continent')}
        </Tile>
        <Tile icon="plane" label="Airlines" value={stats.unique.airlines}>
          {topAirline ? `Mostly ${topAirline.name}` : 'None recorded'}
        </Tile>
        <Tile
          icon="layers"
          label="Aircraft types"
          value={stats.unique.aircraft}
        >
          {stats.unique.registrations > 0
            ? `${fmtInt(stats.unique.registrations)} tail ${plural(stats.unique.registrations, 'number')}`
            : topAircraft
              ? `Mostly ${topAircraft.icao ?? topAircraft.name}`
              : 'None recorded'}
        </Tile>
      </div>

      <Journey totals={t} unit={unit} />
    </>
  );
}

/** Steps the numeral down for long values so it never overflows a half-width tile. */
function tileSize(chars: number): React.CSSProperties | undefined {
  if (chars >= 10)
    return { '--tile-fs': 'var(--text-xl)' } as React.CSSProperties;
  if (chars >= 8)
    return { '--tile-fs': 'var(--text-2xl)' } as React.CSSProperties;
  return undefined;
}

function Tile({
  icon,
  label,
  value,
  unit,
  approx,
  children,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  value: number;
  unit?: string;
  approx?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="stats-tile">
      <p className="stats-tile__label">
        <Icon name={icon} size={14} />
        {label}
      </p>
      <p
        className="stats-tile__value"
        style={tileSize(
          fmtInt(value).length + (unit?.length ?? 0) + (approx ? 1 : 0),
        )}
      >
        {approx && <span className="stats-tile__approx">≈</span>}
        <CountUp value={value} format={fmtInt} />
        {unit && <span className="stats-tile__unit">{unit}</span>}
      </p>
      <p className="stats-tile__sub">{children}</p>
    </div>
  );
}

/** Real land-mask dots projected onto an orthographic globe. */
const earthLand = (() => {
  const dots: string[] = [];
  for (let y = -0.96; y < 1; y += 0.055)
    for (let x = -0.96; x < 1; x += 0.055) {
      const z2 = 1 - x * x - y * y;
      if (z2 <= 0) continue;
      const lon = (Math.atan2(x, Math.sqrt(z2)) * 180) / Math.PI - 70;
      const lat = (Math.asin(-y) * 180) / Math.PI;
      if (isLand(lon, lat))
        dots.push(
          `M${(58 + x * 34).toFixed(1)} ${(117 + y * 34).toFixed(1)}h0`,
        );
    }
  return dots.join('');
})();

/** The original Earth-to-Moon arc, with clearer planet detail and milestone semantics. */
export function Journey({
  totals,
  unit,
}: {
  totals: Totals;
  unit: DistanceUnit;
}) {
  const id = useId().replace(/:/g, '');
  const trips = Math.max(0, Number.isFinite(totals.toMoon) ? totals.toMoon : 0);
  const completed = Math.floor(trips),
    progress = trips - completed;
  const percentage = Math.min(99, Math.round(progress * 100));
  return (
    <section
      className="stats-journey card celestial-journey"
      aria-label="Distance comparisons"
    >
      <div className="celestial-journey__numbers">
        <div>
          <strong>
            {fmtTimes(totals.aroundEarth)}
            <small>×</small>
          </strong>
          <span>around the Earth</span>
        </div>
        <div>
          <strong>
            {fmtTimes(trips)}
            <small>×</small>
          </strong>
          <span>the distance to the Moon</span>
        </div>
      </div>
      <svg
        viewBox="0 0 400 178"
        className="celestial-journey__art"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id={`${id}-earth`} cx="28%" cy="25%" r="85%">
            <stop stopColor="var(--accent)" />
            <stop offset=".55" stopColor="var(--accent-strong)" />
            <stop offset="1" stopColor="var(--bg-elevated)" />
          </radialGradient>
          <radialGradient id={`${id}-moon`} cx="30%" cy="25%" r="80%">
            <stop stopColor="var(--text)" />
            <stop offset="1" stopColor="var(--text-3)" />
          </radialGradient>
          <linearGradient id={`${id}-route`}>
            <stop stopColor="var(--accent)" />
            <stop offset=".3" stopColor="var(--accent-2)" />
            <stop offset="1" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
        <g className="celestial-journey__stars">
          <circle cx="126" cy="104" r="1" />
          <circle cx="211" cy="85" r="1.3" />
          <circle cx="274" cy="124" r="1" />
          <circle cx="361" cy="26" r="1" />
          <path d="M176 133v6m-3-3h6M304 16v6m-3-3h6" />
        </g>
        <circle
          cx="58"
          cy="117"
          r="43"
          className="celestial-journey__atmosphere"
        />
        <circle cx="58" cy="117" r="34" fill={`url(#${id}-earth)`} />
        <path d={earthLand} className="celestial-journey__land" />
        <path
          d="M83 94Q203 -7 324 66"
          className="celestial-journey__route-glow"
        />
        <path
          d="M83 94Q203 -7 324 66"
          fill="none"
          stroke={`url(#${id}-route)`}
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <circle cx="83" cy="94" r="3" className="celestial-journey__origin" />
        <g
          transform="translate(285 47) rotate(112) translate(-11 -11)"
          className="celestial-journey__plane"
        >
          <Icon name="plane" size={22} />
        </g>
        <circle
          cx="345"
          cy="74"
          r="22"
          className="celestial-journey__moon-halo"
        />
        <circle cx="345" cy="74" r="18" fill={`url(#${id}-moon)`} />
        <g className="celestial-journey__craters">
          <circle cx="339" cy="69" r="4" />
          <circle cx="351" cy="79" r="5" />
          <circle cx="352" cy="64" r="2" />
        </g>
        <text
          x="58"
          y="171"
          textAnchor="middle"
          className="celestial-journey__planet-label"
        >
          EARTH
        </text>
        <text
          x="345"
          y="115"
          textAnchor="middle"
          className="celestial-journey__planet-label"
        >
          MOON
        </text>
      </svg>
      <div className="celestial-journey__milestone">
        <span>
          {completed
            ? `${completed} complete · next: ${completed + 1}× to the Moon`
            : 'Your first lunar distance'}
        </span>
        <strong>{percentage}%</strong>
      </div>
      <div
        className="celestial-journey__progress"
        role="progressbar"
        aria-label="Progress toward next lunar distance"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentage}
      >
        <span style={{ width: `${progress * 100}%` }} />
      </div>
      <p className="celestial-journey__note">
        {fmtInt(toUnit(40_075, unit))} {unit} per Earth lap ·{' '}
        {fmtInt(toUnit(384_400, unit))} {unit} to the Moon. Illustration not to
        scale.
      </p>
    </section>
  );
}
