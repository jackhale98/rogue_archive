// The site's faces (IBM Plex Mono and Sans, and Fraunces for the wordmark) are declared in fonts.css.
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { registerServiceWorker } from './app/service-worker.ts';
import { SettingsProvider } from './app/settings.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </StrictMode>,
);
registerServiceWorker();
