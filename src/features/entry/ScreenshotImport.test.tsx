import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installReference } from '@/test/reference-fixture';
import { addFlight, db, deleteAllFlights, getAllFlights } from '@/lib/db';
import { enrichFlight } from '@/lib/flight-utils';
import { ScreenshotError } from '@/services/screenshot/client';
import { ScreenshotImport } from './ScreenshotImport';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  phase: 'signed-in' as string,
  prepareScreenshot: vi.fn(async () => 'data:image/jpeg;base64,AAAA'),
  readScreenshot: vi.fn(),
  checkScreenshotSetup: vi.fn(),
}));

vi.mock('@/services/screenshot/client', async (importActual) => ({
  ...(await importActual<typeof import('@/services/screenshot/client')>()),
  prepareScreenshot: mocks.prepareScreenshot,
  readScreenshot: mocks.readScreenshot,
  checkScreenshotSetup: mocks.checkScreenshotSetup,
}));
vi.mock('@/services/sync/controller', () => ({ useCloudSync: () => ({ phase: mocks.phase, status: 'idle', pending: 0 }) }));

beforeAll(installReference);

let host: HTMLDivElement;
let root: Root;
const onApply = vi.fn();
const onClose = vi.fn();

beforeEach(async () => {
  mocks.phase = 'signed-in';
  mocks.readScreenshot.mockReset();
  mocks.checkScreenshotSetup.mockReset();
  onApply.mockReset();
  onClose.mockReset();
  await deleteAllFlights();
  await db.drafts.clear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <HashRouter>
        <ScreenshotImport open onClose={onClose} onApply={onApply} clock="12h" />
      </HashRouter>,
    ),
  );
}

const settle = (ms = 30) => act(async () => new Promise((r) => setTimeout(r, ms)));
const panel = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const button = (text: string) => [...panel().querySelectorAll<HTMLElement>('button, a')].find((b) => b.textContent?.trim() === text)!;
const checkboxes = () => [...panel().querySelectorAll<HTMLInputElement>('.dleg__check')];

async function chooseFiles(n = 1) {
  const input = panel().querySelector<HTMLInputElement>('input[type="file"]')!;
  const files = Array.from({ length: n }, (_, i) => new File(['x'], `pass-${i}.png`, { type: 'image/png' }));
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await settle();
  await settle();
}

const flight = {
  date: '2026-10-21',
  from: 'MCO',
  to: 'SFO',
  flightNumber: 'UA2620',
  depTime: '18:59',
  arrTime: '21:50',
  arrDayOffset: null,
  aircraftType: 'B38M',
  seatNumber: '12A',
};
const back = { ...flight, date: '2026-10-25', from: 'SFO', to: 'MCO', flightNumber: 'UA2621', depTime: '08:00', arrTime: '16:20', seatNumber: '' };

describe('ScreenshotImport sheet', () => {
  it('asks signed-out users to sign in', async () => {
    mocks.phase = 'signed-out';
    await mount();
    expect(panel().textContent).toContain('Sign in to scan screenshots');
    expect(button('Sign in').getAttribute('href')).toBe('#/account');
    expect(panel().querySelector('input[type="file"]')).toBeNull();
  });

  it('reads right after choosing and saves a flight straight from the result', async () => {
    mocks.readScreenshot.mockResolvedValue({ flights: [flight], warnings: ['Year not visible'] });
    await mount();
    expect(panel().textContent).toContain('sent to Google Gemini');
    expect(panel().querySelector<HTMLInputElement>('input[type="file"]')!.multiple).toBe(true);
    await chooseFiles();
    expect(mocks.readScreenshot).toHaveBeenCalledOnce();
    expect(panel().textContent).toContain('Found 1 flight');
    expect(panel().textContent).toContain('Year not visible');
    expect(panel().textContent).toContain('6:59 PM → 9:50 PM');
    expect(checkboxes()[0].checked).toBe(true);
    await act(async () => button('Save 1 flight').click());
    await settle();
    const saved = await getAllFlights();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ from: 'KMCO', to: 'KSFO', date: '2026-10-21', source: 'screenshot', seatNumber: '12A' });
    expect(saved[0].tripId).toBeUndefined();
    expect(panel().textContent).toContain('Flight saved');
    // Every leg saved: the draft is gone from To review.
    expect(await db.drafts.count()).toBe(0);
  });

  it('can open a leg in the form instead', async () => {
    mocks.readScreenshot.mockResolvedValue({ flights: [flight], warnings: [] });
    await mount();
    await chooseFiles();
    await act(async () => button('Edit').click());
    const draft = (await db.drafts.toArray())[0];
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ from: 'KMCO', to: 'KSFO', date: '2026-10-21', depTime: '18:59' }), { draftId: draft.id, index: 0 });
  });

  it('saves an itinerary as one trip with a suggested name', async () => {
    mocks.readScreenshot.mockResolvedValue({ flights: [flight, back], warnings: [] });
    await mount();
    await chooseFiles();
    expect(panel().textContent).toContain('Found 2 flights');
    const toggle = panel().querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    const name = panel().querySelector<HTMLInputElement>('.dtrip input')!;
    expect(name.value.length).toBeGreaterThan(0);
    await act(async () => button('Save 2 flights as a trip').click());
    await settle();
    const saved = await getAllFlights();
    expect(saved).toHaveLength(2);
    expect(saved[0].tripId).toBeDefined();
    expect(saved[0].tripId).toBe(saved[1].tripId);
    expect(saved[0].tripName).toBe(name.value);
    expect(button('View trip').getAttribute('href')).toBe(`#/trips/${saved[0].tripId}`);
  });

  it('leaves flights already in the log unticked', async () => {
    await addFlight(enrichFlight({ date: '2026-10-21', datePrecision: 'day', from: 'KMCO', to: 'KSFO', flightNumber: 'UA2620', source: 'manual' }));
    mocks.readScreenshot.mockResolvedValue({ flights: [flight, back], warnings: [] });
    await mount();
    await chooseFiles();
    await settle();
    expect(checkboxes().map((c) => c.checked)).toEqual([false, true]);
    expect(panel().textContent).toContain('Already in your log');
    expect(button('Save 1 flight')).toBeDefined();
  });

  it('marks legs that need details and keeps them out of the save', async () => {
    mocks.readScreenshot.mockResolvedValue({ flights: [{ ...flight, date: '' }], warnings: [] });
    await mount();
    await chooseFiles();
    expect(checkboxes()[0].disabled).toBe(true);
    expect(panel().textContent).toContain('Needs the date');
    expect(button('Fix')).toBeDefined();
    expect(button('Select flights to save')).toBeDefined();
  });

  it('keeps reading in the background after the sheet is closed', async () => {
    let finish: (v: unknown) => void = () => {};
    mocks.readScreenshot.mockImplementation(() => new Promise((r) => (finish = r)));
    await mount();
    await chooseFiles();
    expect(panel().textContent).toContain('Reading flight details');
    expect(panel().textContent).toContain('keeps reading in the background');
    await act(async () => button('Continue in background').click());
    expect(onClose).toHaveBeenCalled();
    await act(async () => finish({ flights: [flight], warnings: [] }));
    await settle();
    const [draft] = await db.drafts.toArray();
    expect(draft).toMatchObject({ status: 'ready', result: { flights: [flight] } });
    expect(draft.image).toBeUndefined();
  });

  it('can cancel a read in progress', async () => {
    mocks.readScreenshot.mockImplementation(
      (_: string, signal: AbortSignal) => new Promise((_r, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))),
    );
    await mount();
    await chooseFiles();
    await act(async () => button('Cancel').click());
    await settle();
    expect(mocks.readScreenshot.mock.calls[0][1].aborted).toBe(true);
    expect(await db.drafts.count()).toBe(0);
    expect(panel().querySelector('[role="alert"]')).toBeNull();
    expect(panel().querySelector('.ss-choose')).not.toBeNull();
  });

  it('reads several screenshots at once into To review', async () => {
    mocks.readScreenshot.mockResolvedValue({ flights: [flight], warnings: [] });
    await mount();
    await chooseFiles(3);
    expect(panel().textContent).toContain('Reading 3 screenshots');
    expect(button('Open To review').getAttribute('href')).toBe('#/review');
    await settle();
    expect(await db.drafts.count()).toBe(3);
  });

  it('offers "Check setup" for server setup errors and lists each check', async () => {
    mocks.readScreenshot.mockRejectedValue(new ScreenshotError('setup', 'GEMINI_API_KEY is missing on the server.'));
    mocks.checkScreenshotSetup.mockResolvedValue({
      ready: false,
      checks: [
        { id: 'gemini_key', label: 'Gemini API key on the server', ok: false, detail: 'Add GEMINI_API_KEY in Vercel.' },
        { id: 'supabase', label: 'Supabase settings on the server', ok: true },
        { id: 'gemini_model', label: 'Gemini accepts the key', ok: null, detail: 'Checked once you’re signed in.' },
      ],
    });
    await mount();
    await chooseFiles();
    expect(panel().querySelector('[role="alert"]')!.textContent).toContain('GEMINI_API_KEY is missing');
    await act(async () => button('Check setup').click());
    await settle();
    const items = [...panel().querySelectorAll('.ss-check')];
    expect(items.map((li) => li.querySelector('.ss-check__mark')!.textContent)).toEqual(['✗', '✓', '–']);
    expect(items[0].textContent).toContain('Add GEMINI_API_KEY in Vercel.');
    expect(panel().textContent).toContain('Fix the items marked ✗');
  });

  it('does not offer the setup check for other errors, and can retry', async () => {
    mocks.readScreenshot.mockRejectedValueOnce(new ScreenshotError('quota', 'Daily limit reached.'));
    await mount();
    await chooseFiles();
    expect(panel().textContent).toContain('Daily limit reached.');
    expect(button('Check setup')).toBeUndefined();
    mocks.readScreenshot.mockResolvedValueOnce({ flights: [flight], warnings: [] });
    await act(async () => button('Try again').click());
    await settle();
    expect(panel().textContent).toContain('Found 1 flight');
  });
});
