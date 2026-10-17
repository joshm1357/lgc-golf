import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData, useScores, useSession } from '../lib/store.jsx';
import { roundBoard, stablefordTrophyBoard } from '../lib/board.js';
import { formatToPar } from '../lib/scoring.js';
import { Header, Seg, Avatar, AvatarStack, Icon } from '../components/ui.jsx';

export default function Trophies() {
  const data = useData();
  const { status } = useSession();
  const trip = data.currentTrip;
  const trophies = trip ? data.trophies.filter((t) => t.trip_id === trip.id) : [];
  const [sel, setSel] = useState(null);
  const [mode, setMode] = useState('live');
  const trophy = trophies.find((t) => t.id === sel) || trophies[0];
  const tripRounds = trip ? data.rounds.filter((r) => r.trip_id === trip.id) : [];
  const scores = useScores(tripRounds.map((r) => r.id));

  const sBoard = useMemo(() => {
    if (!trip || trophy?.type !== 'stableford_total') return null;
    return stablefordTrophyBoard({
      trip, rounds: data.rounds, coursesById: data.coursesById, roundPlayers: data.roundPlayers,
      playersById: data.playersById, scoresIdx: scores.index, quickResults: data.quick_results,
    });
  }, [trip, trophy, data, scores.index]);

  const aRound = trophy?.type === 'ambrose' ? [...tripRounds].reverse().find((r) => r.format === 'ambrose') : null;
  const aBoard = useMemo(() => {
    if (!aRound) return null;
    return roundBoard({ round: aRound, course: data.coursesById[aRound.course_id], teams: data.teamsByRound[aRound.id] || [], playersById: data.playersById, scoresIdx: scores.index });
  }, [aRound, data, scores.index]);

  const projected = mode === 'proj' && sBoard?.projection;
  const sRows = projected ? sBoard.projection : sBoard?.rows || [];

  return (
    <div className="page">
      <Header back title="Trophies" sub={trip?.name}>
        {trophies.length > 1 && (
          <Seg value={trophy?.id} onChange={setSel} options={trophies.map((t) => ({ value: t.id, label: t.name }))} />
        )}
      </Header>

      {!trophies.length && (
        <div className="empty">
          No trophies set up for this trip yet.{status.is_admin && <> Add them in <Link to="/admin">Admin → 5. Trophies</Link> (e.g. "BD" as Stableford total, and the Ambrose trophy).</>}
        </div>
      )}

      {trophy?.type === 'stableford_total' && sBoard && (
        <>
          <div className="row between" style={{ padding: '12px 20px 6px' }}>
            <span className="small muted">{trophy.name} · total Stableford points, all rounds</span>
            {sBoard.projection && (
              <div style={{ width: 170 }}><Seg light value={mode} onChange={setMode} options={[{ value: 'live', label: 'Live' }, { value: 'proj', label: 'Projected' }]} /></div>
            )}
          </div>
          {!sBoard.rounds.length ? (
            <div className="empty">No Stableford rounds in this trip yet.</div>
          ) : (
            <div className="card lb">
              <div className="lb-row" style={{ gridTemplateColumns: `30px minmax(0,1fr) ${sBoard.rounds.map(() => '36px').join(' ')} 52px`, fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>
                <span>#</span><span>Player</span>
                {sBoard.rounds.map((r, i) => <span key={r.id} style={{ textAlign: 'center' }} title={r.name}>R{i + 1}</span>)}
                <span style={{ textAlign: 'right' }}>{projected ? 'Proj.' : 'Total'}</span>
              </div>
              {sRows.map((r, i) => (
                <Link key={r.id} to={`/player/${r.id}`} className={'lb-row' + (i === 0 ? ' lead' : '')} style={{ gridTemplateColumns: `30px minmax(0,1fr) ${sBoard.rounds.map(() => '36px').join(' ')} 52px`, color: 'inherit', textDecoration: 'none' }}>
                  <span className="lb-rank">{projected ? i + 1 : r.rankLabel}</span>
                  <span className="row" style={{ gap: 8, minWidth: 0 }}>
                    <Avatar player={r.players[0]} size={30} />
                    <span className="lb-name ellipsis" style={{ fontSize: 16 }}>{r.name}</span>
                  </span>
                  {sBoard.rounds.map((rd) => <span key={rd.id} style={{ textAlign: 'center', fontWeight: 600 }}>{r.byRound[rd.id] ?? '–'}</span>)}
                  <span className={'lb-main' + (projected ? ' proj' : '')}>
                    {projected ? r.proj?.projected.toFixed(1) : r.total}
                    {projected && <div className="small" style={{ fontStyle: 'normal', fontFamily: 'var(--body)', fontSize: 12 }}>{r.proj?.winPct}%</div>}
                  </span>
                </Link>
              ))}
            </div>
          )}
          <p className="note">Raw Stableford points added up across every Stableford round this trip. Ties go to whoever scored more in the last round, then countback.{sBoard.rounds.map((r, i) => ` R${i + 1} = ${r.name}.`).join('')}</p>
        </>
      )}

      {trophy?.type === 'ambrose' && (
        aBoard ? (
          <>
            {aRound.status === 'locked' && aBoard.rows[0] && (
              <div className="winner">
                <span style={{ color: 'var(--gold)' }}>{Icon.trophy(40)}</span>
                <div className="grow">
                  <div className="label">{trophy.name}</div>
                  <div className="t">{aBoard.rows[0].name}</div>
                  <div className="hdr-sub">{formatToPar(aBoard.rows[0].netToPar, 1)} net</div>
                </div>
                <AvatarStack players={aBoard.rows[0].players} size={30} />
              </div>
            )}
            <div className="section"><div className="card">
              {aBoard.rows.map((r, i) => (
                <div key={r.id} className={'lb-row' + (i === 0 ? ' lead' : '')} style={{ gridTemplateColumns: '34px minmax(0,1fr) 60px' }}>
                  <span className="lb-rank">{r.rankLabel}</span>
                  <span className="stack" style={{ gap: 4 }}><span className="lb-name">{r.name}</span><AvatarStack players={r.players} /></span>
                  <span className={'lb-main' + (r.netToPar < 0 && r.thru ? ' under' : '')}>{r.thru ? formatToPar(r.netToPar, r.finished && r.netToPar % 1 ? 1 : 0) : '–'}</span>
                </div>
              ))}
            </div></div>
            <p className="note">{trophy.name}: winning team of {aRound.name}. <Link to={`/?r=${aRound.id}`}>Open the full leaderboard</Link>.</p>
          </>
        ) : <div className="empty">No Ambrose round in this trip yet.</div>
      )}

      <HonourBoard />
    </div>
  );
}

export function HonourBoard() {
  const data = useData();
  const groups = {};
  for (const h of data.honour_board) (groups[h.trophy_name] ||= []).push(h);
  const names = Object.keys(groups);
  if (!names.length) return null;
  return (
    <div className="section stack" style={{ paddingBottom: 16 }}>
      {names.map((n) => {
        const list = [...groups[n]].sort((a, b) => b.sort_key - a.sort_key);
        const [holder, ...rest] = list;
        const counts = {};
        for (const h of list) counts[h.winner_names] = (counts[h.winner_names] || 0) + 1;
        return (
          <div key={n} className="stack" style={{ gap: 8 }}>
            <span className="label">{n} honour board</span>
            <div className="honour">
              <div className="cell holder row between">
                <span className="stack" style={{ gap: 0 }}>
                  <span className="yr">HOLDER · {holder.label}</span>
                  <span className="num" style={{ fontSize: 24, lineHeight: 1.1 }}>{holder.winner_names}{counts[holder.winner_names] > 1 ? ` ×${counts[holder.winner_names]}` : ''}</span>
                </span>
                {Icon.trophy(26)}
              </div>
              {rest.map((h) => (
                <div key={h.id} className="cell">
                  <span className="yr">{h.label}</span>
                  <span style={{ fontWeight: 600 }}>{h.winner_names}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
