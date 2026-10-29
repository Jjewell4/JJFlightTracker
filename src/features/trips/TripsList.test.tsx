import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installReference } from '@/test/reference-fixture';
import { addFlights, deleteAllFlights } from '@/lib/db';
import type { FlightInput } from '@/lib/types';
import { FlightsPage } from '@/features/flights/FlightsPage';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(installReference);

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  await deleteAllFlights();
  localStorage.clear();
});

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}

const tick = () => act(async () => new Promise((r) => setTimeout(r, 25)));

async function render(path: string) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/flights" element={<FlightsPage />} />
          <Route path="/" element={<FlightsPage />} />
        </Routes>
        <Where />
      </MemoryRouter>,
    );
  });
  for (let i = 0; i < 40 && (host.querySelector('[aria-busy="true"]') || !host.querySelector('.page-header')); i++) await tick();
  return host;
}

const leg = (date: string, from: string, to: string, extra: Partial<FlightInput> = {}): FlightInput => ({
  date, datePrecision: 'day', from, to, depTime: '09:00', source: 'manual', ...extra,
});

const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text))!;

describe('Log → Trips', () => {
  it('switches between flights and trips, keeping the choice in the URL', async () => {
    await addFlights([leg('2025-03-01', 'KSAN', 'KBOS'), leg('2025-03-06', 'KBOS', 'KSAN'), leg('2026-04-10', 'KSAN', 'KSFO'), leg('2026-04-12', 'KSFO', 'KSAN')]);
    const el = await render('/flights');
    expect(el.querySelector('.tcard')).toBeNull();
    await act(async () => button(el, 'Trips').click());
    expect(el.querySelector('[data-testid="where"]')!.textContent).toBe('/flights?view=trips');

    // Newest first, grouped by year, linking to the trip pages.
    expect([...el.querySelectorAll('.tyear__year')].map((y) => y.textContent)).toEqual(['2026', '2025']);
    const cards = [...el.querySelectorAll<HTMLAnchorElement>('a.tcard')];
    expect(cards.map((c) => c.querySelector('.tcard__title')!.textContent)).toEqual(['San Francisco', 'Boston']);
    expect(cards[1].textContent).toContain('SAN→BOS→SAN');
    expect(cards[1].textContent).toContain('2 flights · 5 nights');
    expect(cards[1].getAttribute('href')).toMatch(/^\/trips\/auto-/);

    // The one gentle hint, dismissed for good.
    expect(el.textContent).toContain('We found 2 trips in your log.');
    await act(async () => el.querySelector<HTMLButtonElement>('.trips-intro__close')!.click());
    expect(el.querySelector('.trips-intro')).toBeNull();
    expect(localStorage.getItem('flightlog.tripsIntroDismissed')).toBe('1');

    await act(async () => button(el, 'Flights').click());
    expect(el.querySelector('[data-testid="where"]')!.textContent).toBe('/flights');
    expect(el.querySelector('.tcard')).toBeNull();
    expect(el.querySelectorAll('a.frow')).toHaveLength(4);
  });

  it('filters to saved trips and explains when there are none', async () => {
    await addFlights([
      leg('2025-03-01', 'KSAN', 'KBOS', { tripId: 't1', tripName: 'Boston marathon' }),
      leg('2025-03-06', 'KBOS', 'KSAN', { tripId: 't1' }),
      leg('2026-04-10', 'KSAN', 'KSFO'),
      leg('2026-04-12', 'KSFO', 'KSAN'),
    ]);
    const el = await render('/flights?view=trips');
    expect(el.querySelector('.trips-intro')).toBeNull(); // already using trips
    expect(el.querySelectorAll('a.tcard')).toHaveLength(2);
    await act(async () => button(el, 'Saved').click());
    const cards = [...el.querySelectorAll('a.tcard')];
    expect(cards).toHaveLength(1);
    expect(cards[0].classList.contains('tcard--saved')).toBe(true);
    expect(cards[0].textContent).toContain('Boston marathon');
    expect(cards[0].getAttribute('href')).toBe('/trips/t1');
  });

  it('shows an empty state when nothing chains into a trip', async () => {
    await addFlights([leg('2025-03-01', 'KSAN', 'KBOS'), leg('2025-05-01', 'KSAN', 'KSEA', { datePrecision: 'month' })]);
    const el = await render('/flights?view=trips');
    expect(el.textContent).toContain('No trips yet');
  });

  it('leaves Home alone', async () => {
    await addFlights([leg('2025-03-01', 'KSAN', 'KBOS'), leg('2025-03-06', 'KBOS', 'KSAN')]);
    const el = await render('/?view=trips');
    expect(el.querySelector('.logswitch')).toBeNull();
    expect(el.querySelector('.tcard')).toBeNull();
  });
});
