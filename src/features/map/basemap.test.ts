import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { StyleSpecification } from 'maplibre-gl';
import { decodeBasemap, decodeRing, graticule, type EncodedBasemap } from './basemap';
import { deriveTheme, mix, parseColor, toCss } from './theme';
import { buildStyle, glyphProtocol, routeFilter } from './map-style';

describe('basemap decoding', () => {
  it('decodes delta-encoded rings', () => {
    expect(decodeRing([-11700, 3200, 50, -25, 10, 0], 100)).toEqual([
      [-117, 32],
      [-116.5, 31.75],
      [-116.4, 31.75],
    ]);
  });

  it('decodes the bundled Natural Earth basemap', () => {
    const enc = JSON.parse(readFileSync(join(process.cwd(), 'public/data/basemap.json'), 'utf8')) as EncodedBasemap;
    const bm = decodeBasemap(enc);
    expect(bm.land.features.length).toBeGreaterThan(150);
    const us = bm.land.features.find((f) => f.properties.c === 'US')!;
    expect(us.geometry.type).toBe('MultiPolygon');
    for (const f of bm.land.features) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const ring of polys.flat()) {
        expect(ring.length).toBeGreaterThanOrEqual(4);
        for (const [x, y] of ring) {
          expect(Math.abs(x)).toBeLessThanOrEqual(180.01);
          expect(Math.abs(y)).toBeLessThanOrEqual(90.01);
        }
      }
    }
    for (const code of ['FR', 'NO', 'IS', 'GB', 'BR', 'CL', 'MX']) expect(bm.land.features.some((f) => f.properties.c === code)).toBe(true);
    expect(bm.lines.features[0].geometry.coordinates.length).toBeGreaterThan(100);
  });

  it('generates a graticule', () => {
    expect(graticule(30).features.length).toBe(13 + 6);
  });
});

describe('theme', () => {
  it('parses and mixes colors', () => {
    expect(parseColor('#5cc8ff')).toEqual([92, 200, 255, 1]);
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1]);
    expect(parseColor('rgba(148, 170, 214, 0.12)')).toEqual([148, 170, 214, 0.12]);
    expect(parseColor('nonsense')).toBeNull();
    expect(toCss(mix([0, 0, 0, 1], [255, 255, 255, 1], 0.5))).toBe('rgb(128, 128, 128)');
  });

  it('derives dark and light palettes from tokens', () => {
    const dark = deriveTheme((n) => ({ '--bg': '#0a0e16', '--surface': '#141a28', '--accent': '#5cc8ff' })[n] ?? '');
    expect(dark.dark).toBe(true);
    expect(dark.accent).toBe('rgb(92, 200, 255)');
    const light = deriveTheme((n) => ({ '--bg': '#f4f6fb', '--surface': '#ffffff', '--accent': '#0a84d6' })[n] ?? '');
    expect(light.dark).toBe(false);
    expect(light.freqRamp).toHaveLength(4);
  });
});

describe('style', () => {
  const theme = deriveTheme(() => '');
  const data = {
    routes: { type: 'FeatureCollection' as const, features: [] },
    airports: { type: 'FeatureCollection' as const, features: [] },
    visitedCountries: ['US'],
  };

  it('builds an offline style with overlay layers on top', () => {
    const s = buildStyle({ mode: 'night', theme, colorMode: 'frequency', selection: null, globe: true, basemap: null, data });
    expect(s.glyphs).toMatch(/^flightlog:\/\//);
    expect(s.projection).toEqual({ type: 'globe' });
    const ids = s.layers.map((l) => l.id);
    expect(ids[0]).toBe('bg');
    expect(ids[ids.length - 1]).toBe('airports-label');
    expect(ids.indexOf('airports-dot')).toBeGreaterThan(ids.indexOf('routes-hit'));
    expect(Object.keys(s.sources)).toEqual(expect.arrayContaining(['routes', 'airports', 'land']));
    // Replay layers exist but stay hidden until a replay starts.
    const hidden = s.layers.filter((l) => l.id.startsWith('replay-'));
    expect(hidden.length).toBe(5);
    expect(hidden.every((l) => (l.layout as { visibility?: string }).visibility === 'none')).toBe(true);
  });

  it('swaps route layers for replay layers while replaying', () => {
    const fc = { type: 'FeatureCollection' as const, features: [] };
    const replay = { past: fc, live: fc, airports: ['KSAN'], countries: ['MX'] };
    const s = buildStyle({ mode: 'night', theme, colorMode: 'frequency', selection: null, globe: false, basemap: { land: fc, lines: fc } as never, data, replay });
    const vis = (id: string) => (s.layers.find((l) => l.id === id)?.layout as { visibility?: string } | undefined)?.visibility;
    expect(vis('routes-line')).toBe('none');
    expect(vis('replay-trail')).toBe('visible');
    const dot = s.layers.find((l) => l.id === 'airports-dot') as { filter?: unknown };
    expect(JSON.stringify(dot.filter)).toContain('KSAN');
    const visited = s.layers.find((l) => l.id === 'land-visited') as { filter?: unknown };
    expect(JSON.stringify(visited.filter)).toContain('MX');
  });

  it('keeps the overlay when composing a remote style', () => {
    const remote: StyleSpecification = { version: 8, center: [0, 0], zoom: 3, glyphs: 'https://x/{fontstack}/{range}.pbf', sources: { omt: { type: 'vector', url: 'https://x' } }, layers: [{ id: 'water', type: 'background' }] };
    const s = buildStyle({ mode: 'detailed', theme, colorMode: 'year', selection: null, globe: false, basemap: null, data, remote });
    expect(s.center).toBeUndefined();
    expect(s.layers[0].id).toBe('water');
    expect(s.layers.some((l) => l.id === 'routes-line')).toBe(true);
    expect(Object.keys(s.sources)).toEqual(['omt', 'routes', 'airports', 'replay-past', 'replay-live']);
  });

  it('builds selection filters', () => {
    expect(routeFilter({ kind: 'route', id: 'A|B', related: [] })).toEqual(['==', ['get', 'id'], 'A|B']);
    expect(JSON.stringify(routeFilter({ kind: 'airport', id: 'KSAN', related: [] }))).toContain('KSAN');
  });

  it('glyph protocol returns an empty PBF for unknown fonts when offline', async () => {
    const res = await glyphProtocol({ url: 'flightlog://glyphs/Unknown%20Font/0-255.pbf' }, new AbortController());
    expect(res.data.byteLength).toBe(0);
  });
});
