import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { installReference } from '@/test/reference-fixture';
import PublicProfilePage from './PublicProfilePage';
import type { PublicProfile } from './profile';

vi.mock('maplibre-gl', () => ({ default: {} }));
const load = vi.fn<(slug: string) => Promise<PublicProfile | null>>();
vi.mock('./api', () => ({ loadPublicProfile: (slug: string) => load(slug) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(installReference);

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  window.history.replaceState(null, '', '/');
});

async function render() {
  window.history.replaceState(null, '', '/jordan');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<PublicProfilePage slug="jordan" />));
  for (let i = 0; i < 20 && !host.querySelector('.pj-brand'); i++) await act(async () => new Promise((r) => setTimeout(r, 25)));
  return host;
}

describe('public profile page', () => {
  it('shows the app’s brand bar with a quiet way to start a journal', async () => {
    load.mockResolvedValue({
      slug: 'jordan',
      display_name: 'Jordan',
      published_at: '2026-10-01T10:00:00Z',
      flights: [{ date: '2025-06-01', datePrecision: 'month', from: 'KSAN', to: 'KSEA', airlineIcao: 'ASA' }],
    });
    const el = await render();
    const home = el.querySelector<HTMLAnchorElement>('.pj-brand .pj-brand__home')!;
    expect(home.textContent).toBe('Window Seat');
    expect(home.getAttribute('href')).toBe('/');
    const mark = home.querySelector('img')!;
    expect(mark.getAttribute('src')).toBe('/icons/mark.svg');
    expect(mark.getAttribute('width')).toBe('48');
    expect(el.querySelector('.pj-brand__start')?.getAttribute('aria-label')).toBe('Start your own flight journal');
  });

  it('keeps the brand bar on the not-found state', async () => {
    load.mockResolvedValue(null);
    const el = await render();
    for (let i = 0; i < 20 && !el.textContent?.includes('isn’t public'); i++) await act(async () => new Promise((r) => setTimeout(r, 25)));
    expect(el.textContent).toContain('This journal isn’t public');
    expect(el.querySelector('.pj-brand__home img')?.getAttribute('src')).toBe('/icons/mark.svg');
  });
});
