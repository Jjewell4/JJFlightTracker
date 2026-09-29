import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AirlineLogo } from './AirlineLogo';
import { setShowAirlineLogos } from './airline-logo-prefs';

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
  setShowAirlineLogos(true);
});

describe('AirlineLogo', () => {
  it('loads the remote logo without sending a referrer', () => {
    act(() => root.render(<AirlineLogo iata="UA" name="United Airlines" />));
    const img = host.querySelector('img')!;
    expect(img.getAttribute('src')).toContain('pics.avs.io');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('shows only the letter badge when logos are turned off', () => {
    act(() => root.render(<AirlineLogo iata="UA" name="United Airlines" />));
    act(() => setShowAirlineLogos(false));
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toBe('UA');
    act(() => setShowAirlineLogos(true));
    expect(host.querySelector('img')).not.toBeNull();
  });
});
