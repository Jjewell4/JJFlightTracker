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

describe('seat heatmap', () => {
  const legs = (seats: string[], aircraftType = 'B738') =>
    seats.map((seat, i) => f({ from: 'LAX', to: 'SFO', date: `2024-04-${String(i + 1).padStart(2, '0')}`, aircraftType, seatNumber: seat }));

  it('draws a cabin row shaded by how often each seat was picked', async () => {
    await addFlights([...legs(['12A', '14A', '3A', '20F', '9C', '16E']), ...legs(['40K', '41A', '42C', '43B', '44H'], 'B77W'), f({ from: 'LAX', to: 'SFO', date: '2024-05-01', seatType: 'aisle' })]);
    const el = await render();
    const card = el.querySelector('.seatmap')!;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain('You pick A most — window on the left');
    expect(card.textContent).toContain('Narrowbody');
    expect(card.textContent).toContain('Widebody');
    const rows = card.querySelectorAll('.seatmap-cabin');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelectorAll('button')).toHaveLength(6);
    expect(rows[1].querySelectorAll('button')).toHaveLength(10);
    const seatA = rows[0].querySelector<HTMLButtonElement>('button[aria-label^="Seat A,"]')!;
    expect(seatA.getAttribute('aria-label')).toBe('Seat A, window on the left: 3 flights');
    expect(seatA.dataset.level).toBe('4');
    expect(rows[0].querySelector('button[aria-label^="Seat B,"]')?.getAttribute('data-level')).toBe('0');
    expect(card.textContent).toContain('1 more flight has only a seat type: 1 aisle.');

    const seatF = rows[0].querySelector<HTMLButtonElement>('button[aria-label^="Seat F,"]')!;
    await act(async () => seatF.click());
    expect(seatF.getAttribute('aria-pressed')).toBe('true');
    expect(card.querySelector('[role="status"]')?.textContent).toContain('Seat F · window on the right');
  });

  it('stays hidden with too few seat numbers', async () => {
    await addFlights(legs(['12A', '14A', '3A', '20F']));
    const el = await render();
    expect(el.textContent).toContain('4 flights flown');
    expect(el.querySelector('.seatmap')).toBeNull();
  });
});

describe('highlight icons', () => {
  it('match what each highlight is about', async () => {
    const { insightIcon } = await import('./insight-icons');
    expect(insightIcon({ id: 'seat', kind: 'window' })).toBe('window');
    expect(insightIcon({ id: 'seat', kind: 'aisle' })).toBe('aisle');
    expect(insightIcon({ id: 'hour', kind: 'morning' })).toBe('sunrise');
    expect(insightIcon({ id: 'hour', kind: 'evening' })).toBe('moon');
    expect(insightIcon({ id: 'reason', kind: 'business' })).toBe('briefcase');
    expect(insightIcon({ id: 'reason', kind: 'leisure' })).toBe('palm');
    expect(insightIcon({ id: 'haul' })).toBe('route');
    expect(insightIcon({ id: 'cabin' })).toBe('glass');
  });
});
