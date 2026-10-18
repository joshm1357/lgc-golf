import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.jsx';
// The Sunday guide and the draw demo are separate pages; they load only when asked for.
const DrawDemo = lazy(() => import('./screens/DrawDemo.jsx'));
const Guide = lazy(() => import('./screens/Guide.jsx'));

const q = new URLSearchParams(window.location.search);
const page = q.has('guide') ? <Guide /> : q.get('demo') === 'draw' ? <DrawDemo /> : <App />;
createRoot(document.getElementById('root')).render(<Suspense fallback={null}>{page}</Suspense>);

// Lets the app open with no signal (and carries phone notifications). Production only.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}); });
}
