import { describe, expect, it } from 'vitest';
import { LAYOUTS, defaultLayoutForLetter, layoutForAircraft, layoutLabel, seatLetter, seatPosition, variantIndex } from './cabin-layout';

describe('layoutForAircraft', () => {
  it.each([
    ['B738', '3-3'], ['b38m', '3-3'], ['A321', '3-3'], ['A20N', '3-3'], ['A19N', '3-3'], ['B752', '3-3'],
    ['BCS3', '2-3'], ['B712', '2-3'], ['MD88', '2-3'],
    ['E75L', '2-2'], ['E190', '2-2'], ['E295', '2-2'], ['CRJ2', '2-2'], ['CRJ9', '2-2'], ['DH8D', '2-2'], ['AT76', '2-2'],
    ['E145', '1-2'],
    ['B763', '2-3-2'], ['A332', '2-4-2'], ['A339', '2-4-2'], ['A306', '2-4-2'], ['A310', '2-4-2'],
    ['B789', '3-3-3'], ['A35K', '3-3-3'], ['A359', '3-3-3'],
    ['B77W', '3-4-3'], ['B744', '3-4-3'], ['A388', '3-4-3'],
  ])('%s → %s', (icao, id) => {
    expect(layoutForAircraft(icao)?.id).toBe(id);
  });

  it('is undefined for unknown or missing types', () => {
    expect(layoutForAircraft(undefined)).toBeUndefined();
    expect(layoutForAircraft('')).toBeUndefined();
    expect(layoutForAircraft('C172')).toBeUndefined();
    expect(layoutForAircraft('MD11')).toBeUndefined();
  });
});

describe('seat letters and positions', () => {
  it('parses seat numbers', () => {
    expect(seatLetter('12A')).toBe('A');
    expect(seatLetter(' 3 k ')).toBe('K');
    expect(seatLetter('A12')).toBeUndefined();
    expect(seatLetter('12')).toBeUndefined();
    expect(seatLetter(undefined)).toBeUndefined();
  });

  it('classifies window / middle / aisle and side', () => {
    const nb = LAYOUTS['3-3'];
    expect([0, 1, 2, 3, 4, 5].map((i) => seatPosition(nb, i).type)).toEqual(['window', 'middle', 'aisle', 'aisle', 'middle', 'window']);
    expect(seatPosition(nb, 0).side).toBe('left');
    expect(seatPosition(nb, 5).side).toBe('right');
    const wb = LAYOUTS['3-4-3'];
    expect(wb.variants[0].join('')).toBe('ABCDEFGHJK');
    expect(Array.from({ length: 10 }, (_, i) => seatPosition(wb, i).type)).toEqual(['window', 'middle', 'aisle', 'aisle', 'middle', 'middle', 'aisle', 'aisle', 'middle', 'window']);
    expect(seatPosition(wb, 4).side).toBe('center');
    const rj = LAYOUTS['1-2'];
    expect([0, 1, 2].map((i) => seatPosition(rj, i).type)).toEqual(['window', 'aisle', 'window']);
    expect(layoutLabel(LAYOUTS['2-4-2'])).toBe('2 | 4 | 2');
  });

  it('keeps real letter conventions, with variants sharing positions', () => {
    const l = LAYOUTS['3-3-3'];
    expect(variantIndex(l.variants[0], 'K')).toBe(8);
    expect(variantIndex(l.variants[1], 'J')).toBe(8);
    expect(variantIndex(LAYOUTS['2-2'].variants[0], 'F')).toBe(3);
  });

  it('falls back by letter range', () => {
    expect(defaultLayoutForLetter('F').id).toBe('3-3');
    expect(defaultLayoutForLetter('K').id).toBe('3-4-3');
  });
});
