import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useData, useRealtime, useSession, useScores, playerName } from '../lib/store.jsx';
import { sendOrQueue } from '../lib/outbox.js';
import { distanceM, getFix } from '../lib/geo.js';
import { Header, Seg, Avatar, Icon, Sheet, timeAgo, toast, PhotoButtons } from '../components/ui.jsx';
import CourseMap, { avatarIcon, teeIcon } from '../components/CourseMap.jsx';
import { useRoundChoice, RoundChips } from './Leaderboard.jsx';
import { OwnComp, useRoundOwnComps } from './OwnComps.jsx';
import { ConditionsLine } from '../components/CompConditions.jsx';
import RuleTag, { roundRef, useActiveRules } from '../components/RuleTag.jsx';

const LABEL = { ctp: 'Closest to pin', ld: 'Longest drive' };

export function sortEntries(kind, list) {
  return [...list].sort((a, b) => {
    if (a.confirmed !== b.confirmed) return a.confirmed ? -1 : 1; // admin-confirmed winner always leads
    if (a.distance_m == null) return 1;
    if (b.distance_m == null) return -1;
    return kind === 'ctp' ? a.distance_m - b.distance_m : b.distance_m - a.distance_m;
  });
}

function roundPlayerIds(data, round) {
  if (!round) return [];
  if (round.format === 'ambrose' || round.format === 'fourball') return (data.teamsByRound[round.id] || []).flatMap((t) => t.players.map((p) => p.id));
  return (data.roundPlayers[round.id] || []).map((rp) => rp.player_id);
}

export default function Comps() {
  const data = useData();
  const { status } = useSession();
  const [round, choose] = useRoundChoice();
  const [params] = useSearchParams();
  const [kindSel, setKind] = useState(params.get('kind') || 'ctp');
  const own = useRoundOwnComps(round);
  const ownComp = own.find((c) => c.id === kindSel);
  // 'ctp', 'ld', or one of the group's own comps on this round (anything else falls back to closest to pin).
  const kind = ownComp ? kindSel : kindSel === 'ld' ? 'ld' : 'ctp';
  const [holeSel, setHoleSel] = useState(params.get('hole') ? Number(params.get('hole')) : null);
  const [entries, setEntries] = useState([]);
  const [adding, setAdding] = useState(false);
  const rules = useActiveRules();

  const load = useCallback(async () => {
    if (!round) return;
    const { data: rows } = await supabase.from('side_entries').select('*').eq('round_id', round.id).order('created_at');
    setEntries(rows || []);
  }, [round?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useRealtime(['side_entries'], load);

  const holes = round ? (kind === 'ctp' ? round.ctp_holes : round.ld_holes) : [];
  const hole = holes.includes(holeSel) ? holeSel : holes[0];
  const course = round ? data.coursesById[round.course_id] : null;
  const holeInfo = course?.holes.find((h) => h.n === hole);
  const list = useMemo(() => sortEntries(kind, entries.filter((e) => e.kind === kind && e.hole === hole)), [entries, kind, hole]);
  const leader = list[0];
  // The comp is decided once every team/player has a score on this hole (or the round is locked).
  const scoreIdx = useScores(round?.id);
  const subjects = !round ? [] : round.format === 'ambrose'
    ? (data.teamsByRound[round.id] || []).map((t) => t.id)
    : round.format === 'fourball'
    ? (data.teamsByRound[round.id] || []).flatMap((t) => t.players.map((p) => p.id))
    : (data.roundPlayers[round.id] || []).map((rp) => rp.player_id);
  const allThrough = subjects.length > 0 && subjects.every((id) => scoreIdx?.[round.id]?.[id]?.[hole]);
  const decided = round?.status === 'locked' || allThrough;

  if (!round) return <div className="page"><Header logo title="Side comps" /><div className="empty">No rounds yet.</div></div>;

  const segOptions = [{ value: 'ctp', label: 'Closest to pin' }, { value: 'ld', label: 'Longest drive' }, ...own.map((c) => ({ value: c.id, label: `${c.emoji ? `${c.emoji} ` : ''}${c.name}` }))];
  if (ownComp) {
    return (
      <div className="page">
        <Header logo title="Side comps" sub={round.name}>
          <div className={segOptions.length > 2 ? 'seg-many' : undefined}><Seg value={kind} onChange={(k) => { setKind(k); setHoleSel(null); }} options={segOptions} /></div>
        </Header>
        <RoundChips round={round} onChoose={choose} />
        <OwnComp key={`${round.id}-${ownComp.id}`} round={round} comp={ownComp} playerIds={roundPlayerIds(data, round)} />
      </div>
    );
  }

  const markers = [
    ...(kind === 'ld' && holeInfo?.tee ? [{ id: 'tee', ...holeInfo.tee, icon: teeIcon }] : []),
    ...list.filter((e) => e.lat != null).map((e, i) => ({
      id: e.id, lat: e.lat, lng: e.lng,
      icon: avatarIcon(data.playersById[e.player_id], { gold: i === 0, size: 32, label: e.distance_m != null ? `${Number(e.distance_m)} m` : undefined }),
      popup: <div><strong>{playerName(data.playersById[e.player_id])}</strong><br />{e.distance_m != null ? `${Number(e.distance_m)} m` : ''}{e.photo_url && <img src={e.photo_url} alt="" style={{ width: 160, display: 'block', marginTop: 6, borderRadius: 6 }} />}</div>,
    })),
  ];

  return (
    <div className="page">
      <Header logo title="Side comps" sub={round.name}>
        <div className={segOptions.length > 2 ? 'seg-many' : undefined}><Seg value={kind} onChange={(k) => { setKind(k); setHoleSel(null); }} options={segOptions} /></div>
      </Header>
      <RoundChips round={round} onChoose={choose} />
      {!holes.length ? (
        <div className="empty">
          No {LABEL[kind].toLowerCase()} holes set for this round.
          {status.is_admin && <> Set them in <Link to="/admin">Organiser tools → Rounds</Link>.</>}
        </div>
      ) : (
        <>
          <div className="chips" role="group" aria-label="Hole">
            {holes.map((n) => {
              const h = course?.holes.find((x) => x.n === n);
              return <button key={n} type="button" className="chip" aria-pressed={n === hole} onClick={() => setHoleSel(n)}>Hole {n}{h ? ` · par ${h.par}` : ''}</button>;
            })}
          </div>

          {markers.length > 0 && <CourseMap markers={markers} osm={!!holeInfo?.osm} />}

          <div className="section stack">
            <ConditionsLine comp={kind} />
            {leader ? (
              <div className="card pad row" style={{ background: 'var(--gold-soft)', borderColor: 'var(--gold)', gap: 12 }}>
                {leader.photo_url
                  ? <img src={leader.photo_url} alt="" style={{ width: 76, height: 76, borderRadius: 12, objectFit: 'cover' }} />
                  : <Avatar player={data.playersById[leader.player_id]} size={64} />}
                <div className="grow">
                  <div className="label" style={{ color: '#5A4300' }}>{leader.confirmed ? 'Winner ✓ confirmed' : decided ? 'Winner · everyone through' : 'Leader'}</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{playerName(data.playersById[leader.player_id])}</div>
                  <div className="small muted">{timeAgo(leader.created_at)}</div>
                </div>
                <span className="num" style={{ fontSize: 40, lineHeight: 1 }}>{leader.distance_m != null ? Number(leader.distance_m) : '–'}<span style={{ fontSize: 20 }}> m</span></span>
              </div>
            ) : <div className="empty">{decided ? 'Everyone has played this hole — no entries were made.' : 'No entries on this hole yet. First to enter leads!'}</div>}

            {list.length > 1 && (
              <div className="card">
                {list.slice(1).map((e, i) => (
                  <EntryRow key={e.id} e={e} rank={i + 2} me={status.player_id} isAdmin={status.is_admin} onChanged={load} list={list} />
                ))}
              </div>
            )}
            {leader && (leader.created_by === status.player_id || status.is_admin) && (
              <EntryRow e={leader} rank={1} me={status.player_id} isAdmin={status.is_admin} onChanged={load} compact list={list} />
            )}
            {kind === 'ld' && status.is_admin && <SetTee course={course} hole={hole} />}
            {round.comp_bonus > 0 && round.format === 'ambrose' && <div className="card pad small" style={{ background: 'var(--gold-soft)', borderColor: 'var(--gold)' }}><strong><RuleTag testId="worth-strokes" rule={{ ...roundRef(round, 'comp_bonus', `Worth ${round.comp_bonus} stroke${round.comp_bonus === 1 ? '' : 's'}`, rules), where: { round_id: round.id, trip_id: round.trip_id, path: `/comps?r=${round.id}&kind=${kind}` } }}
              explain={`Whoever wins a side comp (closest to the pin, longest drive) takes ${round.comp_bonus} strokes off their team's Ambrose score.`}>Worth {round.comp_bonus} stroke{round.comp_bonus === 1 ? '' : 's'}.</RuleTag></strong> Whoever leads this comp at the end takes {round.comp_bonus} off their team's score — the leaderboard updates live.</div>}
            <p className="note" style={{ margin: 0 }}>
              {kind === 'ctp'
                ? 'Distance is measured or paced and typed in — phone GPS is only good to about 5–10 m. The pin and photo are the evidence.'
                : 'Distance from the tee is approximate (GPS is good to about 5–10 m). Override it if you measured. All entries stay up so the group can argue.'}
            </p>
          </div>
          {!decided && <button type="button" className="btn gold fab" onClick={() => setAdding(true)}>Enter a shot — hole {hole}</button>}
          {decided && round.status !== 'locked' && status.is_admin && <button type="button" className="btn ghost block" onClick={() => setAdding(true)}>Add a late entry — hole {hole}</button>}
        </>
      )}
      {adding && hole && (
        <EntryForm round={round} kind={kind} hole={hole} holeInfo={holeInfo} leader={leader}
          playerIds={roundPlayerIds(data, round)} onClose={() => setAdding(false)} onSaved={load} />
      )}
    </div>
  );
}

async function setWinner(e, list, on, onChanged) {
  // Only one confirmed winner per comp hole.
  if (on) {
    const others = list.filter((x) => x.id !== e.id && x.confirmed).map((x) => x.id);
    if (others.length) await supabase.from('side_entries').update({ confirmed: false }).in('id', others);
  }
  const { error } = await supabase.from('side_entries').update({ confirmed: on }).eq('id', e.id);
  if (error) toast(friendlyError(error)); else { toast(on ? 'Winner confirmed' : 'Unconfirmed'); onChanged(); }
}

function EntryRow({ e, rank, me, isAdmin, onChanged, compact, list = [] }) {
  const data = useData();
  const p = data.playersById[e.player_id];
  const canDelete = e.created_by === me || isAdmin;
  if (compact) {
    return (
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {isAdmin && <button type="button" className="btn ghost sm" onClick={() => setWinner(e, list, !e.confirmed, onChanged)}>{e.confirmed ? 'Unconfirm winner' : '✓ Confirm as winner'}</button>}
        {canDelete && (
          <button type="button" className="btn ghost sm" onClick={async () => {
            if (!window.confirm('Remove the leading entry?')) return;
            const { error } = await supabase.from('side_entries').delete().eq('id', e.id);
            if (error) toast(friendlyError(error)); else onChanged();
          }}>Remove this entry</button>
        )}
      </div>
    );
  }
  return (
    <div className="row" style={{ padding: '10px 12px', borderBottom: '1px solid var(--line-soft)' }}>
      <span className="num" style={{ width: 20, fontSize: 20 }}>{rank}</span>
      {e.photo_url ? <img src={e.photo_url} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover' }} /> : <Avatar player={p} size={36} />}
      <span className="grow ellipsis" style={{ fontWeight: 600 }}>{playerName(p)}</span>
      <span className="num" style={{ fontSize: 22 }}>{e.distance_m != null ? `${Number(e.distance_m)} m` : '–'}</span>
      {isAdmin && <button type="button" className="btn ghost sm" onClick={() => setWinner(e, list, true, onChanged)}>Winner</button>}
      {canDelete && (
        <button type="button" className="btn ghost sm" aria-label="Remove entry" onClick={async () => {
          if (!window.confirm('Remove this entry?')) return;
          const { error } = await supabase.from('side_entries').delete().eq('id', e.id);
          if (error) toast(friendlyError(error)); else onChanged();
        }}>{Icon.x(14)}</button>
      )}
    </div>
  );
}

function SetTee({ course, hole }) {
  const data = useData();
  const h = course?.holes.find((x) => x.n === hole);
  return (
    <button type="button" className="btn ghost" onClick={async () => {
      try {
        const fix = await getFix();
        const holes = course.holes.map((x) => (x.n === hole ? { ...x, tee: { lat: fix.lat, lng: fix.lng } } : x));
        const { error } = await supabase.from('courses').update({ holes }).eq('id', course.id);
        if (error) throw error;
        toast(`Tee for hole ${hole} set (±${Math.round(fix.accuracy)} m)`);
        data.reload();
      } catch (e) { toast(e.message); }
    }}>{h?.tee ? 'Re-set' : 'Set'} tee position for hole {hole} — stand on the tee</button>
  );
}

function EntryForm({ round, kind, hole, holeInfo, leader, playerIds, onClose, onSaved }) {
  const data = useData();
  const { status } = useSession();
  const me = status.player_id;
  const [playerId, setPlayerId] = useState(playerIds.includes(me) ? me : playerIds[0] || me);
  const [dist, setDist] = useState('');
  const [distTouched, setDistTouched] = useState(false);
  const [pt, setPt] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [gpsMsg, setGpsMsg] = useState('');
  const tee = holeInfo?.tee;
  const autoLd = kind === 'ld' && tee && pt ? Math.round(distanceM(tee, pt)) : null;
  const shownDist = distTouched ? dist : autoLd != null ? String(autoLd) : dist;
  const options = [...new Set([...playerIds, me])].map((id) => data.playersById[id]).filter(Boolean);

  async function locate() {
    setGpsMsg('Getting GPS…');
    try {
      const f = await getFix();
      setPt(f);
      setGpsMsg(`Pinned (±${Math.round(f.accuracy)} m). Drag the pin to fine-tune.`);
    } catch (e) { setGpsMsg(e.message); }
  }
  useEffect(() => { locate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setBusy(true);
    try {
      const d = shownDist === '' ? null : Number(shownDist);
      const res = await sendOrQueue('side_entries', {
        round_id: round.id, hole, kind, player_id: playerId, distance_m: d, lat: pt?.lat ?? null, lng: pt?.lng ?? null,
        accuracy_m: pt?.accuracy ?? null, photo_url: null, created_by: me,
      }, { photo: file ? { file, field: 'photo_url', folder: 'comps' } : null });
      const url = res.row?.photo_url || null;
      if (!res.sent) {
        toast('No signal — entry saved on your phone, it’ll send when signal’s back');
        onClose();
        return;
      }
      // New leader? Tell the feed.
      const leads = d != null && (!leader || leader.distance_m == null || (kind === 'ctp' ? d < leader.distance_m : d > leader.distance_m));
      if (leads) {
        await sendOrQueue('posts', {
          kind: 'user', player_id: me, round_id: round.id, trip_id: round.trip_id, hole, photo_url: url,
          body: `New leader — ${LABEL[kind].toLowerCase()} on ${hole}: ${playerName(data.playersById[playerId])}, ${d} m`,
        });
      }
      toast(leads ? 'New leader!' : 'Entry saved');
      onSaved();
      onClose();
    } catch (e) { toast(friendlyError(e)); } finally { setBusy(false); }
  }

  return (
    <Sheet title={`${LABEL[kind]} · hole ${hole}`} onClose={onClose}>
      <div className="stack">
        <ConditionsLine comp={kind} />
        <label className="field"><span>Player</span>
          <select className="select" value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
            {options.map((p) => <option key={p.id} value={p.id}>{playerName(p)}{p.id === me ? ' (me)' : ''}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{kind === 'ctp' ? 'Distance from the pin (metres)' : `Drive distance (metres)${autoLd != null && !distTouched ? ' — approx from tee GPS' : ''}`}</span>
          <input className="input" inputMode="decimal" value={shownDist} onChange={(e) => { setDist(e.target.value); setDistTouched(true); }} placeholder={kind === 'ctp' ? 'e.g. 1.8' : tee ? 'Pin your ball to auto-fill' : 'e.g. 245'} style={{ fontSize: 22 }} />
        </label>
        <div className="stack" style={{ gap: 6 }}>
          <div className="row between"><span className="label">Where the ball stopped</span><button type="button" className="btn ghost sm" onClick={locate}>Use my GPS</button></div>
          {gpsMsg && <span className="small muted">{gpsMsg}</span>}
          {pt && (
            <CourseMap className="map" fit={[pt, ...(tee ? [tee] : [])]} markers={[
              ...(tee ? [{ id: 'tee', ...tee, icon: teeIcon }] : []),
              { id: 'ball', ...pt, icon: avatarIcon(data.playersById[playerId], { gold: true, size: 34 }), draggable: true, onDragEnd: (ll) => setPt({ ...pt, ...ll }) },
            ]} />
          )}
        </div>
        <span className="label">{kind === 'ctp' ? 'Photo of the ball near the pin' : 'Photo of the ball'}</span>
        <PhotoButtons onPick={setFile} picked={!!file} cameraLabel={file ? 'Retake' : 'Take a photo'} />
        <button type="button" className="btn gold block" disabled={busy || (kind === 'ctp' && shownDist === '')} onClick={save}>{busy ? 'Saving…' : 'Save entry'}</button>
      </div>
    </Sheet>
  );
}
