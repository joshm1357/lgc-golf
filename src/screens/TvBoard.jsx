import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { roundBoard, isNetFormat } from '../lib/board.js';
import { formatToPar } from '../lib/scoring.js';
import { GolfTripCrest } from '../components/Logo.jsx';
import { countScan } from '../lib/quick.js';

// Stage 8b: the clubhouse TV (#/tv/<course>). Read-only and big: today's leaderboards for groups that switched the
// Clubhouse TV on and opted in for that round. First names or nicknames only, no photos. Refreshes every 30 seconds
// and moves through the rounds every 15.

/** Turn the TV feed into what roundBoard expects. Teams are named by their players' first names. */
export function boardFor(r) {
  const playersById = Object.fromEntries((r.players || []).map((p) => [p.id, p]));
  const teams = (r.teams || []).map((t) => {
    const players = (t.player_ids || []).map((id) => playersById[id]).filter(Boolean);
    return { id: t.id, handicap: Number(t.handicap) || 0, players, name: players.map((p) => p.name).join(' & ') || 'Team' };
  });
  const idx = { [r.id]: {} };
  for (const s of r.scores || []) ((idx[r.id][s.subject_id] ||= {})[s.hole] = s);
  return roundBoard({ round: r, course: { holes: r.holes || [] }, teams, roundPlayers: r.round_players || [], playersById, scoresIdx: idx });
}

const FORMATS = { stableford: 'Stableford', ambrose: 'Ambrose', stroke: 'Stroke play' };

export default function TvBoard() {
  const { slug } = useParams();
  const loc = useLocation();
  const [feed, setFeed] = useState(undefined);
  const [i, setI] = useState(0);
  const key = new URLSearchParams(loc.search).get('k') || '';
  useEffect(() => {
    let live = true;
    const load = () => supabase.rpc('tv_board', { p_slug: slug, p_key: key }).then(({ data }) => live && setFeed(data || null), () => {});
    load();
    const t = setInterval(load, 30000);
    return () => { live = false; clearInterval(t); };
  }, [slug, key]);
  // Count the TV once (a club's code), like any other scan.
  useEffect(() => {
    const q = new URLSearchParams(loc.search);
    if (q.get('ref')) countScan(supabase, { ref: q.get('ref'), placement: 'tv', slug }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const rounds = feed?.rounds || [];
  useEffect(() => {
    if (rounds.length < 2) return undefined;
    const t = setInterval(() => setI((x) => (x + 1) % rounds.length), 15000);
    return () => clearInterval(t);
  }, [rounds.length]);
  const r = rounds[i % Math.max(1, rounds.length)];
  const board = useMemo(() => (r ? boardFor(r) : null), [r]);
  return (
    <div style={{ minHeight: '100vh', background: '#0E1F17', color: '#fff', padding: '3vh 4vw', fontFamily: 'Barlow, system-ui, sans-serif' }}>
      <div className="row between" style={{ gap: 16 }}>
        <div className="row" style={{ gap: 16 }}>
          <GolfTripCrest size={72} />
          <div>
            <div style={{ fontSize: 'clamp(24px, 4vw, 56px)', fontWeight: 700, lineHeight: 1 }}>{feed?.course || 'Clubhouse leaderboard'}</div>
            <div style={{ fontSize: 'clamp(14px, 2vw, 26px)', opacity: 0.75 }}>{r ? `Group ${(i % rounds.length) + 1} · ${FORMATS[r.format] || 'Live scores'}${r.status === 'locked' ? ' · final' : ''}` : 'Live scores from groups playing today'}</div>
          </div>
        </div>
        {rounds.length > 1 && <div style={{ fontSize: 'clamp(14px, 1.6vw, 22px)', opacity: 0.7 }}>{(i % rounds.length) + 1} of {rounds.length}</div>}
      </div>
      {feed === undefined && <div style={{ marginTop: '10vh', fontSize: 28, opacity: 0.7 }}>Loading…</div>}
      {feed === null && <div style={{ marginTop: '10vh', fontSize: 28, lineHeight: 1.3 }}>This TV link isn’t right.<br /><span style={{ opacity: 0.7 }}>Use the TV link from your club’s QR kit (Club screen → Your QR kit).</span></div>}
      {feed && !rounds.length && (
        <div style={{ marginTop: '10vh', fontSize: 'clamp(20px, 3vw, 40px)', lineHeight: 1.3 }}>
          No groups on the TV yet today.<br /><span style={{ opacity: 0.7 }}>Playing here? Scan the code on your cart — and tick “Show on the clubhouse TV”.</span>
        </div>
      )}
      {board && (
        <table style={{ width: '100%', marginTop: '3vh', borderCollapse: 'collapse', fontSize: 'clamp(18px, 3vw, 44px)' }}>
          <thead><tr style={{ opacity: 0.6, textAlign: 'left', fontSize: '0.55em', letterSpacing: '0.08em' }}><th>#</th><th>{board.format === 'ambrose' ? 'TEAM' : board.format === 'fourball' ? 'PAIR' : 'PLAYER'}</th><th>THRU</th><th style={{ textAlign: 'right' }}>{isNetFormat(board.format) ? 'NET' : 'PTS'}</th></tr></thead>
          <tbody>
            {board.rows.slice(0, 12).map((row, n) => (
              <tr key={row.id} style={{ borderTop: '1px solid rgba(255,255,255,.12)' }}>
                <td style={{ padding: '0.35em 0', width: '2.5em', opacity: 0.8 }}>{row.thru ? n + 1 : '–'}</td>
                <td style={{ fontWeight: 700 }}>{row.name}</td>
                <td style={{ opacity: 0.8 }}>{row.finished ? 'F' : row.thru || '–'}</td>
                <td style={{ textAlign: 'right', fontWeight: 800, color: '#E0B84A' }}>{!row.thru ? '–' : isNetFormat(board.format) ? formatToPar(row.netToPar) : row.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ position: 'fixed', bottom: '2vh', right: '4vw', opacity: 0.6, fontSize: 'clamp(12px, 1.4vw, 20px)' }}>Live scores by The Golf Trip · first names only</div>
    </div>
  );
}
