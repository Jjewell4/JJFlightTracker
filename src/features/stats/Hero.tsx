import type { FlightStats, Totals, YearScope } from '@/lib/stats';
import { MONTH_LABELS } from '@/lib/stats';
import { Icon } from '@/components/Icon';
import { Sparkline } from './charts/Sparkline';
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

export function Hero({ stats, scope, unit, prev, firstYear }: Props) {
  const t = stats.totals;
  const other: DistanceUnit = unit === 'mi' ? 'km' : 'mi';
  const trend =
    scope === 'all'
      ? stats.byYear.map((y) => y.flights)
      : stats.byMonth.map((m) => m.flights);
  const trendStart =
    scope === 'all' ? String(stats.byYear[0]?.year ?? '') : MONTH_LABELS[0];
  const trendEnd =
    scope === 'all'
      ? String(stats.byYear[stats.byYear.length - 1]?.year ?? '')
      : MONTH_LABELS[11];
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
        {trend.length > 1 && trend.some((v) => v > 0) && (
          <div className="stats-hero__trend">
            <Sparkline values={trend} height={52} />
            <div className="stats-hero__trend-axis" aria-hidden>
              <span>{trendStart}</span>
              <span>
                {scope === 'all' ? 'flights per year' : 'flights per month'}
              </span>
              <span>{trendEnd}</span>
            </div>
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
          label="Time in the air"
          value={hours}
          unit="h"
          approx={t.estimatedDuration > t.flights * 0.1}
        >
          {mins} min ·{' '}
          {t.days >= 2
            ? `${fmt1(t.days)} days`
            : `${fmt1(t.durationMin / 60)} hours`}
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

/** Compact distance story: real totals, two comparisons, one unambiguous next target. */
export function Journey({
  totals,
  unit,
}: {
  totals: Totals;
  unit: DistanceUnit;
}) {
  const trips = Math.max(0, Number.isFinite(totals.toMoon) ? totals.toMoon : 0);
  const completed = Math.floor(trips);
  const progress = trips - completed;
  const percentage = Math.min(99, Math.round(progress * 100));
  const remaining = (1 - progress) * 384_400;
  return (
    <section
      className="stats-journey card distance-story"
      aria-label="Distance comparisons"
    >
      <header className="distance-story__heading">
        <span className="distance-story__eyebrow">BEYOND THE FLIGHT LOG</span>
        <Icon name="globe" size={20} />
      </header>
      <h3>Look how far you’ve come.</h3>
      <p className="distance-story__distance">
        {fmtInt(toUnit(totals.distanceKm, unit))}
        <span>{unit} flown</span>
      </p>
      <div className="distance-story__comparisons">
        <div>
          <span className="distance-story__symbol">
            <Icon name="globe" size={22} />
          </span>
          <div>
            <strong>
              {fmtTimes(totals.aroundEarth)}
              <small>×</small>
            </strong>
            <span>around the Earth</span>
          </div>
          <span className="distance-story__reference">
            {fmtInt(toUnit(40_075, unit))} {unit} / lap
          </span>
        </div>
        <div>
          <span className="distance-story__symbol distance-story__symbol--moon">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path
                d="M19 15.5A8 8 0 0 1 8.5 5 8 8 0 1 0 19 15.5Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div>
            <strong>
              {fmtTimes(trips)}
              <small>×</small>
            </strong>
            <span>the distance to the Moon</span>
          </div>
          <span className="distance-story__reference">
            {fmtInt(toUnit(384_400, unit))} {unit} / trip
          </span>
        </div>
      </div>
      <div className="distance-story__milestone">
        <div className="distance-story__milestone-label">
          <span>
            {completed
              ? `Next milestone · ${completed + 1}× to the Moon`
              : 'Your first lunar distance'}
          </span>
          <strong>{percentage}%</strong>
        </div>
        <div
          className="distance-story__track"
          role="progressbar"
          aria-label="Progress toward next lunar distance"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percentage}
        >
          <span style={{ width: `${progress * 100}%` }} />
        </div>
        <p>
          {completed > 0 ? `${fmtInt(completed)} complete · ` : ''}
          {fmtInt(toUnit(remaining, unit))} {unit} to go
        </p>
      </div>
      <p className="distance-story__note">
        Based on Earth’s equator and the average Earth–Moon distance.
      </p>
    </section>
  );
}
