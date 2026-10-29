import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppShell } from './AppShell';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  window.scrollTo = () => undefined;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function renderAt(path: string) {
  act(() =>
    root.render(
      <MemoryRouter key={path} initialEntries={[path]}>
        <AppShell>
          <p>page</p>
        </AppShell>
      </MemoryRouter>,
    ),
  );
}

const tabbar = () => host.querySelector<HTMLElement>('.tabbar');
const topbar = () => host.querySelector<HTMLElement>('.topbar');

describe('AppShell navigation (phones)', () => {
  it('puts a "Log a flight" button in the middle of the tab bar', () => {
    renderAt('/');
    const items = [...tabbar()!.children] as HTMLElement[];
    expect(items.map((a) => a.getAttribute('aria-label') ?? a.textContent)).toEqual(['Home', 'Log', 'Log a flight', 'Map', 'Stats']);
    expect(items[2].getAttribute('href')).toBe('/flights/new');
    expect(items[0].classList.contains('active')).toBe(true);
  });

  it('keeps settings reachable from the top bar even without cloud sync', () => {
    renderAt('/stats');
    const settings = topbar()!.querySelector<HTMLAnchorElement>('a[aria-label="Settings"]')!;
    expect(settings.getAttribute('href')).toBe('/settings');
    expect(settings.classList.contains('active')).toBe(false);
    expect(host.querySelector('.tabbar a[href="/settings"]')).toBeNull();
  });

  it('marks the settings button active on the settings screen', () => {
    renderAt('/settings');
    expect(topbar()!.querySelector('a[aria-label="Settings"]')!.classList.contains('active')).toBe(true);
  });

  it('shows the top bar on the main tabs only', () => {
    for (const path of ['/', '/flights', '/stats', '/settings']) {
      renderAt(path);
      expect(topbar(), path).not.toBeNull();
    }
    for (const path of ['/map', '/flights/abc', '/import']) {
      renderAt(path);
      expect(topbar(), path).toBeNull();
    }
  });

  it('hides the tab bar on form routes', () => {
    renderAt('/flights/new');
    expect(tabbar()).toBeNull();
    renderAt('/flights/abc/edit');
    expect(tabbar()).toBeNull();
    renderAt('/flights/abc');
    expect(tabbar()).not.toBeNull();
  });
});
