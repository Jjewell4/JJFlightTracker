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

// Start fetching reference data immediately; screens await it via useReferenceReady().
loadReference().catch((e) => console.error(e));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
