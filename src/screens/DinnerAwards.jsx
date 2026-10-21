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

const TABLES = ['dinner_awards', 'dinner_award_nominations', 'dinner_award_votes'];

function useDinner(tripId) {
  const [d, setD] = useState(null);
  const load = useCallback(async () => {
    if (!tripId) { setD({ awards: [], nominations: [], votes: [] }); return; }
    const { data: awards, error } = await supabase.from('dinner_awards').select('*').eq('trip_id', tripId).order('created_at');
    if (error) { setD((cur) => cur || { awards: [], nominations: [], votes: [], failed: true }); return; }
    const ids = (awards || []).map((a) => a.id);
    const [n, v] = ids.length
      ? await Promise.all([
        supabase.from('dinner_award_nominations').select('*').in('award_id', ids).order('created_at'),
        supabase.from('dinner_award_votes').select('*').in('award_id', ids),
      ])
      : [{ data: [] }, { data: [] }];
    setD({ awards: awards || [], nominations: n.data || [], votes: v.data || [] });
  }, [tripId]);
  useEffect(() => { load(); }, [load]);
  useRealtime(TABLES, load);
  return [d, load];
}

export default function DinnerAwards() {
  const data = useData();
  const { status } = useSession();
  const { tripId } = useParams();
  const trip = (tripId && data.trips.find((t) => t.id === tripId)) || (!tripId && data.currentTrip) || null;
  const [d, reload] = useDinner(trip?.id);
  const [nominating, setNominating] = useState(null);
  const readOnly = !!status.viewing;
  const nameOf = useCallback((id) => playerName(data.playersById[id]) || 'Someone', [data.playersById]);
  const card = useMemo(() => (d ? resultsCard({ tripName: trip?.name, awards: d.awards, nominations: d.nominations, votes: d.votes, nameOf }) : null), [d, trip, nameOf]);

  if (!trip) return <div className="page"><Header back title="Dinner awards" /><div className="empty">No trip yet — dinner awards belong to a trip.</div></div>;
  if (!d) return <div className="page"><Header back title="Dinner awards" sub={trip.name} /><Loading /></div>;
  const list = sortAwards(d.awards);

  return (
    <div className="page">
      <Header back title="Fines and dinner awards" sub={trip.name} />
      <div className="section stack">
        {d.failed && <div className="err">Couldn’t load the awards — check your signal.</div>}
        {list.length === 0 && <div className="empty">No awards or fines yet. Add the first — the group nominates, then votes at dinner.</div>}
        {list.map((a) => (
          <AwardCard key={a.id} award={a} d={d} nameOf={nameOf} readOnly={readOnly} onNominate={() => setNominating(a)} reload={reload} trip={trip} />
        ))}
        {!readOnly && <AddAward trip={trip} onSaved={reload} />}
        {card?.rows.length > 0 && (
          <SharePicture kind="awards" data={card} label="🖼️ Share the results as a picture"
            text={`🍽️ ${trip.name} — fines and dinner awards`} />
        )}
        <p className="note" style={{ margin: 0 }}>
          Roast the golf and the mates — never race, religion, sexuality, disability or anything tragic (the app won’t take it).
          Fines are words only: no money changes hands in the app. One vote each; {status.is_admin ? 'you open and close the voting' : 'the organiser opens and closes the voting'}.
        </p>
      </div>
      {nominating && <NominateSheet award={nominating} d={d} onClose={() => setNominating(null)} onSaved={reload} />}
    </div>
  );
}

function AwardCard({ award, d, nameOf, readOnly, onNominate, reload, trip }) {
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

  const vote = (n) => run(async () => {
    await must(supabase.from('dinner_award_votes').upsert({ award_id: award.id, nomination_id: n.id, voter_id: me }, { onConflict: 'award_id,voter_id' }));
    await reload();
  }, 'Vote in');
  const move = () => run(async () => {
    await must(supabase.from('dinner_awards').update({ status: step.status }).eq('id', award.id));
    if (step.status === 'closed' && feedOn) {
      await supabase.from('posts').insert({ kind: 'user', player_id: me, trip_id: trip.id, link: `/dinner/${trip.id}`, body: closedPost(award, result, nameOf) });
    }
    await reload();
  }, step.status === 'closed' ? 'Decided — it’s on the Feed' : step.status === 'voting' ? 'Voting’s open' : null);
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
            {award.kind === 'fine' && award.penalty && <div className="small">Fine: {award.penalty}</div>}
          </div>
          {canRemove && <button type="button" className="btn ghost sm" disabled={busy} aria-label="Remove" onClick={() => window.confirm(`Remove “${award.title}”?`) && remove()}>✕</button>}
        </div>
        {closed && <div style={{ marginTop: 6, fontWeight: 800 }} data-testid="award-result">🏆 {resultLine(award, result, nameOf)}</div>}
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
              <div style={{ fontWeight: 700 }}>{nameOf(n.player_id)}{closed && winners.has(n.id) ? ' 🏆' : ''}</div>
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
  const save = () => run(async () => {
    const photo = file ? await uploadPhoto(file, 'dinner') : null;
    await must(supabase.from('dinner_award_nominations').insert({
      award_id: award.id, player_id: who, reason: reason.trim() || null, nominated_by: status.player_id,
      photo_url: photo, post_id: postId || null,
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
        <span className="label">Evidence (optional)</span>
        <PhotoButtons onPick={setFile} picked={!!file} />
        {posts.length > 0 && (
          <label className="field"><span>…or a photo from the Feed</span>
            <select className="select" value={postId} onChange={(e) => setPostId(e.target.value)}>
              <option value="">None</option>
              {posts.map((p) => <option key={p.id} value={p.id}>{playerName(data.playersById[p.player_id]) || 'Someone'}: {(p.body || 'photo').slice(0, 40)}</option>)}
            </select>
          </label>
        )}
        <button type="button" className="btn gold block" disabled={busy || !who || !!err} onClick={save}>Nominate</button>
        <span className="small muted">Nominations close when the organiser opens the voting.</span>
      </div>
    </Sheet>
  );
}
