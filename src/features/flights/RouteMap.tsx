import { useId, useMemo } from 'react';
import { greatCirclePoints } from '@/lib/geo';
import type { Airport } from '@/lib/types';
import { fitView, landDots, toPath } from './projection';
import { usePrefersReducedMotion } from './use-reduced-motion';

const W = 640;
const H = 300;
const PLANE =
  'M10.2 21 12 19.5 13.8 21v-1.5l-1-1.2V13l8.2 3v-2L12.8 9V4.5a.8.8 0 0 0-1.6 0V9L3 14v2l8.2-3v5.3l-1 1.2z';

interface Props {
  from: Airport;
  to: Airport;
  fromLabel: string;
  toLabel: string;
}

/**
 * Self-contained SVG route map: dot-matrix land, great-circle arc and a plane that
 * glides along it (static at mid-route when reduced motion is preferred).
 */
export function RouteMap({ from, to, fromLabel, toLabel }: Props) {
  const reduced = usePrefersReducedMotion();
  const uid = useId().replace(/:/g, '');

  const geo = useMemo(() => {
    const same = from.ident === to.ident;
    const arc = same ? [[from.lon, from.lat] as [number, number]] : greatCirclePoints(from, to, 96);
    const view = fitView(arc, W, H, { padding: 0.2, minSpanDeg: 26 });
    const pts = arc.map(([lon, lat]) => view.project(lon, lat));
    const a = pts[0];
    const b = pts[pts.length - 1];
    // Dots as one path of zero-length round-capped segments — one DOM node for ~1–2k dots.
    const dots = landDots(view, 9.5)
      .map(([x, y]) => `M${x.toFixed(1)} ${y.toFixed(1)}h0`)
      .join('');
    const mid = pts[Math.floor(pts.length / 2)];
    const next = pts[Math.min(pts.length - 1, Math.floor(pts.length / 2) + 1)];
    const prev = pts[Math.max(0, Math.floor(pts.length / 2) - 1)];
    const midAngle = (Math.atan2(next[1] - prev[1], next[0] - prev[0]) * 180) / Math.PI;
    // Label placement: push each label away from the other endpoint.
    const dx = b[0] - a[0];
    const labelA: 'start' | 'end' = dx >= 0 ? 'end' : 'start';
    const labelB: 'start' | 'end' = dx >= 0 ? 'start' : 'end';
    return { path: toPath(pts), a, b, dots, mid, midAngle, labelA, labelB, same };
  }, [from, to]);

  const arcId = `arc-${uid}`;
  const gradId = `grad-${uid}`;
  const vignetteId = `vig-${uid}`;
  const fadeId = `fade-${uid}`;
  const maskId = `mask-${uid}`;
  const labelOffset = (anchor: string) => (anchor === 'end' ? -18 : 18);

  return (
    <svg className="rmap" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Route map from ${fromLabel} to ${toLabel}`} preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1={geo.a[0]} y1={geo.a[1]} x2={geo.b[0]} y2={geo.b[1]}>
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent-2)" />
        </linearGradient>
        <radialGradient id={vignetteId} cx="0.5" cy="0.5" r="0.8">
          <stop offset="0.5" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id={maskId}>
          <rect width={W} height={H} fill={`url(#${vignetteId})`} />
        </mask>
        <radialGradient id={fadeId} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.18" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <g mask={`url(#${maskId})`}>
        <path d={geo.dots} className="rmap__dots" />
      </g>

      {!geo.same && (
        <>
          <ellipse cx={geo.mid[0]} cy={geo.mid[1]} rx={W * 0.32} ry={H * 0.3} fill={`url(#${fadeId})`} />
          <path d={geo.path} className="rmap__glow" stroke={`url(#${gradId})`} />
          <path id={arcId} d={geo.path} className="rmap__arc" stroke={`url(#${gradId})`} pathLength={1} />
        </>
      )}

      <g className="rmap__pin">
        <circle cx={geo.a[0]} cy={geo.a[1]} r={14} className="rmap__halo" />
        <circle cx={geo.a[0]} cy={geo.a[1]} r={7} className="rmap__dot rmap__dot--from" />
      </g>
      {!geo.same && (
        <g className="rmap__pin">
          <circle cx={geo.b[0]} cy={geo.b[1]} r={14} className="rmap__halo rmap__halo--to" />
          <circle cx={geo.b[0]} cy={geo.b[1]} r={7} className="rmap__dot rmap__dot--to" />
        </g>
      )}

      <text x={geo.a[0] + labelOffset(geo.labelA)} y={geo.a[1] + 8} textAnchor={geo.labelA} className="rmap__label">
        {fromLabel}
      </text>
      {!geo.same && (
        <text x={geo.b[0] + labelOffset(geo.labelB)} y={geo.b[1] + 8} textAnchor={geo.labelB} className="rmap__label">
          {toLabel}
        </text>
      )}

      {!geo.same &&
        (reduced ? (
          <g transform={`translate(${geo.mid[0]} ${geo.mid[1]}) rotate(${geo.midAngle})`} className="rmap__plane">
            <path d={PLANE} transform="scale(1.5) rotate(90) translate(-12 -12)" />
          </g>
        ) : (
          <g className="rmap__plane rmap__plane--fly">
            <path d={PLANE} transform="scale(1.5) rotate(90) translate(-12 -12)" />
            <animateMotion dur="7s" begin="0.9s" repeatCount="indefinite" rotate="auto" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.45 0 0.55 1">
              <mpath href={`#${arcId}`} />
            </animateMotion>
            <animate attributeName="opacity" dur="7s" begin="0.9s" repeatCount="indefinite" values="0;1;1;0" keyTimes="0;0.08;0.9;1" />
          </g>
        ))}
    </svg>
  );
}
