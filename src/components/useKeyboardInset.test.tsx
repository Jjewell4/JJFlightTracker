import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sheet } from './Sheet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
}

describe('bottom sheet keyboard inset', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lifts the sheet above the on-screen keyboard while open', () => {
    const vv = new FakeViewport();
    vi.stubGlobal('visualViewport', vv);
    vi.stubGlobal('innerHeight', 800);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() =>
      root.render(
        <Sheet open onClose={() => {}} label="Name">
          <input aria-label="Trip name" />
        </Sheet>,
      ),
    );
    const sheet = document.querySelector<HTMLElement>('.sheet')!;
    expect(sheet.style.getPropertyValue('--kb')).toBe('0px');
    act(() => {
      vv.height = 480;
      vv.dispatchEvent(new Event('resize'));
    });
    expect(sheet.style.getPropertyValue('--kb')).toBe('320px');
    // Toolbar-sized changes are ignored.
    act(() => {
      vv.height = 760;
      vv.dispatchEvent(new Event('resize'));
    });
    expect(sheet.style.getPropertyValue('--kb')).toBe('0px');
    act(() => root.unmount());
    host.remove();
  });
});
