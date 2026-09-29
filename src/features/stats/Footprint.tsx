import { CABIN_LABELS, CO2_BANDS, CO2_CABIN_MULTIPLIER, type FlightStats } from '@/lib/stats';
import type { CabinClass } from '@/lib/types';
import { Icon } from '@/components/Icon';
import { SegmentBar } from './charts/PartToWhole';
import { CardHead, Section } from './parts';
import { fmtInt, fmtPct, fmtTonnes } from './format';

/** Global average CO₂ per person per year (fossil + industry, ~2023). */
const PER_CAPITA_T = 4.7;
/** Rough CO₂ uptake of one mature tree per year. */
const TREE_KG_PER_YEAR = 22;

export function Footprint({ stats }: { stats: FlightStats }) {
  const { totals, emissions } = stats;
  if (!(totals.co2Kg > 0)) return null;
  const t = totals.co2Kg / 1000;
  const perKm = totals.distanceKm ? totals.co2Kg / totals.distanceKm : 0;
  const premiumKg = emissions.byCabin.premium + emissions.byCabin.business + emissions.byCabin.first + emissions.byCabin.private;
  const premiumFlights = stats.cabin.items.filter((i) => i.key !== 'economy').reduce((a, b) => a + b.count, 0);
  const longShare = emissions.byHaul.long / totals.co2Kg;
  const longFlightShare = stats.haul.known ? stats.haul.items[2].count / stats.haul.known : 0;

  return (
    <Section id="footprint" title="Footprint">
      <article className="card stats-card stats-footprint">
        <div className="stats-footprint__main">
          <CardHead
            title="Estimated CO₂"
            subtitle="Your per-passenger share of each flight"
            right={<Icon name="sparkle" size={20} className="stats-footprint__icon" />}
          />
          <p className="stats-footprint__value">
            {fmtTonnes(totals.co2Kg)}
            <span className="stats-footprint__unit">t CO₂</span>
          </p>
          <p className="stats-footprint__sub">≈ {perKm.toFixed(2)} kg per passenger-km</p>
          <ul className="stats-footprint__eq">
            <li>
              <strong>{t / PER_CAPITA_T >= 10 ? fmtInt(t / PER_CAPITA_T) : (t / PER_CAPITA_T).toFixed(1)}</strong>
              <span>years of an average person’s total emissions</span>
            </li>
            <li>
              <strong>{fmtInt(totals.co2Kg / TREE_KG_PER_YEAR)}</strong>
              <span>trees growing for a year to absorb it</span>
            </li>
          </ul>
        </div>
        <div className="stats-footprint__side">
          <SegmentBar
            label="CO₂ by flight length"
            items={[
              {
                key: 'short',
                label: 'Short-haul',
                count: Math.round(emissions.byHaul.short),
                slot: 1,
              },
              {
                key: 'medium',
                label: 'Medium-haul',
                count: Math.round(emissions.byHaul.medium),
                slot: 2,
              },
              {
                key: 'long',
                label: 'Long-haul',
                count: Math.round(emissions.byHaul.long),
                slot: 3,
              },
            ]}
            format={(kg) => `${fmtTonnes(kg)} t`}
          />
          {(longShare > 0.05 || premiumKg > 0) && (
            <p className="stats-card__foot">
              {longShare > 0.05 && `Long-haul is ${fmtPct(longFlightShare)} of flights but ${fmtPct(longShare)} of emissions. `}
              {premiumKg > 0 && `Premium cabins: ${fmtPct(premiumFlights / Math.max(1, stats.cabin.known))} of flights, ${fmtPct(premiumKg / totals.co2Kg)} of CO₂.`}
            </p>
          )}
          <details className="stats-method">
            <summary>How this is estimated</summary>
            <p>
              Each flight’s great-circle distance × an economy factor for its length (
              {CO2_BANDS.map((b, i) => (
                <span key={b.id}>
                  {i > 0 && ', '}
                  {b.label.toLowerCase()} {b.kgPerKm} kg/km
                </span>
              ))}
              ) × a cabin multiplier (
              {(Object.keys(CO2_CABIN_MULTIPLIER) as CabinClass[]).map((c, i) => (
                <span key={c}>
                  {i > 0 && ', '}
                  {CABIN_LABELS[c].toLowerCase()} {CO2_CABIN_MULTIPLIER[c]}×
                </span>
              ))}
              ). Factors are rounded from ICAO and UK DEFRA per-passenger figures; flights without a cabin count as economy. This is CO₂ only — non-CO₂ effects such as
              contrails roughly double aviation’s warming impact.
            </p>
          </details>
        </div>
      </article>
    </Section>
  );
}
