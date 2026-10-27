/// <reference types="vite-plugin-pwa/react" />
import { useEffect, useState, useRef, useSyncExternalStore } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Icon } from './Icon';
import './PwaPrompts.css';

const OFFLINE_KEY = 'flightlog.offlineReadyShown';

function readFlag(): boolean {
  try {
    return localStorage.getItem(OFFLINE_KEY) === '1';
  } catch {
    return false;
  }
}
function writeFlag() {
  try {
    localStorage.setItem(OFFLINE_KEY, '1');
  } catch {
    /* private mode – the toast may show again, which is harmless */
  }
}

/**
 * Registers the service worker and surfaces two calm toasts:
 * "New version available — Reload" and (once ever) "Ready to work offline".
 */
export function PwaPrompts() {
  const registrationRef = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      registrationRef.current = registration;
      if (registration) void registration.update().catch(() => undefined);
    },
    onRegisterError(err) {
      console.warn('Service worker registration failed', err);
    },
  });

  useEffect(() => {
    const check = () => { if (navigator.onLine && document.visibilityState === 'visible') void registrationRef.current?.update().catch(() => undefined); };
    const timer = setInterval(check, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('online', check);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', check); window.removeEventListener('online', check); };
  }, []);

  // "Ready to work offline" is only worth announcing the first time ever.
  const [seenBefore] = useState(readFlag);

  useEffect(() => {
    if (!offlineReady) return;
    if (seenBefore) {
      setOfflineReady(false);
      return;
    }
    writeFlag();
    const t = setTimeout(() => setOfflineReady(false), 5000);
    return () => clearTimeout(t);
  }, [offlineReady, seenBefore, setOfflineReady]);

  if (needRefresh) {
    return (
      <div className="pwa-toast" role="status" aria-live="polite">
        <span className="pwa-toast__icon">
          <Icon name="refresh" size={18} />
        </span>
        <span className="pwa-toast__text">
          <strong>Update available</strong>
          <span>Save any edits, then reload for the latest version.</span>
        </span>
        <button type="button" className="pwa-toast__btn" onClick={() => void updateServiceWorker(true)}>
          Reload
        </button>
        <button type="button" className="pwa-toast__close" aria-label="Dismiss" onClick={() => setNeedRefresh(false)}>
          <Icon name="close" size={16} />
        </button>
      </div>
    );
  }

  if (offlineReady && !seenBefore) {
    return (
      <div className="pwa-toast pwa-toast--ok" role="status" aria-live="polite">
        <span className="pwa-toast__icon">
          <Icon name="check" size={18} strokeWidth={2.25} />
        </span>
        <span className="pwa-toast__text">
          <strong>Ready to work offline</strong>
          <span>Your flight log now works without a connection.</span>
        </span>
        <button type="button" className="pwa-toast__close" aria-label="Dismiss" onClick={() => setOfflineReady(false)}>
          <Icon name="close" size={16} />
        </button>
      </div>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// "Install app" support. `beforeinstallprompt` can fire before the Settings screen
// is ever opened, so the event is captured here (this module loads with the app shell).
// ---------------------------------------------------------------------------

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    emit();
  });
}

export interface InstallState {
  /** The browser offered a native install prompt. */
  canInstall: boolean;
  /** Running as an installed app (standalone display mode). */
  isStandalone: boolean;
  /** iPhone/iPad Safari, where installing is a manual Share → Add to Home Screen. */
  isIosSafari: boolean;
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};
const snapshot = () => `${deferred ? 1 : 0}${installed ? 1 : 0}`;

export function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function detectIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // Other iOS browsers (Chrome/Firefox/Edge) can't add to home screen except through Share too, but Safari is the reliable path.
  return ios && /WebKit/.test(ua);
}

export function useInstallPrompt(): InstallState {
  const snap = useSyncExternalStore(subscribe, snapshot, () => '00');
  return {
    canInstall: snap[0] === '1',
    isStandalone: snap[1] === '1' || detectStandalone(),
    isIosSafari: detectIosSafari(),
    install: async () => {
      if (!deferred) return 'unavailable';
      const ev = deferred;
      await ev.prompt();
      const { outcome } = await ev.userChoice;
      deferred = null;
      emit();
      return outcome;
    },
  };
}
