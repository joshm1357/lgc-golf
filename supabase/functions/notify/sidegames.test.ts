// Run: deno test --no-check supabase/functions/notify/sidegames.test.ts
import nodeAssert from 'node:assert/strict';
import { money, dayName, gameProposedMessage, proposeProblem, proposedBits } from './sidegames.ts';
const assertEquals = (a: unknown, b: unknown) => nodeAssert.deepStrictEqual(a, b);

Deno.test('side games: the buzz says who put up what, for which day', () => {
  const m = gameProposedMessage({ who: { name: 'Bo Red', nickname: 'Bo' }, game: { kind: 'skins', stake: 5 }, round: { name: 'Sat round', play_date: '2099-01-03' } });
  assertEquals(m.title, '🎲 Bo’s put up $5 skins for Saturday');
  nodeAssert.match(m.body, /You in\?/);
  const c = gameProposedMessage({ who: { name: 'Al Blue' }, game: { kind: 'nassau', stake: 2.5 }, round: { name: 'Sunday at Kiama' }, customName: 'Kiama Nassau' });
  assertEquals(c.title, '🎲 Al’s put up $2.50 Kiama Nassau for Sunday at Kiama');
  assertEquals(money(10), '$10');
  assertEquals(dayName(null), '');
});

Deno.test('side games: only the proposer (or an organiser) can send it, and only for an opt-in game that is up', () => {
  const g = { who_in: 'opt_in', retired: false, created_by: 'bo' };
  assertEquals(proposeProblem(g, 'bo', false), null);
  assertEquals(proposeProblem(g, 'al', false), 'Not your side game');
  assertEquals(proposeProblem(g, 'al', true), null);
  assertEquals(proposeProblem(g, null, false), 'Not your side game');
  assertEquals(proposeProblem({ ...g, who_in: 'everyone' }, 'bo', false), 'Only an opt-in game is put out to the group');
  assertEquals(proposeProblem({ ...g, retired: true }, 'bo', true), 'That side game has been taken down');
  assertEquals(proposeProblem(null, 'bo', true), 'Not in your group');
});

// A tiny stand-in for the database client: every query must ask for this group's rows.
function fakeDb(rows: Record<string, any[]>) {
  return {
    from(table: string) {
      const f: Record<string, unknown> = {};
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => { f[k] = v; return q; },
        maybeSingle: async () => ({ data: (rows[table] || []).find((r) => Object.entries(f).every(([k, v]) => r[k] === v)) || null }),
      };
      return q;
    },
  };
}

Deno.test('side games: a game from another group is never found', async () => {
  const db = fakeDb({
    round_games: [{ id: 'g1', group_id: 'A', round_id: 'r1', kind: 'skins', stake: 5, who_in: 'opt_in', created_by: 'bo', retired: false }],
    rounds: [{ id: 'r1', group_id: 'A', name: 'Sat', play_date: '2099-01-03', status: 'setup' }],
    players: [{ id: 'bo', group_id: 'A', name: 'Bo Red' }],
  });
  const bits = await proposedBits(db, 'A', 'g1');
  assertEquals(bits?.round.id, 'r1');
  assertEquals(gameProposedMessage(bits!).title, '🎲 Bo’s put up $5 skins for Saturday');
  assertEquals(await proposedBits(db, 'B', 'g1'), null);
  assertEquals(await proposedBits(db, 'A', ''), null);
});
