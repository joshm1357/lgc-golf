import React from 'react';
import { useSession } from '../lib/store.jsx';
import { startPreview, stopPreview } from '../lib/preview.js';

// "View as a player" (preview.js): the bar across the top while an organiser is viewing as someone, and the button
// on a player's profile that starts it.

function restart(hash) {
  window.location.hash = hash;
  window.location.reload();
}

/** Stops viewing straight away (used when the viewed player has gone from the group). */
export function StopViewing() {
  React.useEffect(() => { stopPreview(); restart('#/'); }, []);
  return null;
}

export function ViewingBar() {
  const { status } = useSession();
  if (!status?.viewing) return null;
  const stop = () => { const back = `#/player/${status.player_id}`; stopPreview(); restart(back); };
  return (
    <div className="viewing-bar" role="status">
      <span className="grow">👀 Viewing as <strong>{status.viewing.name}</strong> · read only</span>
      <button type="button" className="btn sm gold" onClick={stop}>Stop</button>
    </div>
  );
}

/** On a player's profile, for an organiser: see the app the way this player sees it. */
export function ViewAsButton({ player }) {
  const { status } = useSession();
  // Not for yourself, or for someone not approved yet (they'd only see the waiting screen).
  if (!status?.is_admin || status.viewing || !player || player.id === status.player_id || player.approved === false) return null;
  const name = player.nickname || player.name;
  const go = () => { startPreview({ player_id: player.id, name, group_id: status.group_id }); restart('#/'); };
  return (
    <button type="button" className="btn ghost block" onClick={go}>👀 View the app as {name}</button>
  );
}
