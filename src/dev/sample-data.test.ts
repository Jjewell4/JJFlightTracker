import { beforeAll, expect, it } from 'vitest';
import { installReference } from '@/test/reference-fixture';
import { addFlight, db } from '@/lib/db';
import { generateSampleFlights, seedSampleFlights } from './sample-data';

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

it('replaces the log atomically when seeding', async () => {
  await db.flights.clear();
  await addFlight({ date: '2024-01-01', datePrecision: 'day', from: 'KLAX', to: 'KSFO', source: 'manual' });
  // A failing write inside the seed must roll back the delete too.
  const orig = db.flights.bulkPut.bind(db.flights);
  db.flights.bulkPut = (() => Promise.reject(new Error('disk full'))) as unknown as typeof db.flights.bulkPut;
  try {
    await expect(seedSampleFlights()).rejects.toThrow('disk full');
  } finally {
    db.flights.bulkPut = orig;
  }
  expect(await db.flights.count()).toBe(1);
  const n = await seedSampleFlights();
  expect(await db.flights.count()).toBe(n);
});
