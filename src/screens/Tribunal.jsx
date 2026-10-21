import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useData, useRealtime, useSession, playerName } from '../lib/store.jsx';
import { uploadPhoto } from '../lib/images.js';
import { usePlayerHistory } from './Profile.jsx';
import { Header, Avatar, Icon, Sheet, PhotoButtons, timeAgo, toast, Loading } from '../components/ui.jsx';
import SharePicture from '../components/SharePicture.jsx';
import { useGovernance, useRaisableKinds, CaseRowNew, RaiseCase } from './Cases.jsx';

function fmtChange(n) {
  const v = Number(n);
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v);
}

function useCases() {
  const [cases, setCases] = useState(null);
  const [votes, setVotes] = useState([]);
  const load = useCallback(async () => {
    const [c, v] = await Promise.all([
      supabase.from('tribunal_cases').select('*').order('created_at', { ascending: false }),
      supabase.from('tribunal_votes').select('*'),
    ]);
    setCases(c.data || []);
    setVotes(v.data || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtime(['tribunal_cases', 'tribunal_votes'], load);
  return { cases, votes, reload: load };
}

// The Tribunal (Stage 11b): handicap cases (today's tables) and every other kind of case, in one list.
export default function Tribunal() {
  const data = useData();
  const { status } = useSession();
  const { cases, votes, reload } = useCases();
  const g = useGovernance();
  const kinds = useRaisableKinds(g?.ok ? g : null);
  const [lodging, setLodging] = useState(false);
  const [raising, setRaising] = useState(false);
  if (!cases) return <Loading />;
  // Newer kinds of case (an older database without them: just the Handicap Tribunal, as before).
  const others = g?.ok ? g.cases : [];
  const all = [
    ...cases.map((c) => ({ at: c.created_at, open: c.status === 'open', el: <CaseRow key={c.id} c={c} votes={votes.filter((v) => v.case_id === c.id)} /> })),
    ...others.map((c) => ({ at: c.created_at, open: c.status === 'open', el: <CaseRowNew key={c.id} c={c} g={g} /> })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const open = all.filter((x) => x.open);
  const closed = all.filter((x) => !x.open);
  const handicapOn = !g?.ok || kinds.includes('handicap') || status?.role === 'organiser';
  const raise = () => (kinds.filter((k) => k !== 'handicap').length ? setRaising(true) : setLodging(true));
  return (
    <div className="page">
      <Header court back title="The Tribunal" sub="Raise a case — serious or silly. The group decides." />
      <div className="section stack">
        {status?.role !== 'guest' && (kinds.length > 0 || !g?.ok) && <button type="button" className="btn gold block" onClick={raise}>{Icon.gavel(20)}<span>Raise a case</span></button>}
        {open.length > 0 && <span className="label">Open cases</span>}
        {open.map((x) => x.el)}
        {closed.length > 0 && <span className="label">Past verdicts</span>}
        {closed.map((x) => x.el)}
        {!all.length && <div className="empty">Court is in session, but nobody's been accused yet.</div>}
        {g?.ok && <Link to="/governance" className="small muted" style={{ textAlign: 'center' }}>Who decides what →</Link>}
      </div>
      {lodging && handicapOn && <LodgeCase onClose={() => setLodging(false)} onDone={reload} players={data.players} />}
      {raising && <RaiseCase g={g} onClose={() => setRaising(false)} onHandicap={() => setLodging(true)} />}
    </div>
  );
}

function CaseRow({ c, votes }) {
  const data = useData();
  const p = data.playersById[c.accused_id];
  const g = votes.filter((v) => v.vote === 'guilty').length;
  const n = votes.filter((v) => v.vote === 'not_guilty').length;
  return (
    <Link to={`/tribunal/${c.id}`} className="card pad row" style={{ color: 'inherit', textDecoration: 'none', gap: 12 }}>
      <Avatar player={p} size={44} />
      <div className="grow">
        <div style={{ fontWeight: 700, fontSize: 17 }}>The Lads v {playerName(p)}</div>
        <div className="small muted">
          Proposed {fmtChange(c.proposed_change)} · {c.status === 'open' ? `${g}–${n} so far` : `${c.verdict === 'upheld' ? 'GUILTY' : 'NOT GUILTY'} ${c.guilty_votes}–${c.not_guilty_votes}${c.overruled ? ' (chair overruled)' : ''}`}
        </div>
      </div>
      {c.status === 'closed' && c.verdict === 'upheld' && <span className="num" style={{ fontSize: 20 }}>{Number(c.old_handicap)}→{Number(c.new_handicap)}</span>}
      <span className="muted">{Icon.next()}</span>
    </Link>
  );
}

function LodgeCase({ onClose, onDone, players }) {
  const { status } = useSession();
  const nav = useNavigate();
  const [accused, setAccused] = useState('');
  const [change, setChange] = useState(-2);
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const list = [...players].sort((a, b) => a.name.localeCompare(b.name));
  const target = players.find((p) => p.id === accused);
  return (
    <Sheet title="Lodge a case" onClose={onClose}>
      <div className="stack">
        <label className="field"><span>The accused</span>
          <select className="select" value={accused} onChange={(e) => setAccused(e.target.value)}>
            <option value="">Choose…</option>
            {list.map((p) => <option key={p.id} value={p.id}>{playerName(p)}{p.id === status.player_id ? ' (yourself?!)' : ''} — off {Number(p.handicap)}</option>)}
          </select>
        </label>
        <div className="field">
          <span>Proposed change</span>
          <div className="row" style={{ justifyContent: 'center', gap: 18 }}>
            <button type="button" className="step" style={{ width: 56, height: 56 }} aria-label="Lower" onClick={() => setChange(Math.max(-10, change - 1))}>{Icon.minus(24)}</button>
            <span className="num" style={{ fontSize: 48, minWidth: 80, textAlign: 'center' }}>{fmtChange(change)}</span>
            <button type="button" className="step" style={{ width: 56, height: 56 }} aria-label="Higher" onClick={() => setChange(Math.min(10, change + 1))}>{Icon.plus(24)}</button>
          </div>
          {target && <span className="small muted" style={{ textAlign: 'center' }}>{playerName(target)} would go from {Number(target.handicap)} to {Number(target.handicap) + change}</span>}
        </div>
        <label className="field"><span>The case</span><textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="39 points on Saturday and still crying poor…" /></label>
        <span className="label">Exhibit A (optional)</span>
        <PhotoButtons onPick={setFile} picked={!!file} cameraLabel={file ? 'Retake' : 'Take a photo'} />
        <button type="button" className="btn gold block" disabled={busy || !accused || !text.trim() || change === 0} onClick={async () => {
          setBusy(true);
          try {
            const url = file ? await uploadPhoto(file, 'tribunal') : null;
            const { data: id, error } = await supabase.rpc('lodge_case', { p_accused: accused, p_change: change, p_text: text, p_exhibit_url: url });
            if (error) throw error;
            onDone();
            onClose();
            nav(`/tribunal/${id}`);
          } catch (e) { toast(friendlyError(e)); } finally { setBusy(false); }
        }}>{busy ? 'Lodging…' : 'Lodge the case'}</button>
      </div>
    </Sheet>
  );
}

const VOTE_LABEL = { guilty: 'Guilty', not_guilty: 'Not guilty', abstain: 'Abstain' };

export function TribunalCase() {
  const { caseId } = useParams();
  const data = useData();
  const { status } = useSession();
  const { cases, votes, reload } = useCases();
  const c = cases?.find((x) => x.id === caseId);
  const history = usePlayerHistory(c?.accused_id);
  const [comment, setComment] = useState('');
  const [defence, setDefence] = useState(null);
  const [chairOpen, setChairOpen] = useState(false);
  const [pick, setPick] = useState(null); // vote chosen but not yet cast
  if (!cases) return <Loading />;
  if (!c) return <div className="page"><Header court back title="Case not found" /></div>;

  const accused = data.playersById[c.accused_id];
  const lodger = data.playersById[c.lodged_by];
  const me = status.player_id;
  const cv = votes.filter((v) => v.case_id === c.id);
  const myVote = cv.find((v) => v.voter_id === me);
  const g = cv.filter((v) => v.vote === 'guilty');
  const n = cv.filter((v) => v.vote === 'not_guilty');
  const a = cv.filter((v) => v.vote === 'abstain');
  const total = Math.max(1, cv.length);
  const isAccused = me === c.accused_id;
  const open = c.status === 'open';
  const last5 = history.stableford.filter((s) => s.finished).slice(-5);
  const maxPts = Math.max(42, ...last5.map((s) => s.points));
  const minPts = Math.min(24, ...last5.map((s) => s.points));
  const bar = (v) => `${Math.round(((v - minPts) / (maxPts - minPts)) * 70)}px`;

  async function vote(v) {
    const { error } = await supabase.rpc('cast_vote', { p_case: c.id, p_vote: v, p_comment: comment });
    if (error) toast(friendlyError(error));
    else { toast('Vote recorded'); reload(); }
  }

  return (
    <div className="page">
      <header className="hdr court">
        <div className="hdr-row"><Link to="/tribunal" className="back" style={{ textDecoration: 'none' }}>{Icon.back()}<span>Tribunal</span></Link></div>
        <div className="row label" style={{ color: 'var(--gold)', gap: 6 }}>{Icon.gavel(16)}<span>Handicap Tribunal · {open ? 'in session' : 'closed'}</span></div>
        <div className="hdr-row">
          <Avatar player={accused} size={54} ring="var(--gold)" />
          <div className="hdr-grow">
            <div className="hdr-title">The Lads v {playerName(accused)}</div>
            <div className="hdr-sub">Lodged by {playerName(lodger)} · {timeAgo(c.created_at)}</div>
          </div>
          <div style={{ background: '#fff', color: 'var(--text)', borderRadius: 10, padding: '6px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>{open ? 'PROPOSED' : c.verdict === 'upheld' ? 'GUILTY' : 'NOT GUILTY'}</div>
            <div className="num" style={{ fontSize: 22, lineHeight: 1 }}>
              {open ? `${Number(accused?.handicap)} → ${Number(accused?.handicap) + Number(c.proposed_change)}` : `${Number(c.old_handicap)} → ${Number(c.new_handicap)}`}
            </div>
          </div>
        </div>
      </header>

      <div className="section stack">
        <div className="card pad stack" style={{ gap: 6 }}>
          <span className="label">The case</span>
          <div style={{ fontSize: 16, lineHeight: 1.45 }}>{c.case_text}</div>
          {c.exhibit_url && <img src={c.exhibit_url} alt="Exhibit A" style={{ width: '100%', borderRadius: 10, marginTop: 6 }} />}
        </div>

        <div className="card pad stack">
          <div className="row between"><span className="label">Evidence · last {last5.length || ''} Stableford rounds</span><span className="small muted">automatic</span></div>
          {last5.length ? (
            <>
              <div style={{ position: 'relative', height: 96, display: 'flex', alignItems: 'flex-end', gap: 10, borderBottom: '1px solid #B9C2CC', padding: '0 4px' }} role="img" aria-label={`Recent rounds: ${last5.map((s) => s.points).join(', ')} points. Expected is 36.`}>
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: bar(36), borderTop: '2px dashed var(--under)' }} />
                <span style={{ position: 'absolute', right: 0, bottom: `calc(${bar(36)} + 3px)`, fontSize: 11, fontWeight: 700, color: 'var(--under)', background: '#fff', padding: '0 3px' }}>36 expected</span>
                {last5.map((s) => (
                  <div key={s.round.id} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{s.points}</span>
                    <span style={{ display: 'block', width: '100%', height: bar(s.points), borderRadius: '4px 4px 0 0', background: s.points > 36 ? 'var(--court)' : '#9C93B3' }} />
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', textAlign: 'center' }}>
                <div><div className="num" style={{ fontSize: 24 }}>{history.avg?.toFixed(1) ?? '–'}</div><div className="small muted">Average</div></div>
                <div><div className="num" style={{ fontSize: 24 }}>{history.best ?? '–'}</div><div className="small muted">Best</div></div>
                <div><div className="num" style={{ fontSize: 24 }}>{history.cases.filter((x) => x.id !== c.id).length}</div><div className="small muted">Past cases</div></div>
              </div>
            </>
          ) : <span className="small muted">No Stableford rounds in the app yet — the lads will have to go on memory and vibes.</span>}
          {history.hist.length > 1 && (
            <div className="small muted">Handicap history: {history.hist.map((h) => Number(h.new_handicap)).join(' → ')}</div>
          )}
        </div>

        <div className="card pad stack court-card" style={{ gap: 6 }}>
          <span className="label" style={{ color: '#4A3F63' }}>Statement from the accused</span>
          {isAccused && open && defence !== null ? (
            <>
              <textarea className="textarea" value={defence} onChange={(e) => setDefence(e.target.value)} placeholder="Your honour, I was carrying an injury…" />
              <button type="button" className="btn sm" onClick={async () => {
                const { error } = await supabase.rpc('set_defence', { p_case: c.id, p_text: defence });
                if (error) toast(friendlyError(error)); else { setDefence(null); reload(); }
              }}>Submit statement</button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 16, fontStyle: 'italic', lineHeight: 1.45 }}>{c.defence || (isAccused ? 'You haven’t said anything yet.' : 'The accused has not yet spoken.')}</div>
              {isAccused && open && <button type="button" className="btn ghost sm" onClick={() => setDefence(c.defence || '')}>{c.defence ? 'Edit statement' : 'Make a statement'}</button>}
            </>
          )}
        </div>

        <div className="card pad stack">
          <div className="row between" style={{ fontWeight: 700 }}>
            <span>Guilty {g.length}</span>
            <span className="muted">Not guilty {n.length} · Abstain {a.length}</span>
          </div>
          <div className="vote-bar"><span className="g" style={{ width: `${(g.length / total) * 100}%` }} /><span className="n" style={{ width: `${(n.length / total) * 100}%` }} /></div>
          {cv.map((v) => (
            <div key={v.voter_id} className="row small">
              <Avatar player={data.playersById[v.voter_id]} size={24} />
              <strong>{playerName(data.playersById[v.voter_id])}</strong>
              <span className="muted">{v.vote === 'guilty' ? 'Guilty' : v.vote === 'not_guilty' ? 'Not guilty' : 'Abstain'}{v.comment ? ` — “${v.comment}”` : ''}</span>
            </div>
          ))}
          {open && status.role === 'guest' && <div className="small muted">Guests don’t vote in the Tribunal.</div>}
          {open && !isAccused && status.role !== 'guest' && (
            <>
              <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="One-liner for the court (optional)" />
              {myVote && <div className="small"><strong>Your vote: {VOTE_LABEL[myVote.vote]}.</strong> <span className="muted">Pick another and confirm to change it.</span></div>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {['guilty', 'not_guilty', 'abstain'].map((v) => {
                  const on = (pick || myVote?.vote) === v;
                  return (
                    <button key={v} type="button" className="btn ghost" aria-pressed={on}
                      style={on ? { background: 'var(--court)', color: '#fff', borderColor: 'var(--court)' } : { borderColor: 'var(--court)' }}
                      onClick={() => setPick(v === myVote?.vote ? null : v)}>
                      {on ? '✓ ' : ''}{VOTE_LABEL[v]}
                    </button>
                  );
                })}
              </div>
              {pick && pick !== myVote?.vote && (
                <button type="button" className="btn gold block" onClick={async () => { await vote(pick); setPick(null); }}>
                  Cast my vote: {VOTE_LABEL[pick]}
                </button>
              )}
            </>
          )}
          {open && isAccused && <span className="small muted">The accused can't vote on their own case.</span>}
          <span className="small muted">
            {open
              ? 'Closes automatically once everyone has voted, or when the chair closes it. Majority guilty = upheld. Changes apply from the next round.'
              : `Closed ${timeAgo(c.closed_at)}.${c.overruled ? ' The chair overruled the vote.' : ''}`}
          </span>
          {c.chair_ruling && <div className="court-card card pad"><strong>Chair's ruling:</strong> {c.chair_ruling}</div>}
          {!open && c.verdict && (
            <SharePicture label="🖼️ Share the verdict" kind="verdict"
              data={{ accused: playerName(accused), verdict: c.verdict, oldHcp: c.old_handicap != null ? Number(c.old_handicap) : null, newHcp: c.new_handicap != null ? Number(c.new_handicap) : null,
                votes: `${c.guilty_votes ?? 0}–${c.not_guilty_votes ?? 0}`, overruled: c.overruled }}
              text={`⚖️ The Handicap Tribunal: ${playerName(accused)} — ${c.verdict === 'upheld' ? 'GUILTY' : 'NOT GUILTY'}`} />
          )}
          {open && status.is_admin && <button type="button" className="btn ghost" onClick={() => setChairOpen(true)}>{Icon.gavel(18)}<span>Chair: close the case</span></button>}
        </div>
      </div>
      {chairOpen && <ChairClose c={c} guilty={g.length} notGuilty={n.length} onClose={() => setChairOpen(false)} onDone={reload} />}
    </div>
  );
}

function ChairClose({ c, guilty, notGuilty, onClose, onDone }) {
  const [override, setOverride] = useState('');
  const [ruling, setRuling] = useState('');
  const majority = guilty > notGuilty ? 'upheld' : 'dismissed';
  return (
    <Sheet title="Close the case" onClose={onClose}>
      <div className="stack">
        <div>The vote is <strong>{guilty}–{notGuilty}</strong>, so the verdict will be <strong>{majority === 'upheld' ? 'GUILTY' : 'NOT GUILTY'}</strong> unless you overrule it.</div>
        <label className="field"><span>Verdict</span>
          <select className="select" value={override} onChange={(e) => setOverride(e.target.value)}>
            <option value="">Go with the vote</option>
            <option value="upheld">Overrule: GUILTY (apply the change)</option>
            <option value="dismissed">Overrule: NOT GUILTY</option>
          </select>
        </label>
        <label className="field"><span>Chair's ruling {override ? '(required when overruling)' : '(optional)'}</span><textarea className="textarea" value={ruling} onChange={(e) => setRuling(e.target.value)} /></label>
        <button type="button" className="btn block" style={{ background: 'var(--court)' }} disabled={!!override && !ruling.trim()} onClick={async () => {
          const { error } = await supabase.rpc('chair_close_case', { p_case: c.id, p_override: override || null, p_ruling: ruling || null });
          if (error) toast(friendlyError(error)); else { toast('Case closed'); onDone(); onClose(); }
        }}>Close the case</button>
      </div>
    </Sheet>
  );
}
