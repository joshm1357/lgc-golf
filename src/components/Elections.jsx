// Committees and elections (ov19, migration 090): the Committees tab of Governance, a committee's card and set-up
// sheet, and the election panel on an election's page (nominate → accept → vote → seat filled).
// Everything here takes `g` (useGovernance() from screens/Cases.jsx) as a prop, so Cases.jsx can use it too.
// The app shows what will happen; the database decides (090). The rules are in lib/governance.js.
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, playerName, useFeature } from '../lib/store.jsx';
import { useRun, must } from '../lib/run.js';
import { Avatar, Sheet, toast } from './ui.jsx';
import {
  KIND, termLabel, termEndsWords, termLimitWords, standProblem, isContest, electionStage, canPickWinner, committeeJob,
  closesIn, staggeredHalfSeats,
} from '../lib/governance.js';

const KINDS_A_COMMITTEE_HEARS = ['handicap', 'new_rule', 'change_rule', 'scrap_rule', 'ruling', 'other'];

/** Open elections for a seat (an election with nominations or the old yes/no kind). */
function openElection(g, committeeId, seatNo) {
  return g.cases.find((c) => c.kind === 'election' && c.status === 'open' && c.proposal?.committee_id === committeeId && Number(c.proposal?.seat_no) === seatNo);
}
const closeWords = (iso) => closesIn(iso).replace('closes in', 'close in').replace('voting has closed', 'closed');

/** The list-row line for an election: "Election · nominations close in 3 days" etc. */
export function electionRowWords(c, g) {
  const stage = electionStage(c);
  const n = (g?.nominations || []).filter((x) => x.case_id === c.id && x.status === 'accepted').length;
  if (stage === 'nominating') return `Election · nominations ${closeWords(c.closes_at)} · ${n} standing`;
  if (stage === 'voting') return `Election · voting ${closesIn(c.closes_at)} ·${n} candidates`;
  if (stage === 'casting') return 'Election · a tie — an organiser picks';
  if (stage === 'organiser') return 'Election · an organiser picks from the nominees';
  return `Election · ${c.status === 'passed' ? c.verdict || 'Elected' : c.status === 'withdrawn' ? 'Withdrawn' : 'Nobody elected'}`;
}

// ------------------------------------------------------------------ the election panel (on the election's page)
export function ElectionPanel({ c, g }) {
  const data = useData();
  const { status } = useSession();
  const [busy, run] = useRun();
  const [turnout, setTurnout] = useState(null);
  const [pick, setPick] = useState(null);
  const [nominee, setNominee] = useState('');
  const me = status.player_id;
  const stage = electionStage(c);
  const com = g.committees.find((x) => x.id === c.proposal?.committee_id) || { name: 'committee', seats: 1 };
  const seatNo = Number(c.proposal?.seat_no);
  const seats = g.seats.filter((s) => s.committee_id === com.id);
  const noms = (g.nominations || []).filter((n) => n.case_id === c.id);
  const accepted = noms.filter((n) => n.status === 'accepted');
  const mine = noms.find((n) => n.player_id === me);
  const guest = status.role === 'guest';
  const name = (id) => playerName(data.playersById[id]) || 'Someone';
  const loadTurnout = useCallback(() => {
    if (stage !== 'voting') return;
    supabase.rpc('election_turnout', { p_case: c.id }).then(({ data: t }) => setTurnout(t || null), () => {});
  }, [c.id, stage]);
  useEffect(() => { loadTurnout(); }, [loadTurnout, c.status, c.stage, c.election_phase]);
  const after = (r) => { g.reload(); loadTurnout(); return r; };

  const candidates = [...data.players]
    .filter((p) => !noms.some((n) => n.player_id === p.id && n.status !== 'declined'))
    .filter((p) => !standProblem({ committee: com, seats, seatNo, playerId: p.id, members: g.members }))
    .sort((a, b) => playerName(a).localeCompare(playerName(b)));
  const myProblem = me ? standProblem({ committee: com, seats, seatNo, playerId: me, members: g.members, name: 'You' }) : 'Set up your profile first';
  const results = c.proposal?.results || [];
  const tied = c.proposal?.tied || [];

  return (
    <div className="card pad stack" data-testid="election">
      <div className="row between" style={{ gap: 8 }}>
        <strong>🗳️ {com.name}, seat {seatNo}</strong>
        <span className="small muted">{termLabel(com)}</span>
      </div>
      <div className="small muted">{termLimitWords(com)}. One person, one vote per seat. Most votes wins; a tie goes to an organiser who isn’t in it.</div>

      {stage === 'nominating' && (
        <>
          <div className="small"><strong>Nominations {closeWords(c.closes_at)}.</strong> Nominate yourself or a mate — a mate has to accept.</div>
          <NomineeList noms={noms} name={name} data={data} />
          {mine?.status === 'pending' && (
            <div className="court-card card pad stack" data-testid="accept-nomination">
              <strong>You’ve been nominated{mine.nominated_by ? ` by ${name(mine.nominated_by)}` : ' to stand again'}.</strong>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <button type="button" className="btn gold" disabled={busy} onClick={() => run(async () => after(await must(supabase.rpc('answer_nomination', { p_case: c.id, p_accept: true }))), 'You’re standing')}>Accept</button>
                <button type="button" className="btn ghost" disabled={busy} onClick={() => run(async () => after(await must(supabase.rpc('answer_nomination', { p_case: c.id, p_accept: false }))), 'Declined')}>Decline</button>
              </div>
            </div>
          )}
          {mine?.status === 'accepted' && (
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => window.confirm('Withdraw from this election?') && run(async () => after(await must(supabase.rpc('answer_nomination', { p_case: c.id, p_accept: false }))), 'Withdrawn')}>Withdraw my nomination</button>
          )}
          {!guest && me && (
            <div className="stack" style={{ gap: 8 }}>
              {(!mine || mine.status === 'declined') && !myProblem && (
                <button type="button" className="btn gold block" disabled={busy} data-testid="stand" onClick={() => run(async () => after(await must(supabase.rpc('nominate', { p_case: c.id, p_player: me }))), 'You’re standing')}>Stand for this seat</button>
              )}
              {myProblem && !mine && <div className="small muted">{myProblem}.</div>}
              <div className="row" style={{ gap: 8 }}>
                <select className="select grow" aria-label="Nominate a mate" value={nominee} onChange={(e) => setNominee(e.target.value)}>
                  <option value="">Nominate a mate…</option>
                  {candidates.filter((p) => p.id !== me).map((p) => <option key={p.id} value={p.id}>{playerName(p)}</option>)}
                </select>
                <button type="button" className="btn sm" disabled={busy || !nominee} onClick={() => run(async () => {
                  after(await must(supabase.rpc('nominate', { p_case: c.id, p_player: nominee })));
                  setNominee('');
                }, `${name(nominee)} nominated — they need to accept`)}>Nominate</button>
              </div>
            </div>
          )}
          {guest && <div className="small muted">Guests can watch, but don’t nominate or vote.</div>}
          <div className="small muted">When nominations close: nobody standing — the seat stays as it is; one person — elected unopposed; more — a vote.</div>
        </>
      )}

      {stage === 'voting' && (
        <>
          <div className="small"><strong>Voting {closesIn(c.closes_at)}.</strong> {turnout ? `${turnout.voted} of ${turnout.voters} have voted.` : ''} Secret ballot — the count comes out with the result.</div>
          <div className="stack" style={{ gap: 8 }} role="group" aria-label="Candidates">
            {accepted.map((n) => {
              const on = (pick || turnout?.mine) === n.player_id;
              return (
                <button key={n.player_id} type="button" className="btn ghost block" aria-pressed={on} disabled={!turnout?.can_vote}
                  style={{ justifyContent: 'flex-start', gap: 10, ...(on ? { background: 'var(--court)', color: '#fff', borderColor: 'var(--court)' } : {}) }}
                  onClick={() => setPick(n.player_id === turnout?.mine ? null : n.player_id)}>
                  <Avatar player={data.playersById[n.player_id]} size={30} />
                  <span className="grow" style={{ textAlign: 'left' }}>{name(n.player_id)}</span>
                  {turnout?.mine === n.player_id && <span>✓ Your vote</span>}
                </button>
              );
            })}
          </div>
          {pick && pick !== turnout?.mine && (
            <button type="button" className="btn gold block" disabled={busy} onClick={() => run(async () => {
              const r = await must(supabase.rpc('vote_election', { p_case: c.id, p_nominee: pick }));
              setPick(null); after();
              toast(String(r).startsWith('closed') ? 'Voting had closed — here’s the result' : r === 'passed' ? 'That settles it — seat filled' : r === 'casting' ? 'A tie — over to an organiser' : 'Vote recorded');
            })}>Vote for {name(pick)}</button>
          )}
          {turnout && !turnout.can_vote && <div className="small muted">{guest ? 'Guests don’t vote in elections.' : 'You don’t have a vote in this election.'}</div>}
          {turnout?.mine && !pick && <div className="small muted">You can change your vote until it closes.</div>}
        </>
      )}

      {(stage === 'casting' || stage === 'organiser') && (
        <PickWinner c={c} g={g} stage={stage} ids={stage === 'casting' ? tied : accepted.map((n) => n.player_id)} results={results} name={name} />
      )}

      {stage === 'done' && (
        <div className="stack" style={{ gap: 6 }} data-testid="election-result">
          <div style={{ fontWeight: 800, fontSize: 18 }}>{c.status === 'passed' ? `${name(c.subject_id)} elected` : c.status === 'withdrawn' ? 'Withdrawn' : 'Nobody elected'}</div>
          <div className="small">{c.reason}</div>
          {results.length > 1 && results.map((r) => (
            <div key={r.player_id} className="row small" style={{ gap: 8 }}>
              <Avatar player={data.playersById[r.player_id]} size={22} />
              <strong className="grow">{name(r.player_id)}</strong>
              <span>{r.votes} vote{r.votes === 1 ? '' : 's'}</span>
            </div>
          ))}
          {c.status === 'passed' && <Link to="/governance/committees" className="small">See the {com.name} →</Link>}
        </div>
      )}
    </div>
  );
}

function NomineeList({ noms, name, data }) {
  if (!noms.length) return <div className="small muted">Nobody nominated yet.</div>;
  return (
    <div className="stack" style={{ gap: 6 }} data-testid="nominees">
      {noms.map((n) => (
        <div key={n.player_id} className="row small" style={{ gap: 8, opacity: n.status === 'declined' ? 0.5 : 1 }}>
          <Avatar player={data.playersById[n.player_id]} size={24} />
          <strong className="grow">{name(n.player_id)}</strong>
          <span className="muted">{n.status === 'accepted' ? 'Standing' : n.status === 'pending' ? 'Waiting for them to accept' : 'Declined'}{n.nominated_by && n.nominated_by !== n.player_id ? ` · nominated by ${name(n.nominated_by)}` : ''}</span>
        </div>
      ))}
    </div>
  );
}

function PickWinner({ c, g, stage, ids, results, name }) {
  const { status } = useSession();
  const [busy, run] = useRun();
  const me = status.player_id;
  const can = canPickWinner({ role: status.role, playerId: me, stage, tied: c.proposal?.tied || [] });
  const votes = (id) => results.find((r) => r.player_id === id)?.votes;
  return (
    <div className="court-card card pad stack" data-testid="pick-winner">
      <strong>{stage === 'casting' ? `A tie${votes(ids[0]) != null ? ` on ${votes(ids[0])} votes each` : ''} — an organiser who isn’t in it picks the winner.` : 'An organiser picks from the nominees.'}</strong>
      {ids.map((id) => (
        <div key={id} className="row" style={{ gap: 8 }}>
          <strong className="grow">{name(id)}</strong>
          {can && id !== me && <button type="button" className="btn gold sm" disabled={busy} onClick={() => window.confirm(`Put ${name(id)} in the seat?`) && run(async () => {
            await must(supabase.rpc('decide_election', { p_case: c.id, p_winner: id })); g.reload();
          }, `${name(id)} elected`)}>Pick {name(id)}</button>}
        </div>
      ))}
      {!can && <span className="small muted">{status.role === 'organiser' ? 'You’re in it, so another organiser picks.' : 'Waiting for an organiser.'}</span>}
    </div>
  );
}

// ------------------------------------------------------------------ the Committees tab
export function CommitteesTab({ g }) {
  const { status } = useSession();
  const committeesOn = useFeature('committees');
  const [edit, setEdit] = useState(null);
  const organiser = status.role === 'organiser';
  if (!committeesOn) {
    return (
      <div className="section stack">
        <div className="empty">Committees are switched off for this group.</div>
        {organiser && <div className="small muted" style={{ textAlign: 'center' }}>Switch them on in Players & group → Features, or pick Club style in <Link to="/governance/settings">How we decide</Link>.</div>}
      </div>
    );
  }
  const open = g.cases.filter((c) => c.kind === 'election' && c.status === 'open');
  return (
    <div className="section stack" data-testid="committees">
      <details className="card pad small">
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>How committees and elections work</summary>
        <div className="stack" style={{ gap: 6, marginTop: 8 }}>
          <span>A <strong>committee</strong> is a few members who decide certain kinds of case for the group (say, handicaps). Which cases go to it is set in How we decide.</span>
          <span>Each committee has <strong>seats</strong>. A seat is held for a <strong>term</strong> (a number of trips, or years — whichever comes first). A <strong>term limit</strong> stops anyone holding the same seat too many terms in a row. <strong>Staggered</strong> terms mean half the seats come up at a time.</span>
          <span>Seats are filled by an <strong>election</strong> or by an organiser’s <strong>appointment</strong>. An election has two parts: nominations (stand yourself, or nominate a mate who accepts), then a secret vote — one person, one vote. Most votes wins; a tie goes to an organiser who isn’t in it. Only one person standing? Elected unopposed.</span>
          <span>When a term ends, the election opens by itself and the holder is asked to stand again (unless they’ve hit the limit). Someone can resign at any time — an elected seat then gets a by-election.</span>
        </div>
      </details>
      {open.length > 0 && <span className="label">🗳️ Elections now</span>}
      {open.map((c) => <ElectionRow key={c.id} c={c} g={g} />)}
      <div className="row between"><span className="label">Committees</span>{organiser && <button type="button" className="btn ghost sm" onClick={() => setEdit({})}>+ Add a committee</button>}</div>
      {!g.committees.length && <div className="empty">No committees yet.{organiser ? ' Add one, or pick Club style in How we decide.' : ''}</div>}
      {g.committees.map((com) => <CommitteeCard key={com.id} com={com} g={g} onEdit={() => setEdit(com)} />)}
      {edit && <CommitteeSheet com={edit} g={g} onClose={() => setEdit(null)} />}
    </div>
  );
}

function ElectionRow({ c, g }) {
  return (
    <Link to={`/tribunal/case/${c.id}`} className="card pad row court-card" style={{ color: 'inherit', textDecoration: 'none', gap: 12 }} data-testid="election-row">
      <span aria-hidden style={{ fontSize: 26 }}>🗳️</span>
      <span className="grow"><strong>{c.title}</strong><div className="small muted">{isContest(c) ? electionRowWords(c, g) : 'Yes/no election'}</div></span>
    </Link>
  );
}

export function CommitteeCard({ com, g, onEdit }) {
  const data = useData();
  const { status } = useSession();
  const nav = useNavigate();
  const [busy, run] = useRun();
  const organiser = status.role === 'organiser';
  const me = status.player_id;
  const seats = g.seats.filter((s) => s.committee_id === com.id && s.seat_no <= com.seats);
  const players = [...data.players].sort((a, b) => playerName(a).localeCompare(playerName(b)));
  return (
    <div className="card pad stack" style={{ gap: 8 }} data-testid={`committee-${com.name}`}>
      <div className="row between" style={{ gap: 8 }}>
        <strong style={{ fontSize: 17 }}>{com.name}</strong>
        {organiser && <button type="button" className="btn ghost sm" onClick={onEdit}>Edit</button>}
      </div>
      <span className="small">{committeeJob(com, g.settings)}.</span>
      <span className="small muted">
        {com.seats} seat{com.seats === 1 ? '' : 's'} · {com.fill === 'election' ? 'elected' : 'appointed by an organiser'} · term {termLabel(com)} · {termLimitWords(com).toLowerCase()}{com.staggered ? ' · staggered' : ''}
      </span>
      {Array.from({ length: com.seats }, (_, i) => i + 1).map((n) => {
        const seat = seats.find((s) => s.seat_no === n) || { seat_no: n };
        const holder = data.playersById[seat.player_id];
        const el = openElection(g, com.id, n);
        return (
          <div key={n} className="stack" style={{ gap: 4, borderTop: '1px solid var(--line-soft)', paddingTop: 8 }} data-testid={`seat-${n}`}>
            <div className="row" style={{ gap: 8 }}>
              <span className="small muted" style={{ width: 48 }}>Seat {n}</span>
              {holder ? <><Avatar player={holder} size={30} /><strong className="grow">{playerName(holder)}</strong></>
                : <span className="grow muted small">Empty{com.fill === 'election' ? '' : ' — waiting for an organiser'}</span>}
              {holder && Number(seat.term_no) > 1 && <span className="small muted">term {seat.term_no}</span>}
            </div>
            {holder && <span className="small muted" style={{ paddingLeft: 56 }}>{termEndsWords(seat, com, { trips: data.trips })}{seat.half_term ? ' (a short first term — staggered)' : ''}</span>}
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', paddingLeft: 56 }}>
              {el && <Link to={`/tribunal/case/${el.id}`} className="btn ghost sm" style={{ textDecoration: 'none' }}>🗳️ {isContest(el) ? electionRowWords(el, g).replace('Election · ', '') : 'Election open'} →</Link>}
              {!el && organiser && com.fill === 'election' && (
                <button type="button" className="btn ghost sm" disabled={busy} data-testid={`call-${n}`} onClick={() => window.confirm(`Call an election for seat ${n} of the ${com.name}? Nominations open for ${Math.round(Number(com.nominate_hours || 72) / 24) || 1} day(s), then the vote.`) && run(async () => {
                  const id = await must(supabase.rpc('call_election', { p_committee: com.id, p_seat_no: n }));
                  g.reload(); nav(`/tribunal/case/${id}`);
                }, 'Nominations open')}>Call an election</button>
              )}
              {organiser && com.fill === 'appointment' && (
                <select className="select" style={{ maxWidth: 190 }} aria-label={`Appoint seat ${n}`} value={seat.player_id || ''} disabled={busy} onChange={(e) => run(async () => {
                  await must(supabase.rpc('appoint_seat', { p_committee: com.id, p_seat_no: n, p_player: e.target.value || null })); g.reload();
                }, e.target.value ? 'Appointed' : 'Seat emptied')}>
                  <option value="">Empty</option>
                  {players.filter((p) => p.id === seat.player_id || !standProblem({ committee: com, seats, seatNo: n, playerId: p.id, members: g.members }))
                    .map((p) => <option key={p.id} value={p.id}>{playerName(p)}</option>)}
                </select>
              )}
              {holder && seat.player_id === me && (
                <button type="button" className="btn ghost sm" disabled={busy} onClick={() => window.confirm(`Step down from seat ${n} on the ${com.name}?${com.fill === 'election' ? ' A by-election opens straight away.' : ''}`) && run(async () => {
                  await must(supabase.rpc('resign_seat', { p_committee: com.id, p_seat_no: n })); g.reload();
                }, 'You’ve stepped down')}>Resign</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function CommitteeSheet({ com, g, onClose }) {
  const [v, setV] = useState({
    name: com.name || '', kinds: com.kinds || ['handicap'], seats: com.seats || 3, fill: com.fill || 'election',
    term_trips: com.id ? com.term_trips ?? null : 2, term_years: com.id ? com.term_years ?? null : 1,
    term_limit: com.term_limit ?? null, staggered: !!com.staggered, nominate_hours: com.nominate_hours || 72,
  });
  const [busy, run] = useRun();
  const set = (k, val) => setV({ ...v, [k]: val });
  const toggle = (k) => set('kinds', v.kinds.includes(k) ? v.kinds.filter((x) => x !== k) : [...v.kinds, k]);
  const hasTerm = !!(v.term_trips || v.term_years);
  const ok = v.name.trim().length >= 2 && Number(v.seats) >= 1 && Number(v.seats) <= 15;
  const half = staggeredHalfSeats(v.seats);
  return (
    <Sheet title={com.id ? 'Edit committee' : 'New committee'} onClose={onClose}>
      <div className="stack" data-testid="committee-sheet">
        <label className="field"><span>Name</span><input className="input" value={v.name} onChange={(e) => set('name', e.target.value)} maxLength={40} placeholder="Handicap Committee" /></label>
        <span className="label">What it decides</span>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {KINDS_A_COMMITTEE_HEARS.map((k) => <button key={k} type="button" className="chip" aria-pressed={v.kinds.includes(k)} onClick={() => toggle(k)}>{KIND[k].label}</button>)}
        </div>
        <span className="small muted">To send those cases to it, pick it under “Who decides” in <Link to="/governance/settings">How we decide</Link>.</span>
        <label className="field"><span>Seats</span><input className="input" type="number" min={1} max={15} value={v.seats} onChange={(e) => set('seats', Number(e.target.value))} /></label>
        {!(Number(v.seats) >= 1 && Number(v.seats) <= 15) && <div className="small" role="alert" style={{ color: 'var(--under)' }}>A committee has 1 to 15 seats.</div>}
        <label className="field"><span>Seats are filled by</span>
          <select className="select" value={v.fill} onChange={(e) => set('fill', e.target.value)}><option value="election">Election (the group votes)</option><option value="appointment">Appointment (an organiser picks)</option></select>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label className="field"><span>Term: trips</span><input className="input" type="number" min={0} max={20} value={v.term_trips ?? ''} onChange={(e) => set('term_trips', e.target.value === '' || Number(e.target.value) === 0 ? null : Number(e.target.value))} placeholder="none" /></label>
          <label className="field"><span>or years</span><input className="input" type="number" min={0} max={10} step={0.5} value={v.term_years ?? ''} onChange={(e) => set('term_years', e.target.value === '' || Number(e.target.value) === 0 ? null : Number(e.target.value))} placeholder="none" /></label>
        </div>
        <span className="small muted">Term: {termLabel({ term_trips: v.term_trips, term_years: v.term_years })}. The holder keeps the seat until someone replaces them.</span>
        <label className="field"><span>Term limit</span>
          <select className="select" value={v.term_limit ?? ''} onChange={(e) => set('term_limit', e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">No limit</option>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n === 1 ? '1 term, then sit one out' : `${n} terms in a row`}</option>)}
          </select>
        </label>
        <label className="row" style={{ gap: 10, opacity: hasTerm && Number(v.seats) > 1 ? 1 : 0.5 }}>
          <input type="checkbox" checked={v.staggered} disabled={!hasTerm || Number(v.seats) < 2} onChange={(e) => set('staggered', e.target.checked)} />
          <span><strong>Staggered terms</strong><div className="small muted">{half.length ? `Seat${half.length === 1 ? '' : 's'} ${half.join(', ')} get a half-length first term, so not every seat comes up at once.` : 'Needs two or more seats and a term length.'}</div></span>
        </label>
        {v.fill === 'election' && (
          <label className="field"><span>Nominations stay open for</span>
            <select className="select" value={v.nominate_hours} onChange={(e) => set('nominate_hours', Number(e.target.value))}>
              {[24, 48, 72, 168].map((h) => <option key={h} value={h}>{h / 24} day{h === 24 ? '' : 's'}</option>)}
            </select>
          </label>
        )}
        <button type="button" className="btn gold block" disabled={busy || !ok} onClick={() => run(async () => {
          await must(supabase.rpc('save_committee_v2', {
            p_id: com.id || null, p_name: v.name.trim(), p_kinds: v.kinds, p_seats: Number(v.seats), p_fill: v.fill,
            p_term_trips: v.term_trips || null, p_term_years: v.term_years || null, p_term_limit: v.term_limit || null,
            p_staggered: hasTerm && Number(v.seats) > 1 && v.staggered, p_nominate_hours: v.nominate_hours,
          }));
          g.reload(); onClose();
        }, 'Saved')}>Save</button>
      </div>
    </Sheet>
  );
}
