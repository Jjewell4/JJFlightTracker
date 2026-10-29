import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installReference } from '@/test/reference-fixture';
import { addFlights, deleteAllFlights } from '@/lib/db';
import { enrichFlight } from '@/lib/flight-utils';
import type { FlightInput } from '@/lib/types';
import StatsPage from './StatsPage';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(installReference);

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  await deleteAllFlights();
});

async function render(path = '/stats') {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[path]}>
        <StatsPage />
      </MemoryRouter>,
    );
  });
  // Let Dexie live queries resolve.
  for (let i = 0; i < 20 && host.querySelector('[aria-busy="true"]'); i++) {
    await act(async () => new Promise((r) => setTimeout(r, 20)));
  }
  return host;
}

const f = (p: Partial<FlightInput> & Pick<FlightInput, 'from' | 'to' | 'date'>): FlightInput =>
  enrichFlight({ datePrecision: 'day', source: 'manual', ...p });

describe('StatsPage', () => {
  it('shows the empty state with calls to action', async () => {
    const el = await render();
    expect(el.textContent).toContain('Your flying story starts here');
    const hrefs = [...el.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/flights/new');
    expect(hrefs).toContain('/import');
  });

  it('renders the dashboard and scopes to a year', async () => {
    await addFlights([
      f({ from: 'LAX', to: 'SFO', date: '2024-03-04', depTime: '08:00', arrTime: '09:25', flightNumber: 'UA100', cabinClass: 'economy', seatType: 'window' }),
      f({ from: 'SFO', to: 'LAX', date: '2024-03-08', depTime: '18:00', arrTime: '19:30', flightNumber: 'UA101', cabinClass: 'economy', seatType: 'window' }),
      f({ from: 'LAX', to: 'LHR', date: '2025-06-01', depTime: '17:00', arrTime: '11:30', flightNumber: 'BA282', cabinClass: 'business', seatType: 'aisle' }),
    ]);
    const el = await render();
    expect(el.textContent).toContain('3 flights flown');
    expect(el.querySelector('[role="radiogroup"][aria-label="Time period"]')).not.toBeNull();
    expect(el.textContent).toContain('Records');
    expect(el.textContent).toContain('United Kingdom');
    expect(el.querySelector('a[href^="/flights/"]')).not.toBeNull();
    // Flights per year as bars (not a smoothed line), with a value per bar for keyboard/tap.
    expect(el.querySelector('.stats-hero [role="img"]')?.getAttribute('aria-label')).toBe('Flights per year, 2024–2025');
    expect([...el.querySelectorAll('.stats-hero .viz-hit')].map((r) => r.getAttribute('aria-label'))).toEqual(['2024: 2 flights', '2025: 1 flight']);
    // The owner keeps every section, including in-app links.
    expect(el.textContent).toContain('Cabin class');
    expect(el.textContent).toContain('Departure time');

    const chip2025 = [...el.querySelectorAll<HTMLButtonElement>('.stats-scope__chip')].find((b) => b.textContent?.startsWith('2025'))!;
    await act(async () => chip2025.click());
    expect(chip2025.getAttribute('aria-checked')).toBe('true');
    expect(el.querySelector('.stats-hero__kicker')?.textContent).toContain('2025');
    expect(el.textContent).toContain('Month by month');
  });
});
