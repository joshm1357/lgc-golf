// Games and side bets (migration 055, feature 'games'): skins, Nassau, a Stableford pot, a birdie pool and an
// eclectic, all worked out from the scores already entered — plus the money tally and who pays who.
// Pure functions, no screen code. Money is always whole cents (integers), so nothing drifts.
//
// Scores: { [subjectId]: { [hole]: { strokes, picked_up } } }. Holes: [{ n, par, si }].
// A subject is a player (Stableford, stroke play, 4BBB — each player in a pair plays for themselves) or, for
// Ambrose, a team: { id, name, hcp, members: [playerId] }.
//
// Our rules for pick-ups (shown on screen, see PICKUP_RULES):
//   * a pick-up never wins a hole (skins) and never makes a birdie;
//   * in stroke totals (Nassau, eclectic) a pick-up counts as a (net) double bogey;
//   * in Stableford a pick-up scores 0 points;
//   * once a round is locked, a hole someone never entered counts as a pick-up.
import { strokesReceived, stablefordPoints } from './scoring.js';

export const GAME_KINDS = ['skins', 'nassau', 'stableford_pot', 'birdie_pool', 'eclectic'];

export const GAME_INFO = {
  skins: { name: 'Skins', emoji: '💰', per: 'a skin', blurb: 'Lowest score on a hole wins a skin. A tie carries it to the next hole.' },
  nassau: { name: 'Nassau', emoji: '🎰', per: 'a bet', blurb: 'Three bets: best front 9, best back 9 and best 18. Ties split.' },
  stableford_pot: { name: 'Stableford pot', emoji: '🏺', per: 'a player', blurb: 'Everyone puts in; most Stableford points takes the pot.' },
  birdie_pool: { name: 'Birdie pool', emoji: '🐦', per: 'a player', blurb: 'Everyone puts in; each birdie or better takes an equal share.' },
  eclectic: { name: 'Eclectic', emoji: '🧩', per: 'a player', blurb: 'Your best score on each hole across the trip’s rounds on this course. Lowest total wins.' },
};

export const PICKUP_RULES = 'Pick-ups never win a hole or make a birdie. In stroke totals a pick-up counts as a double bogey (net), in Stableford it’s 0 points. Once a round is locked, a hole with no score counts as a pick-up.';

/** Defaults for each game's options; anything else in options is dropped. */
const DEFAULTS = {
  skins: { net: true, carry: true },
  nassau: { net: true, scoring: 'stroke' },
  stableford_pot: {},
  birdie_pool: { net: true },
  eclectic: { net: true },
};

/** A game's options with the defaults filled in and unknown keys dropped (matches the database check). */
export function cleanOptions(kind, options = {}) {
  const d = DEFAULTS[kind] || {};
  const out = {};
  for (const k of Object.keys(d)) {
    const v = options?.[k];
    if (k === 'scoring') out[k] = v === 'stableford' ? 'stableford' : 'stroke';
    else out[k] = typeof v === 'boolean' ? v : d[k];
  }
  return out;
}

/** One-tap presets for the Games card. */
export const PRESETS = [
  { key: 'skins', kind: 'skins', stake: 5, options: { net: true, carry: true } },
  { key: 'nassau', kind: 'nassau', stake: 10, options: { net: true, scoring: 'stroke' } },
  { key: 'stableford_pot', kind: 'stableford_pot', stake: 10, options: {} },
  { key: 'birdie_pool', kind: 'birdie_pool', stake: 2, options: { net: true } },
  { key: 'eclectic', kind: 'eclectic', stake: 20, options: { net: true } },
];

/** "Skins $5 (net, carry-overs)" — a game's one-line label. */
export function gameLabel(game) {
  const o = cleanOptions(game.kind, game.options);
  const bits = [];
  if ('net' in o && game.kind !== 'stableford_pot') bits.push(o.net ? 'net' : 'gross');
  if (game.kind === 'skins') bits.push(o.carry ? 'carry-overs' : 'no carry-overs');
  if (game.kind === 'nassau' && o.scoring === 'stableford') bits.push('Stableford points');
  if (game.kind === 'eclectic') bits.push('for the trip');
  const money = formatMoney(toCents(game.stake));
  return `${GAME_INFO[game.kind]?.name || game.kind} ${money}${bits.length ? ` (${bits.join(', ')})` : ''}`;
}

/** Which games suit a round's format. Ambrose is played as teams: skins and Nassau only. */
export function gameSuits(kind, format) {
  if (format === 'ambrose') return kind === 'skins' || kind === 'nassau';
  return GAME_KINDS.includes(kind);
}
export const AMBROSE_NOTE = 'Ambrose rounds: skins and Nassau are played team v team (winnings split between the team). Stableford pot, birdie pool and eclectic are for individual rounds.';

// ------------------------------------------------------------------ money (whole cents)

/** $ (number or text) → whole cents. */
export function toCents(amount) {
  const n = Number(String(amount ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** 1250 → "$12.50", 1200 → "$12"; signed: "+$12" / "−$12". */
export function formatMoney(cents, { signed = false } = {}) {
  const c = Math.round(Number(cents) || 0);
  const a = Math.abs(c);
  const s = `$${Math.floor(a / 100)}${a % 100 ? `.${String(a % 100).padStart(2, '0')}` : ''}`;
  if (!signed) return c < 0 ? `−${s}` : s;
  return c > 0 ? `+${s}` : c < 0 ? `−${s}` : '$0';
}

/** Split `total` cents into n whole-cent parts that add up exactly (the first ones get the odd cents). */
export function splitCents(total, n) {
  if (n <= 0) return [];
  const sign = total < 0 ? -1 : 1;
  const a = Math.abs(Math.round(total));
  const base = Math.floor(a / n);
  const extra = a - base * n;
  return Array.from({ length: n }, (_, i) => sign * (base + (i < extra ? 1 : 0)) || 0);
}

function addTo(map, id, cents) {
  map[id] = (map[id] || 0) + cents;
}

/** Everyone in pays `stake`; the winners split the pot. Returns { id: cents } (adds to zero). */
function potMoney(ids, winners, stakeCents) {
  const out = {};
  if (!winners.length || !stakeCents) return out;
  for (const id of ids) addTo(out, id, -stakeCents);
  const shares = splitCents(stakeCents * ids.length, winners.length);
  [...winners].sort().forEach((id, i) => addTo(out, id, shares[i]));
  return out;
}

/** Subject money → player money (a team's winnings split evenly between its players). */
export function toPlayers(money, subjects) {
  const out = {};
  const byId = Object.fromEntries(subjects.map((s) => [s.id, s]));
  for (const [id, cents] of Object.entries(money)) {
    const members = byId[id]?.members?.length ? [...byId[id].members].sort() : [id];
    splitCents(cents, members.length).forEach((c, i) => addTo(out, members[i], c));
  }
  return out;
}

/** Add several { id: cents } maps together. */
export function sumMoney(maps) {
  const out = {};
  for (const m of maps) for (const [id, c] of Object.entries(m || {})) addTo(out, id, c);
  return out;
}

/**
 * Fewest payments to square up: biggest loser pays biggest winner, repeat. balances: { id: cents }
 * (positive = won money, negative = owes). Returns [{ from, to, cents }].
 */
export function settleUp(balances) {
  const owe = Object.entries(balances).filter(([, c]) => c < 0).map(([id, c]) => ({ id, c: -c }));
  const get = Object.entries(balances).filter(([, c]) => c > 0).map(([id, c]) => ({ id, c }));
  const byBig = (a, b) => b.c - a.c || a.id.localeCompare(b.id);
  const out = [];
  // An exact match first (one payment settles two people), then biggest to biggest.
  for (const o of owe) {
    const g = get.find((x) => x.c === o.c && x.c > 0);
    if (g && o.c > 0) { out.push({ from: o.id, to: g.id, cents: o.c }); g.c = 0; o.c = 0; }
  }
  for (;;) {
    const o = owe.filter((x) => x.c > 0).sort(byBig)[0];
    const g = get.filter((x) => x.c > 0).sort(byBig)[0];
    if (!o || !g) break;
    const c = Math.min(o.c, g.c);
    out.push({ from: o.id, to: g.id, cents: c });
    o.c -= c;
    g.c -= c;
  }
  return out;
}

// ------------------------------------------------------------------ who's playing

/**
 * The subjects of a round's games. Stableford / stroke play: the round's players. 4BBB: each player in the pairs,
 * off their own handicap. Ambrose: the teams, off the team handicap.
 */
export function gameSubjects({ round, teams = [], roundPlayers = [], playersById = {} }) {
  const nm = (p) => (p ? p.nickname || p.name : '?');
  if (round?.format === 'ambrose') {
    return teams.map((t) => ({ id: t.id, name: t.name, hcp: Number(t.handicap) || 0, members: (t.players || []).map((p) => p.id), team: true }));
  }
  if (round?.format === 'fourball') {
    const hcpOf = Object.fromEntries(roundPlayers.map((rp) => [rp.player_id, rp.playing_handicap]));
    return teams.flatMap((t) => (t.players || []).map((p) => ({ id: p.id, name: nm(p), hcp: Number(hcpOf[p.id] ?? p.handicap ?? 0), members: [p.id] })));
  }
  return roundPlayers.map((rp) => ({ id: rp.player_id, name: nm(playersById[rp.player_id]), hcp: Number(rp.playing_handicap) || 0, members: [rp.player_id] }));
}

// ------------------------------------------------------------------ one hole, one subject

/** 'none' (not entered yet), 'pickup' or 'played'. A locked round turns 'none' into 'pickup'. */
function holeState(score, locked) {
  if (score && score.picked_up) return 'pickup';
  if (score && score.strokes != null) return 'played';
  return locked ? 'pickup' : 'none';
}

/** Stroke value for totals: strokes less shots received (net), a pick-up = double bogey. */
function strokeValue(hole, score, hcp, net, locked) {
  const st = holeState(score, locked);
  if (st === 'none') return null;
  if (st === 'pickup') return hole.par + 2;
  return score.strokes - (net ? strokesReceived(hcp, hole.si) : 0);
}

function pointsValue(hole, score, hcp, net, locked) {
  const st = holeState(score, locked);
  if (st === 'none') return null;
  return st === 'pickup' ? 0 : stablefordPoints(hole, score.strokes, net ? hcp : 0, false);
}

const sortHoles = (holes) => [...(holes || [])].sort((a, b) => a.n - b.n);

// ------------------------------------------------------------------ skins

/**
 * Skins. Each hole: once everyone has a score there, the single lowest (net or gross) score wins the skin.
 * A pick-up never wins. A tie carries the skin to the next hole (carry-overs on) or kills it (off).
 * With carry-overs on, a hole can't be paid until every hole before it is done (its value isn't known).
 * Returns { holes: [{ n, status: 'won'|'tied'|'pending'|'waiting', winner, value, low, scores }], won: { id: skins },
 *   pot (skins carried past the last hole, still in the pot), final, money: { id: cents } }.
 * Money: each skin won collects `stake` from every other player (so a 3-skin hole is 3 × stake from each).
 */
export function skins({ holes, subjects, scores, options, stakeCents = 0, locked = false }) {
  const o = cleanOptions('skins', options);
  const out = { holes: [], won: {}, pot: 0, final: false, money: {}, carry: o.carry };
  if (subjects.length < 2) return out;
  let carry = 0;
  let blocked = false;
  for (const h of sortHoles(holes)) {
    const vals = subjects.map((s) => {
      const sc = scores?.[s.id]?.[h.n];
      const st = holeState(sc, locked);
      return { id: s.id, st, v: st === 'played' ? sc.strokes - (o.net ? strokesReceived(s.hcp, h.si) : 0) : null };
    });
    const shown = Object.fromEntries(vals.map((x) => [x.id, x.st === 'pickup' ? 'P' : x.v]));
    const playing = vals.filter((x) => x.v != null);
    const low = playing.length ? Math.min(...playing.map((x) => x.v)) : null;
    if (vals.some((x) => x.st === 'none')) {
      out.holes.push({ n: h.n, status: 'pending', winner: null, value: null, low, scores: shown });
      if (o.carry) blocked = true;
      continue;
    }
    const value = 1 + (o.carry ? carry : 0);
    const atLow = playing.filter((x) => x.v === low);
    if (blocked) {
      out.holes.push({ n: h.n, status: 'waiting', winner: atLow.length === 1 ? atLow[0].id : null, value: null, low, scores: shown });
      continue;
    }
    if (atLow.length === 1) {
      const w = atLow[0].id;
      out.holes.push({ n: h.n, status: 'won', winner: w, value, low, scores: shown });
      out.won[w] = (out.won[w] || 0) + value;
      for (const s of subjects) addTo(out.money, s.id, s.id === w ? value * stakeCents * (subjects.length - 1) : -value * stakeCents);
      carry = 0;
    } else {
      out.holes.push({ n: h.n, status: 'tied', winner: null, value, low, scores: shown });
      carry = o.carry ? carry + 1 : 0;
    }
  }
  out.pot = blocked ? 0 : carry;
  out.final = out.holes.length > 0 && out.holes.every((x) => x.status === 'won' || x.status === 'tied');
  return out;
}

// ------------------------------------------------------------------ Nassau

/**
 * Nassau: three bets — front 9, back 9 and the 18 (a 9-hole course has one bet). Best net (or gross) stroke total
 * wins, or most Stableford points (option). Leaders are compared on holes played so far (to par, or points vs 2 a
 * hole), so groups on different holes compare fairly. A bet is decided once everyone has finished its holes.
 * Everyone puts `stake` into each bet; the winners (ties split) take it.
 * Returns { scoring, bets: [{ key, label, holes, rows: [{ id, value, thru }], leaders, decided }], final, money }.
 */
export function nassau({ holes, subjects, scores, options, stakeCents = 0, locked = false }) {
  const o = cleanOptions('nassau', options);
  const hs = sortHoles(holes);
  const pts = o.scoring === 'stableford';
  const defs = hs.length > 9
    ? [
      { key: 'front', label: 'Front 9', holes: hs.filter((h) => h.n <= 9) },
      { key: 'back', label: 'Back 9', holes: hs.filter((h) => h.n > 9) },
      { key: 'total', label: 'The 18', holes: hs },
    ]
    : [{ key: 'total', label: `All ${hs.length}`, holes: hs }];
  const ids = subjects.map((s) => s.id);
  const bets = defs.map((d) => {
    const rows = subjects.map((s) => {
      let value = 0;
      let thru = 0;
      for (const h of d.holes) {
        const sc = scores?.[s.id]?.[h.n];
        const v = pts ? pointsValue(h, sc, s.hcp, o.net, locked) : strokeValue(h, sc, s.hcp, o.net, locked);
        if (v == null) continue;
        value += pts ? v - 2 : v - h.par; // to par / vs expected
        thru += 1;
      }
      return { id: s.id, value, thru };
    });
    const started = rows.filter((r) => r.thru > 0);
    const best = started.length ? (pts ? Math.max(...started.map((r) => r.value)) : Math.min(...started.map((r) => r.value))) : null;
    const leaders = best == null ? [] : started.filter((r) => r.value === best).map((r) => r.id);
    const decided = subjects.length >= 2 && d.holes.length > 0 && rows.every((r) => r.thru === d.holes.length);
    return { key: d.key, label: d.label, holes: d.holes.map((h) => h.n), rows, leaders, decided };
  });
  const money = sumMoney(bets.filter((b) => b.decided).map((b) => potMoney(ids, b.leaders, stakeCents)));
  return { scoring: pts ? 'stableford' : 'stroke', net: o.net, bets, final: bets.every((b) => b.decided), money };
}

// ------------------------------------------------------------------ Stableford pot

/** Most Stableford points for the round takes the pot (stake from each player); ties split. */
export function stablefordPot({ holes, subjects, scores, stakeCents = 0, locked = false, quick = {} }) {
  const hs = sortHoles(holes);
  const rows = subjects.map((s) => {
    // Typed in from a paper card (points only, no hole scores): their card's points count as a full round.
    if (quick[s.id] != null && !Object.keys(scores?.[s.id] || {}).length) {
      const pts = Number(quick[s.id]);
      return { id: s.id, points: pts, thru: hs.length, vsExpected: pts - 2 * hs.length, quick: true };
    }
    let points = 0;
    let thru = 0;
    for (const h of hs) {
      const v = pointsValue(h, scores?.[s.id]?.[h.n], s.hcp, true, locked);
      if (v == null) continue;
      points += v;
      thru += 1;
    }
    return { id: s.id, points, thru, vsExpected: points - 2 * thru };
  });
  const started = rows.filter((r) => r.thru > 0);
  const best = started.length ? Math.max(...started.map((r) => r.vsExpected)) : null;
  const leaders = best == null ? [] : started.filter((r) => r.vsExpected === best).map((r) => r.id);
  const final = subjects.length >= 2 && hs.length > 0 && rows.every((r) => r.thru === hs.length);
  return { rows, leaders, final, pot: stakeCents * subjects.length, money: final ? potMoney(subjects.map((s) => s.id), leaders, stakeCents) : {} };
}

// ------------------------------------------------------------------ birdie pool

/**
 * Birdie pool: everyone puts in `stake`; each birdie or better (net or gross) takes one equal share of the pool.
 * Pick-ups never count. Paid out once everyone has finished; no birdies = everyone keeps their money.
 */
export function birdiePool({ holes, subjects, scores, options, stakeCents = 0, locked = false }) {
  const o = cleanOptions('birdie_pool', options);
  const hs = sortHoles(holes);
  const birdies = {};
  let finished = true;
  for (const s of subjects) {
    birdies[s.id] = [];
    for (const h of hs) {
      const sc = scores?.[s.id]?.[h.n];
      const st = holeState(sc, locked);
      if (st === 'none') { finished = false; continue; }
      if (st !== 'played') continue;
      const v = sc.strokes - (o.net ? strokesReceived(s.hcp, h.si) : 0);
      if (v <= h.par - 1) birdies[s.id].push(h.n);
    }
  }
  const shares = Object.values(birdies).reduce((a, b) => a + b.length, 0);
  const pool = stakeCents * subjects.length;
  const final = subjects.length >= 2 && hs.length > 0 && finished;
  const money = {};
  if (final && shares && stakeCents) {
    for (const s of subjects) addTo(money, s.id, -stakeCents);
    const parts = splitCents(pool, shares);
    let i = 0;
    for (const id of Object.keys(birdies).sort()) for (const _ of birdies[id]) addTo(money, id, parts[i++]); // eslint-disable-line no-unused-vars
  }
  return { birdies, shares, pool, perShare: shares ? Math.floor(pool / shares) : 0, final, money };
}

// ------------------------------------------------------------------ eclectic (trip-long)

/**
 * Eclectic: each player's best score on each hole across the trip's rounds on one course. Lowest total wins
 * (net uses each round's handicap; a pick-up counts as a net double bogey). Only a full card (every hole) can win.
 * rounds: [{ id, holes, subjects, scores, locked }] — individual rounds only (Ambrose teams don't count).
 * Everyone who played one of these rounds is in for `stake`. Decided when every round is locked.
 * Returns { rows: [{ id, name, best: { n: value }, covered, total, toPar, full }], leaders, final, money }.
 */
export function eclectic({ rounds, options, stakeCents = 0 }) {
  const o = cleanOptions('eclectic', options);
  const holes = sortHoles(rounds[0]?.holes || []);
  const par = Object.fromEntries(holes.map((h) => [h.n, h.par]));
  const best = {};
  const names = {};
  for (const r of rounds) {
    for (const s of r.subjects) {
      names[s.id] ||= s.name;
      const b = (best[s.id] ||= {});
      for (const h of sortHoles(r.holes)) {
        const v = strokeValue(h, r.scores?.[s.id]?.[h.n], s.hcp, o.net, r.locked);
        if (v != null && (b[h.n] == null || v < b[h.n])) b[h.n] = v;
      }
    }
  }
  const rows = Object.entries(best).map(([id, b]) => {
    const ns = Object.keys(b).map(Number);
    const total = ns.reduce((a, n) => a + b[n], 0);
    const toPar = ns.reduce((a, n) => a + b[n] - (par[n] ?? 0), 0);
    return { id, name: names[id], best: b, covered: ns.length, total, toPar, full: holes.length > 0 && ns.length === holes.length };
  }).sort((a, b) => (b.full - a.full) || a.toPar - b.toPar || b.covered - a.covered || String(a.name).localeCompare(String(b.name)));
  const full = rows.filter((r) => r.full);
  const low = full.length ? Math.min(...full.map((r) => r.total)) : null;
  const leaders = low == null ? [] : full.filter((r) => r.total === low).map((r) => r.id);
  const final = rounds.length > 0 && rounds.every((r) => r.locked) && rows.length >= 2;
  return { holes: holes.map((h) => h.n), rows, leaders, final, pot: stakeCents * rows.length, money: final ? potMoney(rows.map((r) => r.id), leaders, stakeCents) : {} };
}

// ------------------------------------------------------------------ putting it together

/**
 * Work out one game. ctx: { round, course, teams, roundPlayers, playersById, scoresIdx, tripRounds?, teamsByRound?,
 * roundPlayersByRound?, coursesById? } (the trip bits are for the eclectic).
 * Returns { game, kind, subjects, result, money: { playerId: cents } (decided money only), final, skipped? }.
 */
export function playGame(game, ctx) {
  const { round } = ctx;
  const stakeCents = toCents(game.stake);
  const locked = round.status === 'locked';
  if (!gameSuits(game.kind, round.format)) {
    return { game, kind: game.kind, subjects: [], result: null, money: {}, final: false, skipped: 'Not played in Ambrose rounds' };
  }
  if (game.kind === 'eclectic') {
    const tripRounds = (ctx.tripRounds || [round]).filter((r) => r.course_id === round.course_id && r.format !== 'ambrose');
    const rs = tripRounds.map((r) => ({
      id: r.id,
      holes: (ctx.coursesById?.[r.course_id] || ctx.course)?.holes || [],
      subjects: gameSubjects({ round: r, teams: ctx.teamsByRound?.[r.id] || (r.id === round.id ? ctx.teams : []) || [], roundPlayers: ctx.roundPlayersByRound?.[r.id] || (r.id === round.id ? ctx.roundPlayers : []) || [], playersById: ctx.playersById }),
      scores: ctx.scoresIdx?.[r.id] || {},
      locked: r.status === 'locked',
    }));
    const result = eclectic({ rounds: rs, options: game.options, stakeCents });
    const subjects = result.rows.map((r) => ({ id: r.id, name: r.name, members: [r.id] }));
    return { game, kind: game.kind, subjects, result, money: result.money, final: result.final, rounds: tripRounds.length };
  }
  const all = gameSubjects(ctx);
  const sc = ctx.scoresIdx?.[round.id] || {};
  // Paper-card players (points only, no hole scores) count in the Stableford pot; hole-by-hole games leave them out.
  const quick = Object.fromEntries((ctx.quickResults || []).filter((q) => q.round_id === round.id).map((q) => [q.player_id, q.points]));
  const isQuick = (s) => quick[s.id] != null && !Object.keys(sc[s.id] || {}).length;
  const subjects = game.kind === 'stableford_pot' ? all : all.filter((s) => !isQuick(s));
  const leftOut = all.filter(isQuick).map((s) => s.name);
  const args = { holes: ctx.course?.holes || [], subjects, scores: sc, options: game.options, stakeCents, locked, quick };
  const result = game.kind === 'skins' ? skins(args)
    : game.kind === 'nassau' ? nassau(args)
      : game.kind === 'stableford_pot' ? stablefordPot(args)
        : birdiePool(args);
  return { game, kind: game.kind, subjects, result, money: toPlayers(result.money, subjects), final: result.final,
    ...(game.kind !== 'stableford_pot' && leftOut.length ? { note: `Left out (paper card, no hole scores): ${leftOut.join(', ')}` } : {}) };
}

/**
 * The money tally: per player, net cents across the games given, plus the fewest payments to settle up.
 * Returns { rows: [{ id, cents }] best first, settle: [{ from, to, cents }], undecided: number of games not settled }.
 */
export function moneyTally(played) {
  const total = sumMoney(played.map((p) => p.money));
  const rows = Object.entries(total).map(([id, cents]) => ({ id, cents })).sort((a, b) => b.cents - a.cents || a.id.localeCompare(b.id));
  return { rows, settle: settleUp(total), undecided: played.filter((p) => !p.final && !p.skipped).length };
}
