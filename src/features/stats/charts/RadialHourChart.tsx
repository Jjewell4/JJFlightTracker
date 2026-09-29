import { useCallback, useId, useMemo, useState, type PointerEvent } from 'react';
import { useMeasuredWidth, useTapOutside } from '../hooks';
import { fmtHour, fmtInt, plural } from '../format';
import { arcPath, polar } from './scale';

interface Props {
  /** 24 counts, index = local departure hour. */
  hours: number[];
  clock?: '12h' | '24h';
  label: string;
}

/**
 * 24-hour "clock" of departures: one radial bar per hour (midnight at 12 o'clock),
 * hairline rings for scale, peak hour called out in the center. Each hour's full
 * sector is the hit target so thin bars are easy to tap.
 */
export function RadialHourChart({ hours, clock = '12h', label }: Props) {
  const [wrapRef, width] = useMeasuredWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const clear = useCallback(() => setActive(null), []);
  useTapOutside(wrapRef, active !== null, clear);
  const tableId = useId();

  const size = Math.min(width, 320);
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 22; // room for hour labels
  const r0 = R * 0.46;
  const total = hours.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...hours);
  const peak = hours.indexOf(Math.max(...hours));
  const step = (Math.PI * 2) / 24;
  const pad = 0;
  // Constant-width rounded spokes (thin marks) sized to the inner ring's circumference.
  const spokeW = Math.max(4, Math.min(8, ((2 * Math.PI * r0) / 24) * 0.5));

  const bars = useMemo(
    () =>
      hours.map((v, h) => {
        const a0 = h * step + pad;
        const a1 = (h + 1) * step - pad;
        const r = v > 0 ? r0 + 8 + (R - r0 - 12) * (v / max) : 0;
        const mid = (a0 + a1) / 2;
        const [x1, y1] = polar(cx, cy, r0 + 8, mid);
        const [x2, y2] = polar(cx, cy, r, mid);
        return { h, v, spoke: { x1, y1, x2, y2 }, hit: arcPath(cx, cy, r0 * 0.6, R + 20, h * step, (h + 1) * step) };
      }),
    [hours, step, pad, r0, R, max, cx, cy],
  );

  const onPointer = (e: PointerEvent, h: number) => {
    if (e.pointerType === 'mouse' || e.type === 'pointerdown') setActive(h);
  };
  const shown = active ?? (total ? peak : null);
  const range = (h: number) => `${fmtHour(h, clock)}–${fmtHour((h + 1) % 24, clock)}`;

  return (
    <div ref={wrapRef} className="viz viz--accent viz-radial" data-active={active !== null || undefined}>
      <svg width={size} height={size} role="img" aria-label={label} aria-describedby={tableId} onPointerLeave={(e) => e.pointerType === 'mouse' && clear()}>
        {[0.5, 1].map((f) => (
          <circle key={f} className="viz-ring" cx={cx} cy={cy} r={r0 + 8 + (R - r0 - 12) * f} />
        ))}
        <circle className="viz-ring" cx={cx} cy={cy} r={r0} />
        {[0, 6, 12, 18].map((h) => {
          const [x, y] = polar(cx, cy, R + 12, h * step);
          return (
            <text key={h} x={x} y={y + 4} textAnchor="middle" className="viz-tick viz-tick--strong">
              {clock === '24h' ? String(h).padStart(2, '0') : h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`}
            </text>
          );
        })}
        {bars.map((b) => (
          <g key={b.h}>
            {b.v > 0 && (
              <line
                className={`viz-col viz-spoke${active === b.h ? ' is-active' : ''}`}
                {...b.spoke}
                strokeWidth={spokeW}
                style={{ animationDelay: `${b.h * 18}ms` }}
              />
            )}
            <path
              className="viz-hit"
              d={b.hit}
              tabIndex={0}
              aria-label={`${range(b.h)}: ${b.v} ${plural(b.v, 'departure')}`}
              onPointerEnter={(e) => onPointer(e, b.h)}
              onPointerMove={(e) => onPointer(e, b.h)}
              onPointerDown={(e) => onPointer(e, b.h)}
              onFocus={() => setActive(b.h)}
              onBlur={clear}
            />
          </g>
        ))}
        {shown !== null && (
          <g className="viz-radial__center" aria-hidden>
            <text x={cx} y={cy - 12} textAnchor="middle" className="viz-radial__kicker">
              {active === null ? 'Peak' : 'Departures'}
            </text>
            <text x={cx} y={cy + 12} textAnchor="middle" className="viz-radial__value">
              {active === null ? fmtHour(shown, clock) : fmtInt(hours[shown])}
            </text>
            <text x={cx} y={cy + 30} textAnchor="middle" className="viz-radial__sub">
              {active === null ? `${fmtInt(hours[shown])} ${plural(hours[shown], 'departure')}` : range(shown)}
            </text>
          </g>
        )}
      </svg>
      <table id={tableId} className="visually-hidden">
        <caption>{label}</caption>
        <tbody>
          {hours.map((v, h) => (
            <tr key={h}>
              <th scope="row">{range(h)}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
