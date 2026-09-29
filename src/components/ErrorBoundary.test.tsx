import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

function Boom({ explode }: { explode: boolean }): React.ReactNode {
  if (explode) throw new Error('bad flight');
  return <p>Fine</p>;
}

describe('ErrorBoundary', () => {
  it('shows a friendly screen instead of a blank page, and resets on navigation', () => {
    act(() =>
      root.render(
        <ErrorBoundary resetKey="/flights/1">
          <Boom explode />
        </ErrorBoundary>,
      ),
    );
    expect(host.textContent).toContain('Something went wrong');
    expect(host.textContent).toMatch(/flights are safe/);
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Reload')).toBe(true);

    act(() =>
      root.render(
        <ErrorBoundary resetKey="/">
          <Boom explode={false} />
        </ErrorBoundary>,
      ),
    );
    expect(host.textContent).toBe('Fine');
  });
});
