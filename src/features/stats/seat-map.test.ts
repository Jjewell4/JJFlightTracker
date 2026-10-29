import { describe, expect, it } from 'vitest';
import type { Flight } from '@/lib/types';
import { computeSeatMap, describePosition } from './seat-map';

let n = 0;
const fl = (p: Partial<Flight>): Flight =>
  ({ id: String(++n), date: '2024-01-01', datePrecision: 'day', from: 'KLAX', to: 'KSFO', source: 'manual', createdAt: 0, updatedAt: 0, ...p }) as Flight;

describe('computeSeatMap', () => {
  it('groups seats by the aircraft layout and counts positions', () => {
    const m = computeSeatMap([
      fl({ aircraftType: 'B738', seatNumber: '12A' }),
      fl({ aircraftType: 'A320', seatNumber: '3A' }),
      fl({ aircraftType: 'A321', seatNumber: '30F' }),
      fl({ aircraftType: 'B789', seatNumber: '40K' }),
      fl({ aircraftType: 'B789', seatNumber: '41A' }),
    ]);
    expect(m.placed).toBe(5);
    expect(m.groups.map((g) => g.layout.id)).toEqual(['3-3', '3-3-3']);
    expect(m.groups[0].counts).toEqual([2, 0, 0, 0, 0, 1]);
    expect(m.groups[0].letters).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(m.groups[1].counts[8]).toBe(1);
    expect(m.top).toMatchObject({ letter: 'A', count: 2, position: { type: 'window', side: 'left' } });
    expect(m.sides).toEqual({ left: 3, center: 0, right: 2 });
  });

  it('infers unknown aircraft from the seat letter and the user’s usual layouts', () => {
    const m = computeSeatMap([
      fl({ aircraftType: 'E75L', seatNumber: '10A' }),
      fl({ aircraftType: 'E75L', seatNumber: '11D' }),
      fl({ seatNumber: '9C' }), // A–F: the user's single-aisle layout (2 | 2)
      fl({ seatNumber: '50H' }), // G–K with no widebody flown: 3 | 4 | 3
    ]);
    const rj = m.groups.find((g) => g.layout.id === '2-2')!;
    expect(rj.flights).toBe(3);
    expect(rj.inferred).toBe(1);
    expect(rj.counts).toEqual([1, 1, 1, 0]);
    const wb = m.groups.find((g) => g.layout.id === '3-4-3')!;
    expect(wb.counts[7]).toBe(1);
  });

  it('picks the letter variant that fits a type, and merges variants by position', () => {
    // An ATR flown as AB | CD: B is the left aisle and C the right aisle.
    const atr = computeSeatMap([fl({ aircraftType: 'AT76', seatNumber: '3B' }), fl({ aircraftType: 'AT76', seatNumber: '4C' })]);
    expect(atr.groups[0].counts).toEqual([0, 1, 1, 0]);
    expect(atr.groups[0].letters).toEqual(['A', 'B', 'C', 'D']);
    // 787s lettered GHJ and GHK put J and K in the same right-window seat.
    const dl = computeSeatMap([fl({ aircraftType: 'B789', seatNumber: '30J' }), fl({ aircraftType: 'B788', seatNumber: '31K' })]);
    expect(dl.groups[0].counts[8]).toBe(2);
  });

  it('keeps seat-type-only flights and impossible letters out of the grid', () => {
    const m = computeSeatMap([
      fl({ aircraftType: 'A320', seatNumber: '12G' }),
      fl({ seatType: 'window' }),
      fl({ seatType: 'window' }),
      fl({ seatType: 'aisle', seatNumber: 'n/a' }),
    ]);
    expect(m.placed).toBe(0);
    expect(m.unplaced).toBe(1);
    expect(m.typeOnly).toEqual({ window: 2, middle: 0, aisle: 1 });
    expect(m.top).toBeUndefined();
  });

  it('resolves IATA aircraft codes through the lookup', () => {
    const m = computeSeatMap([fl({ aircraftType: '738', seatNumber: '1F' })], (c) => (c === '738' ? 'B738' : undefined));
    expect(m.groups[0].layout.id).toBe('3-3');
    expect(m.groups[0].inferred).toBe(0);
  });

  it('describes positions in plain words', () => {
    expect(describePosition({ block: 0, side: 'left', type: 'window' })).toBe('window on the left');
    expect(describePosition({ block: 1, side: 'center', type: 'aisle' })).toBe('aisle in the center block');
    expect(describePosition({ block: 1, side: 'right', type: 'middle' })).toBe('middle seat on the right');
  });
});
