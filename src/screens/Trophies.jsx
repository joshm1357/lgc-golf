import React from 'react';
import { Header } from '../components/ui.jsx';

export default function Trophies() {
  return (
    <div className="page">
      <Header logo title="Coming tonight" sub="This screen is being built right now" />
      <div className="empty">Check back soon — the leaderboard and score entry are ready for tomorrow.</div>
    </div>
  );
}
