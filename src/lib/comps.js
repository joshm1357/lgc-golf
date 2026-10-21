// Comps — what you're playing for (migration 067, docs/comps-design.md). Pure functions, no screen code.
// A comp: { id, trip_id, name, kind, round_ids (empty = all of the trip's rounds of a fitting format), settings,
// trophy_id, sort, retired }. The maths reuses board.js (rounds, the Stableford trophy), cup.js, games.js,
// sidecomps.js and awards.js — nothing here works out a score on its own.
//
// `data` (what the screens already load): { trips, rounds, coursesById, playersById, players, roundPlayers (by round),
//   teamsByRound, scoresIdx, quickResults, sideEntries, ownDefs, ownEntries, games, cupSides, cupMatches,
//   honourBoard, trophies }. Anything missing counts as empty.
import { roundBoard, stablefordTrophyBoard, compBonuses, formatName } from './board.js';
import { rankRows, formatToPar } from './scoring.js';
import { cupTotals, toWin, pts } from './cup.js';
import { playGame, moneyTally, formatMoney, GAME_INFO } from './games.js';
import { compsForRound, sortOwnEntries } from './sidecomps.js';
import { bestEntry, scoreText } from './awards.js';

// ------------------------------------------------------------------ the catalogue (the picker's cards)

/**
 * Every kind of comp, in plain words. formats: the round formats that fit (null = any round). oneRound: just one
 * round. noRounds: no rounds at all (the group awards it). who: 'each' | 'teams' | 'pairs' | 'sides'.
 */
export const COMP_TYPES = [
  { kind: 'individual_points', family: 'Individual', emoji: '🏆', who: 'each', formats: ['stableford'],
    name: 'Points over rounds', description: 'Each player’s Stableford points added up over the rounds you pick. Most points wins.',
    example: 'e.g. the BD Trophy — Friday and Saturday Stableford' },
  { kind: 'individual_net', family: 'Individual', emoji: '📉', who: 'each', formats: ['stroke'],
    name: 'Net strokes over rounds', description: 'Each player’s net score to par added up over the stroke play rounds. Lowest wins.',
    example: 'e.g. the Club Champs over two rounds' },
  { kind: 'day', family: 'Individual', emoji: '📅', who: 'each', formats: ['stableford', 'stroke'], oneRound: true,
    name: 'Day winner', description: 'Whoever wins one round.', example: 'e.g. the Friday Medal' },
  { kind: 'ambrose_teams', family: 'Teams and pairs', emoji: '🤝', who: 'teams', formats: ['ambrose'],
    name: 'Ambrose teams', description: 'Teams play Ambrose. Best net wins — added up if more than one round counts.',
    example: 'e.g. Putt Buddies on Sunday' },
  { kind: 'fourball_pairs', family: 'Teams and pairs', emoji: '👯', who: 'pairs', formats: ['fourball'],
    name: '4BBB pairs', description: 'Pairs play better-ball Stableford. Most points wins.',
    example: 'e.g. the Pairs Plate on Saturday' },
  { kind: 'cup', family: 'Cup', emoji: '🇪🇺', who: 'sides', formats: null,
    name: 'Team match play', description: 'Two sides for the trip. Match play matches each day, points for each win. More than half the points wins the Cup.',
    example: 'e.g. the 6th Ryder Cup — Blue v Red' },
  { kind: 'side_comps', family: 'On the side', emoji: '🎯', who: 'each', formats: null,
    name: 'Side comps', description: 'Closest to the pin, longest drive and your own side comps. Most wins over the trip takes it.',
    example: 'e.g. closest to the pin on every par 3' },
  { kind: 'games', family: 'On the side', emoji: '🎲', who: 'each', formats: null,
    name: 'Games', description: 'Skins, Nassau, pots and the like, with a running money tally.',
    example: 'e.g. $5 skins each day' },
  { kind: 'manual', family: 'On the side', emoji: '🍜', who: 'each', formats: null, noRounds: true,
    name: 'Awarded by the group', description: 'No scores: the group picks the winner.',
    example: 'e.g. the Noodle Cup for the shot of the trip' },
];
export const COMP_TYPE = Object.fromEntries(COMP_TYPES.map((t) => [t.kind, t]));
export const COMP_KINDS = COMP_TYPES.map((t) => t.kind);

/** Does a round's format fit a kind of comp? */
export function fits(kind, round) {
  const t = COMP_TYPE[kind];
  if (!t || t.noRounds || !round) return false;
  return !t.formats || t.formats.includes(round.format);
}

/** The trophy row's type for a comp with a trophy (what older app versions understand). */
export function trophyTypeFor(kind) {
  return kind === 'individual_points' ? 'stableford_total' : kind === 'ambrose_teams' ? 'ambrose' : 'manual';
}
/** And back: the kind of comp an old trophy is. */
export function kindForTrophy(type) {
  return type === 'stableford_total' ? 'individual_points' : type === 'ambrose' ? 'ambrose_teams' : 'manual';
}

/** A comp's settings with only what fits its kind (the database checks the same; migration 067). */
export function cleanSettings(kind, settings = {}) {
  const s = settings || {};
  const out = {};
  if (typeof s.note === 'string' && s.note.trim()) out.note = s.note.trim().slice(0, 200);
  if (kind === 'ambrose_teams' && ['each_round', 'fixed'].includes(s.teams)) out.teams = s.teams;
  if (kind === 'fourball_pairs' && ['each_round', 'fixed'].includes(s.pairs)) out.pairs = s.pairs;
  if (kind === 'side_comps' && typeof s.most_wins === 'boolean') out.most_wins = s.most_wins;
  if (kind === 'cup') {
    const p = Number(s.points);
    if (s.points != null && s.points !== '' && p > 0 && p <= 200) out.points = p;
    const sessions = {};
    for (const [rid, v] of Object.entries(s.sessions || {})) {
      if (!/^[0-9a-f-]{36}$/.test(rid) || !v || typeof v !== 'object') continue;
      const one = {};
      if (['singles', 'ambrose'].includes(v.format)) one.format = v.format;
      const vp = Number(v.points);
      if (v.points != null && v.points !== '' && vp > 0 && vp <= 10) one.points = vp;
      const vm = Number(v.matches);
      if (v.matches != null && v.matches !== '' && Number.isInteger(vm) && vm >= 1 && vm <= 30) one.matches = vm;
      if (Object.keys(one).length) sessions[rid] = one;
    }
    if (Object.keys(sessions).length) out.sessions = sessions;
  }
  return out;
}

// ------------------------------------------------------------------ which comps, which rounds

const byDate = (a, b) => String(a.play_date || a.created_at || '').localeCompare(String(b.play_date || b.created_at || ''));

/**
 * The trip's comps, in order: the comps table, plus a stand-in for any trophy of the trip with no comp yet (a
 * trophy added from Admin or an older app version, or before the backfill ran) — so every trophy is a comp.
 */
export function tripComps({ comps = [], trophies = [], tripId }) {
  const mine = (comps || []).filter((c) => c.trip_id === tripId && !c.retired);
  const linked = new Set((comps || []).map((c) => c.trophy_id).filter(Boolean));
  const stand = (trophies || [])
    .filter((t) => t.trip_id === tripId && !linked.has(t.id))
    .map((t, i) => ({
      id: `trophy-${t.id}`, virtual: true, trip_id: tripId, name: t.name, kind: kindForTrophy(t.type), round_ids: [],
      settings: {}, trophy_id: t.id, sort: 100 + i, created_at: t.created_at,
    }));
  return [...mine, ...stand].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
}

/** The rounds that count for a comp, in date order. Empty round_ids = all of the trip's rounds that fit. */
export function compRounds(comp, rounds = []) {
  const t = COMP_TYPE[comp?.kind];
  if (!t || t.noRounds) return [];
  const trip = (rounds || []).filter((r) => r.trip_id === comp.trip_id).sort(byDate);
  const ids = comp.round_ids || [];
  if (ids.length) return trip.filter((r) => ids.includes(r.id));
  const fitting = trip.filter((r) => fits(comp.kind, r));
  return t.oneRound ? fitting.slice(0, 1) : fitting;
}

/** The trip's rounds a kind of comp can count (for the picker's round chips). */
export function fittingRounds(kind, tripRounds = []) {
  return [...(tripRounds || [])].sort(byDate).filter((r) => fits(kind, r));
}

/** "Friday" (the round's day), or its name if it has no date. */
export function dayOf(round) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(round?.play_date || ''));
  if (!m) return round?.name || 'A round';
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()];
}

/** When no round of the trip fits: what to do, e.g. "Make Friday an Ambrose round first". null when one fits. */
export function noRoundHint(kind, tripRounds = []) {
  const t = COMP_TYPE[kind];
  if (!t || t.noRounds) return null;
  const list = [...(tripRounds || [])].sort(byDate);
  if (!list.length) return 'Add the trip’s rounds first';
  if (list.some((r) => fits(kind, r))) return null;
  const want = t.formats[0] === 'stroke' ? 'a stroke play' : t.formats[0] === 'ambrose' ? 'an Ambrose' : `a ${formatName(t.formats[0])}`;
  return `Make ${dayOf(list[0])} ${want} round first`;
}

/** The comps a round counts towards (for the leaderboard chips and the round card). */
export function roundComps(round, comps = [], rounds = []) {
  if (!round) return [];
  return (comps || []).filter((c) => !c.retired && c.trip_id === round.trip_id && compRounds(c, rounds).some((r) => r.id === round.id));
}

/** A name for a new comp of this kind. */
export function defaultName(kind, trip) {
  const t = COMP_TYPE[kind];
  if (kind === 'cup') return trip?.name ? `${trip.name} Cup`.slice(0, 60) : 'The Cup';
  return t ? t.name : 'Comp';
}

// ------------------------------------------------------------------ standings

const nm = (p) => (p ? p.nickname || p.name : '?');
const isPlayed = (r) => r.thru > 0 || r.quick;

function boardFor(round, data) {
  const teams = data.teamsByRound?.[round.id] || [];
  const side = (data.sideEntries || []).filter((e) => e.round_id === round.id);
  return roundBoard({
    round, course: data.coursesById?.[round.course_id], teams, roundPlayers: data.roundPlayers?.[round.id] || [],
    playersById: data.playersById || {}, scoresIdx: data.scoresIdx || {}, quickResults: data.quickResults || [],
    bonuses: compBonuses(round, teams, side),
  });
}

const netText = (row) => (isPlayed(row) ? formatToPar(row.netToPar, row.finished && row.netToPar % 1 ? 1 : 0) : '–');

/** Several rounds' team rows added up. by: 'team' (same players = same team) or 'player' (each player carries
 *  their team's score). value(row) is the number added up; higherBetter for points. */
function addUp(rounds, boards, { by, value, higherBetter, unit }) {
  const totals = {};
  boards.forEach((b, i) => {
    for (const row of b.rows) {
      if (!isPlayed(row)) continue;
      const keys = by === 'team'
        ? [[(row.players || []).map((p) => p.id).sort().join('|') || row.id, row.name, row.players || []]]
        : (row.players || []).map((p) => [p.id, nm(p), [p]]);
      for (const [key, name, players] of keys) {
        const t = (totals[key] ||= { id: key, name, players, byRound: {}, value: 0 });
        t.name = name;
        t.byRound[rounds[i].id] = value(row);
        t.value += value(row);
      }
    }
  });
  const rows = rankRows(Object.values(totals), { key: 'value', higherBetter });
  return rows.map((r) => ({ ...r, text: unit(r.value) }));
}

/**
 * Where a comp stands. Returns { kind, rounds, rows: [{ id, name, players, value, text, byRound?, rank, rankLabel }],
 * higherBetter, leaderText (or null), note (plain words on how it's worked out), empty (why there's nothing yet, or
 * null) } plus a few extras per kind: individual_points → projection (as the Trophy Room's Stableford board);
 * cup → sides, won, projected, total, toWin, perRound; side_comps → results; games → settle.
 */
export function compStandings(comp, data = {}) {
  const rounds = compRounds(comp, data.rounds || []);
  const base = { kind: comp.kind, rounds, rows: [], higherBetter: true, leaderText: null, note: '', empty: null };
  const fitting = rounds.filter((r) => fits(comp.kind, r));
  const t = COMP_TYPE[comp.kind];
  if (t && !t.noRounds && (t.formats ? !fitting.length : !rounds.length)) {
    return { ...base, empty: t.formats ? `No ${t.formats.map(formatName).join(' or ')} round counts yet.` : 'No rounds count yet.' };
  }

  switch (comp.kind) {
    case 'individual_points': {
      const b = stablefordTrophyBoard({
        trip: { id: comp.trip_id }, rounds: fitting, coursesById: data.coursesById || {}, roundPlayers: data.roundPlayers || {},
        playersById: data.playersById || {}, scoresIdx: data.scoresIdx || {}, quickResults: data.quickResults || [],
      });
      const rows = b.rows.map((r) => ({ ...r, value: r.total, text: `${r.total} pts` }));
      const top = rows[0];
      return {
        ...base, rows, projection: b.projection, rounds: b.rounds,
        leaderText: top && top.total > 0 ? `${top.name} leads · ${top.total} pts` : null,
        note: 'Stableford points added up over the rounds that count. Ties: more points in the last round, then countback.',
        empty: rows.length ? null : 'Nobody’s playing the rounds that count yet.',
      };
    }
    case 'individual_net': {
      const boards = fitting.map((r) => boardFor(r, data));
      const totals = {};
      boards.forEach((b, i) => {
        for (const row of b.rows) {
          const tt = (totals[row.id] ||= { id: row.id, name: row.name, players: row.players, byRound: {}, value: 0, played: 0 });
          if (!isPlayed(row)) continue;
          tt.byRound[fitting[i].id] = row.netToPar;
          tt.value += row.netToPar;
          tt.played += 1;
        }
      });
      const rows = rankRows(Object.values(totals).map((r) => ({ ...r, sortValue: r.played ? r.value : 999 })), { key: 'sortValue' })
        .map((r) => ({ ...r, text: r.played ? formatToPar(r.value) : '–' }));
      const top = rows[0];
      return {
        ...base, rows, higherBetter: false,
        leaderText: top?.played ? `${top.name} leads · ${top.text} net` : null,
        note: 'Net score to par added up over the stroke play rounds that count. Lowest wins.',
        empty: rows.length ? null : 'Nobody’s playing the rounds that count yet.',
      };
    }
    case 'day': {
      const round = fitting[0];
      const b = boardFor(round, data);
      const rows = b.rows.map((r) => ({ ...r, value: r.sortValue, text: isPlayed(r) ? scoreText(b.format, r) : '–' }));
      const top = rows[0];
      return {
        ...base, rows, rounds: [round], higherBetter: b.higherBetter,
        leaderText: top && isPlayed(top) ? `${top.name} ${round.status === 'locked' ? 'won' : 'leads'} · ${top.text}` : null,
        note: `The winner of ${round.name}.`,
        empty: rows.length ? null : `Nobody’s playing ${round.name} yet.`,
      };
    }
    case 'ambrose_teams':
    case 'fourball_pairs': {
      const amb = comp.kind === 'ambrose_teams';
      const boards = fitting.map((r) => boardFor(r, data));
      const fixed = (amb ? comp.settings?.teams : comp.settings?.pairs) === 'fixed';
      let rows;
      if (boards.length === 1) {
        rows = boards[0].rows.map((r) => ({
          ...r, value: amb ? r.netToPar : r.points,
          text: amb ? netText(r) : isPlayed(r) ? `${r.points} pts` : '–',
        }));
      } else {
        rows = addUp(fitting, boards, {
          by: fixed ? 'team' : 'player', higherBetter: !amb,
          value: (r) => (amb ? r.netToPar : r.points),
          unit: (v) => (amb ? formatToPar(v) : `${v} pts`),
        });
      }
      const top = rows[0];
      const many = boards.length > 1;
      return {
        ...base, rows, higherBetter: !amb,
        leaderText: top && (many || isPlayed(top)) ? `${top.name} lead · ${top.text}${amb ? ' net' : ''}` : null,
        note: !many ? (amb ? 'Best net score wins.' : 'Most better-ball points wins.')
          : fixed ? `${amb ? 'Net scores' : 'Better-ball points'} added up over the rounds — the same ${amb ? 'teams' : 'pairs'} all trip.`
            : `New ${amb ? 'teams' : 'pairs'} each round, so each player carries their ${amb ? 'team’s net score' : 'pair’s points'}, added up over the rounds.`,
        empty: rows.length ? null : amb ? 'Teams not picked yet.' : 'Pairs not made yet.',
      };
    }
    case 'cup': {
      const ids = new Set(rounds.map((r) => r.id));
      const matches = (data.cupMatches || []).filter((m) => ids.has(m.round_id));
      const sides = cupSides(comp, data.cupSides);
      const tot = cupTotals(matches);
      const trip = (data.trips || []).find((x) => x.id === comp.trip_id);
      const total = Number(comp.settings?.points) || Number(trip?.cup_points) || tot.total;
      const need = toWin(total);
      const rows = sides.length === 2 ? rankRows(sides.map((s, i) => {
        const v = i === 0 ? tot.won.a : tot.won.b;
        return { id: s.id, name: s.name, colour: s.colour, players: [], value: v, projected: i === 0 ? tot.projected.a : tot.projected.b, text: `${pts(v)}` };
      }), { key: 'value', higherBetter: true }) : [];
      const perRound = rounds.map((r) => {
        const ms = matches.filter((m) => m.round_id === r.id);
        return { round: r, matches: ms.length, ...cupTotals(ms) };
      });
      const won = rows.find((r) => need && r.value >= need);
      const [A, B] = sides;
      return {
        ...base, rows, sides, won: tot.won, projected: tot.projected, total, toWin: need, perRound,
        leaderText: won ? `${won.name} win · ${pts(won.value)}` : sides.length === 2 && matches.length ? `${A.name} ${pts(tot.won.a)} – ${pts(tot.won.b)} ${B.name}` : null,
        note: total ? `${pts(total)} points in the Cup · ${pts(need)} to win.` : 'Points for each match won; a halved match splits them.',
        empty: sides.length < 2 ? 'The two sides aren’t set up yet.' : null,
      };
    }
    case 'side_comps': {
      const results = sideResults(rounds, data);
      const wins = {};
      for (const res of results) {
        if (!res.winner) continue;
        const w = (wins[res.winner] ||= { id: res.winner, name: nm(data.playersById?.[res.winner]), players: [data.playersById?.[res.winner]].filter(Boolean), value: 0, wins: [] });
        w.value += 1;
        w.wins.push(res.label);
      }
      const rows = rankRows(Object.values(wins), { key: 'value', higherBetter: true })
        .map((r) => ({ ...r, text: `${r.value} win${r.value === 1 ? '' : 's'}` }));
      const top = rows[0];
      return {
        ...base, rows, results,
        leaderText: top ? `${top.name} leads · ${top.text}` : null,
        note: 'Each closest to the pin, longest drive and own side comp won counts one. Most wins takes it.',
        empty: !results.length ? 'No side comp holes set on the rounds that count.' : rows.length ? null : 'No winners yet.',
      };
    }
    case 'games': {
      const played = [];
      for (const r of rounds) {
        for (const g of (data.games || []).filter((x) => x.round_id === r.id && !x.retired)) {
          played.push(playGame(g, {
            round: r, course: data.coursesById?.[r.course_id], teams: data.teamsByRound?.[r.id] || [],
            roundPlayers: data.roundPlayers?.[r.id] || [], playersById: data.playersById || {}, scoresIdx: data.scoresIdx || {},
            tripRounds: (data.rounds || []).filter((x) => x.trip_id === r.trip_id), teamsByRound: data.teamsByRound || {},
            roundPlayersByRound: data.roundPlayers || {}, coursesById: data.coursesById || {},
          }));
        }
      }
      const tally = moneyTally(played);
      const rows = rankRows(tally.rows.map((r) => ({ id: r.id, name: nm(data.playersById?.[r.id]), players: [data.playersById?.[r.id]].filter(Boolean), value: r.cents })), { key: 'value', higherBetter: true })
        .map((r) => ({ ...r, text: formatMoney(r.value, { signed: true }) }));
      const top = rows[0];
      return {
        ...base, rows, settle: tally.settle, undecided: tally.undecided, games: played.length,
        leaderText: top && top.value > 0 ? `${top.name} up · ${top.text}` : null,
        note: `${[...new Set(played.map((p) => GAME_INFO[p.kind]?.name).filter(Boolean))].join(', ') || 'Games'} — money won and lost over the rounds that count.`,
        empty: !played.length ? 'No games on the rounds that count yet.' : null,
      };
    }
    case 'manual':
    default: {
      const trophy = (data.trophies || []).find((x) => x.id === comp.trophy_id);
      const name = (trophy?.name || comp.name || '').toLowerCase();
      const won = (data.honourBoard || []).filter((h) => h.trophy_name?.toLowerCase() === name && (!h.trip_id || h.trip_id === comp.trip_id));
      const mine = won.filter((h) => h.trip_id === comp.trip_id);
      const rows = mine.map((h, i) => ({ id: h.id, name: h.winner_names, players: (h.player_ids || []).map((id) => data.playersById?.[id]).filter(Boolean), value: 1, text: h.label, rank: i + 1, rankLabel: '🏆' }));
      return {
        ...base, rows,
        leaderText: rows[0] ? `Won by ${rows[0].name}` : null,
        note: 'Awarded by the group.',
        empty: rows.length ? null : 'Not awarded yet.',
      };
    }
  }
}

/** The Cup's two sides for a comp: the ones linked to it, else (not linked yet) the group's sides. */
export function cupSides(comp, sides = []) {
  const all = [...(sides || [])].sort((a, b) => a.sort - b.sort);
  const linked = all.filter((s) => s.comp_id && s.comp_id === comp?.id);
  return linked.length ? linked : all.filter((s) => !s.comp_id || !comp?.id || String(comp.id).startsWith('trophy-'));
}

/** Each side comp on the rounds: { round, label, winner (player id) or null }. */
export function sideResults(rounds, data = {}) {
  const out = [];
  for (const r of rounds) {
    const here = (data.sideEntries || []).filter((e) => e.round_id === r.id);
    for (const kind of ['ctp', 'ld']) {
      for (const hole of (kind === 'ctp' ? r.ctp_holes : r.ld_holes) || []) {
        const best = bestEntry(kind, here.filter((e) => e.kind === kind && e.hole === hole));
        out.push({ round: r, label: `${dayOf(r)} ${kind === 'ctp' ? '🎯 CTP' : '💣 LD'} ${hole}`, winner: best?.player_id || null });
      }
    }
    for (const def of compsForRound(r, data.ownDefs || [])) {
      const holes = def.holes.length ? def.holes : [null];
      for (const hole of holes) {
        const list = (data.ownEntries || []).filter((e) => e.round_id === r.id && e.comp_id === def.id && (e.hole ?? null) === hole);
        const top = sortOwnEntries(def.how, list)[0];
        const winner = top && (top.confirmed || (def.how !== 'pick' && top.value != null)) ? top.player_id : null;
        out.push({ round: r, label: `${dayOf(r)} ${def.emoji || '⭐'} ${def.name}${hole ? ` ${hole}` : ''}`, winner });
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ the to-do list

/** Who's on the trip: everyone in any of its rounds (players, teams, pairs); nobody yet = every approved player. */
export function tripPlayerIds(tripRounds, data = {}) {
  const ids = new Set();
  for (const r of tripRounds || []) {
    for (const rp of data.roundPlayers?.[r.id] || []) ids.add(rp.player_id);
    for (const t of data.teamsByRound?.[r.id] || []) for (const p of t.players || []) ids.add(p.id);
  }
  if (ids.size) return [...ids];
  return (data.players || []).filter((p) => p.approved !== false).map((p) => p.id);
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const teamKey = (t) => (t.players || []).map((p) => p.id).sort().join('|');

/**
 * What a comp still needs, as a to-do list: [{ key, text, done, action: { kind, roundId? } }].
 * action kinds (the screen turns them into a button): add_round, round_format, round_players, round_teams,
 * round_pairs, cup_setup, side_holes, games, engrave.
 */
export function compNeeds(comp, data = {}) {
  const t = COMP_TYPE[comp?.kind];
  if (!t) return [];
  const items = [];
  const tripRounds = (data.rounds || []).filter((r) => r.trip_id === comp.trip_id).sort(byDate);
  const rounds = compRounds(comp, data.rounds || []);
  const add = (key, text, done, action) => items.push({ key, text, done: !!done, action });

  if (t.noRounds) {
    if (comp.trophy_id) {
      const st = compStandings(comp, data);
      add('engrave', st.rows.length ? `Engraved: ${st.rows[0].name}` : 'Engrave the winner when it’s decided', st.rows.length > 0, { kind: 'engrave' });
    }
    return items;
  }
  if (!rounds.length) {
    const hint = noRoundHint(comp.kind, tripRounds);
    add('rounds', hint || 'Pick the rounds that count', false, { kind: hint && tripRounds.length ? 'round_format' : 'add_round', roundId: tripRounds[0]?.id });
    return items;
  }
  const people = tripPlayerIds(tripRounds, data);

  if (comp.kind === 'cup') {
    const sides = cupSides(comp, data.cupSides);
    const players = (data.players || []).filter((p) => p.approved !== false);
    add('sides', sides.length === 2 ? `Cup: ${sides[0].name} v ${sides[1].name}` : 'Cup: make the two sides', sides.length === 2, { kind: 'cup_setup' });
    if (sides.length === 2) {
      const sideIds = new Set(sides.map((s) => s.id));
      const off = players.filter((p) => !sideIds.has(p.cup_side)).length;
      add('on-a-side', off ? `Cup: ${plural(off, 'player')} not on a side` : 'Cup: everyone’s on a side', !off, { kind: 'cup_setup' });
      const counts = sides.map((s) => players.filter((p) => p.cup_side === s.id).length);
      for (const r of rounds) {
        const ms = (data.cupMatches || []).filter((m) => m.round_id === r.id);
        const ses = comp.settings?.sessions?.[r.id] || {};
        const format = ses.format || ms[0]?.format || 'singles';
        const expected = ses.matches || Math.floor(Math.min(...counts) / (format === 'ambrose' ? 2 : 1));
        const done = expected ? ms.length >= expected : ms.length > 0;
        add(`matches-${r.id}`, expected ? `${dayOf(r)}: ${ms.length} of ${expected} matches made` : `${dayOf(r)}: ${ms.length ? plural(ms.length, 'match', 'matches') : 'no matches yet'}`, done, { kind: 'cup_setup', roundId: r.id });
      }
    }
    const trip = (data.trips || []).find((x) => x.id === comp.trip_id);
    const total = Number(comp.settings?.points) || Number(trip?.cup_points);
    add('points', total ? `Cup: ${pts(total)} points, ${pts(toWin(total))} to win` : 'Cup: set the points in the whole Cup', !!total, { kind: 'cup_setup' });
    return items;
  }

  for (const r of rounds) {
    const day = dayOf(r);
    if (!fits(comp.kind, r)) {
      add(`format-${r.id}`, `${day} is ${formatName(r.format)} — this comp needs ${t.formats.map(formatName).join(' or ')}`, false, { kind: 'round_format', roundId: r.id });
      continue;
    }
    if (comp.kind === 'individual_points' || comp.kind === 'individual_net' || comp.kind === 'day') {
      const n = (data.roundPlayers?.[r.id] || []).length;
      add(`players-${r.id}`, n >= 2 ? `${day}: ${n} playing` : n === 1 ? `${day}: only 1 playing — add the rest` : `${day}: pick who’s playing`, n >= 2, { kind: 'round_players', roundId: r.id });
    } else if (comp.kind === 'ambrose_teams' || comp.kind === 'fourball_pairs') {
      const pairs = comp.kind === 'fourball_pairs';
      const word = pairs ? 'pair' : 'team';
      const teams = data.teamsByRound?.[r.id] || [];
      const inTeams = new Set(teams.flatMap((x) => (x.players || []).map((p) => p.id)));
      const out = people.filter((id) => !inTeams.has(id)).length;
      const action = { kind: pairs ? 'round_pairs' : 'round_teams', roundId: r.id };
      const label = pairs ? '4BBB pairs' : 'Ambrose teams';
      if (!teams.length) add(`teams-${r.id}`, `${day}: make the ${label}`, false, action);
      else if (pairs && teams.some((x) => (x.players || []).length !== 2)) add(`teams-${r.id}`, `${day}: ${plural(teams.filter((x) => (x.players || []).length !== 2).length, 'pair')} without two players`, false, action);
      else if (out) add(`teams-${r.id}`, `${day}: ${label} — ${plural(out, 'player')} not in a ${word}`, false, action);
      else if (teams.length < 2) add(`teams-${r.id}`, `${day}: only one ${word} so far`, false, action);
      else add(`teams-${r.id}`, `${day}: ${plural(teams.length, word)} made`, true, action);
      const fixed = (pairs ? comp.settings?.pairs : comp.settings?.teams) === 'fixed';
      const first = rounds.find((x) => fits(comp.kind, x));
      if (fixed && first && first.id !== r.id && teams.length) {
        const a = new Set((data.teamsByRound?.[first.id] || []).map(teamKey));
        const same = teams.every((x) => a.has(teamKey(x)));
        if (!same) add(`fixed-${r.id}`, `${day}: ${word}s differ from ${dayOf(first)} (they’re fixed for the trip)`, false, action);
      }
      if (pairs && teams.length) {
        const have = new Set((data.roundPlayers?.[r.id] || []).map((rp) => rp.player_id));
        const missing = [...inTeams].filter((id) => !have.has(id)).length;
        if (missing) add(`hcp-${r.id}`, `${day}: playing handicaps — ${missing} not set`, false, action);
      }
    } else if (comp.kind === 'side_comps') {
      const ctp = r.ctp_holes || [];
      const ld = r.ld_holes || [];
      const own = r.own_comps || [];
      const bits = [ctp.length ? `CTP ${ctp.join(', ')}` : null, ld.length ? `LD ${ld.join(', ')}` : null, own.length ? plural(own.length, 'own comp') : null].filter(Boolean);
      add(`holes-${r.id}`, bits.length ? `${day}: ${bits.join(' · ')}` : `${day}: closest-to-pin / longest-drive holes not set`, bits.length > 0, { kind: 'side_holes', roundId: r.id });
    } else if (comp.kind === 'games') {
      const gs = (data.games || []).filter((g) => g.round_id === r.id && !g.retired);
      add(`games-${r.id}`, gs.length ? `${day}: ${[...new Set(gs.map((g) => GAME_INFO[g.kind]?.name))].join(', ')}` : `${day}: no games yet`, gs.length > 0, { kind: 'games', roundId: r.id });
    }
  }
  return items;
}

/** "2 to do" / "All set" for a list from compNeeds. */
export function needsSummary(items = []) {
  const todo = items.filter((i) => !i.done).length;
  return { todo, total: items.length, text: !items.length ? '' : todo ? `${todo} to do` : 'All set' };
}

/** Where a to-do's button goes (a path in the app). */
export function actionPath(action) {
  if (!action) return null;
  switch (action.kind) {
    case 'cup_setup': return '/cup?setup=1';
    case 'engrave': return '/trophies';
    case 'add_round': return '/setup?step=rounds';
    case 'round_format': case 'round_players': case 'round_teams': case 'round_pairs': case 'side_holes': case 'games':
      return action.roundId ? `/admin?round=${action.roundId}` : '/admin';
    default: return null;
  }
}

/** The button's words for a to-do. */
export function actionLabel(action) {
  return {
    cup_setup: 'Set up the Cup', engrave: 'Trophy Room', add_round: 'Add rounds', round_format: 'Change the round',
    round_players: 'Pick players', round_teams: 'Make teams', round_pairs: 'Make pairs', side_holes: 'Set holes', games: 'Add games',
  }[action?.kind] || 'Open';
}
