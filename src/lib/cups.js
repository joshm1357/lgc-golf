// The group's cups (ov32, migration 101; Josh 23 Oct 2026: "When you set up a cup you select what it is for in
// general, i.e. in the group. Then you choose which one is up for grabs that trip and set specifics, i.e. what round
// etc."). Pure functions, no screen code. The screens: components/CupsUpForGrabs.jsx (the run-up and Organise step 6),
// components/CupStandings.jsx (standings, cap tips) and components/ComingSoon.jsx.
//
//   * The cup library (public.cups): a cup is for golf (decided by scores), the weekend (social: decided by points) or
//     both (combined: golf placings turned into points, plus the social points). Set up once.
//   * Up for grabs on a trip = a comps row with cup_id (and its trophy). Golf cups use the comp kinds that already
//     exist; social, combined and eclectic cups are kind 'manual' with settings.cup and settings.counts.
//   * What counts (settings.counts): each source on or off, with its points. Worked out here at standings time, except
//     awards and fines, side activities, organiser adjustments and cap tips, which are cup_points rows (100 / 101).
//   * cupStandings(cup comp, data) — rows with a plain breakdown per player. ov33's presentation reads it.
//
// No money here: games count as "bets won", never dollars.
import { roundBoard } from './board.js';
import { rankRows } from './scoring.js';
import { matchState, cupTotals } from './cup.js';
import { compStandings, compRounds, leadWho, dayOf, COMP_TYPE } from './comps.js';
import { compsForRound, sortOwnEntries } from './sidecomps.js';
import { bestEntry } from './awards.js';
import { findPreset } from './sidecomplib.js';
import { playGame, eclectic, gameSubjects } from './games.js';
import { tripSpan } from './activetrip.js';

// ------------------------------------------------------------------ what a cup is for

export const PURPOSES = [
  { key: 'golf', emoji: '⛳', name: 'Golf', blurb: 'Decided by the scores.' },
  { key: 'social', emoji: '🎉', name: 'Weekend', blurb: 'Decided by points: awards, fines, side comps, tips, cap tips and more.' },
  { key: 'combined', emoji: '🏅', name: 'Combined', blurb: 'Golf placings turned into points, plus the weekend’s points.' },
];
export const PURPOSE = Object.fromEntries(PURPOSES.map((p) => [p.key, p]));

/** Golf formats a cup can be decided by, and the comp kind each one plays as on a trip. */
export const GOLF_FORMATS = [
  { key: 'stableford', kind: 'individual_points', name: 'Stableford over rounds', how: 'Most Stableford points over the rounds that count wins.' },
  { key: 'stroke', kind: 'individual_net', name: 'Stroke (net)', how: 'Lowest net score to par over the rounds that count wins.' },
  { key: 'ambrose', kind: 'ambrose_teams', name: 'Ambrose teams', how: 'Best net Ambrose score wins (added up if more than one round counts).' },
  { key: 'fourball', kind: 'fourball_pairs', name: '4BBB pairs', how: 'Most better-ball points wins.' },
  { key: 'match_play', kind: 'cup', name: 'Match play teams (Ryder Cup-style)', how: 'Two sides, a point for each match won. More than half the points wins.', needsCup: true },
  { key: 'eclectic', kind: 'manual', name: 'Eclectic', how: 'Your best score on each hole over the rounds that count. Lowest total wins.' },
];
export const GOLF_FORMAT = Object.fromEntries(GOLF_FORMATS.map((f) => [f.key, f]));

/** settings.cup on a trip's comp: the cups worked out here rather than by compStandings. */
export const CUP_KINDS = ['social', 'combined', 'eclectic'];
export const isCupComp = (comp) => comp?.kind === 'manual' && CUP_KINDS.includes(comp?.settings?.cup);

// ------------------------------------------------------------------ cap tips: the group's name for them

export const CAP_TIP_NAMES = {
  cap: { key: 'cap', name: 'Cap tips', one: 'cap tip', emoji: '🧢' },
  fist: { key: 'fist', name: 'Fist bumps', one: 'fist bump', emoji: '👊' },
  shout: { key: 'shout', name: 'Shout-outs', one: 'shout-out', emoji: '📣' },
};
export const capTipName = (key) => CAP_TIP_NAMES[key] || CAP_TIP_NAMES.cap;
export const UNDO_MINUTES = 10;

// ------------------------------------------------------------------ what counts towards a cup

/**
 * The sources, in the order the screen lists them. fields: the numbers the organiser can set (with defaults).
 * stored: true = cup_points rows (written when it happens); false = worked out from what's already in the app.
 */
export const SOURCES = [
  { key: 'awards', emoji: '🏷', name: 'Awards and fines', blurb: 'Points set on each award or fine (“Counts towards” this cup).', stored: true, fields: {} },
  { key: 'placings', emoji: '⛳', name: 'Golf results', blurb: 'Points for each place in the rounds you pick (ties share).', stored: false, fields: { scale: [5, 3, 1] } },
  { key: 'matches', emoji: '⚔️', name: 'Team matches', blurb: 'Cup matches: everyone on the winning side (half for a halve).', stored: false, fields: { per_win: 1 } },
  { key: 'side', emoji: '🎯', name: 'Side comps', blurb: 'Closest to the pin, longest drive, your own comps and dots.', stored: false, fields: { ctp: 1, ld: 1, own: 1, dot: 1, penalty_dot: -1 } },
  { key: 'games', emoji: '🎲', name: 'Side games', blurb: 'Per skin or bet won. Money stays separate.', stored: false, fields: { per_win: 1 } },
  { key: 'tips', emoji: '🔮', name: 'Tipping', blurb: 'For tipping right.', stored: false, fields: { per_right: 1 } },
  { key: 'penalties', emoji: '🚫', name: 'Rule breaches', blurb: 'A breach or penalty stroke costs points.', stored: false, fields: { per_stroke: -1 } },
  { key: 'activities', emoji: '🏎️', name: 'Side activities', blurb: 'Go-karts, poker, darts: the organiser enters the placings.', stored: true, fields: {} },
  { key: 'manual', emoji: '✍️', name: 'Organiser adjustments', blurb: 'With a reason. Everyone sees them and can dispute them.', stored: true, fields: {} },
  { key: 'kudos', emoji: '🧢', name: 'Cap tips', blurb: 'Players give each other points.', stored: true, fields: { allowance: 5, per: 1, max_same: 2, guests: false } },
  { key: 'vibe', emoji: '🎉', name: 'Vibe points', blurb: 'Posting in the Feed from the day before to the day after: post 1, photo 2, video 3, up to 10 a day.', stored: false, fields: { post: 1, photo: 2, video: 3, daily_cap: 10 } },
];
export const SOURCE = Object.fromEntries(SOURCES.map((s) => [s.key, s]));

/**
 * Later — the named extension point (not built). Each would be another source: a key in SOURCES, a field list, a
 * line in cup_counts_check (101) and a function in WORK_OUT below returning [{ player, points, label }].
 *   jobs   organising jobs done on time (+) and late (−)   — plan_items due dates (085 already penalises late jobs)
 *   early  early RSVP or deposit paid                       — plan_rsvps / plan_payments times
 *   season season cups spanning several trips               — a library cup's comps across trips, added up
 */
export const LATER_SOURCES = [
  { key: 'jobs', name: 'Organising jobs on time (+) and late (−)' },
  { key: 'early', name: 'Early RSVP or deposit' },
  { key: 'season', name: 'Season cups over several trips' },
];

const num = (v, d) => (v === '' || v == null || !Number.isFinite(Number(v)) ? d : Math.max(-100, Math.min(100, Number(v))));
const UUID = /^[0-9a-f-]{36}$/;

/** What counts by default for a new cup. Golf cups: nothing (the scores decide). Vibe and cap tips are on. */
export function defaultCounts(purpose) {
  if (purpose === 'golf' || !PURPOSE[purpose]) return {};
  const on = (k) => ({ on: true, ...SOURCE[k].fields });
  const off = (k) => ({ on: false, ...SOURCE[k].fields });
  const out = {
    awards: on('awards'), side: on('side'), games: off('games'), tips: on('tips'), penalties: on('penalties'),
    activities: on('activities'), manual: on('manual'), kudos: on('kudos'), vibe: on('vibe'),
    matches: purpose === 'combined' ? on('matches') : off('matches'),
    placings: purpose === 'combined' ? { ...on('placings'), rounds: [] } : { ...off('placings'), rounds: [] },
  };
  return out;
}

/** What counts, with only what's allowed (the database checks the same: private.cup_counts_check, 101). */
export function cleanCounts(counts = {}) {
  const out = {};
  for (const [k, v] of Object.entries(counts || {})) {
    const src = SOURCE[k];
    if (!src || !v || typeof v !== 'object') continue;
    const one = { on: !!v.on };
    for (const [f, d] of Object.entries(src.fields)) {
      if (f === 'scale') {
        const s = (Array.isArray(v.scale) ? v.scale : String(v.scale ?? '').split(/[\s,/]+/)).map(Number).filter((x) => Number.isFinite(x)).slice(0, 20);
        one.scale = s.length ? s.map((x) => num(x, 0)) : d;
      } else if (f === 'guests') one.guests = !!(v.guests ?? d);
      else if (['allowance', 'max_same', 'daily_cap'].includes(f)) one[f] = Math.round(Math.max(0, num(v[f], d)));
      else one[f] = num(v[f], d);
    }
    if (k === 'placings') one.rounds = (Array.isArray(v.rounds) ? v.rounds : []).filter((x) => UUID.test(String(x))).slice(0, 20);
    out[k] = one;
  }
  return out;
}

/** A source's settings on a cup comp, with the defaults filled in (null when it's off). */
export function sourceOn(comp, key) {
  const v = comp?.settings?.counts?.[key];
  if (!v?.on) return null;
  return { ...SOURCE[key]?.fields, ...v };
}

// ------------------------------------------------------------------ putting a cup up for grabs

/** The comp kind a library cup plays as. */
export function kindForCup(cup) {
  if (cup?.purpose === 'golf') return GOLF_FORMAT[cup.format]?.kind || 'individual_points';
  return 'manual';
}

/** The comps row that puts a library cup up for grabs on a trip (the organiser sets the specifics after). */
export function compForCup(cup, trip, { sort = 0 } = {}) {
  const kind = kindForCup(cup);
  const settings = {};
  if (cup.purpose === 'golf' && cup.format === 'eclectic') { settings.cup = 'eclectic'; settings.net = true; settings.rounds = []; }
  if (cup.purpose !== 'golf') {
    settings.cup = cup.purpose;
    settings.counts = cleanCounts(Object.keys(cup.counts || {}).length ? cup.counts : defaultCounts(cup.purpose));
  }
  if (cup.description) settings.note = String(cup.description).slice(0, 200);
  return { trip_id: trip.id, cup_id: cup.id, name: cup.name, kind, round_ids: [], settings, sort, retired: false };
}

/** The library cup a comp plays for (or null). */
export const cupOf = (comp, cups = []) => (comp?.cup_id ? (cups || []).find((c) => c.id === comp.cup_id) || null : null);

/**
 * The run-up list: every library cup (not retired), ticked when it's on for this trip, plus the trip's comp for it.
 * → [{ cup, comp (or null), on }] in library order (cups on first).
 */
export function cupsForTrip({ cups = [], comps = [], tripId }) {
  const mine = (comps || []).filter((c) => c.trip_id === tripId && c.cup_id);
  return (cups || []).filter((c) => !c.retired).map((cup) => {
    const list = mine.filter((c) => c.cup_id === cup.id);
    const comp = list.find((c) => !c.retired) || list[0] || null;
    return { cup, comp, on: !!comp && !comp.retired };
  }).sort((a, b) => (b.on - a.on) || String(a.cup.created_at || '').localeCompare(String(b.cup.created_at || '')) || a.cup.name.localeCompare(b.cup.name));
}

/** The cups up for grabs on a trip (for "Counts towards"): comps with a cup that are on. */
export function tripCupComps(comps = [], tripId) {
  return (comps || []).filter((c) => c.trip_id === tripId && !c.retired && (c.cup_id || isCupComp(c)));
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sign = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(Math.abs(n))}` : '0');
const fmt = (n) => (Math.round(n * 10) / 10).toString();
export const signed = sign;
export const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;

/** One plain line on how to win this cup, for players. */
export function howToWin(comp, cup = null) {
  const s = comp?.settings || {};
  if (s.cup === 'eclectic') return GOLF_FORMAT.eclectic.how;
  if (s.cup === 'social' || s.cup === 'combined') {
    const on = SOURCES.filter((x) => s.counts?.[x.key]?.on).map((x) => x.name.toLowerCase());
    if (!on.length) return 'Most points wins — the organiser hasn’t said what counts yet.';
    const list = on.length > 1 ? `${on.slice(0, -1).join(', ')} and ${on[on.length - 1]}` : on[0];
    return `Most points wins: ${list}.`;
  }
  const f = cup?.format ? GOLF_FORMAT[cup.format] : GOLF_FORMATS.find((x) => x.kind === comp?.kind);
  return f?.how || COMP_TYPE[comp?.kind]?.description || 'The group decides.';
}

/** "Do you have a cup for this?" — the run-up nudge, or null. */
export function trophyReminder(cup) {
  if (!cup || cup.has_trophy !== false) return null;
  return `No cup for the ${cup.name.replace(/^the\s+/i, '')} yet: sort one before the presentation`;
}

// ------------------------------------------------------------------ cap tips

/**
 * Where a player stands with cap tips on one cup. tips: the cap_tips rows for that comp. settings: the comp's
 * counts.kudos. → { on, allowance, given, left, canGiveTo(receiverId, { guest }) → '' | why not }.
 */
export function capTipState({ tips = [], me, settings = null, meGuest = false } = {}) {
  const s = settings ? { ...SOURCE.kudos.fields, ...settings } : null;
  if (!s?.on) return { on: false, allowance: 0, given: 0, left: 0, canGiveTo: () => 'Cap tips aren’t on for this cup' };
  const mine = (tips || []).filter((t) => t.giver_id === me);
  const left = Math.max(0, s.allowance - mine.length);
  const canGiveTo = (receiver, { guest = false } = {}) => {
    if (!me) return 'Sign in first';
    if (receiver === me) return 'Not to yourself';
    if (!s.guests && meGuest) return 'Guests can’t give them on this cup';
    if (!s.guests && guest) return 'Guests can’t get them on this cup';
    if (left <= 0) return 'None left to give';
    if (mine.filter((t) => t.receiver_id === receiver).length >= s.max_same) return `Most ${s.max_same} to the same person`;
    return '';
  };
  return { on: true, allowance: s.allowance, given: mine.length, left, per: s.per, maxSame: s.max_same, guests: s.guests, canGiveTo };
}

/** Can the giver still take it back? Within 10 minutes. */
export function canUndo(tip, me, now = Date.now()) {
  return !!tip && tip.giver_id === me && now - Date.parse(tip.created_at) < UNDO_MINUTES * 60000;
}

// ------------------------------------------------------------------ vibe points

const sydneyDay = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(d);
};
const addDays = (day, n) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
export const isVideo = (p) => !!p?.video_url || /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(String(p?.photo_url || ''));
/** Posts the app writes (scoreboard, Tribunal, a hand-over or a proposal, anything with a link) never count. */
export const isSystemPost = (p) => !p || (p.kind && p.kind !== 'user') || !!p.link || !p.player_id || /^(🏆|📜|🏁) /u.test(String(p.body || ''));

/**
 * Vibe points from posts: from the day before the trip to the day after (Sydney time), post / photo / video, capped
 * per person per day. → { [player id]: { points, posts, photos, videos } }.
 */
export function vibePoints({ posts = [], start, end, settings = {} } = {}) {
  const s = { ...SOURCE.vibe.fields, ...settings };
  if (!start) return {};
  const from = addDays(start, -1);
  const to = addDays(end || start, 1);
  const perDay = {};
  const out = {};
  const sorted = [...(posts || [])].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  for (const p of sorted) {
    if (isSystemPost(p)) continue;
    const day = sydneyDay(p.created_at);
    if (!day || day < from || day > to) continue;
    const kind = isVideo(p) ? 'videos' : p.photo_url ? 'photos' : 'posts';
    const worth = kind === 'videos' ? s.video : kind === 'photos' ? s.photo : s.post;
    const key = `${p.player_id}|${day}`;
    const room = Math.max(0, s.daily_cap - (perDay[key] || 0));
    const add = Math.min(worth, room);
    perDay[key] = (perDay[key] || 0) + add;
    const o = (out[p.player_id] ||= { points: 0, posts: 0, photos: 0, videos: 0 });
    o[kind] += 1;
    o.points += add;
  }
  return out;
}

// ------------------------------------------------------------------ standings

const nm = (p) => (p ? p.nickname || p.name : '?');
const isPlayed = (r) => r.thru > 0 || r.quick;
const byDate = (a, b) => String(a.play_date || '').localeCompare(String(b.play_date || '')) || String(a.created_at || '').localeCompare(String(b.created_at || ''));

function boardOf(round, data) {
  return roundBoard({
    round, course: data.coursesById?.[round.course_id], teams: data.teamsByRound?.[round.id] || [], roundPlayers: data.roundPlayers?.[round.id] || [],
    playersById: data.playersById || {}, scoresIdx: data.scoresIdx || {}, quickResults: data.quickResults || [],
  });
}

/** The trip's rounds a cup counts (empty = every round of the trip), in date order. */
export function cupRounds(comp, rounds = [], ids = null) {
  const trip = (rounds || []).filter((r) => r.trip_id === comp.trip_id).sort(byDate);
  const pick = ids ?? comp.settings?.rounds ?? [];
  return pick.length ? trip.filter((r) => pick.includes(r.id)) : trip;
}

/** Placing points for a board: ties share the places they cover (5/3/1, two tied 1st → 4 each). */
export function placingPoints(rows = [], scale = []) {
  const played = rows.filter(isPlayed);
  const out = [];
  for (const r of played) {
    const tied = played.filter((x) => x.rank === r.rank).length;
    let sum = 0;
    for (let i = 0; i < tied; i++) sum += Number(scale[r.rank - 1 + i]) || 0;
    const pts = Math.round((sum / tied) * 10) / 10;
    if (pts) out.push({ row: r, place: r.rank, tied: tied > 1, points: pts });
  }
  return out;
}

// Each source: (comp, settings, ctx) → [{ player, points, label, key }]. ctx: { data, rounds, trip, tripRounds }.
const WORK_OUT = {
  // 1, 8, 9, 10: rows written when it happens (awards and fines, side activities, organiser adjustments, cap tips).
  stored(comp, keys, { data }) {
    const map = { award: 'awards', fine: 'awards', activity: 'activities', manual: 'manual', kudos: 'kudos', penalty: 'penalties' };
    return (data.cupPoints || [])
      .filter((p) => p.comp_id === comp.id && p.confirmed_at && !p.waived_at && keys.includes(map[p.source_type]))
      .map((p) => ({ player: p.player_id, points: Number(p.points) || 0, label: p.label, key: map[p.source_type], id: p.id, source: p.source_type }));
  },
  // 2. Golf results per round, a placings scale.
  placings(comp, s, { data, tripRounds }) {
    const rounds = (s.rounds?.length ? tripRounds.filter((r) => s.rounds.includes(r.id)) : tripRounds);
    const out = [];
    for (const r of rounds) {
      for (const p of placingPoints(boardOf(r, data).rows, s.scale || [])) {
        const ids = (p.row.players || []).map((x) => x.id).filter(Boolean);
        for (const id of ids.length ? ids : [p.row.id]) out.push({ player: id, points: p.points, label: `${r.name} ${p.tied ? 'T' : ''}${ordinal(p.place)}`, key: 'placings' });
      }
    }
    return out;
  },
  // 3. Team matches: Cup matches decided; every player on the side gets the points (half each for a halve).
  matches(comp, s, { data, tripRounds }) {
    const ids = new Set(tripRounds.map((r) => r.id));
    const out = [];
    for (const m of (data.cupMatches || []).filter((x) => ids.has(x.round_id))) {
      const st = matchState(m);
      if (!st.decided) continue;
      const give = (players, pts, word) => (players || []).forEach((id) => out.push({ player: id, points: pts, label: word, key: 'matches', group: 'Team matches' }));
      if (st.winner === 'h') { give(m.a_players, s.per_win / 2, 'Match halved'); give(m.b_players, s.per_win / 2, 'Match halved'); } else give(st.winner === 'a' ? m.a_players : m.b_players, s.per_win, 'Match won');
    }
    return out;
  },
  // 4. Side comps: closest to the pin, longest drive, own comps; library dots (greenies +, three-putts and snakes −).
  side(comp, s, { data, tripRounds }) {
    const out = [];
    for (const r of tripRounds) {
      const here = (data.sideEntries || []).filter((e) => e.round_id === r.id);
      for (const kind of ['ctp', 'ld']) {
        for (const hole of (kind === 'ctp' ? r.ctp_holes : r.ld_holes) || []) {
          const best = bestEntry(kind, here.filter((e) => e.kind === kind && e.hole === hole));
          if (best?.player_id && s[kind]) out.push({ player: best.player_id, points: s[kind], label: `${kind === 'ctp' ? '🎯 CTP' : '💣 LD'} ${dayOf(r).slice(0, 3)} ${hole}`, key: 'side' });
        }
      }
      for (const def of compsForRound(r, data.ownDefs || [])) {
        const entries = (data.ownEntries || []).filter((e) => e.round_id === r.id && e.comp_id === def.id);
        if (def.scoring === 'count' || def.scoring === 'count_last') {
          const penalty = findPreset(def.preset)?.group === 'penalty';
          const pts = penalty ? s.penalty_dot : s.dot;
          if (!pts) continue;
          for (const e of entries) out.push({ player: e.player_id, points: pts, label: `${def.emoji || '⭐'} ${def.name}`, key: 'side', group: `${def.emoji || '⭐'} ${def.name}` });
          continue;
        }
        if (def.scoring === 'auto' || !s.own) continue; // worked out from the scores: shown on its own board
        for (const hole of def.holes.length ? def.holes : [null]) {
          const list = entries.filter((e) => (e.hole ?? null) === hole);
          const top = sortOwnEntries(def.how, list)[0];
          const winner = top && (top.confirmed || (def.how !== 'pick' && top.value != null)) ? top.player_id : null;
          if (winner) out.push({ player: winner, points: s.own, label: `${def.emoji || '⭐'} ${def.name}${hole ? ` ${hole}` : ''}`, key: 'side' });
        }
      }
    }
    return out;
  },
  // 5. Side games: per skin or bet won. Money stays separate.
  games(comp, s, { data, tripRounds }) {
    const out = [];
    for (const r of tripRounds) {
      for (const g of (data.games || []).filter((x) => x.round_id === r.id && !x.retired)) {
        let played;
        try {
          played = playGame(g, {
            round: r, course: data.coursesById?.[r.course_id], teams: data.teamsByRound?.[r.id] || [], roundPlayers: data.roundPlayers?.[r.id] || [],
            playersById: data.playersById || {}, scoresIdx: data.scoresIdx || {}, tripRounds, teamsByRound: data.teamsByRound || {},
            roundPlayersByRound: data.roundPlayers || {}, coursesById: data.coursesById || {},
          });
        } catch { continue; }
        if (!played?.result || played.skipped) continue;
        const members = Object.fromEntries((played.subjects || []).map((x) => [x.id, x.members?.length ? x.members : [x.id]]));
        if (g.kind === 'skins') {
          for (const [id, n] of Object.entries(played.result.won || {})) {
            for (const p of members[id] || [id]) out.push({ player: p, points: s.per_win * n, label: `Skins ×${n}`, key: 'games', group: 'Skins', count: n });
          }
        } else if (played.final) {
          for (const [p, cents] of Object.entries(played.money || {})) if (cents > 0) out.push({ player: p, points: s.per_win, label: 'Bet won', key: 'games', group: 'Bets won', count: 1 });
        }
      }
    }
    return out;
  },
  // 6. Tipping: the Cup, each match and each round (097), and the main trophy (094's trip_tips).
  tips(comp, s, { data, tripRounds }) {
    const out = [];
    const right = (player, what) => out.push({ player, points: s.per_right, label: `Tipped ${what}`, key: 'tips', group: 'Tipped right', count: 1 });
    const ids = new Set(tripRounds.map((r) => r.id));
    const matches = (data.cupMatches || []).filter((m) => ids.has(m.round_id));
    for (const t of data.tips || []) {
      if (t.trip_id && t.trip_id !== comp.trip_id) continue;
      if (t.target === 'match') {
        const m = matches.find((x) => x.id === t.target_id);
        const st = m && matchState(m);
        if (st?.decided && st.winner === t.pick) right(t.player_id, 'a match');
      } else if (t.target === 'round') {
        const r = tripRounds.find((x) => x.id === t.target_id);
        if (!r || r.status !== 'locked') continue;
        const top = boardOf(r, data).rows.filter((x) => x.rank === 1 && isPlayed(x));
        if (top.some((x) => x.id === t.pick || (x.players || []).some((p) => p.id === t.pick))) right(t.player_id, r.name);
      } else if (t.target === 'cup') {
        if (!tripRounds.length || !tripRounds.every((r) => r.status === 'locked')) continue;
        const tot = cupTotals(matches);
        if (tot.won.a === tot.won.b) continue;
        const sides = [...(data.cupSides || [])].sort((a, b) => a.sort - b.sort);
        const linked = sides.filter((x) => x.comp_id);
        const two = (linked.length >= 2 ? linked : sides).slice(0, 2);
        if (two[tot.won.a > tot.won.b ? 0 : 1]?.id === t.pick) right(t.player_id, 'the Cup');
      }
    }
    if (data.mainWinnerIds?.length) for (const t of data.tripTips || []) if (data.mainWinnerIds.includes(t.pick_id)) right(t.player_id, 'the winner');
    return out;
  },
  // 7. Rule breaches: score_adjustments kind 'rule_breach' (ov30) on the trip's rounds.
  penalties(comp, s, { data, tripRounds }) {
    const ids = new Set(tripRounds.map((r) => r.id));
    return (data.scoreAdjustments || [])
      .filter((a) => a.kind === 'rule_breach' && !a.waived_at && ids.has(a.round_id))
      .map((a) => ({ player: a.player_id, points: s.per_stroke * Math.max(1, Math.abs(Number(a.strokes) || 1)), label: String(a.label || 'Rule breach').replace(/\s*\([+−-]?\d+\)$/, ''), key: 'penalties' }));
  },
  // 11. Vibe points: Feed activity around the trip.
  vibe(comp, s, { data, trip }) {
    const { start, end } = tripSpan(trip || { id: comp.trip_id }, data.rounds || []);
    const v = vibePoints({ posts: data.posts || [], start, end, settings: s });
    return Object.entries(v).filter(([, x]) => x.points).map(([player, x]) => ({
      player, points: x.points, key: 'vibe', label: 'Vibe',
      detail: [x.posts && plural(x.posts, 'post'), x.photos && plural(x.photos, 'photo'), x.videos && plural(x.videos, 'video')].filter(Boolean).join(', '),
    }));
  },
};

/** Group a player's lines into the breakdown: "Latest out +2 · Round 1 3rd +1 · Vibe +14 (6 posts, 3 photos)". */
function breakdown(lines) {
  const groups = [];
  const by = new Map();
  for (const l of lines) {
    const k = l.group || (l.key === 'kudos' ? 'kudos' : null);
    if (!k) { groups.push({ label: l.label, points: l.points, detail: l.detail, key: l.key, id: l.id, source: l.source }); continue; }
    let g = by.get(k);
    if (!g) { g = { label: k === 'kudos' ? 'kudos' : k, points: 0, n: 0, key: l.key }; by.set(k, g); groups.push(g); }
    g.points += l.points;
    g.n += l.count || 1;
  }
  return groups.filter((g) => g.points !== 0);
}

/**
 * Where a cup stands. Golf cups are compStandings (the scores decide). Social and combined cups add up every source
 * that's on; eclectic cups are the best score on each hole over the rounds. Returns compStandings' shape:
 * { kind, cupKind, rounds, rows: [{ id, name, players, value, text, rank, rankLabel, parts, breakdown }],
 *   higherBetter, leaderText, note, empty, finished, how }.
 * data: what useCompData loads, plus cupPoints, posts, tips, tripTips, scoreAdjustments, mainWinnerIds, capTipName.
 */
export function cupStandings(comp, data = {}) {
  const how = howToWin(comp);
  if (!isCupComp(comp)) return { ...compStandings(comp, data), how };
  const trip = (data.trips || []).find((t) => t.id === comp.trip_id) || { id: comp.trip_id };
  const tripRounds = (data.rounds || []).filter((r) => r.trip_id === comp.trip_id).sort(byDate);
  const finished = tripRounds.length > 0 && tripRounds.every((r) => r.status === 'locked');
  const base = { kind: comp.kind, cupKind: comp.settings.cup, rows: [], higherBetter: true, leaderText: null, note: how, how, empty: null, finished };

  if (comp.settings.cup === 'eclectic') {
    const rounds = cupRounds(comp, tripRounds).filter((r) => r.format !== 'ambrose');
    const course = rounds[0]?.course_id;
    const same = rounds.filter((r) => r.course_id === course);
    if (!same.length) return { ...base, rounds: [], higherBetter: false, empty: 'No stroke or Stableford round counts yet.' };
    const res = eclectic({
      rounds: same.map((r) => ({
        id: r.id, holes: data.coursesById?.[r.course_id]?.holes || [], scores: data.scoresIdx?.[r.id] || {}, locked: r.status === 'locked',
        subjects: gameSubjects({ round: r, teams: data.teamsByRound?.[r.id] || [], roundPlayers: data.roundPlayers?.[r.id] || [], playersById: data.playersById || {} }),
      })),
      options: { net: comp.settings.net !== false },
    });
    const rows = rankRows(res.rows.map((r) => ({ id: r.id, name: nm(data.playersById?.[r.id]) || r.name, players: [data.playersById?.[r.id]].filter(Boolean), value: r.full ? r.toPar : 999 + (18 - r.covered), toPar: r.toPar, covered: r.covered })), { key: 'value' })
      .map((r) => ({ ...r, text: r.covered ? `${r.toPar === 0 ? 'E' : r.toPar > 0 ? `+${r.toPar}` : `−${Math.abs(r.toPar)}`}${r.value >= 999 ? ` (${r.covered} holes)` : ''}` : '–' }));
    const top = rows[0];
    return {
      ...base, rounds: same, rows, higherBetter: false,
      leaderText: top?.covered ? `${leadWho(rows, finished)} · ${top.text}` : null,
      note: `${how}${same.length < rounds.length ? ' (rounds on the same course only)' : ''}`,
      empty: rows.length ? null : 'Nobody’s played the rounds that count yet.',
    };
  }

  const ctx = { data, trip, tripRounds };
  const lines = [];
  const storedKeys = ['awards', 'activities', 'manual', 'kudos', 'penalties'].filter((k) => sourceOn(comp, k));
  if (storedKeys.length) lines.push(...WORK_OUT.stored(comp, storedKeys, ctx));
  for (const k of ['placings', 'matches', 'side', 'games', 'tips', 'penalties', 'vibe']) {
    const s = sourceOn(comp, k);
    if (s) lines.push(...WORK_OUT[k](comp, s, ctx));
  }
  const tipName = capTipName(data.capTipName);
  const byPlayer = new Map();
  for (const l of lines) {
    if (!l.player || !l.points) continue;
    const list = byPlayer.get(l.player) || [];
    list.push(l);
    byPlayer.set(l.player, list);
  }
  const rows = rankRows([...byPlayer.entries()].map(([id, ls]) => {
    const value = Math.round(ls.reduce((a, l) => a + l.points, 0) * 10) / 10;
    const parts = breakdown(ls).map((g) => ({
      ...g,
      text: g.label === 'kudos' ? `${tipName.emoji} ${tipName.name} ×${g.n} ${sign(g.points)}`
        : `${g.label}${g.n > 1 && !/×\d/.test(g.label) ? ` ×${g.n}` : ''} ${sign(g.points)}${g.detail ? ` (${g.detail})` : ''}`,
    }));
    return { id, name: nm(data.playersById?.[id]), players: [data.playersById?.[id]].filter(Boolean), value, parts, breakdown: parts.map((p) => p.text).join(' · ') };
  }), { key: 'value', higherBetter: true }).map((r) => ({ ...r, text: `${fmt(r.value)} pts` }));
  const top = rows[0];
  const placingRounds = sourceOn(comp, 'placings') ? cupRounds(comp, tripRounds, sourceOn(comp, 'placings').rounds || []) : [];
  return {
    ...base, rounds: placingRounds, rows,
    leaderText: top && top.value > 0 ? `${leadWho(rows, finished)} · ${top.text}` : null,
    empty: rows.length ? null : 'No points yet.',
  };
}

/** The main trophy's winner ids for trip_tips (the first scored comp of the trip that has a winner). */
export function mainWinnerIds(comps = [], data = {}) {
  const order = ['individual_points', 'individual_net', 'ambrose_teams', 'fourball_pairs', 'day'];
  const list = (comps || []).filter((c) => !c.retired && order.includes(c.kind)).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  for (const c of list) {
    let st = null;
    try { st = compStandings(c, data); } catch { st = null; }
    if (!st?.finished || !st.rows?.length) continue;
    const top = st.rows.filter((r) => r.rank === st.rows[0].rank);
    return top.flatMap((r) => ((r.players || []).length ? r.players.map((p) => p?.id).filter(Boolean) : [r.id]));
  }
  return [];
}

/** A player's line for the day screen: "You: 12 pts, 3rd" or null. */
export function myLine(st, me) {
  const r = st?.rows?.find((x) => x.id === me);
  return r ? `You: ${r.text}, ${r.rankLabel.startsWith('T') ? `joint ${ordinal(r.rank)}` : ordinal(r.rank)}` : null;
}

export { compRounds };
