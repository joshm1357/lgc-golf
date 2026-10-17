import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useData, useScores, useSession, playerName } from '../lib/store.jsx';
import { saveScore } from '../lib/offline.js';
import { uploadPhoto } from '../lib/images.js';
import { courseHoles } from '../lib/board.js';
import { strokesReceived, stablefordPoints } from '../lib/scoring.js';
import { Icon, Loading, toast, PhotoButtons } from '../components/ui.jsx';

const MOMENTS = ['Chip-in', 'Bomb drive', 'Lost ball', 'Air shot', 'Three-putt', 'Tree hit', 'Sandy save'];

function scoreWord(strokes, par) {
  if (strokes == null) return '';
  if (strokes === 1) return 'Hole in one!';
  const d = strokes - par;
  return { '-3': 'Albatross', '-2': 'Eagle', '-1': 'Birdie', 0: 'Par', 1: 'Bogey', 2: 'Double bogey', 3: 'Triple bogey' }[d] || (d > 0 ? `+${d}` : `${d}`);
}

export default function ScoreEntry() {
  const { roundId } = useParams();
  const nav = useNavigate();
  const data = useData();
  const { status } = useSession();
  const scores = useScores(roundId);
  const round = data.rounds?.find((r) => r.id === roundId);
  const course = round ? data.coursesById[round.course_id] : null;
  const holes = useMemo(() => courseHoles(course), [course]);
  const isA = round?.format === 'ambrose';
  const me = status?.player_id;

  const subjects = useMemo(() => {
    if (!round) return [];
    if (isA) return (data.teamsByRound[round.id] || []).map((t) => ({ id: t.id, name: t.name, hcp: t.handicap, players: t.players }));
    return (data.roundPlayers[round.id] || []).map((rp) => ({
      id: rp.player_id, name: playerName(data.playersById[rp.player_id]), hcp: rp.playing_handicap, players: [data.playersById[rp.player_id]],
    }));
  }, [round, data, isA]);

  const mine = subjects.find((s) => s.players.some((p) => p?.id === me));
  const [subjectId, setSubjectId] = useState(null);
  const subject = subjects.find((s) => s.id === subjectId) || mine || subjects[0];
  const myScores = (subject && scores.index[roundId]?.[subject.id]) || {};

  const firstOpen = holes.find((h) => !myScores[h.n])?.n ?? 1;
  const [holeN, setHoleN] = useState(null);
  const hole = holes.find((h) => h.n === (holeN ?? firstOpen)) || holes[0];
  const existing = hole ? myScores[hole.n] : null;
  const [value, setValue] = useState(null);
  const [pickedUp, setPickedUp] = useState(false);
  const [moment, setMoment] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);

  // Reset the stepper when the hole or subject changes.
  const resetKey = `${subject?.id}|${hole?.n}`;
  useEffect(() => {
    setValue(null);
    setPickedUp(false);
    setMoment(null);
    setPhoto(null);
  }, [resetKey]);

  if (!data.ready) return <Loading />;
  if (!round || !course) return <div className="empty">Round not found.</div>;
  if (!subjects.length) return <div className="empty">No {isA ? 'teams' : 'players'} in this round yet.</div>;
  if (!hole) return <div className="empty">This course has no holes set up yet.</div>;

  const strokes = value ?? existing?.strokes ?? hole.par;
  const isPickup = pickedUp || (value == null && existing?.picked_up);
  const recv = strokesReceived(subject.hcp, hole.si);
  const net = strokes - recv;
  const playedCount = holes.filter((h) => myScores[h.n]).length;
  const editor = existing?.entered_by ? data.playersById[existing.entered_by] : null;
  const locked = round.status !== 'live' && !status?.is_admin;

  async function save() {
    setBusy(true);
    try {
      const row = {
        round_id: round.id, subject_id: subject.id, subject_type: isA ? 'team' : 'player', hole: hole.n,
        strokes: isPickup ? null : strokes, picked_up: !!isPickup, entered_by: me,
      };
      const sent = await saveScore(row);
      if (!sent) toast('Saved on your phone — will sync when signal returns');
      // Moment and photo go to the feed.
      if (moment || photo) {
        let url = null;
        if (photo) {
          try { url = await uploadPhoto(photo, 'feed'); } catch { toast('Photo upload failed — try again from the Feed'); }
        }
        const { error: postErr } = await supabase.from('posts').insert({
          kind: 'user', player_id: me, round_id: round.id, trip_id: round.trip_id, hole: hole.n, photo_url: url,
          body: moment ? `${moment} on ${hole.n}${isA ? ` (${subject.name})` : ''}` : null,
        });
        if (postErr) toast("Score saved, but the feed post didn't go — no signal?");
      }
      const next = holes.find((h) => h.n > hole.n && !myScores[h.n]) || holes.find((h) => !myScores[h.n] && h.n !== hole.n);
      if (next) setHoleN(next.n);
      else {
        toast('Card complete!');
        nav(`/?r=${round.id}`);
      }
    } catch (e) {
      toast(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app" style={{ minHeight: '100vh' }}>
      <header className="hdr">
        <div className="hdr-row between">
          <button type="button" className="back" onClick={() => nav(`/?r=${round.id}`)}>{Icon.back()}<span>Leaderboard</span></button>
          {subjects.length > 1 ? (
            <select className="select" style={{ width: 'auto', minHeight: 38, background: 'var(--navy-2)', color: '#fff', border: 0 }} value={subject.id} onChange={(e) => { setSubjectId(e.target.value); setHoleN(null); }} aria-label={isA ? 'Team' : 'Player'}>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}{s === mine ? ' (me)' : ''}</option>)}
            </select>
          ) : <span className="hdr-sub">{subject.name}</span>}
        </div>
        <div className="hdr-row between" style={{ alignItems: 'flex-end' }}>
          <div>
            <div className="label" style={{ color: 'var(--gold)' }}>Hole</div>
            <div className="num" style={{ fontSize: 64, lineHeight: 0.9 }}>{hole.n}</div>
          </div>
          <div className="row" style={{ gap: 18, paddingBottom: 6 }}>
            {[['Par', hole.par], ['SI', hole.si], ['Shots', recv > 0 ? `+${recv}` : recv]].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span className="hdr-sub" style={{ fontSize: 12 }}>{k}</span>
                <span className="num" style={{ fontSize: 28 }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="holes" aria-label={`Holes played: ${playedCount} of ${holes.length}`}>
          {holes.map((h) => (
            <button key={h.n} type="button" className={'hole-dot' + (h.n === hole.n ? ' cur' : myScores[h.n] ? ' done' : '')} onClick={() => setHoleN(h.n)}>{h.n}</button>
          ))}
        </div>
      </header>

      {scores.pendingCount > 0 && (
        <div className="sync"><strong>{scores.pendingCount} waiting to sync.</strong> They'll send when signal's back.</div>
      )}
      {locked && <div className="sync">This round isn't live — scores can't be changed.</div>}

      <div className="section">
        <div className="card" style={{ padding: '20px 16px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <span className="muted" style={{ fontWeight: 600 }}>{isA ? 'Team score on this hole' : `${subject.name}'s score`}</span>
          <div className="stepper">
            <button type="button" className="step" aria-label="One less" onClick={() => { setHoleN(hole.n); setPickedUp(false); setValue(Math.max(1, strokes - 1)); }}>{Icon.minus()}</button>
            <span className="big-num" style={{ color: !isPickup && strokes < hole.par ? 'var(--under)' : 'var(--text)' }}>{isPickup ? 'P' : strokes}</span>
            <button type="button" className="step solid" aria-label="One more" onClick={() => { setHoleN(hole.n); setPickedUp(false); setValue(Math.min(20, strokes + 1)); }}>{Icon.plus()}</button>
          </div>
          <span style={{ fontWeight: 700, color: !isPickup && strokes < hole.par ? 'var(--under)' : 'var(--muted)' }}>
            {isPickup ? 'Picked up — 0 points' : `${scoreWord(strokes, hole.par)}${recv ? ` · net ${scoreWord(net, hole.par).toLowerCase()}` : ''}${!isA ? ` · ${stablefordPoints(hole, strokes, subject.hcp)} pts` : ''}`}
          </span>
          {!isA && (
            <button type="button" className="chip" aria-pressed={!!isPickup} onClick={() => { setHoleN(hole.n); setPickedUp(!isPickup); }}>Picked up</button>
          )}
        </div>
      </div>

      <div className="section stack">
        <span className="label">Moment (optional — goes to the feed)</span>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {MOMENTS.map((m) => (
            <button key={m} type="button" className="chip" aria-pressed={moment === m} onClick={() => setMoment(moment === m ? null : m)}>{m}</button>
          ))}
        </div>
        <PhotoButtons onPick={setPhoto} picked={!!photo} cameraLabel={photo ? 'Retake' : 'Photo for feed'} libraryLabel="Choose photo" />
      </div>

      <div className="section" style={{ paddingBottom: 28 }}>
        {editor && <p className="note" style={{ textAlign: 'center', margin: '0 0 10px' }}>Last edited by {playerName(editor)}</p>}
        <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 10 }}>
          <button type="button" className="btn ghost" aria-label="Previous hole" onClick={() => setHoleN(hole.n > 1 ? hole.n - 1 : holes.length)}>{Icon.back(22)}</button>
          <button type="button" className="btn gold" disabled={busy || locked} onClick={save} style={{ minHeight: 58, fontSize: 18 }}>
            {busy ? 'Saving…' : existing ? 'Update & next hole' : 'Save & next hole'}
          </button>
        </div>
      </div>
    </div>
  );
}
