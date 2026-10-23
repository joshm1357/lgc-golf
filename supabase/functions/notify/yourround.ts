// ov28 (23 Oct 2026) — "your round" buzzes for the notify function: the draw is out (I8), the night before (I11) and
// swing alerts (I13). The words and rules are in ../_shared/yourround.js and ../_shared/swing.js (shared with the app
// and its tests); this file only loads the rows for ONE group and works out who gets what.
// deno-lint-ignore-file no-explicit-any
import * as YR from '../_shared/yourround.js';
import * as SW from '../_shared/swing.js';

// Plain JavaScript with default arguments: TypeScript would guess their types from the defaults, so take them as any.
const { yourRound, drawOutMessage, teeTomorrowMessage } = YR as any;
const { cupSwing, passedOnPoints, passedText, swingGapMinutes } = SW as any;

type Db = any;
const first = (p?: { name?: string; nickname?: string } | null) => String(p?.nickname || p?.name || 'Someone').trim().split(/\s+/)[0];

/** Everything about one round of group `g` that "your round" needs, or null if it isn't this group's. */
export async function roundBits(db: Db, g: string, roundId: string) {
  const { data: round } = await db.from('rounds').select('id,name,format,play_date,status,trip_id,course_id').eq('id', roundId).eq('group_id', g).maybeSingle();
  if (!round) return null;
  const [{ data: teams }, { data: matches }, { data: sides }, { data: tees }, { data: people }, { data: course }] = await Promise.all([
    db.from('teams').select('id,name').eq('round_id', round.id),
    db.from('cup_matches').select('*').eq('round_id', round.id).eq('group_id', g),
    db.from('cup_sides').select('id,name,colour,sort').eq('group_id', g).order('sort'),
    db.from('tee_groups').select('group_no,tee_time,start_hole,player_ids').eq('round_id', round.id).eq('group_id', g),
    db.from('players').select('id,name,nickname,approved').eq('group_id', g),
    round.course_id ? db.from('courses').select('id,name,holes').eq('id', round.course_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const teamIds = (teams || []).map((t: any) => t.id);
  const { data: tp } = teamIds.length ? await db.from('team_players').select('team_id,player_id').in('team_id', teamIds) : { data: [] };
  const withPlayers = (teams || []).map((t: any) => ({ ...t, players: (tp || []).filter((x: any) => x.team_id === t.id).map((x: any) => x.player_id) }));
  const byId = new Map((people || []).map((p: any) => [p.id, p]));
  const nameOf = (id: string) => first(byId.get(id) as any);
  // Everyone the round puts somewhere: a team, a Cup match or a tee group.
  const ids = new Set<string>();
  for (const t of withPlayers) for (const p of t.players) ids.add(p);
  for (const m of matches || []) for (const p of [...(m.a_players || []), ...(m.b_players || [])]) ids.add(p);
  for (const r of tees || []) for (const p of r.player_ids || []) ids.add(p);
  const each = (pid: string) => yourRound({ round, me: pid, teams: withPlayers, matches: matches || [], sides: sides || [], teeRows: tees || [] });
  return { round, course, teams: withPlayers, matches: matches || [], sides: sides || [], tees: tees || [], byId, nameOf, ids: [...ids], each };
}

/** I8 — "the draw is out": each player in the round gets their own line. Returns [{ pid, msg }]. */
export function drawOutFor(bits: NonNullable<Awaited<ReturnType<typeof roundBits>>>) {
  const out: { pid: string; msg: { title: string; body: string } }[] = [];
  for (const pid of bits.ids) {
    const msg = drawOutMessage({ roundName: bits.round.name, round: bits.round, y: bits.each(pid), nameOf: bits.nameOf });
    if (msg) out.push({ pid, msg });
  }
  return out;
}

/** I11 — the night before: only people with a tee time or a playing group. car(pid) → their car, if the trip has one. */
export function teeTomorrowFor(bits: NonNullable<Awaited<ReturnType<typeof roundBits>>>, car: (pid: string) => any = () => null) {
  const out: { pid: string; msg: { title: string; body: string } }[] = [];
  for (const pid of bits.ids) {
    const msg = teeTomorrowMessage({ roundName: bits.round.name, courseName: bits.course?.name || '', y: bits.each(pid), nameOf: bits.nameOf, car: car(pid) });
    if (msg) out.push({ pid, msg });
  }
  return out;
}

/** The group's commentary buzz level → minutes between swing buzzes for one person (null = Feed only, no buzzes). */
export async function swingGap(db: Db, g: string) {
  const { data } = await db.from('commentary_settings').select('buzz').eq('group_id', g).maybeSingle();
  return swingGapMinutes(data?.buzz || 'sometimes');
}

/**
 * I13 — a Cup match's swing: { text, to: [player ids] } or null. To everyone in the group except the four in the
 * match (they know). Lead changes hands or goes back to level only (_shared/swing.js).
 */
export async function matchSwing(db: Db, g: string, matchId: string, hole: number) {
  const { data: m } = await db.from('cup_matches').select('*').eq('id', matchId).eq('group_id', g).maybeSingle();
  if (!m) return null;
  const { data: sides } = await db.from('cup_sides').select('name,sort').eq('group_id', g).order('sort');
  const names = { a: sides?.[0]?.name || 'Team 1', b: sides?.[1]?.name || 'Team 2' };
  const s = cupSwing({ holes: m.holes || {}, hole, names });
  if (!s) return null;
  const { data: people } = await db.from('players').select('id,approved').eq('group_id', g);
  const inMatch = new Set([...(m.a_players || []), ...(m.b_players || [])]);
  return { key: `${m.id}:${s.key}`, text: s.text, round_id: m.round_id, to: (people || []).filter((p: any) => p.approved !== false && !inMatch.has(p.id)).map((p: any) => p.id) };
}

/** I13 — passing someone on points (Stableford): { text, mover } or null. Only the mover hears about it. */
export async function pointsSwing(db: Db, g: string, roundId: string, mover: string, hole: number) {
  const { data: round } = await db.from('rounds').select('id,format,course_id,status').eq('id', roundId).eq('group_id', g).maybeSingle();
  if (!round || round.format !== 'stableford' || round.status !== 'live') return null;
  const [{ data: course }, { data: rps }, { data: scores }, { data: people }] = await Promise.all([
    db.from('courses').select('holes').eq('id', round.course_id).maybeSingle(),
    db.from('round_players').select('player_id,playing_handicap').eq('round_id', round.id),
    db.from('scores').select('subject_id,hole,strokes,picked_up').eq('round_id', round.id).eq('subject_type', 'player'),
    db.from('players').select('id,name,nickname').eq('group_id', g),
  ]);
  const hcps = Object.fromEntries((rps || []).map((r: any) => [r.player_id, r.playing_handicap]));
  const res = passedOnPoints({ holes: course?.holes || [], scores: (scores || []).map((s: any) => ({ player_id: s.subject_id, hole: s.hole, strokes: s.strokes, picked_up: s.picked_up })), hcps, mover, hole });
  if (!res.passed.length) return null;
  const byId = new Map((people || []).map((p: any) => [p.id, p]));
  return { mover, text: passedText(res.passed.map((id: string) => first(byId.get(id) as any)), res.points, res.thru) };
}
