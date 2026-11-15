// ov44 — sharing a round ask to the group chat (claude/round-door-addendum.md piece 2).
// The link that's shared is the ask's own page (https://app.thegolftrip.club/a/<token> on Cloudflare), which WhatsApp,
// Messenger and iMessage can read: "⛳ Josh: anyone keen for a round?", the ask in a line, and a picture. The picture is
// drawn here the first time whoever put the ask out sees this card, uploaded like a trip idea's, and its address kept
// on the ask (ask_set_card, migration 113). If drawing or uploading fails, the link still works — the preview just
// uses The Golf Trip's own picture.
// big: nobody else has answered yet — sharing it is the one thing to do, so it's the gold button at the top.
import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { toast } from './ui.jsx';
import { shareText } from '../lib/push.js';
import { uploadPhoto } from '../lib/images.js';
import { drawIdeaPreview } from '../lib/shareCard.js';
import { DEFAULT_LOOK } from '../lib/theme.js';
import { askShareText, sunLines } from '../lib/ask.js';
import { askCard, askShareLink } from '../lib/askpreview.js';
import { count } from '../lib/door.js';

/** Draw the ask's picture, upload it and keep its address on the ask. Resolves either way (true = kept). */
export async function makeAskCard(plan, who) {
  try {
    const firstDate = (plan.ask?.range?.kind === 'dates' ? plan.ask.range.dates?.[0] : null);
    const sun = firstDate ? sunLines([firstDate], plan.ask?.place || null).line.split(' · ').slice(1, 3).join(' · ') : '';
    // The Golf Trip's own colours, not the group's: the picture is seen by people who aren't in any group.
    const file = await drawIdeaPreview(askCard({ who, ask: plan.ask, courseName: plan.location_name || '', sun }), { primary: DEFAULT_LOOK.primary, accent: DEFAULT_LOOK.accent });
    const url = await uploadPhoto(file, 'asks', {});
    if (!url || !/\/storage\/v1\/object\/public\/photos\//.test(url)) return false;
    const { error } = await supabase.rpc('ask_set_card', { p_plan: plan.id, p_card_url: url });
    return !error;
  } catch { return false; }
}

export default function AskShare({ plan, who = '', big = false, canMake = true }) {
  const link = plan.ask_token
    ? askShareLink({ origin: window.location.origin, base: import.meta.env.BASE_URL, token: plan.ask_token })
    : `${window.location.origin}${import.meta.env.BASE_URL}#/plan/${plan.id}?c=1`;
  const [ready, setReady] = useState(!!plan.card_url || !plan.ask_token || !canMake);
  const made = useRef(false);
  useEffect(() => {
    if (ready || made.current) return undefined;
    made.current = true;
    let live = true;
    // Never hold the share up for long: the link works without the picture.
    const t = setTimeout(() => { if (live) setReady(true); }, 4000);
    makeAskCard(plan, who).finally(() => { clearTimeout(t); if (live) setReady(true); });
    return () => { live = false; clearTimeout(t); };
  }, [plan.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const text = askShareText({ who, ask: plan.ask, courseName: plan.location_name || '', link });
  const share = async () => {
    const r = await shareText(text);
    if (r === 'cancelled') return;
    count(supabase, 'shared');
    if (r === 'copied') toast('Copied — paste it in the group chat');
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); count(supabase, 'shared'); toast('Link copied — paste it in the group chat'); } catch { toast('Couldn’t copy — press and hold the link'); }
  };
  if (!big) {
    return <button type="button" className="btn ghost block" onClick={share} disabled={!ready} data-testid="ask-share">💬 Share to the group chat</button>;
  }
  return (
    <div className="card pad stack" style={{ gap: 10, borderColor: 'var(--gold)', background: 'var(--gold-soft)' }} data-testid="ask-share-card">
      <strong style={{ fontSize: 18 }}>Your link’s ready — send it to the group chat</strong>
      <span className="small">Your mates tap the times they can play. No app, no sign-in. You’ll see the answers here as they come in.</span>
      <div className="ask-wa-card" data-testid="ask-share-preview"><strong>⛳ {who ? `${who}: a` : 'A'}nyone keen for a round?</strong><span className="small">Tap the times you can play. No app, no sign-in.</span><span className="small muted">{link.replace(/^https?:\/\//, '')}</span></div>
      <button type="button" className="btn gold block" style={{ minHeight: 56 }} onClick={share} disabled={!ready} data-testid="ask-share">{ready ? '💬 Share to the group chat' : 'Getting the link ready…'}</button>
      <button type="button" className="btn ghost block" onClick={copy} disabled={!ready} data-testid="ask-share-copy">🔗 Copy the link</button>
    </div>
  );
}
