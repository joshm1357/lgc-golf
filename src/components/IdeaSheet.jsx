// ov39 (Josh 25 Oct): "💡 Trip idea" — someone puts out an idea with whatever they know (a name, rough when, where,
// driving or flying, a note). It's a plan in the existing engine (kind 'trip', planning; proposed unless an organiser
// put it out) with idea = true (108). Nothing goes to the group until "📣 Share it" on the idea's page.
// Also: the "💭 Future trip ideas" strip on Trips — parked ideas anyone can open, add to and claim.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useSession, useData } from '../lib/store.jsx';
import { Sheet } from './ui.jsx';
import { useRun, must } from '../lib/run.js';
import { claimState } from '../lib/ideas.js';

const TRAVEL = [['', 'Not sure'], ['drive', '🚗 Drive'], ['fly', '✈️ Fly'], ['either', 'Either']];

export default function IdeaSheet({ onClose, onSaved }) {
  const { status } = useSession();
  const [name, setName] = useState('');
  const [when, setWhen] = useState('');
  const [where, setWhere] = useState('');
  const [travel, setTravel] = useState('');
  const [note, setNote] = useState('');
  const [busy, run] = useRun();
  const save = () => run(async () => {
    const p = await must(supabase.from('plans').insert({
      kind: 'trip', name: name.trim().slice(0, 80), status: 'planning', proposed: !status.is_admin, idea: true,
      idea_when: when.trim().slice(0, 80) || null, idea_where: where.trim().slice(0, 80) || null, idea_travel: travel || null,
      brief: note.trim().slice(0, 1000) || null,
    }).select().single());
    if (status.player_id) await supabase.from('plan_rsvps').upsert({ plan_id: p.id, player_id: status.player_id, status: 'in' });
    onClose(); onSaved?.(p);
  });
  return (
    <Sheet title="💡 Trip idea" onClose={onClose}>
      <div className="stack" data-testid="idea-sheet">
        <span className="small muted">Put in whatever you know — the group adds dates, areas and courses, and the Caddie chips in. Discussion can stay in your group chat.</span>
        <label className="field"><span>Name it</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. March fly trip" aria-label="Name it" /></label>
        <label className="field"><span>Roughly when (optional)</span><input className="input" value={when} onChange={(e) => setWhen(e.target.value)} placeholder="e.g. March, or the June long weekend" aria-label="Roughly when" /></label>
        <label className="field"><span>Where (optional)</span><input className="input" value={where} onChange={(e) => setWhere(e.target.value)} placeholder="e.g. somewhere we fly to, or within 3 h of Sydney" aria-label="Where" /></label>
        <span className="label">Getting there</span>
        <div className="seg light" role="group" aria-label="Getting there">
          {TRAVEL.map(([v, l]) => <button key={v || 'x'} type="button" aria-pressed={travel === v} onClick={() => setTravel(v)}>{l}</button>)}
        </div>
        <label className="field"><span>A note (optional)</span><textarea className="textarea" rows={3} style={{ padding: 12 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why it'd be great…" aria-label="A note" /></label>
        <button type="button" className="btn gold block" disabled={busy || name.trim().length < 2} onClick={save} data-testid="idea-save">💡 Make the idea</button>
        <span className="small muted">Next: 📣 Share it with the group — a post in the app and a link with a picture for the chat.</span>
      </div>
    </Sheet>
  );
}

/** "💭 Future trip ideas": parked ideas (108). Each says whose it is for now, or that it's up for grabs. */
export function FutureIdeas({ plans = [] }) {
  const { status } = useSession();
  const data = useData();
  return (
    <div className="stack" style={{ gap: 8 }} data-testid="future-ideas">
      <div className="stage-head"><span className="label">💭 Future trip ideas</span><span className="small muted">{plans.length}</span></div>
      {plans.map((p) => {
        const c = claimState(p, status.player_id);
        const owner = data.playersById[c.owner];
        return (
          <Link key={p.id} to={`/idea/${p.id}`} className="card pad stack" style={{ gap: 2, textDecoration: 'none', color: 'inherit', borderStyle: 'dashed' }} data-testid="future-idea">
            <strong>{p.name}</strong>
            <span className="small muted">{c.state === 'mine' ? '⏳ Yours if you want it — Claim it' : c.state === 'theirs' ? `⏳ ${owner?.nickname || owner?.name || 'Someone'}’s first` : '🙋 Up for grabs — anyone can claim it'}</span>
          </Link>
        );
      })}
    </div>
  );
}
