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

// ------------------------------------------------------------------ standard options (073)
// Every standard setting of each game. Any mix of these is still the standard game (a custom game is only for a
// house twist on top — see customgames.js). col: 'options' = the 055 column (old app versions read it);
// 'settings' = round_games.settings (073), checked by the database against the same list.
//   bool: true/false. enum: one of values. money: dollars 0–1000, or null = the game's stake.
export const STANDARD_OPTIONS = {
  skins: [
    { key: 'net', type: 'bool', def: true, col: 'options', on: 'Net (with handicaps)', off: 'Gross' },
    { key: 'carry', type: 'bool', def: true, col: 'options', on: 'Ties carry over', off: 'No carry-overs' },
    { key: 'validate', type: 'bool', def: false, col: 'settings', on: 'Validated skins', off: 'No validation',
      help: 'A skin only counts if its winner at least ties the next hole. If not, it carries on to that hole.' },
  ],
  nassau: [
    { key: 'net', type: 'bool', def: true, col: 'options', on: 'Net (with handicaps)', off: 'Gross' },
    { key: 'scoring', type: 'enum', values: ['stroke', 'stableford'], def: 'stroke', col: 'options', labels: { stroke: 'Strokes', stableford: 'Stableford points' } },
    { key: 'front', type: 'money', def: null, col: 'settings', label: 'Front 9 bet ($)', help: 'Blank = the stake' },
    { key: 'back', type: 'money', def: null, col: 'settings', label: 'Back 9 bet ($)', help: 'Blank = the stake' },
    { key: 'total', type: 'money', def: null, col: 'settings', label: 'The 18 bet ($)', help: 'Blank = the stake' },
    { key: 'press', type: 'enum', values: [0, 2, 3], def: 0, col: 'settings', labels: { 0: 'No presses', 2: 'Auto-press at 2', 3: 'Auto-press at 3' },
      help: 'When the leader of a nine gets 2 (or 3) clear, a new bet starts on the next hole to the end of that nine. Up to 2 presses a nine.' },
  ],
  stableford_pot: [
    { key: 'net', type: 'bool', def: true, col: 'settings', on: 'Net points', off: 'Gross points' },
  ],
  birdie_pool: [
    { key: 'net', type: 'bool', def: true, col: 'options', on: 'Net (with handicaps)', off: 'Gross' },
    { key: 'eagle_double', type: 'bool', def: false, col: 'settings', on: 'Eagles count double', off: 'Eagles count once' },
  ],
  eclectic: [
    { key: 'net', type: 'bool', def: true, col: 'options', on: 'Net (with handicaps)', off: 'Gross' },
  ],
};

function cleanOne(spec, v) {
  if (spec.type === 'bool') return typeof v === 'boolean' ? v : spec.def;
  if (spec.type === 'enum') return spec.values.includes(v) ? v : spec.def;
  if (spec.type === 'money') {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/[$,\s]/g, ''));
    return Number.isFinite(n) && n >= 0 && n <= 1000 ? Math.round(n * 100) / 100 : spec.def;
  }
  return spec.def;
}

/** Every standard option of a game, defaults filled in, from any mix of sources (later ones win). */
export function fullOptions(kind, ...sources) {
  const merged = Object.assign({}, ...sources.map((x) => x || {}));
  const out = {};
  for (const spec of STANDARD_OPTIONS[kind] || []) out[spec.key] = cleanOne(spec, merged[spec.key]);
  return out;
}

/** A round_games row's full options (the 055 options plus the 073 settings). */
export const gameOptions = (game) => fullOptions(game?.kind, game?.options, game?.settings);

/** Split full options into the two columns: { options (055 check), settings (073 check) }. */
export function splitOptions(kind, full) {
  const o = fullOptions(kind, full);
  const options = {};
  const settings = {};
  for (const spec of STANDARD_OPTIONS[kind] || []) (spec.col === 'options' ? options : settings)[spec.key] = o[spec.key];
  return { options, settings };
}

/** Problems with a round_games.settings object for a kind (mirrors the database check in 073). [] = fine. */
export function settingsProblems(kind, settings = {}) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return ['Settings must be a set of options'];
  const specs = Object.fromEntries((STANDARD_OPTIONS[kind] || []).filter((s) => s.col === 'settings').map((s) => [s.key, s]));
  const out = [];
  for (const [k, v] of Object.entries(settings)) {
    const spec = specs[k];
    if (!spec) { out.push(`${k} isn’t an option for this game`); continue; }
    if (spec.type === 'bool' && typeof v !== 'boolean') out.push(`${k} is yes or no`);
    if (spec.type === 'enum' && !spec.values.includes(v)) out.push(`${k} isn’t one of the choices`);
    if (spec.type === 'money' && v != null && !(typeof v === 'number' && v >= 0 && v <= 1000)) out.push(`${k} is dollars, up to $1000`);
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

/** "Skins $5 (net, carry-overs)" — a game's one-line label. A custom game shows its own name (game.name). */
export function gameLabel(game) {
  const o = fullOptions(game.kind, game.options, game.settings);
  const bits = [];
  if ('net' in o && (game.kind !== 'stableford_pot' || o.net === false)) bits.push(o.net ? 'net' : 'gross');
  if (game.kind === 'skins') bits.push(o.carry ? 'carry-overs' : 'no carry-overs');
  if (game.kind === 'skins' && o.validate) bits.push('validated');
  if (game.kind === 'nassau' && o.scoring === 'stableford') bits.push('Stableford points');
  if (game.kind === 'nassau' && o.press) bits.push(`auto-press at ${o.press}`);
  if (game.kind === 'birdie_pool' && o.eagle_double) bits.push('eagles double');
  if (game.kind === 'eclectic') bits.push('for the trip');
  let money = formatMoney(toCents(game.stake));
  if (game.kind === 'nassau' && (o.front != null || o.back != null || o.total != null)) {
    const v = (x) => formatMoney(toCents(x != null ? x : game.stake));
    money = `${v(o.front)}/${v(o.back)}/${v(o.total)}`;
  }
  return `${game.name || GAME_INFO[game.kind]?.name || game.kind} ${money}${bits.length ? ` (${bits.join(', ')})` : ''}`;
}

/** Which games suit a round's format. Ambrose is played as teams: skins and Nassau only. */
export function gameSuits(kind, format) {
  if (format === 'ambrose') return kind === 'skins' || kind === 'nassau';
  return GAME_KINDS.includes(kind);
}
export const AMBROSE_NOTE = 'Ambrose rounds: skins and Nassau are played team v team (winnings split between the team). Stableford pot, birdie pool and eclectic are for individual rounds.';

// ------------------------------------------------------------------ who's in (098, 23 Oct 2026)
// Josh: "The side games need to be proposed by someone to other people, or put out for an opt-in."
// Each game has a "Who's in" setting (round_games.who_in):
//   'everyone' — everyone in the round (the default, and how every game worked before 098);
//   'opt_in'   — only players who tapped "I'm in" (round_game_players) are in its results and its money.
// Opt-ins close when the round starts (status live) or at its first tee time if one is set (Sydney time); after that
// the list is fixed, except an organiser can still add or take someone out. The database checks the same (098).
export const WHO_IN = {
  everyone: { label: 'Everyone in the round', short: 'Everyone' },
  opt_in: { label: 'Opt-in', short: 'Opt-in' },
};
export const AMBROSE_OPT_IN_NOTE = 'Ambrose: a team is in if any of its players is in (the team’s winnings and losses are split between all its players).';

/** Is this an opt-in game? (Anything else, including a row from before 098, is everyone.) */
export const isOptIn = (game) => game?.who_in === 'opt_in';

/** The player ids in an opt-in game, from round_game_players rows ({ game_id, player_id }). null = everyone. */
export function optInIds(game, optIns = []) {
  if (!isOptIn(game)) return null;
  return new Set((optIns || []).filter((o) => o.game_id === game.id).map((o) => o.player_id));
}

/** The subjects who are in. A team (Ambrose) is in if any of its players is in; a player if they are. */
export function subjectsIn(subjects, ids) {
  if (!ids) return subjects;
  return subjects.filter((s) => ids.has(s.id) || (s.members || []).some((m) => ids.has(m)));
}

/** "YYYY-MM-DD HH:MM" in Sydney, now. */
export function sydneyClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const v = (t) => parts.find((p) => p.type === t)?.value || '';
  return `${v('year')}-${v('month')}-${v('day')} ${v('hour') === '24' ? '00' : v('hour')}:${v('minute')}`;
}

const teeOk = (t) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(t || '')) ? String(t) : null);

/** "8:10am" from "08:10". */
export function clockWords(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
}

/** "Sat" / "Saturday" for a round's day (play_date), or '' with no date. */
export function roundDay(round, long = false) {
  const d = String(round?.play_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('en-AU', { weekday: long ? 'long' : 'short', timeZone: 'UTC' });
}

/**
 * Are opt-ins still open for a round's games? Same rule as the database (098 side_game_closes_at / side_game_open):
 * closed once the round is live or locked, or from its first tee time (the earliest tee time of its tee groups, on its
 * play date, Sydney time). No tee time set: open until the round starts.
 * teeGroups: tee_groups rows (any rounds; this round's are picked out). → { open, closesAt: "YYYY-MM-DD HH:MM" | null, words }
 */
export function optInState(round, teeGroups = [], now = new Date()) {
  if (!round) return { open: false, closesAt: null, words: '' };
  const day = String(round.play_date || '').slice(0, 10);
  const tee = (teeGroups || []).filter((t) => t.round_id === round.id).map((t) => teeOk(t.tee_time)).filter(Boolean).sort()[0] || null;
  const closesAt = tee && /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day} ${tee}` : null;
  const started = round.status === 'live' || round.status === 'locked';
  const open = !started && (!closesAt || sydneyClock(now) < closesAt);
  const when = closesAt ? ` (${clockWords(tee)}${roundDay(round) ? ` ${roundDay(round)}` : ''})` : '';
  const words = open ? `Opt-in closes at the first tee${when}` : `Opt-in closed at the first tee${when} — the list is fixed`;
  return { open, closesAt, words };
}

/** Rounds a side game can be put up for: opt-in still open, and today or later (or no date yet). Soonest first. */
export function proposableRounds(rounds = [], teeGroups = [], now = new Date()) {
  const today = sydneyClock(now).slice(0, 10);
  return rounds.filter((r) => optInState(r, teeGroups, now).open && (!r.play_date || String(r.play_date).slice(0, 10) >= today))
    .sort((a, b) => String(a.play_date || '9999').localeCompare(String(b.play_date || '9999')) || String(a.name).localeCompare(String(b.name)));
}

/** The round_games row for a proposed (opt-in) side game: a standard game, its default options, my stake. */
export function proposedRow({ id, roundId, kind, stake, me }) {
  return { id, round_id: roundId, kind, stake: Math.round(toCents(stake)) / 100, options: cleanOptions(kind, {}), who_in: 'opt_in', created_by: me };
}

/** "$5 skins" — a game in a few words (a custom game keeps its own name). */
const SHORT = { skins: 'skins', nassau: 'Nassau', stableford_pot: 'Stableford pot', birdie_pool: 'birdie pool', eclectic: 'eclectic' };
export function gameShort(game) {
  return `${formatMoney(toCents(game?.stake))} ${game?.name || SHORT[game?.kind] || 'side game'}`;
}

/** "Bo's put up $5 skins for Saturday. You in?" — the Feed post and notification words for a proposed game. */
export function proposeWords({ who = 'Someone', game, round }) {
  const day = roundDay(round, true) || round?.name || 'the round';
  return `${who}’s put up ${gameShort(game)} for ${day}. You in?`;
}

/** "Side games on offer: $5 skins Sat (6 in)" — one line for a game whose opt-in is open. */
export function offerLine(game, round, inCount) {
  const day = roundDay(round) || round?.name || '';
  return `${gameShort(game)}${day ? ` ${day}` : ''} (${inCount} in)`;
}

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
 * Validated skins (option): a skin won on a hole only counts once its winner at least ties the next hole (the last
 * hole needs no validation). Not validated: the hole shows 'unvalidated' and its skins carry on to that next hole
 * (or die, with carry-overs off). A hole waiting on validation shows 'won' with validating: true.
 */
export function skins({ holes, subjects, scores, options, stakeCents = 0, locked = false }) {
  const o = fullOptions('skins', options);
  const out = { holes: [], won: {}, pot: 0, final: false, money: {}, carry: o.carry, validate: o.validate };
  if (subjects.length < 2) return out;
  const award = (w, value) => {
    out.won[w] = (out.won[w] || 0) + value;
    for (const s of subjects) addTo(out.money, s.id, s.id === w ? value * stakeCents * (subjects.length - 1) : -value * stakeCents);
  };
  const sorted = sortHoles(holes);
  let carry = 0;
  let blocked = false;
  let pend = null; // { entry, w, value } — a skin waiting on the next hole to validate it
  for (const [i, h] of sorted.entries()) {
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
      if (o.carry || pend) blocked = true;
      continue;
    }
    const atLow = playing.filter((x) => x.v === low);
    if (blocked) {
      out.holes.push({ n: h.n, status: 'waiting', winner: atLow.length === 1 ? atLow[0].id : null, value: null, low, scores: shown });
      continue;
    }
    if (pend) {
      const wv = vals.find((x) => x.id === pend.w)?.v;
      if (wv != null && wv === low) {
        pend.entry.validating = false;
        award(pend.w, pend.value);
      } else {
        pend.entry.status = 'unvalidated';
        pend.entry.validating = false;
        if (o.carry) carry += pend.value;
      }
      pend = null;
    }
    const value = 1 + (o.carry ? carry : 0);
    if (atLow.length === 1) {
      const w = atLow[0].id;
      const last = i === sorted.length - 1;
      const entry = { n: h.n, status: 'won', winner: w, value, low, scores: shown };
      out.holes.push(entry);
      if (o.validate && !last) {
        entry.validating = true;
        pend = { entry, w, value };
      } else {
        award(w, value);
      }
      carry = 0;
    } else {
      out.holes.push({ n: h.n, status: 'tied', winner: null, value, low, scores: shown });
      carry = o.carry ? carry + 1 : 0;
    }
  }
  out.pot = blocked ? 0 : carry;
  out.final = out.holes.length > 0 && out.holes.every((x) => (x.status === 'won' && !x.validating) || x.status === 'tied' || x.status === 'unvalidated');
  return out;
}

// ------------------------------------------------------------------ Nassau

/**
 * Nassau: three bets — front 9, back 9 and the 18 (a 9-hole course has one bet). Best net (or gross) stroke total
 * wins, or most Stableford points (option). Leaders are compared on holes played so far (to par, or points vs 2 a
 * hole), so groups on different holes compare fairly. A bet is decided once everyone has finished its holes.
 * Everyone puts `stake` into each bet (or that bet's own value: front / back / total); the winners (ties split) take it.
 * Auto-press (option press = 2 or 3): within a nine (or a 9-hole course's only bet), once everyone has finished a
 * hole and the leader of the latest bet on that nine is `press` or more clear of everyone else, a new bet (a press,
 * same value) starts on the next hole and runs to the end of the nine. Up to 2 presses a nine.
 * Returns { scoring, bets: [{ key, label, holes, rows: [{ id, value, thru }], leaders, decided, press? }], final, money }.
 */
export function nassau({ holes, subjects, scores, options, stakeCents = 0, locked = false }) {
  const o = fullOptions('nassau', options);
  const hs = sortHoles(holes);
  const pts = o.scoring === 'stableford';
  const stakeOf = (key) => (o[key] != null ? toCents(o[key]) : stakeCents);
  const defs = hs.length > 9
    ? [
      { key: 'front', label: 'Front 9', holes: hs.filter((h) => h.n <= 9), nine: true },
      { key: 'back', label: 'Back 9', holes: hs.filter((h) => h.n > 9), nine: true },
      { key: 'total', label: 'The 18', holes: hs },
    ]
    : [{ key: 'total', label: `All ${hs.length}`, holes: hs, nine: true }];
  const ids = subjects.map((s) => s.id);
  const holeVal = (s, h) => {
    const v = pts ? pointsValue(h, scores?.[s.id]?.[h.n], s.hcp, o.net, locked) : strokeValue(h, scores?.[s.id]?.[h.n], s.hcp, o.net, locked);
    return v == null ? null : pts ? v - 2 : v - h.par; // to par / vs expected
  };
  const betOn = (d) => {
    const rows = subjects.map((s) => {
      let value = 0;
      let thru = 0;
      for (const h of d.holes) {
        const v = holeVal(s, h);
        if (v == null) continue;
        value += v;
        thru += 1;
      }
      return { id: s.id, value, thru };
    });
    const started = rows.filter((r) => r.thru > 0);
    const best = started.length ? (pts ? Math.max(...started.map((r) => r.value)) : Math.min(...started.map((r) => r.value))) : null;
    const leaders = best == null ? [] : started.filter((r) => r.value === best).map((r) => r.id);
    const decided = subjects.length >= 2 && d.holes.length > 0 && rows.every((r) => r.thru === d.holes.length);
    return { key: d.key, label: d.label, holes: d.holes.map((h) => h.n), rows, leaders, decided, stake: d.stake, ...(d.press ? { press: d.press } : {}) };
  };
  const bets = [];
  for (const d of defs) {
    const stake = stakeOf(d.key);
    bets.push(betOn({ ...d, stake }));
    if (!o.press || !d.nine || subjects.length < 2) continue;
    // Presses: walk the nine's holes everyone has finished, in order.
    let cur = d.holes;
    let presses = 0;
    for (let i = 0; i < d.holes.length - 1 && presses < 2; i += 1) {
      const h = d.holes[i];
      if (subjects.some((s) => holeVal(s, h) == null)) break;
      const upTo = cur.filter((x) => x.n <= h.n);
      if (!upTo.length) continue;
      const totals = subjects.map((s) => upTo.reduce((a, x) => a + holeVal(s, x), 0)).sort((a, b) => (pts ? b - a : a - b));
      if (Math.abs(totals[0] - totals[1]) >= o.press) {
        presses += 1;
        cur = d.holes.slice(i + 1);
        bets.push(betOn({ key: `${d.key}_press${presses}`, label: `${d.label} press (from ${cur[0].n})`, holes: cur, stake, press: presses }));
      }
    }
  }
  const money = sumMoney(bets.filter((b) => b.decided).map((b) => potMoney(ids, b.leaders, b.stake)));
  return { scoring: pts ? 'stableford' : 'stroke', net: o.net, press: o.press, bets, final: bets.every((b) => b.decided), money };
}

// ------------------------------------------------------------------ Stableford pot

/** Most Stableford points for the round takes the pot (stake from each player); ties split. Net unless net: false. */
export function stablefordPot({ holes, subjects, scores, options, stakeCents = 0, locked = false, quick = {} }) {
  const net = fullOptions('stableford_pot', options).net;
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
      const v = pointsValue(h, scores?.[s.id]?.[h.n], s.hcp, net, locked);
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
 * Eagles count double (option): an eagle or better takes two shares.
 */
export function birdiePool({ holes, subjects, scores, options, stakeCents = 0, locked = false }) {
  const o = fullOptions('birdie_pool', options);
  const hs = sortHoles(holes);
  const birdies = {};
  const eagles = {};
  let finished = true;
  for (const s of subjects) {
    birdies[s.id] = [];
    eagles[s.id] = [];
    for (const h of hs) {
      const sc = scores?.[s.id]?.[h.n];
      const st = holeState(sc, locked);
      if (st === 'none') { finished = false; continue; }
      if (st !== 'played') continue;
      const v = sc.strokes - (o.net ? strokesReceived(s.hcp, h.si) : 0);
      if (v <= h.par - 1) birdies[s.id].push(h.n);
      if (o.eagle_double && v <= h.par - 2) eagles[s.id].push(h.n);
    }
  }
  const sharesOf = (id) => birdies[id].length + eagles[id].length;
  const shares = Object.keys(birdies).reduce((a, id) => a + sharesOf(id), 0);
  const pool = stakeCents * subjects.length;
  const final = subjects.length >= 2 && hs.length > 0 && finished;
  const money = {};
  if (final && shares && stakeCents) {
    for (const s of subjects) addTo(money, s.id, -stakeCents);
    const parts = splitCents(pool, shares);
    let i = 0;
    for (const id of Object.keys(birdies).sort()) for (let k = 0; k < sharesOf(id); k += 1) addTo(money, id, parts[i++]);
  }
  return { birdies, eagles, shares, pool, perShare: shares ? Math.floor(pool / shares) : 0, final, money };
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
 * roundPlayersByRound?, coursesById?, optIns? } (the trip bits are for the eclectic; optIns: round_game_players rows).
 * An opt-in game (098) counts only the players who are in — results and money. For Ambrose, a team is in if any of its
 * players is in.
 * Returns { game, kind, subjects, result, money: { playerId: cents } (decided money only), final, skipped?,
 *   optIn?: { ids: [playerId], teamNote? } }.
 */
export function playGame(game, ctx) {
  const { round } = ctx;
  const stakeCents = toCents(game.stake);
  const locked = round.status === 'locked';
  const inIds = optInIds(game, ctx.optIns);
  const optIn = inIds ? { ids: [...inIds].sort(), ...(round.format === 'ambrose' ? { teamNote: AMBROSE_OPT_IN_NOTE } : {}) } : null;
  const withIn = (x) => (optIn ? { ...x, optIn } : x);
  if (!gameSuits(game.kind, round.format)) {
    return withIn({ game, kind: game.kind, subjects: [], result: null, money: {}, final: false, skipped: 'Not played in Ambrose rounds' });
  }
  if (game.kind === 'eclectic') {
    const tripRounds = (ctx.tripRounds || [round]).filter((r) => r.course_id === round.course_id && r.format !== 'ambrose');
    const rs = tripRounds.map((r) => ({
      id: r.id,
      holes: (ctx.coursesById?.[r.course_id] || ctx.course)?.holes || [],
      subjects: subjectsIn(gameSubjects({ round: r, teams: ctx.teamsByRound?.[r.id] || (r.id === round.id ? ctx.teams : []) || [], roundPlayers: ctx.roundPlayersByRound?.[r.id] || (r.id === round.id ? ctx.roundPlayers : []) || [], playersById: ctx.playersById }), inIds),
      scores: ctx.scoresIdx?.[r.id] || {},
      locked: r.status === 'locked',
    }));
    const result = eclectic({ rounds: rs, options: gameOptions(game), stakeCents });
    const subjects = result.rows.map((r) => ({ id: r.id, name: r.name, members: [r.id] }));
    return withIn({ game, kind: game.kind, subjects, result, money: result.money, final: result.final, rounds: tripRounds.length });
  }
  const all = subjectsIn(gameSubjects(ctx), inIds);
  const sc = ctx.scoresIdx?.[round.id] || {};
  // Paper-card players (points only, no hole scores) count in the Stableford pot; hole-by-hole games leave them out.
  const quick = Object.fromEntries((ctx.quickResults || []).filter((q) => q.round_id === round.id).map((q) => [q.player_id, q.points]));
  const isQuick = (s) => quick[s.id] != null && !Object.keys(sc[s.id] || {}).length;
  const subjects = game.kind === 'stableford_pot' ? all : all.filter((s) => !isQuick(s));
  const leftOut = all.filter(isQuick).map((s) => s.name);
  const args = { holes: ctx.course?.holes || [], subjects, scores: sc, options: gameOptions(game), stakeCents, locked, quick };
  const result = game.kind === 'skins' ? skins(args)
    : game.kind === 'nassau' ? nassau(args)
      : game.kind === 'stableford_pot' ? stablefordPot(args)
        : birdiePool(args);
  return withIn({ game, kind: game.kind, subjects, result, money: toPlayers(result.money, subjects), final: result.final,
    ...(game.kind !== 'stableford_pot' && leftOut.length ? { note: `Left out (paper card, no hole scores): ${leftOut.join(', ')}` } : {}) });
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
