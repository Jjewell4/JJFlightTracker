import { describe, expect, it } from 'vitest';
import { moveItem, normalizeLayout, resolveLayout, STATS_SECTIONS, toLayout } from './layout';

const ids = (l: ReturnType<typeof resolveLayout>) => l.map((s) => s.id);

describe('stats layout', () => {
  it('defaults to every section, in order, shown', () => {
    const l = resolveLayout(undefined);
    expect(ids(l)).toEqual(STATS_SECTIONS.map((s) => s.id));
    expect(l.every((s) => !s.hidden)).toBe(true);
    expect(toLayout(l)).toEqual({});
  });

  it('keeps a saved order and slots in sections it doesn’t know yet after their default neighbour', () => {
    const l = resolveLayout({ order: ['places', 'patterns', 'highlights'], hidden: ['patterns'] });
    expect(ids(l)).toHaveLength(STATS_SECTIONS.length);
    expect(ids(l).indexOf('places')).toBeLessThan(ids(l).indexOf('patterns'));
    expect(ids(l).indexOf('patterns')).toBeLessThan(ids(l).indexOf('highlights'));
    // "calendar" follows "patterns" by default, so it lands right after it.
    expect(ids(l).indexOf('calendar')).toBe(ids(l).indexOf('patterns') + 1);
    expect(l.find((s) => s.id === 'patterns')?.hidden).toBe(true);
  });

  it('drops unknown or repeated ids', () => {
    expect(normalizeLayout({ order: ['places', 'nope', 'places', 3], hidden: 'x', extra: 1 })).toEqual({ order: ['places'] });
    expect(normalizeLayout(null)).toEqual({});
  });

  it('moves items and stores only what differs from the default', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    const moved = moveItem(resolveLayout(undefined), 0, 1);
    expect(toLayout(moved).order?.slice(0, 2)).toEqual(['patterns', 'highlights']);
    expect(toLayout(resolveLayout(undefined).map((s) => ({ ...s, hidden: s.id === 'footprint' })))).toEqual({ hidden: ['footprint'] });
  });
});
