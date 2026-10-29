import { useId, useMemo } from 'react';
import { fitView, landDots, toPath } from '@/features/flights/projection';
import { greatCirclePoints } from '@/lib/geo';
import type { Airport } from '@/lib/types';

const W = 640;
const H = 300;

export interface NetworkRoute {
  key: string;
  a: Airport;
  b: Airport;
  count: number;
}

interface Props {
  routes: NetworkRoute[];
  /** Airport the page is about: drawn as the hub, arcs fade from it to each destination. */
  focus?: Airport;
  /** How many airports (besides the focus) get a code label. */
  labels?: number;
  label: string;
}

/** Shifts an unwrapped great-circle line by ±360° so it sits next to `refLon`. */
function nearLon(pts: [number, number][], refLon: number): [number, number][] {
  if (!pts.length) return pts;
  const mid = pts[Math.floor(pts.length / 2)][0];
  const shift = Math.round((mid - refLon) / 360) * 360;
  return shift ? pts.map(([lon, lat]) => [lon - shift, lat] as [number, number]) : pts;
}

/**
 * Light, library-free route map (dot-matrix land + great-circle arcs) for the airport and
 * airline pages. Busier routes draw thicker and on top; a few busiest airports get labels.
 */
export function NetworkMap({ routes, focus, labels = 4, label }: Props) {
  const uid = useId().replace(/:/g, '');
  const geo = useMemo(() => {
    const refLon = focus?.lon ?? routes[0]?.a.lon ?? 0;
    const max = Math.max(1, ...routes.map((r) => r.count));
    const lines = routes
      .filter((r) => r.a.ident !== r.b.ident)
      .map((r) => {
        // Arcs start at the focus airport so its end is always the same on screen.
        const [from, to] = focus && r.b.ident === focus.ident ? [r.b, r.a] : [r.a, r.b];
        return { r, from, to, pts: nearLon(greatCirclePoints(from, to, 48), refLon) };
      });
    const all = lines.flatMap((l) => l.pts);
    if (focus) all.push([focus.lon, focus.lat]);
    const view = fitView(all.length ? all : [[0, 20]], W, H, { padding: 0.14, minSpanDeg: lines.length ? 30 : 64 });
    const dots = landDots(view, 9)
      .map(([x, y]) => `M${x.toFixed(1)} ${y.toFixed(1)}h0`)
      .join('');

    // Airports: weight = flights touching them on this map.
    const weight = new Map<string, { ap: Airport; n: number; p: [number, number] }>();
    const visit = (ap: Airport, n: number, p: [number, number]) => {
      const w = weight.get(ap.ident);
      if (w) w.n += n;
      else weight.set(ap.ident, { ap, n, p });
    };
    const arcs = lines
      .map(({ r, from, to, pts }) => {
        const screen = pts.map(([lon, lat]) => view.project(lon, lat));
        visit(from, r.count, screen[0]);
        visit(to, r.count, screen[screen.length - 1]);
        const t = Math.log(r.count + 1) / Math.log(max + 1);
        return { key: r.key, count: r.count, d: toPath(screen), a: screen[0], b: screen[screen.length - 1], width: 1.6 + t * 3.4, opacity: 0.45 + t * 0.5 };
      })
      .sort((x, y) => x.count - y.count);
    const fp = focus ? view.project(focus.lon, focus.lat) : undefined;
    if (focus && fp && !weight.has(focus.ident)) weight.set(focus.ident, { ap: focus, n: 0, p: fp });

    const airports = [...weight.values()].filter((w) => w.ap.ident !== focus?.ident).sort((x, y) => y.n - x.n);
    // Labels: focus first, then the busiest airports that don't collide with a placed label.
    const placed: { x: number; y: number; text: string; hub: boolean; anchor: 'start' | 'end' | 'middle' }[] = [];
    const inside = ([x, y]: [number, number]) => x > 24 && x < W - 24 && y > 24 && y < H - 12;
    const free = ([x, y]: [number, number]) => placed.every((p) => Math.abs(p.x - x) > 70 || Math.abs(p.y - y) > 30);
    if (focus && fp) placed.push({ x: fp[0], y: fp[1], text: focus.iata || focus.ident, hub: true, anchor: fp[0] > W - 90 ? 'end' : 'start' });
    for (const w of airports) {
      if (placed.length >= labels + (focus ? 1 : 0)) break;
      if (!inside(w.p) || !free(w.p)) continue;
      placed.push({ x: w.p[0], y: w.p[1], text: w.ap.iata || w.ap.ident, hub: false, anchor: w.p[0] > W - 70 ? 'end' : 'start' });
    }
    const maxN = Math.max(1, ...airports.map((w) => w.n));
    return {
      dots,
      arcs,
      fp,
      airports: airports.map((w) => ({ key: w.ap.ident, p: w.p, r: 3.5 + (Math.sqrt(w.n) / Math.sqrt(maxN)) * 3.5 })),
      placed,
    };
  }, [routes, focus, labels]);

  const vig = `xpv-${uid}`;
  const mask = `xpm-${uid}`;
  return (
    <svg className="xp-map" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" role="img" aria-label={label}>
      <defs>
        <radialGradient id={vig} cx="0.5" cy="0.5" r="0.8">
          <stop offset="0.5" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id={mask}>
          <rect width={W} height={H} fill={`url(#${vig})`} />
        </mask>
        {focus &&
          geo.arcs.map((a, i) => (
            <linearGradient key={a.key} id={`xpg-${uid}-${i}`} gradientUnits="userSpaceOnUse" x1={a.a[0]} y1={a.a[1]} x2={a.b[0]} y2={a.b[1]}>
              <stop offset="0" stopColor="var(--accent)" />
              <stop offset="1" stopColor="var(--accent-2)" />
            </linearGradient>
          ))}
      </defs>
      <g mask={`url(#${mask})`}>
        <path d={geo.dots} className="xp-map__land" />
      </g>
      {geo.arcs.map((a, i) => (
        <path
          key={a.key}
          d={a.d}
          className="xp-map__arc"
          pathLength={1}
          stroke={focus ? `url(#xpg-${uid}-${i})` : undefined}
          style={{ strokeWidth: a.width, opacity: a.opacity, animationDelay: `${Math.min(i * 30, 600)}ms` }}
        >
          <title>{`${a.count} ${a.count === 1 ? 'flight' : 'flights'}`}</title>
        </path>
      ))}
      {geo.airports.map((a) => (
        <circle key={a.key} cx={a.p[0]} cy={a.p[1]} r={a.r} className={focus ? 'xp-map__dot xp-map__dot--dest' : 'xp-map__dot'} />
      ))}
      {geo.fp && (
        <g>
          <circle cx={geo.fp[0]} cy={geo.fp[1]} r={16} className="xp-map__halo" />
          <circle cx={geo.fp[0]} cy={geo.fp[1]} r={7.5} className="xp-map__hub" />
        </g>
      )}
      {geo.placed.map((p) => (
        <text
          key={p.text}
          x={p.x + (p.anchor === 'end' ? -14 : p.anchor === 'start' ? 14 : 0)}
          y={p.y + (p.hub ? 9 : 7)}
          textAnchor={p.anchor}
          className={p.hub ? 'xp-map__label xp-map__label--hub' : 'xp-map__label'}
        >
          {p.text}
        </text>
      ))}
    </svg>
  );
}
