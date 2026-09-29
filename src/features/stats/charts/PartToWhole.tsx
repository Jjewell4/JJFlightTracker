import { useCallback, useRef, useState } from 'react';
import { useTapOutside } from '../hooks';
import { fmtInt, fmtPct } from '../format';
import { arcPath } from './scale';

export interface PartItem {
  key: string;
  label: string;
  count: number;
  /**
   * Categorical slot (1–6) — fixed per category so a color always means the same
   * thing, even when other categories are empty or filtered out.
   */
  slot: number;
}

function useActive() {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | null>(null);
  const clear = useCallback(() => setActive(null), []);
  useTapOutside(ref, active !== null, clear);
  return { ref, active, setActive, clear };
}

function Legend({ items, total, active, setActive, unknown, format = fmtInt }: { items: PartItem[]; total: number; active: string | null; setActive: (k: string | null) => void; unknown?: number; format?: (n: number) => string }) {
  return (
    <ul className="viz-legend">
      {items.map((it) => (
        <li key={it.key}>
          <button
            type="button"
            className="viz-legend__row"
            data-active={active === it.key || undefined}
            data-dim={(active !== null && active !== it.key) || undefined}
            onClick={() => setActive(active === it.key ? null : it.key)}
            onMouseEnter={() => setActive(it.key)}
            onMouseLeave={() => setActive(null)}
          >
            <span className={`viz-swatch viz-s${it.slot}`} aria-hidden />
            <span className="viz-legend__label">{it.label}</span>
            <span className="viz-legend__count">{format(it.count)}</span>
            <span className="viz-legend__pct">{fmtPct(total ? it.count / total : 0)}</span>
          </button>
        </li>
      ))}
      {!!unknown && (
        <li className="viz-legend__unknown">
          {fmtInt(unknown)} not recorded
        </li>
      )}
    </ul>
  );
}

/** Horizontal 100% bar (segments separated by a 2px surface gap) with a legend below. */
export function SegmentBar({ items, unknown, label, format }: { items: PartItem[]; unknown?: number; label: string; format?: (n: number) => string }) {
  const { ref, active, setActive } = useActive();
  const shown = items.filter((i) => i.count > 0);
  const total = shown.reduce((a, b) => a + b.count, 0);
  if (!total) return <p className="viz-empty">Not recorded yet</p>;
  return (
    <div ref={ref} className="viz-seg" data-active={active !== null || undefined}>
      <div className="viz-seg__bar" role="img" aria-label={`${label}: ${shown.map((i) => `${i.label} ${i.count}`).join(', ')}`}>
        {shown.map((it) => (
          <span
            key={it.key}
            className={`viz-seg__part viz-s${it.slot}${active === it.key ? ' is-active' : ''}`}
            style={{ flexGrow: it.count }}
            onPointerDown={() => setActive(it.key)}
            onPointerEnter={(e) => e.pointerType === 'mouse' && setActive(it.key)}
            onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
          />
        ))}
      </div>
      <Legend items={shown} total={total} active={active} setActive={setActive} unknown={unknown} format={format} />
    </div>
  );
}

/** Thin ring for part-to-whole at a glance (≤6 segments), center shows the focused slice. */
export function Donut({ items, unknown, label, size = 124 }: { items: PartItem[]; unknown?: number; label: string; size?: number }) {
  const { ref, active, setActive } = useActive();
  const shown = items.filter((i) => i.count > 0);
  const total = shown.reduce((a, b) => a + b.count, 0);
  if (!total) return <p className="viz-empty">Not recorded yet</p>;
  const cx = size / 2;
  const R = size / 2 - 2;
  const thick = 14;
  const gap = shown.length > 1 ? 2.5 / (R - thick / 2) : 0; // 2px surface gap at mid-radius
  let acc = 0;
  const arcs = shown.map((it) => {
    const a0 = (acc / total) * Math.PI * 2;
    acc += it.count;
    const a1 = (acc / total) * Math.PI * 2;
    const g = Math.min(gap / 2, (a1 - a0) / 4);
    return { it, d: arcPath(cx, cx, R - thick, R, a0 + g, a1 - g), hit: arcPath(cx, cx, R - thick - 10, R + 2, a0, a1) };
  });
  const focus = shown.find((i) => i.key === active) ?? [...shown].sort((a, b) => b.count - a.count)[0];
  return (
    <div ref={ref} className="viz-donut" data-active={active !== null || undefined}>
      <svg width={size} height={size} role="img" aria-label={`${label}: ${shown.map((i) => `${i.label} ${i.count}`).join(', ')}`}>
        {arcs.map(({ it, d, hit }) => (
          <g key={it.key}>
            <path className={`viz-arc viz-s${it.slot}${active === it.key ? ' is-active' : ''}`} d={d} />
            <path
              className="viz-hit"
              d={hit}
              onPointerDown={() => setActive(it.key)}
              onPointerEnter={(e) => e.pointerType === 'mouse' && setActive(it.key)}
              onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
            />
          </g>
        ))}
        <text x={cx} y={cx + 2} textAnchor="middle" className="viz-donut__value">
          {fmtPct(focus.count / total)}
        </text>
        <text x={cx} y={cx + 20} textAnchor="middle" className="viz-donut__label">
          {focus.label.length > 14 ? focus.label.split(' ')[0] : focus.label}
        </text>
      </svg>
      <Legend items={shown} total={total} active={active} setActive={setActive} unknown={unknown} />
    </div>
  );
}
