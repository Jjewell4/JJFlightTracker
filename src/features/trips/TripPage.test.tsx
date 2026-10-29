import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installReference } from '@/test/reference-fixture';
import { addFlights, db, deleteAllFlights } from '@/lib/db';
import type { FlightInput } from '@/lib/types';
import TripPage from './TripPage';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(installReference);

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  await deleteAllFlights();
});

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

const tick = () => act(async () => new Promise((r) => setTimeout(r, 25)));

async function settle(until: () => boolean) {
  for (let i = 0; i < 40 && !until(); i++) await tick();
}

async function render(path: string) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/trips/:id" element={<TripPage />} />
          <Route path="*" element={<p>elsewhere</p>} />
        </Routes>
        <Where />
      </MemoryRouter>,
    );
  });
  await settle(() => !host!.querySelector('[aria-busy="true"]'));
  return host;
}

const where = () => host!.querySelector('[data-testid="where"]')!.textContent;

const leg = (date: string, from: string, to: string, depTime: string, arrTime: string, flightNumber: string): FlightInput => ({
  date, datePrecision: 'day', from, to, depTime, arrTime, flightNumber, source: 'manual',
});

async function seed() {
  return addFlights([
    leg('2026-03-01', 'KSAN', 'KDEN', '07:00', '10:30', 'UA123'),
    leg('2026-03-01', 'KDEN', 'KBOS', '11:45', '17:50', 'UA456'),
    leg('2026-03-06', 'KBOS', 'KSAN', '08:00', '11:40', 'B6789'),
  ]);
}

describe('TripPage', () => {
  it('shows a suggested trip with its itinerary', async () => {
    const legs = await seed();
    const el = await render(`/trips/auto-${legs[0].id}`);
    expect(el.querySelector('h1')?.textContent).toBe('Boston');
    expect(el.textContent).toContain('Suggested trip');
    expect(el.textContent).toContain('Connection in Denver · 1h 15m');
    expect(el.textContent).toContain('5 nights in Boston');
    expect(el.textContent).toContain('Home again in San Diego');
    const hrefs = [...el.querySelectorAll('.titin a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(legs.map((f) => `/flights/${f.id}`));
  });

  it('follows a stale suggestion id to the trip that now holds its flight', async () => {
    const legs = await seed();
    const el = await render(`/trips/auto-${legs[1].id}`);
    await settle(() => where() === `/trips/auto-${legs[0].id}`);
    expect(where()).toBe(`/trips/auto-${legs[0].id}`);
    expect(el.querySelector('h1')?.textContent).toBe('Boston');
  });

  it('explains when a trip no longer exists', async () => {
    await seed();
    const el = await render('/trips/auto-gone');
    expect(el.textContent).toContain('Trip not found');
    expect(el.querySelector('a[href="/flights?view=trips"]')).not.toBeNull();
  });

  it('saves a suggestion with a name and moves to the saved trip', async () => {
    const legs = await seed();
    const el = await render(`/trips/auto-${legs[0].id}`);
    const save = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Save trip'))!;
    await act(async () => save.click());
    const input = document.querySelector<HTMLInputElement>('.tname input')!;
    expect(input.value).toBe('Boston');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(input, 'Spring conference');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => document.querySelector<HTMLFormElement>('.tname')!.requestSubmit());
    await settle(() => !where().startsWith('/trips/auto-'));

    const stored = await db.flights.bulkGet(legs.map((f) => f.id));
    const tripId = stored[0]!.tripId!;
    expect(stored.every((f) => f?.tripId === tripId && f.tripName === 'Spring conference')).toBe(true);
    expect(where()).toBe(`/trips/${tripId}`);
    await settle(() => el.querySelector('h1')?.textContent === 'Spring conference');
    expect(el.textContent).toContain('Saved trip');
  });
});
