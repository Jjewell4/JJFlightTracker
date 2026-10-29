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

  it('draws the whole cabin with the user’s seats, and switches aircraft', async () => {
    await addFlights([
      ...legs(['12A', '14A', '3A', '20F', '9C', '16E', '17C', '18B', '19C']),
      ...legs(['40K', '41A', '42C', '43B', '44H', '45A', '46K', '47D'], 'B77W'),
      f({ from: 'LAX', to: 'SFO', date: '2024-05-01', seatType: 'aisle' }),
      f({ from: 'LAX', to: 'SFO', date: '2024-05-02', aircraftType: 'B738', seatNumber: 'A' }),
    ]);
    const el = await render();
    const card = el.querySelector('.seatmap')!;
    expect(card).not.toBeNull();
    expect(card.querySelector('.stats-card__subtitle')?.textContent).toBe('You sit mid-cabin: median row 16');

    const plane = () => card.querySelector('svg[role="img"]')!;
    expect(plane().getAttribute('aria-label')).toContain('typical A320 · 737 cabin, 32 rows');
    expect(plane().querySelectorAll('.sm-seat')).toHaveLength(32 * 6);
    expect(plane().querySelectorAll('.sm-seat:not([data-level="0"])')).toHaveLength(9);
    expect(card.textContent).toContain('Median row16');
    expect(card.textContent).toContain('1 seat has a letter but no row.');
    expect(card.textContent).toContain('1 more flight has only a seat type: 1 aisle.');

    // The most-used seats are buttons that drive the readout.
    const chips = [...card.querySelectorAll<HTMLButtonElement>('.seatmap-chip')];
    expect(chips.map((c) => c.textContent)).toEqual(['3A', '9C', '12A', '14A', '16E', '17C']);
    const status = () => card.querySelector('[role="status"]')!.textContent;
    expect(status()).toContain('Seat 3A');
    await act(async () => chips[2].click());
    expect(chips[2].getAttribute('aria-pressed')).toBe('true');
    expect(status()).toBe('Seat 12A1 flight · window on the left · over the wing');
    await act(async () => chips[5].click());
    expect(status()).toBe('Seat 17C1 flight · aisle on the left · over the wing');
    await act(async () => chips[1].click());
    expect(status()).toBe('Seat 9C1 flight · aisle on the left · front third');

    const toggle = card.querySelector('[role="radiogroup"][aria-label="Aircraft"]')!;
    const b777 = [...toggle.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '777')!;
    await act(async () => b777.click());
    expect(plane().getAttribute('aria-label')).toContain('typical 777 cabin, 50 rows');
    expect(plane().querySelectorAll('.sm-seat')).toHaveLength(50 * 10);
    expect(status()).toContain('Seat 40K');
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
