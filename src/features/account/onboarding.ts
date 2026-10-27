/** Whether this device has seen the welcome screen (per-device convenience flag). */
const KEY = 'flightlog.onboarded';

export function isOnboarded(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return true; // storage unavailable → never force the welcome screen
  }
}

export function markOnboarded(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* ignore */
  }
}
