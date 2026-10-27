import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Journey } from './Hero';
import type { Totals } from '@/lib/stats';
const render = (toMoon: number, unit: 'mi' | 'km' = 'mi') => renderToStaticMarkup(<Journey totals={{ toMoon, aroundEarth: toMoon * 384400 / 40075, distanceKm: toMoon * 384400 } as Totals} unit={unit} />);
describe('distance comparison milestones', () => {
  it('shows progress on the next milestone after multiple complete lunar distances', () => {
    const html = render(2.08);
    expect(html).toContain('3× to the Moon');
    expect(html).toContain('aria-valuenow="8"');
    expect(html).toContain('2 complete');
  });
  it('starts a fresh milestone at an exact lunar distance', () => {
    expect(render(2)).toContain('aria-valuenow="0"');
    expect(render(0)).toContain('Your first lunar distance');
    expect(render(0.5)).toContain('aria-valuenow="50"');
  });
  it('uses the selected distance unit for reference values', () => {
    expect(render(0.5, 'km')).toContain('384,400');
    expect(render(0.5, 'mi')).toContain('238,855');
  });
});
