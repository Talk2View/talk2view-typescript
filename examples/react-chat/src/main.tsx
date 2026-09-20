import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installMockEngine } from './mock-engine';

// `?mock=1` answers every engine call in the page, so the example runs with no
// account and no network. Installed before anything creates a client.
if (new URLSearchParams(window.location.search).get('mock') === '1') {
  installMockEngine();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
