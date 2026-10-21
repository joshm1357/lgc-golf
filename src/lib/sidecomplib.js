// The side comps library (migration 068, feature 'side_comps'): a catalogue organisers pick from with one tap, the
// "dots" tallies, and the comps worked out from the scores. Pure functions, no screen code.
//
// A library comp is still a row in side_comp_defs (051), with three extra columns from 068:
//   preset   — the catalogue key it came from (e.g. 'greenie'), so the picker knows it's already added;
//   scoring  — null: measured or picked like any own comp (how = lowest | highest | pick);
//              'count': a tally — players log each time it happens, most wins;
//              'count_last': whoever logged last holds it (the snake);
//              'auto': worked out from the scores already entered — no entries at all;
//   settings — for 'auto': { metric, basis: 'gross' | 'net' }.
// Default holes come from the round's course: e.g. a greenie goes on every par 3.
import { strokesReceived, stablefordPoints, strokeHoleNet, rankRows } from './scoring.js';

export const MAX_PER_ROUND = 20; // matches the database check (068)

export const LIB_GROUPS = [
  { key: 'measured', label: 'Measured on a hole', short: 'Measured', blurb: 'Someone measures it; best number wins.' },
  { key: 'dots', label: 'Dots — tally comps', short: 'Dots', blurb: 'Tap +1 each time it happens. Most dots wins.' },
  { key: 'penalty', label: 'Penalty dots (for laughs)', short: 'Penalty dots', blurb: 'The ones nobody wants to win.' },
  { key: 'auto', label: 'From the scores', short: 'From scores', blurb: 'Worked out from the scores — nothing to enter.' },
  { key: 'picks', label: 'Organiser picks', short: 'Picks', blurb: 'Anyone nominates; the organiser picks the winner.' },
];

// holes: 'par3' | 'par4' | 'par5' (every hole of that par on the round's course) | 'whole' (the whole round).
const M = (key, name, emoji, how, unit, holes, blurb) => ({ key, group: 'measured', name, emoji, how, unit, scoring: null, settings: {}, holes, blurb });
const D = (key, name, emoji, holes, blurb, group = 'dots', scoring = 'count') => ({ key, group, name, emoji, how: scoring === 'count_last' ? 'pick' : 'highest', unit: null, scoring, settings: {}, holes, blurb });
const A = (key, name, emoji, metric, basis, blurb) => ({ key, group: 'auto', name, emoji, how: metric === 'wipes' ? 'lowest' : 'highest', unit: null, scoring: 'auto', settings: { metric, basis }, holes: 'whole', blurb });
const P = (key, name, emoji, blurb) => ({ key, group: 'picks', name, emoji, how: 'pick', unit: null, scoring: null, settings: {}, holes: 'whole', blurb });

export const LIBRARY = [
  M('ntp_in_2', 'Nearest the pin in 2', '🎯', 'lowest', 'm', 'par4', 'Your second shot on a par 4 — closest to the pin wins.'),
  M('ntp_in_3', 'Nearest the pin in 3', '🎯', 'lowest', 'm', 'par5', 'Your third shot on a par 5 — closest to the pin wins.'),
  M('longest_putt', 'Longest putt holed', '🕳️', 'highest', 'm', 'whole', 'The longest putt that drops, any hole.'),
  M('closest_chip', 'Closest chip', '🪄', 'lowest', 'm', 'whole', 'A chip from off the green — closest to the pin wins.'),
  M('ld_fairway', 'Longest drive in the fairway', '💣', 'highest', 'm', 'par5', 'Longest drive that finishes on the short grass.'),
  M('closest_line', 'Closest to the line', '📏', 'lowest', 'm', 'par4', 'Drive closest to the middle of the fairway.'),
  M('bunker_ntp', 'Nearest the pin from the bunker', '🏖️', 'lowest', 'm', 'whole', 'Out of the sand — closest to the pin wins.'),
  M('longest_holeout', 'Longest hole-out', '🚀', 'highest', 'm', 'whole', 'Holed from off the green — the longest one wins.'),

  D('greenie', 'Greenie', '🟢', 'par3', 'On the green in one on a par 3 and make par or better.'),
  D('sandy', 'Sandy', '🏝️', 'whole', 'Up and down from a bunker — out in one, in with the next.'),
  D('chippie', 'Chippie', '🥔', 'whole', 'Chip in from off the green.'),
  D('barkie', 'Barkie', '🌳', 'whole', 'Hit a tree and still make par or better.'),
  D('arnie', 'Arnie', '🦅', 'whole', 'Make par or better without touching the fairway.'),
  D('ferret', 'Ferret', '🦦', 'whole', 'Hole out from off the green (any shot that isn’t a putt).'),
  D('polie', 'Polie', '🚩', 'whole', 'Hole a putt longer than the flagstick.'),
  D('birdie_par3', 'Birdie on a par 3', '🐤', 'par3', 'Birdie (or better) on a par 3.'),
  D('hogan', 'Hogan', '🎩', 'whole', 'Fairway, green in regulation and par or better — the perfect hole.'),
  D('froggy', 'Froggy', '🐸', 'whole', 'Skip it off the water and still make par.'),

  D('snake', 'The snake', '🐍', 'whole', 'Three-putt and you hold the snake until someone else three-putts. Last to hold it loses.', 'penalty', 'count_last'),
  D('three_putts', 'Three-putts', '😩', 'whole', 'Every three-putt counts. Most is the worst.', 'penalty'),
  D('lost_balls', 'Lost balls', '🔍', 'whole', 'Every ball you lose. Most is the worst.', 'penalty'),
  D('air_shots', 'Air shots', '💨', 'whole', 'Swing and miss. Most is the worst.', 'penalty'),
  D('water_balls', 'Water balls', '💦', 'whole', 'Every ball in the drink. Most is the worst.', 'penalty'),
  D('shanks', 'Shanks', '🦀', 'whole', 'Every shank. Don’t say it out loud.', 'penalty'),

  A('birdies_gross', 'Most birdies', '🐦', 'birdies', 'gross', 'Birdies or better off the stick (eagles count too).'),
  A('birdies_net', 'Most net birdies', '🐦', 'birdies', 'net', 'Net birdies or better, after your handicap shots.'),
  A('most_pars', 'Most pars', '🅿️', 'pars', 'gross', 'Pars off the stick.'),
  A('best_front9', 'Best front 9', '1️⃣', 'front9', 'net', 'Best score on holes 1 to 9.'),
  A('best_back9', 'Best back 9', '🔟', 'back9', 'net', 'Best score on holes 10 to 18.'),
  A('best_par3s', 'Best on the par 3s', '3️⃣', 'par3s', 'net', 'Best score across the par 3s.'),
  A('best_par4s', 'Best on the par 4s', '4️⃣', 'par4s', 'net', 'Best score across the par 4s.'),
  A('best_par5s', 'Best on the par 5s', '5️⃣', 'par5s', 'net', 'Best score across the par 5s.'),
  A('fewest_wipes', 'Fewest wipes', '🧽', 'wipes', 'net', 'Fewest holes where you scored no Stableford points.'),
  A('bogey_train', 'The bogey train', '🚂', 'bogeys', 'gross', 'Most bogeys off the stick. Choo choo.'),
  A('best_finish', 'Best finish', '🏁', 'finish', 'net', 'Best score on the last 3 holes.'),
  A('most_improved', 'Most improved', '📈', 'improved', 'net', 'Most Stableford points better than your previous round, hole for hole.'),

  P('shot_of_day', 'Shot of the day', '⭐', 'Anyone nominates a shot; the organiser picks the best.'),
  P('worst_shot', 'Worst shot of the day', '🙈', 'Anyone nominates; the organiser picks the worst.'),
  P('best_excuse', 'Best excuse', '🤥', 'The wind, the sun, the bloke talking on the backswing…'),
  P('best_dressed', 'Best dressed', '👔', 'Or worst dressed — the organiser decides.'),
];

export const findPreset = (key) => LIBRARY.find((p) => p.key === key) || null;

/** The library, filtered by group ('all' or a group key) and a search ("sand", "par 3"…). */
export function searchLibrary(query = '', group = 'all') {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  return LIBRARY.filter((p) => {
    if (group !== 'all' && p.group !== group) return false;
    if (!words.length) return true;
    const text = `${p.name} ${p.blurb} ${holesLabel(p)} ${LIB_GROUPS.find((g) => g.key === p.group)?.label || ''}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

// ------------------------------------------------------------------ the words

const AUTO_WON = {
  birdies: 'Most birdies (or better) wins',
  pars: 'Most pars wins',
  bogeys: 'Most bogeys “wins”',
  wipes: 'Fewest wipes wins',
  front9: 'Best score on the front 9 wins',
  back9: 'Best score on the back 9 wins',
  par3s: 'Best score on the par 3s wins',
  par4s: 'Best score on the par 4s wins',
  par5s: 'Best score on the par 5s wins',
  finish: 'Best score on the last 3 holes wins',
  improved: 'Biggest improvement wins',
};

/** "How it's won", in plain words, for any comp (library or the group's own). */
export function wonText(def) {
  if (!def) return '';
  if (def.scoring === 'count') return def.preset && findPreset(def.preset)?.group === 'penalty' ? 'Tap +1 each time. Most dots “wins”' : 'Tap +1 each time. Most dots wins';
  if (def.scoring === 'count_last') return 'Tap +1 when it happens. Whoever logged it last holds it';
  if (def.scoring === 'auto') {
    const m = def.settings?.metric;
    const segment = ['front9', 'back9', 'par3s', 'par4s', 'par5s', 'finish'].includes(m);
    const basis = segment ? ' — Stableford points, or net strokes in stroke play' : m === 'birdies' || m === 'pars' || m === 'bogeys' ? (def.settings?.basis === 'net' ? ' (net)' : ' (off the stick)') : '';
    return `${AUTO_WON[m] || 'Worked out from the scores'}${basis}. Worked out from the scores`;
  }
  if (def.how === 'pick') return 'The organiser picks the winner';
  return `${def.how === 'highest' ? 'Biggest' : 'Smallest'} number wins${def.unit ? ` (${def.unit})` : ''}`;
}

/** "All par 3s", "Whole round"… for a preset's default holes. */
export function holesLabel(preset) {
  if (preset?.scoring === 'auto') return 'From the scores';
  return { par3: 'All par 3s', par4: 'All par 4s', par5: 'All par 5s' }[preset?.holes] || 'Whole round';
}

/** 'tally' | 'auto' | 'pick' | 'measured' — how the comp screen shows it. */
export function compKind(def) {
  if (def?.scoring === 'count' || def?.scoring === 'count_last') return 'tally';
  if (def?.scoring === 'auto') return 'auto';
  return def?.how === 'pick' ? 'pick' : 'measured';
}

// ------------------------------------------------------------------ adding from the list

/** The side_comp_defs row for a preset. */
export function defFromPreset(preset) {
  return {
    name: preset.name, emoji: preset.emoji, how: preset.how, unit: preset.unit, preset: preset.key,
    scoring: preset.scoring, settings: preset.settings || {},
  };
}

/** A preset's default holes on a course (sorted). Whole round (or a course without pars) = []. */
export function defaultHoles(preset, course) {
  const par = { par3: 3, par4: 4, par5: 5 }[preset?.holes];
  if (!par || preset?.scoring === 'auto') return [];
  return (course?.holes || []).filter((h) => Number(h.par) === par).map((h) => Number(h.n)).filter((n) => n >= 1 && n <= 18).sort((a, b) => a - b);
}

/**
 * Switch a comp on for a trip's rounds with the preset's default holes. Returns [{ round, own_comps }] — only the
 * rounds that change. Skips locked rounds, rounds that already have it, rounds at the limit, and (for comps worked
 * out from the scores) Ambrose rounds, which are played as teams.
 */
export function roundsToAdd(rounds, defId, preset, coursesById = {}) {
  const out = [];
  for (const r of rounds || []) {
    if (r.status === 'locked') continue;
    if (preset?.scoring === 'auto' && r.format === 'ambrose') continue;
    const own = r.own_comps || [];
    if (own.some((c) => c.comp === defId) || own.length >= MAX_PER_ROUND) continue;
    out.push({ round: r, own_comps: [...own, { comp: defId, holes: defaultHoles(preset, coursesById[r.course_id]) }] });
  }
  return out;
}

// ------------------------------------------------------------------ dots (tallies)

const ts = (e) => String(e?.created_at || '');

/**
 * Tally standings. entries: side_comp_entries rows (each one dot). playerIds: everyone in the round (shown at 0).
 * Returns { rows: [{ id, count, rank, rankLabel }] most first, total, holder (count_last: who logged last), leaders }.
 */
export function tallyStandings(entries = [], { scoring = 'count', playerIds = [], names = {} } = {}) {
  const counts = Object.fromEntries(playerIds.map((id) => [id, 0]));
  for (const e of entries) counts[e.player_id] = (counts[e.player_id] || 0) + 1;
  const rows = rankRows(Object.entries(counts).map(([id, count]) => ({ id, count, name: names[id] || id })), { key: 'count', higherBetter: true });
  const latest = [...entries].sort((a, b) => ts(a).localeCompare(ts(b))).pop();
  const total = entries.length;
  const leaders = total ? rows.filter((r) => r.rank === 1 && r.count > 0).map((r) => r.id) : [];
  return { rows, total, holder: scoring === 'count_last' && latest ? latest.player_id : null, since: latest?.created_at || null, leaders };
}

/** A player's latest dot (to undo a mis-tap). */
export function lastDotFor(entries = [], playerId) {
  return [...entries].filter((e) => e.player_id === playerId).sort((a, b) => ts(a).localeCompare(ts(b))).pop() || null;
}

// ------------------------------------------------------------------ worked out from the scores

export const AUTO_METRICS = Object.keys(AUTO_WON);

function holeState(score, locked) {
  if (score && score.picked_up) return 'pickup';
  if (score && score.strokes != null) return 'played';
  return locked ? 'pickup' : 'none';
}

const sortHoles = (holes) => [...(holes || [])].sort((a, b) => a.n - b.n);

/** The holes a metric looks at, on this course. */
export function metricHoles(metric, holes) {
  const hs = sortHoles(holes);
  if (metric === 'front9') return hs.filter((h) => h.n <= 9);
  if (metric === 'back9') return hs.filter((h) => h.n >= 10);
  if (metric === 'par3s') return hs.filter((h) => h.par === 3);
  if (metric === 'par4s') return hs.filter((h) => h.par === 4);
  if (metric === 'par5s') return hs.filter((h) => h.par === 5);
  if (metric === 'finish') return hs.slice(-3);
  return hs;
}

const pts = (h, sc, hcp, st) => (st === 'pickup' ? 0 : stablefordPoints(h, sc.strokes, hcp, false));

/** Is lower better for this metric in this format? */
export function lowerWins(metric, format) {
  if (metric === 'wipes') return true;
  if (['front9', 'back9', 'par3s', 'par4s', 'par5s', 'finish'].includes(metric)) return format === 'stroke';
  return false;
}

const signed = (v) => (v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0');
const toPar = (v) => (v === 0 ? 'E' : signed(v));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "3 birdies", "14 pts", "+2", "+5 pts" — a standing's number in words. */
export function autoDisplay(metric, format, value) {
  if (value == null) return '–';
  if (metric === 'birdies') return plural(value, 'birdie');
  if (metric === 'pars') return plural(value, 'par');
  if (metric === 'bogeys') return plural(value, 'bogey');
  if (metric === 'wipes') return plural(value, 'wipe');
  if (metric === 'improved') return `${signed(value)} pts`;
  return format === 'stroke' ? toPar(value) : `${value} pts`;
}

/**
 * Standings for a comp worked out from the scores, for one round. Individual formats only (Stableford, stroke play,
 * 4BBB — each player's own ball); Ambrose is skipped (played as teams).
 * subjects: [{ id, name, hcp }] (games.js gameSubjects). scores: { [subjectId]: { [hole]: { strokes, picked_up } } }.
 * basis: 'gross' | 'net' for birdies / pars / bogeys. Front 9, par 3s, finish and the like use Stableford points
 * (stroke play: net strokes to par, lower wins). Wipes are holes with no Stableford points (pick-ups included).
 * Most improved compares Stableford points with each player's previous round on the same hole numbers they've played
 * in both: prev = { [subjectId]: { holes, scores, hcp } }.
 * Returns { rows (ranked, best first), lowerWins, final, leaders, holes (the metric's hole count), skipped? }.
 */
export function autoStandings({ metric, basis = 'gross', format, holes = [], subjects = [], scores = {}, locked = false, prev = {} }) {
  if (format === 'ambrose') return { rows: [], lowerWins: false, final: false, leaders: [], holes: 0, skipped: 'Worked out for individual rounds only — not Ambrose.' };
  if (!AUTO_METRICS.includes(metric)) return { rows: [], lowerWins: false, final: false, leaders: [], holes: 0, skipped: 'Unknown comp.' };
  const hs = metricHoles(metric, holes);
  const lower = lowerWins(metric, format);
  const net = basis === 'net';
  const rows = subjects.map((s) => {
    const sc = scores?.[s.id] || {};
    let value = 0;
    let thru = 0;
    let compared = 0;
    for (const h of hs) {
      const st = holeState(sc[h.n], locked);
      if (st === 'none') continue;
      thru += 1;
      if (metric === 'birdies' || metric === 'pars' || metric === 'bogeys') {
        if (st !== 'played') continue; // a pick-up never makes a birdie, a par or a bogey
        const diff = sc[h.n].strokes - (net ? strokesReceived(s.hcp, h.si) : 0) - h.par;
        if ((metric === 'birdies' && diff <= -1) || (metric === 'pars' && diff === 0) || (metric === 'bogeys' && diff === 1)) value += 1;
      } else if (metric === 'wipes') {
        if (pts(h, sc[h.n], s.hcp, st) === 0) value += 1;
      } else if (metric === 'improved') {
        const p = prev?.[s.id];
        const ph = p?.holes?.find((x) => x.n === h.n);
        const ps = p?.scores?.[h.n];
        const pst = holeState(ps, false);
        if (!ph || pst === 'none') continue;
        value += pts(h, sc[h.n], s.hcp, st) - pts(ph, ps, p.hcp, pst);
        compared += 1;
      } else if (format === 'stroke') {
        value += strokeHoleNet(h, sc[h.n], s.hcp); // pick-up = net double bogey
      } else {
        value += pts(h, sc[h.n], s.hcp, st);
      }
    }
    const has = metric === 'improved' ? compared > 0 : thru > 0;
    return { id: s.id, name: s.name, value: has ? value : null, thru, sortValue: has ? value : lower ? 1e9 : -1e9 };
  });
  const ranked = rankRows(rows, { key: 'sortValue', higherBetter: !lower }).map((r) => ({
    ...r, rankLabel: r.value == null ? '–' : r.rankLabel, display: autoDisplay(metric, format, r.value),
  }));
  const final = subjects.length > 0 && hs.length > 0 && rows.every((r) => r.thru === hs.length);
  const leaders = ranked.filter((r) => r.rank === 1 && r.value != null).map((r) => r.id);
  return { rows: ranked, lowerWins: lower, final, leaders, holes: hs.length };
}

/**
 * Each player's previous round (for most improved): the latest earlier individual round of the same trip where they
 * have a score. earlier: [{ round, holes, subjects: [{ id, hcp }], scores }] in any order.
 * Returns { [subjectId]: { holes, scores, hcp, roundId } }.
 */
export function previousRounds(round, earlier = []) {
  const key = (r) => `${r.play_date || ''}|${r.created_at || ''}`;
  const before = earlier
    .filter((e) => e.round.id !== round.id && e.round.format !== 'ambrose' && (!round.trip_id || e.round.trip_id === round.trip_id) && key(e.round) < key(round))
    .sort((a, b) => key(a.round).localeCompare(key(b.round)));
  const out = {};
  for (const e of before) {
    for (const s of e.subjects || []) {
      const sc = e.scores?.[s.id];
      if (sc && Object.values(sc).some((x) => x && (x.strokes != null || x.picked_up))) out[s.id] = { holes: e.holes, scores: sc, hcp: s.hcp, roundId: e.round.id };
    }
  }
  return out;
}
