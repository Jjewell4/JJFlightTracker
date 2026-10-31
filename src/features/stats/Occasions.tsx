import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { getAirport } from '@/data/reference';
import { airportCode } from '@/lib/flight-utils';
import { OCCASION_ICON, OCCASION_LABELS } from '@/lib/occasions';
import type { FlightStats } from '@/lib/stats';
import type { FlightOccasion } from '@/lib/types';
import { TrendBars } from './charts/TrendBars';
import { CardHead, Section, Seg } from './parts';
import { fmtDistance, fmtDistanceCompact, fmtInt, fmtPct, plural, type DistanceUnit } from './format';

type Metric = 'trips' | 'flights' | 'distance';

/**
 * Occasions: what the trips were for, ranked by trips, flights or distance. Each row opens the
 * story behind it — trips per year, where they went, and (for the owner) the flights.
 */
export function Occasions({ stats, unit, readOnly = false }: { stats: FlightStats; unit: DistanceUnit; readOnly?: boolean }) {
  const [metric, setMetric] = useState<Metric>('trips');
  const [open, setOpen] = useState<FlightOccasion | null>(null);
  const { occasion, occasionDetails: details } = stats;
  const value = (k: FlightOccasion) => {
    const d = details[k];
    if (!d) return 0;
    return metric === 'trips' ? d.trips : metric === 'flights' ? d.flights : d.distanceKm;
  };
  const rows = occasion.items.filter((it) => it.count > 0).sort((a, b) => value(b.key) - value(a.key) || b.count - a.count);
  const max = Math.max(1, ...rows.map((r) => value(r.key)));
  const fmtValue = (k: FlightOccasion) => (metric === 'distance' ? fmtDistanceCompact(value(k), unit) : fmtInt(value(k)));

  if (!rows.length) {
    if (readOnly) return null;
    return (
      <Section id="occasions" title="Occasions">
        <article className="card stats-card">
          <CardHead title="What your trips were for" subtitle="Tag trips as vacation, wedding, conference… from each trip’s page" />
        </article>
      </Section>
    );
  }

  return (
    <Section id="occasions" title="Occasions">
      <article className="card stats-card stats-occasions">
        <CardHead title="What your trips were for" subtitle={`${fmtInt(occasion.known)} tagged ${plural(occasion.known, 'trip')} · a trip counts once per occasion`} />
        <Seg
          label="Rank occasions by"
          value={metric}
          onChange={setMetric}
          options={[
            { value: 'trips', label: 'Trips' },
            { value: 'flights', label: 'Flights' },
            { value: 'distance', label: 'Distance' },
          ]}
        />
        <ol className="stats-rank__list stats-occ__list">
          {rows.map((it) => {
            const d = details[it.key];
            const expanded = open === it.key;
            return (
              <li key={it.key}>
                <button type="button" className="stats-occ__row" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : it.key)}>
                  <span className="stats-occ__icon" aria-hidden>
                    <Icon name={OCCASION_ICON[it.key]} size={20} />
                  </span>
                  <span className="stats-rank__text">
                    <span className="stats-rank__primary">{it.label}</span>
                    <span className="stats-rank__secondary">
                      {metric === 'trips' ? `${fmtPct(it.share)} of tagged trips` : `${fmtInt(d?.trips ?? 0)} ${plural(d?.trips ?? 0, 'trip')}`}
                    </span>
                    <span className="stats-rank__bar" aria-hidden>
                      <span style={{ width: `${Math.max(2, (value(it.key) / max) * 100)}%` }} />
                    </span>
                  </span>
                  <span className="stats-rank__count">{fmtValue(it.key)}</span>
                  <Icon name="chevron" size={16} className={`stats-occ__chev${expanded ? ' is-open' : ''}`} />
                </button>
                {expanded && d && <OccasionPanel occasion={it.key} detail={d} unit={unit} readOnly={readOnly} />}
              </li>
            );
          })}
        </ol>
      </article>
    </Section>
  );
}

function OccasionPanel({
  occasion,
  detail: d,
  unit,
  readOnly,
}: {
  occasion: FlightOccasion;
  detail: NonNullable<FlightStats['occasionDetails'][FlightOccasion]>;
  unit: DistanceUnit;
  readOnly: boolean;
}) {
  const label = OCCASION_LABELS[occasion].toLowerCase();
  const peak = d.byYear.reduce((a, b) => (b.trips > a.trips ? b : a), d.byYear[0]);
  return (
    <div className="stats-occ__panel">
      <dl className="stats-occ__facts">
        <div>
          <dt>Trips</dt>
          <dd>{fmtInt(d.trips)}</dd>
        </div>
        <div>
          <dt>Flights</dt>
          <dd>{fmtInt(d.flights)}</dd>
        </div>
        <div>
          <dt>Distance</dt>
          <dd>{fmtDistance(d.distanceKm, unit)}</dd>
        </div>
      </dl>
      {d.byYear.length > 1 && (
        <div className="stats-occ__trend">
          <TrendBars
            data={d.byYear.map((y) => ({ key: String(y.year), label: `’${String(y.year).slice(2)}`, value: y.trips, title: String(y.year) }))}
            highlightKey={String(peak.year)}
            formatValue={(v) => `${fmtInt(v)} ${plural(v, 'trip')}`}
            label={`${OCCASION_LABELS[occasion]} trips per year`}
            caption="trips per year"
            height={44}
          />
        </div>
      )}
      {d.places.length > 0 && (
        <p className="stats-occ__places">
          <span className="stats-occ__label">Where to</span>
          {d.places.slice(0, 4).map((p) => {
            const a = getAirport(p.ident);
            return (
              <span key={p.ident} className="stats-occ__place">
                <span className="stats-code">{airportCode(p.ident)}</span> {a?.city || a?.name || ''}
                {p.count > 1 && <span className="stats-occ__times"> ×{p.count}</span>}
              </span>
            );
          })}
        </p>
      )}
      {!readOnly && (
        <Link to={`/?occasion=${occasion}`} className="stats-occ__link">
          See your {label} flights <Icon name="chevron" size={14} />
        </Link>
      )}
    </div>
  );
}
