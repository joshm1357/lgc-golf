import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  TEMPLATES, TONES, BUZZ_LEVELS, KINDS, keyHash, fill, templateLine, reportTemplate, trimLine, isCommentaryPost,
  scoreEvents, leadMoments, holeMoments, cupMoments, collapseOfTheDay, reportMoment, commentaryMoments, FRESH_MINUTES,
} from './commentary.js';

const TODAY = '2026-10-21';
const NOW = Date.parse('2026-10-21T03:00:00Z');
const course = { id: 'c1', holes: Array.from({ length: 9 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 })) };
const players = { mike: { id: 'mike', name: 'Mike', handicap: 0 }, al: { id: 'al', name: 'Al', handicap: 0 }, bo: { id: 'bo', name: 'Bo', handicap: 0 }, kurt: { id: 'kurt', name: 'Kurt', handicap: 0 } };

/** Cards played hole by hole together: minute m for hole m (+ a second per player so the order is fixed). */
function cards(byPlayer, start = NOW - 30 * 60000) {
  const idx = {};
  Object.entries(byPlayer).forEach(([id, strokes], pi) => {
    idx[id] = {};
    strokes.forEach((s, i) => {
      if (s == null) return;
      idx[id][i + 1] = { strokes: s === 'P' ? null : s, picked_up: s === 'P', updated_at: new Date(start + (i + 1) * 60000 + pi * 1000).toISOString() };
    });
  });
  return idx;
}

function ctx(format, byPlayer, over = {}) {
  const round = { id: 'r1', trip_id: 't1', course_id: 'c1', name: 'Day 1', format, status: 'live', play_date: TODAY, ...over.round };
  const ids = Object.keys(byPlayer);
  return {
    now: NOW, today: TODAY, rounds: [round], coursesById: { c1: course }, playersById: players,
    teamsByRound: over.teamsByRound || {},
    roundPlayers: { r1: (over.rpIds || ids).map((id) => ({ round_id: 'r1', player_id: id, playing_handicap: 0 })) },
    scoresIdx: { r1: cards(byPlayer, over.start) }, cupMatches: over.cupMatches || [], roundAwards: over.roundAwards || [],
    features: { cup: true }, round,
  };
}

describe('templates', () => {
  it('every moment kind has lines in every tone', () => {
    for (const k of KINDS.filter((x) => x !== 'report')) for (const t of TONES) expect(TEMPLATES[k][t.key].length).toBeGreaterThan(0);
    for (const k of ['report_win', 'report_best', 'report_collapse', 'report_end']) for (const t of TONES) expect(TEMPLATES[k][t.key].length).toBe(1);
  });
  it('the server has the exact same templates', () => {
    const js = fs.readFileSync(new URL('./commentary.js', import.meta.url), 'utf8');
    const ts = fs.readFileSync(new URL('../../supabase/functions/ai-helper/commentary.ts', import.meta.url), 'utf8');
    const block = (s) => s.split('// TEMPLATES-START')[1].split('// TEMPLATES-END')[0].replace('export const TEMPLATES: Record<string, Record<string, string[]>> =', 'export const TEMPLATES =');
    expect(block(ts)).toBe(block(js));
  });
  it('no real commentator is named or imitated, and lines stay short', () => {
    const all = JSON.stringify(TEMPLATES);
    expect(all).not.toMatch(/benaud|alliss|maskell|nantz|feherty|norman|faldo/i);
    const vals = { who: 'Christopher', hole: 18, streak: 4, behind: 6, score: '42 pts thru 17', prev: 'Bartholomew', side: 'Team Gold', other: 'Team Blue', lead: 3, remaining: 3, won: '5½–3½' };
    for (const k of KINDS.filter((x) => x !== 'report')) for (const t of TONES) for (const line of TEMPLATES[k][t.key]) expect(fill(line, vals).length).toBeLessThanOrEqual(140);
  });
  it('fills, picks the same line for the same key, and trims', () => {
    expect(fill('{who} on {hole}{nope}', { who: 'Mike', hole: 7 })).toBe('Mike on 7');
    expect(keyHash('lead:a')).toBe(keyHash('lead:a'));
    expect(templateLine('ace', { who: 'Mike', hole: 7 }, 'straight', 'k')).toMatch(/Mike/);
    expect(templateLine('ace', { who: 'Mike', hole: 7 }, 'nonsense', 'k')).toBe(templateLine('ace', { who: 'Mike', hole: 7 }, 'cheeky', 'k'));
    expect(templateLine('nope', {}, 'cheeky')).toBe('');
    const long = trimLine('word '.repeat(60), 140);
    expect(long.length).toBeLessThanOrEqual(140);
    expect(long.endsWith('…')).toBe(true);
  });
  it('report: winner, best, collapse, sign-off', () => {
    const r = reportTemplate({ who: 'Mike', round: 'Day 1', score: '38 pts', best: 'Al’s ace on 4', collapse_who: 'Bo', collapse_holes: '5–7' }, 'straight');
    expect(r).toBe('Mike won Day 1 with 38 pts. The shot of the day: Al’s ace on 4. Bo had a tough run on 5–7. Well played, everyone.');
    expect(templateLine('report', { who: 'Mike', round: 'Day 1', score: '38 pts' }, 'tv')).toBe('Day 1 belongs to Mike, with 38 pts. What a day of golf.');
  });
  it('tones and buzz levels', () => {
    expect(TONES.map((t) => t.key)).toEqual(['straight', 'cheeky', 'tv']);
    expect(BUZZ_LEVELS.find((b) => b.key === 'sometimes').minutes).toBe(30);
    expect(isCommentaryPost({ kind: 'auto', body: '🎙️ Mike leads' })).toBe(true);
    expect(isCommentaryPost({ kind: 'user', body: '🎙️ Mike leads' })).toBe(false);
  });
});

describe('lead changes', () => {
  it('replays scores in save order', () => {
    const c = ctx('stableford', { mike: [4, 4], al: [3] });
    expect(scoreEvents(c.scoresIdx, 'r1').map((e) => `${e.subject}${e.hole}`)).toEqual(['mike1', 'al1', 'mike2']);
  });
  it('stableford: a new leader alone on top after 3 holes', () => {
    // Mike leads early; Al birdies 4 and 5 to go clear.
    const c = ctx('stableford', { mike: [4, 4, 4, 4, 4], al: [4, 4, 4, 3, 3] });
    const m = leadMoments(c, c.round);
    expect(m.map((x) => x.key)).toEqual(['lead:r1:al:4']);
    expect(m[0].facts).toMatchObject({ format: 'stableford', subject: 'al', hole: 4, prev: 'mike', points: 9, thru: 4 });
  });
  it('a charge when the new leader was 3+ back', () => {
    const c = ctx('stableford', { mike: [3, 4, 4, 4, 4, 4, 5, 6, 6], al: [5, 5, 5, 3, 3, 3, 3, 3, 3] });
    const m = leadMoments(c, c.round);
    const ch = m.find((x) => x.kind === 'charge');
    expect(ch.key).toMatch(/^charge:r1:al:\d$/);
    expect(ch.facts.behind).toBeGreaterThanOrEqual(3);
  });
  it('stroke play uses net to par', () => {
    const c = ctx('stroke', { mike: [4, 4, 4, 4, 5], al: [4, 4, 4, 4, 3] });
    const m = leadMoments(c, c.round);
    expect(m.map((x) => x.key)).toEqual(['lead:r1:al:5']);
    expect(m[0].facts.net_to_par).toBe(0); // Mike's bogey on 5 put Al (level, thru 4) alone on top
  });
  it('Ambrose: teams', () => {
    const teams = [{ id: 'ta', name: 'Aces', handicap: 0, players: [players.mike] }, { id: 'tb', name: 'Bogeys', handicap: 0, players: [players.al] }];
    const c = ctx('ambrose', { ta: [4, 4, 4, 4, 5], tb: [4, 4, 4, 4, 3] }, { teamsByRound: { r1: teams }, rpIds: [] });
    expect(leadMoments(c, c.round).map((x) => x.key)).toEqual(['lead:r1:tb:5']);
  });
  it('4BBB: pairs lead, players birdie', () => {
    const teams = [{ id: 'p1', name: 'Pair 1', players: [players.mike, players.al] }, { id: 'p2', name: 'Pair 2', players: [players.bo, players.kurt] }];
    const c = ctx('fourball', { mike: [4, 4, 4, 4, 4], al: [5, 5, 5, 5, 5], bo: [4, 4, 4, 3, 3], kurt: [5, 5, 5, 5, 5] }, { teamsByRound: { r1: teams } });
    expect(leadMoments(c, c.round).map((x) => x.key)).toEqual(['lead:r1:p2:4']);
    expect(holeMoments(c, c.round).map((x) => x.key)).toEqual(['birdies:r1:bo:5']);
  });
  it('nobody new on top, nothing said', () => {
    const c = ctx('stableford', { mike: [3, 3, 3, 3], al: [4, 4, 4, 4] });
    expect(leadMoments(c, c.round)).toEqual([]);
  });
});

describe('hole moments', () => {
  it('birdie streaks, eagles, aces', () => {
    const c = ctx('stroke', { mike: [3, 3, 3, 2, 1, 4] });
    const keys = holeMoments(c, c.round).map((x) => x.key);
    expect(keys).toEqual(expect.arrayContaining(['birdies:r1:mike:2', 'birdies:r1:mike:3', 'birdies:r1:mike:4', 'eagle:r1:mike:4', 'ace:r1:mike:5']));
    expect(keys).not.toContain('birdies:r1:mike:1');
    expect(keys).not.toContain('eagle:r1:mike:5'); // an ace isn't also an eagle
    const s = holeMoments(c, c.round).find((x) => x.key === 'birdies:r1:mike:4');
    expect(s.facts.streak).toBe(4);
  });
  it('a streak wraps from the last hole to the first (shotgun / back-nine starts)', () => {
    const c = ctx('stroke', { mike: [3, 4, 4, 4, 4, 4, 4, 4, 3] });
    expect(holeMoments(c, c.round).map((x) => x.key)).toContain('birdies:r1:mike:1');
  });
  it('three wipes in a row, once — Stableford and 4BBB only', () => {
    const c = ctx('stableford', { mike: [7, 'P', 8, 7, 4] });
    expect(holeMoments(c, c.round).filter((x) => x.kind === 'wipe').map((x) => x.key)).toEqual(['wipe:r1:mike:3']);
    const s = ctx('stroke', { mike: [7, 'P', 8, 7, 4] });
    expect(holeMoments(s, s.round).filter((x) => x.kind === 'wipe')).toEqual([]);
  });
});

describe('the Cup', () => {
  const holes = (res) => Object.fromEntries(res.map((r, i) => [String(i + 1), r]));
  it('dormie, and a side going ahead overall', () => {
    const m1 = { id: 'm1', round_id: 'r1', points: 1, holes: holes(Array(15).fill('a')), updated_at: new Date(NOW - 60000).toISOString() }; // won 15&3? decided
    const m2 = { id: 'm2', round_id: 'r1', points: 1, holes: holes([...Array(3).fill('a'), ...Array(12).fill('h')]), updated_at: new Date(NOW).toISOString() }; // 3 up with 3 to play
    const c = ctx('stableford', { mike: [4] }, { cupMatches: [m1, m2] });
    const keys = cupMoments(c, c.round).map((x) => x.key);
    expect(keys).toEqual(['dormie:r1:m2', 'cuplead:r1:a']);
    expect(cupMoments(c, c.round)[1].facts).toEqual({ side: 'a', won_a: 1, won_b: 0 });
  });
  it('no lead moment when that side already led from an earlier day', () => {
    const r0 = { id: 'r0', trip_id: 't1', course_id: 'c1', format: 'stableford', status: 'locked', play_date: '2026-10-20' };
    const old = { id: 'm0', round_id: 'r0', points: 1, holes: holes(Array(10).fill('a')) };
    const today = { id: 'm1', round_id: 'r1', points: 1, holes: holes(Array(10).fill('a')), updated_at: new Date(NOW).toISOString() };
    const c = ctx('stableford', { mike: [4] }, { cupMatches: [old, today] });
    c.rounds = [r0, c.round];
    expect(cupMoments(c, c.round).map((x) => x.kind)).toEqual([]);
  });
});

describe('round report', () => {
  it('needs the round award; names winner, best moment and collapse', () => {
    const c = ctx('stroke', { mike: [3, 3, 4, 4, 4, 4, 4, 4, 4], al: [4, 4, 4, 7, 7, 6, 4, 4, 4] });
    expect(reportMoment(c, c.round, null)).toBe(null);
    const r = reportMoment(c, c.round, { key: 'round:r1', created_at: new Date(NOW).toISOString() });
    expect(r.key).toBe('report:r1');
    expect(r.facts.winners).toEqual(['mike']);
    expect(r.facts.best).toMatchObject({ kind: 'birdies', subject: 'mike', hole: 2, streak: 2 });
    expect(r.facts.collapse).toEqual({ subject: 'al', from_hole: 4, to_hole: 6, over: 8 });
    expect(collapseOfTheDay(ctx('stroke', { mike: [5, 5, 5] }), c.round)).toBe(null);
  });
});

describe('everything right now', () => {
  it('only fresh rounds, only the last few minutes, stable keys, no duplicates', () => {
    const c = ctx('stableford', { mike: [4, 4, 4, 4, 4], al: [4, 4, 4, 3, 3] }, { roundAwards: [], start: NOW - 10 * 60000 });
    const a = commentaryMoments(c).map((m) => m.key);
    const b = commentaryMoments({ ...c }).map((m) => m.key);
    expect(a).toEqual(b);
    expect(a).toContain('lead:r1:al:4');
    expect(new Set(a).size).toBe(a.length);
    // An hour later: nothing new.
    expect(commentaryMoments({ ...c, now: NOW + 60 * 60000 })).toEqual([]);
    expect(FRESH_MINUTES).toBe(20);
    // A round from last week: nothing.
    const stale = ctx('stableford', { mike: [4, 4, 4, 4, 4], al: [4, 4, 4, 3, 3] }, { round: { status: 'locked', play_date: '2026-10-10' } });
    expect(commentaryMoments(stale)).toEqual([]);
  });
  it('the report comes with the round award, and facts never hold names', () => {
    const c = ctx('stableford', { mike: [4, 4, 4, 4, 4, 4, 4, 4, 4], al: [4, 4, 4, 3, 3, 4, 4, 4, 4] }, { roundAwards: [{ key: 'round:r1', created_at: new Date(NOW).toISOString() }] });
    const all = commentaryMoments(c);
    expect(all.map((m) => m.key)).toContain('report:r1');
    for (const m of all) expect(JSON.stringify(m.facts)).not.toMatch(/Mike|Al\b/);
    for (const m of all) expect(m.key.startsWith(`${m.kind}:r1:`) || m.key === 'report:r1').toBe(true);
  });
});
