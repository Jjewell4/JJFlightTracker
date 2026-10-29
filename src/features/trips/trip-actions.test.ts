import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { installReference } from '@/test/reference-fixture';
import { addFlights, db, deleteAllFlights, deleteFlight, getAllFlights, renameTrip, saveTrip, unsaveTrip } from '@/lib/db';
import { detectTrips, tripTitle } from '@/lib/trips';
import type { FlightInput } from '@/lib/types';

beforeAll(installReference);
afterEach(deleteAllFlights);

const leg = (date: string, from: string, to: string, depTime: string, arrTime: string): FlightInput => ({
  date,
  datePrecision: 'day',
  from,
  to,
  depTime,
  arrTime,
  source: 'manual',
});

async function seedBoston() {
  const legs = await addFlights([
    leg('2026-03-01', 'KSAN', 'KDEN', '07:00', '10:30'),
    leg('2026-03-01', 'KDEN', 'KBOS', '11:45', '17:50'),
    leg('2026-03-06', 'KBOS', 'KSAN', '08:00', '11:40'),
  ]);
  const [other] = await addFlights([leg('2026-05-01', 'KSAN', 'KSEA', '09:00', '11:40')]);
  return { legs, other };
}

const wait = () => new Promise((r) => setTimeout(r, 5));

describe('saved trips in the database', () => {
  it('saves a suggestion: one tripId and name on every leg, updatedAt bumped for sync', async () => {
    const { legs, other } = await seedBoston();
    await wait();
    const id = await saveTrip(legs.map((f) => f.id), '  Boston conference ');
    expect(id).toBeTruthy();
    const stored = await db.flights.bulkGet(legs.map((f) => f.id));
    for (const [i, f] of stored.entries()) {
      expect(f).toMatchObject({ tripId: id, tripName: 'Boston conference' });
      expect(f!.updatedAt).toBeGreaterThan(legs[i].updatedAt);
      expect(f!.createdAt).toBe(legs[i].createdAt);
    }
    expect(await db.flights.get(other.id)).toEqual(other);

    const trips = detectTrips(await getAllFlights());
    const saved = trips.find((t) => t.saved)!;
    expect(saved).toMatchObject({ id, name: 'Boston conference' });
    expect(saved.flights).toHaveLength(3);
  });

  it('renames (empty name falls back to the destination) and ungroups without touching the flights', async () => {
    const { legs } = await seedBoston();
    const id = await saveTrip(legs.map((f) => f.id), 'Work');
    await renameTrip(id, 'Sprint offsite');
    expect((await db.flights.get(legs[2].id))?.tripName).toBe('Sprint offsite');

    await renameTrip(id, '   ');
    const unnamed = detectTrips(await getAllFlights()).find((t) => t.id === id)!;
    expect(unnamed.name).toBeUndefined();
    expect(tripTitle(unnamed)).toBe('Boston');

    const before = await db.flights.get(legs[0].id);
    await wait();
    expect(await unsaveTrip(id)).toBe(3);
    const after = await db.flights.get(legs[0].id);
    expect(after).not.toHaveProperty('tripId');
    expect(after).not.toHaveProperty('tripName');
    expect(after!.updatedAt).toBeGreaterThan(before!.updatedAt);
    expect({ ...after, updatedAt: 0 }).toEqual({ ...before, tripId: undefined, tripName: undefined, updatedAt: 0 } as unknown as typeof after);
    // Back to being a suggestion.
    expect(detectTrips(await getAllFlights()).filter((t) => !t.saved)).toHaveLength(1);
  });

  it('keeps the rest of a saved trip when one of its flights is deleted', async () => {
    const { legs } = await seedBoston();
    const id = await saveTrip(legs.map((f) => f.id), 'Boston');
    await deleteFlight(legs[1].id);
    let trip = detectTrips(await getAllFlights()).find((t) => t.id === id)!;
    expect(trip.flights.map((f) => f.id)).toEqual([legs[0].id, legs[2].id]);
    await deleteFlight(legs[2].id);
    trip = detectTrips(await getAllFlights()).find((t) => t.id === id)!;
    expect(trip.flights).toHaveLength(1);
    expect(trip.saved).toBe(true);
  });

  it('refuses to save a trip whose flights are all gone', async () => {
    await expect(saveTrip(['nope'], 'Ghost')).rejects.toThrow();
  });
});
