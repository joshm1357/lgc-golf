import React, { useState } from 'react';
import { useSession } from '../lib/store.jsx';
import { drawCard, sharePicture } from '../lib/shareCard.js';
import { toast } from './ui.jsx';
import { startOwnLink } from '../lib/quick.js';

/** "Share as a picture": draws the card on the phone and opens the share sheet (or saves it). */
export default function SharePicture({ kind, data, text, label = '🖼️ Share as a picture', className = 'btn ghost block' }) {
  const { status } = useSession() || {};
  const [busy, setBusy] = useState(false);
  const slug = (status?.groups || []).find((g) => g.id === status?.group_id)?.slug;
  const go = async () => {
    setBusy(true);
    try {
      const file = await drawCard(kind, data, status?.look || {});
      const r = await sharePicture(file, [text, `Made with The Golf Trip — start your own: ${startOwnLink(slug)}`].filter(Boolean).join('\n'));
      if (r === 'saved') toast('Picture saved — send it in the group chat');
    } catch (e) {
      toast(e?.message || 'Couldn’t make the picture on this phone');
    } finally { setBusy(false); }
  };
  return <button type="button" className={className} disabled={busy} onClick={go}>{busy ? 'Making the picture…' : label}</button>;
}
