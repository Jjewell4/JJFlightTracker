import { useId, useMemo } from 'react';
import type { Trip } from '@/lib/trips';
import { placeLabels, tripDrawing } from './trip-geometry';

const W = 640;
const H = 340;

/**
 * The whole trip on a dot-matrix map: legs drawn in order (numbered at their midpoints, to match
 * the itinerary), the home airport, destinations and connections.
 */
export function TripMap({ trip, label }: { trip: Trip; label: string }) {
  const uid = useId().replace(/:/g, '');
  const g = useMemo(() => tripDrawing(trip, W, H, { padding: 0.22, minSpanDeg: 22, dotSpacing: 9.5, bow: 0.1, segments: 64 }), [trip]);
  const labels = useMemo(() => new Map(placeLabels(g, 22, 15).map((l) => [l.ident, l])), [g]);
  const numbered = g.legs.length > 1;
  const stagger = Math.min(0.45, 1.6 / Math.max(1, g.legs.length));

  return (
    <svg className="tmap" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id={`v${uid}`} cx="0.5" cy="0.5" r="0.75">
          <stop offset="0.5" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id={`m${uid}`}>
          <rect width={W} height={H} fill={`url(#v${uid})`} />
        </mask>
      </defs>
      <path d={g.dots} className="tmap__land" mask={`url(#m${uid})`} />

      {g.legs.map((l, i) => (
        <g key={l.n} style={{ '--i': i, '--stagger': `${stagger}s` } as React.CSSProperties}>
          <path d={l.d} className="tmap__glow" />
          <path d={l.d} className="tmap__leg" pathLength={1} />
        </g>
      ))}

      {g.airports.map((a) => (
        <g key={a.ident} className={`tmap__pin tmap__pin--${a.role}`}>
          {a.role !== 'connection' && <circle cx={a.x} cy={a.y} r={13} className="tmap__halo" />}
          <circle cx={a.x} cy={a.y} r={a.role === 'connection' ? 5 : 7} className="tmap__dot" />
        </g>
      ))}

      {g.airports.map((a) => {
        const l = labels.get(a.ident);
        return l ? (
          <text key={a.ident} x={l.x} y={l.y} textAnchor={l.anchor} className={`tmap__label tmap__label--${a.role}`}>
            {a.code}
          </text>
        ) : null;
      })}

      {numbered &&
        g.legs.map((l, i) => l.roomy && (
          <g key={l.n} className="tmap__num" transform={`translate(${l.mid[0].toFixed(1)} ${l.mid[1].toFixed(1)})`} style={{ '--i': i, '--stagger': `${stagger}s` } as React.CSSProperties}>
            <circle r={13} />
            <text y={5}>{l.n}</text>
          </g>
        ))}
    </svg>
  );
}
