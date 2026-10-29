import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Flight } from '@/lib/types';
import { installReference } from '@/test/reference-fixture';
import { TravelCalendar } from './TravelCalendar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(installReference);

let n = 0;
const leg = (date: string, from: string, to: string, extra: Partial<Flight> = {}): Flight => ({
  id: `f${++n}`,
  date,
  datePrecision: 'day',
  from,
  to,
  depTime: '09:00',
  source: 'manual',
  createdAt: n,
  updatedAt: n,
  ...extra,
});

const flights = [
  leg('2024-03-01', 'KSAN', 'KBOS'),
  leg('2024-03-06', 'KBOS', 'KSAN'),
  leg('2024-05-01', 'KSAN', 'KSEA', { flightNumber: 'AS1' }), // one-way: a lone flight day
  leg('2023-07-10', 'KSAN', 'KJFK'),
  leg('2023-07-20', 'KJFK', 'KSAN'),
];

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname}</p>;
}

async function render(ui: React.ReactNode, router = true) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      router ? (
        <MemoryRouter initialEntries={['/stats']}>
          <Routes>
            <Route path="/stats" element={ui} />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      ) : (
        ui
      ),
    ),
  );
  return host;
}

const key = (el: Element, k: string) => act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));

describe('TravelCalendar', () => {
  it('shows one labelled strip per year with days away and the longest trip', async () => {
    const el = await render(<TravelCalendar flights={flights} scope="all" />);
    const rows = [...el.querySelectorAll('[role="group"]')];
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['2024: 6 days away on 1 trip, 3 flights', '2023: 11 days away on 1 trip, 2 flights']);
    expect(el.querySelector('.tcal-figure__value')?.textContent).toBe('17 days');
    expect(el.textContent).toContain('Longest trip');
    expect(el.textContent).toContain('New York · Jul 2023');
    // Trips are spans; the lone Seattle flight is a tick of its own.
    expect(rows[0].querySelectorAll('.tcal-span')).toHaveLength(1);
    expect(rows[0].querySelectorAll('.tcal-tick')).toHaveLength(3);
    expect(rows[0].querySelectorAll('.tcal-hit')).toHaveLength(2);
  });

  it('is keyboard navigable: focus shows details, arrows move, Enter opens the trip', async () => {
    const el = await render(<TravelCalendar flights={flights} scope="all" />);
    const first = el.querySelector<HTMLButtonElement>('[data-year="2024"] [data-i="0"]')!;
    expect(first.tabIndex).toBe(0);
    expect(first.getAttribute('aria-label')).toBe('Boston, Mar 1 – 6, 2024, 6 days away, 2 flights');
    await act(async () => first.focus());
    expect(el.querySelector('.tcal-pop')?.textContent).toContain('Boston');
    expect(el.querySelector('.tcal-pop a')?.getAttribute('href')).toMatch(/^\/trips\//);

    await key(first, 'ArrowRight');
    const second = el.querySelector<HTMLButtonElement>('[data-year="2024"] [data-i="1"]')!;
    expect(document.activeElement).toBe(second);
    expect(el.querySelector('.tcal-pop')?.textContent).toContain('SAN → SEA');
    expect(el.querySelector('.tcal-pop a')?.getAttribute('href')).toMatch(/^\/flights\/f\d+$/);

    await key(second, 'ArrowDown');
    expect(document.activeElement).toBe(el.querySelector('[data-year="2023"] [data-i="0"]'));
    await key(document.activeElement!, 'Escape');
    expect(el.querySelector('.tcal-pop')).toBeNull();

    await key(document.activeElement!, 'Enter');
    expect(el.querySelector('[data-testid="where"]')?.textContent).toMatch(/^\/trips\//);
  });

  it('picks the nearest mark on tap', async () => {
    const el = await render(<TravelCalendar flights={flights} scope={2024} />);
    const strip = el.querySelector<HTMLElement>('.tcal-strip')!;
    strip.getBoundingClientRect = () => ({ left: 0, top: 0, width: 366, height: 56, right: 366, bottom: 56, x: 0, y: 0, toJSON: () => ({}) });
    const tap = (x: number) =>
      act(async () => {
        strip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: x }));
        strip.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x }));
      });
    await tap(63); // inside Mar 1–6 (days 60–65 in a leap year)
    expect(el.querySelector('.tcal-pop__title')?.textContent).toBe('Boston');
    expect(el.querySelector('.tcal-span.is-active')).not.toBeNull();
    await tap(63); // same mark again hides it
    expect(el.querySelector('.tcal-pop')).toBeNull();
    await tap(127); // a few px from May 1 (day 121)
    expect(el.querySelector('.tcal-pop__title')?.textContent).toBe('Wed, May 1, 2024');
    await tap(250); // empty
    expect(el.querySelector('.tcal-pop')).toBeNull();
    // A single year gets month labels under the strip and no per-row heading.
    expect(el.querySelector('.tcal-axis--below')?.textContent).toContain('Mar');
    expect(el.querySelector('.tcal-row__head')).toBeNull();
  });

  it('never links anywhere in a public journal (rendered without the app router)', async () => {
    const el = await render(<TravelCalendar flights={flights} scope="all" readOnly />, false);
    const first = el.querySelector<HTMLButtonElement>('[data-i="0"]')!;
    await act(async () => first.focus());
    expect(el.querySelector('.tcal-pop')?.textContent).toContain('Boston');
    expect(el.querySelector('.tcal-pop a')).toBeNull();
    await key(first, 'Enter'); // no-op, no crash
  });

  it('shows ten years, then the rest on request, and skips undated flights', async () => {
    const many = Array.from({ length: 13 }, (_, i) => leg(`${2010 + i}-06-01`, 'KSAN', 'KSFO'));
    const el = await render(<TravelCalendar flights={[...many, leg('2022-02-01', 'KSAN', 'KLAX', { datePrecision: 'month' })]} scope="all" />);
    expect(el.querySelectorAll('.tcal-row')).toHaveLength(10);
    const more = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Show 3 earlier years'))!;
    await act(async () => more.click());
    expect(el.querySelectorAll('.tcal-row')).toHaveLength(13);
    expect(el.textContent).toContain('1 flight without an exact date isn’t on the calendar.');
  });
});
