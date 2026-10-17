import React from 'react';
import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import App from './App.jsx';
import DrawDemo from './screens/DrawDemo.jsx';

const demo = new URLSearchParams(window.location.search).get('demo') === 'draw';
createRoot(document.getElementById('root')).render(demo ? <DrawDemo /> : <App />);
