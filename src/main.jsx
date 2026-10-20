import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.jsx';
import { applyLook, savedLook } from './lib/theme.js';
import { watchForProblems } from './lib/problems.js';
import { watchInstallOffer } from './lib/beta.js';
// The Sunday guide and the draw demo are separate pages; they load only when asked for.
const DrawDemo = lazy(() => import('./screens/DrawDemo.jsx'));
const Guide = lazy(() => import('./screens/Guide.jsx'));

// If the app breaks on a phone, Josh hears about it (no names sent).
watchForProblems();
// Chrome and Edge offer to install the app; keep the offer for the button in More.
watchInstallOffer();

// Paint the group's look from last time straight away, so there's no flash of other colours.
if (savedLook()) applyLook(savedLook(), savedLook().name);

const q = new URLSearchParams(window.location.search);
const page = q.has('guide') ? <Guide /> : q.get('demo') === 'draw' ? <DrawDemo /> : <App />;
createRoot(document.getElementById('root')).render(<Suspense fallback={null}>{page}</Suspense>);

// Lets the app open with no signal (and carries phone notifications). Production only.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}); });
}
