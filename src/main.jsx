import React from 'react';
import { createRoot } from 'react-dom/client';
import { Crest } from './components/Logo.jsx';

function ComingSoon() {
  return (
    <div style={{ minHeight: '100vh', background: '#1C2B3F', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, fontFamily: 'Barlow, sans-serif', padding: 24, textAlign: 'center' }}>
      <Crest size={180} />
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 34, fontWeight: 700 }}>L.G.C Golf</div>
      <div style={{ color: '#C3CCD8', fontSize: 17 }}>Being built right now. Refresh in a bit.</div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<ComingSoon />);
