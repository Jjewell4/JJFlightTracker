import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { installReference } from '@/test/reference-fixture';
import { PublicDashboard } from './PublicDashboard';
import type { PublicFlight, PublicProfile } from './profile';

// jsdom has no WebGL, so the map falls back to its static view; MapLibre itself can't load there.
vi.mock('maplibre-gl', () => ({ default: {} }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(installReference);

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  window.history.replaceState(null, '', '/');
});

const month = (date: string, from: string, to: string, extra: Partial<PublicFlight> = {}): PublicFlight => ({
  date: `${date}-01`,
  datePrecision: 'month',
  from,
  to,
  airlineIcao: 'ASA',
  airlineIata: 'AS',
  aircraftType: 'B739',
  ...extra,
});

const FLIGHTS: PublicFlight[] = [
  month('2025-06', 'KSAN', 'KSEA'),
  month('2025-06', 'KSEA', 'KSAN'),
  month('2024-03', 'KLAX', 'EGLL', { airlineIcao: 'BAW', airlineIata: 'BA', aircraftType: 'A35K' }),
  month('2024-03', 'EGLL', 'KLAX', { airlineIcao: 'BAW', airlineIata: 'BA', aircraftType: 'A35K' }),
  month('2023-11', 'KSAN', 'KJFK'),
  month('2023-11', 'KJFK', 'KSAN'),
];

const profile = (flights = FLIGHTS): PublicProfile => ({
  slug: 'jordan',
  display_name: 'Jordan',
  flights,
  published_at: '2026-10-01T10:00:00Z',
  exact_dates: flights.some((f) => f.datePrecision === 'day'),
});

/** Renders like the public page does: no router anywhere above the journal. */
async function render(path: string, p = profile(), preview = false) {
  window.history.replaceState(null, '', path);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<PublicDashboard profile={p} preview={preview} unit="mi" />));
  // Let lazily loaded screens resolve.
  for (let i = 0; i < 40 && (host.querySelector('.page-loader, [aria-busy="true"]') || !host.querySelector('.pj-content, .pj-map')); i++) {
    await act(async () => new Promise((r) => setTimeout(r, 25)));
  }
  return host;
}

/** No public view may link to a flight page or into the owner's app. */
function expectNoPrivateLinks(el: HTMLElement) {
  const hrefs = [...el.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')!);
  expect(hrefs.filter((h) => h.includes('/flights') || h.startsWith('#/') || h.includes('/import'))).toEqual([]);
}

describe('public journal', () => {
  it('opens on an overview with deep-linkable section tabs', async () => {
    const el = await render('/jordan');
    expect(el.querySelector('h1')?.textContent).toBe('Jordan');
    expect(el.textContent).toContain('Flying since 2023');
    expect(el.textContent).toContain('Top route');
    const tabs = [...el.querySelectorAll<HTMLAnchorElement>('.pj-tab')];
    expect(tabs.map((t) => t.textContent)).toEqual(['Overview', 'Map', 'Stats', 'Flights']);
    expect(tabs.map((t) => t.getAttribute('href'))).toEqual(['/jordan', '/jordan?view=map', '/jordan?view=stats', '/jordan?view=flights']);
    expect(tabs[0].getAttribute('aria-current')).toBe('page');
    expectNoPrivateLinks(el);

    await act(async () => tabs[3].click());
    expect(window.location.search).toBe('?view=flights');
    expect(el.querySelector('.pj-tab[aria-current="page"]')?.textContent).toBe('Flights');
  });

  it('shows stats that public data supports and hides the rest', async () => {
    const el = await render('/jordan?view=stats');
    const text = el.textContent ?? '';
    const cards = [...el.querySelectorAll('.stats-card__title')].map((h) => h.textContent);
    const records = [...el.querySelectorAll('.stats-record__label')].map((p) => p.textContent);
    expect(cards).toEqual(
      expect.arrayContaining(['Year by year', 'Seasonality', 'Domestic vs international', 'Flight length', 'Boeing or Airbus?', 'Airports', 'Airlines', 'Routes', 'Aircraft']),
    );
    for (const absent of ['Cabin class', 'Seat', 'Reason', 'Departure time', 'Day of the week', 'Tail numbers']) expect(cards).not.toContain(absent);
    expect(records).toContain('Longest flight');
    for (const absent of ['Most time aloft', 'Quickest hop', 'Busiest day']) expect(records).not.toContain(absent);
    expect(text).toContain('Est. time in the air');
    // No "add a cabin" prompts or empty seat charts for visitors.
    expect(text).not.toMatch(/Add (a|seat|aircraft)|window seat|Not recorded yet/i);
    // Records render as plain cards: there are no flight pages to open.
    expect(el.querySelector('.stats-record.card--interactive')).toBeNull();
    expectNoPrivateLinks(el);
  });

  it('adds day-of-week patterns when exact dates are shared', async () => {
    const exact = FLIGHTS.map((f, i) => ({ ...f, date: `${f.date.slice(0, 8)}${String(10 + i).padStart(2, '0')}`, datePrecision: 'day' as const }));
    const el = await render('/jordan?view=stats', profile(exact));
    expect(el.textContent).toContain('Day of the week');
    expect(el.textContent).not.toContain('Departure time');
  });

  it('scopes stats to the year in the URL and keeps it in sync', async () => {
    const el = await render('/jordan?view=stats&year=2024');
    expect(el.querySelector('.stats-hero__kicker')?.textContent).toContain('2024');
    const all = [...el.querySelectorAll<HTMLButtonElement>('.stats-scope__chip')].find((b) => b.textContent?.startsWith('All time'))!;
    await act(async () => all.click());
    expect(window.location.search).toBe('?view=stats');
  });

  it('filters the flight list by airport from the URL', async () => {
    const el = await render('/jordan?view=flights&airport=EGLL');
    expect(el.querySelectorAll('.pj-flight')).toHaveLength(2);
    expect(el.querySelector('.pj-section-head span')?.textContent).toBe('2 of 6');
    const chip = el.querySelector<HTMLButtonElement>('.pj-filter')!;
    expect(chip.textContent).toContain('LHR');
    await act(async () => chip.click());
    expect(el.querySelectorAll('.pj-flight')).toHaveLength(6);
    expect(window.location.search).toBe('?view=flights');
  });

  it('renders the interactive map without the app shell or flight links', async () => {
    const el = await render('/jordan?view=map');
    expect(el.querySelector('.map-page--embedded')).not.toBeNull();
    expect(el.textContent).toContain('6 flights');
    expectNoPrivateLinks(el);
  });

  it('shows friendly empty states when nothing has been shared', async () => {
    const el = await render('/jordan', profile([]));
    expect(el.textContent).toContain('No flights shared yet');
    await act(async () => el.querySelectorAll<HTMLAnchorElement>('.pj-tab')[2].click());
    for (let i = 0; i < 40 && !el.querySelector('.stats-empty'); i++) await act(async () => new Promise((r) => setTimeout(r, 25)));
    expect(el.querySelector('.stats-empty')?.textContent).toContain('No flights shared yet');
    expectNoPrivateLinks(el);
  });

  it('previews the same journal in the app without touching the page URL', async () => {
    window.history.replaceState(null, '', '/#/settings');
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(<PublicDashboard profile={profile()} preview unit="km" />));
    const tabs = [...host.querySelectorAll<HTMLElement>('.pj-tab')];
    expect(tabs.every((t) => t.tagName === 'BUTTON')).toBe(true);
    await act(async () => tabs[2].click());
    for (let i = 0; i < 40 && !host.querySelector('.stats-hero'); i++) await act(async () => new Promise((r) => setTimeout(r, 25)));
    expect(host.querySelector('.stats-hero')).not.toBeNull();
    expect(window.location.hash).toBe('#/settings');
    expect(window.location.search).toBe('');
    expectNoPrivateLinks(host);
  });
});
