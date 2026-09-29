import type { ReactNode } from 'react';

/**
 * Floating readout for charts. Value leads (strong), label follows (secondary).
 * `x`/`y` are in the wrapper's pixel space; the tooltip centers on x and sits above y,
 * clamped horizontally to [0, width].
 */
export function ChartTooltip({ x, y, width, value, label, visible }: { x: number; y: number; width: number; value: ReactNode; label: ReactNode; visible: boolean }) {
  const half = 70;
  const left = Math.max(half, Math.min(width - half, x));
  return (
    <div className="viz-tip" data-visible={visible || undefined} style={{ left, top: y }} role="status" aria-live="polite">
      <div className="viz-tip__value">{value}</div>
      <div className="viz-tip__label">{label}</div>
    </div>
  );
}
