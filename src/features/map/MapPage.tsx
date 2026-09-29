/**
 * Map screen: every flown route as a glowing great-circle arc over an offline
 * "night flight" basemap, with year filter, basemap/globe toggles and
 * airport/route detail sheets.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import type { FeatureCollection, LineString, Point } from 'geojson';
import { Icon } from '@/components/Icon';
import { useReferenceReady } from '@/data/reference';
import { useFlights, useSettings } from '@/lib/db';
import { greatCirclePoints, kmToMiles } from '@/lib/geo';
import { loadBasemap, type Basemap } from './basemap';
import { FlightMap, webglSupported, type PickResult } from './flight-map';
import {
  airportPoints,
  analyzeFlights,
  boundsOfRoutes,
  buildAirportsGeoJSON,
  buildRoutesGeoJSON,
  compactNumber,
  filterByYear,
  flightYears,
  type AirportProps,
  type RouteProps,
} from './map-data';
import type { BaseMode, ColorMode, OverlayData, Selection } from './map-style';
import { AirportSheet, RouteSheet } from './MapSheet';
import { StaticMap } from './StaticMap';
import { rampGradient, useMapTheme } from './theme';
import './MapPage.css';

interface Prefs {
  mode: BaseMode;
  colorMode: ColorMode;
  globe: boolean;
}

const PREFS_KEY = 'flightlog.map.prefs';
// The globe frames a worldwide log far better than Mercator on a narrow portrait screen.
const DEFAULT_PREFS: Prefs = {
  mode: 'night',
  colorMode: 'frequency',
  globe: typeof window !== 'undefined' && window.innerWidth < 720,
};

function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const [prefs, setPrefs] = useState(readPrefs);
  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable – prefs are per-session */
      }
      return next;
    });
  }, []);
  return [prefs, update];
}

function useBasemap(): Basemap | null {
  const [bm, setBm] = useState<Basemap | null>(null);
  useEffect(() => {
    let alive = true;
    loadBasemap().then((b) => alive && setBm(b));
    return () => {
      alive = false;
    };
  }, []);
  return bm;
}

const EMPTY_ROUTES: FeatureCollection<LineString, RouteProps> = { type: 'FeatureCollection', features: [] };
const EMPTY_AIRPORTS: FeatureCollection<Point, AirportProps> = { type: 'FeatureCollection', features: [] };

const MODES: { id: BaseMode; label: string; hint: string }[] = [
  { id: 'night', label: 'Minimal', hint: 'Works offline' },
  { id: 'detailed', label: 'Detailed', hint: 'Streets & places' },
  { id: 'satellite', label: 'Satellite', hint: 'Imagery' },
];

function FitIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
      <circle cx="12" cy="12" r="2.2" />
    </svg>
  );
}

export default function MapPage() {
  const flights = useFlights();
  const ready = useReferenceReady();
  const settings = useSettings();
  const theme = useMapTheme();
  const basemap = useBasemap();
  const [prefs, setPrefs] = usePrefs();
  const [year, setYear] = useState<number | null>(null);
  const [pick, setPick] = useState<PickResult>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [webgl] = useState(() => webglSupported());
  const [mapFailed, setMapFailed] = useState(false);

  const pageRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<FlightMap | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // ---------- derived data ----------
  const years = useMemo(() => (flights ? flightYears(flights) : []), [flights]);
  useEffect(() => {
    if (year != null && flights && !years.includes(year)) setYear(null);
  }, [year, years, flights]);
  const filtered = useMemo(() => (flights ? filterByYear(flights, year) : []), [flights, year]);
  const analysis = useMemo(() => (ready && flights ? analyzeFlights(filtered) : null), [ready, flights, filtered]);
  const yearRange = useMemo(() => ({ min: years[years.length - 1] ?? 0, max: years[0] ?? 0 }), [years]);
  const routesFC = useMemo(() => (analysis ? buildRoutesGeoJSON(analysis.routes, yearRange) : EMPTY_ROUTES), [analysis, yearRange]);
  const airportsFC = useMemo(() => (analysis ? buildAirportsGeoJSON(analysis.airports) : EMPTY_AIRPORTS), [analysis]);
  const bounds = useMemo(() => (analysis ? boundsOfRoutes(routesFC, airportPoints(analysis.airports)) : null), [analysis, routesFC]);
  const overlay: OverlayData = useMemo(
    () => ({ routes: routesFC, airports: airportsFC, visitedCountries: analysis?.countries ?? [] }),
    [routesFC, airportsFC, analysis],
  );

  const airportAgg = pick?.kind === 'airport' ? analysis?.airports.find((a) => a.airport.ident === pick.id) : undefined;
  const routeAgg = pick?.kind === 'route' ? analysis?.routes.find((r) => r.key === pick.id) : undefined;
  const selection: Selection = useMemo(() => {
    if (airportAgg) return { kind: 'airport', id: airportAgg.airport.ident, related: [airportAgg.airport.ident, ...airportAgg.destinations.map((d) => d.airport.ident)] };
    if (routeAgg) return { kind: 'route', id: routeAgg.key, related: [routeAgg.a.ident, routeAgg.b.ident] };
    return null;
  }, [airportAgg, routeAgg]);
  // Drop a selection that no longer exists (e.g. after changing the year).
  useEffect(() => {
    if (pick && analysis && !airportAgg && !routeAgg) setPick(null);
  }, [pick, analysis, airportAgg, routeAgg]);

  // ---------- padding for fit/focus (overlays cover parts of the map) ----------
  const getPadding = useCallback((withSheet: boolean) => {
    const root = pageRef.current?.getBoundingClientRect();
    if (!root) return { top: 40, bottom: 40, left: 24, right: 24 };
    const wide = root.width >= 720;
    const top = (topRef.current?.getBoundingClientRect().bottom ?? root.top) - root.top + 20;
    // Layout box of the sheet (offset* ignore its entrance transform animation).
    const el = withSheet ? sheetRef.current : null;
    const sheet = el && el.offsetHeight > 0 ? { top: root.top + el.offsetTop, right: root.left + el.offsetLeft + el.offsetWidth } : undefined;
    const tabbar = document.querySelector('.tabbar')?.getBoundingClientRect();
    const tabbarTop = tabbar && tabbar.height > 0 ? tabbar.top : root.bottom;
    let bottomEdge = Math.min(bottomRef.current?.getBoundingClientRect().top ?? root.bottom, tabbarTop);
    // Side padding leaves room for IATA labels drawn beside edge airports.
    const side = wide ? 64 : 36;
    let left = side;
    if (sheet) {
      if (wide) left = sheet.right - root.left + side;
      else bottomEdge = Math.min(bottomEdge, sheet.top);
    }
    return { top, bottom: root.bottom - bottomEdge + 20, left, right: side };
  }, []);

  // ---------- map lifecycle ----------
  const basemapApplied = useRef<Basemap | null>(null);
  const latest = useRef({ theme, prefs, selection, basemap, overlay });
  latest.current = { theme, prefs, selection, basemap, overlay };

  useLayoutEffect(() => {
    if (!webgl || !containerRef.current) return;
    let fm: FlightMap;
    try {
      const s = latest.current;
      fm = new FlightMap(
        containerRef.current,
        { mode: s.prefs.mode, theme: s.theme, colorMode: s.prefs.colorMode, selection: s.selection, globe: s.prefs.globe, basemap: s.basemap, data: s.overlay },
        {
          onPick: (p) => {
            setPanelOpen(false);
            setPick(p);
          },
          onModeFallback: (mode, reason) => {
            setPrefs({ mode: 'night' });
            const label = mode === 'satellite' ? 'Satellite imagery' : 'Detailed map';
            const why = reason === 'Unavailable' ? '' : ` (${reason.toLowerCase()})`;
            setToast(`${label} couldn’t load${why}. Showing the offline map.`);
          },
          onLoad: () => setMapLoaded(true),
        },
      );
    } catch (e) {
      console.error('Map failed to initialise', e);
      setMapFailed(true);
      return;
    }
    mapRef.current = fm;
    basemapApplied.current = latest.current.basemap;
    const ro = new ResizeObserver(() => fm.resize());
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      fm.destroy();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, [webgl, setPrefs]);

  // Dev-only hooks for visual QA scripts.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as Record<string, unknown>;
    w.__mapPick = (p: PickResult) => setPick(p);
    w.__mapProject = (ll: [number, number]) => {
      const pt = mapRef.current?.map.project(ll);
      const r = containerRef.current?.getBoundingClientRect();
      return pt && r ? { x: pt.x + r.left, y: pt.y + r.top } : null;
    };
    w.__mapDebug = () => {
      const m = mapRef.current?.map;
      return m && { zoom: m.getZoom(), center: m.getCenter(), moving: m.isMoving(), padding: m.getPadding() };
    };
    return () => {
      delete w.__mapDebug;
      delete w.__mapPick;
      delete w.__mapProject;
    };
  }, []);

  useEffect(() => mapRef.current?.setTheme(theme), [theme]);
  useEffect(() => mapRef.current?.setColorMode(prefs.colorMode), [prefs.colorMode]);
  useEffect(() => mapRef.current?.setGlobe(prefs.globe), [prefs.globe]);
  useEffect(() => void mapRef.current?.setMode(prefs.mode), [prefs.mode]);
  useEffect(() => mapRef.current?.setSelection(selection), [selection]);
  useEffect(() => mapRef.current?.setData(overlay), [overlay]);
  useEffect(() => {
    if (basemap && mapRef.current && basemapApplied.current !== basemap) {
      basemapApplied.current = basemap;
      mapRef.current.setBasemap(basemap);
    }
  }, [basemap, mapLoaded]);

  // Fit on first data, then whenever the year filter changes.
  const fittedFor = useRef<string | null>(null);
  useEffect(() => {
    const fm = mapRef.current;
    if (!fm || !mapLoaded || !analysis || !bounds) return;
    const key = String(year);
    if (fittedFor.current === key) return;
    const first = fittedFor.current === null;
    fittedFor.current = key;
    fm.fit(bounds, getPadding(false), !first);
  }, [mapLoaded, analysis, bounds, year, getPadding]);

  const fitAll = () => {
    setPick(null);
    mapRef.current?.fit(bounds, getPadding(false), true);
  };

  // Keep the selected feature visible above the sheet.
  useEffect(() => {
    const fm = mapRef.current;
    if (!fm || !mapLoaded || (!airportAgg && !routeAgg)) return;
    const id = requestAnimationFrame(() => {
      if (airportAgg) fm.focus([airportAgg.airport.lon, airportAgg.airport.lat], getPadding(true));
      else if (routeAgg) fm.reveal(greatCirclePoints(routeAgg.a, routeAgg.b, 32), getPadding(true));
    });
    return () => cancelAnimationFrame(id);
  }, [airportAgg, routeAgg, mapLoaded, getPadding]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  // Escape closes sheet/panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPanelOpen(false);
      setPick(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---------- render ----------
  const loading = !flights || !ready;
  const empty = !loading && flights.length === 0;
  const s = analysis?.summary;
  const dist = s ? (settings.distanceUnit === 'mi' ? kmToMiles(s.distanceKm) : s.distanceKm) : 0;
  const maxCount = analysis?.routes[0]?.count ?? 1;
  const showStatic = !webgl || mapFailed;
  const sheetOpen = !!(airportAgg || routeAgg);

  return (
    <div
      ref={pageRef}
      className={`map-page${sheetOpen ? ' has-sheet' : ''}`}
      style={{ '--map-space': theme.space, '--map-ocean': theme.ocean } as CSSProperties}
    >
      <div ref={containerRef} className="map-canvas" hidden={showStatic} />
      {showStatic && (
        <div className="map-canvas map-canvas--static">
          <StaticMap basemap={basemap} routes={routesFC} airports={airportsFC} bounds={bounds} selectedId={selection?.id} onPick={setPick} />
          <p className="map-static__note">
            <Icon name="info" size={14} /> Interactive map needs WebGL — showing a static view.
          </p>
        </div>
      )}

      <div ref={topRef} className="map-top">
        <div className="map-glass map-years" role="radiogroup" aria-label="Filter by year">
          <button type="button" role="radio" aria-checked={year == null} className="map-chip" onClick={() => setYear(null)}>
            All years
          </button>
          {years.map((y) => (
            <button key={y} type="button" role="radio" aria-checked={year === y} className="map-chip" onClick={() => setYear(year === y ? null : y)}>
              {y}
            </button>
          ))}
        </div>
        <div className="map-glass map-tools">
          <button
            type="button"
            className="map-tool"
            aria-label="Map style"
            aria-expanded={panelOpen}
            aria-pressed={panelOpen}
            onClick={() => setPanelOpen((o) => !o)}
            disabled={showStatic}
          >
            <Icon name="layers" size={20} />
          </button>
          <button
            type="button"
            className="map-tool"
            aria-label={prefs.globe ? 'Flat map' : 'Globe view'}
            aria-pressed={prefs.globe}
            onClick={() => setPrefs({ globe: !prefs.globe })}
            disabled={showStatic}
          >
            <Icon name="globe" size={20} />
          </button>
          <button type="button" className="map-tool" aria-label="Fit all flights" onClick={fitAll} disabled={!bounds || showStatic}>
            <FitIcon />
          </button>
        </div>

        {panelOpen && (
          <div className="map-glass map-panel animate-in" role="dialog" aria-label="Map options">
            <div className="map-panel__label">Basemap</div>
            <div className="map-modes">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`map-mode map-mode--${m.id}`}
                  aria-pressed={prefs.mode === m.id}
                  onClick={() => setPrefs({ mode: m.id })}
                >
                  <span className="map-mode__swatch" aria-hidden />
                  <span className="map-mode__name">{m.label}</span>
                  <span className="map-mode__hint">{m.hint}</span>
                </button>
              ))}
            </div>
            <div className="map-panel__label">Color routes by</div>
            <div className="seg">
              <button type="button" className="seg__opt" aria-pressed={prefs.colorMode === 'frequency'} onClick={() => setPrefs({ colorMode: 'frequency' })}>
                Frequency
              </button>
              <button type="button" className="seg__opt" aria-pressed={prefs.colorMode === 'year'} onClick={() => setPrefs({ colorMode: 'year' })}>
                Last flown
              </button>
            </div>
            <label className="map-switch">
              <span>
                Globe view
                <span className="map-mode__hint">3D Earth when zoomed out</span>
              </span>
              <input type="checkbox" checked={prefs.globe} onChange={(e) => setPrefs({ globe: e.target.checked })} />
              <span className="map-switch__track" aria-hidden />
            </label>
          </div>
        )}
      </div>

      {!empty && !sheetOpen && (
        <div ref={bottomRef} className="map-bottom">
          <div className="map-glass map-stats" aria-live="polite">
            {loading || !s ? (
              <span className="map-stats__loading">Loading your flights…</span>
            ) : (
              <>
                <div className="map-stats__row">
                  <span>
                    <b>{s.flights.toLocaleString('en-US')}</b> {s.flights === 1 ? 'flight' : 'flights'}
                  </span>
                  <span>
                    <b>{s.routes}</b> {s.routes === 1 ? 'route' : 'routes'}
                  </span>
                  <span>
                    <b>{s.airports}</b> airports
                  </span>
                  <span>
                    <b>{compactNumber(dist)}</b> {settings.distanceUnit}
                  </span>
                </div>
                {s.routes > 0 && (
                  <div className="map-legend" aria-hidden>
                    <span>{prefs.colorMode === 'year' ? yearRange.min : '1×'}</span>
                    <span
                      className="map-legend__bar"
                      style={{ background: rampGradient(prefs.colorMode === 'year' ? theme.yearRamp : theme.freqRamp) }}
                    />
                    <span>{prefs.colorMode === 'year' ? yearRange.max : `${maxCount}×`}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {airportAgg && (
        <AirportSheet
          ref={sheetRef}
          key={`a-${airportAgg.airport.ident}`}
          agg={airportAgg}
          year={year}
          onClose={() => setPick(null)}
          onSelectRoute={(id) => setPick({ kind: 'route', id })}
        />
      )}
      {routeAgg && (
        <RouteSheet
          ref={sheetRef}
          key={`r-${routeAgg.key}`}
          route={routeAgg}
          year={year}
          settings={settings}
          onClose={() => setPick(null)}
          onSelectAirport={(id) => setPick({ kind: 'airport', id })}
        />
      )}

      {empty && (
        <div className="map-empty">
          <div className="map-glass map-empty__card animate-in">
            <div className="map-empty__icon" aria-hidden>
              <Icon name="plane" size={26} />
            </div>
            <h2 className="empty__title">Your map is waiting</h2>
            <p className="muted">Log or import flights and every route you’ve flown will light up here.</p>
            <div className="map-empty__actions">
              <Link to="/flights/new" className="btn btn--primary btn--lg">
                <Icon name="plus" size={18} /> Log a flight
              </Link>
              <Link to="/import" className="btn btn--lg">
                <Icon name="upload" size={18} /> Import
              </Link>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="map-toast map-glass animate-in" role="status">
          <Icon name="warning" size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}
