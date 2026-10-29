import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installReference } from '@/test/reference-fixture';
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

beforeEach(() => {
  mocks.phase = 'signed-in';
  mocks.readScreenshot.mockReset();
  mocks.checkScreenshotSetup.mockReset();
  onApply.mockReset();
  onClose.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function mount(dirty = false) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <HashRouter>
        <ScreenshotImport open onClose={onClose} onApply={onApply} dirty={dirty} clock="12h" />
      </HashRouter>,
    ),
  );
}

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));
const panel = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const button = (text: string) => [...panel().querySelectorAll<HTMLElement>('button, a')].find((b) => b.textContent?.trim() === text)!;

async function chooseFile() {
  const input = panel().querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File(['x'], 'pass.png', { type: 'image/png' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await settle();
}

const flight = {
  date: '2026-10-27',
  from: 'SAN',
  to: 'JFK',
  flightNumber: 'B6124',
  depTime: '07:05',
  arrTime: '15:42',
  arrDayOffset: null,
  aircraftType: 'A321',
  seatNumber: '14A',
};

describe('ScreenshotImport sheet', () => {
  it('asks signed-out users to sign in', async () => {
    mocks.phase = 'signed-out';
    await mount();
    expect(panel().textContent).toContain('Sign in to scan screenshots');
    expect(button('Sign in').getAttribute('href')).toBe('#/account');
    expect(panel().querySelector('input[type="file"]')).toBeNull();
  });

  it('shows the privacy note before choosing, reads right after, and fills the form from a result', async () => {
    mocks.readScreenshot.mockResolvedValue({ flights: [flight], warnings: ['Year not visible'] });
    await mount();
    expect(panel().textContent).toContain('sent to Google Gemini');
    expect(panel().querySelector<HTMLInputElement>('input[type="file"]')!.accept).toBe('image/*');
    await chooseFile();
    expect(mocks.readScreenshot).toHaveBeenCalledOnce();
    expect(panel().textContent).toContain('Found 1 flight');
    expect(panel().textContent).toContain('Year not visible');
    expect(panel().textContent).toContain('7:05 AM → 3:42 PM');
    await act(async () => button('Use this flight').click());
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ from: 'KSAN', to: 'KJFK', date: '2026-10-27', depTime: '07:05', seatNumber: '14A' }));
    expect(button('Fill form again')).toBeDefined();
  });

  it('uses replace wording when the form already has edits', async () => {
    mocks.readScreenshot.mockResolvedValue({ flights: [flight], warnings: [] });
    await mount(true);
    await chooseFile();
    expect(button('Replace form with this flight')).toBeDefined();
  });

  it('can cancel a read in progress and read again', async () => {
    mocks.readScreenshot.mockImplementation(
      (_: string, signal: AbortSignal) =>
        new Promise((_r, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))),
    );
    await mount();
    await chooseFile();
    expect(panel().textContent).toContain('Reading flight details');
    await act(async () => button('Cancel').click());
    await settle();
    expect(mocks.readScreenshot.mock.calls[0][1].aborted).toBe(true);
    expect(panel().querySelector('[role="alert"]')).toBeNull();
    mocks.readScreenshot.mockResolvedValue({ flights: [flight], warnings: [] });
    await act(async () => button('Read flight details').click());
    await settle();
    expect(panel().textContent).toContain('Found 1 flight');
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
    await chooseFile();
    expect(panel().querySelector('[role="alert"]')!.textContent).toContain('GEMINI_API_KEY is missing');
    await act(async () => button('Check setup').click());
    await settle();
    const items = [...panel().querySelectorAll('.ss-check')];
    expect(items.map((li) => li.querySelector('.ss-check__mark')!.textContent)).toEqual(['✗', '✓', '–']);
    expect(items[0].textContent).toContain('Add GEMINI_API_KEY in Vercel.');
    expect(panel().textContent).toContain('Fix the items marked ✗');
  });

  it('does not offer the setup check for other errors', async () => {
    mocks.readScreenshot.mockRejectedValue(new ScreenshotError('quota', 'Daily limit reached.'));
    await mount();
    await chooseFile();
    expect(panel().textContent).toContain('Daily limit reached.');
    expect(button('Check setup')).toBeUndefined();
    expect(button('Try again')).toBeDefined();
  });
});
