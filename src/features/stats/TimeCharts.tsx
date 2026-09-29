import { useMemo, useState } from 'react';
import { MONTH_LABELS, WEEKDAY_LABELS, type FlightStats, type YearScope } from '@/lib/stats';
import { ColumnChart, type ColumnDatum } from './charts/ColumnChart';
import { RadialHourChart } from './charts/RadialHourChart';
import { CardHead, Section, Seg } from './parts';
import { fmtCompact, fmtHour, fmtInt, fmtPct, plural, toUnit, type DistanceUnit } from './format';

type Metric = 'flights' | 'distance' | 'hours';
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const FULL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function TimeCharts({ stats, scope, unit, clock, currentYear }: { stats: FlightStats; scope: YearScope; unit: DistanceUnit; clock: '12h' | '24h'; currentYear: number }) {
  const [metric, setMetric] = useState<Metric>('flights');
  const isAll = scope === 'all';

  const formatMetric = useMemo(() => {
    if (metric === 'distance') return (v: number) => `${fmtInt(v)} ${unit}`;
    if (metric === 'hours') return (v: number) => `${fmtInt(v)} h`;
    return (v: number) => `${fmtInt(v)} ${plural(v, 'flight')}`;
  }, [metric, unit]);
  const formatTick = metric === 'distance' ? (v: number) => fmtCompact(v) : metric === 'hours' ? (v: number) => `${fmtCompact(v)}h` : (v: number) => fmtInt(v);
  const pick = (b: { flights: number; distanceKm: number; durationMin: number }) =>
    metric === 'flights' ? b.flights : metric === 'distance' ? Math.round(toUnit(b.distanceKm, unit)) : Math.round(b.durationMin / 60);

  const timeline: ColumnDatum[] = isAll
    ? stats.byYear.map((y) => ({ key: String(y.year), label: String(y.year), shortLabel: `’${String(y.year).slice(2)}`, value: pick(y) }))
    : stats.byMonth.map((m) => ({ key: String(m.month), label: MONTH_LABELS[m.month - 1].slice(0, 1), value: pick(m), title: `${FULL_MONTHS[m.month - 1]} ${scope}` }));
  const partialKey = isAll ? String(currentYear) : undefined;
  const peak = timeline.reduce<ColumnDatum | undefined>((a, b) => (!a || b.value > a.value ? b : a), undefined);

  const seasonality: ColumnDatum[] = stats.byMonth.map((m) => ({ key: String(m.month), label: MONTH_LABELS[m.month - 1].slice(0, 1), value: m.flights, title: FULL_MONTHS[m.month - 1] }));
  const seasonTotal = seasonality.reduce((a, b) => a + b.value, 0);
  const seasonPeak = seasonality.reduce((a, b) => (b.value > a.value ? b : a), seasonality[0]);
  // Share of flights in Jun–Aug vs Dec–Feb, for a one-line takeaway.
  const summer = [5, 6, 7].reduce((a, i) => a + seasonality[i].value, 0);
  const winter = [11, 0, 1].reduce((a, i) => a + seasonality[i].value, 0);

  const weekdays: ColumnDatum[] = stats.weekday.map((v, i) => ({ key: String(i), label: WEEKDAY_LABELS[i], value: v, title: FULL_DAYS[i] }));
  const weekdayTotal = stats.weekday.reduce((a, b) => a + b, 0);
  const wdPeak = stats.weekday.indexOf(Math.max(...stats.weekday));
  const weekend = stats.weekday[5] + stats.weekday[6];

  const hourTotal = stats.hour.reduce((a, b) => a + b, 0);
  const hourPeak = stats.hour.indexOf(Math.max(...stats.hour));

  const metricNoun = metric === 'flights' ? 'flights' : metric === 'distance' ? unit : 'hours';

  return (
    <Section id="time" title="When you fly">
      <div className="stats-grid stats-grid--time">
        <article className="card stats-card stats-card--wide">
          <CardHead
            title={isAll ? 'Year by year' : 'Month by month'}
            subtitle={
              peak && peak.value > 0 ? (
                <>
                  Peak: <strong>{peak.title ?? peak.label}</strong> · {formatMetric(peak.value)}
                </>
              ) : (
                `No ${metricNoun} yet`
              )
            }
          />
          <Seg
            label="Metric"
            value={metric}
            onChange={setMetric}
            options={[
              { value: 'flights', label: 'Flights' },
              { value: 'distance', label: 'Distance' },
              { value: 'hours', label: 'Hours' },
            ]}
          />
          <ColumnChart
            data={timeline}
            formatValue={formatMetric}
            formatTick={formatTick}
            partialKey={partialKey}
            label={`${isAll ? 'Year by year' : 'Month by month'} ${metricNoun}`}
            height={176}
          />
          {isAll && partialKey && timeline.some((d) => d.key === partialKey) && <p className="stats-card__foot">{currentYear} is shown lighter — the year isn’t over yet.</p>}
        </article>

        {isAll && seasonTotal > 0 && (
          <article className="card stats-card stats-card--col1">
            <CardHead
              title="Seasonality"
              subtitle={
                <>
                  Most flights in <strong>{seasonPeak.title}</strong>
                  {summer + winter > 0 && ` · summer ${fmtPct(summer / seasonTotal)}, winter ${fmtPct(winter / seasonTotal)}`}
                </>
              }
            />
            <ColumnChart data={seasonality} formatValue={(v) => `${fmtInt(v)} ${plural(v, 'flight')}`} formatTick={fmtInt} label="Flights by month of year" height={132} tone="amber" />
          </article>
        )}

        {weekdayTotal > 0 && (
          <article className="card stats-card stats-card--col1">
            <CardHead
              title="Day of the week"
              subtitle={
                <>
                  <strong>{FULL_DAYS[wdPeak]}s</strong> lead · weekends {fmtPct(weekend / weekdayTotal)}
                </>
              }
            />
            <ColumnChart data={weekdays} formatValue={(v) => `${fmtInt(v)} ${plural(v, 'flight')}`} formatTick={fmtInt} label="Flights by day of week" height={132} />
          </article>
        )}

        {hourTotal > 0 && (
          <article className="card stats-card stats-card--tall">
            <CardHead
              title="Departure time"
              subtitle={
                <>
                  Local time at origin · busiest at <strong>{fmtHour(hourPeak, clock)}</strong>
                </>
              }
            />
            <RadialHourChart hours={stats.hour} clock={clock} label="Departures by hour of day" />
            <p className="stats-card__foot">
              {fmtPct(stats.hour.slice(0, 12).reduce((a, b) => a + b, 0) / hourTotal)} before noon · {fmtInt(hourTotal)} {plural(hourTotal, 'flight')} with a departure time
            </p>
          </article>
        )}
      </div>
    </Section>
  );
}
