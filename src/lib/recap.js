// The Weekend Recap (ov37, migration 105): the trip's facts for the two commentators, the "missing cards" nudge, and
// reading the script out in two voices. Pure functions (tested in recap.test.js); the screen is screens/Recap.jsx and
// the words (voices, the script check, the no-AI script) are shared with the server in
// supabase/functions/_shared/recap.js.
//
// The facts are only what's in the data: trophies and round winners (from the results page's own sums), the honour
// board (last year's holder, a streak, a first win), side comps, the moments people posted on the score screen
// (bomb drives, three-putts…), the biggest number on a hole, Tribunal cases with their charges, defences and
// verdicts, fines and awards, and which rounds are missing cards. Never money.
import { courseHoles } from './board.js';
import { dayOf } from './comps.js';
import { tripSpan } from './activetrip.js';
import { honourOrder } from './history.js';
import { awardItem } from './presentation.js';
import { voiceScore, voiceTimeoutMs } from './voice.js';
import { LIMITS, factLines, templateScript, checkScript, scriptText, VOICES, feedLine } from '../../supabase/functions/_shared/recap.js';

export { LIMITS, factLines, templateScript, checkScript, scriptText, VOICES, feedLine };

const txt = (v, max = 120) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FORMAT = { stableford: 'Stableford', ambrose: 'Ambrose', stroke: 'Stroke play', fourball: '4BBB' };

/** "Fri 16 – Sun 18 Oct" (or one day). */
export function datesWords(start, end) {
  const d = (s) => { const [y, m, dd] = String(s).split('-').map(Number); return { y, m, dd, w: DAYS[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()] }; };
  if (!start) return '';
  const a = d(start);
  if (!end || end === start) return `${a.w} ${a.dd} ${MONTHS[a.m - 1]}`;
  const b = d(end);
  return a.m === b.m ? `${a.w} ${a.dd} – ${b.w} ${b.dd} ${MONTHS[b.m - 1]}` : `${a.w} ${a.dd} ${MONTHS[a.m - 1]} – ${b.w} ${b.dd} ${MONTHS[b.m - 1]}`;
}

/** Whose cards a round has: Ambrose / 4BBB teams when it has them, else the players in it. [{ id, name, players }] */
export function roundCards(round, { roundPlayers = {}, teamsByRound = {}, playersById = {}, nameOf = (p) => p?.nickname || p?.name || '' } = {}) {
  const teams = teamsByRound[round.id] || [];
  if (round.format === 'ambrose' && teams.length) return teams.map((t) => ({ id: t.id, name: t.name, players: (t.players || []).map((p) => p.id) }));
  return (roundPlayers[round.id] || []).map((rp) => ({ id: rp.player_id, name: nameOf(playersById[rp.player_id]), players: [rp.player_id] }));
}

const hasCard = (round, card, scoresIdx, quick) => {
  const c = scoresIdx?.[round.id]?.[card.id] || {};
  if (Object.values(c).some((s) => s && (s.strokes != null || s.picked_up))) return true;
  return (quick || []).some((q) => q.round_id === round.id && card.players.includes(q.player_id));
};

/**
 * The cards in and missing, per round: [{ round, name, have, of, missing: [names] }]. A card is in when it has a
 * score on any hole (or a quick result). Rounds with nobody in them are left out.
 */
export function missingCards(rounds = [], ctx = {}) {
  const out = [];
  for (const r of rounds) {
    const cards = roundCards(r, ctx);
    if (!cards.length) continue;
    const inn = cards.filter((c) => hasCard(r, c, ctx.scoresIdx, ctx.quickResults));
    out.push({ round: r, roundId: r.id, name: dayOf(r) === r.name ? r.name : `${dayOf(r)}`, have: inn.length, of: cards.length, missing: cards.filter((c) => !inn.includes(c)).map((c) => c.name) });
  }
  return out;
}

/** How many cards are in across the trip (a recap written before more came in is "out of date"). */
export const cardsIn = (missing = []) => missing.reduce((n, m) => n + m.have, 0);

/** "6 cards missing from Saturday — add yours and you're in the recap" (or null when every card's in). */
export function missingNudge(missing = []) {
  const gaps = missing.filter((m) => m.of > m.have);
  if (!gaps.length) return null;
  const n = gaps.reduce((s, m) => s + (m.of - m.have), 0);
  const worst = [...gaps].sort((a, b) => (b.of - b.have) - (a.of - a.have))[0];
  const where = gaps.length === 1 ? ` from ${worst.name}` : '';
  return { count: n, round: worst.round, text: `${n} card${n === 1 ? '' : 's'} missing${where} — add yours and you’re in the recap` };
}

/** The players in a trip: everyone in any of its rounds (and its teams). → [ids] */
export function tripPlayerIds(rounds = [], { roundPlayers = {}, teamsByRound = {} } = {}) {
  const ids = new Set();
  for (const r of rounds) {
    for (const rp of roundPlayers[r.id] || []) ids.add(rp.player_id);
    for (const t of teamsByRound[r.id] || []) for (const p of t.players || []) ids.add(p.id);
  }
  return [...ids];
}

/** The moments people tagged on the score screen ("Bomb drive on 7"): [{ kind, hole, player_id, round_id }]. */
export const MOMENT_KINDS = ['Bomb drive', 'Three-putt', 'Chip-in', 'Lost ball', 'Air shot', 'Tree hit', 'Sandy save'];
export function postMoments(posts = []) {
  const out = [];
  for (const p of posts || []) {
    const m = /^(Bomb drive|Three-putt|Chip-in|Lost ball|Air shot|Tree hit|Sandy save) on (\d{1,2})\b/.exec(String(p.body || ''));
    if (m && p.player_id) out.push({ kind: m[1], hole: Number(m[2]), player_id: p.player_id, round_id: p.round_id || null, at: p.created_at || '' });
  }
  return out;
}

/** The biggest numbers on a hole (most over par, real strokes only) and the most birdies, over the trip's rounds. */
export function holeHighlights(rounds = [], { coursesById = {}, scoresIdx = {}, roundPlayers = {}, playersById = {}, nameOf = (p) => p?.nickname || p?.name || '' } = {}) {
  const big = [];
  const birdies = new Map();
  for (const r of rounds) {
    if (r.format === 'ambrose') continue; // a team's card isn't one person's number
    const holes = courseHoles(coursesById[r.course_id]);
    const ids = new Set((roundPlayers[r.id] || []).map((x) => x.player_id));
    for (const [id, card] of Object.entries(scoresIdx?.[r.id] || {})) {
      if (!ids.has(id) || !playersById[id]) continue;
      for (const h of holes) {
        const s = card?.[h.n];
        if (!s || s.strokes == null || s.picked_up) continue;
        const over = s.strokes - h.par;
        if (over >= 3) big.push({ id, name: nameOf(playersById[id]), strokes: s.strokes, par: h.par, hole: h.n, over, round: dayOf(r) });
        if (over <= -1) birdies.set(id, (birdies.get(id) || 0) + 1);
      }
    }
  }
  big.sort((a, b) => b.over - a.over || b.strokes - a.strokes || a.name.localeCompare(b.name) || a.hole - b.hole);
  const bird = [...birdies.entries()].map(([id, count]) => ({ id, name: nameOf(playersById[id]), count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { big: big.slice(0, 2), birdies: bird.length ? bird.filter((b) => b.count === bird[0].count).slice(0, 2) : [] };
}

/**
 * Honour board lines for the trophies won on this trip: who held it before, back-to-back (or more), a first win, the
 * total. honourBoard: every row; trophies: the results page's trophies ({ name, winner: { names, ids }, previous }).
 */
export function historyLines(trophies = [], honourBoard = [], tripId = null) {
  const out = [];
  for (const t of trophies) {
    if (!t?.winner?.names) continue;
    const name = String(t.name || '').toLowerCase();
    const others = honourOrder((honourBoard || []).filter((h) => String(h.trophy_name || '').toLowerCase() === name && h.trip_id !== tripId));
    const sameAs = (h) => (h.player_ids?.length && t.winner.ids?.length
      ? h.player_ids.length === t.winner.ids.length && h.player_ids.every((x) => t.winner.ids.includes(x))
      : h.winner_names === t.winner.names);
    const before = others.filter(sameAs).length;
    let streak = 1;
    for (const h of others) { if (sameAs(h)) streak++; else break; }
    if (others[0] && !sameAs(others[0])) out.push(`${others[0].winner_names} held the ${t.name}${others[0].label ? ` (${others[0].label})` : ''} before this trip.`);
    if (streak >= 2) out.push(`${t.winner.names}: ${streak} ${t.name} wins in a row.`);
    else if (before === 0 && others.length) out.push(`${t.winner.names}: first ever ${t.name}.`);
    else if (before >= 1) out.push(`${t.winner.names} has now won the ${t.name} ${before + 1} times.`);
  }
  return [...new Set(out)].slice(0, 6);
}

/** Tribunal cases heard around this trip (the trip's days, two days either side), with charge, defence and verdict. */
export function tribunalFacts({ tribunal = [], cases = [], casePosts = [], trip = null, rounds = [], nameOf = (id) => id } = {}) {
  const { start, end } = tripSpan(trip, rounds);
  const inSpan = (at, tripAt) => {
    if (tripAt && trip && tripAt === trip.id) return true;
    if (!start || !at) return false;
    const d = String(at).slice(0, 10);
    const lo = new Date(Date.parse(`${start}T00:00:00Z`) - 2 * 86400000).toISOString().slice(0, 10);
    const hi = new Date(Date.parse(`${end || start}T00:00:00Z`) + 2 * 86400000).toISOString().slice(0, 10);
    return d >= lo && d <= hi;
  };
  const out = [];
  for (const c of tribunal || []) {
    if (!inSpan(c.created_at)) continue;
    const ch = Number(c.proposed_change);
    out.push({
      title: `Handicap case: ${nameOf(c.accused_id)}${ch ? `, ${ch > 0 ? '+' : ''}${ch}` : ''}`, accused: nameOf(c.accused_id), charge: txt(c.case_text, 140), defence: txt(c.defence, 140),
      verdict: c.status === 'closed' ? (c.verdict === 'upheld' ? `guilty${c.new_handicap != null ? `, handicap now ${Number(c.new_handicap)}` : ''}` : 'not guilty') : '',
    });
  }
  for (const c of cases || []) {
    if (c.hidden || c.kind === 'election' || c.kind === 'governance' || !inSpan(c.created_at, c.trip_at_verdict)) continue;
    const defence = (casePosts || []).filter((p) => p.case_id === c.id && p.kind === 'reply' && (!c.subject_id || p.player_id === c.subject_id) && p.body)[0];
    out.push({
      title: txt(c.title, 100), accused: c.subject_id ? nameOf(c.subject_id) : '', charge: txt(c.body, 140), defence: txt(defence?.body, 140),
      verdict: c.status === 'open' ? '' : c.status === 'passed' ? txt(c.verdict || (c.penalty ? `upheld — ${c.penalty}` : 'upheld'), 100) : c.status === 'failed' ? txt(c.verdict || 'thrown out', 100) : 'withdrawn',
    });
  }
  return out.slice(0, 4);
}

/**
 * Everything the commentators get, for one trip. res: what the results page works out (components/TripResults.jsx,
 * useTripResults); the rest is the store's data plus a few rows the recap screen loads (posts, cases).
 */
export function buildRecapFacts({
  trip, res = null, rounds = [], playersById = {}, roundPlayers = {}, teamsByRound = {}, coursesById = {}, scoresIdx = {},
  quickResults = [], posts = [], tribunal = [], cases = [], casePosts = [], honourBoard = [], nameOfId = null,
} = {}) {
  if (!trip) return null;
  const nameOfP = (p) => p?.nickname || p?.name || '';
  const nameOf = nameOfId || ((id) => nameOfP(playersById[id]) || 'Someone');
  const ctx = { roundPlayers, teamsByRound, playersById, coursesById, scoresIdx, quickResults, nameOf: nameOfP };
  const ids = tripPlayerIds(rounds, ctx);
  const span = tripSpan(trip, rounds);
  const missing = missingCards(rounds, ctx);
  const trophies = (res?.trophies || []).filter((t) => t.line).slice(0, 5);
  const hero = res?.hero?.winner ? res.hero : null;
  const podiums = res?.podiums || [];
  const roundFacts = rounds.map((r) => {
    const p = podiums.find((x) => x.round.id === r.id);
    const first = (p?.podium || []).filter((x) => x.place === 1);
    const rows = p?.rows || [];
    const lastRow = rows.length > 3 ? rows[rows.length - 1] : null;
    const m = missing.find((x) => x.roundId === r.id);
    return {
      name: dayOf(r) === r.name ? r.name : `${dayOf(r)} — ${txt(r.name, 40)}`, format: FORMAT[r.format] || '',
      winners: first.map((x) => x.name).join(' & '), score: first[0]?.score || '',
      podium: (p?.podium || []).slice(0, 3).map((x) => `${x.name} ${x.score}`.trim()),
      ...(lastRow && lastRow.place > 3 ? { last: `${lastRow.name} ${lastRow.score}`.trim() } : {}),
      cards: m?.have ?? 0, of: m?.of ?? 0,
    };
  });
  const roundDay = (id) => { const r = rounds.find((x) => x.id === id); return r ? dayOf(r) : ''; };
  const tripIds = new Set(ids);
  const moments = postMoments(posts).filter((m) => tripIds.has(m.player_id))
    .sort((a, b) => MOMENT_KINDS.indexOf(a.kind) - MOMENT_KINDS.indexOf(b.kind) || String(a.at).localeCompare(String(b.at)))
    .slice(0, 6).map((m) => ({ kind: m.kind, name: nameOf(m.player_id), hole: m.hole, round: roundDay(m.round_id) }));
  const hl = holeHighlights(rounds, ctx);
  const fines = (res?.tally || []).slice(0, 3).map((t) => ({ name: nameOf(t.player_id), count: t.count, titles: [...new Set(t.titles)].slice(0, 3) }));
  const awardRows = res?.awards?.awards || [];
  const awards = awardRows.map((a) => awardItem(a, { nominations: res.awards.nominations || [], votes: res.awards.votes || [], nameOf }))
    .filter(Boolean).slice(0, 5).map((a) => ({ title: txt(a.title, 60), name: a.winner.name, fine: a.kind === 'fine' }));
  return {
    v: 1,
    trip: { name: txt(trip.name, 80), dates: datesWords(span.start, span.end), year: String(span.end || span.start || '').slice(0, 4), rounds: rounds.length },
    players: ids.map(nameOf).filter(Boolean).slice(0, 40),
    winner: hero ? { trophy: hero.name, names: hero.winner.names, line: hero.line, score: hero.st?.rows?.[0]?.text || '' } : null,
    trophies: trophies.map((t) => ({ trophy: t.name, names: t.winner?.names || '', line: t.line })),
    history: historyLines(trophies, honourBoard, trip.id),
    cup: res?.cup?.text ? txt(res.cup.text, 120) : null,
    rounds: roundFacts,
    big: hl.big.map(({ name, strokes, par, hole, round }) => ({ name, strokes, par, hole, round })),
    birdies: hl.birdies.map(({ name, count }) => ({ name, count })),
    comps: (res?.sides || []).slice(0, 6).map((s) => ({ label: txt(s.label, 60), name: s.name })),
    moments,
    photos: (res?.photos || []).length,
    tribunal: tribunalFacts({ tribunal, cases, casePosts, trip, rounds, nameOf }),
    fines, awards,
    missing: missing.filter((m) => m.of > m.have).map((m) => ({ round: m.name, have: m.have, of: m.of })),
    cards: cardsIn(missing),
  };
}

/** Is the saved recap behind the data? (More cards in since it was written.) */
export const recapOutOfDate = (recap, facts) => !!recap && !!facts && Number(facts.cards || 0) > Number(recap.cards || 0);

// ------------------------------------------------------------------ Reading it out: two voices

/** Pitch and speed for each commentator (so even one voice on the phone sounds like two people). */
export const VOICE_STYLE = { A: { pitch: 0.8, rate: 1.06 }, B: { pitch: 1.25, rate: 0.94 } };

/**
 * Two different English voices for Rex (A) and Bev (B): the best two by voiceScore, preferring different accents
 * (en-AU / en-GB / en-US). One voice only: both use it (the pitch tells them apart). None: { A: null, B: null }.
 */
export function pickDuoVoices(voices = []) {
  const good = (voices || []).filter((v) => voiceScore(v) > 0).sort((a, b) => voiceScore(b) - voiceScore(a));
  if (!good.length) return { A: null, B: null, distinct: false };
  const A = good[0];
  const lang = (v) => String(v.lang || '').replace('_', '-').toLowerCase();
  const B = good.find((v) => v !== A && lang(v) !== lang(A)) || good.find((v) => v !== A && v.name !== A.name) || A;
  return { A, B, distinct: B !== A };
}

/** Can this browser read it out at all? */
export const canSpeak = (w = typeof window !== 'undefined' ? window : {}) => !!(w && w.speechSynthesis && w.SpeechSynthesisUtterance);

/**
 * EXTENSION POINT — a real recorded voice. Today the phone reads the script with its own voices (free). A proper
 * broadcast voice would come from an external text-to-speech service, which needs a paid key — not added. When one
 * is: the server makes an audio file per line, stores it, and `recordedAudio(recap)` returns [{ who, url }] for the
 * player to play instead of the phone's voices. Until then it's always null.
 */
export function recordedAudio(recap) { // eslint-disable-line no-unused-vars
  return null;
}

/**
 * Reads the script line by line, in two voices, never over itself. synth: window.speechSynthesis; Utterance:
 * SpeechSynthesisUtterance. play(lines, { from, onLine(i), onDone() }); pause(); resume(); stop().
 */
export function createDuoReader(synth, Utterance, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let token = 0;
  let timer = null;
  let voices = null;
  const clear = () => { if (timer) { clearTimer(timer); timer = null; } };
  const pick = () => (voices ||= pickDuoVoices(synth?.getVoices?.() || []));
  const reader = {
    get ok() { return !!synth && !!Utterance; },
    voices: () => pick(),
    play(lines = [], { from = 0, onLine, onDone } = {}) {
      token += 1;
      const mine = token;
      clear();
      try { synth?.cancel(); } catch { /* fine */ }
      voices = null; // the phone may have loaded its voices since
      const say = (i) => {
        if (mine !== token) return;
        if (i >= lines.length) { token += 1; onDone?.(); return; }
        onLine?.(i);
        const l = lines[i];
        let done = false;
        const next = () => { if (done || mine !== token) return; done = true; clear(); say(i + 1); };
        if (!synth || !Utterance) { next(); return; }
        try {
          const u = new Utterance(String(l.text || ''));
          const v = pick()[l.who === 'B' ? 'B' : 'A'];
          if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-AU';
          const st = VOICE_STYLE[l.who === 'B' ? 'B' : 'A'];
          u.pitch = st.pitch;
          u.rate = st.rate;
          u.onend = next;
          u.onerror = next;
          timer = setTimer(next, voiceTimeoutMs(l.text, st.rate));
          synth.speak(u);
        } catch { next(); }
      };
      say(Math.max(0, from));
    },
    stop() {
      token += 1;
      clear();
      try { synth?.cancel(); } catch { /* fine */ }
    },
  };
  return reader;
}
