import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { validateRequiredEnvs } from './config/envValidator';
import { syncSettingsFromBackend } from './services/adminService';
import * as Sentry from '@sentry/react';
import './index.css';

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 1.0,
  });
}

// Validate environment and sync settings before booting
validateRequiredEnvs();
void syncSettingsFromBackend();

// Global error handler for asset loading failures (stale builds)
window.addEventListener('error', (e) => {
  const msg = e.message.toLowerCase();
  if (msg.includes('unable to preload css') || msg.includes('failed to fetch dynamically imported module')) {
    console.warn('Asset loading failure detected. Refreshing for latest version...');
    window.location.reload();
  }
}, true);

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Failed to find the root element');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
