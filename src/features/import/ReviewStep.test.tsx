import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportCandidate, ParsedBackup } from '@/services/import';
import { ReviewStep } from './ReviewStep';

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

const cand = (key: string): ImportCandidate => ({
  key,
  rowNumber: 1,
  issues: [],
  flight: { date: '2021-05-01', datePrecision: 'day', from: 'KSAN', to: 'KLAX', source: 'manual' },
});

function render(candidates: ImportCandidate[], replace: boolean, handlers: { onImport?: () => void; onReplace?: (v: boolean) => void; onDownloadCurrent?: () => void } = {}) {
  const data: ParsedBackup = { candidates, rejected: 0, settings: undefined } as unknown as ParsedBackup;
  act(() =>
    root.render(
      <ReviewStep
        candidates={candidates}
        duplicates={new Map()}
        skipped={new Set()}
        policy="skip"
        onPolicy={() => undefined}
        onFix={() => undefined}
        onToggleSkip={() => undefined}
        onSetSkipped={() => undefined}
        onImport={handlers.onImport ?? (() => undefined)}
        formatLabel="Flight Log backup"
        backup={{
          data,
          replace,
          onReplace: handlers.onReplace ?? (() => undefined),
          restoreSettings: false,
          onRestoreSettings: () => undefined,
          currentCount: 12,
          onDownloadCurrent: handlers.onDownloadCurrent ?? (() => undefined),
        }}
      />,
    ),
  );
}

const button = (text: string | RegExp) =>
  [...document.querySelectorAll('button')].find((b) => (typeof text === 'string' ? b.textContent === text : text.test(b.textContent ?? '')))!;

describe('ReviewStep replace mode', () => {
  it('cannot replace the log with an empty backup', () => {
    render([], false);
    expect(button('Replace everything').disabled).toBe(true);
    render([], true);
    expect(button(/Nothing to import|Replace log with/).disabled).toBe(true);
  });

  it('asks for confirmation (with a backup offer) before replacing', () => {
    const onImport = vi.fn();
    const onDownloadCurrent = vi.fn();
    render([cand('a'), cand('b')], true, { onImport, onDownloadCurrent });
    act(() => button('Replace log with 2 flights').click());
    expect(onImport).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toMatch(/deletes your 12 current flights and adds 2/);
    act(() => button('Download a backup of my current log first').click());
    expect(onDownloadCurrent).toHaveBeenCalledOnce();
    act(() => button('Replace with 2 flights').click());
    expect(onImport).toHaveBeenCalledOnce();
  });
});
