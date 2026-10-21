// Round replay (Stage 12, v1): turns a finished round into a sequence of frames — the leaderboard after each hole —
// plus the moments worth shouting about. Pure functions, no screen code. The screen (screens/Replay.jsx) plays it.
//
// Plain-words version:
//   - Each team or player's holes are put in the order they were played (by when the score was saved, so a
//     shotgun start on the 10th works), and frame k = everyone's first k holes.
//   - The leaderboard for each frame comes from roundBoard (board.js), so it's the same maths as the live board,
//     for all four formats. The last frame uses every score, so the winner always matches the leaderboard.
//   - Moments (birdies, blow-ups, lead changes, climbers, side comp wins, a close finish, the winner) get a drama
//     score. Quiet holes fly by; dramatic ones get longer on screen.
import { roundBoard, compBonuses, courseHoles, isNetFormat, isTeamFormat, formatName } from './board.js';
import { formatToPar } from './scoring.js';
import { sortOwnEntries } from './sidecomps.js';

const nameOf = (p) => (p ? p.nickname || p.name : '?');

/** Is the round over (locked, or everyone through every hole)? The replay button only shows then. */
export function isRoundFinished(round, board) {
  if (!round) return false;
  if (round.status === 'locked') return true;
  const rows = board?.rows || [];
  return rows.length > 0 && rows.every((r) => r.finished);
}

/** Index score rows: subject -> hole -> score. */
function indexScores(scores, roundId) {
  const idx = {};
  for (const s of scores || []) {
    if (roundId && s.round_id && s.round_id !== roundId) continue;
    (idx[s.subject_id] ||= {})[s.hole] = s;
  }
  return idx;
}

const played = (s) => !!s && (s.strokes != null || s.picked_up);
const byTimeThenHole = (a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.n - b.n);

/**
 * Who's in the race and how their holes map to score rows.
 * Returns [{ id, name, players, scoreIds: [subject ids holding their scores], order: [hole numbers in play order] }].
 */
export function raceSubjects({ round, teams = [], roundPlayers = [], playersById = {}, scoresBySubject = {}, holeNums = [] }) {
  const valid = new Set(holeNums);
  if (round.format === 'ambrose' || round.format === 'fourball') {
    return teams.map((t) => {
      const scoreIds = round.format === 'ambrose' ? [t.id] : (t.players || []).map((p) => p.id);
      const holes = [];
      for (const n of valid) {
        const rows = scoreIds.map((id) => scoresBySubject[id]?.[n]);
        // Ambrose: the team's own score (needs strokes). 4BBB: a hole counts once both players have a score.
        const ok = round.format === 'ambrose' ? rows[0]?.strokes != null : rows.length > 0 && rows.every(played);
        if (ok) holes.push({ n, t: rows.map((r) => r.updated_at || '').sort().pop() });
      }
      return { id: t.id, name: t.name, players: t.players || [], scoreIds, order: holes.sort(byTimeThenHole).map((h) => h.n) };
    });
  }
  return roundPlayers.map((rp) => {
    const sc = scoresBySubject[rp.player_id] || {};
    const holes = Object.values(sc).filter((s) => valid.has(s.hole) && played(s)).map((s) => ({ n: s.hole, t: s.updated_at || '' }));
    const p = playersById[rp.player_id];
    return { id: rp.player_id, name: nameOf(p), players: p ? [p] : [], scoreIds: [rp.player_id], order: holes.sort(byTimeThenHole).map((h) => h.n) };
  });
}

/** The value a row is judged on: points (Stableford, 4BBB) or net to par (Ambrose, stroke play). */
const scoreOf = (format, r) => (isNetFormat(format) ? r.netToPar : r.points);
function displayOf(format, r) {
  if (!r.thru) return '–';
  if (isNetFormat(format)) return formatToPar(r.netToPar, r.finished && r.netToPar % 1 ? 1 : 0);
  return `${r.points}`;
}
const round1 = (n) => Math.round(n * 10) / 10;

/** Gap between first and second, in the format's unit (always positive). */
export function gapBetween(format, a, b) {
  if (!a || !b || !a.thru || !b.thru) return null;
  const v = (r) => (r.score !== undefined ? r.score : scoreOf(format, r));
  return round1(Math.abs(v(a) - v(b)));
}

/** "2 points", "1 shot", "1.5 shots". */
export function gapWords(format, gap) {
  if (gap == null) return '';
  const unit = isNetFormat(format) ? 'shot' : 'point';
  return `${gap} ${unit}${gap === 1 ? '' : 's'}`;
}

/** A side comp's label for people. */
const compLabel = (kind) => (kind === 'ctp' ? 'closest to the pin' : 'longest drive');

/** The winner of each side comp: CTP / LD (side_entries) and the group's own comps (side_comp_entries). */
export function sideCompWinners({ round, sideEntries = [], ownDefs = [], ownEntries = [] }) {
  const out = [];
  const comps = [
    ...(round.ctp_holes || []).map((h) => ({ kind: 'ctp', hole: Number(h) })),
    ...(round.ld_holes || []).map((h) => ({ kind: 'ld', hole: Number(h) })),
  ];
  for (const c of comps) {
    const here = sideEntries.filter((e) => e.kind === c.kind && Number(e.hole) === c.hole);
    const confirmed = here.find((e) => e.confirmed);
    const measured = here.filter((e) => e.distance_m != null);
    const best = confirmed || [...measured].sort((a, b) => (c.kind === 'ctp' ? a.distance_m - b.distance_m : b.distance_m - a.distance_m))[0];
    if (best) out.push({ comp: compLabel(c.kind), emoji: c.kind === 'ctp' ? '🎯' : '💣', hole: c.hole, playerId: best.player_id });
  }
  const defsById = Object.fromEntries((ownDefs || []).map((d) => [d.id, d]));
  for (const rc of round.own_comps || []) {
    const def = defsById[rc.comp];
    if (!def) continue;
    const holes = (rc.holes || []).map(Number);
    for (const hole of holes.length ? holes : [null]) {
      const list = (ownEntries || []).filter((e) => e.comp_id === def.id && (hole == null ? e.hole == null : Number(e.hole) === hole));
      const best = sortOwnEntries(def.how, list)[0];
      if (!best || (!best.confirmed && (def.how === 'pick' || best.value == null))) continue;
      out.push({ comp: def.name, emoji: def.emoji || '🏅', hole, playerId: best.player_id });
    }
  }
  return out;
}

/**
 * Build the replay.
 * input: { round, course, teams, roundPlayers, playersById, scores: [score rows], quickResults, sideEntries,
 *          ownDefs, ownEntries, posts }
 * Returns { format, formatLabel, unit, holes, subjects, frames, finish, winner, awards, empty }.
 */
export function buildReplay(input) {
  const { round, course, teams = [], roundPlayers = [], playersById = {}, scores = [], quickResults = [], sideEntries = [], ownDefs = [], ownEntries = [], posts = [] } = input;
  const format = round.format || 'stableford';
  const holes = courseHoles(course);
  const holeNums = holes.map((h) => h.n);
  const holeBy = Object.fromEntries(holes.map((h) => [h.n, h]));
  const scoresBySubject = indexScores(scores, round.id);
  const subjects = raceSubjects({ round, teams, roundPlayers, playersById, scoresBySubject, holeNums });
  const K = Math.max(0, ...subjects.map((s) => s.order.length));
  const net = isNetFormat(format);
  const unit = net ? 'shots' : 'points';
  // Which race subject a player belongs to (for side comps and posts).
  const subjectOfPlayer = {};
  for (const s of subjects) for (const p of s.players) subjectOfPlayer[p.id] = s.id;
  const playerLabel = (pid) => nameOf(playersById[pid]);

  const base = { round, course, teams, roundPlayers, playersById };
  const frames = [];
  let prevLeader = null;
  let prevOrder = null;
  for (let k = 1; k <= K; k++) {
    const last = k === K;
    // Frame k: everyone's first k holes (the last frame: every score, so it matches the leaderboard exactly).
    const idx = {};
    const playedSet = {};
    const fresh = [];
    for (const s of subjects) {
      const hs = s.order.slice(0, k);
      playedSet[s.id] = new Set(hs);
      if (s.order.length >= k) fresh.push({ subject: s, hole: s.order[k - 1] });
      for (const sid of s.scoreIds) {
        const all = scoresBySubject[sid] || {};
        idx[sid] = last ? all : Object.fromEntries(hs.filter((n) => all[n]).map((n) => [n, all[n]]));
      }
    }
    // Ambrose bonus strokes: a side comp counts once the winner's team has played that hole.
    const entriesNow = last ? sideEntries : sideEntries.filter((e) => playedSet[subjectOfPlayer[e.player_id]]?.has(Number(e.hole)));
    const board = roundBoard({
      ...base, scoresIdx: { [round.id]: idx }, quickResults: last ? quickResults : [],
      bonuses: compBonuses(round, teams, entriesNow),
    });
    const winPct = Object.fromEntries((board.projection || []).map((r) => [r.id, r.proj?.winPct ?? 0]));
    const rows = board.rows.map((r) => ({
      id: r.id, name: r.name, players: r.players, rank: r.rank, rankLabel: r.rankLabel, thru: r.thru, finished: !!r.finished,
      score: scoreOf(format, r), display: displayOf(format, r), winPct: winPct[r.id] ?? 0,
    }));
    const order = rows.map((r) => r.id);
    const top = rows[0];
    const leader = top && top.thru > 0 && rows[1]?.rank !== 1 ? top.id : null;
    const tiedTop = top && top.thru > 0 && rows[1]?.rank === 1;
    // The hole everyone has just played (normal starts), or null (shotgun / mixed).
    const freshHoles = [...new Set(fresh.map((f) => f.hole))];
    const hole = freshHoles.length === 1 ? freshHoles[0] : null;

    const moments = [];
    // Birdies, eagles, aces, blow-ups and pick-ups (gross, against par).
    for (const f of fresh) {
      const h = holeBy[f.hole];
      if (!h) continue;
      const who = format === 'fourball'
        ? f.subject.scoreIds.map((pid) => ({ pid, name: playerLabel(pid), s: scoresBySubject[pid]?.[f.hole] }))
        : [{ pid: format === 'ambrose' ? null : f.subject.id, name: f.subject.name, s: scoresBySubject[f.subject.scoreIds[0]]?.[f.hole] }];
      for (const w of who) {
        if (!w.s) continue;
        const base2 = { subjectId: f.subject.id, playerId: w.pid, name: w.name, hole: f.hole, par: h.par };
        if (w.s.picked_up) { moments.push({ kind: 'pickup', drama: 1, ...base2 }); continue; }
        if (w.s.strokes == null) continue;
        const diff = w.s.strokes - h.par;
        if (w.s.strokes === 1) moments.push({ kind: 'ace', drama: 10, strokes: 1, ...base2 });
        else if (diff <= -2) moments.push({ kind: 'eagle', drama: diff <= -3 ? 9 : 7, strokes: w.s.strokes, ...base2 });
        else if (diff === -1) moments.push({ kind: 'birdie', drama: 3, strokes: w.s.strokes, ...base2 });
        else if (diff >= 3) moments.push({ kind: 'blowup', drama: Math.min(6, diff), strokes: w.s.strokes, over: diff, ...base2 });
      }
    }
    // The lead.
    if (leader && leader !== prevLeader) {
      const late = k / Math.max(1, K);
      if (prevLeader) moments.push({ kind: 'lead_change', drama: Math.round(5 + late * 3), subjectId: leader, name: top.name, other: rows.find((r) => r.id === prevLeader)?.name || '' });
      else moments.push({ kind: 'new_leader', drama: k <= 2 ? 2 : Math.round(3 + late * 4), subjectId: leader, name: top.name });
    } else if (!leader && tiedTop && prevLeader && k > 1) {
      moments.push({ kind: 'tied_lead', drama: 3, subjectId: top.id, name: top.name, other: rows[1].name });
    }
    if (leader) prevLeader = leader;
    // Climbers and fallers (2+ places in one hole), when there's a field to climb through.
    const moves = {};
    if (prevOrder && rows.length >= 4) {
      let up = null; let down = null;
      for (const r of rows) {
        const before = prevOrder.indexOf(r.id);
        const now = order.indexOf(r.id);
        if (before < 0) continue;
        const d = before - now;
        moves[r.id] = d;
        if (d >= 2 && (!up || d > up.places)) up = { kind: 'climber', drama: Math.min(5, 1 + d), subjectId: r.id, name: r.name, places: d, rank: now + 1 };
        if (d <= -2 && (!down || -d > down.places)) down = { kind: 'faller', drama: Math.min(4, 1 - d), subjectId: r.id, name: r.name, places: -d, rank: now + 1 };
      }
      if (up) moments.push(up);
      if (down) moments.push(down);
    }
    prevOrder = order;
    frames.push({
      k, hole, par: hole ? holeBy[hole]?.par ?? null : null, label: hole ? `Hole ${hole}` : `${k} hole${k === 1 ? '' : 's'} in`,
      rows, leader, moves, moments, time: fresh.map((f) => {
        const ids = f.subject.scoreIds;
        return ids.map((id) => scoresBySubject[id]?.[f.hole]?.updated_at || '').sort().pop() || '';
      }).sort().pop() || '',
      gap: gapBetween(format, rows[0], rows[1]),
    });
  }

  // Side comp wins: on the frame where the winner's team (or the winner) played that hole; whole-round comps at the end.
  for (const w of sideCompWinners({ round, sideEntries, ownDefs, ownEntries })) {
    const sid = subjectOfPlayer[w.playerId];
    let at = frames.length - 1;
    if (w.hole != null && sid) {
      const s = subjects.find((x) => x.id === sid);
      const i = s ? s.order.indexOf(w.hole) : -1;
      if (i >= 0) at = i;
    }
    if (at >= 0) frames[at].moments.push({ kind: 'side_comp', drama: 3, subjectId: sid || null, playerId: w.playerId, name: playerLabel(w.playerId), comp: w.comp, emoji: w.emoji, hole: w.hole });
  }

  // Feed posts from the round (people's own posts, not the automatic ones): on the frame they were posted during.
  const roundPosts = (posts || []).filter((p) => p.round_id === round.id && p.kind !== 'auto' && (p.body || p.photo_url));
  for (const p of roundPosts) {
    if (!frames.length) break;
    let at = frames.findIndex((f) => f.time && p.created_at && f.time >= p.created_at);
    if (at < 0) at = frames.length - 1;
    const text = String(p.body || '').trim();
    frames[at].moments.push({ kind: 'post', drama: 2, playerId: p.player_id || null, name: p.player_id ? playerLabel(p.player_id) : '', text: text.length > 90 ? `${text.slice(0, 87)}…` : text, photo: p.photo_url || null });
  }

  // A close finish: with 3 to play, how far apart are first and second, and who could still win?
  let finish = null;
  if (K >= 6) {
    const f = frames[K - 4];
    const left = K - f.k;
    const gap = f.gap;
    const close = gap != null && gap <= 2;
    const chances = [...f.rows].sort((a, b) => b.winPct - a.winPct).filter((r) => r.thru > 0).slice(0, 3)
      .map((r) => ({ id: r.id, name: r.name, players: r.players, winPct: r.winPct, display: r.display }));
    finish = { frameIndex: K - 4, left, gap, gapText: gapWords(format, gap), close, leader: f.rows[0]?.name || '', second: f.rows[1]?.name || '', chances };
    if (close) f.moments.push({ kind: 'close', drama: 6, name: finish.leader, other: finish.second, gap: finish.gapText, left });
  }

  // The winner.
  const final = frames[frames.length - 1];
  let winner = null;
  if (final && final.rows[0]?.thru > 0) {
    const w = final.rows[0];
    const tiedWith = final.rows.filter((r, i) => i > 0 && r.rank === 1).map((r) => r.name);
    winner = { id: w.id, name: w.name, players: w.players, display: w.display, score: w.score, tiedWith, by: gapWords(format, final.gap) };
    final.moments.push({ kind: 'win', drama: 10, subjectId: w.id, name: w.name, score: scoreWords(format, w), by: winner.by });
  }

  for (const f of frames) {
    f.moments.sort((a, b) => b.drama - a.drama);
    f.drama = f.moments.reduce((m, x) => Math.max(m, x.drama), 0);
  }

  return {
    format, formatLabel: formatName(format), unit, teams: isTeamFormat(format), holes, subjects, frames, finish, winner,
    awards: buildAwards({ format, frames, subjects, holeBy, scoresBySubject, playerLabel }),
    empty: frames.length === 0,
  };
}

/** "38 points", "−4 net". */
export function scoreWords(format, row) {
  if (!row) return '';
  return isNetFormat(format) ? `${row.display} net` : `${row.score} points`;
}

/** Awards: biggest climber, worst hole, best hole. */
export function buildAwards({ format, frames, subjects, holeBy, scoresBySubject, playerLabel }) {
  const out = { climber: null, worst: null, best: null };
  if (!frames.length) return out;
  // Biggest climber: from their place after 3 holes (or the first frame) to where they finished.
  const from = frames[Math.min(2, frames.length - 1)].rows.map((r) => r.id);
  const to = frames[frames.length - 1].rows;
  for (const r of to) {
    const i = from.indexOf(r.id);
    const j = to.indexOf(r);
    if (i < 0) continue;
    const d = i - j;
    if (d >= 1 && (!out.climber || d > out.climber.places)) out.climber = { name: r.name, players: r.players, places: d, from: i + 1, to: j + 1 };
  }
  // Every hole played (a player, or an Ambrose team), gross against par.
  const all = [];
  for (const s of subjects) {
    for (const sid of s.scoreIds) {
      for (const sc of Object.values(scoresBySubject[sid] || {})) {
        const h = holeBy[sc.hole];
        if (!h || sc.strokes == null || sc.picked_up) continue;
        const players = format === 'ambrose' ? s.players : s.players.filter((p) => p.id === sid);
        all.push({ name: format === 'ambrose' ? s.name : playerLabel(sid), players: players.length ? players : s.players, hole: h.n, par: h.par, si: h.si ?? 18, strokes: sc.strokes, diff: sc.strokes - h.par });
      }
    }
  }
  if (all.length) {
    const worst = [...all].sort((a, b) => b.diff - a.diff || a.si - b.si || a.hole - b.hole)[0];
    const best = [...all].sort((a, b) => a.diff - b.diff || a.si - b.si || a.hole - b.hole)[0];
    out.worst = worst;
    out.best = best;
  }
  return out;
}

/** What the score on a hole is called: ace, albatross, eagle, birdie, par, bogey, double, triple, "+4". */
export function holeWord(strokes, par) {
  if (strokes === 1) return 'hole in one';
  const d = strokes - par;
  return ({ '-3': 'albatross', '-2': 'eagle', '-1': 'birdie', 0: 'par', 1: 'bogey', 2: 'double bogey', 3: 'triple bogey' })[d] || (d > 0 ? `+${d}` : `${d}`);
}

// ---------- Timing ----------

export const SCENE_MS = { welcome: 3200, field: 3600, finish: 5500, winner: 6500, awards: 7500 };
const RACE_BUDGET_MS = 38000;

/** How long a race frame stays on screen: quiet holes fly by, drama lingers. The last three holes go slow. */
export function frameMs(frame, { slow = false } = {}) {
  const ms = 850 + 330 * Math.min(10, frame.drama || 0);
  return Math.round(slow ? ms * 1.5 : ms);
}

/**
 * The replay as a list of steps the screen plays in order:
 * welcome → the field → the race (with the "3 to play" finish card before the last three holes) → winner →
 * awards → end card. `fast` (tests) makes every step quick. The end card has no time: it waits.
 */
export function buildTimeline(replay, { fast = false } = {}) {
  const steps = [];
  if (!replay || replay.empty) return [{ scene: 'end', ms: null }];
  steps.push({ scene: 'welcome', ms: SCENE_MS.welcome });
  steps.push({ scene: 'field', ms: SCENE_MS.field });
  const n = replay.frames.length;
  const slowFrom = replay.finish ? replay.finish.frameIndex + 1 : n;
  const race = replay.frames.map((f, i) => ({ scene: 'race', frame: i, ms: frameMs(f, { slow: i >= slowFrom }), slow: i >= slowFrom }));
  // Keep the race to about 40 seconds however many holes and how much drama.
  const total = race.reduce((a, s) => a + s.ms, 0);
  if (total > RACE_BUDGET_MS) for (const s of race) s.ms = Math.max(600, Math.round((s.ms * RACE_BUDGET_MS) / total));
  for (const s of race) {
    if (replay.finish && s.frame === slowFrom) steps.push({ scene: 'finish', ms: SCENE_MS.finish });
    steps.push(s);
  }
  if (replay.winner) steps.push({ scene: 'winner', ms: SCENE_MS.winner });
  if (replay.awards.climber || replay.awards.worst || replay.awards.best) steps.push({ scene: 'awards', ms: SCENE_MS.awards });
  steps.push({ scene: 'end', ms: null });
  if (fast) for (const s of steps) if (s.ms != null) s.ms = 150;
  return steps;
}

/** Total running time in seconds (for "a 60-second replay"). */
export const timelineSeconds = (steps) => Math.round(steps.reduce((a, s) => a + (s.ms || 0), 0) / 1000);

/** A trip's finished (locked) rounds, in the order they were played — for the replay buttons after the round. */
export function finishedRounds(rounds = []) {
  return rounds.filter((r) => r.status === 'locked')
    .sort((a, b) => String(a.play_date || '').localeCompare(String(b.play_date || '')) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
}
