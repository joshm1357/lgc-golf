import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useData, useScores, useSession, useSideEntries, playerName } from '../lib/store.jsx';
import { roundBoard, stablefordTrophyBoard, compBonuses } from '../lib/board.js';
import { formatToPar } from '../lib/scoring.js';
import { Seg, Avatar, AvatarStack, Icon, Sheet, toast } from '../components/ui.jsx';
import { TrophyArt } from '../components/TrophyArt.jsx';
import { honourOrder } from '../lib/history.js';
import { StatsLink } from '../components/PlayerStats.jsx';

/** The Trophy Room: every trophy in its own lit display case, live standings, and brass plaques. */
export default function Trophies() {
  const data = useData();
  const { status } = useSession();
  const nav = useNavigate();
  const trip = data.currentTrip;
  const trophies = useMemo(() => {
    const list = trip ? data.trophies.filter((t) => t.trip_id === trip.id) : [];
    // Also show trophies that only exist on the honour board (history from before the app).
    const names = new Set(list.map((t) => t.name.toLowerCase()));
    for (const h of data.honour_board) {
      if (!names.has(h.trophy_name.toLowerCase())) {
        names.add(h.trophy_name.toLowerCase());
        list.push({ id: `hb-${h.trophy_name}`, name: h.trophy_name, type: 'manual', description: null, historyOnly: true });
      }
    }
    const order = { stableford_total: 0, ambrose: 1, manual: 2 };
    return list.sort((a, b) => order[a.type] - order[b.type]);
  }, [trip, data.trophies, data.honour_board]);

  const [sel, setSel] = useState(null);
  const [mode, setMode] = useState('live');
  const [awarding, setAwarding] = useState(false);
  const trophy = trophies.find((t) => t.id === sel) || trophies[0];
  const tripRounds = trip ? data.rounds.filter((r) => r.trip_id === trip.id) : [];
  const scores = useScores(tripRounds.map((r) => r.id));

  const sBoard = useMemo(() => (trip ? stablefordTrophyBoard({
    trip, rounds: data.rounds, coursesById: data.coursesById, roundPlayers: data.roundPlayers,
    playersById: data.playersById, scoresIdx: scores.index, quickResults: data.quick_results,
  }) : null), [trip, data, scores.index]);
  const aRound = [...tripRounds].reverse().find((r) => r.format === 'ambrose');
  const aSide = useSideEntries(aRound?.id);
  const aBoard = useMemo(() => (aRound ? roundBoard({
    round: aRound, course: data.coursesById[aRound.course_id], teams: data.teamsByRound[aRound.id] || [],
    playersById: data.playersById, scoresIdx: scores.index,
    bonuses: compBonuses(aRound, data.teamsByRound[aRound.id] || [], aSide),
  }) : null), [aRound, data, scores.index, aSide]);

  const plaquesFor = (name) => honourOrder(data.honour_board.filter((h) => h.trophy_name.toLowerCase() === name.toLowerCase()));
  const leaderLine = (t) => {
    if (t.type === 'stableford_total' && sBoard?.rows[0]?.total > 0) return `${sBoard.rows[0].name} leads · ${sBoard.rows[0].total} pts`;
    if (t.type === 'ambrose' && aBoard?.rows[0]?.thru > 0) return `${aBoard.rows[0].name} lead · ${formatToPar(aBoard.rows[0].netToPar)}`;
    if (t.type === 'ambrose' && aRound) return `${aRound.status === 'setup' ? 'Tees off' : 'Live'} ${aRound.play_date ? new Date(aRound.play_date).toLocaleDateString('en-AU', { weekday: 'long' }) : ''}`;
    return null;
  };

  const projected = mode === 'proj' && sBoard?.projection;
  const sRows = projected ? sBoard.projection : sBoard?.rows || [];
  const plaques = trophy ? plaquesFor(trophy.name) : [];
  const counts = {};
  for (const h of plaques) counts[h.winner_names] = (counts[h.winner_names] || 0) + 1;

  return (
    <div className="room page">
      <header className="hdr">
        <div className="hdr-row"><button type="button" className="back" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/'))}>{Icon.back()}<span>Back</span></button></div>
        <div className="hdr-title">The Trophy Room</div>
        <div className="hdr-sub">{status?.look?.short_name || status?.group_name}{trip ? ` · ${trip.name}` : ''}</div>
      </header>

      {!trophies.length && <div className="empty" style={{ color: '#C9B48A' }}>The cabinet's empty. {status.is_admin && <><Link to="/admin" style={{ color: '#EBD496' }}>Add trophies in Admin</Link>, or <Link to="/history" style={{ color: '#EBD496' }}>add past winners from before the app</Link>.</>}</div>}

      <div className="cabinet" role="group" aria-label="Trophies">
        {trophies.map((t) => {
          const holder = plaquesFor(t.name)[0];
          const lead = leaderLine(t);
          return (
            <button key={t.id} type="button" className="case" aria-pressed={t.id === trophy?.id} onClick={() => setSel(t.id)}>
              <TrophyArt name={t.name} type={t.type} size={104} />
              <div className="plate"><div className="t">{t.name}</div>{holder && <div className="s">HELD BY {holder.winner_names.toUpperCase()}</div>}</div>
              {lead && <div className="small" style={{ color: '#EBD496', fontWeight: 600 }}>{lead}</div>}
            </button>
          );
        })}
      </div>

      <div style={{ padding: '10px 16px 0', textAlign: 'center' }}><StatsLink /></div>
      {trophy && (
        <div className="section stack" style={{ paddingTop: 14 }}>
          <div className="row between">
            <div>
              <div style={{ fontFamily: "'Pirata One', serif", fontSize: 30, color: '#EBD496', lineHeight: 1 }}>{trophy.name}</div>
              <div className="small muted">{trophy.description || (trophy.type === 'manual' ? 'Awarded by the group' : '')}</div>
            </div>
            {status.is_admin && !trophy.historyOnly && (
              <button type="button" className="btn gold sm" onClick={() => setAwarding(true)}>{Icon.trophy(16)}<span>Engrave winner</span></button>
            )}
          </div>

          {trophy.type === 'stableford_total' && sBoard && (
            <>
              {sBoard.projection && <Seg value={mode} onChange={setMode} options={[{ value: 'live', label: 'Live' }, { value: 'proj', label: 'Projected' }]} />}
              {!sBoard.rounds.length ? <div className="card pad">No Stableford rounds yet.</div> : (
                <div className="card" style={{ overflow: 'hidden' }}>
                  <div className="lb-row" style={{ gridTemplateColumns: `30px minmax(0,1fr) ${sBoard.rounds.map(() => '34px').join(' ')} 50px`, fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>
                    <span>#</span><span>Player</span>
                    {sBoard.rounds.map((r, i) => <span key={r.id} style={{ textAlign: 'center' }} title={r.name}>R{i + 1}</span>)}
                    <span style={{ textAlign: 'right' }}>{projected ? 'Proj.' : 'Total'}</span>
                  </div>
                  {sRows.map((r, i) => (
                    <Link key={r.id} to={`/player/${r.id}`} className={'lb-row' + (i === 0 ? ' lead' : '')} style={{ gridTemplateColumns: `30px minmax(0,1fr) ${sBoard.rounds.map(() => '34px').join(' ')} 50px`, color: 'inherit', textDecoration: 'none' }}>
                      <span className="lb-rank">{projected ? i + 1 : r.rankLabel}</span>
                      <span className="row" style={{ gap: 8, minWidth: 0 }}><Avatar player={r.players[0]} size={28} /><span className="lb-name ellipsis" style={{ fontSize: 16 }}>{r.name}</span></span>
                      {sBoard.rounds.map((rd) => <span key={rd.id} style={{ textAlign: 'center', fontWeight: 600 }}>{r.byRound[rd.id] ?? '–'}</span>)}
                      <span className={'lb-main' + (projected ? ' proj' : '')}>
                        {projected ? r.proj?.projected.toFixed(1) : r.total}
                        {projected && <div style={{ fontStyle: 'normal', fontFamily: 'var(--body)', fontSize: 12 }}>{r.proj?.winPct}%</div>}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
              <p className="note" style={{ margin: 0 }}>Raw Stableford points added across every Stableford round.{sBoard.rounds.map((r, i) => ` R${i + 1} = ${r.name}.`).join('')} Ties: more points in the last round, then countback.</p>
            </>
          )}

          {trophy.type === 'ambrose' && (aBoard ? (
            <>
              <div className="card" style={{ overflow: 'hidden' }}>
                {aBoard.rows.map((r, i) => (
                  <div key={r.id} className={'lb-row' + (i === 0 && r.thru ? ' lead' : '')} style={{ gridTemplateColumns: '34px minmax(0,1fr) 60px' }}>
                    <span className="lb-rank">{r.thru ? r.rankLabel : '–'}</span>
                    <span className="stack" style={{ gap: 4 }}><span className="lb-name">{r.name}</span><AvatarStack players={r.players} /></span>
                    <span className={'lb-main' + (r.netToPar < 0 && r.thru ? ' under' : '')}>{r.thru ? formatToPar(r.netToPar, r.finished && r.netToPar % 1 ? 1 : 0) : '–'}</span>
                  </div>
                ))}
                {!aBoard.rows.length && <div className="pad muted">Teams not picked yet.</div>}
              </div>
              <p className="note" style={{ margin: 0 }}>{trophy.name}: winning team of {aRound.name}. <Link to={`/?r=${aRound.id}`} style={{ color: '#EBD496' }}>Open the live leaderboard</Link>.</p>
            </>
          ) : <div className="card pad">No Ambrose round set up yet.</div>)}

          {trophy.type === 'manual' && !plaques.length && (
            <div className="card pad">No winners engraved yet.{status.is_admin && !trophy.historyOnly ? ' Tap “Engrave winner” when it’s decided.' : ''}</div>
          )}

          {plaques.length > 0 && (
            <>
              <span className="label" style={{ marginTop: 6 }}>Honour board</span>
              <div className="plaques">
                {plaques.map((h, i) => (
                  <div key={h.id} className={'plaque' + (i === 0 ? ' holder' : '')}>
                    <span className="yr">{i === 0 ? `HOLDER · ${h.label}` : h.label}</span>
                    <span className="nm">{h.winner_names}{i === 0 && counts[h.winner_names] > 1 ? ` ×${counts[h.winner_names]}` : ''}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          {status.is_admin && <Link to="/history" className="small" style={{ color: '#EBD496', fontWeight: 700, marginTop: 4 }}>+ Add past winners from before the app</Link>}
        </div>
      )}

      {awarding && trophy && (
        <Engrave trophy={trophy} trip={trip}
          suggested={trophy.type === 'stableford_total' ? sBoard?.rows[0]?.players.map((p) => p.id) : trophy.type === 'ambrose' ? aBoard?.rows[0]?.players.map((p) => p.id) : []}
          onClose={() => setAwarding(false)} />
      )}
    </div>
  );
}

function Engrave({ trophy, trip, suggested = [], onClose }) {
  const data = useData();
  const me = useSession().status.player_id;
  const [ids, setIds] = useState(suggested.filter(Boolean));
  const [label, setLabel] = useState(trip?.name || String(new Date().getFullYear()));
  const [busy, setBusy] = useState(false);
  const players = data.players.filter((p) => p.approved !== false).sort((a, b) => a.name.localeCompare(b.name));
  const toggle = (id) => setIds(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  return (
    <Sheet title={`Engrave the ${trophy.name}`} onClose={onClose}>
      <div className="stack">
        <span className="small muted">Pick the winner{trophy.type === 'ambrose' ? 's (the whole team)' : ''}. It goes on the honour board for good.</span>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {players.map((p) => <button key={p.id} type="button" className="chip" aria-pressed={ids.includes(p.id)} onClick={() => toggle(p.id)}>{playerName(p)}</button>)}
        </div>
        <label className="field"><span>Engraving (year or trip)</span><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        <button type="button" className="btn gold block" disabled={busy || !ids.length || !label.trim()} onClick={async () => {
          setBusy(true);
          const names = ids.map((id) => data.playersById[id]?.name).filter(Boolean).join(' & ');
          const max = Math.max(0, ...data.honour_board.map((h) => h.sort_key));
          const row = { trophy_name: trophy.name, label: label.trim(), winner_names: names, player_ids: ids, sort_key: max + 10 };
          // Linked to the trip it was won on (an older database has no trip link: save without it).
          let { error } = await supabase.from('honour_board').insert(trip ? { ...row, trip_id: trip.id } : row);
          if (error && trip && /trip_id/.test(error.message || '')) ({ error } = await supabase.from('honour_board').insert(row));
          if (error) toast(friendlyError(error));
          else {
            await supabase.from('posts').insert({ kind: 'user', player_id: me, trip_id: trip?.id || null, body: `🏆 ${names} — engraved on the ${trophy.name} (${label.trim()})` });
            toast(`${names} engraved on the ${trophy.name}`);
            data.reload();
            onClose();
          }
          setBusy(false);
        }}>{busy ? 'Engraving…' : 'Engrave it'}</button>
      </div>
    </Sheet>
  );
}
