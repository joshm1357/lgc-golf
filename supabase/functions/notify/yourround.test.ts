// Run: deno test --no-check supabase/functions/notify/yourround.test.ts
// ov28: the draw is out, the night before and swing alerts — against a tiny stand-in database (one group's rows).
import nodeAssert from 'node:assert/strict';
import { roundBits, drawOutFor, teeTomorrowFor, matchSwing, pointsSwing, swingGap } from './yourround.ts';
const assertEquals = (a: unknown, b: unknown) => nodeAssert.deepStrictEqual(a, b);

const G = 'g1';
// deno-lint-ignore no-explicit-any
function fakeDb(tables: Record<string, any[]>) {
  // deno-lint-ignore no-explicit-any
  const q = (rows: any[]) => {
    let list = [...rows];
    // deno-lint-ignore no-explicit-any
    const api: any = {
      select: () => api,
      eq: (k: string, v: unknown) => { list = list.filter((r) => r[k] === v); return api; },
      neq: (k: string, v: unknown) => { list = list.filter((r) => r[k] !== v); return api; },
      in: (k: string, vs: unknown[]) => { list = list.filter((r) => vs.includes(r[k])); return api; },
      order: () => api,
      limit: () => api,
      maybeSingle: () => Promise.resolve({ data: list[0] || null }),
      then: (ok: (x: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve({ data: list }).then(ok, bad),
    };
    return api;
  };
  return { from: (t: string) => q(tables[t] || []) };
}

const players = ['me', 'bo', 'kurt', 'al', 'cy', 'di', 'outsider'].map((id) => ({ id, group_id: G, name: id[0].toUpperCase() + id.slice(1), approved: true }));
const base = {
  players,
  rounds: [{ id: 'r1', group_id: G, name: 'Saturday', format: 'stableford', play_date: '2026-10-24', status: 'setup', trip_id: 't1', course_id: 'c1' }],
  courses: [{ id: 'c1', name: 'Cypress Lakes', holes: [{ n: 1, par: 4, si: 1 }, { n: 2, par: 4, si: 2 }] }],
  cup_sides: [{ id: 'blue', group_id: G, name: 'Team Blue', sort: 1 }, { id: 'red', group_id: G, name: 'Team Red', sort: 2 }],
  cup_matches: [{ id: 'm1', group_id: G, round_id: 'r1', a_players: ['kurt', 'al'], b_players: ['me', 'bo'], tee_time: '07:00', holes: {} }],
  tee_groups: [{ group_id: G, round_id: 'r1', group_no: 2, tee_time: '07:52', start_hole: null, player_ids: ['cy', 'di'] }],
  teams: [], team_players: [],
};

Deno.test('the draw is out: everyone in the round gets their own line; nobody else', async () => {
  const bits = await roundBits(fakeDb(base), G, 'r1');
  const out = drawOutFor(bits!);
  const by = Object.fromEntries(out.map((o) => [o.pid, o.msg.body]));
  assertEquals(by.me, 'You & Bo v Kurt & Al, Sat 7:00am');
  assertEquals(by.kurt, 'You & Al v Me & Bo, Sat 7:00am');
  assertEquals(by.cy, 'You’re off Sat 7:52am with Di');
  assertEquals(by.outsider, undefined);
  assertEquals(out[0].msg.title, '📣 The draw is out — Saturday');
});

Deno.test('another group\'s round: nothing', async () => {
  assertEquals(await roundBits(fakeDb(base), 'other', 'r1'), null);
});

Deno.test('the night before: tee time, mates, and the lift', async () => {
  const bits = await roundBits(fakeDb(base), G, 'r1');
  const out = teeTomorrowFor(bits!, (pid) => (pid === 'cy' ? { driver: { name: 'Josh' }, pickup_time: '6:30am' } : null));
  const by = Object.fromEntries(out.map((o) => [o.pid, o.msg]));
  assertEquals(by.cy, { title: '⛳ Your tee time tomorrow: 7:52', body: 'Hole 1 with Di · Josh picks you up 6:30am' });
  assertEquals(by.me, { title: '⛳ Your tee time tomorrow: 7:00', body: 'You & Bo v Kurt & Al' });
});

Deno.test('a round with nothing set: no night-before buzz at all', async () => {
  const bits = await roundBits(fakeDb({ ...base, cup_matches: [], tee_groups: [] }), G, 'r1');
  assertEquals(teeTomorrowFor(bits!), []);
});

Deno.test('swing: a Cup match changing hands goes to everyone not in it', async () => {
  const holes = Object.fromEntries(['a', 'h', 'h', 'h', 'h', 'h', 'h', 'h', 'h', 'b', 'b'].map((r, i) => [String(i + 1), r]));
  const db = fakeDb({ ...base, cup_matches: [{ ...base.cup_matches[0], holes }] });
  const s = await matchSwing(db, G, 'm1', 11);
  assertEquals(s!.text, 'Team Red win the 11th — Team Red now 1 UP');
  assertEquals(s!.to.sort(), ['cy', 'di', 'outsider']);
  assertEquals(await matchSwing(db, G, 'm1', 3), null);
  assertEquals(await swingGap(fakeDb({ commentary_settings: [{ group_id: G, buzz: 'feed' }] }), G), null);
  assertEquals(await swingGap(fakeDb({}), G), 30);
});

Deno.test('swing: passing someone on points tells only the mover', async () => {
  const db = fakeDb({
    ...base,
    rounds: [{ ...base.rounds[0], status: 'live' }],
    round_players: [{ round_id: 'r1', player_id: 'me', playing_handicap: 0 }, { round_id: 'r1', player_id: 'bo', playing_handicap: 0 }],
    scores: [
      { round_id: 'r1', subject_type: 'player', subject_id: 'me', hole: 1, strokes: 4 },
      { round_id: 'r1', subject_type: 'player', subject_id: 'me', hole: 2, strokes: 3 },
      { round_id: 'r1', subject_type: 'player', subject_id: 'bo', hole: 1, strokes: 3 },
    ],
  });
  assertEquals(await pointsSwing(db, G, 'r1', 'me', 2), { mover: 'me', text: 'You’ve just passed Bo — 5 pts thru 2' });
  assertEquals(await pointsSwing(db, G, 'r1', 'bo', 1), null);
});
