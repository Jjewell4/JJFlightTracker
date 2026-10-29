import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installReference } from '@/test/reference-fixture';
import { db, deleteAllFlights, getAllFlights } from '@/lib/db';
import { enrichFlight } from '@/lib/flight-utils';
import type { DraftLeg, Flight, ImportDraft } from '@/lib/types';
import { checkLeg, checkLegs, defaultSelection, legFormValues, looksLikeTrip, saveLegs, suggestedTripName } from './draft-legs';

beforeAll(installReference);
beforeEach(async () => {
  await deleteAllFlights();
  await db.drafts.clear();
});

const leg = (p: Partial<DraftLeg> = {}): DraftLeg => ({
  date: '2026-10-21',
  from: 'MCO',
  to: 'SFO',
  flightNumber: 'UA2620',
  depTime: '18:59',
  arrTime: '21:50',
  arrDayOffset: null,
  aircraftType: 'B38M',
  seatNumber: '12A',
  ...p,
});
const back = leg({ date: '2026-10-25', from: 'SFO', to: 'MCO', flightNumber: 'UA2621', depTime: '08:00', arrTime: '16:20' });
const existing = (p: Partial<Flight>) => ({ ...enrichFlight({ date: '2026-10-21', datePrecision: 'day', from: 'KMCO', to: 'KSFO', source: 'manual' as const, ...p }), id: 'x1', createdAt: 1, updatedAt: 1 }) as Flight;

describe('draft legs', () => {
  it('fills the form like a screenshot would, inferring seat side and airline', () => {
    const v = legFormValues(leg(), { cabinClass: 'economy' });
    expect(v).toMatchObject({ from: 'KMCO', to: 'KSFO', flightNumber: 'UA 2620', seatType: 'window', cabinClass: 'economy', aircraftType: 'B38M' });
    expect(v.airline?.iata).toBe('UA');
  });

  it('is ready to save when complete, with distance and duration filled in', () => {
    const c = checkLeg(leg(), 0, []);
    expect(c.problems).toEqual([]);
    expect(c.input).toMatchObject({ source: 'screenshot', from: 'KMCO', to: 'KSFO', depTime: '18:59' });
    expect(c.input!.distanceKm).toBeGreaterThan(3000);
    expect(c.input!.durationMin).toBeGreaterThan(300);
  });

  it('explains what a leg still needs', () => {
    expect(checkLeg(leg({ date: '' }), 0, []).problems).toEqual(['Needs the date']);
    expect(checkLeg(leg({ to: 'ZZZ' }), 0, []).problems).toEqual(['Unknown airport ZZZ']);
    expect(checkLeg(leg({ from: '' }), 0, []).problems).toEqual(['Needs the departure airport']);
    expect(checkLeg(leg({ date: '' }), 0, []).input).toBeUndefined();
  });

  it('spots flights already in the log and leaves them out of the default selection', () => {
    const checks = checkLegs([leg(), back], [existing({ flightNumber: 'UA2620' })]);
    expect(checks[0].duplicate?.id).toBe('x1');
    expect(checks[1].duplicate).toBeUndefined();
    expect([...defaultSelection(checks)]).toEqual([1]);
  });

  it('skips legs already handled', () => {
    const checks = checkLegs([leg(), back], [], { handled: [0] });
    expect(checks[0].handled).toBe(true);
    expect([...defaultSelection(checks)]).toEqual([1]);
  });

  it('treats legs within a few weeks as one trip', () => {
    const a = checkLeg(leg(), 0, []).input!;
    const b = checkLeg(back, 1, []).input!;
    expect(looksLikeTrip([a, b])).toBe(true);
    expect(looksLikeTrip([a])).toBe(false);
    expect(looksLikeTrip([a, checkLeg(leg({ date: '2027-03-01', from: 'SFO', to: 'MCO' }), 2, []).input!])).toBe(false);
  });

  it('suggests a trip name for unsaved legs', () => {
    const a = checkLeg(leg(), 0, []).input!;
    const b = checkLeg(back, 1, []).input!;
    expect(suggestedTripName([b, a])).toMatch(/San Francisco/);
    expect(suggestedTripName([])).toBe('');
  });

  it('saves several legs at once as one trip and clears the draft', async () => {
    const draft: ImportDraft = { id: 'd1', source: 'screenshot', status: 'ready', createdAt: 1, updatedAt: 1, result: { flights: [leg(), back], warnings: [] }, handled: [] };
    await db.drafts.put(draft);
    const checks = checkLegs(draft.result!.flights, []);
    const { saved, tripId } = await saveLegs('d1', checks, { name: '  Bay Area  ' });
    expect(saved.map((f) => f.from)).toEqual(['KMCO', 'KSFO']);
    const all = await getAllFlights();
    expect(all).toHaveLength(2);
    expect(all.every((f) => f.tripId === tripId && f.tripName === 'Bay Area')).toBe(true);
    expect(await db.drafts.get('d1')).toBeUndefined();
  });

  it('keeps the draft while some legs are left, and saves single flights without a trip', async () => {
    await db.drafts.put({ id: 'd2', source: 'screenshot', status: 'ready', createdAt: 1, updatedAt: 1, result: { flights: [leg(), back], warnings: [] }, handled: [] });
    const [first] = checkLegs([leg(), back], []);
    const { saved, tripId } = await saveLegs('d2', [first], { name: 'Ignored for one leg' });
    expect(tripId).toBeUndefined();
    expect(saved[0].tripId).toBeUndefined();
    expect((await db.drafts.get('d2'))?.handled).toEqual([0]);
  });
});
