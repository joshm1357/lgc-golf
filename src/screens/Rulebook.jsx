// The Rulebook: every rule and bonus we play by, which comps it applies to, and votes on changes.
// Anyone proposes; the lads vote (two taps, so no accidental votes); the admin decides.
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useData, useRealtime, useSession, playerName, useFeature } from '../lib/store.jsx';
import { STARTERS } from '../lib/starters.js';
import { Header, Sheet, Loading, toast } from '../components/ui.jsx';
import { notify } from '../lib/push.js';
import { useRun, must } from './Planner.jsx';
import { Link, useSearchParams } from 'react-router-dom';
import { useGovernance } from './Cases.jsx';
import { ruleLine, closesIn } from '../lib/governance.js';
import { ImportLink } from './AiImport.jsx';
import { StandardRules, RuleIdeas } from '../components/StandardRules.jsx';
import { standardOptions, standardRule } from '../lib/standardrules.js';
import { useRuleData, RulesFilterBar, RoundRules, TargetRules, RuleScopeFields, scopeRow, ScopeBadge } from '../components/RuleLayers.jsx';
import { filterLocal, loadFilter, saveFilter, chipTarget, scopeFromValue } from '../lib/rulelayers.js';
import { lateRulePatch, LATE_KEY } from '../lib/latejobs.js';
import { DRIVES_KEY, drivesRule, drivesRulePatch } from '../lib/drives.js';
import { DrivesTable } from '../components/RulePenalty.jsx';
import { LEFTOVER, LEFTOVER_KEY, REWARD_TYPES, signedAmount } from '../lib/awardsfines.js';

const CATS = [
  ['format', 'Format & scoring'], ['side_comp', 'Side comps'], ['bonus', 'Bonuses'], ['handicap', 'Handicaps'],
  ['etiquette', 'On the course'], ['fines', 'Fines & awards'], ['other', 'Other'],
];
const CAT = Object.fromEntries(CATS);
const APPLIES = [['all', 'Everything'], ['stableford', 'Stableford'], ['ambrose', 'Ambrose'], ['stroke', 'Stroke play'], ['fourball', '4BBB'], ['cup', 'The Cup'], ['trip', 'Trips']];
const APPLY = Object.fromEntries(APPLIES);
const VOTE = { for: '👍 For', against: '👎 Against', abstain: 'Abstain' };

function useRules() {
  const [d, setD] = useState(null);
  const load = useCallback(async () => {
    const [{ data: rules, error }, { data: votes }, { data: versions }] = await Promise.all([
      supabase.from('rules').select('*').order('sort').order('created_at'),
      supabase.from('rule_votes').select('*'),
      supabase.from('rule_versions').select('rule_id,event,case_id').not('case_id', 'is', null),
    ]);
    if (error) return;
    setD({ rules: rules || [], votes: votes || [], versions: versions || [] });
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtime(['rules', 'rule_votes'], load);
  return d ? { ...d, reload: load } : null;
}

export default function Rulebook({ embedded = false }) {
  const { status } = useSession();
  const votingOn = useFeature('rule_voting');
  const rb = useRules();
  const g = useGovernance();
  const gov = g?.ok ? g : null;
  const rd = useRuleData();
  const [params] = useSearchParams();
  // v3: the filter bar (chips, search, a round's rules). Remembered for this session; a link (?round= / ?f=) wins.
  const [view, setView] = useState(() => (params.get('round') || params.get('f') ? { filter: params.get('f') || 'all', round: params.get('round') || null } : loadFilter()));
  const [search, setSearch] = useState('');
  // {} = new. ?propose=1 (the Caddie's "Propose a rule") opens it straight away, for those who may propose.
  const [editing, setEditing] = useState(() => (params.get('propose') && (status.is_admin || (votingOn && status.role !== 'guest')) ? {} : null));
  useEffect(() => { saveFilter(view); }, [view]);
  useEffect(() => {
    const r = params.get('round'); const f = params.get('f');
    if (r || f) setView({ filter: f || 'all', round: r || null });
  }, [params]);
  if (!rb) return embedded ? <Loading /> : <div className="page"><Header logo title="The Rulebook" /><Loading /></div>;
  const filter = view.filter;
  const round = view.round ? rd.rounds.find((r) => r.id === view.round) : null;
  const classic = !round && filter === 'all' && !search.trim();
  const listMode = !round && ['local', 'voted', 'waiting'].includes(filter);
  const active = rb.rules.filter((r) => r.status === 'active');
  const listed = listMode ? filterLocal(rb.rules, filter, { versions: rb.versions, cases: gov?.cases || [], search }) : [];
  const newStart = chipTarget(filter) ? { category: 'other', applies_to: ['all'], status: 'proposed', ...scopeFromValue(filter) } : null;
  const proposed = rb.rules.filter((r) => r.status === 'proposed');
  const old = rb.rules.filter((r) => r.status === 'rejected' || r.status === 'retired');
  // The standard "Late organising job" rule (085) doesn't count as the group having rules.
  const showPicker = status.is_admin && rb.rules.filter((r) => !r.system_key && (r.status === 'active' || r.status === 'proposed')).length === 0;

  return (
    // Embedded: the Rulebook tab of Governance (ov19) — the hub draws the header.
    <div className={embedded ? undefined : 'page'}>
      {!embedded && <Header logo title="The Rulebook" sub="How we play, what counts, and what’s up for a vote" />}
      <div className="section stack">
        <RulesFilterBar filter={filter} onFilter={(f) => setView({ filter: f, round: null })} round={view.round} onRound={(r) => setView({ ...view, round: r })} search={search} onSearch={setSearch} rd={rd} />
        {round && <div className="row between" style={{ gap: 8 }}><strong style={{ fontSize: 17 }} data-testid="round-rules-title">📘 The rules for {round.name}</strong><button type="button" className="btn ghost sm" onClick={() => setView({ ...view, round: null })}>Close</button></div>}
        {round && <RoundRules round={round} localRules={rb.rules} rd={rd} search={search} />}
        {!round && !classic && !listMode && <TargetRules filter={filter} localRules={rb.rules} rd={rd} search={search} />}
        {listMode && (listed.length ? listed.map((r) => (r.status === 'proposed'
          ? <ProposedCard key={r.id} rule={r} votes={rb.votes.filter((v) => v.rule_id === r.id)} reload={() => { rb.reload(); gov?.reload(); }} onEdit={() => setEditing(r)} c={gov?.cases.find((x) => x.rule_id === r.id && x.kind === 'new_rule' && x.status === 'open')} />
          : <RuleCard key={r.id} rule={r} names={rd.names} />)) : <div className="empty">{filter === 'voted' ? 'No rules changed by a vote yet.' : filter === 'waiting' ? 'Nothing waiting for a vote.' : 'No rules match.'}</div>)}
        {classic && <>
        <StandardRules localRules={rb.rules} />
        <div data-testid="our-rules"><strong style={{ fontSize: 17 }}>🏌️ Local and special rules</strong><div className="small muted">Your group’s own rules — they beat the standard ones, and a rule for one comp beats both (for that comp).</div></div>

        {showPicker && <StarterPicker reload={rb.reload} />}

        {proposed.length > 0 && (
          <>
            <span className="label">🗳️ Up for a vote ({proposed.length})</span>
            {proposed.map((r) => <ProposedCard key={r.id} rule={r} votes={rb.votes.filter((v) => v.rule_id === r.id)} reload={() => { rb.reload(); gov?.reload(); }} onEdit={() => setEditing(r)}
              c={gov?.cases.find((x) => x.rule_id === r.id && x.kind === 'new_rule' && x.status === 'open')} />)}
          </>
        )}

        {CATS.map(([cat, label]) => {
          const list = active.filter((r) => r.category === cat);
          if (!list.length) return null;
          return (
            <div key={cat} className="stack" style={{ gap: 8 }}>
              <span className="label">{label}</span>
              {list.map((r) => <RuleCard key={r.id} rule={r} names={rd.names} />)}
            </div>
          );
        })}
        {active.filter((r) => !r.system_key).length === 0 && !showPicker && <div className="empty">No rules yet.{!status.is_admin && rb.rules.length === 0 ? ' Your organiser can start from a ready-made Rulebook.' : ''}</div>}
        </>}

        {(status.is_admin || (votingOn && status.role !== 'guest')) && <button type="button" className="btn gold block" onClick={() => setEditing(newStart ? { start: newStart } : {})}>{votingOn ? '+ Propose a rule' : '+ Add a rule'}</button>}
        {(status.is_admin || (votingOn && status.role !== 'guest')) && <RuleIdeas localRules={rb.rules} onPropose={(r) => setEditing({ start: r })} />}

        {status.is_admin && <ImportLink label="✨ Import rules from a photo or text" about="rules" />}

        {old.length > 0 && (
          <details>
            <summary className="label" style={{ padding: '8px 0', cursor: 'pointer' }}>Rejected & retired ({old.length})</summary>
            <div className="stack">{old.map((r) => <RuleCard key={r.id} rule={r} />)}</div>
          </details>
        )}
      </div>
      {editing && <RuleSheet rule={editing.id ? editing : null} start={editing.start} settings={gov?.settings} localRules={rb.rules} onClose={() => setEditing(null)} onSaved={rb.reload} />}
    </div>
  );
}

export function Chips({ rule }) {
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      {rule.value && <span className="small" style={{ padding: '2px 10px', borderRadius: 999, background: 'var(--gold-soft)', border: '1px solid var(--gold)', fontWeight: 800 }}>{rule.value}</span>}
      {rule.breach_strokes > 0 && !rule.system_key && <span className="small" data-testid="breach-chip" style={{ padding: '2px 10px', borderRadius: 999, background: '#FDF1EF', border: '1px solid var(--under)', fontWeight: 800 }}>⚖️ +{rule.breach_strokes} if broken</span>}
      {(rule.applies_to || []).map((a) => <span key={a} className="small" style={{ padding: '2px 10px', borderRadius: 999, background: '#EEF1F5', fontWeight: 600 }}>{APPLY[a] || a}</span>)}
      {standardRule(rule.overrides) && <span className="small" data-testid="changes-standard" style={{ padding: '2px 10px', borderRadius: 999, border: '1px solid var(--line)', fontWeight: 600 }}>Changes: {standardRule(rule.overrides).title}</span>}
    </div>
  );
}

// Tap any rule to open it: wording, history, rulings, and "Challenge this rule" (RulePage.jsx).
function RuleCard({ rule, names }) {
  const data = useData();
  const by = data.playersById[rule.proposed_by];
  return (
    <Link to={`/rules/${rule.id}`} className="card pad stack" style={{ gap: 6, textAlign: 'left', color: 'inherit', textDecoration: 'none', width: '100%', opacity: rule.status === 'active' || rule.status === 'proposed' ? 1 : 0.65 }}>
      <div className="row between" style={{ alignItems: 'flex-start', gap: 8 }}>
        <strong style={{ fontSize: 16 }}>{rule.title}</strong>
        {rule.status !== 'active' && <span className="small muted" style={{ fontWeight: 700, textTransform: 'uppercase' }}>{rule.status}</span>}
      </div>
      <Chips rule={rule} />
      {names && <ScopeBadge rule={rule} names={names} />}
      {rule.detail && <div style={{ fontSize: 15, lineHeight: 1.45 }}>{rule.detail}</div>}
      {(rule.decision_note || by) && <div className="small muted">{by ? `Proposed by ${playerName(by)}. ` : ''}{rule.decision_note || ''}</div>}
    </Link>
  );
}

function ProposedCard({ rule, votes, reload, onEdit, c }) {
  const data = useData();
  const { status } = useSession();
  const votingOn = useFeature('rule_voting');
  const me = status.player_id;
  const [pick, setPick] = useState(null);
  const [comment, setComment] = useState('');
  const [busy, run] = useRun();
  const mine = votes.find((v) => v.player_id === me);
  const count = (k) => votes.filter((v) => v.vote === k).length;
  const by = data.playersById[rule.proposed_by];
  // The group's decision rule (Stage 11b): an organiser decides (L.G.C, as before), or the vote does.
  const byVote = c && c.stage === 'voting';
  const decide = (to) => {
    const note = window.prompt(to === 'active' ? 'Adopt this rule. Any note? (optional)' : 'Reject this rule. Reason? (optional)', '');
    if (note === null) return;
    run(async () => {
      if (c) await must(supabase.rpc('decide_case', { p_case: c.id, p_outcome: to === 'active' ? 'passed' : 'failed', p_verdict: note.trim() || `${count('for')}–${count('against')} vote.` }));
      else await must(supabase.from('rules').update({ status: to, decided_at: new Date().toISOString(), decision_note: note.trim() || `${count('for')}–${count('against')} vote.` }).eq('id', rule.id));
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
      {status.role === 'guest' && <div className="small muted">Guests don’t vote on rules.</div>}
      {!votingOn && <div className="small muted">Voting on rules is switched off for this group.</div>}
      {me && status.role !== 'guest' && votingOn && (
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
                if (c) await must(supabase.rpc('vote_case', { p_case: c.id, p_vote: pick, p_comment: comment.trim() || null }));
                else await must(supabase.from('rule_votes').upsert({ rule_id: rule.id, player_id: me, vote: pick, comment: comment.trim() || null, updated_at: new Date().toISOString() }));
                setPick(null); setComment(''); reload();
              }, 'Vote recorded')}>Cast my vote: {VOTE[pick]}</button>
            </>
          )}
        </>
      )}
      {c && <div className="small muted">{ruleLine('new_rule', c.settings || {})}{byVote && c.closes_at ? ` · ${closesIn(c.closes_at)}` : ''} · <Link to={`/tribunal/case/${c.id}`}>the case</Link></div>}
      {status.is_admin && !byVote && (
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn gold sm" disabled={busy} onClick={() => decide('active')}>✅ Adopt</button>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => decide('rejected')}>❌ Reject</button>
        </div>
      )}
    </div>
  );
}

export function RuleSheet({ rule, start, onClose, onSaved, settings, localRules = [] }) {
  const { status } = useSession();
  const isAdmin = status.is_admin;
  // Stage 11b: an organiser adds, changes or retires rules directly only where the group's decision rule says an
  // organiser decides (L.G.C does). Otherwise it's a vote / a challenge — the database refuses the shortcut.
  const direct = (k) => !settings || settings[k]?.decides === 'organiser';
  const [v, set] = useState(() => rule || start || { category: 'side_comp', applies_to: ['ambrose'], status: 'proposed' });
  const isLate = rule?.system_key === LATE_KEY; // the standard late job rule: two numbers instead of "Worth" 
  const isLeftover = rule?.system_key === LEFTOVER_KEY; // 093: the leftover kitty — a choice instead of "Worth"
  const isAward = !!rule?.award_kind; // 093: an award or fine — its worth comes from the reward
  const isDrives = rule?.system_key === DRIVES_KEY; // 099: Ambrose minimum drives — drives each by team size + strokes
  const canBreach = !isLate && !isLeftover && !isAward && !isDrives; // 099: any other rule can carry a penalty
  const [busy, run] = useRun();
  const f = (k) => ({ value: v[k] ?? '', onChange: (e) => set({ ...v, [k]: e.target.value }) });
  const toggle = (a) => {
    let next = v.applies_to.includes(a) ? v.applies_to.filter((x) => x !== a) : [...v.applies_to.filter((x) => (a === 'all' ? false : x !== 'all')), a];
    if (!next.length) next = ['all'];
    set({ ...v, applies_to: next });
  };
  const save = (asStatus) => run(async () => {
    const row = { title: v.title.trim(), detail: v.detail?.trim() || null, category: v.category, applies_to: v.applies_to, value: v.value?.trim() || null };
    if (isLeftover) {
      Object.assign(row, { leftover: v.leftover || 'bar', leftover_note: v.leftover === 'other' ? (v.leftover_note || '').trim() || null : null });
      delete row.value; // the server writes the words from the choice
      if (row.detail === (rule.detail || '').trim()) row.detail = rule.detail;
    }
    if (isAward) {
      const t = REWARD_TYPES.find((x) => x.key === rule.reward_type);
      if (t?.amount) row.reward_amount = signedAmount(rule.award_kind, rule.reward_type, v.reward_abs ?? Math.abs(rule.reward_amount || 0));
      row.reward_note = (v.reward_note || '').trim() || null;
      delete row.value; // the server writes "−1 stroke" / "$5" from the reward
      row.category = 'fines';
    }
    if (isLate) {
      const p = lateRulePatch(v.late_strokes, v.late_days);
      if (p.error) throw new Error(p.error);
      Object.assign(row, p);
      delete row.value; // the server writes "2 strokes · 5 days" from the numbers
      // Wording left as it was: the server rewrites it to the new numbers (it keeps an organiser's own wording).
      if (row.detail === (rule.detail || '').trim()) row.detail = rule.detail;
    }
    if (isDrives) {
      const p = drivesRulePatch({ n2: v.drives_2 ?? 6, n3: v.drives_3 ?? 6, n4: v.drives_4 ?? 4, strokes: v.breach_strokes ?? 2 });
      if (p.error) throw new Error(p.error);
      Object.assign(row, p);
      delete row.value; // the server writes "6 drives each in a three · …" from the numbers
      if (row.detail === (rule.detail || '').trim()) row.detail = rule.detail;
    }
    if (canBreach && String(v.breach_strokes ?? '') !== String(rule?.breach_strokes ?? '')) {
      // Only sent when it changes, so an older database (no column) still saves the rest.
      const t = String(v.breach_strokes ?? '').trim();
      const n = t === '' ? null : Number(t);
      if (n != null && (!Number.isInteger(n) || n < 0 || n > 10)) throw new Error('Penalty strokes: a whole number from 0 to 10');
      row.breach_strokes = n;
    }
    // Which standard rule it changes (073). Only sent when set (or being cleared), so an older database still works.
    if (v.overrides || rule?.overrides) row.overrides = v.overrides || null;
    Object.assign(row, scopeRow(v, rule)); // v3 (076): what it's for, and which of our rules it changes
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
        {isLate ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }} data-testid="late-rule-fields">
            <label className="field"><span>Penalty strokes (0 = off)</span><input className="input" inputMode="numeric" data-testid="late-strokes" {...f('late_strokes')} /></label>
            <label className="field"><span>Days overdue before it counts</span><input className="input" inputMode="numeric" data-testid="late-days" {...f('late_days')} /></label>
          </div>
        ) : isLeftover ? (
          <div className="stack" style={{ gap: 6 }} data-testid="leftover-fields">
            <label className="field"><span>What happens to the leftover kitty</span>
              <select className="select" value={v.leftover || 'bar'} onChange={(e) => set({ ...v, leftover: e.target.value })} data-testid="leftover-choice">
                {LEFTOVER.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
              </select>
            </label>
            {v.leftover === 'other' && <label className="field"><span>In words</span><input className="input" maxLength={80} {...f('leftover_note')} placeholder="e.g. Goes to the greenkeeper’s Christmas fund" /></label>}
          </div>
        ) : isAward ? (
          <div className="stack" style={{ gap: 6 }} data-testid="award-fields">
            {REWARD_TYPES.find((x) => x.key === rule.reward_type)?.amount && (
              <label className="field"><span>{rule.reward_type === 'money' ? 'How much ($)' : rule.reward_type === 'strokes' ? (rule.award_kind === 'fine' ? 'Strokes added' : 'Strokes off') : 'Points'}</span>
                <input className="input" inputMode="decimal" value={v.reward_abs ?? Math.abs(rule.reward_amount || 0)} onChange={(e) => set({ ...v, reward_abs: e.target.value.replace(/[^\d.]/g, '') })} data-testid="award-amount" /></label>
            )}
            <label className="field"><span>In words (optional)</span><input className="input" maxLength={80} value={v.reward_note || ''} onChange={(e) => set({ ...v, reward_note: e.target.value })} /></label>
          </div>
        ) : isDrives ? (
          <div className="stack" style={{ gap: 6 }} data-testid="drive-rule-fields">
            <span className="small muted">Drives each player needs over 18 holes (half on 9, and never more than a fair share of the holes).</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label className="field"><span>Team of three</span><input className="input" inputMode="numeric" data-testid="drives-3" {...f('drives_3')} /></label>
              <label className="field"><span>Team of four</span><input className="input" inputMode="numeric" data-testid="drives-4" {...f('drives_4')} /></label>
              <label className="field"><span>Pair</span><input className="input" inputMode="numeric" data-testid="drives-2" {...f('drives_2')} /></label>
              <label className="field"><span>Strokes per drive short</span><input className="input" inputMode="numeric" data-testid="drives-strokes" {...f('breach_strokes')} /></label>
            </div>
            <DrivesTable dr={drivesRule([{ ...rule, drives_2: v.drives_2, drives_3: v.drives_3, drives_4: v.drives_4 }])} />
          </div>
        ) : (
          <>
            <label className="field"><span>Worth / amount (optional)</span><input className="input" {...f('value')} placeholder="e.g. −1 stroke, +2 points, $5" /></label>
            <label className="field"><span>Penalty for breaking it — strokes (optional)</span><input className="input" inputMode="numeric" data-testid="breach-strokes-input" {...f('breach_strokes')} placeholder="e.g. 2 — blank for none" /></label>
          </>
        )}
        <label className="field"><span>Details</span><textarea className="textarea" rows={4} style={{ padding: 12 }} {...f('detail')} placeholder="How it works, when it counts" /></label>
        <label className="field"><span>Type</span>
          <select className="select" {...f('category')}>{CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
        <label className="field"><span>Changes a standard rule? (optional)</span>
          <select className="select" value={v.overrides || ''} onChange={(e) => set({ ...v, overrides: e.target.value || null })} data-testid="overrides-select">
            <option value="">No — it’s an extra rule</option>
            {standardOptions().map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
        <RuleScopeFields v={v} set={set} localRules={localRules} />
        <span className="label">Applies to</span>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {APPLIES.map(([k, l]) => <button key={k} type="button" className="chip" aria-pressed={v.applies_to.includes(k)} onClick={() => toggle(k)}>{l}</button>)}
        </div>
        {!rule && !isAdmin && <span className="small muted">It goes up for a vote; the admin decides.</span>}
        {!rule && isAdmin && direct('new_rule') && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button type="button" className="btn gold" disabled={busy || !ok} onClick={() => save('proposed')}>Put it to a vote</button>
            <button type="button" className="btn ghost" disabled={busy || !ok} onClick={() => save('active')}>Add it straight in</button>
          </div>
        )}
        {!rule && isAdmin && !direct('new_rule') && <button type="button" className="btn gold block" disabled={busy || !ok} onClick={() => save('proposed')}>Put it up for a vote</button>}
        {!rule && !isAdmin && <button type="button" className="btn gold block" disabled={busy || !ok} onClick={() => save('proposed')}>Put it up for a vote</button>}
        {rule && <button type="button" className="btn gold block" disabled={busy || !ok} onClick={() => save(rule.status)}>Save</button>}
        {rule && isAdmin && rule.status === 'active' && direct('scrap_rule') && <button type="button" className="btn ghost block" disabled={busy} onClick={() => save('retired')}>Retire this rule</button>}
        {rule && isAdmin && (rule.status === 'retired' || rule.status === 'rejected') && <button type="button" className="btn ghost block" disabled={busy} onClick={() => save('active')}>Bring it back</button>}
        {isLate && <span className="small muted">A standard rule — switch it off with 0 strokes (or retire it); it can’t be deleted.</span>}
        {isDrives && <span className="small muted">A standard rule — 0 strokes keeps the count with no penalty; retire it to stop tracking. It can’t be deleted. The organiser can change the numbers for one round in the round’s settings.</span>}
        {rule && !isLate && !isLeftover && !isDrives && (isAdmin || rule.status === 'proposed') && (
          <button type="button" className="btn ghost block" onClick={() => { if (window.confirm('Delete this rule completely?')) run(async () => { await must(supabase.from('rules').delete().eq('id', rule.id)); onSaved(); onClose(); toast('Deleted'); }); }}>Delete</button>
        )}
      </div>
    </Sheet>
  );
}

/** A group with no rules yet: start from one of the starter rulebooks (organisers). */
function StarterPicker({ reload }) {
  const [busy, run] = useRun();
  const bonusOn = useFeature('comp_bonus');
  return (
    <div className="card pad stack" style={{ gap: 10, borderColor: 'var(--gold)' }}>
      <div><strong>📖 Start your Rulebook</strong><div className="small muted">Pick a starting point — you can change, add or remove any rule afterwards.</div></div>
      {STARTERS.map((s) => (
        <div key={s.key} className="card pad stack" style={{ gap: 6 }}>
          <strong>{s.name}</strong>
          <span className="small">{s.blurb}</span>
          <span className="small muted">{s.rules.join(' · ')}</span>
          {s.key === 'ambrose_stableford' && !bonusOn && <span className="small muted">The −2 strokes only come off once side comp bonus strokes are switched on (Group &amp; invites → Features).</span>}
          <button type="button" className="btn gold block" disabled={busy} onClick={() => window.confirm(`Add the ${s.name} rules? You can edit or retire any of them afterwards.`) && run(async () => {
            await must(supabase.rpc('use_starter_rulebook', { p_starter: s.key }));
            reload();
          }, `${s.name} rules added`)}>Use these rules</button>
        </div>
      ))}
    </div>
  );
}
