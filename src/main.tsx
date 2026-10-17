import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// The shared styles load first, so each component's own CSS can build on them.
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
