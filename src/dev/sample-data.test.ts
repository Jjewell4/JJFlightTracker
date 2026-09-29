import { beforeAll, expect, it } from 'vitest';
import { installReference } from '@/test/reference-fixture';
import { generateSampleFlights } from './sample-data';

beforeAll(installReference);

it('generates a realistic sample', async () => {
  const flights = await generateSampleFlights();
  expect(flights.length).toBeGreaterThan(230);
  expect(flights.every((f) => f.from.length === 4 && f.to.length === 4)).toBe(true);
  expect(flights.filter((f) => f.durationMin).length).toBe(flights.length);
  expect(flights.filter((f) => f.airlineIcao).length).toBe(flights.length);
  // Durations must match the block-time model (no time-zone skew).
  for (const f of flights) {
    const expected = Math.round(35 + ((f.distanceKm ?? 0) / 800) * 60);
    expect(Math.abs((f.durationMin ?? 0) - expected)).toBeLessThanOrEqual(1);
  }
});
