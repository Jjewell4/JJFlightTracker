import { describe, expect, it } from 'vitest';
import type { Flight } from '@/lib/types';
import { computeSeatMap, describePosition, dominantThird, seatHeadline, thirdOf, thirdRanges } from './seat-map';

let n = 0;
const fl = (p: Partial<Flight>): Flight =>
  ({ id: String(++n), date: '2024-01-01', datePrecision: 'day', from: 'KLAX', to: 'KSFO', source: 'manual', createdAt: 0, updatedAt: 0, ...p }) as Flight;
const seats = (aircraftType: string | undefined, list: string[]) => list.map((seatNumber) => fl({ aircraftType, seatNumber }));

describe('computeSeatMap', () => {
  it('places seats by row and letter on the plane for each aircraft type', () => {
    const m = computeSeatMap([
      ...seats('B738', ['12A', '12A']),
      ...seats('A320', ['3A']),
      ...seats('A321', ['30F']),
      ...seats('B789', ['40K', '41A']),
    ]);
    expect(m.planes.map((p) => p.key)).toEqual(['narrow:3-3', 'twin:3-3-3', 'narrow-long:3-3']);
    expect(m.drawn).toBe(6);
    const nb = m.planes[0];
    expect(nb.plan.label).toBe('A320 · 737');
    expect(nb.rows).toBe(32);
    expect(nb.letters).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(nb.types).toEqual(['B738', 'A320']);
    expect(nb.seats).toMatchObject([
      { row: 3, index: 0, letter: 'A', count: 1, overWing: false, position: { type: 'window', side: 'left' } },
      { row: 12, index: 0, letter: 'A', count: 2, overWing: true },
    ]);
    expect(nb.stats).toMatchObject({ seats: 3, medianRow: 12, thirds: { front: 1, middle: 2, back: 0 }, windows: { total: 3, overWing: 2, left: 3, right: 0 } });
    expect(nb.stats.wingShare).toBeCloseTo(8 / 32);
    // 787s: K is the right window.
    expect(m.planes[1].seats.find((s) => s.row === 40)).toMatchObject({ index: 8, position: { type: 'window', side: 'right' } });
    expect(m.overall.seats).toBe(6);
    expect(m.overall.windows).toEqual({ total: 6, overWing: 2, left: 4, right: 2 });
  });

  it('draws at least the usual length, at most the maximum, and counts seats beyond', () => {
    const m = computeSeatMap(seats('A320', ['36A', '45F', '2C']));
    expect(m.planes[0].rows).toBe(38);
    expect(m.planes[0].beyond).toBe(1);
    expect(m.planes[0].flights).toBe(3);
    expect(m.drawn).toBe(2);
    expect(computeSeatMap(seats('A320', ['5A'])).planes[0].rows).toBe(32);
  });

  it('infers unknown aircraft from the seat letter and the user’s usual planes', () => {
    const m = computeSeatMap([
      ...seats('E75L', ['10A', '11D']),
      fl({ seatNumber: '9C' }), // A–F: the user's single-aisle plane (E-Jet 2 | 2)
      fl({ seatNumber: '50H' }), // G–K with no widebody flown: 777 3 | 4 | 3
    ]);
    const rj = m.planes.find((p) => p.key === 'ejet:2-2')!;
    expect(rj.flights).toBe(3);
    expect(rj.inferred).toBe(1);
    expect(rj.seats.map((s) => [s.row, s.index])).toEqual([[9, 1], [10, 0], [11, 2]]);
    const wb = m.planes.find((p) => p.key === 'b777:3-4-3')!;
    expect(wb.seats[0]).toMatchObject({ row: 50, index: 7 });
  });

  it('picks the letter variant that fits a type, and merges variants by position', () => {
    // An ATR flown as AB | CD: B is the left aisle and C the right aisle.
    const atr = computeSeatMap(seats('AT76', ['3B', '4C']));
    expect(atr.planes[0].plan.id).toBe('prop');
    expect(atr.planes[0].seats.map((s) => s.index)).toEqual([1, 2]);
    expect(atr.planes[0].letters).toEqual(['A', 'B', 'C', 'D']);
    // 787s lettered GHJ and GHK put J and K in the same right-window seat.
    const dl = computeSeatMap([...seats('B789', ['30J']), ...seats('B788', ['30K'])]);
    expect(dl.planes[0].seats).toMatchObject([{ row: 30, index: 8, count: 2 }]);
  });

  it('keeps row-less, seat-type-only and impossible seats off the map', () => {
    const m = computeSeatMap([
      fl({ aircraftType: 'A320', seatNumber: '12G' }),
      fl({ aircraftType: 'A320', seatNumber: 'A' }),
      fl({ seatType: 'window' }),
      fl({ seatType: 'window' }),
      fl({ seatType: 'aisle', seatNumber: 'n/a' }),
    ]);
    expect(m.drawn).toBe(0);
    expect(m.planes).toEqual([]);
    expect(m.unplaced).toBe(1);
    expect(m.noRow).toBe(1);
    expect(m.typeOnly).toEqual({ window: 2, middle: 0, aisle: 1 });
  });

  it('resolves IATA aircraft codes through the lookup', () => {
    const m = computeSeatMap([fl({ aircraftType: '738', seatNumber: '1F' })], (c) => (c === '738' ? 'B738' : undefined));
    expect(m.planes[0].key).toBe('narrow:3-3');
    expect(m.planes[0].inferred).toBe(0);
  });
});

describe('insights', () => {
  it('splits the cabin into thirds', () => {
    expect([1, 11, 12, 21, 22, 32].map((r) => thirdOf(r, 32))).toEqual(['front', 'front', 'middle', 'middle', 'back', 'back']);
    expect(thirdRanges(32)).toEqual({ front: [1, 11], middle: [12, 21], back: [22, 32] });
  });

  it('leads with a clear window habit and the wing', () => {
    const m = computeSeatMap(seats('A320', ['12A', '14F', '3A', '20F', '25A', '9C']));
    expect(seatHeadline(m.overall, m.planes[0])).toBe('Window seat person — 40% of your window seats looked out at the wing');
  });

  it('otherwise says where in the cabin, with the median row', () => {
    const front = computeSeatMap(seats('A320', ['3C', '4D', '5C', '6B', '20C']));
    expect(dominantThird(front.planes[0].stats)).toBe('front');
    expect(seatHeadline(front.overall, front.planes[0])).toBe('You sit toward the front: median row 5');
    const spread = computeSeatMap(seats('A320', ['3C', '15D', '28C', '5B', '18E', '30D']));
    expect(seatHeadline(spread.overall, spread.planes[0])).toBe('You spread out across the cabin: median row 17');
  });

  it('describes positions in plain words', () => {
    expect(describePosition({ block: 0, side: 'left', type: 'window' })).toBe('window on the left');
    expect(describePosition({ block: 1, side: 'center', type: 'aisle' })).toBe('aisle in the center block');
    expect(describePosition({ block: 1, side: 'right', type: 'middle' })).toBe('middle seat on the right');
  });
});
