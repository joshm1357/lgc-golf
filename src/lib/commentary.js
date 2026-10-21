// Live commentary (migration 071, feature 'commentary', a child of 'awards'). The app decides WHEN something worth
// saying happens; the server writes ONE short line about it (the AI in the group's tone, or a template line below
// when the AI isn't set up or fails), posts it to the Feed and buzzes phones (rate-limited in the database).
//
// This file is the "when": plain functions with tests (commentary.test.js). A member's phone that sees a moment
// records it once (key unique per group); the database checks it's real. Moments:
//   lead     — someone new takes the outright lead (after 3+ holes)
//   charge   — the same, but they were 3 or more back earlier in the round (instead of 'lead')
//   birdies  — birdie-or-better on two (or more) holes in a row
//   eagle    — an eagle or better (not a hole-in-one)
//   ace      — a hole-in-one
//   wipe     — three zeros in a row (Stableford and 4BBB), said gently
//   dormie   — a Cup match goes dormie
//   cuplead  — a Cup side goes ahead overall on this round's day
//   report   — the round report, once the round's award moment ('round:<id>') exists
// Not here on purpose: a round, side comp, trophy or Cup match being decided — those are award moments (054).
//
// Facts never hold free text: only ids (players, teams, matches), hole numbers, numbers and short words. The server
// looks the names up itself. Keys: <kind>:<round id>:<subject / match / side>[:<hole>], e.g. lead:<r>:<p>:7.
import { roundBoard, courseHoles } from './board.js';
import { stablefordPoints } from './scoring.js';
import { matchState, cupTotals } from './cup.js';
import { isFresh, roundSubjects } from './awards.js';

/** Only moments from scores saved in the last 20 minutes are recorded (opening the app late doesn't dig up the
 *  whole round). */
export const FRESH_MINUTES = 20;
/** The leader has to have played this many holes before a lead change is worth a line. */
export const LEAD_MIN_THRU = 3;
/** "Came from 3 or more back." */
export const CHARGE_BEHIND = 3;

export const KINDS = ['lead', 'charge', 'birdies', 'eagle', 'ace', 'wipe', 'dormie', 'cuplead', 'report'];

export const TONES = [
  { key: 'straight', name: 'Straight', blurb: 'Just the facts, warmly.' },
  { key: 'cheeky', name: 'Cheeky', blurb: 'Friendly banter (the default).' },
  { key: 'tv', name: 'Old-school TV', blurb: 'Hushed, grand, a touch dramatic.' },
];
export const DEFAULT_TONE = 'cheeky';

export const BUZZ_LEVELS = [
  { key: 'often', name: 'Often', blurb: 'At most one buzz each 10 minutes a round.', minutes: 10 },
  { key: 'sometimes', name: 'Sometimes', blurb: 'At most one buzz each 30 minutes a round.', minutes: 30 },
  { key: 'feed', name: 'Feed only', blurb: 'No buzzes — lines just go in the Feed.', minutes: null },
];
export const DEFAULT_BUZZ = 'sometimes';

// The template lines. The server (supabase/functions/ai-helper/commentary.ts) has an exact copy between the same
// markers; a unit test checks they match. Placeholders: {who} {hole} {streak} {behind} {score} {prev} {side}
// {other} {lead} {remaining} {won}.
// TEMPLATES-START
export const TEMPLATES = {
  lead: {
    straight: ['{who} takes the outright lead on {hole} — {score}.', '{who} goes top after {hole}, {score}.'],
    cheeky: ['{who} hits the front on {hole}. {prev} won’t love that.', 'New leader: {who}, {score}. Enjoy the view while it lasts.'],
    tv: ['And there it is — {who} moves to the top of the board on {hole}.', 'A change at the summit. {who} leads, {score}.'],
  },
  charge: {
    straight: ['{who} was {behind} back and now leads on {hole} — {score}.', 'From {behind} back to the lead: {who}, {score}.'],
    cheeky: ['{who} was {behind} back. Now leads. Someone check the card.', 'The comeback is on — {who} from {behind} back to top spot on {hole}.'],
    tv: ['Remarkable. {who}, {behind} adrift earlier, now leads this field.', 'From {behind} back, {who} has crept to the very top. Quite a charge.'],
  },
  birdies: {
    straight: ['{who}: {streak} birdies or better in a row, through {hole}.', '{streak} in a row under par for {who}, through {hole}.'],
    cheeky: ['{who} has {streak} birdies on the trot. Who swapped the clubs?', '{streak} birdies in a row for {who}. Someone tell the handicapper.'],
    tv: ['{who} has found something special — {streak} under par in a row through {hole}.', 'The putter is warm. {streak} straight birdies for {who}.'],
  },
  eagle: {
    straight: ['Eagle for {who} on {hole}.', '{who} makes {score} on {hole} — eagle or better.'],
    cheeky: ['Eagle for {who} on {hole}. Drinks are on them, apparently.', '{who} eagles {hole}. Nobody saw it, but we’ll allow it.'],
    tv: ['Oh, that is magnificent. An eagle for {who} at {hole}.', 'Take a bow, {who}. Eagle at the {hole}.'],
  },
  ace: {
    straight: ['Hole-in-one for {who} on {hole}!', '{who} has an ace on {hole}.'],
    cheeky: ['ACE! {who} on {hole}. The bar tab just got bigger.', '{who} holes it on {hole}. Bar’s open, {who} is paying.'],
    tv: ['In the hole! {who}, a hole-in-one at the {hole}. Unforgettable.', 'Scenes. A hole-in-one for {who} at {hole}.'],
  },
  wipe: {
    straight: ['A quiet patch for {who} — three without a point. Plenty of golf left.', '{who} is due one after three tough holes.'],
    cheeky: ['Three wipes in a row for {who}. The only way is up.', '{who} has gone quiet — three blobs. The bounce-back starts now.'],
    tv: ['A difficult stretch for {who}. Golf can be a cruel game.', 'Three holes {who} will want to forget. The recovery begins here.'],
  },
  dormie: {
    straight: ['{side} are dormie {lead} with {remaining} to play.', 'Dormie: {side} {lead} up, {remaining} left.'],
    cheeky: ['{side} are dormie {lead}. {other} need a miracle, or a rules dispute.', 'Dormie {lead} for {side}. {other}, no pressure.'],
    tv: ['{side} stand dormie {lead}. {other} must win every hole from here.', 'Dormie. {side} {lead} up, {remaining} to play. The tension builds.'],
  },
  cuplead: {
    straight: ['{side} go ahead in the Cup, {won}.', '{side} now lead the Cup, {won}.'],
    cheeky: ['{side} take the Cup lead, {won}. {other} have gone very quiet.', '{side} in front, {won}. {other}, the floor is yours.'],
    tv: ['A shift in this contest. {side} lead the Cup, {won}.', '{side} edge ahead in the Cup, {won}. Everything to play for.'],
  },
  report_win: {
    straight: ['{who} won {round} with {score}.'],
    cheeky: ['{who} took {round} with {score} and won’t let anyone forget it.'],
    tv: ['{round} belongs to {who}, with {score}.'],
  },
  report_best: {
    straight: ['The shot of the day: {best}.'],
    cheeky: ['Highlight of the day: {best}.'],
    tv: ['The moment we’ll remember: {best}.'],
  },
  report_collapse: {
    straight: ['{who} had a tough run on {holes}.'],
    cheeky: ['{who} would like {holes} wiped from the record.'],
    tv: ['Spare a thought for {who}, who struggled through {holes}.'],
  },
  report_end: {
    straight: ['Well played, everyone.'],
    cheeky: ['Same again tomorrow, lads.'],
    tv: ['What a day of golf.'],
  },
};
// TEMPLATES-END

/** A small, stable number from a key (the same on every phone and the server), to pick a template. */
export function keyHash(key) {
  let h = 0;
  for (const ch of String(key || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h;
}

/** Fill {placeholders}; missing ones become ''. */
export function fill(text, vals = {}) {
  return String(text || '').replace(/\{(\w+)\}/g, (_, k) => (vals[k] == null ? '' : String(vals[k]))).replace(/\s+/g, ' ').trim();
}

const toneOf = (tone) => (TONES.some((t) => t.key === tone) ? tone : DEFAULT_TONE);

/** A template line for a moment. `vals` are the facts in words (names, not ids). Up to `max` characters. */
export function templateLine(kind, vals = {}, tone = DEFAULT_TONE, key = '', max = 140) {
  if (kind === 'report') return reportTemplate(vals, tone, max * 4);
  const set = TEMPLATES[kind]?.[toneOf(tone)];
  if (!set?.length) return '';
  return trimLine(fill(set[keyHash(key) % set.length], vals), max);
}

/** The round report from templates: winner, best moment, the collapse of the day, a sign-off. */
export function reportTemplate(vals = {}, tone = DEFAULT_TONE, max = 560) {
  const t = toneOf(tone);
  const parts = [fill(TEMPLATES.report_win[t][0], vals)];
  if (vals.best) parts.push(fill(TEMPLATES.report_best[t][0], vals));
  if (vals.collapse_who) parts.push(fill(TEMPLATES.report_collapse[t][0], { who: vals.collapse_who, holes: vals.collapse_holes }));
  parts.push(TEMPLATES.report_end[t][0]);
  return trimLine(parts.join(' '), max);
}

/** One line, at most `max` characters, cut at a word with "…" if it has to be. */
export function trimLine(s, max = 140) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:—-]+$/, '')}…`;
}

/** Is this Feed post a commentary line? (The server starts them with the microphone.) */
export const COMMENTARY_MARK = '🎙️';
export const isCommentaryPost = (post) => post?.kind === 'auto' && String(post.body || '').startsWith(COMMENTARY_MARK);

// ------------------------------------------------------------------ Working out the moments

const scored = (s) => !!s && (s.strokes != null || s.picked_up);
const timeOf = (s) => (s?.updated_at ? new Date(s.updated_at).getTime() : 0);
const round1 = (n) => Math.round(Number(n) * 10) / 10;

/** Every synced score of a round, in the order they were saved (ties: subject then hole, so every phone agrees). */
export function scoreEvents(scoresIdx, roundId) {
  const out = [];
  for (const [subject, card] of Object.entries(scoresIdx?.[roundId] || {})) {
    for (const [hole, s] of Object.entries(card || {})) if (scored(s)) out.push({ subject, hole: Number(hole), s });
  }
  return out.sort((a, b) => timeOf(a.s) - timeOf(b.s) || (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0) || a.hole - b.hole);
}

function boardFor(ctx, round, idx) {
  return roundBoard({
    round, course: ctx.coursesById?.[round.course_id], teams: ctx.teamsByRound?.[round.id] || [],
    roundPlayers: ctx.roundPlayers?.[round.id] || [], playersById: ctx.playersById || {}, scoresIdx: { [round.id]: idx },
  });
}

/** The score for a leader in facts: Stableford/4BBB points, else net to par. */
function scoreFacts(format, row) {
  return format === 'stableford' || format === 'fourball' ? { points: row.points, thru: row.thru } : { net_to_par: round1(row.netToPar), thru: row.thru };
}

/**
 * Lead changes, by replaying the round's scores in the order they were saved. A lead change is a new player/team
 * alone on top (played LEAD_MIN_THRU+ holes), different from the last one alone on top. If they were CHARGE_BEHIND
 * or more back at some point (with 3+ holes played), it's a 'charge' instead.
 */
export function leadMoments(ctx, round) {
  const out = [];
  const idx = {};
  let lastSole = null;
  const worst = {}; // biggest gap behind the leader so far
  for (const ev of scoreEvents(ctx.scoresIdx, round.id)) {
    ((idx[ev.subject] ||= {}))[ev.hole] = ev.s;
    const board = boardFor(ctx, round, idx);
    const playedRows = board.rows.filter((r) => r.thru > 0);
    if (!playedRows.length) continue;
    const top = playedRows.filter((r) => r.rank === 1);
    const best = playedRows[0].sortValue;
    for (const r of playedRows) {
      if (r.thru < LEAD_MIN_THRU) continue;
      const gap = board.higherBetter ? best - r.sortValue : r.sortValue - best;
      worst[r.id] = Math.max(worst[r.id] || 0, gap);
    }
    if (top.length !== 1) continue;
    const lead = top[0];
    if (lead.id === lastSole) continue;
    const prev = lastSole;
    lastSole = lead.id;
    if (!prev || lead.thru < LEAD_MIN_THRU || playedRows.length < 2) continue;
    const behind = worst[lead.id] || 0;
    const kind = behind >= CHARGE_BEHIND ? 'charge' : 'lead';
    out.push({
      key: `${kind}:${round.id}:${lead.id}:${ev.hole}`, kind, round_id: round.id, at: timeOf(ev.s),
      facts: { format: board.format, subject: lead.id, hole: ev.hole, prev, ...scoreFacts(board.format, lead), ...(kind === 'charge' ? { behind: round1(behind) } : {}) },
    });
  }
  return out;
}

/** Whose cards to look at for birdies, eagles and wipes: Ambrose teams, everyone else players (4BBB too). */
function cardSubjects(ctx, round) {
  if (round.format === 'ambrose') return roundSubjects(round, ctx.teamsByRound, ctx.roundPlayers);
  if (round.format === 'fourball') return roundSubjects(round, ctx.teamsByRound, ctx.roundPlayers);
  return (ctx.roundPlayers?.[round.id] || []).map((rp) => rp.player_id);
}

function hcpOf(ctx, round, id) {
  const rp = (ctx.roundPlayers?.[round.id] || []).find((x) => x.player_id === id);
  if (rp?.playing_handicap != null) return Number(rp.playing_handicap);
  return Number(ctx.playersById?.[id]?.handicap ?? 0);
}

/** Holes in order with the next one after each (18 → 1, so shotgun starts and back-nine starts work). */
function inOrder(holes) {
  return holes.map((h, i) => ({ h, prev: holes[(i - 1 + holes.length) % holes.length] }));
}

/** Birdie streaks, eagles, hole-in-ones and (Stableford / 4BBB) three wipes in a row. */
export function holeMoments(ctx, round) {
  const holes = courseHoles(ctx.coursesById?.[round.course_id]);
  if (!holes.length) return [];
  const out = [];
  const pointsFormat = round.format === 'stableford' || round.format === 'fourball';
  for (const id of cardSubjects(ctx, round)) {
    const card = ctx.scoresIdx?.[round.id]?.[id] || {};
    const under = (h) => card[h.n]?.strokes != null && !card[h.n].picked_up && card[h.n].strokes <= h.par - 1;
    const zero = (h) => scored(card[h.n]) && stablefordPoints(h, card[h.n].strokes, hcpOf(ctx, round, id), card[h.n].picked_up) === 0;
    const order = inOrder(holes);
    const before = (h, k) => { let x = h; for (let i = 0; i < k; i++) x = order.find((o) => o.h.n === x.n).prev; return x; };
    for (const { h } of inOrder(holes)) {
      const s = card[h.n];
      if (!scored(s)) continue;
      const base = { format: round.format, subject: id, hole: h.n };
      if (s.strokes === 1) {
        out.push({ key: `ace:${round.id}:${id}:${h.n}`, kind: 'ace', round_id: round.id, at: timeOf(s), facts: { ...base, strokes: 1, par: h.par } });
      } else if (s.strokes != null && !s.picked_up && s.strokes <= h.par - 2) {
        out.push({ key: `eagle:${round.id}:${id}:${h.n}`, kind: 'eagle', round_id: round.id, at: timeOf(s), facts: { ...base, strokes: s.strokes, par: h.par } });
      }
      if (under(h) && holes.length > 1) {
        let streak = 1;
        while (streak < holes.length && under(before(h, streak))) streak++;
        if (streak >= 2) {
          const at = Math.max(...Array.from({ length: streak }, (_, i) => timeOf(card[before(h, i).n])));
          out.push({ key: `birdies:${round.id}:${id}:${h.n}`, kind: 'birdies', round_id: round.id, at, facts: { ...base, streak } });
        }
      }
      // Three zeros in a row, said once (not again on the 4th).
      if (pointsFormat && holes.length >= 3 && zero(h) && zero(before(h, 1)) && zero(before(h, 2)) && !(holes.length > 3 && zero(before(h, 3)))) {
        const at = Math.max(timeOf(s), timeOf(card[before(h, 1).n]), timeOf(card[before(h, 2).n]));
        out.push({ key: `wipe:${round.id}:${id}:${h.n}`, kind: 'wipe', round_id: round.id, at, facts: { ...base, streak: 3 } });
      }
    }
  }
  return out;
}

const matchTime = (m) => (m?.updated_at ? new Date(m.updated_at).getTime() : 0);

/** The Cup: a match going dormie, and a side going ahead overall on this round's day. */
export function cupMoments(ctx, round) {
  const out = [];
  const all = ctx.cupMatches || [];
  for (const m of all.filter((x) => x.round_id === round.id)) {
    const s = matchState(m);
    if (s.dormie) {
      out.push({ key: `dormie:${round.id}:${m.id}`, kind: 'dormie', round_id: round.id, at: matchTime(m), facts: { match: m.id, side: s.leader, lead: s.lead, remaining: s.remaining } });
    }
  }
  // Rounds of this trip, in play order: matches decided before today vs including today.
  const tripRounds = (ctx.rounds || []).filter((r) => r.trip_id === round.trip_id);
  const at = tripRounds.findIndex((r) => r.id === round.id);
  if (at < 0) return out;
  const earlierIds = new Set(tripRounds.slice(0, at).map((r) => r.id));
  const leader = (t) => (t.won.a > t.won.b ? 'a' : t.won.b > t.won.a ? 'b' : null);
  const today = all.filter((m) => m.round_id === round.id && matchState(m).decided);
  if (!today.length) return out;
  const before = leader(cupTotals(all.filter((m) => earlierIds.has(m.round_id))));
  const nowTotals = cupTotals(all.filter((m) => earlierIds.has(m.round_id) || m.round_id === round.id));
  const now = leader(nowTotals);
  if (now && now !== before) {
    out.push({
      key: `cuplead:${round.id}:${now}`, kind: 'cuplead', round_id: round.id, at: Math.max(...today.map(matchTime)),
      facts: { side: now, won_a: nowTotals.won.a, won_b: nowTotals.won.b },
    });
  }
  return out;
}

/** The worst three-hole run of the day (strokes over par, a pick-up as par + 3), if it's 5 or more over. */
export function collapseOfTheDay(ctx, round) {
  const holes = courseHoles(ctx.coursesById?.[round.course_id]);
  if (holes.length < 3) return null;
  let worst = null;
  for (const id of cardSubjects(ctx, round)) {
    const card = ctx.scoresIdx?.[round.id]?.[id] || {};
    const over = (h) => (card[h.n]?.picked_up ? 3 : card[h.n]?.strokes != null ? card[h.n].strokes - h.par : null);
    for (let i = 0; i + 2 < holes.length; i++) {
      const v = [0, 1, 2].map((k) => over(holes[i + k]));
      if (v.some((x) => x == null)) continue;
      const sum = v[0] + v[1] + v[2];
      if (sum >= 5 && (!worst || sum > worst.over)) worst = { subject: id, from_hole: holes[i].n, to_hole: holes[i + 2].n, over: sum };
    }
  }
  return worst;
}

const BEST_ORDER = { ace: 0, eagle: 1, birdies: 2, charge: 3 };

/** The round report, once the round's award moment exists: winner(s), the best moment, the collapse of the day. */
export function reportMoment(ctx, round, award) {
  if (!award || award.key !== `round:${round.id}`) return null;
  const board = boardFor(ctx, round, ctx.scoresIdx?.[round.id] || {});
  const winners = board.rows.filter((r) => r.rank === 1 && r.thru > 0);
  const moments = [...holeMoments(ctx, round), ...leadMoments(ctx, round)].filter((m) => m.kind in BEST_ORDER);
  moments.sort((a, b) => BEST_ORDER[a.kind] - BEST_ORDER[b.kind] || (b.facts.streak || 0) - (a.facts.streak || 0) || a.at - b.at);
  const b = moments[0];
  return {
    key: `report:${round.id}`, kind: 'report', round_id: round.id, at: award.created_at ? new Date(award.created_at).getTime() : Date.now(),
    facts: {
      format: board.format,
      winners: winners.map((w) => w.id).slice(0, 4),
      ...(winners[0] ? scoreFacts(board.format, winners[0]) : {}),
      best: b ? { kind: b.kind, subject: b.facts.subject, hole: b.facts.hole, ...(b.facts.streak ? { streak: b.facts.streak } : {}) } : null,
      collapse: collapseOfTheDay(ctx, round),
    },
  };
}

/**
 * Everything worth a line right now. ctx: { now (ms), today, rounds, coursesById, teamsByRound, roundPlayers,
 * playersById, scoresIdx (synced scores only), cupMatches, roundAwards: [{ key, created_at }], features: { cup } }.
 * Only fresh rounds, and only moments from the last FRESH_MINUTES (the report: while the round is fresh).
 */
export function commentaryMoments(ctx) {
  const now = ctx.now ?? Date.now();
  const since = now - FRESH_MINUTES * 60000;
  const out = [];
  for (const r of (ctx.rounds || []).filter((x) => isFresh(x, ctx.today))) {
    const live = [...leadMoments(ctx, r), ...holeMoments(ctx, r), ...(ctx.features?.cup ? cupMoments(ctx, r) : [])];
    out.push(...live.filter((m) => m.at >= since));
    const award = (ctx.roundAwards || []).find((a) => a.key === `round:${r.id}`);
    const rep = reportMoment(ctx, r, award);
    if (rep) out.push(rep);
  }
  const seen = new Set();
  return out.filter((m) => !seen.has(m.key) && seen.add(m.key)).map(({ at, ...m }) => m); // eslint-disable-line no-unused-vars
}
