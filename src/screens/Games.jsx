// Games and side bets (migration 055, feature 'games'): the Games screen (live standings, the money tally and who
// pays who), the organiser's Games card on each round (Admin and the guided setup).
// 098 (ov29): who's in each game (everyone, or opt-in), and anyone (not guests) can put up a side game for an opt-in.
// The leaderboard link is components/GamesChip.jsx. All the maths is in lib/games.js.
import React, { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useScores, useSession, useFeature, playerName } from '../lib/store.jsx';
import { useRoundGames, useGamePlayers, useTeeTimes, WhosIn } from '../components/GamesChip.jsx';
import { Header, Sheet } from '../components/ui.jsx';
import { notify } from '../lib/push.js';
import { useRun, must } from '../lib/run.js';
import { formatToPar } from '../lib/scoring.js';
import {
  GAME_INFO, PRESETS, PICKUP_RULES, AMBROSE_NOTE, cleanOptions, gameLabel, gameSuits, playGame, moneyTally,
  formatMoney, toCents, gameOptions, splitOptions, STANDARD_OPTIONS, WHO_IN, isOptIn, proposableRounds, proposedRow, gameShort,
} from '../lib/games.js';
import { withCustom, roundGameFromCustom, copyFrom } from '../lib/customgames.js';
import { useCustomGames, CustomGamesCard, OptionControls, CustomGameSheet } from '../components/CustomGames.jsx';
import { RulesLink } from '../components/RulesLinks.jsx';
import RuleTag from '../components/RuleTag.jsx';
import GameHelp from '../components/GameHelp.jsx';

const byId = (list) => Object.fromEntries(list.map((c) => [c.id, c]));

/** Everything playGame needs for one round. */
function gameCtx(data, round, scoresIdx, optIns = []) {
  const tripRounds = data.rounds.filter((r) => (round.trip_id ? r.trip_id === round.trip_id : r.id === round.id));
  return {
    round, course: data.coursesById[round.course_id], teams: data.teamsByRound[round.id] || [],
    roundPlayers: data.roundPlayers[round.id] || [], playersById: data.playersById, scoresIdx, quickResults: data.quick_results || [],
    tripRounds, teamsByRound: data.teamsByRound, roundPlayersByRound: data.roundPlayers, coursesById: data.coursesById, optIns,
  };
}

// ------------------------------------------------------------------ the Games screen
export default function Games() {
  const data = useData();
  const [params, setParams] = useSearchParams();
  const [rawGames, reloadGames] = useRoundGames();
  const [customs] = useCustomGames();
  const games = useMemo(() => rawGames.map((g) => withCustom(g, byId(customs))), [rawGames, customs]);
  const [view, setView] = useState('round');
  const withGames = data.rounds.filter((r) => games.some((g) => g.round_id === r.id));
  const asked = data.rounds.find((r) => r.id === params.get('r'));
  const round = asked || (withGames.find((r) => r.id === data.defaultRound?.id)) || withGames[withGames.length - 1] || null;
  const tripRounds = useMemo(() => (round ? data.rounds.filter((r) => (round.trip_id ? r.trip_id === round.trip_id : r.id === round.id)) : []), [round, data.rounds]);
  const scores = useScores(tripRounds.map((r) => r.id));
  const [optIns, reloadOptIns] = useGamePlayers();
  const tees = useTeeTimes(tripRounds.map((r) => r.id));
  const [proposing, setProposing] = useState(false);
  const { status } = useSession();
  const canPropose = !!status.player_id && status.role !== 'guest' && !status.viewing;

  const played = useMemo(() => {
    if (!round) return [];
    return games.filter((g) => g.round_id === round.id).map((g) => playGame(g, gameCtx(data, round, scores.index, optIns)));
  }, [games, round, data, scores.index, optIns]);
  const tripPlayed = useMemo(() => {
    const out = [];
    for (const r of tripRounds) for (const g of games.filter((x) => x.round_id === r.id)) out.push(playGame(g, gameCtx(data, r, scores.index, optIns)));
    return out;
  }, [games, tripRounds, data, scores.index, optIns]);

  const roundTally = useMemo(() => moneyTally(played.filter((p) => p.kind !== 'eclectic')), [played]);
  const tripTally = useMemo(() => moneyTally(tripPlayed), [tripPlayed]);
  const trip = data.trips.find((t) => t.id === round?.trip_id);
  const tripRoundChips = withGames.filter((r) => !round || r.trip_id === round.trip_id);

  return (
    <div className="page">
      <Header back title="Games & side bets" sub={round ? `${round.name}` : 'Skins, Nassau, pots and the money'} />
      {tripRoundChips.length > 1 && (
        <div className="chips" role="group" aria-label="Round">
          {tripRoundChips.map((r) => (
            <button key={r.id} type="button" className="chip" aria-pressed={r.id === round?.id} onClick={() => setParams({ r: r.id }, { replace: true })}>{r.name}</button>
          ))}
        </div>
      )}
      {canPropose && (
        <div className="section">
          <button type="button" className="btn gold block" data-testid="propose-game" onClick={() => setProposing(true)}>🎲 Put up a side game</button>
        </div>
      )}
      {proposing && <ProposeGameSheet onClose={() => setProposing(false)} onDone={async (r) => { await Promise.all([reloadGames(), reloadOptIns()]); setParams({ r }, { replace: true }); }} />}
      {!round || !played.length ? (
        <div className="empty">
          No games on {round ? 'this round' : 'any round'} yet.
          <div className="small" style={{ marginTop: 6 }}>An organiser adds them in Admin → Rounds (or Set up your trip → Extras): one tap for skins, Nassau, a Stableford pot, a birdie pool or an eclectic. Anyone can put one up for the others to opt in to.</div>
          <div className="section" style={{ textAlign: 'left' }}><CustomGamesCard /></div>
        </div>
      ) : (
        <div className="section stack">
          {played.map((p) => <GameCard key={p.game.id} played={p} round={round} optIns={optIns} teeGroups={tees} reload={async () => { await Promise.all([reloadGames(), reloadOptIns()]); }} />)}
          <div className="card pad stack" style={{ gap: 8 }}>
            <div className="row between" style={{ gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 18 }}>💵 The money</strong>
              <div className="seg" role="group" aria-label="Money for">
                <button type="button" aria-pressed={view === 'round'} onClick={() => setView('round')}>This round</button>
                <button type="button" aria-pressed={view === 'trip'} onClick={() => setView('trip')}>{trip ? 'The trip' : 'All'}</button>
              </div>
            </div>
            <Tally tally={view === 'round' ? roundTally : tripTally} hasEclectic={view === 'round' && played.some((p) => p.kind === 'eclectic')} />
          </div>
          {round.format === 'ambrose' && <p className="note" style={{ margin: 0 }}>{AMBROSE_NOTE}</p>}
          <p className="note" style={{ margin: 0 }}><strong>Pick-ups:</strong> {PICKUP_RULES}</p>
          <CustomGamesCard />
        </div>
      )}
    </div>
  );
}

function useNames() {
  const data = useData();
  return useCallback((id, subjects = []) => {
    const s = subjects.find((x) => x.id === id);
    if (s?.team) return s.name;
    return playerName(data.playersById[id]) || s?.name || '?';
  }, [data.playersById]);
}

function Tally({ tally, hasEclectic }) {
  const name = useNames();
  if (!tally.rows.length) {
    return <div className="small muted">Nothing won or lost yet. Money shows here as each game is decided{tally.undecided ? ` (${tally.undecided} still going)` : ''}.</div>;
  }
  return (
    <>
      <div>
        {tally.rows.map((r) => (
          <div key={r.id} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--line-soft)' }} data-testid="tally-row">
            <span>{name(r.id)}</span>
            <strong className="num" style={{ fontSize: 20, color: r.cents > 0 ? 'var(--up)' : r.cents < 0 ? 'var(--down)' : 'inherit' }}>{formatMoney(r.cents, { signed: true })}</strong>
          </div>
        ))}
      </div>
      {tally.settle.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">Who pays who</span>
          {tally.settle.map((s, i) => (
            <div key={i} className="row" style={{ gap: 6 }} data-testid="settle-row">
              <span>{name(s.from)}</span><span className="muted">pays</span><span>{name(s.to)}</span>
              <strong className="num" style={{ marginLeft: 'auto', fontSize: 18 }}>{formatMoney(s.cents)}</strong>
            </div>
          ))}
        </div>
      )}
      {tally.undecided > 0 && <div className="small muted">Only games that are decided are counted — {tally.undecided} still going.</div>}
      {hasEclectic && <div className="small muted">The eclectic runs all trip, so it’s in the trip’s money, not this round’s.</div>}
    </>
  );
}

function GameCard({ played, round, optIns, teeGroups, reload }) {
  const { game, kind, result, subjects, final, skipped } = played;
  const info = GAME_INFO[kind] || {};
  return (
    <div className="card pad stack" style={{ gap: 8 }} data-testid={`game-${kind}`}>
      <div className="row between" style={{ gap: 8 }}>
        <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}><strong style={{ fontSize: 17 }}>{info.emoji} {gameLabel(game)}</strong><GameHelp kind={kind} houseRules={game.house_rules || ''} optIn={isOptIn(game)} /></span>
        <span className="small" style={{ fontWeight: 700, color: skipped ? 'var(--muted)' : final ? 'var(--up)' : 'var(--gold)' }}>{skipped ? 'Not on' : final ? 'Final ✓' : round.status === 'live' ? 'Live' : 'Not started'}</span>
      </div>
      <div className="small muted">{info.blurb} <RuleTag testId="game-stake" rule={{ table: 'round_games', id: game.id, field: 'stake', label: stakeWords(game).replace(/\.$/, ''), value: Number(game.stake), where: { round_id: round.id, trip_id: round.trip_id, path: `/games?r=${round.id}` } }}
        explain={`${info.name || 'This game'}: ${stakeWords(game)} ${isOptIn(game) ? 'Only those who are in pay or win.' : 'Set by the organiser for this round.'}`}>{stakeWords(game)}</RuleTag></div>
      <WhosIn game={game} round={round} optIns={optIns} teeGroups={teeGroups} reload={reload} />
      {played.optIn?.teamNote && <div className="small muted" data-testid="ambrose-opt-in">{played.optIn.teamNote}</div>}
      {game.house_rules && <div className="small" style={{ whiteSpace: 'pre-wrap' }} data-testid="house-rules"><strong>House rules ({game.base_name}, our way):</strong> {game.house_rules}</div>}
      {played.note && <div className="small muted">{played.note}</div>}
      <div><RulesLink value={game.custom_game_id ? `custom_game:${game.custom_game_id}` : `game:${kind}`} /></div>
      {skipped ? <div className="small muted">{skipped}.</div>
        : kind === 'skins' ? <SkinsView result={result} subjects={subjects} />
          : kind === 'nassau' ? <NassauView result={result} subjects={subjects} />
            : kind === 'stableford_pot' ? <PotView result={result} subjects={subjects} />
              : kind === 'birdie_pool' ? <BirdieView result={result} subjects={subjects} />
                : <EclecticView result={result} subjects={subjects} rounds={played.rounds} />}
    </div>
  );
}

function stakeWords(game) {
  const m = formatMoney(toCents(game.stake));
  if (game.kind === 'skins') return `${m} a skin from each player.`;
  if (game.kind === 'nassau') return `${m} each into each of the three bets.`;
  return `${m} each into the pot.`;
}

function SkinsView({ result, subjects }) {
  const name = useNames();
  if (subjects.length < 2) return <div className="small muted">Needs at least two players.</div>;
  const won = Object.entries(result.won).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <div className="small" data-testid="skins-summary">
        {won.length ? won.map(([id, n]) => `${name(id, subjects)} ${n}`).join(' · ') : 'No skins won yet.'}
        {result.pot > 0 && <strong> · {result.pot} still in the pot</strong>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 6 }}>
        {result.holes.map((h) => (
          <div key={h.n} data-testid={`skin-${h.n}`} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '6px 8px', background: h.status === 'won' ? 'var(--gold-soft)' : '#fff', minHeight: 48 }}>
            <div className="label" style={{ fontSize: 11 }}>Hole {h.n}{h.value > 1 ? ` · ${h.value} skins` : ''}</div>
            <div className="small ellipsis" style={{ fontWeight: h.status === 'won' ? 700 : 400 }}>
              {h.status === 'won' ? `${name(h.winner, subjects)}${h.validating ? ' (needs to tie the next)' : ''}`
                : h.status === 'unvalidated' ? `${name(h.winner, subjects)} — not validated, carries`
                : h.status === 'tied' ? (!result.carry ? 'Tie — no skin' : result.holes.some((x) => x.n > h.n) ? 'Tie — carries' : 'In the pot')
                  : h.status === 'waiting' ? 'Waiting on earlier hole' : '–'}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function NassauView({ result, subjects }) {
  const name = useNames();
  const pts = result.scoring === 'stableford';
  const show = (r) => (pts ? `${r.value + 2 * r.thru} pts` : formatToPar(r.value));
  return (
    <div>
      {result.bets.map((b) => {
        const lead = b.rows.filter((r) => b.leaders.includes(r.id));
        return (
          <div key={b.key} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--line-soft)', gap: 8 }} data-testid={`nassau-${b.key}`}>
            <span style={{ width: 70, fontWeight: 700 }}>{b.label}</span>
            <span className="grow ellipsis">{lead.length ? lead.map((r) => name(r.id, subjects)).join(', ') : <span className="muted">Not started</span>}{lead.length > 1 && <span className="small muted"> (tied)</span>}</span>
            {lead[0] && <span className="num" style={{ fontSize: 18 }}>{show(lead[0])}</span>}
            <span className="small" style={{ width: 52, textAlign: 'right', color: b.decided ? 'var(--up)' : 'var(--muted)' }}>{b.decided ? 'Won ✓' : 'Leads'}</span>
          </div>
        );
      })}
      <div className="small muted" style={{ marginTop: 6 }}>{result.net ? 'Net' : 'Gross'} {pts ? 'Stableford points' : 'strokes to par'}, compared on holes played so far.</div>
    </div>
  );
}

function PotView({ result, subjects }) {
  const name = useNames();
  const rows = [...result.rows].sort((a, b) => b.points - a.points);
  return (
    <div>
      {rows.slice(0, 5).map((r) => (
        <div key={r.id} className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--line-soft)' }}>
          <span>{result.leaders.includes(r.id) ? '👑 ' : ''}{name(r.id, subjects)} <span className="small muted">thru {r.thru}</span></span>
          <span className="num" style={{ fontSize: 18 }}>{r.points} pts</span>
        </div>
      ))}
      <div className="small muted" style={{ marginTop: 6 }}>Pot: {formatMoney(result.pot)}{result.final ? '' : ' — paid when everyone’s finished'}.</div>
    </div>
  );
}

function BirdieView({ result, subjects }) {
  const name = useNames();
  const got = Object.entries(result.birdies).filter(([, b]) => b.length);
  return (
    <div className="stack" style={{ gap: 4 }}>
      {got.length ? got.map(([id, b]) => <div key={id} className="small"><strong>{name(id, subjects)}</strong> — {b.length} ({b.map((n) => `hole ${n}`).join(', ')})</div>) : <div className="small muted">No birdies yet.</div>}
      <div className="small muted">Pool: {formatMoney(result.pool)}{result.shares ? ` · ${result.shares} share${result.shares === 1 ? '' : 's'} of about ${formatMoney(result.perShare)}` : ''}{result.final ? '' : ' — paid when everyone’s finished'}.</div>
    </div>
  );
}

function EclecticView({ result, subjects, rounds }) {
  const name = useNames();
  return (
    <div>
      {result.rows.slice(0, 6).map((r) => (
        <div key={r.id} className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--line-soft)' }}>
          <span>{result.leaders.includes(r.id) ? '👑 ' : ''}{name(r.id, subjects)}{!r.full && <span className="small muted"> · {r.covered} of {result.holes.length} holes</span>}</span>
          <span className="num" style={{ fontSize: 18 }}>{formatToPar(r.toPar)}</span>
        </div>
      ))}
      <div className="small muted" style={{ marginTop: 6 }}>Across {rounds} round{rounds === 1 ? '' : 's'} on this course. Pot: {formatMoney(result.pot)} — paid when every one of those rounds is locked. Only a full card can win.</div>
    </div>
  );
}

// ------------------------------------------------------------------ organiser: the Games card on a round
export function RoundGames({ round }) {
  const on = useFeature('games');
  const data = useData();
  const { status } = useSession();
  const [rawGames, reload] = useRoundGames();
  const [customs] = useCustomGames();
  const [busy, run] = useRun();
  const [editing, setEditing] = useState(null);
  const [copying, setCopying] = useState(null);
  if (!on || !round) return null;
  const customById = byId(customs);
  const games = rawGames.map((g) => withCustom(g, customById));
  const mine = games.filter((g) => g.round_id === round.id);
  const customOffer = customs.filter((c) => !c.retired && gameSuits(c.base_type, round.format) && !mine.some((g) => g.custom_game_id === c.id));
  const addCustom = (c) => run(async () => {
    await must(supabase.from('round_games').insert({ ...roundGameFromCustom(c, round.id), created_by: status.player_id || null }));
    await reload();
  }, `${c.name} added`);
  // An eclectic runs all trip on one course: offer it only once per trip and course.
  const eclecticElsewhere = games.find((g) => g.kind === 'eclectic' && g.round_id !== round.id
    && data.rounds.some((r) => r.id === g.round_id && r.trip_id === round.trip_id && r.course_id === round.course_id));
  const offer = PRESETS.filter((p) => gameSuits(p.kind, round.format) && !mine.some((g) => g.kind === p.kind) && !(p.kind === 'eclectic' && eclecticElsewhere));
  const add = (p) => run(async () => {
    await must(supabase.from('round_games').insert({ round_id: round.id, kind: p.kind, stake: p.stake, options: cleanOptions(p.kind, p.options), created_by: status.player_id || null }));
    await reload();
  }, `${GAME_INFO[p.kind].name} added`);
  const remove = (g) => run(async () => {
    await must(supabase.from('round_games').update({ retired: true }).eq('id', g.id));
    await reload();
  }, `${GAME_INFO[g.kind].name} taken off`);
  return (
    <div className="stack" style={{ gap: 6 }} data-testid="round-games">
      <span className="label">🎲 Games and side bets</span>
      {mine.map((g) => (
        <div key={g.id} className="card pad stack" style={{ gap: 6 }}>
          <div className="row" style={{ gap: 8 }}>
            <div className="grow"><strong>{GAME_INFO[g.kind]?.emoji} {gameLabel(g)}</strong><div className="small muted">{g.house_rules ? `House rules: ${g.house_rules}` : GAME_INFO[g.kind]?.blurb}</div>
              {isOptIn(g) && <div className="small" data-testid="admin-opt-in">Opt-in{g.created_by && g.created_by !== status.player_id ? ` · put up by ${playerName(data.playersById[g.created_by])}` : ''}</div>}</div>
            <GameHelp kind={g.kind} houseRules={g.house_rules || ''} label="How" />
            <button type="button" className="btn ghost sm" onClick={() => setEditing(editing === g.id ? null : g.id)}>{editing === g.id ? 'Close' : 'Change'}</button>
          </div>
          {!gameSuits(g.kind, round.format) && <div className="small muted">Not played in Ambrose rounds.</div>}
          {editing === g.id && <GameEditor game={g} busy={busy} run={run} onSaved={async () => { await reload(); setEditing(null); }} onRemove={() => remove(g)}
            onCopy={g.custom_game_id ? null : () => setCopying(copyFrom(g.kind, g))} />}
        </div>
      ))}
      {customOffer.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="small muted">Your own games:</span>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {customOffer.map((c) => (
              <button key={c.id} type="button" className="chip" disabled={busy} onClick={() => addCustom(c)} title={c.rules_text}>+ {gameLabel({ ...roundGameFromCustom(c, round.id), name: c.name })}</button>
            ))}
          </div>
        </div>
      )}
      {copying && <CustomGameSheet start={copying} onClose={() => setCopying(null)} />}
      {offer.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="small muted">{mine.length ? 'Add another — one tap:' : 'One tap to add (change the stake after):'}</span>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {offer.map((p) => (
              <button key={p.key} type="button" className="chip" disabled={busy} onClick={() => add(p)} title={GAME_INFO[p.kind].blurb}>+ {gameLabel(p)}</button>
            ))}
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }} data-testid="games-explained">
            <span className="small muted">Not sure what they are?</span>
            {[...new Set(offer.map((p) => p.kind))].map((k) => <GameHelp key={k} kind={k} label={GAME_INFO[k]?.name || 'How it works'} />)}
          </div>
        </div>
      )}
      {eclecticElsewhere && !mine.some((g) => g.kind === 'eclectic') && <span className="small muted">🧩 The eclectic is already running for this trip on this course.</span>}
      {round.format === 'ambrose' && <span className="small muted">Ambrose: skins and Nassau only, team v team.</span>}
    </div>
  );
}

// Every standard option of the game (073): any mix is still the standard game. "Copy and change" is for a house rule.
function GameEditor({ game, busy, run, onSaved, onRemove, onCopy }) {
  const [stake, setStake] = useState(String(Number(game.stake)));
  const [opts, setOpts] = useState(() => gameOptions(game));
  const cents = toCents(stake);
  const bad = !/^\$?\s*\d+(\.\d{1,2})?$/.test(stake.trim()) || cents > 100000;
  const moneyBad = (STANDARD_OPTIONS[game.kind] || []).some((s) => s.type === 'money' && opts[s.key] != null && !/^\$?\s*\d+(\.\d{1,2})?$/.test(String(opts[s.key]).trim()));
  const [whoIn, setWhoIn] = useState(isOptIn(game) ? 'opt_in' : 'everyone');
  const save = () => run(async () => {
    const { options, settings } = splitOptions(game.kind, opts);
    const hasSettings = (STANDARD_OPTIONS[game.kind] || []).some((s) => s.col === 'settings');
    await must(supabase.from('round_games').update({ stake: cents / 100, options, ...(hasSettings ? { settings } : {}), ...(whoIn !== (isOptIn(game) ? 'opt_in' : 'everyone') ? { who_in: whoIn } : {}) }).eq('id', game.id));
    await onSaved();
  }, 'Game saved');
  return (
    <div className="stack" style={{ gap: 8 }}>
      <label className="field"><span>Stake — {GAME_INFO[game.kind].per} ($)</span>
        <input className="input" inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)} style={{ maxWidth: 140 }} />
      </label>
      {stake.trim() !== '' && bad && <span className="small err" style={{ margin: 0 }}>Dollars and cents, up to $1000 — e.g. 5 or 2.50</span>}
      <OptionControls kind={game.kind} value={opts} onChange={setOpts} />
      <div className="stack" style={{ gap: 2 }}>
        <span className="small"><strong>Who’s in</strong></span>
        <div className="seg" role="group" aria-label="Who’s in">
          {Object.entries(WHO_IN).map(([k, w]) => <button key={k} type="button" aria-pressed={whoIn === k} onClick={() => setWhoIn(k)}>{w.label}</button>)}
        </div>
        {whoIn === 'opt_in' && <span className="small muted">Only players who tap “I’m in” play for the money. Opt-in closes at the first tee.</span>}
      </div>
      {moneyBad && <span className="small err" style={{ margin: 0 }}>Bet values are dollars and cents, up to $1000 — or blank for the stake</span>}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn sm gold" disabled={busy || bad || moneyBad} onClick={save}>Save</button>
        <button type="button" className="btn sm ghost" disabled={busy} onClick={onRemove}>Take this game off</button>
        {onCopy && <button type="button" className="btn sm ghost" onClick={onCopy}>Copy and change (house rules)</button>}
      </div>
    </div>
  );
}

/** The guided setup's Extras step: a Games card for each of the trip's rounds. */
export function SetupGames({ rounds }) {
  const on = useFeature('games');
  if (!on || !rounds?.length) return null;
  return (
    <details className="card pad" open>
      <summary><strong>🎲 Games and side bets</strong> <span className="small muted">— skins, Nassau, pots, worked out from the scores</span></summary>
      <div className="stack" style={{ marginTop: 10, gap: 14 }}>
        {rounds.map((r) => (
          <div key={r.id} className="stack" style={{ gap: 6 }}>
            <strong>{r.name}</strong>
            <RoundGames round={r} />
          </div>
        ))}
      </div>
    </details>
  );
}

// ------------------------------------------------------------------ anyone: put up a side game (098)
/** "Bo's put up $5 skins for Saturday. You in?" — pick a round (still open), a game and a stake. It's opt-in; you're in. */
function ProposeGameSheet({ onClose, onDone }) {
  const data = useData();
  const { status } = useSession();
  const [busy, run] = useRun();
  const tees = useTeeTimes(data.rounds.map((r) => r.id));
  const rounds = proposableRounds(data.rounds, tees);
  const [roundId, setRoundId] = useState('');
  const round = rounds.find((r) => r.id === roundId) || rounds[0] || null;
  const kinds = PRESETS.filter((p) => round && gameSuits(p.kind, round.format));
  const [kind, setKind] = useState('skins');
  const preset = kinds.find((p) => p.kind === kind) || kinds[0] || null;
  const [stake, setStake] = useState('5');
  const bad = !/^\$?\s*\d+(\.\d{1,2})?$/.test(stake.trim()) || toCents(stake) > 100000 || toCents(stake) <= 0;
  const go = () => run(async () => {
    const id = crypto.randomUUID();
    await must(supabase.from('round_games').insert(proposedRow({ id, roundId: round.id, kind: preset.kind, stake, me: status.player_id })));
    await notify('game_proposed', { game_id: id });
    onDone?.(round.id);
    onClose();
  }, 'Side game put up — you’re in');
  return (
    <Sheet title="Put up a side game" onClose={onClose}>
      <div className="stack" style={{ gap: 10 }} data-testid="propose-sheet">
        <span className="small muted">It goes in the Feed and to everyone’s phone. Only those who tap “I’m in” play for the money — you’re in. Opt-in closes at the first tee.</span>
        {!rounds.length ? <div className="small">No rounds coming up that are still open for opt-ins.</div> : (
          <>
            <label className="field"><span>Round</span>
              <select className="input" value={round?.id || ''} onChange={(e) => setRoundId(e.target.value)} data-testid="propose-round">
                {rounds.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} role="group" aria-label="Game">
              {kinds.map((p) => (
                <button key={p.kind} type="button" className="chip" aria-pressed={preset?.kind === p.kind} onClick={() => { setKind(p.kind); setStake(String(p.stake)); }}>
                  {GAME_INFO[p.kind].emoji} {GAME_INFO[p.kind].name}
                </button>
              ))}
            </div>
            {preset && <div className="small muted">{GAME_INFO[preset.kind].blurb}</div>}
            <label className="field"><span>Stake — {preset ? GAME_INFO[preset.kind].per : ''} ($)</span>
              <input className="input" inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)} style={{ maxWidth: 140 }} data-testid="propose-stake" />
            </label>
            {bad && <span className="small err" style={{ margin: 0 }}>Dollars and cents, up to $1000 — e.g. 5 or 2.50</span>}
            {preset && !bad && <div className="small"><strong>{gameShort({ kind: preset.kind, stake: toCents(stake) / 100 })}</strong> for {round.name}, opt-in.</div>}
            <button type="button" className="btn gold block" disabled={busy || bad || !preset || !round} onClick={go} data-testid="propose-go">Put it up</button>
          </>
        )}
      </div>
    </Sheet>
  );
}
