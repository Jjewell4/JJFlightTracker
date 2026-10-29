/**
 * MapLibre style composition: the offline "night flight" basemap, the optional
 * online basemaps (OpenFreeMap vector / Esri satellite) and the flight overlay
 * (glowing great-circle arcs + airport dots/labels) layered on top of any of them.
 */
import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  SkySpecification,
  SourceSpecification,
  StyleSpecification,
} from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { graticule, type Basemap } from './basemap';
import { RAMP_STOPS, type MapTheme } from './theme';

export type BaseMode = 'night' | 'detailed' | 'satellite';
export type ColorMode = 'frequency' | 'year';
export type Selection = { kind: 'airport'; id: string; related: string[] } | { kind: 'route'; id: string; related: string[] } | null;

export const LABEL_FONT = 'Open Sans Semibold';
export const GLYPHS_URL = 'flightlog://glyphs/{fontstack}/{range}.pbf';

export const OPENFREEMAP_STYLE = (dark: boolean) => `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'positron'}`;
export const ESRI_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const ESRI_ATTRIBUTION =
  'Imagery © <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community';
const NE_ATTRIBUTION = '<a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a>';

/** Source ids owned by the flight overlay (kept across basemap switches). */
export const OVERLAY_SOURCES = ['routes', 'airports', 'replay-past', 'replay-live'] as const;

export interface OverlayData {
  routes: FeatureCollection;
  airports: FeatureCollection;
  visitedCountries: string[];
}

/** Live state of the history replay overlay (null when not replaying). */
export interface ReplayData {
  /** Faint arcs of routes completed so far. */
  past: FeatureCollection;
  /** In-flight trails ('trail' lines) and moving heads ('head' points). */
  live: FeatureCollection;
  /** Airport idents revealed so far. */
  airports: string[];
  /** Country codes visited so far (tints the land). */
  countries: string[];
}

/** Regular route layers hidden while the replay draws its own. */
export const ROUTE_LAYERS = ['routes-glow', 'routes-line', 'routes-hl-glow', 'routes-hl', 'routes-hit'] as const;
export const REPLAY_LAYERS = ['replay-past', 'replay-trail-glow', 'replay-trail', 'replay-head-glow', 'replay-head'] as const;
export const AIRPORT_LAYERS = ['airports-glow', 'airports-dot', 'airports-label'] as const;

export function replayAirportFilter(replay: ReplayData | null | undefined): FilterSpecification | null {
  return replay ? ['in', ['get', 'id'], ['literal', replay.airports]] : null;
}

export interface StyleOptions {
  replay?: ReplayData | null;
  mode: BaseMode;
  theme: MapTheme;
  colorMode: ColorMode;
  selection: Selection;
  globe: boolean;
  basemap: Basemap | null;
  data: OverlayData;
  /** Fetched remote style for `detailed` mode. */
  remote?: StyleSpecification;
}

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] };
const NONE: FilterSpecification = ['==', ['get', 'id'], '__none__'];
const zoomInterp = (stops: [number, ExpressionSpecification | number][]): ExpressionSpecification =>
  ['interpolate', ['linear'], ['zoom'], ...stops.flat()] as unknown as ExpressionSpecification;
const w = ['get', 'w'] as ExpressionSpecification;
/** a + w·b as an expression. */
const lin = (a: number, b: number): ExpressionSpecification => ['+', a, ['*', w, b]];

// ---------- selection helpers ----------

export function routeFilter(sel: Selection): FilterSpecification {
  if (!sel) return NONE;
  if (sel.kind === 'route') return ['==', ['get', 'id'], sel.id];
  return ['any', ['==', ['get', 'a'], sel.id], ['==', ['get', 'b'], sel.id]];
}

function airportRelated(sel: Selection): ExpressionSpecification | null {
  if (!sel) return null;
  return ['in', ['get', 'id'], ['literal', sel.related]];
}

// ---------- paint tables ----------

type PaintTable = Record<string, Record<string, unknown>>;

export function routeColor(theme: MapTheme, colorMode: ColorMode): ExpressionSpecification {
  const ramp = colorMode === 'year' ? theme.yearRamp : theme.freqRamp;
  const key = colorMode === 'year' ? 'r' : 'w';
  return ['interpolate', ['linear'], ['get', key], ...ramp.flatMap((c, i) => [RAMP_STOPS[i], c])] as ExpressionSpecification;
}

/** Paint for every overlay layer given theme, color mode and selection. */
export function overlayPaint(theme: MapTheme, colorMode: ColorMode, sel: Selection, onImagery = false): PaintTable {
  const color = routeColor(theme, colorMode);
  const dim = sel ? (theme.dark ? 0.12 : 0.15) : 1;
  const glowBase = (theme.dark || onImagery ? 0.34 : 0.16) * (sel ? 0.35 : 1);
  const related = airportRelated(sel);
  const dotOpacity: ExpressionSpecification | number = related ? ['case', related, 1, 0.25] : 1;
  return {
    'routes-glow': {
      'line-color': color,
      'line-opacity': ['*', glowBase, lin(0.55, 0.9)],
      'line-width': zoomInterp([
        [1, lin(3, 7)],
        [5, lin(5, 12)],
        [9, lin(8, 18)],
      ]),
      'line-blur': zoomInterp([
        [1, lin(2, 3)],
        [5, lin(3, 6)],
        [9, lin(4, 9)],
      ]),
    },
    'routes-line': {
      'line-color': color,
      'line-opacity': ['*', dim, lin(theme.dark ? 0.62 : 0.6, theme.dark ? 0.38 : 0.4)],
      'line-width': zoomInterp([
        [1, lin(0.6, 1.5)],
        [5, lin(0.9, 2.4)],
        [9, lin(1.4, 3.6)],
      ]),
    },
    'routes-hl-glow': {
      'line-color': color,
      'line-opacity': theme.dark ? 0.55 : 0.35,
      'line-width': zoomInterp([
        [1, lin(6, 6)],
        [5, lin(9, 8)],
        [9, lin(12, 12)],
      ]),
      'line-blur': zoomInterp([
        [1, 4],
        [5, 6],
        [9, 8],
      ]),
    },
    'routes-hl': {
      'line-color': color,
      'line-opacity': 1,
      'line-width': zoomInterp([
        [1, lin(1.6, 1.6)],
        [5, lin(2.2, 2.4)],
        [9, lin(3, 3.6)],
      ]),
    },
    'routes-hit': { 'line-color': '#000', 'line-opacity': 0, 'line-width': 18 },
    'replay-past': {
      'line-color': theme.freqRamp[1],
      'line-opacity': theme.dark || onImagery ? 0.42 : 0.5,
      'line-width': zoomInterp([
        [1, 0.8],
        [5, 1.2],
        [9, 2],
      ]),
    },
    'replay-trail-glow': {
      'line-color': theme.highlight,
      'line-opacity': theme.dark || onImagery ? 0.5 : 0.3,
      'line-width': zoomInterp([
        [1, 6],
        [5, 9],
        [9, 14],
      ]),
      'line-blur': zoomInterp([
        [1, 4],
        [5, 6],
        [9, 8],
      ]),
    },
    'replay-trail': {
      'line-color': theme.highlight,
      'line-opacity': 1,
      'line-width': zoomInterp([
        [1, 1.8],
        [5, 2.4],
        [9, 3.4],
      ]),
    },
    'replay-head-glow': {
      'circle-color': theme.highlight,
      'circle-opacity': theme.dark || onImagery ? 0.45 : 0.3,
      'circle-radius': zoomInterp([
        [1, 9],
        [5, 13],
        [9, 18],
      ]),
      'circle-blur': 1,
      'circle-pitch-alignment': 'map',
    },
    'replay-head': {
      'circle-color': theme.dotFill,
      'circle-stroke-color': theme.highlight,
      'circle-stroke-width': 2,
      'circle-radius': zoomInterp([
        [1, 3.2],
        [5, 4.2],
        [9, 5.5],
      ]),
      'circle-pitch-alignment': 'map',
    },
    'airports-glow': {
      'circle-color': theme.glow,
      'circle-opacity': ['*', theme.dark || onImagery ? 0.42 : 0.22, dotOpacity],
      'circle-radius': zoomInterp([
        [1, lin(3, 8)],
        [5, lin(6, 14)],
        [9, lin(9, 20)],
      ]),
      'circle-blur': 1,
      'circle-pitch-alignment': 'map',
    },
    'airports-dot': {
      'circle-color': theme.dotFill,
      'circle-opacity': dotOpacity,
      'circle-stroke-color': theme.dotStroke,
      'circle-stroke-opacity': dotOpacity,
      'circle-stroke-width': zoomInterp([
        [1, 1],
        [6, 1.8],
      ]),
      'circle-radius': zoomInterp([
        [1, lin(1.4, 2.6)],
        [5, lin(2.2, 4)],
        [9, lin(3.5, 6)],
      ]),
      'circle-pitch-alignment': 'map',
    },
    'airports-label': {
      'text-color': onImagery ? '#ffffff' : theme.label,
      'text-halo-color': onImagery ? 'rgba(0,0,0,0.75)' : theme.labelHalo,
      'text-halo-width': 1.4,
      'text-halo-blur': 0.4,
      'text-opacity': related ? ['case', related, 1, 0.3] : 1,
    },
  };
}

/** Paint for the offline basemap layers. */
export function basemapPaint(theme: MapTheme): PaintTable {
  return {
    bg: { 'background-color': theme.ocean },
    graticule: { 'line-color': theme.graticule, 'line-width': 0.6 },
    land: { 'fill-color': theme.land, 'fill-antialias': true },
    'land-visited': { 'fill-color': theme.landVisited },
    'state-lines': { 'line-color': theme.stateLine, 'line-width': zoomInterp([[2, 0.4], [6, 0.9]]) },
    'land-outline': { 'line-color': theme.coast, 'line-width': zoomInterp([[1, 0.5], [6, 1.1]]) },
  };
}

export function skyFor(theme: MapTheme): SkySpecification {
  return {
    'sky-color': theme.space,
    'horizon-color': theme.dark ? theme.space : theme.ocean,
    'fog-color': theme.space,
    'sky-horizon-blend': 0.6,
    'horizon-fog-blend': 0.5,
    'fog-ground-blend': 0.8,
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 4, 0.8, 7, 0],
  };
}

// ---------- layers ----------

function overlayLayers(paint: PaintTable, sel: Selection, replay?: ReplayData | null): LayerSpecification[] {
  const hl = routeFilter(sel);
  const routeVis = { visibility: replay ? 'none' : 'visible' } as const;
  const replayVis = { visibility: replay ? 'visible' : 'none' } as const;
  const apFilter = replayAirportFilter(replay);
  const ap = apFilter ? { filter: apFilter } : {};
  const line = { 'line-cap': 'round', 'line-join': 'round' } as const;
  const isTrail: FilterSpecification = ['==', ['get', 'kind'], 'trail'];
  const isHead: FilterSpecification = ['==', ['get', 'kind'], 'head'];
  return [
    { id: 'routes-glow', type: 'line', source: 'routes', layout: { ...line, ...routeVis }, paint: paint['routes-glow'] },
    { id: 'routes-line', type: 'line', source: 'routes', layout: { ...line, ...routeVis }, paint: paint['routes-line'] },
    { id: 'routes-hl-glow', type: 'line', source: 'routes', filter: hl, layout: { ...line, ...routeVis }, paint: paint['routes-hl-glow'] },
    { id: 'routes-hl', type: 'line', source: 'routes', filter: hl, layout: { ...line, ...routeVis }, paint: paint['routes-hl'] },
    { id: 'routes-hit', type: 'line', source: 'routes', layout: { 'line-cap': 'round', ...routeVis }, paint: paint['routes-hit'] },
    { id: 'replay-past', type: 'line', source: 'replay-past', layout: { ...line, ...replayVis }, paint: paint['replay-past'] },
    { id: 'replay-trail-glow', type: 'line', source: 'replay-live', filter: isTrail, layout: { ...line, ...replayVis }, paint: paint['replay-trail-glow'] },
    { id: 'replay-trail', type: 'line', source: 'replay-live', filter: isTrail, layout: { ...line, ...replayVis }, paint: paint['replay-trail'] },
    { id: 'airports-glow', type: 'circle', source: 'airports', ...ap, paint: paint['airports-glow'] },
    { id: 'airports-dot', type: 'circle', source: 'airports', ...ap, paint: paint['airports-dot'] },
    { id: 'replay-head-glow', type: 'circle', source: 'replay-live', filter: isHead, layout: replayVis, paint: paint['replay-head-glow'] },
    { id: 'replay-head', type: 'circle', source: 'replay-live', filter: isHead, layout: replayVis, paint: paint['replay-head'] },
    {
      id: 'airports-label',
      type: 'symbol',
      source: 'airports',
      ...ap,
      layout: {
        'text-field': ['get', 'code'],
        'text-font': [LABEL_FONT],
        'text-size': zoomInterp([
          [2, 10],
          [6, 12.5],
          [10, 14],
        ]),
        'text-letter-spacing': 0.08,
        'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
        'text-radial-offset': 0.75,
        'text-justify': 'auto',
        'text-padding': 3,
        'symbol-sort-key': ['get', 'rank'],
        'text-allow-overlap': false,
        'text-optional': true,
      },
      paint: paint['airports-label'],
    } as LayerSpecification,
  ] as LayerSpecification[];
}

function nightLayers(paint: PaintTable, visited: string[], withBasemap: boolean): LayerSpecification[] {
  const layers: LayerSpecification[] = [
    { id: 'bg', type: 'background', paint: paint.bg },
    { id: 'graticule', type: 'line', source: 'graticule', paint: paint.graticule },
  ] as LayerSpecification[];
  if (withBasemap) {
    layers.push(
      ...([
      { id: 'land', type: 'fill', source: 'land', paint: paint.land },
      { id: 'land-visited', type: 'fill', source: 'land', filter: visitedFilter(visited), paint: paint['land-visited'] },
      { id: 'state-lines', type: 'line', source: 'admin1', minzoom: 2, paint: paint['state-lines'] },
      { id: 'land-outline', type: 'line', source: 'land', layout: { 'line-join': 'round' }, paint: paint['land-outline'] },
      ] as LayerSpecification[]),
    );
  }
  return layers;
}

export function visitedFilter(codes: string[]): FilterSpecification {
  return ['in', ['get', 'c'], ['literal', codes.length ? codes : ['__']]];
}

function overlaySources(data: OverlayData, replay?: ReplayData | null): Record<string, SourceSpecification> {
  return {
    routes: { type: 'geojson', data: data.routes as GeoJSON.GeoJSON, tolerance: 0.25, buffer: 64 },
    airports: { type: 'geojson', data: data.airports as GeoJSON.GeoJSON },
    'replay-past': { type: 'geojson', data: (replay?.past ?? EMPTY_FC) as GeoJSON.GeoJSON, tolerance: 0.25, buffer: 64 },
    // Rewritten every frame while playing: keep tiling cheap.
    'replay-live': { type: 'geojson', data: (replay?.live ?? EMPTY_FC) as GeoJSON.GeoJSON, tolerance: 0.4, buffer: 32, maxzoom: 10 },
  };
}

/** Composes the full style for a basemap mode with the flight overlay on top. */
export function buildStyle(o: StyleOptions): StyleSpecification {
  const { theme, basemap } = o;
  const overlay = overlayLayers(overlayPaint(theme, o.colorMode, o.selection, o.mode === 'satellite'), o.selection, o.replay);
  const base: Pick<StyleSpecification, 'version' | 'glyphs' | 'projection' | 'sky'> = {
    version: 8,
    glyphs: GLYPHS_URL,
    projection: { type: o.globe ? 'globe' : 'mercator' },
    sky: skyFor(theme),
  };

  if (o.mode === 'detailed' && o.remote) {
    const { center: _c, zoom: _z, bearing: _b, pitch: _p, projection: _pr, sky: _s, terrain: _t, ...remote } = o.remote;
    void [_c, _z, _b, _p, _pr, _s, _t];
    return {
      ...remote,
      ...base,
      sources: { ...remote.sources, ...overlaySources(o.data, o.replay) },
      layers: [...remote.layers, ...overlay],
    };
  }

  if (o.mode === 'satellite') {
    const outlines: LayerSpecification[] = basemap
      ? ([
          {
            id: 'sat-borders',
            type: 'line',
            source: 'land',
            paint: { 'line-color': 'rgba(255,255,255,0.28)', 'line-width': zoomInterp([[1, 0.4], [6, 0.9]]) },
          },
        ] as LayerSpecification[])
      : [];
    return {
      ...base,
      sources: {
        satellite: { type: 'raster', tiles: [ESRI_TILES], tileSize: 256, maxzoom: 18, attribution: ESRI_ATTRIBUTION },
        ...(basemap ? { land: { type: 'geojson', data: basemap.land as GeoJSON.GeoJSON, attribution: NE_ATTRIBUTION } } : {}),
        ...overlaySources(o.data, o.replay),
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': theme.space } },
        {
          id: 'satellite',
          type: 'raster',
          source: 'satellite',
          paint: { 'raster-brightness-max': theme.dark ? 0.72 : 0.9, 'raster-saturation': -0.25, 'raster-contrast': 0.05, 'raster-fade-duration': 200 },
        },
        ...outlines,
        ...overlay,
      ] as LayerSpecification[],
    };
  }

  // Offline night/day basemap.
  return {
    ...base,
    sources: {
      graticule: { type: 'geojson', data: graticule(15) as GeoJSON.GeoJSON },
      land: { type: 'geojson', data: (basemap?.land ?? EMPTY_FC) as GeoJSON.GeoJSON, attribution: NE_ATTRIBUTION, tolerance: 0.3 },
      admin1: { type: 'geojson', data: (basemap?.lines ?? EMPTY_FC) as GeoJSON.GeoJSON, tolerance: 0.3 },
      ...overlaySources(o.data, o.replay),
    },
    layers: [...nightLayers(basemapPaint(theme), o.replay ? o.replay.countries : o.data.visitedCountries, !!basemap), ...overlay],
  };
}

// ---------- glyphs protocol ----------

let localGlyphs: Promise<ArrayBuffer | null> | null = null;
/** Remote glyph URL template of the active online style (for fonts we don't bundle). */
let remoteGlyphs: string | null = null;

export function setRemoteGlyphs(template: string | null | undefined) {
  remoteGlyphs = template && !template.startsWith('flightlog://') ? template : null;
}

function loadLocalGlyphs(): Promise<ArrayBuffer | null> {
  if (!localGlyphs) {
    localGlyphs = fetch(`${import.meta.env.BASE_URL}data/map-glyphs.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(({ pbf }: { pbf: string }) => {
        const bin = atob(pbf);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        return buf.buffer;
      })
      .catch((e) => {
        console.warn('Map label glyphs unavailable', e);
        localGlyphs = null;
        return null;
      });
  }
  return localGlyphs;
}

/**
 * Handler for `flightlog://glyphs/{fontstack}/{range}`: serves the bundled
 * ASCII subset of LABEL_FONT offline, proxies anything else to the online
 * style's glyph server, and otherwise returns an empty PBF (labels just skip).
 */
export async function glyphProtocol(params: { url: string }, abort: AbortController): Promise<{ data: ArrayBuffer }> {
  const m = /^flightlog:\/\/glyphs\/([^/]+)\/(\d+-\d+)(?:\.pbf)?$/.exec(params.url);
  const empty = { data: new ArrayBuffer(0) };
  if (!m) return empty;
  let fontstack = m[1];
  try {
    fontstack = decodeURIComponent(fontstack);
  } catch {
    /* already decoded */
  }
  const range = m[2];
  if (fontstack.split(',')[0].trim() === LABEL_FONT) {
    if (range !== '0-255') return empty;
    const buf = await loadLocalGlyphs();
    return buf ? { data: buf.slice(0) } : empty;
  }
  if (remoteGlyphs) {
    try {
      const url = remoteGlyphs.replace('{fontstack}', encodeURIComponent(fontstack)).replace('{range}', range);
      const res = await fetch(url, { signal: abort.signal });
      if (res.ok) return { data: await res.arrayBuffer() };
    } catch {
      /* offline – fall through */
    }
  }
  return empty;
}
