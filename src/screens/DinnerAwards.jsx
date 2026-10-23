// Fines and dinner awards (migration 064, feature 'dinner_awards'). /dinner/:tripId (no id = the current trip).
// Anyone adds an award or a fine and nominates people (with a reason and a photo or feed post as evidence). The
// organiser opens the voting, then closes it: one vote each, most votes wins, level is a tie. Fines are words only —
// no money moves. Counting and wording are in lib/dinnerawards.js.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useRealtime, useSession, useFeature, playerName } from '../lib/store.jsx';
import { Header, Avatar, Sheet, Loading, PhotoButtons, toast } from '../components/ui.jsx';
import SharePicture from '../components/SharePicture.jsx';
import { useRun, must } from '../lib/run.js';
import { uploadPhoto } from '../lib/images.js';
import {
  STATUS_LABEL, KIND_LABEL, TITLE_MAX, PENALTY_MAX, REASON_MAX, AWARD_IDEAS, FINE_IDEAS, checkAward, checkReason,
  canNominate, canVote, nextStep, myVote, tally, resultLine, sortAwards, closedPost, resultsCard,
} from '../lib/dinnerawards.js';
import { lineFor } from '../lib/injokes.js';
import { termsOf, worthOf, proofNeeds, proofLabel, bestLabel, claimWords, rankClaims } from '../lib/awardsfines.js';
import { ProposeSheet } from '../components/AwardsFines.jsx';
import { AutoAwardRuns, FromScoresProposer } from '../components/AutoAwards.jsx';
import { autoTerms } from '../lib/autoawards.js';

const TABLES = ['dinner_awards', 'dinner_award_nominations', 'dinner_award_votes'];

function useDinner(tripId) {
  const [d, setD] = useState(null);
  const load = useCallback(async () => {
    if (!tripId) { setD({ awards: [], nominations: [], votes: [] }); return; }
    const { data: awards, error } = await supabase.from('dinner_awards').select('*').eq('trip_id', tripId).order('created_at');
    if (error) { setD((cur) => cur || { awards: [], nominations: [], votes: [], failed: true }); return; }
    const ids = (awards || []).map((a) => a.id);
    const ruleIds = [...new Set((awards || []).map((a) => a.rule_id).filter(Boolean))];
    const [n, v, r] = ids.length
      ? await Promise.all([
        supabase.from('dinner_award_nominations').select('*').in('award_id', ids).order('created_at'),
        supabase.from('dinner_award_votes').select('*').in('award_id', ids),
        ruleIds.length ? supabase.from('rules').select('*').in('id', ruleIds) : Promise.resolve({ data: [] }),
      ])
      : [{ data: [] }, { data: [] }, { data: [] }];
    // 093: an award from the Rulebook takes its rule's reward and proof.
    const rulesById = Object.fromEntries((r.data || []).map((x) => [x.id, x]));
    setD({ awards: awards || [], nominations: n.data || [], votes: v.data || [], rulesById });
  }, [tripId]);
  useEffect(() => { load(); }, [load]);
  useRealtime(TABLES, load);
  return [d, load];
}

/** A few of the group's running jokes for the decided awards' captions (072: in_joke_lines, never the whole list). */
function useJokeLines() {
  const on = useFeature('in_jokes');
  const [lines, setLines] = useState([]);
  useEffect(() => {
    let live = true;
    if (!on) { setLines([]); return undefined; }
    supabase.rpc('in_joke_lines', { p_n: 5 }).then(({ data, error }) => { if (live && !error) setLines(data || []); }, () => {});
    return () => { live = false; };
  }, [on]);
  return lines;
}

export default function DinnerAwards() {
  const data = useData();
  const { status } = useSession();
  const { tripId } = useParams();
  const trip = (tripId && data.trips.find((t) => t.id === tripId)) || (!tripId && data.currentTrip) || null;
  const [d, reload] = useDinner(trip?.id);
  const [nominating, setNominating] = useState(null);
  const [proposing, setProposing] = useState(false);
  const jokes = useJokeLines();
  const readOnly = !!status.viewing;
  const nameOf = useCallback((id) => playerName(data.playersById[id]) || 'Someone', [data.playersById]);
  const card = useMemo(() => (d ? resultsCard({ tripName: trip?.name, awards: d.awards, nominations: d.nominations, votes: d.votes, nameOf }) : null), [d, trip, nameOf]);

  if (!trip) return <div className="page"><Header back title="Awards and fines" /><div className="empty">No trip yet — awards and fines belong to a trip.</div></div>;
  if (!d) return <div className="page"><Header back title="Awards and fines" sub={trip.name} /><Loading /></div>;
  // 100: a nightly (daily, from-the-scores) award shows as its runs below, not as a card to vote on; the nights'
  // copies (parent_id) are inside those runs.
  const list = sortAwards(d.awards.filter((a) => !a.parent_id && autoTerms(a, d.rulesById?.[a.rule_id] || null).runs === 'trip'));

  return (
    <div className="page">
      <Header back title="Awards and fines" sub={trip.name} />
      <div className="section stack">
        {d.failed && <div className="err">Couldn’t load the awards — check your signal.</div>}
        {list.length === 0 && d.awards.length === 0 && <div className="empty">No awards or fines yet. Add the first — the group nominates, then votes when you get together (dinner, lunch or at the course).</div>}
        {/* ov28 (I14): the presentation — winners one by one on the TV or a phone, at dinner, lunch or the course. */}
        <Link to={`/present/awards/${trip.id}`} className="btn gold block" data-testid="present-awards">🎤 Present the awards</Link>
        <AutoAwardRuns trip={trip} />
        <FromScoresProposer trip={trip} />
        {list.map((a) => (
          <AwardCard key={a.id} award={a} d={d} nameOf={nameOf} readOnly={readOnly} onNominate={() => setNominating(a)} reload={reload} trip={trip} joke={lineFor(jokes, a.id)} />
        ))}
        {!readOnly && <AddAward trip={trip} onSaved={reload} />}
        {!readOnly && status.role !== 'guest' && <button type="button" className="btn ghost block" onClick={() => setProposing(true)} data-testid="dinner-propose">📜 Propose one for the Rulebook (every trip, with a reward and proof)</button>}
        {card?.rows.length > 0 && (
          <SharePicture kind="awards" data={card} label="🖼️ Share the results as a picture"
            text={`🏅 ${trip.name} — awards and fines`} />
        )}
        <p className="note" style={{ margin: 0 }}>
          Roast the golf and the mates — never race, religion, sexuality, disability or anything tragic (the app won’t take it).
          Fines are words only: no money changes hands in the app. One vote each; {status.is_admin ? 'you open and close the voting' : 'the organiser opens and closes the voting'}.
        </p>
      </div>
      {nominating && <NominateSheet award={nominating} d={d} onClose={() => setNominating(null)} onSaved={reload} />}
      {proposing && <ProposeSheet trip={trip} onClose={() => setProposing(false)} onSaved={reload} />}
    </div>
  );
}

function AwardCard({ award, d, nameOf, readOnly, onNominate, reload, trip, joke }) {
  const data = useData();
  const { status } = useSession();
  const feedOn = useFeature('feed');
  const [busy, run] = useRun();
  const me = status.player_id;
  const org = !!status.is_admin;
  const result = tally(award, d.nominations, d.votes);
  const mine = myVote(d.votes, award.id, me);
  const closed = award.status === 'closed';
  const winners = new Set(result.winners.map((w) => w.nomination.id));
  const step = nextStep(award);
  const terms = termsOf(award, d.rulesById || {});
  const worth = worthOf(terms, award);
  const ranked = rankClaims(d.nominations.filter((n) => n.award_id === award.id), terms.best);
  const rankOf = Object.fromEntries(ranked.map((n) => [n.id, n.rank]));
  const [tie, setTie] = useState(null); // players to pick from when the vote is level

  const vote = (n) => run(async () => {
    await must(supabase.from('dinner_award_votes').upsert({ award_id: award.id, nomination_id: n.id, voter_id: me }, { onConflict: 'award_id,voter_id' }));
    await reload();
  }, 'Vote in');
  // 093: closing decides it on the server — the winner, the Feed post ("🏆 Latest out — Hamish, 2:47am 📷 · −1 stroke
  // next round") and any strokes for the next round. Level on votes: the organiser picks. An older database: as before.
  const settle = async (player = null) => {
    const { data: r, error } = await supabase.rpc('settle_dinner_award', { p_award: award.id, ...(player ? { p_player: player } : {}) });
    if (error) {
      if (/settle_dinner_award|function/i.test(error.message || '') && feedOn) {
        await supabase.from('posts').insert({ kind: 'user', player_id: me, trip_id: trip.id, link: `/dinner/${trip.id}`, body: closedPost(award, result, nameOf) });
        return;
      }
      throw error;
    }
    if (r?.status === 'tie') setTie(r.players || []);
    else setTie(null);
  };
  const move = () => run(async () => {
    await must(supabase.from('dinner_awards').update({ status: step.status }).eq('id', award.id));
    if (step.status === 'closed') await settle();
    await reload();
  }, step.status === 'closed' ? 'Closed — the result’s on the Feed' : step.status === 'voting' ? 'Voting’s open' : null);
  const pickWinner = (pid) => run(async () => { await settle(pid); await reload(); }, `${nameOf(pid)} it is — it’s on the Feed`);
  const remove = () => run(async () => {
    await must(supabase.from('dinner_awards').delete().eq('id', award.id));
    await reload();
  }, 'Removed');
  const canRemove = !readOnly && (org || (award.created_by === me && award.status === 'nominating'));

  return (
    <div className="card" style={{ overflow: 'hidden', borderColor: award.status === 'voting' ? 'var(--gold)' : undefined }} data-testid="award-card">
      <div style={{ padding: '12px 14px', background: award.status === 'voting' ? 'var(--gold-soft)' : 'transparent' }}>
        <div className="row between" style={{ alignItems: 'flex-start', gap: 8 }}>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="small muted" style={{ fontWeight: 700 }}>{KIND_LABEL[award.kind]} · {STATUS_LABEL[award.status]}</div>
            <div style={{ fontSize: 19, fontWeight: 800 }}>{award.title}</div>
            {worth && <div className="small" data-testid="award-worth-line">{award.kind === 'fine' ? 'Fine' : 'Reward'}: <strong>{worth}</strong>{terms.reward_type === 'strokes' ? ' in the next round' : ''}</div>}
            {(proofLabel(terms.proof, terms.number_unit) || terms.best) && <div className="small muted">{[proofLabel(terms.proof, terms.number_unit), bestLabel(terms.best)].filter(Boolean).join(' · ')}</div>}
          </div>
          {canRemove && <button type="button" className="btn ghost sm" disabled={busy} aria-label="Remove" onClick={() => window.confirm(`Remove “${award.title}”?`) && remove()}>✕</button>}
        </div>
        {closed && <div style={{ marginTop: 6, fontWeight: 800 }} data-testid="award-result">🏆 {award.winner_id ? `${nameOf(award.winner_id)}${claimWords(d.nominations.find((n) => n.award_id === award.id && n.player_id === award.winner_id), terms) ? `, ${claimWords(d.nominations.find((n) => n.award_id === award.id && n.player_id === award.winner_id), terms)}` : ''}${worth ? ` · ${worth}${terms.reward_type === 'strokes' ? ' next round' : ''}` : ''}` : resultLine(award, result, nameOf)}</div>}
        {closed && org && !readOnly && !award.winner_id && (tie || result.tie) && (
          <div className="stack" style={{ gap: 6, marginTop: 6 }} data-testid="award-tie">
            <span className="small">Level — you pick who {award.kind === 'fine' ? 'cops it' : 'gets it'}:</span>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {(tie || result.winners.map((w) => w.player_id)).map((pid) => <button key={pid} type="button" className="btn sm ghost" disabled={busy} onClick={() => pickWinner(pid)}>{nameOf(pid)}</button>)}
            </div>
          </div>
        )}
        {closed && joke && result.winners.length > 0 && <div className="small muted" style={{ marginTop: 4, fontStyle: 'italic' }} data-testid="award-joke">🎙️ {joke}</div>}
        {award.status === 'voting' && <div className="small muted" style={{ marginTop: 4 }}>{result.total} vote{result.total === 1 ? '' : 's'} in so far{mine ? ' · yours is in' : ''}</div>}
      </div>
      {result.rows.length === 0 && <div className="small muted" style={{ padding: '0 14px 10px' }}>No nominations yet.</div>}
      {result.rows.map((r) => {
        const n = r.nomination;
        const p = data.playersById[n.player_id];
        const isMine = mine === n.id;
        return (
          <div key={n.id} className="row" style={{ gap: 10, padding: '10px 14px', borderTop: '1px solid var(--line-soft)', alignItems: 'flex-start', background: closed && winners.has(n.id) ? 'var(--gold-soft)' : undefined }} data-testid="nominee">
            <Avatar player={p} size={36} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{rankOf[n.id] ? <span className="small" style={{ marginRight: 6, padding: '1px 7px', borderRadius: 999, background: rankOf[n.id] === 1 ? 'var(--gold)' : 'var(--line-soft)' }} data-testid="claim-rank">#{rankOf[n.id]}</span> : null}{nameOf(n.player_id)}{closed && (award.winner_id ? award.winner_id === n.player_id : winners.has(n.id)) ? ' 🏆' : ''}</div>
              {claimWords(n, terms) && <div className="small" data-testid="claim-words">⏱ {claimWords(n, terms)}</div>}
              {n.reason && <div className="small">“{n.reason}”</div>}
              <div className="small muted">from {nameOf(n.nominated_by)}{n.post_id ? <> · <Link to="/feed">see the post</Link></> : ''}</div>
              {n.photo_url && <a href={n.photo_url} target="_blank" rel="noopener noreferrer"><img src={n.photo_url} alt="Evidence" loading="lazy" style={{ marginTop: 6, maxWidth: 140, maxHeight: 100, borderRadius: 8, objectFit: 'cover' }} /></a>}
            </div>
            {closed && <span className="num" style={{ fontSize: 20 }}>{r.votes}</span>}
            {canVote(award) && !readOnly && (
              <button type="button" className={`btn sm ${isMine ? 'gold' : 'ghost'}`} disabled={busy || isMine} onClick={() => vote(n)} aria-pressed={isMine}>{isMine ? '✓ Your vote' : 'Vote'}</button>
            )}
          </div>
        );
      })}
      {!readOnly && (canNominate(award, org) || org) && (
        <div className="row" style={{ gap: 8, padding: 10, borderTop: '1px solid var(--line-soft)' }}>
          {canNominate(award, org) && <button type="button" className="btn ghost sm grow" disabled={busy} onClick={onNominate}>+ Nominate someone</button>}
          {org && (award.status !== 'nominating' || result.rows.length > 0) && (
            <button type="button" className={`btn sm grow ${step.status === 'closed' ? 'gold' : closed ? 'ghost' : ''}`} disabled={busy || (step.status === 'voting' && result.rows.length === 0)} onClick={move}>{step.label}</button>
          )}
        </div>
      )}
    </div>
  );
}

function AddAward({ trip, onSaved }) {
  const { status } = useSession();
  const [kind, setKind] = useState('award');
  const [title, setTitle] = useState('');
  const [penalty, setPenalty] = useState('');
  const [busy, run] = useRun();
  const err = title.trim() || penalty.trim() ? checkAward({ title, kind, penalty }) : '';
  const add = () => run(async () => {
    await must(supabase.from('dinner_awards').insert({ trip_id: trip.id, title: title.trim(), kind, penalty: kind === 'fine' ? penalty.trim() || null : null, created_by: status.player_id }));
    setTitle(''); setPenalty('');
    await onSaved();
  }, kind === 'fine' ? 'Fine added — nominate someone' : 'Award added — nominate someone');
  const ideas = kind === 'fine' ? FINE_IDEAS : AWARD_IDEAS.map((t) => ({ title: t }));
  return (
    <div className="card pad stack" style={{ gap: 8 }} data-testid="add-award">
      <strong>Add an award or a fine</strong>
      <div className="seg light" role="group" aria-label="Award or fine">
        <button type="button" aria-pressed={kind === 'award'} onClick={() => setKind('award')}>🏅 Award</button>
        <button type="button" aria-pressed={kind === 'fine'} onClick={() => setKind('fine')}>🍺 Fine</button>
      </div>
      <div className="chips" style={{ flexWrap: 'wrap' }}>
        {ideas.map((i) => <button key={i.title} type="button" className="chip" onClick={() => { setTitle(i.title); if (i.penalty) setPenalty(i.penalty); }}>{i.title}</button>)}
      </div>
      <label className="field"><span>{kind === 'fine' ? 'The fine' : 'The award'}</span>
        <input className="input" value={title} maxLength={TITLE_MAX + 10} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'fine' ? 'e.g. Late to the tee' : 'e.g. Hack of the day'} /></label>
      {kind === 'fine' && (
        <label className="field"><span>What they have to do (words only — no money)</span>
          <input className="input" value={penalty} maxLength={PENALTY_MAX + 10} onChange={(e) => setPenalty(e.target.value)} placeholder="e.g. buys the first round" /></label>
      )}
      {err && <span className="err" role="alert">{err}</span>}
      <button type="button" className="btn gold block" disabled={busy || !title.trim() || !!err} onClick={add}>Add {kind === 'fine' ? 'the fine' : 'the award'}</button>
    </div>
  );
}

function NominateSheet({ award, d, onClose, onSaved }) {
  const data = useData();
  const { status } = useSession();
  const feedOn = useFeature('feed');
  const [who, setWho] = useState('');
  const [reason, setReason] = useState('');
  const [file, setFile] = useState(null);
  const [postId, setPostId] = useState('');
  const [posts, setPosts] = useState([]);
  const [busy, run] = useRun();
  const taken = new Set(d.nominations.filter((n) => n.award_id === award.id).map((n) => n.player_id));
  const people = data.players.filter((p) => p.approved !== false && !taken.has(p.id)).sort((a, b) => playerName(a).localeCompare(playerName(b)));
  useEffect(() => {
    if (!feedOn) return undefined;
    let live = true;
    supabase.from('posts').select('id,photo_url,body,player_id,created_at').not('photo_url', 'is', null).order('created_at', { ascending: false }).limit(20)
      .then(({ data: ps }) => live && setPosts(ps || []), () => {});
    return () => { live = false; };
  }, [feedOn]);
  const err = checkReason(reason);
  // 093: the proof this one needs (a photo, a time, a number).
  const terms = termsOf(award, d.rulesById || {});
  const needs = proofNeeds(terms.proof);
  const [time, setTime] = useState('');
  const [num, setNum] = useState('');
  const pickedPost = posts.find((p) => p.id === postId);
  const proofOk = (!needs.photo || file || pickedPost?.photo_url) && (!needs.time || time) && (!needs.number || num !== '');
  const save = () => run(async () => {
    const photo = file ? await uploadPhoto(file, 'dinner') : null;
    await must(supabase.from('dinner_award_nominations').insert({
      award_id: award.id, player_id: who, reason: reason.trim() || null, nominated_by: status.player_id,
      photo_url: photo, post_id: postId || null,
      ...(needs.time ? { claim_at: new Date(time).toISOString() } : {}), ...(needs.number ? { claim_number: Number(num) } : {}),
    }));
    await onSaved();
    onClose();
  }, `${playerName(data.playersById[who])} nominated`);
  return (
    <Sheet title={`Nominate: ${award.title}`} onClose={onClose}>
      <div className="stack" data-testid="nominate-sheet">
        <label className="field"><span>Who</span>
          <select className="select" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Who">
            <option value="">Pick someone</option>
            {people.map((p) => <option key={p.id} value={p.id}>{playerName(p)}</option>)}
          </select>
        </label>
        <label className="field"><span>Why (optional)</span>
          <input className="input" value={reason} maxLength={REASON_MAX + 10} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Three balls in the dam on 7" /></label>
        {err && <span className="err" role="alert">{err}</span>}
        {needs.time && <label className="field"><span>Time (needed)</span><input className="input" type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} data-testid="nominate-time" /></label>}
        {needs.number && <label className="field"><span>{terms.number_unit ? `How many (${terms.number_unit})` : 'The number'} (needed)</span><input className="input" inputMode="decimal" value={num} onChange={(e) => setNum(e.target.value.replace(/[^\d.]/g, ''))} data-testid="nominate-number" /></label>}
        <span className="label">{needs.photo ? 'Photo (needed)' : 'Evidence (optional)'}</span>
        <PhotoButtons onPick={setFile} picked={!!file} />
        {posts.length > 0 && (
          <label className="field"><span>…or a photo from the Feed</span>
            <select className="select" value={postId} onChange={(e) => setPostId(e.target.value)}>
              <option value="">None</option>
              {posts.map((p) => <option key={p.id} value={p.id}>{playerName(data.playersById[p.player_id]) || 'Someone'}: {(p.body || 'photo').slice(0, 40)}</option>)}
            </select>
          </label>
        )}
        <button type="button" className="btn gold block" disabled={busy || !who || !!err || !proofOk} onClick={save}>Nominate</button>
        <span className="small muted">Nominations close when the organiser opens the voting.</span>
      </div>
    </Sheet>
  );
}
