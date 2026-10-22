// Round replay as a story (ov20, 23 Oct 2026). Josh: "a bit quick… group some holes and show the change there with
// commentary… more about the key moments but still track it through, then slow down for the end."
//
// Plain-words version:
//   - buildReplay (replay.js) gives a frame per hole: the leaderboard after it, plus its moments.
//   - Here the frames become BEATS. Quiet stretches of holes share one beat ("Holes 1–4: a steady start. Josh &
//     Hamish out in front, by 1 shot."). Key moments get their own beat: lead changes, eagles and aces, blow-ups,
//     big swings, and (while there's room) birdies and side comp wins. The front nine ends on a beat (the turn).
//     The last three holes get a beat each, then the winner.
//   - Every beat ends with the board as it stood after its last hole, so the standings are tracked all the way.
//   - Each beat has its line (the group's live commentary from the `commentary` table when there is one for that
//     hole, otherwise a line made here from the beat) and a time on screen worked out from how long the line takes
//     to read. Normal is the default; Fast is about twice as quick; tests use 'quick'.
// No screen code and no AI call here: the screen (screens/Replay.jsx) just plays the steps.
import { gapWords } from './replay.js';
import { pickLine, captionFor, topMoment, ordinal, DEFAULT_STYLE } from './replay-lines.js';

// ---------- Which holes are key ----------

/** How much a moment earns its own beat (0 = never on its own). */
const KEY_SCORE = { lead_change: 10, ace: 10, eagle: 9, swing: 7, tied_lead: 6, blowup: 5, climber: 4, faller: 4, side_comp: 3, birdie: 3 };
/** Always their own beat, however many there are. */
const MUST_KEEP = new Set(['lead_change', 'ace', 'eagle']);
/** A quiet stretch is at most this many holes, so the board moves on often enough to follow. */
export const MAX_STRETCH = 4;
/** The last this-many holes get a beat each. */
export const FINISH_HOLES = 3;

function keyScore(frame) {
  let best = 0;
  for (const m of frame.moments || []) {
    if (m.kind === 'win' || m.kind === 'close') continue;
    best = Math.max(best, KEY_SCORE[m.kind] || 0);
  }
  return best;
}
const isMust = (frame) => (frame.moments || []).some((m) => MUST_KEEP.has(m.kind));

/** Split n frames into chunks of at most `max`, sizes as even as possible (5 → 3 + 2). */
export function chunk(list, max = MAX_STRETCH) {
  if (!list.length) return [];
  const parts = Math.ceil(list.length / max);
  const out = [];
  let at = 0;
  for (let p = 0; p < parts; p++) {
    const size = Math.ceil((list.length - at) / (parts - p));
    out.push(list.slice(at, at + size));
    at += size;
  }
  return out;
}

/** "Hole 10", "Holes 1–4", "Holes 18, 1, 2", or (mixed starts) "4 holes in". */
export function holesLabel(frames, from, to) {
  const hs = [];
  for (let i = from; i <= to; i++) hs.push(frames[i].hole);
  if (hs.some((h) => h == null)) return to === from ? frames[to].label : `${from + 1}–${to + 1} holes in`;
  if (hs.length === 1) return `Hole ${hs[0]}`;
  const run = hs.every((h, i) => i === 0 || h === hs[i - 1] + 1);
  if (run) return `Holes ${hs[0]}–${hs[hs.length - 1]}`;
  return hs.length <= 3 ? `Holes ${hs.join(', ')}` : `Holes ${hs[0]}–${hs[hs.length - 1]}`;
}

/**
 * The beats of a replay. Returns [{ i, type: 'stretch' | 'moment' | 'finish', from, to, label, moments, top, key,
 * turn, left, standing: { kind, name, other, gap, gapText } }]. `from`/`to` are frame indexes (inclusive); the
 * board shown is frames[to].
 */
export function buildBeats(replay) {
  if (!replay || replay.empty) return [];
  const frames = replay.frames;
  const n = frames.length;
  const finishFrom = n >= 6 ? n - FINISH_HOLES : n; // frames from here on get a beat each
  const turnAt = n >= 14 ? Math.floor(n / 2) - 1 : -1; // after the 9th of 18

  // 1. Which front frames are key: the must-keeps, then the best of the rest while there's room (about 2 in 5).
  const front = [...Array(finishFrom).keys()];
  const budget = Math.max(3, Math.round(finishFrom * 0.4));
  const key = new Set(front.filter((i) => isMust(frames[i])));
  const rest = front.filter((i) => !key.has(i) && keyScore(frames[i]) >= 3)
    .sort((a, b) => keyScore(frames[b]) - keyScore(frames[a]) || (frames[b].drama || 0) - (frames[a].drama || 0) || a - b);
  for (const i of rest) { if (key.size >= budget) break; key.add(i); }

  // 2. Segments: a key frame alone; quiet runs (split at the turn) chunked to MAX_STRETCH.
  let segs = [];
  let run = [];
  const flush = () => { for (const c of chunk(run)) segs.push({ type: 'stretch', from: c[0], to: c[c.length - 1] }); run = []; };
  for (const i of front) {
    if (key.has(i)) { flush(); segs.push({ type: 'moment', from: i, to: i }); } else run.push(i);
    if (i === turnAt) flush();
  }
  flush();

  // 3. Fewer transitions: a single quiet hole joins the key beat before it (or after it), never across the turn.
  const crossesTurn = (a, b) => turnAt >= 0 && a <= turnAt && b > turnAt;
  for (let s = 0; s < segs.length; s++) {
    const g = segs[s];
    if (g.type !== 'stretch' || g.to !== g.from) continue;
    const prev = segs[s - 1];
    const next = segs[s + 1];
    if (prev?.type === 'moment' && !crossesTurn(prev.from, g.to)) { prev.to = g.to; g.gone = true; } else if (next?.type === 'moment' && !crossesTurn(g.from, next.to)) { next.from = g.from; g.gone = true; }
  }
  segs = segs.filter((g) => !g.gone);
  for (let i = finishFrom; i < n; i++) segs.push({ type: 'finish', from: i, to: i });

  // 4. Fill each beat in.
  return segs.map((g, i) => {
    const moments = [];
    for (let k = g.from; k <= g.to; k++) for (const m of frames[k].moments) if (m.kind !== 'win' && m.kind !== 'close') moments.push({ ...m, frame: k });
    moments.sort((a, b) => b.drama - a.drama || a.frame - b.frame);
    const top = topMoment({ moments });
    return {
      i, type: g.type, from: g.from, to: g.to, label: holesLabel(frames, g.from, g.to), moments, top,
      key: g.type !== 'stretch', turn: g.to === turnAt, left: n - 1 - g.to,
      standing: standingOf(replay, g.from, g.to),
    };
  });
}

/** How the top of the board changed over a beat: new leader, same (further ahead / closer), or tied. */
export function standingOf(replay, from, to) {
  const f = replay.frames[to];
  const before = from > 0 ? replay.frames[from - 1] : null;
  const top = f.rows[0];
  const second = f.rows[1];
  const gap = f.gap;
  const base = { name: top?.name || '', other: second?.name || '', gap, gapText: gapWords(replay.format, gap) };
  if (!top || !top.thru) return { ...base, kind: 'none' };
  if (!f.leader) return { ...base, kind: 'tied' };
  if (!before || before.leader !== f.leader) return { ...base, kind: 'new' };
  if (before.gap != null && gap > before.gap) return { ...base, kind: 'extends' };
  if (before.gap != null && gap < before.gap) return { ...base, kind: 'narrows' };
  return { ...base, kind: 'same' };
}

// ---------- Lines ----------

const LEAD_KINDS = new Set(['lead_change', 'new_leader', 'tied_lead', 'swing']);

/** One sentence on the standings ("Bo still in front, by 2 points."). */
export function standingLine(st, style, seed) {
  if (!st || st.kind === 'none') return '';
  return pickLine(`standing_${st.kind}`, style, { name: st.name, other: st.other, gap: st.gapText }, seed);
}

/**
 * Live commentary lines (the `commentary` table, status 'ready') by hole: the best one for each hole.
 * Rows: { key, kind, facts, line }. The round report comes back separately.
 */
const COMMENT_ORDER = { ace: 0, eagle: 1, charge: 2, lead: 3, birdies: 4, wipe: 5 };
export function commentaryByHole(rows = []) {
  const byHole = {};
  let report = null;
  for (const r of rows || []) {
    const line = cleanLine(r?.line);
    if (!line || (r.status && r.status !== 'ready')) continue;
    if (r.kind === 'report') { report = line; continue; }
    if (!(r.kind in COMMENT_ORDER)) continue;
    const hole = Number(r.facts?.hole ?? String(r.key || '').split(':')[3]);
    if (!hole) continue;
    const had = byHole[hole];
    if (!had || COMMENT_ORDER[r.kind] < COMMENT_ORDER[had.kind]) byHole[hole] = { kind: r.kind, line };
  }
  return { byHole, report };
}
/** Drop the 🎙️ mark and keep it to a readable length. */
export function cleanLine(text, max = 180) {
  let s = String(text || '').replace(/^\s*🎙️\s*/u, '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  s = stop > 60 ? cut.slice(0, stop + 1) : `${cut.slice(0, max - 1).trimEnd()}…`;
  return s;
}

/** The words for one beat. */
export function beatLine(beat, replay, { style = DEFAULT_STYLE, seed = 0, jokes = [], used = new Set(), comments = {} } = {}) {
  const frames = replay.frames;
  const st = beat.standing;
  const plural = !!replay.teams;
  const say = (m, sd = seed) => captionFor(m, { style, seed: sd, jokes, used, plural });
  // Side comp wins are always mentioned, even when something bigger happened on the same hole.
  const comps = beat.moments.filter((x) => x.kind === 'side_comp' && x !== beat.top).slice(0, 2).map((x, i) => say(x, seed + 11 + i));
  // The group's own live commentary for a hole in this beat, if it was written.
  let live = null;
  for (let k = beat.from; k <= beat.to && !live; k++) live = comments[frames[k].hole]?.line || null;
  const standing = beat.turn
    ? pickLine(st.kind === 'tied' ? 'turn_tied' : 'turn', style, { name: st.name, other: st.other, gap: st.gapText }, seed)
    : standingLine(st, style, seed + 1);

  if (beat.type === 'stretch') {
    const birdies = beat.moments.filter((m) => m.kind === 'birdie' || m.kind === 'eagle').length;
    const minor = beat.top && (beat.top.drama || 0) >= 2 ? beat.top : null;
    let mood;
    if (live) mood = `${beat.label}: ${live}`;
    else if (birdies >= 2) mood = pickLine('stretch_birdies', style, { holes: beat.label, count: birdies }, seed);
    else if (minor) mood = `${beat.label}: ${say(minor)}`;
    else mood = pickLine(beat.from === 0 ? 'stretch_start' : 'stretch_quiet', style, { holes: beat.label }, seed);
    return join(mood, ...comps, standing);
  }

  // A key moment or one of the last holes.
  const m = beat.top;
  let line;
  if (live) line = live;
  else if (m?.kind === 'swing') line = pickLine('swing', style, { hole: holeText(m.hole), name: st.name, gap: st.gapText }, seed);
  else if (m) line = say(m);
  else line = pickLine('quiet', style, { hole: holeText(frames[beat.to].hole) }, seed);
  // Say where the top of the board stands, unless the line already did.
  const aboutLead = live ? /\b(lead|leads|front|top)\b/i.test(live) : !!m && LEAD_KINDS.has(m.kind);
  const parts = [line, ...comps];
  if (!aboutLead || beat.turn) parts.push(standing);
  if (beat.type === 'finish' && beat.left > 0) parts.push(pickLine(beat.left === 1 ? 'last_hole' : 'to_play', style, { left: beat.left }, seed + 2));
  return join(...parts);
}
const holeText = (h) => (h == null ? 'this hole' : `the ${ordinal(h)}`);
/** Sentences joined with a space; one that ends on a quote without a full stop gets one (“…dam”. Al still…). */
const join = (...parts) => parts.map((p) => String(p || '').trim()).filter(Boolean)
  .map((p, i, all) => (i < all.length - 1 && /[^.!?…]["”]$/.test(p) ? `${p}.` : p)).join(' ');

// ---------- Timing ----------

/** Shortest time on screen for each kind of step (ms, at Normal). */
export const MIN_MS = { welcome: 3500, field: 4000, stretch: 4000, moment: 5000, finish: 5500, finishCard: 6000, winner: 7500, awards: 7500 };
export const MAX_MS = 12000;
/** About how long a line takes to read: a beat to settle, then ~18 letters a second. */
export const readMs = (text) => 1200 + 55 * String(text || '').length;
/** How long a step holds at Normal: long enough to read, never less than its kind's minimum. */
export function holdMs(kind, text) {
  const min = MIN_MS[kind] ?? MIN_MS.stretch;
  return Math.round(Math.min(Math.max(min, readMs(text)), Math.max(min, MAX_MS)));
}

/** Playing speeds. 'quick' is for tests only (every step 150 ms). */
export const SPEEDS = [
  { key: 'normal', name: 'Normal', factor: 1 },
  { key: 'fast', name: 'Fast', factor: 0.5 },
];
/** The fade between steps, in ms. */
export const TRANSITION_MS = { normal: 700, fast: 350, quick: 0 };

/** A step's time at a speed (null = it waits, like the end card). */
export function stepMs(step, speed = 'normal') {
  if (!step || step.ms == null) return null;
  if (speed === 'quick') return 150;
  if (speed === 'fast') return Math.round(Math.max(2000, step.ms * 0.5));
  return step.ms;
}

/** Total running time in seconds at a speed. */
export const storySeconds = (steps, speed = 'normal') => Math.round(steps.reduce((a, s) => a + (stepMs(s, speed) || 0), 0) / 1000);

// ---------- The whole story ----------

/**
 * The replay as steps the screen plays in order, each with its line and time:
 * welcome → the field → beats (the "3 to play" card before the last three) → winner → awards → end.
 * opts: { style, seed, jokes, commentary: rows from the commentary table, roundName, courseName }.
 * Step: { scene: 'welcome' | 'field' | 'race' | 'finish' | 'winner' | 'awards' | 'end', beat?, frame?, kind, text, ms }.
 */
export function buildStory(replay, { style = DEFAULT_STYLE, seed = 0, jokes = [], commentary = [], roundName = '', courseName = '' } = {}) {
  if (!replay || replay.empty) return { beats: [], steps: [{ scene: 'end', kind: 'end', text: '', ms: null }] };
  const used = new Set();
  const { byHole, report } = commentaryByHole(commentary);
  const beats = buildBeats(replay);
  const steps = [];
  const add = (scene, kind, text, extra = {}) => steps.push({ scene, kind, text, ms: holdMs(kind, text), ...extra });
  let sd = seed;
  const next = () => (sd += 7919);

  add('welcome', 'welcome', pickLine('welcome', style, { round: roundName || 'Today’s round', course: courseName || 'the course' }, next()));
  add('field', 'field', pickLine('field', style, { count: replay.subjects.length }, next()));
  for (const b of beats) {
    if (b.type === 'finish' && replay.finish && b.from === replay.finish.frameIndex + 1) {
      const f = replay.finish;
      add('finish', 'finishCard', pickLine(f.close ? 'close' : 'gap', style, { name: f.leader, other: f.second, gap: f.gapText, left: f.left }, next()));
    }
    b.text = beatLine(b, replay, { style, seed: next(), jokes, used, comments: byHole });
    add('race', b.type, b.text, { beat: b.i, frame: b.to });
  }
  if (replay.winner) {
    const last = replay.frames[replay.frames.length - 1];
    add('winner', 'winner', captionFor(last.moments.find((m) => m.kind === 'win'), { style, seed: next(), jokes, used, plural: !!replay.teams }));
  }
  const a = replay.awards;
  if (a.climber || a.worst || a.best) {
    let text = '';
    const s = next();
    if (a.worst && a.worst.diff >= 2) text = pickLine('award_worst', style, { name: a.worst.name, strokes: a.worst.strokes, hole: `the ${ordinal(a.worst.hole)}` }, s);
    else if (a.climber) text = pickLine('award_climber', style, { name: a.climber.name, places: a.climber.places }, s);
    else if (a.best) text = pickLine('award_best', style, { name: a.best.name, strokes: a.best.strokes, hole: `the ${ordinal(a.best.hole)}` }, s);
    add('awards', 'awards', text);
  }
  // The end card waits; the round report (live commentary) is read there when there is one.
  steps.push({ scene: 'end', kind: 'end', text: report || pickLine('end', style, {}, next()), ms: null });
  return { beats, steps };
}

/** The step "Skip to the end" jumps to: the winner (or whatever comes after the race). */
export function skipTarget(steps) {
  const w = steps.findIndex((s) => s.scene === 'winner');
  if (w >= 0) return w;
  const afterRace = steps.findIndex((s, i) => i > 0 && !['welcome', 'field', 'race', 'finish'].includes(s.scene));
  return afterRace >= 0 ? afterRace : steps.length - 1;
}

/** Plain-words list of the beats, for checking and for the build notes. */
export function describeBeats(story) {
  return story.steps.map((s) => `${s.scene === 'race' ? story.beats[s.beat].label : s.scene}${s.ms != null ? ` (${(s.ms / 1000).toFixed(1)} s)` : ''}: ${s.text}`);
}

