import { afterEach, describe, expect, it } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installReference } from '@/test/reference-fixture';
import { addFlights, deleteAllFlights } from '@/lib/db';
import { ALL_FIELDS } from '@/lib/flight-source';
import { enrichFlight } from '@/lib/flight-utils';
import { computeStats } from '@/lib/stats';
import type { Flight, FlightInput } from '@/lib/types';
import { analyzeFlights } from '@/features/map/map-data';
import { AirportSheet, RouteSheet } from '@/features/map/MapSheet';
import { statsSections } from '@/features/stats/sections';
import { TopLists } from '@/features/stats/TopLists';
import AirlinePage from './AirlinePage';
import AirportPage from './AirportPage';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Installed at import time: the fixtures below are enriched while collecting tests.
installReference();

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  await deleteAllFlights();
});

let path = '';
function Where() {
  path = useLocation().pathname;
  return null;
}

async function render(node: ReactNode, at = '/') {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[at]}>
        <Where />
        {node}
      </MemoryRouter>,
    );
  });
  // Let Dexie live queries resolve.
  for (let i = 0; i < 30 && host.querySelector('[aria-busy="true"]'); i++) {
    await act(async () => new Promise((r) => setTimeout(r, 20)));
  }
  return host;
}

const pages = (
  <Routes>
    <Route path="/airports/:ident" element={<AirportPage />} />
    <Route path="/airlines/:key" element={<AirlinePage />} />
  </Routes>
);

const fi = (p: Partial<FlightInput> & Pick<FlightInput, 'from' | 'to' | 'date'>): FlightInput =>
  enrichFlight({ datePrecision: 'day', source: 'manual', ...p });

const SAMPLE: FlightInput[] = [
  fi({ from: 'SAN', to: 'SEA', date: '2025-06-01', flightNumber: 'AS100', cabinClass: 'economy' }),
  fi({ from: 'SEA', to: 'SAN', date: '2025-06-08', flightNumber: 'AS101', cabinClass: 'first' }),
  fi({ from: 'SAN', to: 'LHR', date: '2023-01-02', flightNumber: 'BA272' }),
];

const hrefs = (el: HTMLElement) => [...el.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')!);

describe('airport page', () => {
  it('redirects an IATA code to the ident and shows the history', async () => {
    await addFlights(SAMPLE);
    const el = await render(pages, '/airports/san');
    expect(path).toBe('/airports/KSAN');
    expect(el.querySelector('h1')?.textContent).toBe('SAN');
    expect(el.textContent).toContain('San Diego International Airport');
    expect(el.textContent).toContain('Destinations from here');
    expect(hrefs(el)).toContain('/airports/KSEA');
    expect(hrefs(el)).toContain('/airlines/ASA');
    expect(el.querySelectorAll('.frow')).toHaveLength(3);
  });

  it('handles airports never visited and unknown codes', async () => {
    await addFlights(SAMPLE);
    let el = await render(pages, '/airports/RJTT');
    expect(el.textContent).toContain('You haven’t flown here yet');
    expect(el.querySelector('h1')?.textContent).toBe('HND');
    await act(async () => root?.unmount());
    host?.remove();
    el = await render(pages, '/airports/KXYZ-UNKNOWN');
    expect(el.textContent).toContain('Unknown airport');
  });
});

describe('airline page', () => {
  it('resolves IATA codes and shows totals, routes and cabins', async () => {
    await addFlights(SAMPLE);
    const el = await render(pages, '/airlines/AS');
    expect(path).toBe('/airlines/ASA');
    expect(el.querySelector('h1')?.textContent).toMatch(/Alaska/);
    expect(el.textContent).toContain('of your 3 flights');
    expect(el.textContent).toContain('Top routes');
    expect(el.textContent).toContain('Cabin & seat');
    expect(hrefs(el)).toContain('/airports/KSAN');
  });

  it('shows a friendly message for unknown airlines', async () => {
    const el = await render(pages, '/airlines/XQZ');
    expect(el.textContent).toContain('Unknown airline');
  });
});

describe('entry points', () => {
  const flights = SAMPLE.map((f, i) => ({ ...f, id: `f${i}`, createdAt: i, updatedAt: i }) as Flight);

  it('links top airports and airlines only in the owner’s stats', async () => {
    const stats = computeStats(flights);
    const sections = statsSections(ALL_FIELDS, stats);
    let el = await render(<TopLists stats={stats} unit="mi" sections={sections} />);
    expect(hrefs(el)).toEqual(expect.arrayContaining(['/airports/KSAN', '/airlines/ASA']));
    await act(async () => root?.unmount());
    host?.remove();
    el = await render(<TopLists stats={stats} unit="mi" sections={sections} readOnly />);
    expect(hrefs(el).filter((h) => h.startsWith('/airports') || h.startsWith('/airlines'))).toEqual([]);
  });

  it('links the map airport and route cards only for the owner', async () => {
    const analysis = analyzeFlights(flights);
    const san = analysis.airports.find((a) => a.airport.ident === 'KSAN')!;
    const route = analysis.routes.find((r) => r.key === 'KSAN|KSEA')!;
    const noop = () => {};
    const settings = { distanceUnit: 'mi' as const, clock: '12h' as const };
    let el = await render(
      <>
        <AirportSheet agg={san} year={null} onClose={noop} onSelectRoute={noop} />
        <RouteSheet route={route} year={null} settings={settings} onClose={noop} onSelectAirport={noop} />
      </>,
    );
    expect(hrefs(el)).toEqual(expect.arrayContaining(['/airports/KSAN', '/airlines/ASA']));
    await act(async () => root?.unmount());
    host?.remove();
    el = await render(
      <>
        <AirportSheet agg={san} year={null} readOnly onClose={noop} onSelectRoute={noop} />
        <RouteSheet route={route} year={null} settings={settings} readOnly onClose={noop} onSelectAirport={noop} />
      </>,
    );
    expect(hrefs(el)).toEqual([]);
  });
});
