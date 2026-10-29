/**
 * Imperative MapLibre wrapper for the flight map. React owns state; this class
 * owns the map instance and applies changes incrementally (setData, paint
 * properties, filters) instead of recreating anything.
 */
import maplibregl, { type LngLatBoundsLike, type MapGeoJSONFeature, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Basemap } from './basemap';
import { computeBounds, type Bounds } from './map-data';
import {
  basemapPaint,
  buildStyle,
  glyphProtocol,
  OPENFREEMAP_STYLE,
  AIRPORT_LAYERS,
  overlayPaint,
  OVERLAY_SOURCES,
  REPLAY_LAYERS,
  replayAirportFilter,
  ROUTE_LAYERS,
  routeFilter,
  setRemoteGlyphs,
  skyFor,
  visitedFilter,
  type BaseMode,
  type ColorMode,
  type OverlayData,
  type ReplayData,
  type Selection,
} from './map-style';

const NON_TILE_SOURCES: readonly string[] = [...OVERLAY_SOURCES, 'land', 'admin1', 'graticule'];
import type { MapTheme } from './theme';

export type PickResult = { kind: 'airport'; id: string } | { kind: 'route'; id: string } | null;

export interface FlightMapState {
  mode: BaseMode;
  theme: MapTheme;
  colorMode: ColorMode;
  selection: Selection;
  globe: boolean;
  basemap: Basemap | null;
  data: OverlayData;
  /** History replay overlay; null when not replaying. */
  replay?: ReplayData | null;
}

export interface FlightMapCallbacks {
  onPick: (pick: PickResult) => void;
  /** An online basemap failed; the map fell back to the offline one. */
  onModeFallback: (mode: BaseMode, reason: string) => void;
  onLoad?: () => void;
}

let protocolRegistered = false;

/** True when the browser can create a WebGL context. */
export function webglSupported(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function fetchRemoteStyle(url: string, timeoutMs = 8000): Promise<StyleSpecification> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const style = (await res.json()) as StyleSpecification;
    if (style.version !== 8 || !Array.isArray(style.layers)) throw new Error('Invalid style');
    return style;
  } finally {
    clearTimeout(t);
  }
}

export class FlightMap {
  readonly map: maplibregl.Map;
  private state: FlightMapState;
  private cb: FlightMapCallbacks;
  private remote: { url: string; style: StyleSpecification } | null = null;
  private styleToken = 0;
  private tileErrors = 0;
  private tileOk = 0;
  private destroyed = false;
  loaded = false;

  constructor(container: HTMLElement, initial: FlightMapState, cb: FlightMapCallbacks) {
    if (!protocolRegistered) {
      maplibregl.addProtocol('flightlog', glyphProtocol);
      protocolRegistered = true;
    }
    this.state = initial;
    this.cb = cb;
    // Online modes start on the offline style, then upgrade once they've loaded.
    const startMode: BaseMode = initial.mode === 'detailed' ? 'night' : initial.mode;
    this.map = new maplibregl.Map({
      container,
      style: buildStyle({ ...initial, mode: startMode }),
      center: [-98, 38],
      zoom: 2.4,
      minZoom: 0.6,
      maxZoom: 12,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      renderWorldCopies: true,
      fadeDuration: 150,
      maxTileCacheSize: 200,
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.keyboard.disableRotation();
    this.map.getCanvas().setAttribute('aria-label', 'Map of flown routes');

    this.map.on('load', () => {
      this.loaded = true;
      this.cb.onLoad?.();
      if (initial.mode === 'detailed') void this.setMode('detailed', true);
    });
    // A (re)loaded style may have been built before the latest state changes landed.
    this.map.on('style.load', () => this.syncAll());
    this.map.on('click', (e) => this.cb.onPick(this.pickAt(e.point)));
    this.map.on('mousemove', (e) => {
      this.map.getCanvas().style.cursor = this.pickAt(e.point) ? 'pointer' : '';
    });
    this.map.on('error', (e) => this.handleError(e as unknown as { error?: Error; sourceId?: string; tile?: unknown }));
    this.map.on('data', (e) => {
      const ev = e as unknown as { dataType?: string; sourceId?: string; tile?: unknown };
      if (ev.dataType === 'source' && ev.tile && ev.sourceId && !NON_TILE_SOURCES.includes(ev.sourceId)) this.tileOk++;
    });
  }

  private pickAt(point: { x: number; y: number }): PickResult {
    // The replay is a view, not a browser: taps shouldn't open sheets over it.
    if (this.state.replay || !this.map.getLayer('airports-dot')) return null;
    const box = (r: number): [[number, number], [number, number]] => [
      [point.x - r, point.y - r],
      [point.x + r, point.y + r],
    ];
    const ap = this.map.queryRenderedFeatures(box(14), { layers: ['airports-dot', 'airports-label'] });
    if (ap.length) {
      // Prefer the airport closest to the tap.
      const best = closest(ap, point, this.map);
      return { kind: 'airport', id: String(best.properties.id) };
    }
    const rt = this.map.queryRenderedFeatures(box(4), { layers: ['routes-hit'] });
    if (rt.length) return { kind: 'route', id: String(rt[0].properties.id) };
    return null;
  }

  private handleError(e: { error?: Error; sourceId?: string; tile?: unknown }) {
    const src = e.sourceId;
    if (!src || NON_TILE_SOURCES.includes(src)) {
      if (e.error) console.warn('map error', e.error.message);
      return;
    }
    // Online basemap tile failure: give up on the mode if nothing loads.
    this.tileErrors++;
    if (this.state.mode !== 'night' && this.tileErrors >= 4 && this.tileOk === 0) {
      const failed = this.state.mode;
      this.cb.onModeFallback(failed, 'Map tiles could not be loaded');
      void this.setMode('night');
    }
  }

  /** Switches basemap. Online modes fall back to offline with a callback on failure. */
  async setMode(mode: BaseMode, force = false): Promise<void> {
    if (!force && mode === this.state.mode) return;
    const token = ++this.styleToken;
    this.state = { ...this.state, mode };
    this.tileErrors = 0;
    this.tileOk = 0;
    if (mode !== 'night' && typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.cb.onModeFallback(mode, 'You’re offline');
      this.state = { ...this.state, mode: 'night' };
      this.applyStyle();
      return;
    }
    if (mode === 'detailed') {
      const url = OPENFREEMAP_STYLE(this.state.theme.dark);
      try {
        const style = this.remote?.url === url ? this.remote.style : await fetchRemoteStyle(url);
        if (token !== this.styleToken || this.destroyed) return;
        this.remote = { url, style };
        setRemoteGlyphs(style.glyphs);
      } catch (err) {
        if (token !== this.styleToken || this.destroyed) return;
        this.cb.onModeFallback(mode, err instanceof Error && err.name === 'AbortError' ? 'Timed out' : 'Unavailable');
        this.state = { ...this.state, mode: 'night' };
      }
    }
    this.applyStyle();
  }

  private applyStyle() {
    const style = buildStyle({ ...this.state, remote: this.state.mode === 'detailed' ? this.remote?.style : undefined });
    this.map.setStyle(style, { diff: false });
  }

  setTheme(theme: MapTheme) {
    const prev = this.state.theme;
    this.state = { ...this.state, theme };
    if (this.state.mode === 'detailed' && prev.dark !== theme.dark) {
      void this.setMode('detailed', true);
      return;
    }
    if (!this.map.isStyleLoaded() && !this.loaded) return;
    this.applyPaints(this.state.mode === 'night' ? basemapPaint(theme) : {});
    if (this.state.mode === 'satellite') this.safe(() => this.map.setPaintProperty('bg', 'background-color', theme.space));
    this.applyOverlayPaint();
    this.safe(() => this.map.setSky(skyFor(theme)));
  }

  setColorMode(colorMode: ColorMode) {
    this.state = { ...this.state, colorMode };
    this.applyOverlayPaint();
  }

  setSelection(selection: Selection) {
    this.state = { ...this.state, selection };
    const f = routeFilter(selection);
    this.safe(() => {
      this.map.setFilter('routes-hl', f);
      this.map.setFilter('routes-hl-glow', f);
    });
    this.applyOverlayPaint();
  }

  setGlobe(globe: boolean) {
    this.state = { ...this.state, globe };
    this.safe(() => this.map.setProjection({ type: globe ? 'globe' : 'mercator' }));
  }

  setBasemap(basemap: Basemap | null) {
    this.state = { ...this.state, basemap };
    if (this.state.mode !== 'detailed') this.applyStyle();
  }

  setData(data: OverlayData) {
    const prev = this.state.data;
    this.state = { ...this.state, data };
    this.safe(() => {
      if (prev.routes !== data.routes) (this.map.getSource('routes') as maplibregl.GeoJSONSource | undefined)?.setData(data.routes as GeoJSON.GeoJSON);
      if (prev.airports !== data.airports) (this.map.getSource('airports') as maplibregl.GeoJSONSource | undefined)?.setData(data.airports as GeoJSON.GeoJSON);
      if (this.map.getLayer('land-visited') && !this.state.replay) this.map.setFilter('land-visited', visitedFilter(data.visitedCountries));
    });
  }

  /** Enters (data) or leaves (null) replay mode: swaps the route layers for the replay ones. */
  setReplay(replay: ReplayData | null) {
    const was = !!this.state.replay;
    this.state = { ...this.state, replay };
    if (was !== !!replay) this.applyReplayMode();
    if (replay) this.updateReplay(replay);
    else this.safe(() => {
      if (this.map.getLayer('land-visited')) this.map.setFilter('land-visited', visitedFilter(this.state.data.visitedCountries));
    });
  }

  /**
   * Pushes replay changes. Only the parts whose identity changed are sent to MapLibre,
   * so a frame that just moves the plane costs one small setData.
   */
  updateReplay(next: Partial<ReplayData>) {
    const prev = this.state.replay;
    if (!prev) return;
    const merged: ReplayData = { ...prev, ...next };
    this.state = { ...this.state, replay: merged };
    const first = next === prev;
    this.safe(() => {
      if (first || (next.past && next.past !== prev.past)) (this.map.getSource('replay-past') as maplibregl.GeoJSONSource | undefined)?.setData(merged.past as GeoJSON.GeoJSON);
      if (first || (next.live && next.live !== prev.live)) (this.map.getSource('replay-live') as maplibregl.GeoJSONSource | undefined)?.setData(merged.live as GeoJSON.GeoJSON);
      if (first || (next.airports && next.airports !== prev.airports)) {
        const f = replayAirportFilter(merged);
        for (const id of AIRPORT_LAYERS) if (this.map.getLayer(id)) this.map.setFilter(id, f);
      }
      if ((first || (next.countries && next.countries !== prev.countries)) && this.map.getLayer('land-visited')) {
        this.map.setFilter('land-visited', visitedFilter(merged.countries));
      }
    });
  }

  private applyReplayMode() {
    const on = !!this.state.replay;
    this.safe(() => {
      for (const id of ROUTE_LAYERS) if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', on ? 'none' : 'visible');
      for (const id of REPLAY_LAYERS) if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
      if (!on) for (const id of AIRPORT_LAYERS) if (this.map.getLayer(id)) this.map.setFilter(id, null);
    });
  }

  fit(bounds: Bounds | null, padding: { top: number; bottom: number; left: number; right: number }, animate = true, maxZoom?: number) {
    if (!bounds) return;
    const c = this.map.getContainer();
    // Never let padding swallow the whole viewport on tiny screens.
    const maxV = Math.max(0, c.clientHeight - 80);
    const maxH = Math.max(0, c.clientWidth - 80);
    const scaleV = padding.top + padding.bottom > maxV ? maxV / (padding.top + padding.bottom) : 1;
    const scaleH = padding.left + padding.right > maxH ? maxH / (padding.left + padding.right) : 1;
    const p = {
      top: padding.top * scaleV,
      bottom: padding.bottom * scaleV,
      left: padding.left * scaleH,
      right: padding.right * scaleH,
    };
    const [[w, s], [e, n]] = bounds;
    const span = Math.max(e - w, n - s);
    this.map.fitBounds([w, s, e, n] as LngLatBoundsLike, {
      padding: p,
      animate,
      duration: animate ? 900 : 0,
      maxZoom: maxZoom ?? (span < 3 ? 7 : 9),
      essential: true,
    });
  }

  /** Eases so the given point is visible above a bottom sheet. */
  focus(lngLat: [number, number], padding: { top: number; bottom: number; left: number; right: number }) {
    const c = this.map.getContainer();
    const pt = this.map.project(lngLat);
    const inside = pt.x > padding.left && pt.x < c.clientWidth - padding.right && pt.y > padding.top && pt.y < c.clientHeight - padding.bottom;
    if (inside) return;
    // Offset (not `padding`, which would persist on the map and skew later camera moves).
    const offset: [number, number] = [(padding.left - padding.right) / 2, (padding.top - padding.bottom) / 2];
    this.map.easeTo({ center: lngLat, offset, duration: 600, essential: true });
  }

  /** Fits the given line into the padded viewport unless it's already fully visible. */
  reveal(points: [number, number][], padding: { top: number; bottom: number; left: number; right: number }) {
    const c = this.map.getContainer();
    const visible = points.every(([lon, lat]) => {
      const p = this.map.project([lon, lat]);
      return p.x >= padding.left && p.x <= c.clientWidth - padding.right && p.y >= padding.top && p.y <= c.clientHeight - padding.bottom;
    });
    if (visible) return;
    const b = computeBounds(points);
    if (!b) return;
    this.fit(b, padding, true, 6);
  }

  resize() {
    this.map.resize();
  }

  destroy() {
    this.destroyed = true;
    this.map.remove();
  }

  private syncAll() {
    const { theme, data, selection, mode } = this.state;
    if (mode === 'night') this.applyPaints(basemapPaint(theme));
    this.applyOverlayPaint();
    const f = routeFilter(selection);
    this.safe(() => {
      this.map.setFilter('routes-hl', f);
      this.map.setFilter('routes-hl-glow', f);
      if (this.map.getLayer('land-visited') && !this.state.replay) this.map.setFilter('land-visited', visitedFilter(data.visitedCountries));
      (this.map.getSource('routes') as maplibregl.GeoJSONSource | undefined)?.setData(data.routes as GeoJSON.GeoJSON);
      (this.map.getSource('airports') as maplibregl.GeoJSONSource | undefined)?.setData(data.airports as GeoJSON.GeoJSON);
      this.map.setSky(skyFor(theme));
      this.map.setProjection({ type: this.state.globe ? 'globe' : 'mercator' });
    });
    this.applyReplayMode();
    if (this.state.replay) this.updateReplay(this.state.replay);
  }

  private applyOverlayPaint() {
    this.applyPaints(overlayPaint(this.state.theme, this.state.colorMode, this.state.selection, this.state.mode === 'satellite'));
  }

  private applyPaints(table: Record<string, Record<string, unknown>>) {
    for (const [layer, props] of Object.entries(table)) {
      if (!this.map.getLayer(layer)) continue;
      for (const [prop, value] of Object.entries(props)) {
        this.safe(() => this.map.setPaintProperty(layer, prop, value));
      }
    }
  }

  private safe(fn: () => void) {
    try {
      fn();
    } catch (e) {
      // Style mid-swap: the next style build carries current state anyway.
      if (import.meta.env.DEV) console.debug('map update deferred', e);
    }
  }
}

function closest(features: MapGeoJSONFeature[], point: { x: number; y: number }, map: maplibregl.Map): MapGeoJSONFeature {
  const cands = features
    .filter((f) => f.geometry.type === 'Point')
    .map((f) => {
      const p = map.project((f.geometry as GeoJSON.Point).coordinates as [number, number]);
      return { f, d: Math.hypot(p.x - point.x, p.y - point.y) };
    });
  if (!cands.length) return features[0];
  // Neighbouring airports (SAN/TIJ, LGA/JFK…) sit within a pixel or two when zoomed out;
  // among those roughly as close as the nearest, pick the one flown most.
  const min = Math.min(...cands.map((c) => c.d));
  const near = cands.filter((c) => c.d <= min + 6);
  near.sort((a, b) => (Number(b.f.properties?.visits) || 0) - (Number(a.f.properties?.visits) || 0) || a.d - b.d);
  return near[0].f;
}
