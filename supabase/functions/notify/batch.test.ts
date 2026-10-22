// Run: deno test --no-check supabase/functions/notify/batch.test.ts
import nodeAssert from 'node:assert/strict';
import { batchNonVoters, reminderGroups, batchMessage } from './batch.ts';
const assertEquals = (a: unknown, b: unknown) => nodeAssert.deepStrictEqual(a, b);

Deno.test('batch: the reminder skips people who answered every section and said if they’re keen', () => {
  const votes = [
    { poll_id: 'p1', player_id: 'a' }, { poll_id: 'p2', player_id: 'a' },
    { poll_id: 'p1', player_id: 'b' },
    { poll_id: 'p1', player_id: 'c' }, { poll_id: 'p2', player_id: 'c' },
  ];
  const base = { pollIds: ['p1', 'p2'], votes, rsvps: [{ player_id: 'a' }], playerIds: ['a', 'b', 'c', 'd'] };
  assertEquals(batchNonVoters({ ...base, keen: true }), ['b', 'c', 'd']);
  assertEquals(batchNonVoters({ ...base, keen: false }), ['b', 'd']);
});

Deno.test('batch: polls closing tomorrow → one reminder per card', () => {
  const g = reminderGroups([{ id: 'p1', vote_batch: 'B' }, { id: 'p2', vote_batch: 'B' }, { id: 'p3', vote_batch: null }, { id: 'p4', vote_batch: 'C' }]);
  assertEquals(g.map((x) => [x.batch, x.polls.map((p) => p.id)]), [[null, ['p3']], ['B', ['p1', 'p2']], ['C', ['p4']]]);
});

Deno.test('batch: one notification for the whole card', () => {
  assertEquals(batchMessage({ title: 'Where and when?', planName: 'Spring trip', sections: 2, keen: true, closes: 'Fri 14 Nov' }),
    { title: '🗳️ Vote: Where and when?', body: 'Spring trip · 3 quick questions · closes Fri 14 Nov' });
});
