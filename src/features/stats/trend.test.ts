import { describe, expect, it } from 'vitest';
import { trendData } from './trend';

const stats = {
  byYear: [2024, 2025, 2026].map((year, i) => ({ year, flights: i + 1, distanceKm: 0, durationMin: 0, co2Kg: 0 })),
  byMonth: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, flights: i % 3, distanceKm: 0, durationMin: 0 })),
};
const now = new Date(2026, 9, 29);

describe('hero trend bars', () => {
  it('shows flights per year with the current year highlighted', () => {
    const t = trendData(stats, 'all', now);
    expect(t.data.map((d) => [d.label, d.value])).toEqual([
      ['2024', 1],
      ['2025', 2],
      ['2026', 3],
    ]);
    expect(t.highlightKey).toBe('2026');
  });
  it('shows months for one year, highlighting the current month only in the current year', () => {
    const current = trendData(stats, 2026, now);
    expect(current.data).toHaveLength(12);
    expect(current.data[0]).toMatchObject({ label: 'Jan', title: 'January 2026' });
    expect(current.highlightKey).toBe('10');
    expect(trendData(stats, 2024, now).highlightKey).toBeUndefined();
  });
});
