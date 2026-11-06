import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './tokens.css';
import './styles.css';
import './mobility.css';
import './scenes.css';
import './micro.css';
import './micro.js';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
