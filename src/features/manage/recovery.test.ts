import { beforeEach, expect, it } from 'vitest';
import { db, addFlight, updateFlight, deleteFlight, undoChange, bulkUpdateFlights, saveTrip, saveTripDocument } from '@/lib/db';
import { qualityIssues } from './quality';
import { compareYears } from '@/features/stats/comparison';
import { commitImport } from '@/services/import/commit';
const input = { date: '2026-04-02', datePrecision: 'day' as const, from: 'KSFO', to: 'KORD', source: 'manual' as const, seatNumber: '12A' };
beforeEach(async () => {
  await Promise.all([db.flights.clear(), db.history.clear(), db.kv.clear(), db.trips.clear()]);
});
const latest = async () => (await db.history.orderBy('at').reverse().toArray()).find((c) => !c.undone)!;
it('restores deleted flights and refuses an undo that would overwrite a later edit', async () => {
  const f = await addFlight(input);
  await deleteFlight(f.id);
  const change = await latest();
  await undoChange(change.id);
  expect((await db.flights.get(f.id))?.seatNumber).toBe('12A');
  await updateFlight(f.id, { seatNumber: '14F' });
  const edit = await latest();
  await updateFlight(f.id, { note: 'Keep this' });
  await expect(undoChange(edit.id)).rejects.toThrow('changed since');
  expect((await db.flights.get(f.id))?.note).toBe('Keep this');
});
it('bulk updates are reversible as one action and preserve IDs and manual attribution', async () => {
  const a = await addFlight(input),
    b = await addFlight({ ...input, date: '2026-04-03' });
  await bulkUpdateFlights([a.id, b.id], { note: 'Family' });
  const c = (await db.history.toArray()).find((h) => h.label === 'Edit flights')!;
  expect(c.before).toHaveLength(2);
  expect((await db.flights.get(a.id))?.fieldSources?.note).toBe('manual');
  await undoChange(c.id);
  expect((await db.flights.get(a.id))?.note).toBeUndefined();
  expect(await db.flights.count()).toBe(2);
});
it('a spreadsheet import is one recoverable action even above the old chunk size', async () => {
  await commitImport({
    add: Array.from({ length: 85 }, (_, i) => ({ ...input, id: `f${i}` })),
    update: [],
    skippedDuplicates: 0,
    skippedRows: 0,
  });
  const changes = await db.history.toArray();
  expect(changes).toHaveLength(1);
  await undoChange(changes[0].id);
  expect(await db.flights.count()).toBe(0);
});
it('cannot restore another account’s history', async () => {
  await db.kv.put({ key: 'sync.owner', value: 'a' });
  await addFlight(input);
  const c = await latest();
  await db.kv.put({ key: 'sync.owner', value: 'b' });
  await expect(undoChange(c.id)).rejects.toThrow('no longer available');
});
it('trip notes use a document and travel with legs; splitting does not copy private notes', async () => {
  const a = await addFlight(input),
    b = await addFlight({ ...input, date: '2026-04-03' });
  const tripId = await saveTrip([a.id, b.id], 'Chicago');
  await saveTripDocument(tripId, { note: 'A great weekend' });
  expect((await db.trips.get(tripId))?.note).toBe('A great weekend');
  expect((await db.flights.get(b.id))?.tripDetails?.note).toBe('A great weekend');
  await saveTrip([b.id], 'Separate trip');
  expect((await db.flights.get(b.id))?.tripDetails).toBeUndefined();
  expect((await db.flights.get(a.id))?.tripDetails?.note).toBe('A great weekend');
});
it('ignores missing optional data and repeated routes at different times, flags real anomalies', async () => {
  const a = await addFlight({ ...input, flightNumber: 'UA123', depTime: '07:00' });
  const b = { ...a, id: 'b', depTime: '19:00' };
  expect(qualityIssues([a, b])).toEqual([]);
  expect(qualityIssues([a, { ...a, id: 'c' }]).map((i) => i.title)).toEqual(['Possible duplicate']);
  expect(qualityIssues([{ ...a, durationMin: 0 }])[0].title).toBe('Check recorded duration');
  expect(
    qualityIssues([
      { ...a, datePrecision: 'year' },
      { ...a, id: 'd', datePrecision: 'year' },
    ]),
  ).toEqual([]);
});
it('year-to-date comparisons exclude future dates and uncertain dates', async () => {
  const a = await addFlight(input);
  const c = compareYears(
    [
      a,
      { ...a, id: 'b', date: '2025-04-02' },
      { ...a, id: 'c', date: '2025-12-01' },
      { ...a, id: 'd', date: '2026-01-01', datePrecision: 'year' },
    ],
    2026,
    '2026-05-01',
  );
  expect(c.current.count).toBe(1);
  expect(c.previous.count).toBe(1);
  expect(c.partial).toBe(true);
});

it('chart filters respect exact dates, seat categories and flown-only views', async () => {
  const { matchesFilters } = await import('@/features/flights/flight-logic');
  const f = await addFlight({ ...input, date: '2025-04-07', seatType: 'window' });
  expect(matchesFilters(f, { month: '4', weekday: '0', seat: 'window', flown: '1' })).toBe(true);
  expect(matchesFilters({ ...f, datePrecision: 'month' }, { weekday: '0' })).toBe(false);
  expect(matchesFilters({ ...f, datePrecision: 'year' }, { month: '4' })).toBe(false);
  expect(matchesFilters({ ...f, date: '2099-04-07' }, { flown: '1' })).toBe(false);
});
