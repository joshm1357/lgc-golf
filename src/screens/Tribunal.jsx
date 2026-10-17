import React from 'react';
import { Header } from '../components/ui.jsx';

export default function Tribunal() {
  return (
    <div className="page">
      <Header court title="Handicap Tribunal" sub="Being built right now" />
      <div className="empty">Court is not yet in session. Check back soon.</div>
    </div>
  );
}
export function TribunalCase() {
  return <Tribunal />;
}
