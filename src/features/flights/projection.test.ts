import { describe, expect, it } from 'vitest';
import { greatCirclePoints } from '@/lib/geo';
import { fitView, inverseMercator, isLand, landDots, mercator, toPath } from './projection';

describe('mercator', () => {
  it('round-trips', () => {
    const [x, y] = mercator(-117.2, 32.7);
    const [lon, lat] = inverseMercator(x, y);
    expect(lon).toBeCloseTo(-117.2, 6);
    expect(lat).toBeCloseTo(32.7, 6);
  });
});

describe('fitView', () => {
  const san = { lat: 32.73, lon: -117.19 };
  const lhr = { lat: 51.47, lon: -0.45 };
  it('keeps every route point inside the viewport', () => {
    const pts = greatCirclePoints(san, lhr, 64);
    const v = fitView(pts, 400, 220);
    for (const [lon, lat] of pts) {
      const [x, y] = v.project(lon, lat);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(400);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(220);
    }
    // Aspect ratio is preserved (uniform scale).
    expect((v.x1 - v.x0) / (v.y1 - v.y0)).toBeCloseTo(400 / 220, 6);
  });
  it('enforces a minimum span for short hops', () => {
    const v = fitView(greatCirclePoints({ lat: 32.73, lon: -117.19 }, { lat: 33.94, lon: -118.4 }), 400, 200, { minSpanDeg: 30 });
    expect(((v.x1 - v.x0) * 180) / Math.PI).toBeCloseTo(30, 6);
    const [x, y] = v.project(-117.8, 33.3);
    expect(x).toBeCloseTo(200, -1);
    expect(y).toBeCloseTo(100, -1);
  });
  it('inverts screen positions', () => {
    const v = fitView([[10, 10], [40, 30]], 300, 200);
    const [px, py] = v.project(20, 20);
    const [lon, lat] = v.invert(px, py);
    expect(lon).toBeCloseTo(20, 6);
    expect(lat).toBeCloseTo(20, 6);
  });
});

describe('land mask', () => {
  it('knows land from sea', () => {
    expect(isLand(-100, 40)).toBe(true); // Kansas
    expect(isLand(2.3, 48.8)).toBe(true); // Paris
    expect(isLand(-140, 30)).toBe(false); // Pacific
    expect(isLand(-30, 40)).toBe(false); // Atlantic
    expect(isLand(-157.9 + 360, 21.3)).toBe(isLand(-157.9, 21.3)); // wraps
  });
  it('produces a dot grid for a view', () => {
    const v = fitView([[-125, 25], [-65, 50]], 400, 220);
    const dots = landDots(v);
    expect(dots.length).toBeGreaterThan(100);
    for (const [x, y] of dots) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(220);
    }
  });
  it('serializes paths', () => {
    expect(toPath([[0, 0], [1.26, 2]])).toBe('M0.0 0.0L1.3 2.0');
  });
});
