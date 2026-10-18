// The Rulebook: every rule and bonus we play by, which comps it applies to, and votes on changes.
// Anyone proposes; the lads vote (two taps, so no accidental votes); the admin decides.
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useData, useRealtime, useSession, playerName } from '../lib/store.jsx';
import { Header, Sheet, Loading, toast } from '../components/ui.jsx';
import { notify } from '../lib/push.js';
import { useRun, must } from './Planner.jsx';

const CATS = [
  ['format', 'Format & scoring'], ['side_comp', 'Side comps'], ['bonus', 'Bonuses'], ['handicap', 'Handicaps'],
  ['etiquette', 'On the course'], ['fines', 'Fines'], ['other', 'Other'],
];
const CAT = Object.fromEntries(CATS);
const APPLIES = [['all', 'Everything'], ['stableford', 'Stableford'], ['ambrose', 'Ambrose'], ['trip', 'Trips']];
const APPLY = Object.fromEntries(APPLIES);
const VOTE = { for: '👍 For', against: '👎 Against', abstain: 'Abstain' };

function useRules() {
  const [d, setD] = useState(null);
  const load = useCallback(async () => {
    const [{ data: rules, error }, { data: votes }] = await Promise.all([
      supabase.from('rules').select('*').order('sort').order('created_at'),
      supabase.from('rule_votes').select('*'),
    ]);
    if (error) return;
    setD({ rules: rules || [], votes: votes || [] });
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtime(['rules', 'rule_votes'], load);
  return d ? { ...d, reload: load } : null;
}

export default function Rulebook() {
  const { status } = useSession();
  const rb = useRules();
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null); // {} = new
  if (!rb) return <div className="page"><Header logo title="The Rulebook" /><Loading /></div>;
  const fits = (r) => filter === 'all' || r.applies_to.includes('all') || r.applies_to.includes(filter);
  const active = rb.rules.filter((r) => r.status === 'active' && fits(r));
  const proposed = rb.rules.filter((r) => r.status === 'proposed');
  const old = rb.rules.filter((r) => r.status === 'rejected' || r.status === 'retired');

  return (
    <div className="page">
      <Header logo title="The Rulebook" sub="How we play, what counts, and what’s up for a vote" />
      <div className="section stack">
        <div className="seg light" role="group">
          {[['all', 'All'], ['stableford', 'Stableford'], ['ambrose', 'Ambrose']].map(([k, l]) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
        </div>

        {proposed.length > 0 && (
          <>
            <span className="label">🗳️ Up for a vote ({proposed.length})</span>
            {proposed.map((r) => <ProposedCard key={r.id} rule={r} votes={rb.votes.filter((v) => v.rule_id === r.id)} reload={rb.reload} onEdit={() => setEditing(r)} />)}
          </>
        )}

        {CATS.map(([cat, label]) => {
          const list = active.filter((r) => r.category === cat);
          if (!list.length) return null;
          return (
            <div key={cat} className="stack" style={{ gap: 8 }}>
              <span className="label">{label}</span>
              {list.map((r) => <RuleCard key={r.id} rule={r} onEdit={status.is_admin ? () => setEditing(r) : null} />)}
            </div>
          );
        })}
        {active.length === 0 && <div className="empty">No rules for this comp yet.</div>}

        <button type="button" className="btn gold block" onClick={() => setEditing({})}>+ Propose a rule</button>

        {old.length > 0 && (
          <details>
            <summary className="label" style={{ padding: '8px 0', cursor: 'pointer' }}>Rejected & retired ({old.length})</summary>
            <div className="stack">{old.map((r) => <RuleCard key={r.id} rule={r} onEdit={status.is_admin ? () => setEditing(r) : null} />)}</div>
          </details>
        )}
      </div>
      {editing && <RuleSheet rule={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={rb.reload} />}
    </div>
  );
}

function Chips({ rule }) {
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      {rule.value && <span className="small" style={{ padding: '2px 10px', borderRadius: 999, background: 'var(--gold-soft)', border: '1px solid var(--gold)', fontWeight: 800 }}>{rule.value}</span>}
      {rule.applies_to.map((a) => <span key={a} className="small" style={{ padding: '2px 10px', borderRadius: 999, background: '#EEF1F5', fontWeight: 600 }}>{APPLY[a] || a}</span>)}
    </div>
  );
}

function RuleCard({ rule, onEdit }) {
  const data = useData();
  const by = data.playersById[rule.proposed_by];
  return (
    <button type="button" className="card pad stack" disabled={!onEdit} onClick={onEdit || undefined} style={{ gap: 6, textAlign: 'left', color: 'inherit', width: '100%', opacity: rule.status === 'active' || rule.status === 'proposed' ? 1 : 0.65 }}>
      <div className="row between" style={{ alignItems: 'flex-start', gap: 8 }}>
        <strong style={{ fontSize: 16 }}>{rule.title}</strong>
        {rule.status !== 'active' && <span className="small muted" style={{ fontWeight: 700, textTransform: 'uppercase' }}>{rule.status}</span>}
      </div>
      <Chips rule={rule} />
      {rule.detail && <div style={{ fontSize: 15, lineHeight: 1.45 }}>{rule.detail}</div>}
      {(rule.decision_note || by) && <div className="small muted">{by ? `Proposed by ${playerName(by)}. ` : ''}{rule.decision_note || ''}</div>}
    </button>
  );
}

function ProposedCard({ rule, votes, reload, onEdit }) {
  const data = useData();
  const { status } = useSession();
  const me = status.player_id;
  const [pick, setPick] = useState(null);
  const [comment, setComment] = useState('');
  const [busy, run] = useRun();
  const mine = votes.find((v) => v.player_id === me);
  const count = (k) => votes.filter((v) => v.vote === k).length;
  const by = data.playersById[rule.proposed_by];
  const decide = (to) => {
    const note = window.prompt(to === 'active' ? 'Adopt this rule. Any note? (optional)' : 'Reject this rule. Reason? (optional)', '');
    if (note === null) return;
    run(async () => {
      await must(supabase.from('rules').update({ status: to, decided_at: new Date().toISOString(), decision_note: note.trim() || `${count('for')}–${count('against')} vote.` }).eq('id', rule.id));
      await supabase.from('posts').insert({ kind: 'user', player_id: me, link: '/rules', body: `${to === 'active' ? '✅ New rule' : '❌ Rule rejected'}: ${rule.title}${rule.value ? ` (${rule.value})` : ''}. Vote was ${count('for')}–${count('against')}.` });
      await notify('rule_decided', { rule_id: rule.id });
      reload();
    }, to === 'active' ? 'Adopted — it’s in the Rulebook' : 'Rejected');
  };
  return (
    <div className="card pad stack" style={{ gap: 8, borderColor: 'var(--gold)' }}>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <strong style={{ fontSize: 17 }}>{rule.title}</strong>
        {(status.is_admin || rule.proposed_by === me) && <button type="button" className="btn ghost sm" onClick={onEdit}>Edit</button>}
      </div>
      <Chips rule={rule} />
      {rule.detail && <div style={{ fontSize: 15, lineHeight: 1.45 }}>{rule.detail}</div>}
      <div className="small muted">Proposed by {by ? playerName(by) : 'the admin'}</div>
      <div className="row" style={{ gap: 14, fontWeight: 800 }}><span>👍 {count('for')}</span><span>👎 {count('against')}</span><span className="muted">Abstain {count('abstain')}</span></div>
      {votes.length > 0 && <div className="small muted">{votes.map((v) => `${playerName(data.playersById[v.player_id])}: ${VOTE[v.vote].replace(/^\S+ /, '')}${v.comment ? ` — “${v.comment}”` : ''}`).join(' · ')}</div>}
      {me && (
        <>
          {mine && <div className="small"><strong>Your vote: {VOTE[mine.vote]}.</strong> <span className="muted">Pick another and confirm to change it.</span></div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {Object.entries(VOTE).map(([k, l]) => {
              const on = (pick || mine?.vote) === k;
              return <button key={k} type="button" className="btn ghost sm" aria-pressed={on} style={on ? { background: 'var(--navy)', color: '#fff', borderColor: 'var(--navy)' } : {}} onClick={() => setPick(k === mine?.vote ? null : k)}>{on ? '✓ ' : ''}{l}</button>;
            })}
          </div>
          {pick && pick !== mine?.vote && (
            <>
              <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="One-liner (optional)" />
              <button type="button" className="btn gold block" disabled={busy} onClick={() => run(async () => {
                await must(supabase.from('rule_votes').upsert({ rule_id: rule.id, player_id: me, vote: pick, comment: comment.trim() || null, updated_at: new Date().toISOString() }));
                setPick(null); setComment(''); reload();
              }, 'Vote recorded')}>Cast my vote: {VOTE[pick]}</button>
            </>
          )}
        </>
      )}
      {status.is_admin && (
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn gold sm" disabled={busy} onClick={() => decide('active')}>✅ Adopt</button>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => decide('rejected')}>❌ Reject</button>
        </div>
      )}
    </div>
  );
}

function RuleSheet({ rule, onClose, onSaved }) {
  const { status } = useSession();
  const isAdmin = status.is_admin;
  const [v, set] = useState(() => rule || { category: 'side_comp', applies_to: ['ambrose'], status: 'proposed' });
  const [busy, run] = useRun();
  const f = (k) => ({ value: v[k] ?? '', onChange: (e) => set({ ...v, [k]: e.target.value }) });
  const toggle = (a) => {
    let next = v.applies_to.includes(a) ? v.applies_to.filter((x) => x !== a) : [...v.applies_to.filter((x) => (a === 'all' ? false : x !== 'all')), a];
    if (!next.length) next = ['all'];
    set({ ...v, applies_to: next });
  };
  const save = (asStatus) => run(async () => {
    const row = { title: v.title.trim(), detail: v.detail?.trim() || null, category: v.category, applies_to: v.applies_to, value: v.value?.trim() || null };
    if (rule) {
      const extra = isAdmin && asStatus && asStatus !== rule.status ? { status: asStatus, decided_at: asStatus === 'proposed' ? null : new Date().toISOString() } : {};
      await must(supabase.from('rules').update({ ...row, ...extra }).eq('id', rule.id));
      if (extra.status && extra.status !== 'proposed') await notify('rule_decided', { rule_id: rule.id });
    } else {
      const created = await must(supabase.from('rules').insert({ ...row, status: isAdmin ? asStatus : 'proposed', decided_at: asStatus === 'active' ? new Date().toISOString() : null }).select().single());
      if (created.status === 'proposed') {
        await supabase.from('posts').insert({ kind: 'user', player_id: status.player_id, link: '/rules', body: `📜 Rule up for a vote: ${created.title}${created.value ? ` (${created.value})` : ''}` });
        await notify('rule_proposed', { rule_id: created.id });
      }
    }
    onSaved(); onClose();
  }, rule ? 'Saved' : isAdmin && asStatus === 'active' ? 'Added to the Rulebook' : 'Up for a vote');
  const ok = v.title?.trim();
  return (
    <Sheet title={rule ? 'Edit rule' : 'Propose a rule'} onClose={onClose}>
      <div className="stack">
        <label className="field"><span>Rule</span><input className="input" {...f('title')} placeholder="e.g. Birdie bonus" /></label>
        <label className="field"><span>Worth / amount (optional)</span><input className="input" {...f('value')} placeholder="e.g. −1 stroke, +2 points, $5" /></label>
        <label className="field"><span>Details</span><textarea className="textarea" rows={4} style={{ padding: 12 }} {...f('detail')} placeholder="How it works, when it counts" /></label>
        <label className="field"><span>Type</span>
          <select className="select" {...f('category')}>{CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
        <span className="label">Applies to</span>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {APPLIES.map(([k, l]) => <button key={k} type="button" className="chip" aria-pressed={v.applies_to.includes(k)} onClick={() => toggle(k)}>{l}</button>)}
        </div>
        {!rule && !isAdmin && <span className="small muted">It goes up for a vote; the admin decides.</span>}
        {!rule && isAdmin && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button type="button" className="btn gold" disabled={busy || !ok} onClick={() => save('proposed')}>Put it to a vote</button>
            <button type="button" className="btn ghost" disabled={busy || !ok} onClick={() => save('active')}>Add it straight in</button>
          </div>
        )}
        {!rule && !isAdmin && <button type="button" className="btn gold block" disabled={busy || !ok} onClick={() => save('proposed')}>Put it up for a vote</button>}
        {rule && <button type="button" className="btn gold block" disabled={busy || !ok} onClick={() => save(rule.status)}>Save</button>}
        {rule && isAdmin && rule.status === 'active' && <button type="button" className="btn ghost block" disabled={busy} onClick={() => save('retired')}>Retire this rule</button>}
        {rule && isAdmin && (rule.status === 'retired' || rule.status === 'rejected') && <button type="button" className="btn ghost block" disabled={busy} onClick={() => save('active')}>Bring it back</button>}
        {rule && (isAdmin || rule.status === 'proposed') && (
          <button type="button" className="btn ghost block" onClick={() => { if (window.confirm('Delete this rule completely?')) run(async () => { await must(supabase.from('rules').delete().eq('id', rule.id)); onSaved(); onClose(); toast('Deleted'); }); }}>Delete</button>
        )}
      </div>
    </Sheet>
  );
}
