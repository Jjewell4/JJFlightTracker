import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmSheet } from './Sheet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('ConfirmSheet typed confirmation', () => {
  it('keeps the destructive button disabled until the word is typed', () => {
    const onConfirm = vi.fn();
    act(() =>
      root.render(
        <ConfirmSheet open title="Delete all flights?" confirmLabel="Delete everything" danger requireText="DELETE" onConfirm={onConfirm} onCancel={() => undefined}>
          <p>Gone forever.</p>
        </ConfirmSheet>,
      ),
    );
    const confirm = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Delete everything')!;
    const input = document.querySelector('input')!;
    expect(confirm.disabled).toBe(true);
    type(input, 'delet');
    expect(confirm.disabled).toBe(true);
    type(input, 'delete');
    expect(confirm.disabled).toBe(false);
    act(() => confirm.click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when closed and cancels on Escape', () => {
    const onCancel = vi.fn();
    act(() =>
      root.render(
        <ConfirmSheet open={false} title="x" confirmLabel="Go" onConfirm={() => undefined} onCancel={onCancel}>
          body
        </ConfirmSheet>,
      ),
    );
    expect(document.querySelector('.sheet')).toBeNull();
    act(() =>
      root.render(
        <ConfirmSheet open title="x" confirmLabel="Go" onConfirm={() => undefined} onCancel={onCancel}>
          body
        </ConfirmSheet>,
      ),
    );
    expect(document.querySelector('.sheet')).not.toBeNull();
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(onCancel).toHaveBeenCalled();
  });
});
