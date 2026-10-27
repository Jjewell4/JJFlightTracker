import { useMemo } from "react";
import type { Flight } from "@/lib/types";
import { analyzeFlights, buildRoutesGeoJSON } from "@/features/map/map-data";
import { fitView, landDots } from "./projection";

/** Lightweight offline network preview. The full map owns route selection and filtering. */
export function JourneyMap({ flights }: { flights: Flight[] }) {
  const drawing = useMemo(() => {
    const network = analyzeFlights(flights);
    const routes = buildRoutesGeoJSON(network.routes);
    const coordinates = routes.features.flatMap(
      (f) => f.geometry.coordinates as [number, number][],
    );
    const view = fitView(
      coordinates.length
        ? coordinates
        : [
            [-160, -50],
            [170, 75],
          ],
      640,
      360,
      { padding: 0.045, minSpanDeg: 30 },
    );
    const dots = landDots(view, 9)
      .map(([x, y]) => `M${x.toFixed(1)} ${y.toFixed(1)}h0`)
      .join("");
    const arcs = routes.features.map((f) => ({
      id: f.properties.id,
      d: f.geometry.coordinates
        .map(([lon, lat], i, points) => {
          const [x, y] = view.project(lon, lat);
          const previous = i
            ? view.project(points[i - 1][0], points[i - 1][1])
            : null;
          return `${!previous || Math.abs(x - previous[0]) > 320 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
        })
        .join(""),
      count: f.properties.count,
    }));
    return {
      dots,
      arcs,
      airports: network.airports.map(({ airport }) => ({
        id: airport.ident,
        point: view.project(airport.lon, airport.lat),
      })),
    };
  }, [flights]);
  return (
    <svg
      className="journey-map"
      viewBox="0 0 640 360"
      role="img"
      aria-label="Your flown routes and airports"
    >
      <path d={drawing.dots} className="journey-map__land" />
      {drawing.arcs.map((arc) => (
        <path key={arc.id} d={arc.d} className="journey-map__arc">
          <title>{arc.count} flights</title>
        </path>
      ))}
      {drawing.airports.map((a) => (
        <circle
          key={a.id}
          cx={a.point[0]}
          cy={a.point[1]}
          r="3"
          className="journey-map__airport"
        />
      ))}
    </svg>
  );
}
