// ai-helper — "what's on" questions (v2): the current trip and the live round, for the Ask screen and the
// "✨ Ask" chip on the leaderboard. Who's leading? What does Bluey need on the last 3 holes?
//
// The leaderboard maths is NOT repeated here: it's the app's own src/lib/board.js (roundBoard: the same table,
// ranking, countback and projection the Leaderboard screen shows). This file only picks the trip and round, and
// turns a board into small, clean facts for the model — with the sums already done in words, because cheap models
// are bad at arithmetic. (Ambrose side-comp bonus strokes aren't included; the tool says so.)
import * as boardJs from '../../../src/lib/board.js';
import * as scoringJs from '../../../src/lib/scoring.js';
import { clean, FORMAT_NAMES } from './util.ts';

// deno-lint-ignore no-explicit-any
type Any = any;
const { roundBoard }: Any = boardJs;
const { strokesReceived }: Any = scoringJs;

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
export const LIVE_TOOLS = [
  { name: 'whats_on', description: 'The trip that is on now (or next, or the last one): its dates, rounds and their status, and the top of the live (or latest) round\'s leaderboard. Also who is asking.', input_schema: obj({}) },
  { name: 'live_board', description: 'One round\'s full leaderboard as the app shows it: rank, score, holes played, holes left, projected finish and win chance. Leave round blank for the live round (or the latest).', input_schema: obj({ round: { type: 'string', description: 'Part of the round or course name; blank = the live round' } }) },
  { name: 'what_needed', description: 'What a player (or their team) needs over their remaining holes to catch the leader, with the holes left (par, stroke index, shots they get). The sums are done for you in "in_words".', input_schema: obj({ player: { type: 'string', description: 'Their name or nickname' }, round: { type: 'string', description: 'Blank = the live round' } }, ['player']) },
];

const signed = (n: number) => (Math.abs(n) < 0.05 ? 'level' : n > 0 ? `+${round1(n)}` : `${round1(n)}`);
const round1 = (n: number) => Math.round(n * 10) / 10;
const pname = (p: Any) => clean(p ? (p.nickname || p.name) : 'Unknown', 40);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The trip that's on today, else marked active, else the next one, else the most recent. */
export function pickTrip(ix: Any, today: string) {
  const trips: Any[] = ix.h.trips || [];
  const on = trips.find((t) => t.start_date && t.start_date <= today && (t.end_date || t.start_date) >= today)
    || trips.find((t) => t.status === 'active');
  if (on) return { trip: on, when: 'on now' };
  const next = trips.filter((t) => t.start_date && t.start_date > today).sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
  if (next) return { trip: next, when: 'next' };
  const last = [...trips].sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')))[0];
  return last ? { trip: last, when: 'most recent' } : null;
}

/** A round by name (or course name), else the live one, else today's, else the latest played. */
export function pickRound(ix: Any, today: string, q?: unknown) {
  const rounds: Any[] = ix.h.rounds || [];
  const s = String(q ?? '').trim().toLowerCase();
  if (s) {
    const hit = rounds.filter((r) => String(r.name || '').toLowerCase().includes(s) || String(ix.courses[r.course_id]?.name || '').toLowerCase().includes(s));
    if (hit.length) return hit.sort((a, b) => String(b.play_date || '').localeCompare(String(a.play_date || '')))[0];
    return null;
  }
  const latest = (rs: Any[]) => rs.sort((a, b) => String(b.play_date || '').localeCompare(String(a.play_date || '')))[0];
  return latest(rounds.filter((r) => r.status === 'live'))
    || latest(rounds.filter((r) => r.play_date === today))
    || latest(rounds.filter((r) => r.status === 'locked'))
    || null;
}

/** The app's own board for a round, built from the history load. */
export function boardFor(round: Any, ix: Any) {
  const course = ix.courses[round.course_id] || { holes: [] };
  const teams = (ix.teams[round.id] || []).map((t: Any) => ({
    ...t, handicap: Number(t.handicap ?? 0),
    players: (ix.teamPlayers[t.id] || []).map((tp: Any) => ix.players[tp.player_id]).filter(Boolean),
  }));
  const scoresIdx: Any = { [round.id]: {} };
  for (const s of ix.h.scores || []) {
    if (s.round_id !== round.id) continue;
    (scoresIdx[round.id][s.subject_id] ||= {})[s.hole] = s;
  }
  return roundBoard({
    round, course, teams, roundPlayers: ix.rps[round.id] || [], playersById: ix.players, scoresIdx,
    quickResults: (ix.h.quick_results || []).filter((q: Any) => q.round_id === round.id),
  });
}

const higher = (format: string) => format === 'stableford' || format === 'fourball';
/** A row's score as a number (points, or net to par) and in words. */
export function scoreOf(format: string, r: Any): { value: number; label: string } {
  if (higher(format)) return { value: Number(r.points || 0), label: `${r.points || 0} pts` };
  if (format === 'stroke') return { value: Number(r.netToPar || 0), label: `net ${signed(Number(r.netToPar || 0))} (gross ${r.gross || 0})` };
  return { value: Number(r.netToPar || 0), label: r.finished && r.finalNet != null ? `net ${r.finalNet} (${signed(Number(r.netToPar))})` : `net ${signed(Number(r.netToPar || 0))}` };
}
const nameOf = (r: Any) => clean(r?.name, 60);

/** The board as small facts for the model. */
export function boardSummary(round: Any, ix: Any, limit = 30) {
  const b = boardFor(round, ix);
  const holes = b.holes.length;
  const projById: Record<string, Any> = Object.fromEntries((b.projection || []).map((p: Any) => [p.id, p]));
  const rows = b.rows.filter((r: Any) => r.thru > 0 || r.quick).slice(0, limit).map((r: Any) => {
    const p = projById[r.id];
    const sc = scoreOf(b.format, r);
    return {
      rank: r.rankLabel, name: nameOf(r),
      ...(b.format === 'ambrose' || b.format === 'fourball' ? { players: (r.players || []).map(pname) } : {}),
      score: sc.label, thru: r.finished ? 'finished' : r.thru, holes_left: Math.max(0, holes - r.thru),
      ...(p && !r.finished && round.status === 'live' ? { projected_finish: higher(b.format) ? `${Math.round(p.proj?.projected ?? 0)} pts` : `net ${signed(p.proj?.projected ?? 0)}`, win_chance: `${p.proj?.winPct ?? 0}%` } : {}),
    };
  });
  return {
    round: clean(round.name, 60), course: clean(ix.courses[round.course_id]?.name, 60), date: round.play_date || null,
    format: FORMAT_NAMES[round.format] || round.format, status: round.status === 'locked' ? 'finished' : round.status === 'live' ? 'live' : 'not started',
    better: higher(b.format) ? 'more points is better' : 'lower net is better',
    ...(b.format === 'ambrose' ? { note: 'Side-comp bonus strokes are not included here.' } : {}),
    leaderboard: rows,
  };
}

export function whatsOn(ix: Any, today: string, asker: string | null) {
  const picked = pickTrip(ix, today);
  const live = pickRound(ix, today);
  const trip = picked?.trip;
  const rounds = trip ? (ix.h.rounds || []).filter((r: Any) => r.trip_id === trip.id).sort((a: Any, b: Any) => String(a.play_date || '').localeCompare(String(b.play_date || ''))) : [];
  return {
    asked_by: asker ? clean(asker, 40) : null,
    today,
    trip: trip ? { name: clean(trip.name, 60), when: picked!.when, start_date: trip.start_date || null, end_date: trip.end_date || null } : null,
    rounds: rounds.slice(0, 12).map((r: Any) => ({ round: clean(r.name, 60), date: r.play_date || null, course: clean(ix.courses[r.course_id]?.name, 60), format: FORMAT_NAMES[r.format] || r.format, status: r.status === 'locked' ? 'finished' : r.status === 'live' ? 'live' : 'not started' })),
    live_or_latest_round: live ? { ...boardSummary(live, ix, 5) } : null,
  };
}

function findPlayer(ix: Any, q: unknown) {
  const s = String(q ?? '').trim().toLowerCase().replace(/^(me|i|my)$/, '');
  if (!s) return { error: 'Which player?' };
  const ps: Any[] = (ix.h.players || []).filter((p: Any) => p.approved !== false);
  const exact = ps.filter((p) => String(p.name).toLowerCase() === s || String(p.nickname || '').toLowerCase() === s);
  const part = exact.length ? exact : ps.filter((p) => String(p.name).toLowerCase().includes(s) || String(p.nickname || '').toLowerCase().includes(s));
  if (!part.length) return { error: 'No player by that name.' };
  if (part.length > 1) return { error: `That could be ${part.slice(0, 5).map(pname).join(' or ')} — which one?` };
  return { player: part[0] };
}

/** What a player (or their team) needs to catch the leader, with the sums done. */
export function whatNeeded(ix: Any, today: string, input: Any) {
  const found = findPlayer(ix, input?.player);
  if ('error' in found) return { error: found.error };
  const p = found.player;
  const round = pickRound(ix, today, input?.round);
  if (!round) return { error: 'No round found.' };
  const b = boardFor(round, ix);
  const row = b.rows.find((r: Any) => r.id === p.id || (r.players || []).some((x: Any) => x?.id === p.id));
  if (!row) return { error: `${pname(p)} isn’t in ${clean(round.name, 60)}.` };
  const hb = higher(b.format);
  const unit = hb ? 'pts' : 'shots';
  const holesLeft = b.holes.filter((h: Any) => row.perHole?.[h.n] == null && !row.quick);
  const others = b.rows.filter((r: Any) => r.id !== row.id && (r.thru > 0 || r.quick));
  const mine = scoreOf(b.format, row);
  const who = nameOf(row);
  const base = {
    round: clean(round.name, 60), format: FORMAT_NAMES[b.format] || b.format, player: pname(p), as: who,
    rank: row.rankLabel, score: mine.label, thru: row.finished ? 'finished' : row.thru,
    holes_left: holesLeft.slice(0, 18).map((h: Any) => ({
      hole: h.n, par: h.par, stroke_index: h.si,
      ...(b.format === 'stableford' || b.format === 'stroke' || b.format === 'ambrose' ? { shots_received: strokesReceived(Number(row.handicap ?? 0), h.si) } : {}),
    })),
  };
  if (!others.length) return { ...base, in_words: `${who} is the only one with a score so far.` };
  if (row.finished || !holesLeft.length) return { ...base, in_words: `${who} has finished on ${mine.label}, ranked ${row.rankLabel}.` };
  const proj = Object.fromEntries((b.projection || []).map((x: Any) => [x.id, x]));
  const n = holesLeft.length;
  if (row.rank === 1) {
    const second = others[0];
    const s2 = scoreOf(b.format, second);
    const margin = hb ? mine.value - s2.value : s2.value - mine.value;
    const state = margin > 0 ? `${round1(margin)} ${unit} ahead of` : 'level with';
    return { ...base, leading: true, in_words: `${who} leads on ${mine.label} with ${plural(n, 'hole')} left, ${state} ${nameOf(second)} (${s2.label}, ${second.finished ? 'finished' : `thru ${second.thru}`}).` };
  }
  const lead = b.rows[0];
  const ls = scoreOf(b.format, lead);
  const gap = hb ? ls.value - mine.value : mine.value - ls.value;
  const leadLeft = lead.quick ? 0 : Math.max(0, b.holes.length - lead.thru);
  const myProj = proj[row.id];
  const need = myProj?.need; // { strokes, holesLeft } to tie the projected leader (the app's own maths)
  const leaderProj = (b.projection || [])[0];
  const leadNow = `${nameOf(lead)} leads on ${ls.label}${lead.finished ? ' (finished)' : ` with ${plural(leadLeft, 'hole')} left`}`;
  let words: string;
  if (hb) {
    const target = ls.value + 2 * leadLeft; // the leader's finish if they score net pars (2 pts a hole) from here
    const want = Math.max(0, target - mine.value);
    words = `${who} has ${mine.label} with ${plural(n, 'hole')} left; ${leadNow}. `
      + (lead.finished ? `To tie, ${who} needs ${want} pts from the last ${n}` : `If ${nameOf(lead)} scores net pars from here they finish on ${target}, so ${who} needs ${want} pts from the last ${n} to tie`)
      + ` (${round1(want / n)} a hole; a net par is 2, a net birdie 3).`;
  } else {
    words = `${who} is ${mine.label} with ${plural(n, 'hole')} left; ${leadNow}. `
      + `${lead.finished ? 'To tie' : `If ${nameOf(lead)} makes net pars from here, to tie`} ${who} needs to play the last ${n} ${round1(gap)} ${gap === 1 ? 'shot' : 'shots'} under net par.`;
  }
  if (need && leaderProj && !lead.finished && round.status === 'live') {
    words += ` On the app’s projection (${nameOf(leaderProj)} to finish about ${hb ? `${Math.round(leaderProj.proj?.projected ?? 0)} pts` : `net ${signed(leaderProj.proj?.projected ?? 0)}`}), ${who} needs about ${need.strokes} ${unit} better than expected over the last ${need.holesLeft} — win chance ${myProj.proj?.winPct ?? 0}%.`;
  }
  return { ...base, leader: { name: nameOf(lead), score: ls.label, holes_left: leadLeft }, gap: `${round1(gap)} ${unit}`, in_words: words };
}

export function liveTool(name: string, input: Any, ix: Any, today: string, asker: string | null): unknown {
  if (name === 'whats_on') return whatsOn(ix, today, asker);
  if (name === 'live_board') {
    const r = pickRound(ix, today, input?.round);
    return r ? boardSummary(r, ix) : { error: 'No round by that name. Use whats_on to see the rounds.' };
  }
  if (name === 'what_needed') return whatNeeded(ix, today, input);
  throw new Error('No such tool');
}
