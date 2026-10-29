import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';
import { App } from './app/App';
import { loadReference } from './data/reference';
import './dev/sample-data';
import { publicHandleFromPath } from '@/features/public/profile';
import { startCloudSync } from './services/sync/controller';

// Start fetching reference data immediately; screens await it via useReferenceReady().
loadReference().catch((e) => console.error(e));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Launch splash (index.html): fade it out once the app has painted, after a short minimum so the
// drifting map reads as a moment rather than a flash.
const splash = document.getElementById('splash');
if (splash) {
  const shownFor = performance.now();
  const MIN_MS = 900;
  requestAnimationFrame(() =>
    setTimeout(() => {
      splash.classList.add('is-done');
      setTimeout(() => splash.remove(), 320);
    }, Math.max(0, MIN_MS - shownFor)),
  );
}

// Background cloud sync (no-op unless Supabase env vars are configured).
if (!publicHandleFromPath(window.location.pathname)) startCloudSync();
