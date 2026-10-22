// The Tribunal hears anything (Stage 11b): cases of every kind, the hearing, votes, verdicts, and the group's
// Governance settings (who decides what) with committees and terms.
// The app shows what will happen; the database decides (migration 061). All the rules are in lib/governance.js.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useData, useRealtime, useSession, playerName, useFeature } from '../lib/store.jsx';
import { uploadPhoto } from '../lib/images.js';
import { isBlocked } from '../lib/injokes.js';
import { useRun, must } from '../lib/run.js';
import { Header, Avatar, Icon, Sheet, PhotoButtons, timeAgo, toast, Loading } from '../components/ui.jsx';
import SharePicture from '../components/SharePicture.jsx';
import { VerdictToRulebook } from '../components/RuleLayers.jsx';
import {
  KIND, DECIDES, EFFECT, PRESETS, decidesFor, effectiveSettings, settingsProblems, electorate, evaluate, tally, canRaise,
  canVote, canDecide, canApproveMidTrip, verdictWord, verdictLine, voteWords, closesIn, ruleLine, applyWords, termStatus,
  termLabel, challengeBlock, sydneyDate,
} from '../lib/governance.js';
import {
  disputeTitle, refForServer, valueWords, SOURCE, subjectLine, canApplyVerdict, applySpec, parseApplyValue, suggestedValue, appliedLine,
} from '../lib/disputes.js';
import { refreshDisputes } from '../components/RuleTag.jsx';

const KIND_EMOJI = { new_rule: '📜', change_rule: '✏️', scrap_rule: '🗑️', ruling: '🔎', handicap: '⛳', other: '👔', election: '🪑', governance: '🏛️' };
const SETTINGS_KINDS = ['new_rule', 'change_rule', 'scrap_rule', 'ruling', 'handicap', 'other', 'election', 'governance'];
const KEEP_FRIENDLY = 'Keep it friendly — roast the golf and the mates, never who someone is.';

// ------------------------------------------------------------------ data
/** Everything the Tribunal screens need, live. (An older database without migration 061: ok = false.) */
export function useGovernance() {
  const { status } = useSession();
  const [d, setD] = useState(null);
  const load = useCallback(async () => {
    const q = (t, sel = '*') => supabase.from(t).select(sel);
    const [cases, votes, posts, settings, gg, committees, seats, ruleVotes, members, groups] = await Promise.all([
      q('cases').order('created_at', { ascending: false }), q('case_votes'), q('case_posts').order('created_at'),
      q('governance_settings'), q('governance_group'), q('committees').order('created_at'), q('committee_seats').order('seat_no'),
      q('rule_votes'), q('group_members', 'player_id,role'),
      status?.group_id ? supabase.from('groups').select('id,vote_decider').eq('id', status.group_id) : Promise.resolve({ data: [] }),
    ]);
    setD({
      ok: !cases.error,
      cases: cases.data || [], votes: votes.data || [], posts: posts.data || [], settingsRows: settings.data || [],
      group: (gg.data || [])[0] || null, committees: committees.data || [], seats: seats.data || [], ruleVotes: ruleVotes.data || [],
      members: members.data || [], voteDecider: (groups.data || [])[0]?.vote_decider || 'admin',
    });
  }, [status?.group_id]);
  useEffect(() => {
    load();
    // Close any case whose time is up and apply what's due (the hourly job does this too).
    supabase.rpc('governance_tick').then(({ data: n }) => { if (n > 0) load(); }, () => {});
  }, [load]);
  useRealtime(['cases', 'case_votes', 'case_posts', 'governance_settings', 'governance_group', 'committees', 'committee_seats', 'rule_votes'], load);
  return useMemo(() => {
    if (!d) return null;
    const settings = effectiveSettings(d.settingsRows, { preset: null, voteDecider: d.voteDecider });
    const seatsOf = (committeeId) => {
      const c = d.committees.find((x) => x.id === committeeId);
      return d.seats.filter((s) => s.committee_id === committeeId && (!c || s.seat_no <= c.seats)).map((s) => s.player_id).filter(Boolean);
    };
    return { ...d, settings, seatsOf, reload: load };
  }, [d, load]);
}

/** Votes on a case (a new rule's votes are the Rulebook's votes). */
export function caseVotes(g, c) {
  if (c.kind === 'new_rule' && c.rule_id) return g.ruleVotes.filter((v) => v.rule_id === c.rule_id);
  return g.votes.filter((v) => v.case_id === c.id);
}
/** Who votes on a case, and where it stands (for showing; the database decides). */
export function caseState(g, c, now = new Date()) {
  const s = c.settings || {};
  const fallback = c.stage !== 'voting';
  const e = electorate({ settings: s, members: g.members, seats: g.seatsOf(s.committee_id), subjectId: c.subject_id, fallback });
  const votes = caseVotes(g, c);
  const t = tally(votes, e.voters);
  if (c.status !== 'open') return { ...e, votes, tally: t, state: c.status, reason: c.reason };
  if (c.stage === 'casting') return { ...e, votes, tally: t, state: 'casting', reason: c.reason || 'A tie — an organiser has the casting vote' };
  if (c.stage === 'fallback') return { ...e, votes, tally: t, state: 'fallback', reason: c.reason || 'The organisers decide' };
  const r = evaluate({ settings: s, voters: e.voters, votes, closed: c.closes_at && new Date(c.closes_at) <= now, fallback });
  return { ...e, votes, tally: t, ...r };
}

function useKindOn() {
  const on = {
    tribunal: useFeature('tribunal'), rule_voting: useFeature('rule_voting'), rule_challenges: useFeature('rule_challenges'),
    other_cases: useFeature('other_cases'), committees: useFeature('committees'),
  };
  return (k) => {
    if (k === 'new_rule') return on.rule_voting;
    if (['change_rule', 'scrap_rule', 'ruling'].includes(k)) return on.rule_challenges && on.rule_voting;
    if (k === 'other') return on.other_cases;
    if (k === 'election') return on.committees;
    return on.tribunal;
  };
}

// ------------------------------------------------------------------ list rows
export function CaseRowNew({ c, g }) {
  const data = useData();
  const st = caseState(g, c);
  const subject = data.playersById[c.subject_id];
  const open = c.status === 'open';
  const sub = open
    ? `${KIND[c.kind]?.label} · ${st.state === 'organiser' ? 'an organiser decides' : st.state === 'casting' ? 'tie — casting vote' : st.state === 'fallback' ? 'with the organisers' : `${st.tally.for}–${st.tally.against} so far · ${closesIn(c.closes_at)}`}`
    : `${KIND[c.kind]?.label} · ${verdictWord(c)}${c.votes_for != null ? ` ${c.votes_for}–${c.votes_against}` : ''}${applyWords(c) && c.apply_state !== 'applied' ? ` · ${applyWords(c)}` : ''}`;
  return (
    <Link to={`/tribunal/case/${c.id}`} className="card pad row" style={{ color: 'inherit', textDecoration: 'none', gap: 12, opacity: c.hidden ? 0.6 : 1 }}>
      {subject ? <Avatar player={subject} size={44} /> : <span aria-hidden style={{ width: 44, textAlign: 'center', fontSize: 26 }}>{KIND_EMOJI[c.kind]}</span>}
      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{c.kind === 'other' && subject ? `The Lads v ${playerName(subject)}` : c.title}</div>
        {c.kind === 'other' && subject && <div className="small">{c.title}</div>}
        <div className="small muted">{c.hidden ? 'Hidden · ' : ''}{sub}</div>
      </div>
      <span className="muted">{Icon.next()}</span>
    </Link>
  );
}

// ------------------------------------------------------------------ raise a case
/** The kinds this person can raise from the Tribunal (governance changes and elections start from Governance). */
export function useRaisableKinds(g) {
  const { status } = useSession();
  const on = useKindOn();
  if (!g || !status || status.role === 'guest') return [];
  return ['other', 'handicap', 'change_rule', 'scrap_rule', 'ruling', 'new_rule']
    .filter((k) => on(k) && canRaise({ role: status.role, settings: g.settings[k] }));
}

/** Raise a case. With `dispute` (a RuleTag's reference, migration 082) it's a dispute about that rule or setting. */
export function RaiseCase(props) {
  if (props.dispute) return <RaiseDispute {...props} />;
  return <RaiseCaseForm {...props} />;
}

// A dispute: a ruling case about one rule or setting, filled in from where it was tapped.
function RaiseDispute({ g, dispute, onClose }) {
  const nav = useNavigate();
  const [title, setTitle] = useState(() => disputeTitle(dispute.label));
  const [body, setBody] = useState('');
  const [suggest, setSuggest] = useState('');
  const [file, setFile] = useState(null);
  const [busy, run] = useRun();
  const blocked = isBlocked([title, body, suggest].join(' '));
  const ok = !blocked && title.trim().length >= 3;
  const submit = () => run(async () => {
    const url = file ? await uploadPhoto(file, 'tribunal') : null;
    const id = await must(supabase.rpc('raise_dispute', {
      p_ref: refForServer(dispute), p_title: title.trim(), p_body: body.trim() || null, p_suggest: suggest.trim() || null, p_evidence_url: url,
    }));
    g.reload();
    refreshDisputes();
    onClose();
    nav(`/tribunal/case/${id}`);
  }, 'Dispute raised');
  return (
    <Sheet title="Dispute this" onClose={onClose}>
      <div className="stack" data-testid="raise-dispute">
        <div className="card pad small stack" style={{ gap: 4 }} data-testid="dispute-subject">
          <span className="muted">{SOURCE[dispute.table] || 'Setting'}{dispute.table !== 'standard' && dispute.value !== undefined ? ` · now: ${valueWords(dispute.value)}` : ''}</span>
          <strong>{dispute.label}</strong>
          {dispute.explain && <span className="muted">{dispute.explain}</span>}
        </div>
        <label className="field"><span>The question</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} /></label>
        <label className="field"><span>What it should be (optional)</span><input className="input" value={suggest} onChange={(e) => setSuggest(e.target.value)} maxLength={300} placeholder="e.g. 1 stroke, not 2" /></label>
        <label className="field"><span>Why (optional)</span><textarea className="textarea" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} placeholder="Too much for one lucky shot" /></label>
        <span className="label">Evidence (optional)</span>
        <PhotoButtons onPick={setFile} picked={!!file} cameraLabel={file ? 'Retake' : 'Take a photo'} />
        {blocked && <div className="small" role="alert" style={{ color: 'var(--under)' }}>{KEEP_FRIENDLY}</div>}
        <div className="small muted">How it’s decided: {ruleLine('ruling', g.settings.ruling || {}, g.committees)}. Nothing changes until the verdict — then an organiser makes the change.</div>
        <button type="button" className="btn gold block" disabled={busy || !ok} onClick={submit}>{busy ? 'Raising…' : 'Raise the dispute'}</button>
      </div>
    </Sheet>
  );
}

function RaiseCaseForm({ g, onClose, kind: initialKind, rule: initialRule, onHandicap }) {
  const data = useData();
  const { status } = useSession();
  const nav = useNavigate();
  const kinds = useRaisableKinds(g);
  const [kind, setKind] = useState(initialKind || kinds.filter((k) => k !== 'handicap')[0] || kinds[0] || 'other');
  const [rules, setRules] = useState([]);
  const [posts, setPosts] = useState([]);
  const [v, setV] = useState({ title: '', body: '', penalty: '', subject: '', rule: initialRule?.id || '', answer: '', newTitle: initialRule?.title || '', newValue: initialRule?.value || '', newDetail: initialRule?.detail || '', category: 'other', post: '' });
  const [file, setFile] = useState(null);
  const [busy, run] = useRun();
  useEffect(() => {
    supabase.from('rules').select('*').eq('status', 'active').order('sort').then(({ data: r }) => setRules(r || []));
    supabase.from('posts').select('id,body,created_at,player_id,photo_url').order('created_at', { ascending: false }).limit(15).then(({ data: p }) => setPosts(p || []));
  }, []);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const rule = rules.find((r) => r.id === v.rule) || initialRule || null;
  const challenge = ['change_rule', 'scrap_rule', 'ruling'].includes(kind);
  const blockMsg = challenge && rule ? challengeBlock({ ruleId: rule.id, cases: g.cases, trips: data.trips, today: sydneyDate() }) : null;
  const pickRule = (id) => {
    const r = rules.find((x) => x.id === id);
    setV({ ...v, rule: id, newTitle: r?.title || '', newValue: r?.value || '', newDetail: r?.detail || '' });
  };
  const autoTitle = () => {
    if (kind === 'change_rule') return `Change: ${rule?.title || ''}`;
    if (kind === 'scrap_rule') return `Scrap: ${rule?.title || ''}`;
    return v.title;
  };
  const text = [v.title, v.body, v.penalty, v.answer, v.newTitle, v.newDetail].join(' ');
  const blocked = isBlocked(text);
  const ok = !blocked && !blockMsg && (
    kind === 'other' ? v.title.trim().length >= 3
      : kind === 'new_rule' ? v.title.trim().length >= 3
        : kind === 'ruling' ? !!rule && v.title.trim().length >= 3
          : kind === 'change_rule' ? !!rule && (v.newTitle.trim() !== (rule.title || '') || v.newValue.trim() !== (rule.value || '') || v.newDetail.trim() !== (rule.detail || ''))
            : kind === 'scrap_rule' ? !!rule : false);
  const submit = () => run(async () => {
    const url = file ? await uploadPhoto(file, 'tribunal') : null;
    const proposal = kind === 'change_rule' ? { title: v.newTitle.trim(), value: v.newValue.trim(), detail: v.newDetail.trim() }
      : kind === 'ruling' ? { answer: v.answer.trim() || null }
        : kind === 'new_rule' ? { detail: v.body.trim(), value: v.newValue.trim(), category: v.category, applies_to: ['all'] } : {};
    const id = await must(supabase.rpc('raise_case', {
      p_kind: kind, p_title: autoTitle().trim(), p_body: kind === 'new_rule' ? null : v.body.trim() || null,
      p_subject: kind === 'other' ? v.subject || null : null, p_rule: challenge ? rule?.id : null, p_proposal: proposal,
      p_penalty: kind === 'other' ? v.penalty.trim() || null : null, p_evidence_url: url, p_evidence_post: v.post || null,
    }));
    g.reload();
    onClose();
    nav(`/tribunal/case/${id}`);
  }, 'Case raised');
  const s = g.settings[kind] || {};
  return (
    <Sheet title={challenge && initialRule ? 'Challenge this rule' : 'Raise a case'} onClose={onClose}>
      <div className="stack">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} role="group" aria-label="Kind of case">
          {kinds.filter((k) => !initialRule || ['change_rule', 'scrap_rule', 'ruling'].includes(k)).map((k) => (
            <button key={k} type="button" className="chip" aria-pressed={kind === k} onClick={() => (k === 'handicap' ? (onClose(), onHandicap?.()) : setKind(k))}>
              {KIND_EMOJI[k]} {KIND[k].label}
            </button>
          ))}
        </div>
        <span className="small muted">e.g. “{KIND[kind]?.example}”. {KIND[kind]?.effect}.</span>
        {challenge && !initialRule && (
          <label className="field"><span>Which rule</span>
            <select className="select" value={v.rule} onChange={(e) => pickRule(e.target.value)}>
              <option value="">Choose…</option>
              {rules.map((r) => <option key={r.id} value={r.id}>{r.title}{r.value ? ` (${r.value})` : ''}</option>)}
            </select>
          </label>
        )}
        {challenge && rule && <div className="card pad small"><strong>{rule.title}</strong>{rule.value ? ` · ${rule.value}` : ''}{rule.detail ? <div className="muted">{rule.detail}</div> : null}</div>}
        {blockMsg && <div className="small" role="alert" style={{ color: 'var(--under)' }}>{blockMsg}</div>}

        {kind === 'other' && (
          <>
            <label className="field"><span>About who (optional)</span>
              <select className="select" value={v.subject} onChange={set('subject')}>
                <option value="">Nobody in particular</option>
                {[...data.players].sort((a, b) => playerName(a).localeCompare(playerName(b))).map((p) => <option key={p.id} value={p.id}>{playerName(p)}{p.id === status.player_id ? ' (yourself?!)' : ''}</option>)}
              </select>
            </label>
            <label className="field"><span>The charge</span><input className="input" value={v.title} onChange={set('title')} maxLength={140} placeholder="Crimes against fashion on day 2" /></label>
            <label className="field"><span>The case</span><textarea className="textarea" value={v.body} onChange={set('body')} maxLength={2000} placeholder="Pink shirt, orange shorts, no shame…" /></label>
            <label className="field"><span>Penalty if guilty (optional, in words)</span><input className="input" value={v.penalty} onChange={set('penalty')} maxLength={140} placeholder="Buys the first round" /></label>
          </>
        )}
        {kind === 'ruling' && (
          <>
            <label className="field"><span>The question</span><input className="input" value={v.title} onChange={set('title')} maxLength={140} placeholder="Does the mulligan cover the drive on 1?" /></label>
            <label className="field"><span>Your suggested ruling (optional)</span><input className="input" value={v.answer} onChange={set('answer')} maxLength={300} placeholder="Yes — one per round, 1st tee included" /></label>
            <label className="field"><span>Why it matters (optional)</span><textarea className="textarea" value={v.body} onChange={set('body')} maxLength={2000} /></label>
          </>
        )}
        {kind === 'change_rule' && rule && (
          <>
            <label className="field"><span>The rule should say</span><input className="input" value={v.newTitle} onChange={set('newTitle')} maxLength={140} /></label>
            <label className="field"><span>Worth / amount</span><input className="input" value={v.newValue} onChange={set('newValue')} maxLength={60} placeholder="e.g. $10" /></label>
            <label className="field"><span>Details</span><textarea className="textarea" value={v.newDetail} onChange={set('newDetail')} maxLength={1000} /></label>
            <label className="field"><span>Why (optional)</span><textarea className="textarea" value={v.body} onChange={set('body')} maxLength={2000} placeholder="Inflation, lads" /></label>
          </>
        )}
        {kind === 'scrap_rule' && rule && (
          <label className="field"><span>Why scrap it (optional)</span><textarea className="textarea" value={v.body} onChange={set('body')} maxLength={2000} /></label>
        )}
        {kind === 'new_rule' && (
          <>
            <label className="field"><span>Rule</span><input className="input" value={v.title} onChange={set('title')} maxLength={140} placeholder="Gimmes inside a putter length" /></label>
            <label className="field"><span>Worth / amount (optional)</span><input className="input" value={v.newValue} onChange={set('newValue')} maxLength={60} /></label>
            <label className="field"><span>Details</span><textarea className="textarea" value={v.body} onChange={set('body')} maxLength={1000} /></label>
          </>
        )}
        {['other', 'ruling', 'change_rule', 'scrap_rule'].includes(kind) && (
          <>
            <span className="label">Evidence (optional)</span>
            <PhotoButtons onPick={setFile} picked={!!file} cameraLabel={file ? 'Retake' : 'Take a photo'} />
            {posts.length > 0 && (
              <label className="field"><span>Or point to a feed post</span>
                <select className="select" value={v.post} onChange={set('post')}>
                  <option value="">None</option>
                  {posts.map((p) => <option key={p.id} value={p.id}>{(p.body || (p.photo_url ? 'A photo' : 'A post')).slice(0, 60)} · {timeAgo(p.created_at)}</option>)}
                </select>
              </label>
            )}
          </>
        )}
        {blocked && <div className="small" role="alert" style={{ color: 'var(--under)' }}>{KEEP_FRIENDLY}</div>}
        <div className="small muted">How it’s decided: {ruleLine(kind, s, g.committees)}.</div>
        <button type="button" className="btn gold block" disabled={busy || !ok} onClick={submit}>{busy ? 'Raising…' : kind === 'new_rule' ? 'Put it up for a vote' : 'Raise the case'}</button>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ the hearing
export function CaseHearing() {
  const { caseId } = useParams();
  const data = useData();
  const { status } = useSession();
  const g = useGovernance();
  const [rule, setRule] = useState(null);
  const [post, setPost] = useState(null);
  const c = g?.cases.find((x) => x.id === caseId);
  useEffect(() => {
    if (c?.rule_id) supabase.from('rules').select('*').eq('id', c.rule_id).then(({ data: r }) => setRule((r || [])[0] || null));
    if (c?.evidence_post_id) supabase.from('posts').select('id,body,photo_url,created_at').eq('id', c.evidence_post_id).then(({ data: p }) => setPost((p || [])[0] || null));
  }, [c?.rule_id, c?.evidence_post_id]);
  if (!g) return <Loading />;
  if (!g.ok) return <div className="page"><Header court back title="The Tribunal" /><div className="section empty">The new Tribunal isn’t set up on this database yet.</div></div>;
  if (!c) return <div className="page"><Header court back title="Case not found" /></div>;
  const st = caseState(g, c);
  const me = status.player_id;
  const subject = data.playersById[c.subject_id];
  const raiser = data.playersById[c.raised_by];
  const open = c.status === 'open';
  const words = voteWords(c.kind);
  const nextTrip = [...data.trips].filter((t) => t.start_date && t.start_date > sydneyDate()).sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
  const shareOn = g.group?.share_cards !== false;
  return (
    <div className="page">
      <header className="hdr court">
        <div className="hdr-row"><Link to="/tribunal" className="back" style={{ textDecoration: 'none' }}>{Icon.back()}<span>Tribunal</span></Link></div>
        <div className="row label" style={{ color: 'var(--gold)', gap: 6 }}>{Icon.gavel(16)}<span>{KIND[c.kind]?.label} · {open ? 'in session' : 'closed'}</span></div>
        <div className="hdr-row">
          {subject ? <Avatar player={subject} size={54} ring="var(--gold)" /> : <span aria-hidden style={{ fontSize: 40 }}>{KIND_EMOJI[c.kind]}</span>}
          <div className="hdr-grow">
            <div className="hdr-title">{c.kind === 'other' && subject ? `The Lads v ${playerName(subject)}` : c.title}</div>
            <div className="hdr-sub">Raised by {c.raised_via === 'assistant' ? `the assistant${raiser ? ` (for ${playerName(raiser)})` : ''}` : raiser ? playerName(raiser) : c.raised_via === 'rulebook' ? 'the Rulebook' : 'the Tribunal'} · {timeAgo(c.created_at)}</div>
          </div>
          <div data-testid="verdict-badge" style={{ background: '#fff', color: 'var(--text)', borderRadius: 10, padding: '6px 10px', textAlign: 'center', maxWidth: 110 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>{open ? 'VOTES' : 'VERDICT'}</div>
            <div className="num" style={{ fontSize: open ? 22 : 17, lineHeight: 1.1 }}>{open ? `${st.tally.for}–${st.tally.against}` : verdictWord(c)}</div>
          </div>
        </div>
      </header>

      <div className="section stack">
        <div className="card pad stack" style={{ gap: 6 }}>
          <span className="label">{c.kind === 'ruling' ? 'The question' : 'The case'}</span>
          {c.kind === 'other' && subject && <div style={{ fontWeight: 700, fontSize: 17 }}>{c.title}</div>}
          {c.kind === 'ruling' && <div style={{ fontWeight: 700, fontSize: 17 }}>{c.title}</div>}
          {c.body && <div style={{ fontSize: 16, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{c.body}</div>}
          <Proposal c={c} rule={rule} g={g} />
          <DisputedThing c={c} role={status.role} g={g} />
          {c.penalty && <div className="small"><strong>Penalty if guilty:</strong> {c.penalty} <span className="muted">(words only — no money moves)</span></div>}
          {c.evidence_url && <img src={c.evidence_url} alt="Evidence" style={{ width: '100%', borderRadius: 10, marginTop: 6 }} />}
          {post && <Link to="/feed" className="card pad small" style={{ color: 'inherit' }}>📎 From the feed: {(post.body || 'a photo').slice(0, 120)}{post.photo_url ? <img src={post.photo_url} alt="" style={{ width: '100%', borderRadius: 8, marginTop: 6 }} /> : null}</Link>}
          {rule && <Link to={`/rules/${rule.id}`} className="small">Open the rule →</Link>}
        </div>

        <Hearing c={c} g={g} />

        <div className="card pad stack" data-testid="vote-card">
          <div className="small muted">{ruleLine(c.kind, c.settings || {}, g.committees)}{open && c.stage === 'voting' && c.closes_at ? ` · ${closesIn(c.closes_at)}` : ''}</div>
          <div className="row between" style={{ fontWeight: 700 }}>
            <span>{words.for} {st.tally.for}</span>
            <span className="muted">{words.against} {st.tally.against} · {words.abstain} {st.tally.abstain}</span>
          </div>
          <div className="vote-bar"><span className="g" style={{ width: `${(st.tally.for / Math.max(1, st.tally.cast)) * 100}%` }} /><span className="n" style={{ width: `${(st.tally.against / Math.max(1, st.tally.cast)) * 100}%` }} /></div>
          {st.votes.map((vt) => (
            <div key={vt.player_id} className="row small">
              <Avatar player={data.playersById[vt.player_id]} size={24} />
              <strong>{playerName(data.playersById[vt.player_id])}</strong>
              <span className="muted">{words[vt.vote]}{vt.comment ? ` — “${vt.comment}”` : ''}{st.voters.includes(vt.player_id) ? '' : ' (doesn’t count)'}</span>
            </div>
          ))}
          {open && <VoteButtons c={c} g={g} st={st} />}
          {open && st.mode === 'organiser' && <div className="small muted">{st.state === 'casting' ? 'A tie: an organiser has the casting vote.' : st.state === 'fallback' ? 'Over to the organisers.' : 'An organiser decides — the votes are a show of hands.'}</div>}
          {open && <DecidePanel c={c} g={g} st={st} />}
          {!open && <Verdict c={c} g={g} subject={subject} nextTrip={nextTrip} shareOn={shareOn} />}
        </div>
        <CaseActions c={c} g={g} />
      </div>
    </div>
  );
}

// A dispute (082): what was disputed, its value when raised, and where it was seen. A verdict never changes a setting
// by itself: an organiser changes it where it's set (or writes the verdict into the Rulebook, organiser-checked).
function DisputedThing({ c, role, g }) {
  const data = useData();
  const s = subjectLine(c);
  if (!s) return null;
  return (
    <div className="card pad small stack" style={{ gap: 4 }} data-testid="disputed-thing">
      <span className="muted">⚖️ Disputed · {s.source}</span>
      <strong>{s.label}</strong>
      <span>Value when raised: <strong>{s.value}</strong></span>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        {s.path && <Link to={s.path}>Where it was seen →</Link>}
        {s.ruleId && !c.rule_id && <Link to={`/rules/${s.ruleId}`}>The rule →</Link>}
      </div>
      {c.setting_applied_at && <strong data-testid="verdict-applied">✓ {appliedLine(c, playerName(data.playersById[c.setting_applied_by]))}</strong>}
      {canApplyVerdict(c, role) && <ApplyVerdict c={c} g={g} label={s.label} />}
      {c.status === 'passed' && role === 'organiser' && c.subject_kind === 'setting' && !c.setting_applied_at && !applySpec(c.subject_ref) && (
        <span className="muted">This one is changed where it’s set — the verdict doesn’t change it by itself.</span>
      )}
    </div>
  );
}

// 084: an organiser applies an upheld dispute to the setting ("change Worth 2 strokes from 2 to 1"). The database checks
// the value, refuses a second go, and says if the setting has changed since the case was raised.
function ApplyVerdict({ c, g, label }) {
  const data = useData();
  const [text, setText] = useState(() => suggestedValue(c));
  const [changed, setChanged] = useState(null); // { now } when it changed since the case was raised
  const [busy, run] = useRun();
  const p = parseApplyValue(c.subject_ref, text);
  const from = valueWords(changed ? changed.now : c.subject_ref?.value);
  const go = (force) => run(async () => {
    const r = await must(supabase.rpc('apply_dispute_verdict', { p_case: c.id, p_value: p.value, p_force: !!force }));
    if (r?.status === 'changed') { setChanged({ now: r.now }); return; }
    g.reload();
    data.reload?.(); // the setting itself (rounds etc.) — realtime does it too
    refreshDisputes();
    toast('Verdict applied');
  });
  return (
    <div className="court-card card pad stack" style={{ gap: 6, marginTop: 6 }} data-testid="apply-verdict">
      <label className="field"><span>Change it to</span>
        <input className="input" value={text} onChange={(e) => { setText(e.target.value); }} data-testid="apply-value" />
      </label>
      {text.trim() !== '' && !p.ok && <span className="small" role="alert" style={{ color: 'var(--under)' }}>{p.error}</span>}
      {changed && <span className="small" role="alert" data-testid="apply-changed" style={{ fontWeight: 700 }}>It’s changed since — now {valueWords(changed.now)}. Apply anyway?</span>}
      <button type="button" className="btn gold block" disabled={busy || !p.ok} data-testid="apply-go" onClick={() => go(!!changed)}>
        {changed ? `Apply anyway: ${valueWords(changed.now)} → ${valueWords(p.value)}` : `Apply the verdict: change ${label} from ${from} to ${p.ok ? valueWords(p.value) : '…'}`}
      </button>
      <span className="small muted">Organisers only. It changes the setting for everyone and posts to the feed.</span>
    </div>
  );
}

function Proposal({ c, rule, g }) {
  const data = useData();
  const p = c.proposal || {};
  if (c.kind === 'change_rule') {
    return (
      <div className="stack" style={{ gap: 4 }}>
        {rule && <div className="small"><span className="muted">Now:</span> {rule.status === 'active' || c.status === 'open' ? `${rule.title}${rule.value ? ` (${rule.value})` : ''}` : ''}</div>}
        <div><span className="muted small">Proposed:</span> <strong>{p.title}</strong>{p.value ? ` (${p.value})` : ''}</div>
        {p.detail && <div className="small">{p.detail}</div>}
      </div>
    );
  }
  if (c.kind === 'scrap_rule' && rule) return <div><span className="muted small">Scrap:</span> <strong>{rule.title}</strong>{rule.value ? ` (${rule.value})` : ''}</div>;
  if (c.kind === 'ruling' && p.answer) return <div><span className="muted small">Suggested ruling:</span> {p.answer}</div>;
  if (c.kind === 'new_rule') return <div><strong>{p.title}</strong>{p.value ? ` (${p.value})` : ''}{p.detail ? <div className="small">{p.detail}</div> : null}</div>;
  if (c.kind === 'election') {
    const com = g.committees.find((x) => x.id === p.committee_id);
    return <div>Put <strong>{playerName(data.playersById[p.candidate])}</strong> in seat {p.seat_no} of the <strong>{com?.name || 'committee'}</strong>{com ? ` (term: ${termLabel(com)})` : ''}.</div>;
  }
  if (c.kind === 'governance') {
    if (p.preset) return <div>Switch to <strong>{PRESETS[p.preset]?.label}</strong>: {PRESETS[p.preset]?.blurb}</div>;
    const k = p.target_kind;
    const next = { ...(g.settings[k] || {}), ...(p.settings || {}) };
    return <div><strong>{KIND[k]?.label}</strong> cases: {ruleLine(k, next, g.committees)}.</div>;
  }
  return null;
}

function VoteButtons({ c, g, st }) {
  const { status } = useSession();
  const me = status.player_id;
  const [pick, setPick] = useState(null);
  const [comment, setComment] = useState('');
  const [busy, run] = useRun();
  const words = voteWords(c.kind);
  const mine = st.votes.find((v) => v.player_id === me);
  if (status.role === 'guest') return <div className="small muted">Guests don’t vote in the Tribunal.</div>;
  if (me && me === c.subject_id && !st.voters.includes(me)) return <div className="small muted">You can’t vote on a case about yourself — have your say in the hearing.</div>;
  if (!['voting', 'organiser'].includes(c.stage)) return null;
  if (!canVote({ playerId: me, role: status.role, voters: st.voters })) {
    return <div className="small muted">{c.settings?.decides === 'committee' ? 'The committee votes on this one.' : c.settings?.decides?.startsWith('organisers') ? 'The organisers vote on this one.' : 'You don’t have a vote on this one.'}</div>;
  }
  return (
    <>
      {mine && <div className="small"><strong>Your vote: {words[mine.vote]}.</strong> <span className="muted">Pick another and confirm to change it.</span></div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {['for', 'against', 'abstain'].map((k) => {
          const on = (pick || mine?.vote) === k;
          return (
            <button key={k} type="button" className="btn ghost" aria-pressed={on}
              style={on ? { background: 'var(--court)', color: '#fff', borderColor: 'var(--court)' } : { borderColor: 'var(--court)' }}
              onClick={() => setPick(k === mine?.vote ? null : k)}>{on ? '✓ ' : ''}{words[k]}</button>
          );
        })}
      </div>
      {pick && pick !== mine?.vote && (
        <>
          <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={200} placeholder="One-liner for the court (optional)" />
          <button type="button" className="btn gold block" disabled={busy || isBlocked(comment)} onClick={() => run(async () => {
            const r = await must(supabase.rpc('vote_case', { p_case: c.id, p_vote: pick, p_comment: comment.trim() || null }));
            setPick(null); setComment('');
            g.reload();
            if (String(r).startsWith('closed')) toast('Voting had closed — here’s the verdict');
            else if (r === 'passed' || r === 'failed') toast('That settles it — verdict in');
            else toast('Vote recorded');
          })}>Cast my vote: {words[pick]}</button>
        </>
      )}
    </>
  );
}

function DecidePanel({ c, g, st }) {
  const { status } = useSession();
  const [verdict, setVerdict] = useState(c.proposal?.answer || '');
  const [busy, run] = useRun();
  if (!canDecide({ role: status.role, playerId: status.player_id, subjectId: c.subject_id, state: st.state })) {
    if (status.role === 'organiser' && status.player_id === c.subject_id && ['organiser', 'casting', 'fallback'].includes(st.state)) {
      return <div className="small muted">It’s about you, so another organiser decides.</div>;
    }
    return null;
  }
  const words = voteWords(c.kind);
  const go = (outcome) => run(async () => {
    await must(supabase.rpc('decide_case', { p_case: c.id, p_outcome: outcome, p_verdict: verdict.trim() || null }));
    g.reload();
  }, 'Verdict in');
  const needsText = c.kind === 'ruling';
  return (
    <div className="court-card card pad stack" data-testid="decide-panel">
      <strong>{st.state === 'casting' ? 'Your casting vote' : 'Your decision'}</strong>
      <label className="field"><span>{needsText ? 'The ruling' : 'A word from the chair (optional)'}</span>
        <textarea className="textarea" value={verdict} onChange={(e) => setVerdict(e.target.value)} maxLength={600} placeholder={needsText ? 'Yes — one mulligan, 1st tee only' : 'The court has seen enough'} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <button type="button" className="btn gold" disabled={busy || (needsText && !verdict.trim()) || isBlocked(verdict)} onClick={() => go('passed')}>{c.kind === 'other' ? words.for : c.kind === 'ruling' ? 'Make the ruling' : 'Pass it'}</button>
        <button type="button" className="btn ghost" disabled={busy || isBlocked(verdict)} onClick={() => go('failed')}>{c.kind === 'other' ? words.against : 'Turn it down'}</button>
      </div>
    </div>
  );
}

function Verdict({ c, g, subject, nextTrip, shareOn }) {
  const { status } = useSession();
  const [busy, run] = useRun();
  const waiting = c.apply_state === 'waiting_next_trip' ? 'next_trip' : c.apply_state;
  return (
    <div className="stack" data-testid="verdict">
      <div className="court-card card pad stack" style={{ gap: 4 }}>
        <div style={{ fontWeight: 800, fontSize: 20 }}>{verdictWord(c)}</div>
        <div className="small">{c.kind === 'other' ? verdictLine(c, subject ? playerName(subject) : '') : c.reason}</div>
        {c.verdict && <div><strong>{c.kind === 'ruling' ? 'Ruling:' : 'The chair:'}</strong> {c.verdict}</div>}
        {applyWords(c, nextTrip?.name || 'the next trip') && <div className="small" data-testid="apply-state"><strong>{applyWords(c, nextTrip?.name || 'the next trip')}</strong>{c.approved_at ? ` · approved ${timeAgo(c.approved_at)}` : ''}</div>}
        {c.status === 'withdrawn' && <div className="small muted">Withdrawn.</div>}
        <div className="small muted">Closed {timeAgo(c.decided_at)}.</div>
      </div>
      {canApproveMidTrip({ role: status.role, waiting, settings: c.settings || {} }) && (
        <button type="button" className="btn ghost block" disabled={busy} onClick={() => window.confirm('Let this change start mid-trip? It starts from the next round — never during a round in play.') && run(async () => {
          const r = await must(supabase.rpc('approve_mid_trip', { p_case: c.id }));
          g.reload();
          toast(r === 'applied' ? 'In force now' : 'Starts from the next round');
        })}>Approve: start it mid-trip (from the next round)</button>
      )}
      <VerdictToRulebook c={c} />
      {shareOn && c.status !== 'withdrawn' && (
        <SharePicture label="🖼️ Share the verdict" kind="case"
          data={{ case: c, subject: subject ? playerName(subject) : '', tally: c.votes_for != null ? `${c.votes_for}–${c.votes_against}` : '' }}
          text={`⚖️ ${verdictLine(c, subject ? playerName(subject) : '')}`} />
      )}
    </div>
  );
}

function Hearing({ c, g }) {
  const data = useData();
  const { status } = useSession();
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [busy, run] = useRun();
  const posts = g.posts.filter((p) => p.case_id === c.id && p.kind !== 'report');
  const me = status.player_id;
  const isSubject = me && me === c.subject_id;
  const open = c.status === 'open';
  return (
    <div className="card pad stack" data-testid="hearing">
      <span className="label">The hearing</span>
      {!posts.length && <div className="small muted">{c.subject_id ? 'The accused has not yet spoken.' : 'Nobody has spoken yet.'}</div>}
      {posts.map((p) => (
        <div key={p.id} className={p.kind === 'reply' ? 'court-card card pad' : ''} style={{ padding: p.kind === 'reply' ? 10 : 0 }}>
          <div className="row small" style={{ gap: 6 }}>
            <Avatar player={data.playersById[p.player_id]} size={22} />
            <strong>{playerName(data.playersById[p.player_id])}</strong>
            {p.kind === 'reply' && <span className="muted">· the accused</span>}
            <span className="muted">· {timeAgo(p.created_at)}</span>
          </div>
          {p.body && <div style={{ fontSize: 15, lineHeight: 1.4, fontStyle: p.kind === 'reply' ? 'italic' : 'normal' }}>{p.body}</div>}
          {p.photo_url && <img src={p.photo_url} alt="Evidence" style={{ width: '100%', borderRadius: 8, marginTop: 4 }} />}
        </div>
      ))}
      {open && status.role !== 'guest' && me && (
        <>
          <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000}
            aria-label={isSubject ? 'Your reply' : 'Say something'} placeholder={isSubject ? 'Your honour, I was carrying an injury…' : 'Your say (or add a photo as evidence)'} />
          {isBlocked(text) && <div className="small" role="alert" style={{ color: 'var(--under)' }}>{KEEP_FRIENDLY}</div>}
          <PhotoButtons onPick={setFile} picked={!!file} cameraLabel={file ? 'Retake' : 'Photo evidence'} />
          <button type="button" className="btn sm" disabled={busy || isBlocked(text) || (!text.trim() && !file)} onClick={() => run(async () => {
            const url = file ? await uploadPhoto(file, 'tribunal') : null;
            await must(supabase.rpc('add_case_post', { p_case: c.id, p_body: text.trim() || null, p_photo_url: url, p_post: null }));
            setText(''); setFile(null); g.reload();
          })}>{isSubject ? 'Reply to the court' : 'Add to the hearing'}</button>
        </>
      )}
      {open && status.role === 'guest' && <div className="small muted">Guests can watch the hearing but not speak.</div>}
    </div>
  );
}

function CaseActions({ c, g }) {
  const { status } = useSession();
  const [busy, run] = useRun();
  const me = status.player_id;
  const organiser = status.role === 'organiser';
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      {c.status === 'open' && (organiser || (me && me === c.raised_by)) && (
        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => window.confirm('Withdraw this case?') && run(async () => { await must(supabase.rpc('withdraw_case', { p_case: c.id })); g.reload(); }, 'Withdrawn')}>Withdraw</button>
      )}
      {organiser && (
        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(async () => { await must(supabase.rpc('hide_case', { p_case: c.id, p_hidden: !c.hidden })); g.reload(); }, c.hidden ? 'Shown again' : 'Hidden')}>{c.hidden ? 'Show this case' : 'Hide this case'}</button>
      )}
      {status.role !== 'guest' && (
        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => {
          const why = window.prompt('What’s wrong with it? (optional) — organisers will see this');
          if (why === null) return;
          run(async () => { await must(supabase.rpc('report_case', { p_case: c.id, p_reason: why })); }, 'Reported to the organisers');
        }}>🚩 Report</button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Governance (More → Group & invites → Governance)
export function GovernanceLink() {
  const { status } = useSession();
  if (!useFeature('tribunal') || !status?.is_member) return null;
  return (
    <Link to="/governance" className="card pad row" style={{ gap: 10, textDecoration: 'none', color: 'inherit' }}>
      <span style={{ fontSize: 22 }} aria-hidden>🏛️</span>
      <span className="grow"><strong>Governance</strong><div className="small muted">Who decides what in the Tribunal</div></span>
      <span className="muted">{Icon.next()}</span>
    </Link>
  );
}

export function Governance() {
  const { status } = useSession();
  const data = useData();
  const g = useGovernance();
  const on = useKindOn();
  const tribunalOn = useFeature('tribunal');
  const committeesOn = useFeature('committees');
  const [busy, run] = useRun();
  const nav = useNavigate();
  const [editing, setEditing] = useState(null);
  if (!g) return <Loading />;
  if (!g.ok) return <div className="page"><Header back title="Governance" /><div className="section empty">Governance isn’t set up on this database yet.</div></div>;
  const organiser = status.role === 'organiser';
  const direct = organiser && (g.settings.governance.decides === 'organiser' || !tribunalOn);
  const preset = g.group?.preset || null;
  const canPropose = status.role !== 'guest' && tribunalOn && canRaise({ role: status.role, settings: g.settings.governance });
  const propose = (proposal, title) => run(async () => {
    const id = await must(supabase.rpc('raise_case', { p_kind: 'governance', p_title: title, p_proposal: proposal }));
    g.reload();
    nav(`/tribunal/case/${id}`);
  }, 'Up for a vote');
  return (
    <div className="page">
      <Header back title="Governance" sub="Who decides what in the Tribunal" />
      <div className="section stack">
        <div className="card pad small">
          {direct
            ? 'Organisers can change these straight away.'
            : `Changes here are a case: ${ruleLine('governance', g.settings.governance, g.committees)}.`}
          {' '}The database enforces them, not just the app.
        </div>

        <span className="label">Start from</span>
        <div className="stack" data-testid="presets">
          {Object.entries(PRESETS).map(([k, p]) => (
            <div key={k} className="card pad stack" style={{ gap: 6, borderColor: preset === k ? 'var(--gold)' : undefined }}>
              <div className="row between"><strong>{p.label}</strong>{(preset === k || (!preset && k === 'lgc' && !g.settingsRows.length)) && <span className="small" style={{ fontWeight: 800 }}>✓ In use</span>}</div>
              <span className="small">{p.blurb}</span>
              {direct && preset !== k && (
                <button type="button" className="btn ghost sm" disabled={busy} onClick={() => window.confirm(`Switch to “${p.label}”?${k === 'club' ? ' It sets up a Handicap Committee and a Rules Committee (seats start empty — the organisers decide until they’re filled).' : ''}`) && run(async () => {
                  await must(supabase.rpc('apply_governance_preset', { p_preset: k })); g.reload();
                }, `${p.label} it is`)}>Use this</button>
              )}
              {!direct && canPropose && preset !== k && (
                <button type="button" className="btn ghost sm" disabled={busy} onClick={() => propose({ preset: k }, `Switch to ${p.label}`)}>Propose this</button>
              )}
            </div>
          ))}
        </div>

        <span className="label">Each kind of case</span>
        {['trip_decision', ...SETTINGS_KINDS].filter((k) => k === 'trip_decision' || k === 'handicap' || on(k)).map((k) => (
          <div key={k} className="card pad stack" style={{ gap: 4 }} data-testid={`row-${k}`}>
            <div className="row between"><strong>{KIND_EMOJI[k] || '🗓️'} {KIND[k].label}</strong>
              {((direct || (k === 'trip_decision' && organiser)) || (canPropose && k !== 'trip_decision')) && (
                <button type="button" className="btn ghost sm" onClick={() => setEditing(k)}>{direct || k === 'trip_decision' ? 'Change' : 'Propose a change'}</button>
              )}
            </div>
            <span className="small">{ruleLine(k, g.settings[k], g.committees)}</span>
            {k !== 'trip_decision' && <span className="small muted">Raised by {g.settings[k].raise_by === 'organisers' ? 'organisers only' : 'any player'}{k !== 'handicap' ? ` · the person it’s about ${g.settings[k].subject_votes ? 'can' : 'can’t'} vote` : ''}</span>}
          </div>
        ))}

        {committeesOn && <Committees g={g} direct={direct} />}
        {!committeesOn && organiser && <div className="small muted">Committees and terms are switched off (Players & group → Features), or pick Club style above.</div>}

        {organiser && (
          <label className="row card pad" style={{ gap: 10 }}>
            <input type="checkbox" checked={g.group?.share_cards !== false} onChange={(e) => run(async () => { await must(supabase.rpc('set_tribunal_share_cards', { p_on: e.target.checked })); g.reload(); })} />
            <span className="grow"><strong>Verdict share cards</strong><div className="small muted">A picture of the verdict for the group chat (never the discussion)</div></span>
          </label>
        )}
        <div className="small muted">There’s always at least one organiser. Penalties are words only. Nobody decides a case about themselves.</div>
      </div>
      {editing && <SettingSheet kind={editing} g={g} direct={direct || editing === 'trip_decision'} onClose={() => setEditing(null)} onPropose={propose} />}
    </div>
  );
}

function SettingSheet({ kind, g, direct, onClose, onPropose }) {
  const [s, setS] = useState(() => ({ ...g.settings[kind] }));
  const [busy, run] = useRun();
  const problems = settingsProblems(kind, s, { committees: g.committees });
  const set = (k, v) => setS({ ...s, [k]: v });
  const changed = Object.fromEntries(Object.entries(s).filter(([k, v]) => v !== g.settings[kind][k]));
  const save = () => {
    if (direct) {
      return run(async () => { await must(supabase.rpc('set_governance', { p_kind: kind, p_settings: s })); g.reload(); onClose(); }, 'Saved');
    }
    onClose();
    return onPropose({ target_kind: kind, settings: changed }, `${KIND[kind].label}: ${ruleLine(kind, s, g.committees).split(' · ')[0].toLowerCase()}`);
  };
  return (
    <Sheet title={`${KIND[kind].label} cases`} onClose={onClose}>
      <div className="stack">
        <label className="field"><span>Who decides</span>
          <select className="select" value={s.decides} onChange={(e) => set('decides', e.target.value)}>
            {decidesFor(kind).map((d) => <option key={d} value={d}>{DECIDES[d]}</option>)}
          </select>
        </label>
        {s.decides === 'committee' && (
          <label className="field"><span>Which committee</span>
            <select className="select" value={s.committee_id || ''} onChange={(e) => set('committee_id', e.target.value || null)}>
              <option value="">Choose…</option>
              {g.committees.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.seats} seats)</option>)}
            </select>
          </label>
        )}
        {kind !== 'trip_decision' && (
          <>
            <label className="field"><span>Who can raise it</span>
              <select className="select" value={s.raise_by} onChange={(e) => set('raise_by', e.target.value)}>
                <option value="players">Any player</option><option value="organisers">Organisers only</option>
              </select>
            </label>
            {kind !== 'handicap' && s.decides !== 'organiser' && (
              <>
                <label className="field"><span>Voting closes after</span>
                  <select className="select" value={s.close_hours} onChange={(e) => set('close_hours', Number(e.target.value))}>
                    {[6, 12, 24, 48, 72, 168].map((h) => <option key={h} value={h}>{h < 24 ? `${h} hours` : `${h / 24} day${h === 24 ? '' : 's'}`}</option>)}
                  </select>
                </label>
                <label className="field"><span>Minimum turnout</span>
                  <select className="select" value={String(s.min_turnout)} onChange={(e) => set('min_turnout', Number(e.target.value))}>
                    {[[0, 'None'], [0.25, 'A quarter'], [0.5, 'Half'], [0.75, 'Three-quarters'], [1, 'Everyone']].map(([v, l]) => <option key={v} value={String(v)}>{l}</option>)}
                  </select>
                </label>
                <label className="field"><span>A tie</span>
                  <select className="select" value={s.tie_break} onChange={(e) => set('tie_break', e.target.value)}>
                    <option value="status_quo">Stays as it is</option><option value="organiser">An organiser’s casting vote</option>
                  </select>
                </label>
              </>
            )}
            {kind !== 'handicap' && (
              <label className="row" style={{ gap: 10 }}>
                <input type="checkbox" checked={!!s.subject_votes} onChange={(e) => set('subject_votes', e.target.checked)} />
                <span>The person it’s about can vote</span>
              </label>
            )}
            {['new_rule', 'change_rule', 'scrap_rule', 'governance'].includes(kind) && (
              <label className="field"><span>Takes effect</span>
                <select className="select" value={s.takes_effect} onChange={(e) => set('takes_effect', e.target.value)}>
                  {Object.entries(EFFECT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
            )}
          </>
        )}
        {problems.map((p) => <div key={p} className="small" role="alert" style={{ color: 'var(--under)' }}>{p}</div>)}
        <div className="small muted">{ruleLine(kind, s, g.committees)}</div>
        <button type="button" className="btn gold block" disabled={busy || problems.length > 0 || !Object.keys(changed).length} onClick={save}>{direct ? 'Save' : 'Put it to the Tribunal'}</button>
      </div>
    </Sheet>
  );
}

function Committees({ g, direct }) {
  const data = useData();
  const { status } = useSession();
  const nav = useNavigate();
  const [edit, setEdit] = useState(null);
  const [busy, run] = useRun();
  const players = [...data.players].sort((a, b) => playerName(a).localeCompare(playerName(b)));
  const canStand = status.role !== 'guest' && canRaise({ role: status.role, settings: g.settings.election });
  const nominate = (com, seatNo) => {
    const name = window.prompt(`Who should take seat ${seatNo} of the ${com.name}? Type their name.`);
    if (!name) return;
    const p = players.find((x) => playerName(x).toLowerCase() === name.trim().toLowerCase() || x.name.toLowerCase() === name.trim().toLowerCase());
    if (!p) { toast('No player by that name'); return; }
    run(async () => {
      const id = await must(supabase.rpc('raise_case', { p_kind: 'election', p_title: `${playerName(p)} for the ${com.name}`, p_proposal: { committee_id: com.id, seat_no: seatNo, candidate: p.id } }));
      g.reload(); nav(`/tribunal/case/${id}`);
    }, 'Election open');
  };
  return (
    <div className="stack" data-testid="committees">
      <div className="row between"><span className="label">Committees</span>{direct && <button type="button" className="btn ghost sm" onClick={() => setEdit({})}>+ Add a committee</button>}</div>
      {!g.committees.length && <div className="small muted">No committees yet.</div>}
      {g.committees.map((com) => (
        <div key={com.id} className="card pad stack" style={{ gap: 6 }}>
          <div className="row between"><strong>{com.name}</strong>{direct && <button type="button" className="btn ghost sm" onClick={() => setEdit(com)}>Edit</button>}</div>
          <span className="small muted">Hears: {com.kinds.map((k) => KIND[k]?.label).join(', ') || 'nothing yet'} · {com.seats} seat{com.seats === 1 ? '' : 's'} · {com.fill === 'election' ? 'elected' : 'appointed'} · term {termLabel(com)}</span>
          {Array.from({ length: com.seats }, (_, i) => i + 1).map((n) => {
            const seat = g.seats.find((s) => s.committee_id === com.id && s.seat_no === n);
            const holder = data.playersById[seat?.player_id];
            const term = seat?.player_id ? termStatus({ started_at: seat.started_at, term_trips: com.term_trips, term_years: com.term_years }, { trips: data.trips }) : null;
            return (
              <div key={n} className="row small" style={{ gap: 8 }}>
                <span className="muted" style={{ width: 52 }}>Seat {n}</span>
                {holder ? <><Avatar player={holder} size={22} /><strong className="grow">{playerName(holder)}</strong></> : <span className="grow muted">Empty — the organisers decide until it’s filled</span>}
                {term?.ended && <span style={{ color: 'var(--under)' }}>term up</span>}
                {term?.soon && <span className="muted">term nearly up</span>}
                {com.fill === 'election' && canStand && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => nominate(com, n)}>Nominate</button>}
                {com.fill === 'appointment' && status.role === 'organiser' && (
                  <select className="select" style={{ maxWidth: 130 }} aria-label={`Appoint seat ${n}`} value={seat?.player_id || ''} onChange={(e) => run(async () => {
                    await must(supabase.rpc('appoint_seat', { p_committee: com.id, p_seat_no: n, p_player: e.target.value || null })); g.reload();
                  }, 'Appointed')}>
                    <option value="">Empty</option>
                    {players.map((p) => <option key={p.id} value={p.id}>{playerName(p)}</option>)}
                  </select>
                )}
              </div>
            );
          })}
        </div>
      ))}
      {edit && <CommitteeSheet com={edit} g={g} onClose={() => setEdit(null)} />}
    </div>
  );
}

function CommitteeSheet({ com, g, onClose }) {
  const [v, setV] = useState({ name: com.name || '', kinds: com.kinds || ['handicap'], seats: com.seats || 3, fill: com.fill || 'election', term_trips: com.term_trips ?? 2, term_years: com.term_years ?? 1 });
  const [busy, run] = useRun();
  const toggle = (k) => setV({ ...v, kinds: v.kinds.includes(k) ? v.kinds.filter((x) => x !== k) : [...v.kinds, k] });
  const ok = v.name.trim().length >= 2 && Number(v.seats) >= 1;
  return (
    <Sheet title={com.id ? 'Edit committee' : 'New committee'} onClose={onClose}>
      <div className="stack">
        <label className="field"><span>Name</span><input className="input" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} maxLength={40} placeholder="Handicap Committee" /></label>
        <span className="label">Hears</span>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {['handicap', 'new_rule', 'change_rule', 'scrap_rule', 'ruling', 'other'].map((k) => <button key={k} type="button" className="chip" aria-pressed={v.kinds.includes(k)} onClick={() => toggle(k)}>{KIND[k].label}</button>)}
        </div>
        <label className="field"><span>Seats</span><input className="input" type="number" min={1} max={15} value={v.seats} onChange={(e) => setV({ ...v, seats: Number(e.target.value) })} /></label>
        {Number(v.seats) < 1 && <div className="small" role="alert" style={{ color: 'var(--under)' }}>A committee needs at least one seat.</div>}
        <label className="field"><span>Seats are filled by</span>
          <select className="select" value={v.fill} onChange={(e) => setV({ ...v, fill: e.target.value })}><option value="election">Election (a case)</option><option value="appointment">Appointment (an organiser)</option></select>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label className="field"><span>Term: trips</span><input className="input" type="number" min={0} max={20} value={v.term_trips ?? ''} onChange={(e) => setV({ ...v, term_trips: e.target.value === '' ? null : Number(e.target.value) })} placeholder="none" /></label>
          <label className="field"><span>or years</span><input className="input" type="number" min={0} max={10} step={0.5} value={v.term_years ?? ''} onChange={(e) => setV({ ...v, term_years: e.target.value === '' ? null : Number(e.target.value) })} placeholder="none" /></label>
        </div>
        <span className="small muted">Term: {termLabel({ term_trips: v.term_trips || null, term_years: v.term_years || null })}. The holder keeps the seat until someone replaces them.</span>
        <button type="button" className="btn gold block" disabled={busy || !ok} onClick={() => run(async () => {
          await must(supabase.rpc('save_committee', { p_id: com.id || null, p_name: v.name.trim(), p_kinds: v.kinds, p_seats: Number(v.seats), p_fill: v.fill, p_term_trips: v.term_trips || null, p_term_years: v.term_years || null }));
          g.reload(); onClose();
        }, 'Saved')}>Save</button>
      </div>
    </Sheet>
  );
}
