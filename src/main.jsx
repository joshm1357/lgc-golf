import React from 'react';
import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import App from './App.jsx';
import DrawDemo from './screens/DrawDemo.jsx';
import Guide from './screens/Guide.jsx';

const q = new URLSearchParams(window.location.search);
const page = q.has('guide') ? <Guide /> : q.get('demo') === 'draw' ? <DrawDemo /> : <App />;
createRoot(document.getElementById('root')).render(page);
