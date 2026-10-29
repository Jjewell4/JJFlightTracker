import { afterEach, describe, expect, it } from 'vitest';
import { sanitizeFlight } from '@/services/import/backup';
import { addFlights, deleteAllFlights, getAllFlights, setOccasion } from './db';
import { FLIGHT_OCCASIONS, OCCASION_ICON, OCCASION_LABELS, parseOccasion } from './occasions';
import { computeStats } from './stats';

afterEach(deleteAllFlights);

describe('occasions', () => {
  it('has a label and emoji for every occasion', () => {
    for (const o of FLIGHT_OCCASIONS) {
      expect(OCCASION_LABELS[o]).toBeTruthy();
      expect(OCCASION_ICON[o]).toBeTruthy();
    }
  });

  it('reads keys, labels and common words from imports', () => {
    expect(parseOccasion('wedding')).toBe('wedding');
    expect(parseOccasion('Work trip')).toBe('work');
    expect(parseOccasion('Sarah’s wedding')).toBe('wedding');
    expect(parseOccasion('Christmas at home')).toBe('holiday');
    expect(parseOccasion('Re:Invent conference')).toBe('conference');
    expect(parseOccasion('Taylor Swift concert')).toBe('event');
    expect(parseOccasion('')).toBeUndefined();
    expect(parseOccasion('???')).toBeUndefined();
    expect(parseOccasion(3)).toBeUndefined();
  });

  it('keeps known occasions in backups and drops unknown ones', () => {
    const base = { date: '2024-05-01', from: 'KSAN', to: 'KSFO' };
    expect(sanitizeFlight({ ...base, occasion: 'vacation' })?.occasion).toBe('vacation');
    expect(sanitizeFlight({ ...base, occasion: 'party' })).not.toHaveProperty('occasion');
  });

  it('tags a trip’s legs, filling only empty reasons, and clears them again', async () => {
    const [a, b] = await addFlights([
      { date: '2024-05-01', datePrecision: 'day', from: 'KSAN', to: 'KSFO', source: 'manual' },
      { date: '2024-05-04', datePrecision: 'day', from: 'KSFO', to: 'KSAN', source: 'manual', reason: 'other' },
    ]);
    await setOccasion([a.id, b.id], 'wedding');
    let all = await getAllFlights();
    const byId = (id: string) => all.find((f) => f.id === id)!;
    expect([byId(a.id).occasion, byId(a.id).reason]).toEqual(['wedding', 'leisure']);
    expect([byId(b.id).occasion, byId(b.id).reason]).toEqual(['wedding', 'other']);
    await setOccasion([a.id, b.id], undefined);
    all = await getAllFlights();
    expect(all.every((f) => !('occasion' in f))).toBe(true);
  });

  it('counts occasions in the stats', () => {
    const f = (occasion?: 'vacation' | 'wedding') => ({ id: Math.random().toString(), date: '2024-01-01', datePrecision: 'day' as const, from: 'KSAN', to: 'KSFO', source: 'manual' as const, createdAt: 0, updatedAt: 0, occasion });
    const s = computeStats([f('vacation'), f('vacation'), f('wedding'), f()]);
    expect(s.occasion.known).toBe(3);
    expect(s.occasion.unknown).toBe(1);
    expect(s.occasion.items.find((i) => i.key === 'vacation')?.count).toBe(2);
  });
});
