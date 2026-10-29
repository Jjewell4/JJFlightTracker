import { describe, expect, it } from 'vitest';
import { journeyModel, pointOnArc } from './journey';

describe('journeyModel', () => {
  it('describes lifetime totals with lunar milestones', () => {
    const m = journeyModel(2.08 * 384_400, { unit: 'mi' });
    expect(m.heading).toBe('Lifetime distance');
    expect(m.moonCmp).toEqual({ value: '2.08', suffix: '×', caption: 'the distance to the Moon' });
    expect(m.milestone).toBe('2 complete · next: 3× to the Moon');
    expect(m.percent).toBe(8);
    expect(m.arcProgress).toBeCloseTo(0.08, 2);
  });
  it('describes a single year by its own distance, with lifetime context', () => {
    const m = journeyModel(70_000, { scope: 2023, unit: 'km', lifetimeKm: 430_000, prevKm: 50_000 });
    expect(m.heading).toBe('2023 distance');
    expect(m.distanceLabel).toBe('70,000 km');
    expect(m.earth).toMatchObject({ value: '1.75', suffix: '×' });
    expect(m.moonCmp).toEqual({ value: '18', suffix: '%', caption: 'of the way to the Moon' });
    expect(m.arcProgress).toBeCloseTo(70_000 / 384_400, 3);
    expect(m.milestone).toBe('Lifetime through 2023: 1.12× to the Moon');
    expect(m.percentLabel).toBe('12% to 2×');
    expect(m.percent).toBe(12);
    expect(m.context).toBe('▲ 0.5 Earth laps vs 2022');
  });
  it('handles short distances and empty scopes', () => {
    expect(journeyModel(10_000, { scope: 2020, unit: 'mi' }).earth).toEqual({ value: '25', suffix: '%', caption: 'of a lap around the Earth' });
    const empty = journeyModel(0, { scope: 2020, unit: 'mi', lifetimeKm: 0 });
    expect(empty.moonCmp.value).toBe('0');
    expect(empty.milestone).toBe('Lifetime through 2020: 0% of your first lunar distance');
  });
});

describe('pointOnArc', () => {
  it('moves monotonically from Earth to Moon', () => {
    const a = pointOnArc(0);
    const b = pointOnArc(0.5);
    const c = pointOnArc(1);
    expect(a.x).toBeCloseTo(83, 0);
    expect(c.x).toBeCloseTo(324, 0);
    expect(b.x).toBeGreaterThan(a.x);
    expect(c.angle).toBeGreaterThan(0); // descending towards the Moon
  });
});
