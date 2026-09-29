/**
 * No-WebGL fallback: an SVG equirectangular rendering of the offline basemap,
 * arcs and airports. Tappable airports/routes open the same sheets.
 */
import { useMemo } from 'react';
import type { FeatureCollection, LineString, Point } from 'geojson';
import type { Basemap } from './basemap';
import type { AirportProps, Bounds, RouteProps } from './map-data';
import type { PickResult } from './flight-map';

interface Props {
  basemap: Basemap | null;
  routes: FeatureCollection<LineString, RouteProps>;
  airports: FeatureCollection<Point, AirportProps>;
  bounds: Bounds | null;
  selectedId?: string;
  onPick: (p: PickResult) => void;
}

const W = 1000;

export function StaticMap({ basemap, routes, airports, bounds, selectedId, onPick }: Props) {
  const view = useMemo(() => {
    const [[w, s], [e, n]] = bounds ?? [
      [-170, -60],
      [190, 80],
    ];
    const padX = Math.max(4, (e - w) * 0.08);
    const padY = Math.max(4, (n - s) * 0.12);
    return { x: w - padX, y: -(n + padY), width: e - w + padX * 2, height: n - s + padY * 2 };
  }, [bounds]);

  const land = useMemo(() => {
    if (!basemap) return '';
    let d = '';
    for (const f of basemap.land.features) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const rings of polys)
        for (const ring of rings) d += `M${ring.map(([x, y]) => `${x.toFixed(2)},${(-y).toFixed(2)}`).join('L')}Z`;
    }
    return d;
  }, [basemap]);

  const k = view.width / W; // viewBox degrees per nominal pixel (radius scaling; strokes are non-scaling)
  return (
    <svg
      className="map-static"
      viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Map of flown routes"
    >
      <rect x={view.x - 360} y={view.y - 180} width={view.width + 720} height={view.height + 360} className="map-static__ocean" onClick={() => onPick(null)} />
      {land && <path d={land} className="map-static__land" strokeWidth={0.8} />}
      {routes.features.map((f) => (
        <path
          key={f.properties.id}
          d={`M${f.geometry.coordinates.map(([x, y]) => `${x.toFixed(2)},${(-y).toFixed(2)}`).join('L')}`}
          className={`map-static__arc${selectedId === f.properties.id ? ' is-selected' : ''}`}
          strokeWidth={1 + f.properties.w * 2.5}
          style={{ opacity: 0.45 + f.properties.w * 0.55 }}
          onClick={() => onPick({ kind: 'route', id: f.properties.id })}
        />
      ))}
      {airports.features.map((f) => (
        <circle
          key={f.properties.id}
          cx={f.geometry.coordinates[0]}
          cy={-f.geometry.coordinates[1]}
          r={(2.5 + f.properties.w * 4) * k}
          className={`map-static__dot${selectedId === f.properties.id ? ' is-selected' : ''}`}
          strokeWidth={1.2}
          onClick={() => onPick({ kind: 'airport', id: f.properties.id })}
        />
      ))}
    </svg>
  );
}
