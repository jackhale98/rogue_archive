// Fraunces and Inter set the header's wordmark (after the logo's lockup) and the games' own
// launch screens; the site itself is set in the faces declared in fonts.css.
import '@fontsource-variable/fraunces';
import '@fontsource-variable/inter';
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
