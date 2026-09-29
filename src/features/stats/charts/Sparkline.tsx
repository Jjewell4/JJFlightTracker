import { useId } from 'react';
import { useMeasuredWidth } from '../hooks';

/**
 * Decorative trend line (2px stroke, soft wash, end dot) for stat tiles. The values are
 * always available elsewhere on the page, so it is aria-hidden.
 */
export function Sparkline({ values, height = 44 }: { values: number[]; height?: number }) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>(300);
  const gid = useId().replace(/:/g, '');
  if (values.length < 2) return <div ref={ref} style={{ height }} />;
  const max = Math.max(1, ...values);
  const pad = 5;
  const pts = values.map((v, i) => [pad + (i / (values.length - 1)) * (width - pad * 2), pad + (1 - v / max) * (height - pad * 2)] as const);
  // Smooth with a light Catmull-Rom → Bézier conversion.
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const t = 0.18;
    const c1 = [p1[0] + (p2[0] - p0[0]) * t, p1[1] + (p2[1] - p0[1]) * t];
    const c2 = [p2[0] - (p3[0] - p1[0]) * t, p2[1] - (p3[1] - p1[1]) * t];
    d += `C${c1[0]},${Math.min(height - pad, c1[1])} ${c2[0]},${Math.min(height - pad, c2[1])} ${p2[0]},${p2[1]}`;
  }
  const last = pts[pts.length - 1];
  return (
    <div ref={ref} className="viz-spark" aria-hidden>
      <svg width={width} height={height}>
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" className="viz-spark__stop-top" />
            <stop offset="1" className="viz-spark__stop-bottom" />
          </linearGradient>
        </defs>
        <path d={`${d}L${last[0]},${height}L${pts[0][0]},${height}Z`} fill={`url(#${gid})`} />
        <path d={d} className="viz-spark__line" />
        <circle cx={last[0]} cy={last[1]} r={4} className="viz-spark__dot" />
      </svg>
    </div>
  );
}
