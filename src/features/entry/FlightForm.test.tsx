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

const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === text || b.getAttribute('aria-label') === text)!;
const dialog = () => document.querySelector('[role="alertdialog"]');

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

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
    typeInto(document.querySelector<HTMLInputElement>('#entry-dep')!, '08:00');
    await settle();
    expect((window.history.state as { __overlay?: string }).__overlay).toBeTruthy();

    await act(async () => button('Close').click());
    await settle();
    expect(dialog()?.textContent).toContain('Discard changes?');

    await act(async () => button('Keep editing').click());
    await settle();
    expect(document.querySelector('#entry-dep')).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>('#entry-dep')!.value).toBe('08:00');

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
    typeInto(document.querySelector<HTMLInputElement>('#entry-dep')!, '08:00');
    typeInto(document.querySelector<HTMLInputElement>('#entry-arr')!, '09:30');
    await settle();
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
    typeInto(document.querySelector<HTMLInputElement>('#entry-dep')!, '08:00');
    await settle();
    await act(async () => button('Save changes').click());
    await settle();
    await settle();
    expect(window.location.hash).toBe(`#/flights/${f.id}`);
    expect((await db.flights.get(f.id))?.depTime).toBe('08:00');
  });

  it('deleting with unsaved edits skips past the deleted flight', async () => {
    await openEdit();
    typeInto(document.querySelector<HTMLInputElement>('#entry-dep')!, '08:00');
    await settle();
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
