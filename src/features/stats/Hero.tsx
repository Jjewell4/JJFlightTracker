import { useId } from 'react';
import { isLand } from '@/features/flights/projection';
import type { FlightStats, Totals, YearScope } from '@/lib/stats';
import { Icon } from '@/components/Icon';
import { TrendBars } from './charts/TrendBars';
import { trendData } from './trend';
import { ARC_PATH, EARTH_LAP_KM, MOON_KM, journeyModel, pointOnArc } from './journey';
import { CountUp } from './parts';
import {
  fmt1,
  fmtInt,
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
  /** Lifetime distance through the end of the selected year (single-year scope). */
  lifetimeKm?: number;
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

export function Hero({ stats, scope, unit, prev, firstYear, timeEstimated = false, lifetimeKm }: Props) {
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
          target="stats-timeline"
          metric="distance"
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
          target="stats-timeline"
          metric="hours"
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
        <Tile icon="takeoff" label="Airports" value={stats.unique.airports} target="stats-top-airports">
          {fmtInt(stats.unique.routes)} unique{' '}
          {plural(stats.unique.routes, 'route')}
        </Tile>
        <Tile icon="map" label="Countries" value={stats.unique.countries} target="stats-places">
          {stats.unique.continents}{' '}
          {plural(stats.unique.continents, 'continent')}
        </Tile>
        <Tile icon="plane" label="Airlines" value={stats.unique.airlines} target="stats-top-airlines">
          {topAirline ? `Mostly ${topAirline.name}` : 'None recorded'}
        </Tile>
        <Tile
          icon="layers"
          label="Aircraft types"
          value={stats.unique.aircraft}
          target="stats-top-aircraft"
        >
          {stats.unique.registrations > 0
            ? `${fmtInt(stats.unique.registrations)} tail ${plural(stats.unique.registrations, 'number')}`
            : topAircraft
              ? `Mostly ${topAircraft.icao ?? topAircraft.name}`
              : 'None recorded'}
        </Tile>
      </div>

      <Journey totals={t} unit={unit} scope={scope} lifetimeKm={lifetimeKm} prevKm={prev?.distanceKm} />
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

/** Event asking the year-by-year chart to show a metric (a tile drilled into it). */
export const STATS_METRIC_EVENT = 'ws:stats-metric';

/** Scrolls to the card with the details behind a tile and flashes it. */
function drillTo(target: string, metric?: 'distance' | 'hours') {
  if (metric) window.dispatchEvent(new CustomEvent(STATS_METRIC_EVENT, { detail: metric }));
  const el = document.getElementById(target);
  if (!el) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  el.classList.remove('is-flash');
  void el.offsetWidth; // restart the animation on repeat taps
  el.classList.add('is-flash');
  window.setTimeout(() => el.classList.remove('is-flash'), 1600);
}

function Tile({
  icon,
  label,
  value,
  unit,
  approx,
  target,
  metric,
  children,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  value: number;
  unit?: string;
  approx?: boolean;
  /** Id of the card with the details; the tile becomes a button that scrolls there. */
  target?: string;
  metric?: 'distance' | 'hours';
  children?: React.ReactNode;
}) {
  const body = (
    <>
      <span className="stats-tile__label">
        <Icon name={icon} size={14} />
        {label}
        {target && <Icon name="chevron" size={14} className="stats-tile__go" />}
      </span>
      <span
        className="stats-tile__value"
        style={tileSize(
          fmtInt(value).length + (unit?.length ?? 0) + (approx ? 1 : 0),
        )}
      >
        {approx && <span className="stats-tile__approx">≈</span>}
        <CountUp value={value} format={fmtInt} />
        {unit && <span className="stats-tile__unit">{unit}</span>}
      </span>
      <span className="stats-tile__sub">{children}</span>
    </>
  );
  return target ? (
    <button type="button" className="stats-tile stats-tile--link" onClick={() => drillTo(target, metric)}>
      {body}
    </button>
  ) : (
    <div className="stats-tile">{body}</div>
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

/**
 * Earth-to-Moon journey: how far the selected scope's flying would take you. The plane sits at
 * the real fraction of the way to the Moon, the ring around the Earth fills with the current lap,
 * and for a single year the progress bar shows the lifetime total at the end of that year.
 */
export function Journey({
  totals,
  unit,
  scope = 'all',
  lifetimeKm,
  prevKm,
}: {
  totals: Totals;
  unit: DistanceUnit;
  scope?: YearScope;
  lifetimeKm?: number;
  prevKm?: number;
}) {
  const id = useId().replace(/:/g, '');
  const m = journeyModel(totals.distanceKm, { scope, unit, lifetimeKm, prevKm });
  const plane = pointOnArc(Math.max(0.05, m.arcProgress));
  const traveled = Math.max(0, Math.min(1, m.arcProgress));
  return (
    <section className="stats-journey card celestial-journey" aria-label={`Distance comparisons, ${m.heading.toLowerCase()}`}>
      <p className="celestial-journey__heading">
        <span>{m.heading}</span>
        <strong className="tabular">{m.distanceLabel}</strong>
      </p>
      <div className="celestial-journey__numbers">
        <div>
          <strong>
            {m.earth.value}
            <small>{m.earth.suffix}</small>
          </strong>
          <span>{m.earth.caption}</span>
        </div>
        <div>
          <strong>
            {m.moonCmp.value}
            <small>{m.moonCmp.suffix}</small>
          </strong>
          <span>{m.moonCmp.caption}</span>
        </div>
      </div>
      <svg viewBox="0 0 400 178" className="celestial-journey__art" aria-hidden="true">
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
          <linearGradient id={`${id}-route`} gradientUnits="userSpaceOnUse" x1="83" y1="0" x2="324" y2="0">
            <stop stopColor="var(--accent)" />
            <stop offset=".35" stopColor="var(--accent-2)" />
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
        <circle cx="58" cy="117" r="43" className="celestial-journey__atmosphere" />
        {m.lapProgress > 0.01 && (
          <circle
            cx="58"
            cy="117"
            r="43"
            pathLength={1}
            strokeDasharray={`${m.lapProgress} 1`}
            transform="rotate(-90 58 117)"
            className="celestial-journey__lap"
          />
        )}
        <circle cx="58" cy="117" r="34" fill={`url(#${id}-earth)`} />
        <path d={earthLand} className="celestial-journey__land" />
        <path d={ARC_PATH} className="celestial-journey__route-rest" pathLength={1} />
        {traveled > 0 && (
          <>
            <path d={ARC_PATH} className="celestial-journey__route-glow" pathLength={1} strokeDasharray={`${traveled} 1`} />
            <path d={ARC_PATH} fill="none" stroke={`url(#${id}-route)`} strokeWidth="2.4" strokeLinecap="round" pathLength={1} strokeDasharray={`${traveled} 1`} />
          </>
        )}
        <circle cx="83" cy="94" r="3" className="celestial-journey__origin" />
        {m.km > 0 && (
          <g transform={`translate(${plane.x.toFixed(1)} ${plane.y.toFixed(1)}) rotate(${(plane.angle + 90).toFixed(1)}) translate(-11 -11)`} className="celestial-journey__plane">
            <Icon name="plane" size={22} />
          </g>
        )}
        <circle cx="345" cy="74" r="22" className="celestial-journey__moon-halo" />
        <circle cx="345" cy="74" r="18" fill={`url(#${id}-moon)`} />
        <g className="celestial-journey__craters">
          <circle cx="339" cy="69" r="4" />
          <circle cx="351" cy="79" r="5" />
          <circle cx="352" cy="64" r="2" />
        </g>
        <text x="58" y="171" textAnchor="middle" className="celestial-journey__planet-label">
          EARTH
        </text>
        <text x="345" y="115" textAnchor="middle" className="celestial-journey__planet-label">
          MOON
        </text>
      </svg>
      <div className="celestial-journey__milestone">
        <span>{m.milestone}</span>
        <strong>{m.percentLabel}</strong>
      </div>
      <div
        className="celestial-journey__progress"
        role="progressbar"
        aria-label="Progress toward next lunar distance"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={m.percent}
      >
        <span style={{ width: `${m.percent}%` }} />
      </div>
      {m.context && <p className="celestial-journey__context">{m.context}</p>}
      <p className="celestial-journey__note">
        {fmtInt(toUnit(EARTH_LAP_KM, unit))} {unit} per Earth lap · {fmtInt(toUnit(MOON_KM, unit))} {unit} to the Moon. Illustration not to scale.
      </p>
    </section>
  );
}
