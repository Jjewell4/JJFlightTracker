import type { Breakdown, FlightStats } from '@/lib/stats';
import { Donut, SegmentBar, type PartItem } from './charts/PartToWhole';
import { CardHead, Section } from './parts';
import { RankList } from './TopLists';
import { Icon } from '@/components/Icon';
import { OCCASION_ICON } from '@/lib/occasions';
import { fmtDistance, fmtInt, fmtPct, type DistanceUnit } from './format';
import type { StatsSections } from './sections';

/** Slot = the category's fixed position in its own order, so colors never shift. */
function toParts<K extends string>(b: Breakdown<K>, labels?: Partial<Record<K, string>>): PartItem[] {
  return b.items.map((it, i) => ({ key: it.key, label: labels?.[it.key] ?? it.label, count: it.count, slot: i + 1 }));
}

export function Breakdowns({ stats, unit, sections, readOnly = false }: { stats: FlightStats; unit: DistanceUnit; sections: StatsSections; readOnly?: boolean }) {
  const { scope, cabin, seat, reason, occasion, haul, manufacturer, totals } = stats;
  const boeing = manufacturer.items[0].count;
  const airbus = manufacturer.items[1].count;
  const avg = totals.avgDistanceKm;
  const topSeat = [...seat.items].sort((a, b) => b.count - a.count)[0];
  const topReason = [...reason.items].sort((a, b) => b.count - a.count)[0];
  const haulLabels = {
    short: `Short · under ${unit === 'mi' ? '930 mi' : '1,500 km'}`,
    medium: 'Medium',
    long: `Long · over ${unit === 'mi' ? '2,485 mi' : '4,000 km'}`,
  };

  return (
    <Section id="how" title={readOnly ? 'Flight mix' : 'How you fly'}>
      <div className="stats-grid">
        <article className="card stats-card">
          <CardHead
            title="Domestic vs international"
            subtitle={scope.known ? `${fmtPct(scope.items[1].share)} of flights crossed a border` : 'Needs known airports'}
          />
          <SegmentBar items={toParts(scope)} unknown={scope.unknown} label="Domestic vs international" />
        </article>

        <article className="card stats-card">
          <CardHead title="Flight length" subtitle={haul.known ? `Average flight ${fmtDistance(avg, unit)}` : 'Needs known airports'} />
          <SegmentBar items={toParts(haul, haulLabels)} unknown={haul.unknown} label="Flight length" />
        </article>

        {sections.cabin && (
          <article className="card stats-card">
            <CardHead title="Cabin class" subtitle={cabin.known ? `${fmtInt(cabin.known)} flights with a recorded cabin` : 'Add a cabin class to your flights'} />
            <Donut items={toParts(cabin, { premium: 'Premium' })} unknown={cabin.unknown} label="Cabin class" />
          </article>
        )}

        {sections.seat && (
          <article className="card stats-card">
            <CardHead title="Seat" subtitle={seat.known && topSeat ? `${topSeat.label} wins ${fmtPct(topSeat.share)} of the time` : 'Add seat types to your flights'} />
            <SegmentBar items={toParts(seat)} unknown={seat.unknown} label="Seat type" />
          </article>
        )}

        {sections.reason && (
          <article className="card stats-card">
            <CardHead title="Reason" subtitle={reason.known && topReason ? `Mostly ${topReason.label.toLowerCase()} · ${fmtPct(topReason.share)}` : 'Add a reason to your flights'} />
            <SegmentBar items={toParts(reason)} unknown={reason.unknown} label="Reason for flying" />
          </article>
        )}

        {sections.occasion && occasion.known > 0 && (
          <RankList
            title="Occasions"
            subtitle={`${fmtInt(occasion.known)} tagged ${occasion.known === 1 ? 'flight' : 'flights'}`}
            noun={['flight', 'flights']}
            rows={occasion.items
              .filter((it) => it.count > 0)
              .sort((a, b) => b.count - a.count)
              .map((it) => ({
                key: it.key,
                lead: <Icon name={OCCASION_ICON[it.key]} size={20} className="stats-occasion__icon" />,
                primary: it.label,
                secondary: fmtPct(it.share),
                count: it.count,
                href: readOnly ? undefined : `/?occasion=${it.key}`,
              }))}
          />
        )}
        {sections.occasion && occasion.known === 0 && !readOnly && (
          <article className="card stats-card">
            <CardHead title="Occasions" subtitle="Tag flights as vacation, wedding, conference… under More details" />
          </article>
        )}

        {/* Visitors only see charts with data; the owner gets the "add aircraft" prompt. */}
        {(!readOnly || manufacturer.known > 0) && (
          <article className="card stats-card">
            <CardHead
              title="Boeing or Airbus?"
              subtitle={
                boeing + airbus === 0
                  ? manufacturer.known
                    ? 'Neither, so far'
                    : 'Add aircraft types to your flights'
                  : boeing === airbus
                    ? 'A perfect tie'
                    : `${boeing > airbus ? 'Boeing' : 'Airbus'} leads by ${fmtInt(Math.abs(boeing - airbus))} ${Math.abs(boeing - airbus) === 1 ? 'flight' : 'flights'}`
              }
            />
            <SegmentBar items={toParts(manufacturer)} unknown={manufacturer.unknown} label="Aircraft manufacturer" />
          </article>
        )}
      </div>
    </Section>
  );
}
