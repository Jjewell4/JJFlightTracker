import { afterEach, expect, it, vi } from 'vitest';
import { popOverlayEntries } from './useBackDismiss';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.history.replaceState(null, '');
});

it('does not wait repeatedly when standalone Back fails to change history', async () => {
  vi.useFakeTimers();
  window.history.replaceState({ __overlay: 'guard' }, '');
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
  const done = vi.fn();
  const pending = popOverlayEntries().then(done);
  await vi.advanceTimersByTimeAsync(500);
  expect(done).toHaveBeenCalledOnce();
  expect(back).toHaveBeenCalledOnce();
  await pending;
});

it('returns immediately after the overlay is popped', async () => {
  window.history.replaceState({ __overlay: 'guard' }, '');
  vi.spyOn(window.history, 'back').mockImplementation(() => {
    window.history.replaceState(null, '');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await popOverlayEntries();
  expect(window.history.state).toBeNull();
});
