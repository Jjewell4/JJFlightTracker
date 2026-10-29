import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { installReference } from '@/test/reference-fixture';
import { emptyValues, timing, type FormValues } from './form-model';
import { TimesCard } from './TimesCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(installReference);

let host: HTMLDivElement;
let root: Root;
let current: FormValues;

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

function Harness({ initial, clock }: { initial: FormValues; clock: '12h' | '24h' }) {
  const [v, setV] = useState(initial);
  current = v;
  // Same contract as FlightForm.setTimes: a time change resets a pinned day offset.
  return <TimesCard v={v} clock={clock} onChange={(p) => setV((cur) => ({ ...cur, ...('arrDayOffset' in p ? p : { ...p, arrDayOffset: undefined }) }))} />;
}

async function mount(p: Partial<FormValues> = {}, clock: '12h' | '24h' = '12h') {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness initial={emptyValues({ date: '2026-10-27', from: 'KSAN', to: 'KJFK', ...p })} clock={clock} />));
}

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));
/** The open picker (a closing sheet stays mounted briefly to animate out). */
const sheet = () => document.querySelector<HTMLElement>('.sheet:not(.is-closing) [role="dialog"]');
const byText = (text: string, root: ParentNode = document) =>
  [...root.querySelectorAll<HTMLElement>('button, [role="radio"]')].find((b) => b.textContent?.trim() === text || b.getAttribute('aria-label') === text)!;
const click = (el: Element) => act(async () => (el as HTMLElement).click());
const key = (el: Element, k: string) => act(async () => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));
const listbox = (name: string) => sheet()!.querySelector<HTMLElement>(`[role="listbox"][aria-label="${name}"]`)!;
const display = () => sheet()!.querySelector('.tp__display')!.textContent!.replace('Departs', '').replace('Arrives', '').replace(/\s+/g, ' ').trim();

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('TimesCard time picker', () => {
  it('shows times in the user’s clock and opens a picker per field', async () => {
    await mount({ depTime: '07:05', arrTime: '15:42' });
    expect(document.querySelector('#entry-dep')!.textContent).toContain('7:05 AM');
    expect(document.querySelector('#entry-arr')!.textContent).toContain('3:42 PM');
    await click(document.querySelector('#entry-arr')!);
    await settle();
    expect(sheet()!.textContent).toContain('Arrival time');
    expect(display()).toBe('3:42 PM');
    expect(byText('Set arrival time')).toBeDefined();
  });

  it('steps the wheels with the keyboard and sets the time', async () => {
    await mount();
    await click(document.querySelector('#entry-dep')!);
    await settle();
    const hour = listbox('Hour');
    expect(display()).toBe('9:00 AM');
    await key(hour, 'ArrowDown');
    await key(hour, 'ArrowDown');
    await key(listbox('Minute'), 'PageDown');
    await key(listbox('AM or PM'), 'ArrowDown');
    expect(display()).toBe('11:10 PM');
    const selected = hour.querySelector('[aria-selected="true"]')!;
    expect(selected.textContent).toBe('11');
    expect(hour.getAttribute('aria-activedescendant')).toBe(selected.id);
    // Enter on a wheel confirms.
    await key(hour, 'Enter');
    await settle();
    // Arrival is empty, so the sheet moves straight on to it…
    expect(sheet()!.textContent).toContain('Departure set · 11:10 PM');
    expect(sheet()!.textContent).toContain('Arrival time');
    // …and "Later" keeps the departure.
    await click(byText('Later'));
    await settle();
    expect(current.depTime).toBe('23:10');
    expect(current.arrTime).toBe('');
  });

  it('suggests an arrival from distance and time zones, then saves both times together', async () => {
    await mount();
    await click(document.querySelector('#entry-dep')!);
    await settle();
    await click(byText('Set departure time'));
    await settle();
    // Departure is held until the arrival step finishes.
    expect(current.depTime).toBe('');
    const chip = sheet()!.querySelector<HTMLButtonElement>('.tp__chip')!;
    expect(chip.textContent).toContain('≈ 5:15 PM');
    expect(chip.textContent).toContain('est. 5h 14m');
    // The wheels start on the estimate.
    expect(display()).toBe('5:15 PM');
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    await key(listbox('Minute'), 'ArrowDown');
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    await click(chip);
    expect(display()).toBe('5:15 PM');
    await click(byText('Set arrival time'));
    await settle();
    expect(sheet()).toBeNull();
    expect(current).toMatchObject({ depTime: '09:00', arrTime: '17:15' });
    expect(timing(current)?.durationMin).toBe(315);
    expect(document.querySelector('.times-card__duration')!.textContent).toContain('5h 15m');
  });

  it('accepts a typed time with the AM/PM toggle', async () => {
    await mount({ arrTime: '23:00' });
    await click(document.querySelector('#entry-dep')!);
    await settle();
    await click(byText('Type'));
    const input = sheet()!.querySelector<HTMLInputElement>('input')!;
    type(input, '7:3');
    expect((byText('Set departure time') as HTMLButtonElement).disabled).toBe(true);
    expect(sheet()!.querySelector('.tp__hint')!.textContent).toContain('Try');
    type(input, '735');
    expect(sheet()!.querySelector('.tp__hint')!.textContent).toContain('7:35 AM');
    await click(byText('PM'));
    expect(sheet()!.querySelector('.tp__hint')!.textContent).toContain('7:35 PM');
    // Typed am/pm wins over the toggle.
    type(input, '735a');
    expect(sheet()!.querySelector('.tp__hint')!.textContent).toContain('7:35 AM');
    type(input, '1935');
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await settle();
    expect(sheet()).toBeNull();
    expect(current.depTime).toBe('19:35');
  });

  it('carries a typed time back to the wheels', async () => {
    await mount({ arrTime: '23:00' });
    await click(document.querySelector('#entry-dep')!);
    await settle();
    await click(byText('Type'));
    type(sheet()!.querySelector<HTMLInputElement>('input')!, '1840');
    await click(byText('Scroll'));
    expect(display()).toBe('6:40 PM');
  });

  it('clears a time and cancels without changes', async () => {
    await mount({ depTime: '07:05', arrTime: '15:42', arrDayOffset: 1 });
    await click(document.querySelector('#entry-arr')!);
    await settle();
    await key(listbox('Hour'), 'ArrowDown');
    await click(byText('Cancel'));
    await settle();
    expect(current.arrTime).toBe('15:42');
    expect(current.arrDayOffset).toBe(1);
    await click(document.querySelector('#entry-arr')!);
    await settle();
    await click(byText('Clear'));
    await settle();
    expect(current.arrTime).toBe('');
    // A time change drops the pinned day offset (re-inferred from the new times).
    expect(current.arrDayOffset).toBeUndefined();
  });

  it('uses 24-hour wheels without AM/PM for a 24h clock', async () => {
    await mount({ depTime: '19:35', arrTime: '22:00' }, '24h');
    expect(document.querySelector('#entry-dep')!.textContent).toContain('19:35');
    await click(document.querySelector('#entry-dep')!);
    await settle();
    expect(sheet()!.querySelector('[aria-label="AM or PM"]')).toBeNull();
    expect(listbox('Hour').querySelectorAll('[role="option"]')).toHaveLength(24);
    expect(display()).toBe('19:35');
    await key(listbox('Hour'), 'End');
    expect(display()).toBe('23:35');
  });
});
