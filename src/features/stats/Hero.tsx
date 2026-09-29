import type { FlightStats, Totals, YearScope } from '@/lib/stats';
import { MONTH_LABELS } from '@/lib/stats';
import { Icon } from '@/components/Icon';
import { Sparkline } from './charts/Sparkline';
import { CountUp } from './parts';
import { fmt1, fmtInt, fmtTimes, plural, toUnit, type DistanceUnit } from './format';

interface Props {
  stats: FlightStats;
  scope: YearScope;
  unit: DistanceUnit;
  prev?: Totals;
  firstYear?: number;
}

function Delta({ now, before, format = fmtInt, year }: { now: number; before?: number; format?: (n: number) => string; year: number }) {
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
  const trend = scope === 'all' ? stats.byYear.map((y) => y.flights) : stats.byMonth.map((m) => m.flights);
  const trendStart = scope === 'all' ? String(stats.byYear[0]?.year ?? '') : MONTH_LABELS[0];
  const trendEnd = scope === 'all' ? String(stats.byYear[stats.byYear.length - 1]?.year ?? '') : MONTH_LABELS[11];
  const prevYear = typeof scope === 'number' ? scope - 1 : 0;
  const hours = Math.floor(t.durationMin / 60);
  const mins = Math.round(t.durationMin % 60);
  const topAirline = stats.airlines[0];
  const topAircraft = stats.aircraft[0];

  return (
    <>
      <section className="stats-hero animate-in" aria-label="Summary">
        <div className="stats-hero__glow" aria-hidden />
        <p className="stats-hero__kicker">{scope === 'all' ? `All time${firstYear ? ` · since ${firstYear}` : ''}` : `${scope} in the air`}</p>
        <div className="stats-hero__main">
          <CountUp value={t.flights} format={fmtInt} className="stats-hero__big" />
          <span className="stats-hero__unit">{plural(t.flights, 'flight')}</span>
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
          {prev && <Delta now={t.flights} before={prev.flights} year={prevYear} />}
        </p>
        {trend.length > 1 && trend.some((v) => v > 0) && (
          <div className="stats-hero__trend">
            <Sparkline values={trend} height={52} />
            <div className="stats-hero__trend-axis" aria-hidden>
              <span>{trendStart}</span>
              <span>{scope === 'all' ? 'flights per year' : 'flights per month'}</span>
              <span>{trendEnd}</span>
            </div>
          </div>
        )}
      </section>

      <div className="stats-tiles">
        <Tile icon="globe" label="Distance" value={toUnit(t.distanceKm, unit)} unit={unit}>
          {fmtInt(toUnit(t.distanceKm, other))} {other}
          {prev && <Delta now={toUnit(t.distanceKm, unit)} before={toUnit(prev.distanceKm, unit)} year={prevYear} format={(n) => `${fmtInt(n)} ${unit}`} />}
        </Tile>
        <Tile icon="clock" label="Time in the air" value={hours} unit="h" approx={t.estimatedDuration > t.flights * 0.1}>
          {mins} min · {t.days >= 2 ? `${fmt1(t.days)} days` : `${fmt1(t.durationMin / 60)} hours`}
          {prev && <Delta now={t.durationMin / 60} before={prev.durationMin / 60} year={prevYear} format={(n) => `${fmtInt(n)} h`} />}
        </Tile>
        <Tile icon="takeoff" label="Airports" value={stats.unique.airports}>
          {fmtInt(stats.unique.routes)} unique {plural(stats.unique.routes, 'route')}
        </Tile>
        <Tile icon="map" label="Countries" value={stats.unique.countries}>
          {stats.unique.continents} {plural(stats.unique.continents, 'continent')}
        </Tile>
        <Tile icon="plane" label="Airlines" value={stats.unique.airlines}>
          {topAirline ? `Mostly ${topAirline.name}` : 'None recorded'}
        </Tile>
        <Tile icon="layers" label="Aircraft types" value={stats.unique.aircraft}>
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
  if (chars >= 10) return { '--tile-fs': 'var(--text-xl)' } as React.CSSProperties;
  if (chars >= 8) return { '--tile-fs': 'var(--text-2xl)' } as React.CSSProperties;
  return undefined;
}

function Tile({ icon, label, value, unit, approx, children }: { icon: Parameters<typeof Icon>[0]['name']; label: string; value: number; unit?: string; approx?: boolean; children?: React.ReactNode }) {
  return (
    <div className="stats-tile">
      <p className="stats-tile__label">
        <Icon name={icon} size={14} />
        {label}
      </p>
      <p className="stats-tile__value" style={tileSize(fmtInt(value).length + (unit?.length ?? 0) + (approx ? 1 : 0))}>
        {approx && <span className="stats-tile__approx">≈</span>}
        <CountUp value={value} format={fmtInt} />
        {unit && <span className="stats-tile__unit">{unit}</span>}
      </p>
      <p className="stats-tile__sub">{children}</p>
    </div>
  );
}

/** Earth → Moon illustration with the distance flown as progress along the arc. */
function Journey({ totals, unit }: { totals: Totals; unit: DistanceUnit }) {
  const W = 320;
  const H = 96;
  const e = { x: 34, y: 66, r: 22 };
  const m = { x: 292, y: 40, r: 11 };
  const c = { x: 160, y: -6 };
  const trips = Math.floor(totals.toMoon);
  const frac = totals.toMoon >= 1 ? 1 : totals.toMoon;
  // Point & tangent on the quadratic Bézier at t.
  const t = Math.max(0.04, Math.min(1, frac));
  const s = { x: e.x + e.r * 0.8, y: e.y - e.r * 0.6 };
  const f = { x: m.x - m.r - 2, y: m.y + 2 };
  const bx = (1 - t) ** 2 * s.x + 2 * (1 - t) * t * c.x + t * t * f.x;
  const by = (1 - t) ** 2 * s.y + 2 * (1 - t) * t * c.y + t * t * f.y;
  const dx = 2 * (1 - t) * (c.x - s.x) + 2 * t * (f.x - c.x);
  const dy = 2 * (1 - t) * (c.y - s.y) + 2 * t * (f.y - c.y);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  const path = `M${s.x},${s.y}Q${c.x},${c.y} ${f.x},${f.y}`;
  const pathLen = 300; // approximate; used with pathLength for dash progress

  const moonText = totals.toMoon >= 1 ? `${fmtTimes(totals.toMoon)}×` : `${Math.round(totals.toMoon * 100)}%`;
  const moonLabel = totals.toMoon >= 1 ? 'the distance to the Moon' : 'of the way to the Moon';

  return (
    <section className="stats-journey card" aria-label="Distance comparisons">
      <div className="stats-journey__nums">
        <div>
          <p className="stats-journey__value">
            <CountUp value={totals.aroundEarth} format={(n) => `${fmtTimes(n)}×`} />
          </p>
          <p className="stats-journey__label">around the Earth</p>
        </div>
        <div className="stats-journey__right">
          <p className="stats-journey__value">{moonText}</p>
          <p className="stats-journey__label">{moonLabel}</p>
        </div>
      </div>
      <svg className="stats-journey__art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
        <defs>
          <radialGradient id="stats-earth" cx="35%" cy="30%" r="75%">
            <stop offset="0" className="stats-journey__earth-hi" />
            <stop offset="1" className="stats-journey__earth-lo" />
          </radialGradient>
        </defs>
        <path d={path} className="stats-journey__track" pathLength={pathLen} />
        <path d={path} className="stats-journey__flown" pathLength={pathLen} strokeDasharray={`${pathLen * t} ${pathLen}`} />
        <circle cx={e.x} cy={e.y} r={e.r + 7} className="stats-journey__orbit" />
        <circle cx={e.x} cy={e.y} r={e.r} fill="url(#stats-earth)" />
        <circle cx={m.x} cy={m.y} r={m.r} className="stats-journey__moon" />
        <circle cx={m.x - 3} cy={m.y - 2} r={2.2} className="stats-journey__crater" />
        <circle cx={m.x + 3.5} cy={m.y + 3} r={1.6} className="stats-journey__crater" />
        <g transform={`translate(${bx} ${by}) rotate(${angle}) translate(-10 -10)`} className="stats-journey__plane">
          <Icon name="plane" size={20} />
        </g>
        {trips >= 1 && (
          <text x={m.x} y={m.y + m.r + 16} textAnchor="middle" className="stats-journey__trips">
            {trips === 1 ? 'made it!' : `${trips} one-way trips`}
          </text>
        )}
      </svg>
      <p className="stats-journey__foot">
        {fmtInt(toUnit(40_075, unit))} {unit} per lap of the equator · {fmtInt(toUnit(384_400, unit))} {unit} to the Moon
      </p>
    </section>
  );
}
