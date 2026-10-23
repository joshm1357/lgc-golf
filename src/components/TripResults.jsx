// The results page at the top of a finished trip (ov28, walkthrough W1, I9, I15). Josh's pick, in order:
//   the winner and trophy · a podium per round · side comps · the team / Cup verdict from the real match results ·
//   the fines tally · who tipped right · the money line (W2's "Settle up") · the best photos · trophies handed over
//   ("Mo wins the BD Trophy 2026, takes it from Bo") · and only then "Plan the next trip".
// The same results feed the awards presentation (screens/AwardsShow.jsx). Maths: lib/results.js, lib/comps.js.
//
// moneyLine: W2's src/components/MoneyLine.jsx ("Settle up") — pass it in as a node, e.g.
//   <TripResults trip={trip} moneyLine={<MoneyLine trip={trip} />} />. Nothing passed: no money line.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, friendlyError } from '../lib/supabase.js';
import { useData, useScores, useSession, useFeature, playerName } from '../lib/store.jsx';
import { roundBoard } from '../lib/board.js';
import { compStandings, sideResults } from '../lib/comps.js';
import { useTripComps, useCompData } from './CompsChip.jsx';
import { useTripFines } from './FinesTicker.jsx';
import { useTips } from './Tips.jsx';
import { AvatarStack, toast } from './ui.jsx';
import { TrophyArt } from './TrophyArt.jsx';
import { CupsResults, CupPhoto } from './CupStandings.jsx'; // ov32: the group's cups (standings, the real cup's photo)
import { shareText } from '../lib/push.js';
import { todayISO } from '../lib/plan.js';
import {
  tripFinished, tripYear, roundPodium, previousHolder, engraved, handoverLine, compWinner, finesTally, tippedRight,
  bestPhotos, resultsText,
} from '../lib/results.js';

/** The main trophy first: points over rounds, then other scored trophies, then awarded ones. */
const ORDER = { individual_points: 0, individual_net: 1, cup: 2, ambrose_teams: 3, fourball_pairs: 4, day: 5, side_comps: 6, games: 7, manual: 8 };

/** Everything the results page and the presentation show, for one finished trip. */
export function useTripResults(trip) {
  const data = useData();
  const tripId = trip?.id || null;
  const rounds = useMemo(() => (tripId ? data.rounds.filter((r) => r.trip_id === tripId) : [])
    .sort((a, b) => String(a.play_date || '').localeCompare(String(b.play_date || '')) || String(a.created_at || '').localeCompare(String(b.created_at || ''))), [data.rounds, tripId]);
  const scores = useScores(rounds.map((r) => r.id));
  const [comps] = useTripComps(tripId);
  const cd = useCompData(tripId, { scoresIdx: scores.index });
  const fines = useTripFines(tripId);
  const { tips } = useTips(tripId);
  const [extra, setExtra] = useState({ photos: [], reactions: [], mainTips: [] });
  const load = useCallback(async () => {
    if (!tripId) return;
    const q = (b) => Promise.resolve(b).then((r) => (r.error ? [] : r.data || []), () => []);
    const [photos, plans] = await Promise.all([
      q(supabase.from('posts').select('id,photo_url,body,player_id,created_at').eq('trip_id', tripId).not('photo_url', 'is', null).order('created_at', { ascending: false }).limit(30)),
      q(supabase.from('plans').select('id,status,trip_id').eq('trip_id', tripId)),
    ]);
    const plan = plans.find((p) => p.status !== 'cancelled');
    const [reactions, mainTips] = await Promise.all([
      photos.length ? q(supabase.from('reactions').select('post_id').in('post_id', photos.map((p) => p.id))) : [],
      plan ? q(supabase.from('trip_tips').select('player_id,pick_id').eq('plan_id', plan.id)) : [],
    ]);
    setExtra({ photos, reactions, mainTips });
  }, [tripId]);
  useEffect(() => { load(); }, [load]);

  return useMemo(() => {
    if (!trip) return null;
    const year = tripYear(trip, data.rounds, todayISO());
    const nameOf = (id) => playerName(data.playersById?.[id]);
    const list = comps.filter((c) => !c.retired);
    const standings = list.map((c) => { let st = null; try { st = compStandings(c, cd); } catch { st = null; } return { c, st }; });
    // Trophies: each comp with a trophy (and the awarded ones, from the honour board).
    const trophies = standings.filter(({ c }) => c.trophy_id).map(({ c, st }) => {
      const trophy = data.trophies.find((t) => t.id === c.trophy_id);
      const name = trophy?.name || c.name;
      const done = engraved({ trophyName: name, tripId: trip.id, honourBoard: data.honour_board });
      let winner = done ? { names: done.winner_names, ids: done.player_ids || [] } : c.kind === 'cup' ? null : compWinner(st);
      if (!done && c.kind === 'cup' && st?.verdict?.status === 'won') {
        const side = st.sides?.[st.verdict.winner === 'a' ? 0 : 1];
        if (side) winner = { names: side.name, ids: data.players.filter((p) => p.cup_side === side.id).map((p) => p.id), side: true };
      }
      const previous = previousHolder({ trophyName: name, tripId: trip.id, honourBoard: data.honour_board });
      return {
        comp: c, st, trophy, name, winner, engraved: !!done, previous,
        line: winner ? handoverLine({ trophyName: name, year, winner: winner.names, winnerIds: winner.ids, previous }) : null,
      };
    }).sort((a, b) => (ORDER[a.comp.kind] ?? 9) - (ORDER[b.comp.kind] ?? 9));
    // Winners already on the honour board for this trip with no comp or trophy here (history, an engraved one-off).
    const have = new Set(trophies.map((t) => t.name.toLowerCase()));
    for (const h of (data.honour_board || []).filter((x) => x.trip_id === trip.id && !have.has(String(x.trophy_name).toLowerCase()))) {
      have.add(String(h.trophy_name).toLowerCase());
      const winner = { names: h.winner_names, ids: h.player_ids || [] };
      const previous = previousHolder({ trophyName: h.trophy_name, tripId: trip.id, honourBoard: data.honour_board });
      trophies.push({ comp: { id: `hb-${h.id}`, kind: 'manual' }, st: null, trophy: null, name: h.trophy_name, winner, engraved: true, previous,
        line: handoverLine({ trophyName: h.trophy_name, year, winner: winner.names, winnerIds: winner.ids, previous }) });
    }
    const hero = trophies.find((t) => t.winner && t.comp.kind !== 'manual') || trophies.find((t) => t.winner) || null;
    // The Cup's verdict (real match results — never "6½ to win" on a finished trip).
    const cupSt = standings.find(({ c }) => c.kind === 'cup')?.st || null;
    const cup = cupSt?.verdict && cupSt.verdict.status !== 'none' ? { ...cupSt.verdict, sides: cupSt.sides } : null;
    // A podium per round.
    const podiums = rounds.map((r) => {
      const board = roundBoard({ round: r, course: data.coursesById[r.course_id], teams: data.teamsByRound[r.id] || [], roundPlayers: data.roundPlayers[r.id] || [],
        playersById: data.playersById, scoresIdx: scores.index, quickResults: data.quick_results });
      return { round: r, podium: roundPodium(board) };
    }).filter((p) => p.podium.length);
    // Side comps.
    const sides = sideResults(rounds, cd).filter((s) => s.winner).map((s) => ({ label: s.label, name: nameOf(s.winner), id: s.winner }));
    // Fines.
    const tally = finesTally(fines);
    // Who tipped right: the main trophy (run-up, 094), the Cup, each match and each round (097).
    const tipped = [];
    if (hero?.winner && extra.mainTips.length) {
      const r = tippedRight(extra.mainTips, hero.winner.ids);
      tipped.push({ title: `${hero.name}`, names: r.right.map(nameOf), of: r.of });
    }
    if (cup?.status === 'won' && cupSt?.sides?.length === 2) {
      const r = tippedRight(tips.filter((t) => t.target === 'cup'), cupSt.sides[cup.winner === 'a' ? 0 : 1].id);
      if (r.of) tipped.push({ title: 'The Cup', names: r.right.map(nameOf), of: r.of });
    }
    for (const { round, podium } of podiums) {
      const first = podium.filter((p) => p.place === 1).map((p) => p.id);
      const r = tippedRight(tips.filter((t) => t.target === 'round' && t.target_id === round.id), first);
      if (r.of) tipped.push({ title: round.name, names: r.right.map(nameOf), of: r.of });
    }
    const photos = bestPhotos(extra.photos, extra.reactions);
    const text = resultsText(trip.name, [
      ...trophies.filter((t) => t.line).map((t) => `🏆 ${t.line}`),
      cup ? `⚔️ ${cup.text}` : null,
      ...podiums.map((p) => `⛳ ${p.round.name}: ${p.podium.filter((x) => x.place === 1).map((x) => `${x.name} ${x.score}`).join(', ')}`),
      tally.length ? `🏷 Fines: ${tally.slice(0, 3).map((t) => `${nameOf(t.player_id)} ${t.count}`).join(' · ')}` : null,
    ]);
    return { trip, year, trophies, hero, cup, podiums, sides, tally, tipped, photos, text, awards: fines, nameOf };
  }, [trip, data, comps, cd, rounds, scores.index, fines, tips, extra]);
}

/** Organiser: put this trip's winners on the honour board (each trophy not engraved yet), and say so in the Feed. */
async function engraveAll(res, me) {
  const todo = res.trophies.filter((t) => t.winner && !t.engraved && t.winner.ids?.length);
  if (!todo.length) return 0;
  const { data: hb } = await supabase.from('honour_board').select('sort_key');
  let key = Math.max(0, ...(hb || []).map((h) => Number(h.sort_key) || 0));
  for (const t of todo) {
    key += 10;
    const row = { trophy_name: t.name, label: res.year, winner_names: t.winner.names, player_ids: t.winner.ids, sort_key: key, trip_id: res.trip.id };
    const { error } = await supabase.from('honour_board').insert(row);
    if (error) throw error;
    await supabase.from('posts').insert({ kind: 'user', player_id: me, trip_id: res.trip.id, body: `🏆 ${t.line}` });
  }
  return todo.length;
}

export default function TripResults({ trip, moneyLine = null }) {
  const data = useData();
  const { status } = useSession();
  const feedOn = useFeature('feed');
  const awardsOn = useFeature('dinner_awards');
  const plannerOn = useFeature('planner');
  const trophiesOn = useFeature('trophies');
  const res = useTripResults(trip);
  const [busy, setBusy] = useState(false);
  if (!trip || !res || !tripFinished(trip, data.rounds, todayISO())) return null;
  const admin = status?.is_admin && !status?.viewing;
  const toEngrave = res.trophies.filter((t) => t.winner && !t.engraved && t.winner.ids?.length);
  const share = async () => {
    const r = await shareText(res.text, `${trip.name} — the results`);
    if (r === 'copied') toast('Copied — paste it in the group chat');
    else if (r === 'failed') toast('Couldn’t share from this phone');
  };
  return (
    <div className="stack" style={{ gap: 12 }} data-testid="trip-results">
      {/* The winner and the trophy */}
      <div className="card pad stack" style={{ gap: 8, background: 'var(--navy)', borderColor: 'var(--navy)', color: '#fff', textAlign: 'center' }} data-testid="results-hero">
        <span className="label" style={{ color: 'var(--on-navy-muted)' }}>🏁 The results · {trip.name}</span>
        {res.hero ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'center' }}><TrophyArt name={res.hero.name} type={res.hero.trophy?.type} size={84} /></div>
            <strong style={{ fontSize: 24, lineHeight: 1.2 }} data-testid="results-winner">{res.hero.winner.names}</strong>
            <span style={{ color: 'var(--on-navy-muted)' }}>{res.hero.line}{res.hero.winner.side ? '' : res.hero.st?.rows?.[0]?.text ? ` · ${res.hero.st.rows[0].text}` : ''}</span>
          </>
        ) : <strong style={{ fontSize: 20 }}>That’s a wrap</strong>}
      </div>

      {/* Trophies handed over */}
      {res.trophies.length > 0 && (
        <div className="card pad stack" style={{ gap: 6 }} data-testid="results-trophies">
          <strong>🏆 Trophies</strong>
          {res.trophies.map((t) => (
            <div key={t.comp.id} className="row between" style={{ gap: 8, alignItems: 'flex-start' }} data-testid="results-trophy">
              <span className="grow" style={{ minWidth: 0 }}>{t.line || <><span className="muted">{t.name}:</span> {t.comp.kind === 'manual' && !t.comp.settings?.cup ? 'not awarded yet' : 'no winner yet'}</>}
                {t.comp.cup_id && <CupPhoto comp={t.comp} size={44} />}</span>
              {t.winner && <span className="small muted" style={{ whiteSpace: 'nowrap' }}>{t.engraved ? '✓ Engraved' : 'To engrave'}</span>}
            </div>
          ))}
          {admin && trophiesOn && toEngrave.length > 0 && (
            <button type="button" className="btn gold sm" style={{ alignSelf: 'flex-start' }} disabled={busy} data-testid="hand-over"
              onClick={async () => {
                setBusy(true);
                try { const n = await engraveAll(res, status.player_id); toast(`${n} troph${n === 1 ? 'y' : 'ies'} handed over — the Trophy Room’s updated`); data.reload(); } catch (e) { toast(friendlyError(e)); }
                setBusy(false);
              }}>Hand over the trophies (engrave {toEngrave.length})</button>
          )}
          {trophiesOn && <Link to="/trophies" className="small" style={{ fontWeight: 700 }}>The Trophy Room →</Link>}
        </div>
      )}

      {/* ov32: the group's weekend / combined cups — who got what, with the breakdown */}
      <CupsResults trip={trip} />

      {/* The team / Cup verdict */}
      {res.cup && (
        <Link to="/cup" className="card pad stack" style={{ gap: 4, textDecoration: 'none', color: 'inherit', borderLeft: `6px solid ${res.cup.winner ? res.cup.sides?.[res.cup.winner === 'a' ? 0 : 1]?.colour || 'var(--navy)' : 'var(--line)'}` }} data-testid="results-cup">
          <span className="label">⚔️ The Cup</span>
          <strong style={{ fontSize: 20 }}>{res.cup.text}</strong>
        </Link>
      )}

      {/* A podium per round */}
      {res.podiums.length > 0 && (
        <div className="card pad stack" style={{ gap: 10 }} data-testid="results-podiums">
          <strong>⛳ Each round</strong>
          {res.podiums.map(({ round, podium }) => (
            <Link key={round.id} to={`/?r=${round.id}`} className="stack" style={{ gap: 4, textDecoration: 'none', color: 'inherit', borderTop: '1px solid var(--line-soft)', paddingTop: 8 }}>
              <span className="small muted">{round.name}</span>
              {podium.map((p) => (
                <span key={p.id} className="row" style={{ gap: 8 }}>
                  <span aria-hidden="true" style={{ width: 24, textAlign: 'center' }}>{p.place === 1 ? '🥇' : p.place === 2 ? '🥈' : '🥉'}</span>
                  <AvatarStack players={p.players} size={22} />
                  <span className="grow ellipsis" style={{ fontWeight: p.place === 1 ? 800 : 600 }}>{p.name}</span>
                  <span className="small" style={{ fontWeight: 700 }}>{p.score}</span>
                </span>
              ))}
            </Link>
          ))}
        </div>
      )}

      {/* Side comps */}
      {res.sides.length > 0 && (
        <div className="card pad stack" style={{ gap: 4 }} data-testid="results-sides">
          <strong>🎯 Side comps</strong>
          {res.sides.map((s) => <div key={s.label} className="row between small" style={{ gap: 8 }}><span className="muted">{s.label}</span><strong>{s.name}</strong></div>)}
        </div>
      )}

      {/* Fines tally */}
      {awardsOn && res.tally.length > 0 && (
        <div className="card pad stack" style={{ gap: 4 }} data-testid="results-fines">
          <strong>🏷 Fines tally</strong>
          {res.tally.slice(0, 6).map((t) => <div key={t.player_id} className="row between small" style={{ gap: 8 }}><span>{res.nameOf(t.player_id)}</span><span className="muted">{t.count} · {[...new Set(t.titles)].join(', ')}</span></div>)}
        </div>
      )}

      {/* Who tipped right */}
      {res.tipped.length > 0 && (
        <div className="card pad stack" style={{ gap: 4 }} data-testid="results-tips">
          <strong>🎯 Who tipped right</strong>
          {res.tipped.map((t) => <div key={t.title} className="small"><span className="muted">{t.title}:</span> <strong>{t.names.length ? t.names.join(', ') : 'nobody'}</strong> <span className="muted">({t.names.length} of {t.of})</span></div>)}
        </div>
      )}

      {/* W2's money line: "You owe $40 · Settle up" */}
      {moneyLine}

      {/* Best photos */}
      {feedOn && res.photos.length > 0 && (
        <div className="stack" style={{ gap: 6 }} data-testid="results-photos">
          <span className="label">📸 Best photos</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
            {res.photos.slice(0, 6).map((p) => <Link key={p.id} to={`/feed?trip=${trip.id}`}><img src={p.photo_url} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 8 }} /></Link>)}
          </div>
        </div>
      )}

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn ghost sm" onClick={share} data-testid="share-results">Share the results</button>
        {awardsOn && <Link to={`/present/awards/${trip.id}`} className="btn ghost sm" data-testid="present-awards">🎤 Present the awards</Link>}
      </div>
      {/* Only after all of that: the next trip. */}
      {plannerOn && <Link to="/plan" className="btn gold block" data-testid="plan-next">Plan the next trip</Link>}
    </div>
  );
}
