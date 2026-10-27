import { useId } from 'react';
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

/** Distance equivalents, with progress toward the next complete lunar distance. */
export function Journey({ totals, unit }: { totals: Totals; unit: DistanceUnit }) {
  const uid = useId().replace(/:/g, '');
  const trips = Math.max(0, Number.isFinite(totals.toMoon) ? totals.toMoon : 0);
  const completed = Math.floor(trips);
  const progress = trips - completed;
  const remaining = (1 - progress) * 384_400;
  return (
    <section className="stats-journey card" aria-label="Distance comparisons">
      <header className="journey-heading">
        <span>Distance, in perspective</span>
        <span>{fmtInt(toUnit(totals.distanceKm, unit))} {unit} flown</span>
      </header>
      <div className="journey-comparisons">
        <div className="journey-comparison">
          <svg viewBox="0 0 160 130" className="journey-planet" aria-hidden="true">
            <defs>
              <radialGradient id={`${uid}-ocean`} cx="30%" cy="25%" r="85%"><stop stopColor="var(--accent)"/><stop offset="1" stopColor="var(--bg-elevated)"/></radialGradient>
              <clipPath id={`${uid}-globe`}><circle cx="80" cy="64" r="40"/></clipPath>
            </defs>
            <circle cx="80" cy="64" r="49" className="journey-atmosphere"/>
            <circle cx="80" cy="64" r="40" fill={`url(#${uid}-ocean)`}/>
            <g clipPath={`url(#${uid}-globe)`} className="journey-land">
              <path d="M43 36 57 27 76 29 82 38 72 42 69 51 60 54 63 65 71 72 68 78 56 66 49 55 40 53Z"/>
              <path d="M72 72 87 77 91 88 83 98 78 111 71 105 68 91 64 80Z"/>
              <path d="M102 30 120 35 128 51 114 55 107 64 100 59 103 49 95 44Z"/>
            </g>
            <ellipse cx="80" cy="64" rx="65" ry="19" transform="rotate(-24 80 64)" className="journey-orbit"/>
            <circle cx="132" cy="36" r="4" className="journey-marker"/>
          </svg>
          <p className="journey-number">{fmtTimes(totals.aroundEarth)}<span>×</span></p>
          <h3>Around the Earth</h3>
          <p className="journey-reference">{fmtInt(toUnit(40_075, unit))} {unit} per equatorial lap</p>
        </div>
        <div className="journey-comparison">
          <svg viewBox="0 0 160 130" className="journey-planet" aria-hidden="true">
            <defs><radialGradient id={`${uid}-moon`} cx="30%" cy="25%" r="85%"><stop stopColor="var(--text-2)"/><stop offset="1" stopColor="var(--surface-3)"/></radialGradient><clipPath id={`${uid}-lunar`}><circle cx="80" cy="64" r="35"/></clipPath></defs>
            <circle cx="80" cy="64" r="49" className="journey-lunar-orbit"/>
            <circle cx="80" cy="64" r="35" fill={`url(#${uid}-moon)`}/>
            <g clipPath={`url(#${uid}-lunar)`} className="journey-craters">
              <circle cx="67" cy="51" r="10"/><circle cx="91" cy="78" r="12"/><circle cx="96" cy="42" r="6"/><circle cx="61" cy="80" r="5"/><circle cx="82" cy="60" r="3"/>
            </g>
            <path d="M125 28v8m-4-4h8M32 83v6m-3-3h6" className="journey-stars"/>
          </svg>
          <p className="journey-number">{fmtTimes(trips)}<span>×</span></p>
          <h3>Earth to the Moon</h3>
          <p className="journey-reference">{fmtInt(toUnit(384_400, unit))} {unit} each way</p>
        </div>
      </div>
      <div className="journey-milestone">
        <div className="journey-milestone__heading"><span>{completed ? `Next milestone · ${completed + 1}× to the Moon` : 'Your first lunar distance'}</span><strong>{Math.floor(progress * 100)}%</strong></div>
        <div className="journey-progress" role="progressbar" aria-label="Progress toward next lunar distance" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(progress * 100)}><span style={{width: `${progress * 100}%`}}/></div>
        <p>{completed > 0 ? `${fmtInt(completed)} complete · ` : ''}{fmtInt(toUnit(remaining, unit))} {unit} to the next milestone</p>
      </div>
      <p className="journey-note">Distance equivalents · average Earth–Moon distance · illustration not to scale</p>
    </section>
  );
}
