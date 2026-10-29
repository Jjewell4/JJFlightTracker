/** Building blocks shared by the airport and airline pages. */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '@/components/Icon';
import { FlightRow } from '@/features/flights/FlightRow';
import { formatDistance, groupFlights, limitGroups } from '@/features/flights/flight-logic';
import { TrendBars } from '@/features/stats/charts/TrendBars';
import type { Flight, Settings } from '@/lib/types';
import type { YearCount } from './explore-logic';

const nf = new Intl.NumberFormat('en-US');
export const fmtCount = (n: number) => nf.format(n);
export const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** Back to wherever the page was opened from (or the log on a fresh load). */
export function useGoBack(): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/');
  }, [navigate]);
}

export function TopBar({ title, sub, onBack }: { title?: ReactNode; sub?: ReactNode; onBack: () => void }) {
  return (
    <header className="dbar">
      <button type="button" className="btn btn--ghost btn--icon dbar__btn" onClick={onBack} aria-label="Back">
        <Icon name="back" size={22} />
      </button>
      <div className="dbar__title">
        {title && <span className="dbar__main">{title}</span>}
        {sub && <span className="dbar__sub">{sub}</span>}
      </div>
      <span className="xp-bar-spacer" aria-hidden />
    </header>
  );
}

export interface Tile {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
}

/** Hero numbers: a 3-column grid of label / big value / caption. */
export function Tiles({ tiles, className }: { tiles: Tile[]; className?: string }) {
  return (
    <dl className={`xp-tiles${className ? ` ${className}` : ''}`}>
      {tiles.map((t) => (
        <div key={t.label} className="xp-tile">
          <dt>{t.label}</dt>
          <dd className="tabular">
            {t.value}
            {t.unit && <small> {t.unit}</small>}
          </dd>
          {t.sub && <span className="xp-tile__sub">{t.sub}</span>}
        </div>
      ))}
    </dl>
  );
}

export function Card({ title, subtitle, right, children, className }: { title: string; subtitle?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`xp-card animate-in${className ? ` ${className}` : ''}`} aria-label={title}>
      <header className="xp-card__head">
        <div className="xp-card__titles">
          <h2 className="xp-card__title">{title}</h2>
          {subtitle && <p className="xp-card__subtitle">{subtitle}</p>}
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

export interface RankItem {
  key: string;
  lead: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
  count: number;
  /** In-app link (owner views only). */
  to?: string;
  /** Accessible name for linked rows. */
  label?: string;
}

/** Ranked rows with proportional bars; the first `initial` rows show until expanded. */
export function RankList({ items, noun, initial = 5 }: { items: RankItem[]; noun: [string, string]; initial?: number }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  const max = items[0].count || 1;
  const shown = open ? items.slice(0, 100) : items.slice(0, initial);
  return (
    <>
      <ol className="xp-rank">
        {shown.map((r) => {
          const body = (
            <>
              <span className="xp-rank__lead">{r.lead}</span>
              <span className="xp-rank__text">
                <span className="xp-rank__primary">{r.primary}</span>
                {r.secondary && <span className="xp-rank__secondary">{r.secondary}</span>}
                <span className="xp-rank__bar" aria-hidden>
                  <span style={{ width: `${Math.max(3, (r.count / max) * 100)}%` }} />
                </span>
              </span>
              <span className="xp-rank__count tabular">
                {fmtCount(r.count)}
                <span className="visually-hidden"> {plural(r.count, noun[0], noun[1])}</span>
              </span>
              {r.to && <Icon name="chevron" size={16} className="xp-rank__chev" />}
            </>
          );
          return (
            <li key={r.key}>
              {r.to ? (
                <Link to={r.to} className="xp-rank__row xp-rank__row--link" aria-label={r.label}>
                  {body}
                </Link>
              ) : (
                <div className="xp-rank__row">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
      {items.length > initial && (
        <button type="button" className="xp-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Show less' : `Show all ${fmtCount(Math.min(items.length, 100))}`}
          <Icon name="chevron" size={16} className={open ? 'is-open' : undefined} />
        </button>
      )}
    </>
  );
}

export const CodeChip = ({ children, tone }: { children: ReactNode; tone?: 'amber' }) => <span className={`xp-code${tone ? ` xp-code--${tone}` : ''}`}>{children}</span>;

/** Per-year bars (TrendBars from Stats), or a sentence when everything is in one year. */
export function YearChart({ data, noun, caption, currentYear }: { data: YearCount[]; noun: [string, string]; caption: string; currentYear: number }) {
  const chart = useMemo(() => data.map((d) => ({ key: String(d.year), label: String(d.year), value: d.count })), [data]);
  const fmt = useCallback((v: number) => `${fmtCount(v)} ${plural(v, noun[0], noun[1])}`, [noun]);
  if (!data.length) return null;
  if (data.length < 2) {
    return (
      <p className="xp-chart__single">
        All {fmt(data[0].count)} in {data[0].year}
      </p>
    );
  }
  const hl = data.some((d) => d.year === currentYear) ? String(currentYear) : undefined;
  return (
    <div className="xp-chart">
      <TrendBars data={chart} highlightKey={hl} partialKey={hl} formatValue={fmt} label={`${caption}, ${data[0].year}–${data[data.length - 1].year}`} caption={caption} height={64} />
    </div>
  );
}

const FIRST = 12;
const STEP = 40;

/** Flights grouped by year (newest first) with progressive "Show more". */
export function FlightList({ flights, settings }: { flights: Flight[]; settings: Pick<Settings, 'distanceUnit' | 'clock'> }) {
  const [limit, setLimit] = useState(FIRST);
  const groups = useMemo(() => groupFlights(flights), [flights]);
  const shown = useMemo(() => (limit >= flights.length ? groups : limitGroups(groups, limit)), [groups, limit, flights.length]);
  return (
    <div className="xp-flights">
      {shown.map((y) => (
        <div key={y.year} className="xp-year">
          <h3 className="xp-year__head">
            <span className="xp-year__y">{y.year}</span>
            <span className="xp-year__meta">
              {fmtCount(y.count)} {plural(y.count, 'flight')}
              {y.distanceKm > 0 && ` · ${formatDistance(y.distanceKm, settings.distanceUnit)}`}
            </span>
          </h3>
          <div className="flist">
            {y.months.flatMap((m) => m.flights).map((f) => (
              <FlightRow key={f.id} flight={f} unit={settings.distanceUnit} clock={settings.clock} />
            ))}
          </div>
        </div>
      ))}
      {flights.length > limit && (
        <button type="button" className="btn btn--block xp-flights__more" onClick={() => setLimit((l) => l + STEP)}>
          Show more · {fmtCount(flights.length - limit)} left
        </button>
      )}
    </div>
  );
}

export function UpcomingList({ flights, settings }: { flights: Flight[]; settings: Pick<Settings, 'distanceUnit' | 'clock'> }) {
  if (!flights.length) return null;
  return (
    <section className="xp-section animate-in" aria-label="Upcoming flights">
      <h2 className="xp-section__title">
        <span className="xp-pulse" aria-hidden />
        Upcoming
        <span className="xp-section__count">{flights.length}</span>
      </h2>
      <div className="flist">
        {flights.map((f) => (
          <FlightRow key={f.id} flight={f} unit={settings.distanceUnit} clock={settings.clock} />
        ))}
      </div>
    </section>
  );
}

/** Centered empty / error message inside a card. */
export function EmptyCard({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="xp-empty animate-in">
      <span className="xp-empty__icon" aria-hidden>
        <Icon name={icon} size={24} />
      </span>
      <h2 className="xp-empty__title">{title}</h2>
      {children && <p className="xp-empty__text">{children}</p>}
      {action}
    </div>
  );
}

export function PageSkeleton({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <div className="xp" aria-busy="true" aria-label={label}>
      <TopBar onBack={onBack} />
      <div className="xp-hero xp-hero--skeleton">
        <div className="xp-hero__map skeleton" style={{ borderRadius: 0 }} />
        <div className="xp-hero__id">
          <div className="skeleton" style={{ width: 120, height: 48 }} />
          <div className="skeleton" style={{ width: '70%', height: 16, marginTop: 12 }} />
          <div className="skeleton" style={{ width: '45%', height: 14, marginTop: 8 }} />
        </div>
      </div>
    </div>
  );
}
