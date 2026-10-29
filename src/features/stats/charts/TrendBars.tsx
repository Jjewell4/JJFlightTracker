import { useCallback, useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useMeasuredWidth, useTapOutside } from '../hooks';
import { ChartTooltip } from './ChartTooltip';
import { columnPath } from './scale';

export interface TrendDatum {
  key: string;
  /** Axis label (only the first and last are drawn). */
  label: string;
  value: number;
  /** Tooltip / table heading; defaults to label. */
  title?: string;
}

interface Props {
  data: TrendDatum[];
  formatValue: (v: number) => string;
  /** Accessible name, e.g. "Flights per year, 2015–2026". */
  label: string;
  /** Muted caption centred on the axis, e.g. "flights per year". */
  caption?: string;
  /** Emphasised bar (the current year / month), drawn in amber. */
  highlightKey?: string;
  /** Period still in progress; its tooltip reads "so far". */
  partialKey?: string;
  /** Plot height in px; the value label and axis bands are added to it. */
  height?: number;
}

const TOP_PAD = 18;
const AXIS_H = 20;
const EDGE = 28;

/**
 * Compact single-series bar chart for hero cards: ≤24px bars with 4px rounded tops on a
 * hairline baseline, the peak value direct-labelled, first/last axis labels, and a
 * per-bar hit target (the full band) with a tap / hover / keyboard tooltip.
 */
export function TrendBars({ data, formatValue, label, caption, highlightKey, partialKey, height = 56 }: Props) {
  const [wrapRef, width] = useMeasuredWidth<HTMLDivElement>(300);
  const [active, setActive] = useState<number | null>(null);
  const [focusIdx, setFocusIdx] = useState(0);
  const clear = useCallback(() => setActive(null), []);
  useTapOutside(wrapRef, active !== null, clear);
  const tableId = useId();

  const geo = useMemo(() => {
    const max = Math.max(1, ...data.map((d) => d.value));
    const band = width / Math.max(1, data.length);
    const barW = Math.max(3, Math.min(24, band * 0.64, band - 2));
    const y = (v: number) => TOP_PAD + height - (v / max) * height;
    const peak = data.reduce((best, d, i) => (d.value > (data[best]?.value ?? -1) ? i : best), 0);
    return { band, barW, y, peak, max };
  }, [data, width, height]);

  if (data.length < 2) return null;

  const base = TOP_PAD + height;
  const totalH = base + AXIS_H;
  const xOf = (i: number) => geo.band * i + (geo.band - geo.barW) / 2;
  const a = active !== null ? data[active] : undefined;
  const ax = active !== null ? xOf(active) + geo.barW / 2 : 0;
  const ay = a ? Math.min(geo.y(a.value), base - 4) - 8 : 0;

  const peak = data[geo.peak];
  const peakX = xOf(geo.peak) + geo.barW / 2;
  const [peakLabelX, peakAnchor] = peakX < EDGE ? [xOf(geo.peak), 'start' as const] : peakX > width - EDGE ? [xOf(geo.peak) + geo.barW, 'end' as const] : [peakX, 'middle' as const];

  const move = (e: KeyboardEvent, i: number) => {
    let next = i;
    if (e.key === 'ArrowRight') next = Math.min(data.length - 1, i + 1);
    else if (e.key === 'ArrowLeft') next = Math.max(0, i - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = data.length - 1;
    else if (e.key === 'Escape') return setActive(null);
    else return;
    e.preventDefault();
    setFocusIdx(next);
    setActive(next);
    wrapRef.current?.querySelectorAll<SVGRectElement>('.viz-hit')[next]?.focus();
  };
  const onPointer = (e: PointerEvent, i: number) => {
    if (e.pointerType === 'mouse' || e.type === 'pointerdown') setActive(i);
  };

  return (
    <div ref={wrapRef} className="viz viz--trend" data-active={active !== null || undefined}>
      <svg width={width} height={totalH} role="img" aria-label={label} aria-describedby={tableId} onPointerLeave={(e) => e.pointerType === 'mouse' && clear()}>
        {data.map((d, i) => {
          const x = xOf(i);
          const y = geo.y(d.value);
          const cls = ['viz-col', d.key === highlightKey && 'viz-col--hl', active === i && 'is-active'].filter(Boolean).join(' ');
          return d.value > 0 ? <path key={d.key} className={cls} d={columnPath(x, y, geo.barW, base - y)} style={{ animationDelay: `${Math.min(i * 24, 420)}ms` }} /> : null;
        })}
        <line className="viz-baseline" x1={0} x2={width} y1={base} y2={base} />
        {active === null && peak.value > 0 && (
          <text x={peakLabelX} y={geo.y(peak.value) - 6} textAnchor={peakAnchor} className="viz-cap viz-cap--sm">
            {formatValue(peak.value)}
          </text>
        )}
        <text x={xOf(0)} y={base + 15} textAnchor="start" className={`viz-xlabel${active === 0 ? ' is-active' : ''}`}>
          {data[0].label}
        </text>
        {caption && (
          <text x={width / 2} y={base + 15} textAnchor="middle" className="viz-xlabel viz-xlabel--caption">
            {caption}
          </text>
        )}
        <text x={xOf(data.length - 1) + geo.barW} y={base + 15} textAnchor="end" className={`viz-xlabel${active === data.length - 1 ? ' is-active' : ''}`}>
          {data[data.length - 1].label}
        </text>
        {data.map((d, i) => (
          <rect
            key={d.key}
            className="viz-hit"
            x={geo.band * i}
            y={0}
            width={geo.band}
            height={totalH}
            tabIndex={i === focusIdx ? 0 : -1}
            aria-label={`${d.title ?? d.label}: ${formatValue(d.value)}${d.key === partialKey ? ' so far' : ''}`}
            onPointerEnter={(e) => onPointer(e, i)}
            onPointerMove={(e) => onPointer(e, i)}
            onPointerDown={(e) => onPointer(e, i)}
            onFocus={() => {
              setFocusIdx(i);
              setActive(i);
            }}
            onBlur={clear}
            onKeyDown={(e) => move(e, i)}
          />
        ))}
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
