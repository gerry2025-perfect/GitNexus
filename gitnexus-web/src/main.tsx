import React from 'react';
import ReactDOM from 'react-dom/client';
import { Buffer } from 'buffer';
import App from './App';
import './index.css';
import { initServerModeConfig } from './config/ui-constants';

// Polyfill Buffer for isomorphic-git (requires Node.js Buffer API)
globalThis.Buffer = Buffer;

// Initialize server mode config from URL params before app starts
// This ensures consistent configuration throughout the app lifecycle
initServerModeConfig();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
