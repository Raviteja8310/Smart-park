import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './tokens.css';
import './styles.css';
import './mobility.css';
import './scenes.css';
import './micro.css';
import './page-motion.css';
// Professional palette & component refinement for the app (the landing page has its own styles).
import './refine.css';
import './micro.js';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
