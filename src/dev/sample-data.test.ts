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
});
