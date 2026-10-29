import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installReference } from '@/test/reference-fixture';
import type { Flight } from '@/lib/types';
import type { PublicProfile, PublicShare } from './profile';
import { PublicSharing } from './PublicSharing';

vi.mock('maplibre-gl', () => ({ default: {} }));

const FLIGHTS: Flight[] = [
  {
    id: 'a', date: '2024-01-14', datePrecision: 'day', from: 'KSAN', to: 'KLAX', airlineIcao: 'ASA', depTime: '08:15', durationMin: 60,
    seatNumber: '12A', seatType: 'window', cabinClass: 'economy', note: 'secret', source: 'manual', createdAt: 1, updatedAt: 1,
  },
];
vi.mock('@/lib/db', () => ({ useFlights: () => FLIGHTS, useSettings: () => ({ distanceUnit: 'km' }) }));
vi.mock('@/services/sync/controller', () => ({
  useCloudSync: () => ({ phase: 'signed-in', userId: 'user-1' }),
  syncBeforeSharing: () => Promise.resolve(),
}));
const publish = vi.fn((_: string, p: Pick<PublicProfile, 'slug' | 'display_name' | 'exact_dates'> & { share: PublicShare }) =>
  Promise.resolve({ ...p, flights: [], published_at: '2026-10-01T10:00:00Z' } as PublicProfile),
);
vi.mock('./api', () => ({
  loadOwnProfile: () =>
    Promise.resolve({ slug: 'jordan', display_name: 'Jordan', flights: [], published_at: '2026-10-01T10:00:00Z', exact_dates: false, share: {} }),
  publishProfile: (id: string, p: Parameters<typeof publish>[1]) => publish(id, p),
  unpublishProfile: () => Promise.resolve(),
  profileError: (e: unknown) => String(e),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeAll(installReference);

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});

async function render() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <MemoryRouter>
        <PublicSharing />
      </MemoryRouter>,
    ),
  );
  for (let i = 0; i < 20 && !host.querySelector('.public-share'); i++) await act(async () => new Promise((r) => setTimeout(r, 25)));
  return host;
}

const toggles = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.public-share [role="switch"]')];
const toggle = (el: HTMLElement, label: string) => toggles(el).find((t) => t.getAttribute('aria-label') === label)!;

describe('public sharing settings', () => {
  it('starts private, explains each category and saves the chosen switches', async () => {
    const el = await render();
    expect(el.querySelector('.public-share__legend')?.textContent).toBe('What visitors can see');
    expect(toggles(el).map((t) => t.getAttribute('aria-label'))).toEqual([
      'Share exact dates',
      'Share flight times',
      'Share cabin class',
      'Share seats',
      'Share trip purpose',
      'Share flight numbers',
      'Share aircraft registrations',
    ]);
    expect(toggles(el).every((t) => t.getAttribute('aria-checked') === 'false')).toBe(true);
    expect(el.textContent).toContain('Flight timesAdds time in the air');
    expect(el.textContent).toContain('Never shared: notes');

    // The preview stays open and follows the switches live.
    const previewBtn = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Preview public journal')!;
    await act(async () => previewBtn.click());
    expect(el.querySelector('.pj-footer')?.textContent).not.toContain('seats');
    await act(async () => toggle(el, 'Share seats').click());
    expect(toggle(el, 'Share seats').getAttribute('aria-checked')).toBe('true');
    expect(el.querySelector('.public-preview')).not.toBeNull();
    for (let i = 0; i < 40 && !el.querySelector('.pj-footer'); i++) await act(async () => new Promise((r) => setTimeout(r, 25)));
    expect(el.querySelector('.pj-footer')?.textContent).toContain('seats');
    expect(el.querySelector('.pj-footer')?.textContent).not.toContain('flight times');

    const save = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Save sharing settings')!;
    await act(async () => save.click());
    expect(publish).toHaveBeenLastCalledWith('user-1', { slug: 'jordan', display_name: 'Jordan', exact_dates: false, share: { seat: true } });
  });

  it('can share everything at once to match the owner’s stats', async () => {
    const el = await render();
    const all = el.querySelector<HTMLButtonElement>('.public-share__all')!;
    expect(all.textContent).toBe('Share everything (match my stats)');
    await act(async () => all.click());
    expect(toggles(el).every((t) => t.getAttribute('aria-checked') === 'true')).toBe(true);
    expect(el.textContent).toContain('flight times, cabin classes, seats, trip purposes, flight numbers, aircraft registrations and saved trips');
    await act(async () => all.click());
    expect(toggles(el).every((t) => t.getAttribute('aria-checked') === 'false')).toBe(true);
  });
});
