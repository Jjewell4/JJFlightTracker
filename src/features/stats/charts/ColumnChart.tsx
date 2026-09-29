import { useCallback, useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useMeasuredWidth, useTapOutside } from '../hooks';
import { ChartTooltip } from './ChartTooltip';
import { columnPath, niceTicks } from './scale';

export interface ColumnDatum {
  key: string;
  /** Axis label. */
  label: string;
  /** Used instead of `label` when the axis is crowded (e.g. "’19"). */
  shortLabel?: string;
  value: number;
  /** Tooltip heading; defaults to label. */
  title?: string;
}

interface Props {
  data: ColumnDatum[];
  formatValue: (v: number) => string;
  formatTick?: (v: number) => string;
  /** Plot height in px (axis band is added on top of this). */
  height?: number;
  /** Rendered lighter with a "so far" note (e.g. the current, incomplete year). */
  partialKey?: string;
  /** Label the tallest column with its value. */
  labelMax?: boolean;
  /** Accessible name for the chart (the card title). */
  label: string;
  /** Series color class suffix: 'accent' (default) or 'amber'. */
  tone?: 'accent' | 'amber';
}

const AXIS_H = 26;

/** Keeps the direct label on the tallest column inside the plot near the edges. */
function capAnchor(x: number, w: number, plotW: number): [number, 'start' | 'middle' | 'end'] {
  const c = x + w / 2;
  if (c < 36) return [x, 'start'];
  if (c > plotW - 36) return [x + w, 'end'];
  return [c, 'middle'];
}
const TOP_PAD = 22;
const RIGHT_PAD = 34;

/**
 * Responsive single-series column chart: hairline grid with right-aligned ticks,
 * ≤24px columns with 4px rounded caps, tallest column direct-labelled, and a
 * per-column hit target (full band) that shows a tooltip on hover, tap or focus.
 */
export function ColumnChart({ data, formatValue, formatTick = formatValue, height = 168, partialKey, labelMax = true, label, tone = 'accent' }: Props) {
  const [wrapRef, width] = useMeasuredWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const clear = useCallback(() => setActive(null), []);
  useTapOutside(wrapRef, active !== null, clear);
  const tableId = useId();

  const geo = useMemo(() => {
    const max = Math.max(0, ...data.map((d) => d.value));
    const ticks = niceTicks(max * 1.12, 3); // headroom for the direct label
    const top = ticks[ticks.length - 1] || 1;
    const plotW = Math.max(40, width - RIGHT_PAD);
    const band = plotW / Math.max(1, data.length);
    const barW = Math.max(3, Math.min(24, band * 0.62, band - 2));
    const y = (v: number) => TOP_PAD + height - (v / top) * height;
    const maxIdx = max > 0 ? data.findIndex((d) => d.value === max) : -1;
    // Show every k-th label so labels never collide (~30px per label).
    const longest = (short: boolean) => Math.max(1, ...data.map((d) => (short ? (d.shortLabel ?? d.label) : d.label).length));
    const useShort = band < longest(false) * 7 + 8 && data.some((d) => d.shortLabel);
    const minLabelW = longest(useShort) * 7 + 8;
    const every = Math.max(1, Math.ceil(minLabelW / band));
    return { ticks, band, barW, y, maxIdx, every, useShort, plotW };
  }, [data, width, height]);

  const totalH = TOP_PAD + height + AXIS_H;
  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key === 'ArrowRight') setActive(Math.min(data.length - 1, i + 1));
    if (e.key === 'ArrowLeft') setActive(Math.max(0, i - 1));
    if (e.key === 'Escape') setActive(null);
  };
  const focusBar = (i: number) => {
    const el = wrapRef.current?.querySelectorAll<SVGRectElement>('.viz-hit')[i];
    el?.focus();
  };
  const onPointer = (e: PointerEvent, i: number) => {
    if (e.pointerType === 'mouse' || e.type === 'pointerdown') setActive(i);
  };

  const a = active !== null ? data[active] : undefined;
  const ax = active !== null ? geo.band * active + geo.band / 2 : 0;
  const ay = a ? Math.min(geo.y(a.value), TOP_PAD + height - 4) - 8 : 0;

  return (
    <div ref={wrapRef} className={`viz viz--${tone}`} data-active={active !== null || undefined}>
      <svg width={width} height={totalH} role="img" aria-label={label} aria-describedby={tableId} onPointerLeave={(e) => e.pointerType === 'mouse' && clear()}>
        {geo.ticks.map((t) => (
          <g key={t} className="viz-grid">
            <line x1={0} x2={width} y1={geo.y(t)} y2={geo.y(t)} />
            {t > 0 && (
              <text x={width} y={geo.y(t) - 5} textAnchor="end" className="viz-tick">
                {formatTick(t)}
              </text>
            )}
          </g>
        ))}
        {data.map((d, i) => {
          const x = geo.band * i + (geo.band - geo.barW) / 2;
          const y = geo.y(d.value);
          const h = TOP_PAD + height - y;
          const isActive = active === i;
          const cls = ['viz-col', d.key === partialKey && 'viz-col--partial', isActive && 'is-active'].filter(Boolean).join(' ');
          return (
            <g key={d.key}>
              {d.value > 0 && <path className={cls} d={columnPath(x, y, geo.barW, h)} style={{ animationDelay: `${Math.min(i * 28, 500)}ms` }} />}
              {labelMax && i === geo.maxIdx && active === null && (
                <text x={capAnchor(x, geo.barW, geo.plotW)[0]} y={y - 7} textAnchor={capAnchor(x, geo.barW, geo.plotW)[1]} className="viz-cap">
                  {formatValue(d.value)}
                </text>
              )}
              {(i % geo.every === 0 || (i === data.length - 1 && (data.length - 1) % geo.every > geo.every / 2)) && (
                <text x={geo.band * i + geo.band / 2} y={TOP_PAD + height + 18} textAnchor="middle" className={`viz-xlabel${isActive ? ' is-active' : ''}`}>
                  {geo.useShort ? (d.shortLabel ?? d.label) : d.label}
                </text>
              )}
              <rect
                className="viz-hit"
                x={geo.band * i}
                y={0}
                width={geo.band}
                height={TOP_PAD + height + AXIS_H}
                tabIndex={0}
                aria-label={`${d.title ?? d.label}: ${formatValue(d.value)}`}
                onPointerEnter={(e) => onPointer(e, i)}
                onPointerMove={(e) => onPointer(e, i)}
                onPointerDown={(e) => onPointer(e, i)}
                onFocus={() => setActive(i)}
                onBlur={clear}
                onKeyDown={(e) => {
                  onKey(e, i);
                  if (e.key === 'ArrowRight') focusBar(Math.min(data.length - 1, i + 1));
                  if (e.key === 'ArrowLeft') focusBar(Math.max(0, i - 1));
                }}
              />
            </g>
          );
        })}
        <line className="viz-baseline" x1={0} x2={geo.plotW} y1={TOP_PAD + height} y2={TOP_PAD + height} />
      </svg>
      <ChartTooltip
        visible={!!a}
        x={ax}
        y={ay}
        width={width}
        value={a ? formatValue(a.value) : ''}
        label={a ? `${a.title ?? a.label}${a.key === partialKey ? ' · so far' : ''}` : ''}
      />
      <table id={tableId} className="visually-hidden">
        <caption>{label}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.key}>
              <th scope="row">{d.title ?? d.label}</th>
              <td>{formatValue(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
