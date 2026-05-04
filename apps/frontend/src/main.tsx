import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { validateRequiredEnvs } from './config/envValidator';
import { syncSettingsFromBackend } from './services/adminService';
import './index.css';

// Validate environment and sync settings before booting
validateRequiredEnvs();
void syncSettingsFromBackend();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Failed to find the root element');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
