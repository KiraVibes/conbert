import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { i18nReady } from './lib/i18n';
import { App } from './App';
import { registerServiceWorker, takeSharedLink } from './lib/share-target';

// Opened from the share menu of a phone: hand the link to the downloader.
takeSharedLink(window.location, window.history);
registerServiceWorker();

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

// The texts of the chosen language come first (a small file of their own).
// Should they fail to load, the page still starts – then with text keys.
void i18nReady
  .catch((error: unknown) => console.error('Texts could not be loaded', error))
  .then(() => {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
