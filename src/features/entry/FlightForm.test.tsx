import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HashRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { addFlight, db } from '@/lib/db';
import type { Flight } from '@/lib/types';
import { installReference } from '@/test/reference-fixture';
import { FlightForm } from './FlightForm';
import { emptyValues, flightToValues, nonEmptyGroups } from './form-model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  installReference();
  window.scrollTo = (() => Promise.resolve()) as unknown as typeof window.scrollTo; // not implemented in jsdom
});

let host: HTMLDivElement;
let root: Root;

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  await db.flights.clear();
});

const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));

function Home() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate('/flights/new')}>
      Home
    </button>
  );
}

function Mounted({ onMount }: { onMount: () => void }) {
  useEffect(onMount, [onMount]);
  return null;
}

async function openForm() {
  window.history.replaceState(null, '', '#/');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <HashRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route
            path="/flights/new"
            element={<FlightForm mode="new" initial={emptyValues({ date: '2024-03-04', from: 'KSAN', to: 'KSFO' })} initialEdited={[]} flights={[]} />}
          />
          <Route path="/flights/:id" element={<Mounted onMount={() => undefined} />} />
        </Routes>
      </HashRouter>,
    ),
  );
  await act(async () => button('Home').click());
  await settle();
}

const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text || b.getAttribute('aria-label') === text)!;
const dialog = () => document.querySelector('[role="alertdialog"]');

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Sets a time through the picker sheet ("Type" mode). Setting departure moves on to arrival: pass `arr` or it is left for later. */
async function setTimes(dep: string, arr?: string) {
  await act(async () => document.querySelector<HTMLButtonElement>('#entry-dep')!.click());
  await settle();
  await act(async () => button('Type').click());
  typeInto(document.querySelector<HTMLInputElement>('.tp__input')!, dep);
  await act(async () => button('Set departure time').click());
  await settle();
  if (arr === undefined) {
    await act(async () => button('Later').click());
  } else {
    await act(async () => button('Type').click());
    typeInto(document.querySelector<HTMLInputElement>('.tp__input')!, arr);
    await act(async () => button('Set arrival time').click());
  }
  await settle();
}

const depText = () => document.querySelector('#entry-dep')?.textContent ?? '';

describe('FlightForm unsaved-changes guard', () => {
  it('leaves straight away when nothing was edited', async () => {
    await openForm();
    expect(document.querySelector('#entry-dep')).not.toBeNull();
    await act(async () => button('Close').click());
    await settle();
    expect(dialog()).toBeNull();
    expect(button('Home')).toBeDefined();
  });

  it('asks before discarding edits (Close button and system Back)', async () => {
    await openForm();
    await setTimes('08:00');
    expect(depText()).toContain('8:00 AM');
    expect((window.history.state as { __overlay?: string }).__overlay).toBeTruthy();

    await act(async () => button('Close').click());
    await settle();
    expect(dialog()?.textContent).toContain('Discard changes?');

    await act(async () => button('Keep editing').click());
    await settle();
    expect(depText()).toContain('8:00 AM');

    // Android Back behaves the same way.
    await act(async () => window.history.back());
    await settle();
    expect(dialog()?.textContent).toContain('Discard changes?');

    await act(async () => button('Discard').click());
    await settle();
    await settle();
    expect(document.querySelector('#entry-dep')).toBeNull();
    expect(button('Home')).toBeDefined();
  });

  it('saving does not trigger the guard, leaves no stray history entry and asks for persistent storage', async () => {
    const persist = vi.fn(async () => true);
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { persist, persisted: async () => false } });
    await openForm();
    await setTimes('08:00', '09:30');
    expect(document.querySelector('.times-card__duration')?.textContent).toContain('1h 30m');
    await act(async () => button('Save flight').click());
    await settle();
    await settle();
    expect(dialog()).toBeNull();
    expect(await db.flights.count()).toBe(1);
    expect(window.location.hash).toMatch(/^#\/flights\/[\w-]+$/);
    expect((window.history.state as { __overlay?: string } | null)?.__overlay).toBeUndefined();
    expect(persist).toHaveBeenCalledOnce();
    Reflect.deleteProperty(navigator, 'storage');
  });
});

function Detail() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate('edit')}>
      Detail
    </button>
  );
}

async function openEdit(): Promise<Flight> {
  const f = await addFlight({ date: '2024-03-04', datePrecision: 'day', from: 'KSAN', to: 'KSFO', source: 'manual' });
  window.history.replaceState(null, '', '#/');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const initial = flightToValues(f);
  await act(async () =>
    root.render(
      <HashRouter>
        <Routes>
          <Route path="/" element={<p>Home screen</p>} />
          <Route path="/flights/:id" element={<Detail />} />
          <Route path="/flights/:id/edit" element={<FlightForm mode="edit" initial={initial} initialEdited={nonEmptyGroups(initial)} base={f} flights={[f]} />} />
        </Routes>
      </HashRouter>,
    ),
  );
  // Home → detail → edit, so there is real history to go back through.
  window.history.pushState({ usr: null, key: 'd', idx: 1 }, '', `#/flights/${f.id}`);
  window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
  await settle();
  await act(async () => button('Detail').click());
  await settle();
  return f;
}

describe('FlightForm guard with edit/delete navigation', () => {
  it('saving an edit returns to the detail screen', async () => {
    const f = await openEdit();
    await setTimes('08:00');
    await act(async () => button('Save changes').click());
    await settle();
    await settle();
    expect(window.location.hash).toBe(`#/flights/${f.id}`);
    expect((await db.flights.get(f.id))?.depTime).toBe('08:00');
  });

  it('deleting with unsaved edits skips past the deleted flight', async () => {
    await openEdit();
    await setTimes('08:00');
    await act(async () => button('Delete flight').click());
    await settle();
    const confirm = [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent === 'Delete flight') as HTMLButtonElement;
    await act(async () => confirm.click());
    await settle();
    await settle();
    expect(window.location.hash).toBe('#/');
    expect(host.textContent).toContain('Home screen');
  });
});

describe('FlightForm fill shortcuts', () => {
  it('opens quick entry in a sheet, validates, then fills and highlights the form', async () => {
    await openForm();
    // One compact row of shortcuts instead of inline panels.
    expect(document.querySelector('.entry-assist')?.textContent).toBe('Scan screenshotQuick entry');
    expect(document.querySelector('.qe-input')).toBeNull();
    await act(async () => button('Quick entry').click());
    await settle();
    const input = document.querySelector<HTMLInputElement>('.qe-input')!;
    expect(document.activeElement).toBe(input);
    typeInto(input, 'SAN-QQQQ 2026-10-27');
    await act(async () => button('Fill flight details').click());
    expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('Use two known airport codes');
    typeInto(input, 'LAX to JFK 2026-10-27 B6124');
    await act(async () => button('Fill flight details').click());
    await settle();
    expect(document.querySelector('.qe-input')?.closest('.sheet:not(.is-closing)')).toBeFalsy();
    const from = document.querySelector('.route-end--from')!;
    expect(from.textContent).toContain('LAX');
    expect(document.querySelector('.route-end--to')!.textContent).toContain('JFK');
    expect(from.classList).toContain('is-filled');
    expect(document.querySelector('.date-field')!.classList).toContain('is-filled');
    expect(document.querySelector<HTMLInputElement>('#entry-fn')!.value).toBe('B6 124');
    // Editing a highlighted field clears its highlight.
    await act(async () => button('Today').click());
    expect(document.querySelector('.date-field')!.classList).not.toContain('is-filled');
  });

  it('opens the screenshot scanner in a sheet (sign-in prompt when signed out)', async () => {
    await openForm();
    await act(async () => button('Scan screenshot').click());
    await settle();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Sign in to scan screenshots');
  });
});

async function openFormWith(existing: Flight[], initial = emptyValues({ date: '2024-03-04', from: 'KSAN', to: 'KSFO' })) {
  window.history.replaceState(null, '', '#/');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <HashRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/flights/new" element={<FlightForm mode="new" initial={initial} initialEdited={[]} flights={existing} />} />
          <Route path="/flights/:id" element={<p>Flight detail</p>} />
        </Routes>
      </HashRouter>,
    ),
  );
  await act(async () => button('Home').click());
  await settle();
}

const notice = () => document.querySelector('.dup-note');
/** Text with non-breaking spaces as plain spaces. */
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\u00a0/g, ' ');

async function pickArrival(code: string) {
  await act(async () => document.querySelector<HTMLButtonElement>('.route-end--to')!.click());
  await settle();
  typeInto(document.querySelector<HTMLInputElement>('[role="dialog"] input')!, code);
  await settle();
  await settle();
  const option = [...document.querySelectorAll<HTMLElement>('[role="dialog"] [role="option"]')].find((b) => b.textContent?.includes(code))!;
  await act(async () => option.click());
  await settle();
}

describe('FlightForm duplicate warning', () => {
  it('warns inline and asks before saving a second copy', async () => {
    const existing = await addFlight({ date: '2024-03-04', datePrecision: 'day', from: 'KSAN', to: 'KSFO', flightNumber: 'AS1234', source: 'manual' });
    await openFormWith([existing]);
    expect(text(notice())).toContain('You already logged SAN → SFO on Mar 4, 2024 (AS 1234)');
    expect(notice()?.querySelector('a')?.getAttribute('href')).toBe(`#/flights/${existing.id}`);

    await act(async () => button('Save flight').click());
    await settle();
    expect(dialog()?.textContent).toContain('Save a second copy?');
    expect(text(dialog())).toContain('You already logged SAN → SFO on Mar 4, 2024 (AS 1234).');
    await act(async () => button('Cancel').click());
    await settle();
    expect(await db.flights.count()).toBe(1);

    await act(async () => button('Save flight').click());
    await settle();
    await act(async () => button('Save anyway').click());
    await settle();
    await settle();
    expect(await db.flights.count()).toBe(2);
    expect(window.location.hash).toMatch(/^#\/flights\/[\w-]+$/);
    expect((window.history.state as { __overlay?: string } | null)?.__overlay).toBeUndefined();
  });

  it('saving anyway with unsaved edits leaves no stray history entry', async () => {
    const existing = await addFlight({ date: '2024-03-04', datePrecision: 'day', from: 'KSAN', to: 'KSFO', source: 'manual' });
    await openFormWith([existing], emptyValues({ date: '2024-03-04', from: 'KSAN', to: '' }));
    await pickArrival('SFO');
    expect((window.history.state as { __overlay?: string }).__overlay).toBeTruthy();
    await act(async () => button('Save flight').click());
    await settle();
    expect(dialog()?.textContent).toContain('Save a second copy?');
    // Back closes the confirmation and keeps the form (and its guard).
    await act(async () => window.history.back());
    await act(async () => new Promise((r) => setTimeout(r, 300))); // exit animation
    expect(dialog()).toBeNull();
    expect((window.history.state as { __overlay?: string }).__overlay).toBeTruthy();
    await act(async () => button('Save flight').click());
    await settle();
    await act(async () => button('Save anyway').click());
    await settle();
    await settle();
    expect(await db.flights.count()).toBe(2);
    expect(window.location.hash).toMatch(/^#\/flights\/[\w-]+$/);
    expect(window.location.hash).not.toBe(`#/flights/${existing.id}`);
    expect((window.history.state as { __overlay?: string } | null)?.__overlay).toBeUndefined();
    await act(async () => window.history.back());
    await settle();
    expect(button('Home')).toBeDefined();
  });

  it('"It’s a different flight" acknowledges the warning so Save goes straight through', async () => {
    const existing = await addFlight({ date: '2024-03-04', datePrecision: 'day', from: 'KSAN', to: 'KSFO', source: 'manual' });
    await openFormWith([existing]);
    await act(async () => button('It’s a different flight').click());
    expect(notice()).toBeNull();
    await act(async () => button('Save flight').click());
    await settle();
    await settle();
    expect(dialog()).toBeNull();
    expect(await db.flights.count()).toBe(2);
  });

  it('does not flag a return flight the same day, and only hints at a flight one day off', async () => {
    const out = await addFlight({ date: '2024-03-04', datePrecision: 'day', from: 'KSFO', to: 'KSAN', source: 'manual' });
    const slip = await addFlight({ date: '2024-03-05', datePrecision: 'day', from: 'KSAN', to: 'KSFO', source: 'manual' });
    await openFormWith([out]);
    expect(notice()).toBeNull();
    await act(async () => root.unmount());
    host.remove();

    await openFormWith([out, slip]);
    expect(notice()?.classList).toContain('dup-note--soft');
    expect(text(notice())).toContain('Similar flight on Mar 5, 2024');
    await act(async () => button('Save flight').click());
    await settle();
    await settle();
    expect(dialog()).toBeNull();
    expect(await db.flights.count()).toBe(3);
  });

  it('asks before leaving unsaved edits to view the other flight', async () => {
    const existing = await addFlight({ date: '2024-03-04', datePrecision: 'day', from: 'KSAN', to: 'KSFO', source: 'manual' });
    await openFormWith([existing], emptyValues({ date: '2024-03-04', from: 'KSAN', to: '' }));
    expect(notice()).toBeNull();
    // Completing the route makes it a match (and the form dirty).
    await pickArrival('SFO');
    expect(text(notice())).toContain('You already logged SAN → SFO');

    // With unsaved edits "View it" is a button that asks first, not a plain link.
    expect(notice()!.querySelector('a')).toBeNull();
    await act(async () => notice()!.querySelector<HTMLButtonElement>('.dup-note__link')!.click());
    await settle();
    expect(dialog()?.textContent).toContain('Leave without saving?');
    await act(async () => button('View other flight').click());
    await settle();
    await settle();
    expect(window.location.hash).toBe(`#/flights/${existing.id}`);
    expect(host.textContent).toContain('Flight detail');
  });
});

describe('FlightForm duplicate warning when editing', () => {
  async function openEditOf(f: Flight, all: Flight[]) {
    window.history.replaceState(null, '', `#/flights/${f.id}/edit`);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const initial = flightToValues(f);
    await act(async () =>
      root.render(
        <HashRouter>
          <Routes>
            <Route path="/flights/:id" element={<p>Flight detail</p>} />
            <Route path="/flights/:id/edit" element={<FlightForm mode="edit" initial={initial} initialEdited={nonEmptyGroups(initial)} base={f} flights={all} />} />
          </Routes>
        </HashRouter>,
      ),
    );
    await settle();
  }

  it('points out an existing twin but saves other changes without asking', async () => {
    const a = await addFlight({ date: '2024-03-04', datePrecision: 'day', from: 'KSAN', to: 'KSFO', source: 'manual' });
    const b = await addFlight({ date: '2024-03-04', datePrecision: 'day', from: 'KSAN', to: 'KSFO', source: 'manual' });
    await openEditOf(a, [a, b]);
    expect(text(notice())).toContain('You already logged SAN → SFO on Mar 4, 2024');
    expect(text(notice())).toContain('Both copies are in your log');
    await setTimes('08:00');
    await act(async () => button('Save changes').click());
    await settle();
    await settle();
    expect(dialog()).toBeNull();
    expect((await db.flights.get(a.id))?.depTime).toBe('08:00');
  });

  it('asks before an edit turns a flight into a copy of another', async () => {
    const a = await addFlight({ date: '2024-03-04', datePrecision: 'day', from: 'KSAN', to: 'KLAX', source: 'manual' });
    const b = await addFlight({ date: '2024-03-04', datePrecision: 'day', from: 'KSAN', to: 'KSFO', source: 'manual' });
    await openEditOf(a, [a, b]);
    expect(notice()).toBeNull();
    await pickArrival('SFO');
    expect(text(notice())).toContain('With these changes the two would match.');
    await act(async () => button('Save changes').click());
    await settle();
    expect(dialog()?.textContent).toContain('Save a duplicate?');
    await act(async () => button('Save anyway').click());
    await settle();
    await settle();
    expect((await db.flights.get(a.id))?.to).toBe('KSFO');
  });
});
