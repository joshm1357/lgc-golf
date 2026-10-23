// Run: deno test --no-check supabase/functions/notify/callout.test.ts
// ov34: who gets a call-out buzz straight away.
import nodeAssert from 'node:assert/strict';
import { calloutSends, absUrl, CALLOUT_KINDS } from './callout.ts';
const assertEquals = (a: unknown, b: unknown) => nodeAssert.deepStrictEqual(a, b);

const APP = 'https://app.thegolftrip.club/';
const NOW = Date.parse('2026-10-29T08:00:00Z');
const at = (minsAgo: number) => new Date(NOW - minsAgo * 60000).toISOString();
const row = (id: string, user_id: string, kind: string, title: string, minsAgo = 5, url = '#/plan/p1', group_id = 'g1') =>
  ({ id, group_id, user_id, kind, title, body: null, url, created_at: at(minsAgo) });

Deno.test('a link from the database gets the app address', () => {
  assertEquals(absUrl('#/plan/p1', APP), 'https://app.thegolftrip.club/#/plan/p1');
  assertEquals(absUrl(null, APP), APP);
  assertEquals(absUrl('https://x.test/y', APP), 'https://x.test/y');
});

Deno.test('"You’re in" goes straight away and opens the round', () => {
  const { send, done } = calloutSends([row('q1', 'u1', 'callout_in', '✅ You’re in — Fri 30 Oct 1:20pm, Moore Park')], [], APP, NOW);
  assertEquals(send.length, 1);
  assertEquals(send[0].msg.title, '✅ You’re in — Fri 30 Oct 1:20pm, Moore Park');
  assertEquals(send[0].msg.url, 'https://app.thegolftrip.club/#/plan/p1');
  assertEquals(done, ['q1']);
});

Deno.test('digest people wait; "only important" people get where they stand but not the put-out', () => {
  const rows = [row('q1', 'dig', 'callout_new', 'N'), row('q2', 'imp', 'callout_new', 'N'), row('q3', 'imp', 'callout_reserve', '⏳ You’re reserve #1')];
  const prefs = [{ group_id: 'g1', user_id: 'dig', mode: 'digest' }, { group_id: 'g1', user_id: 'imp', mode: 'important' }];
  const { send, done } = calloutSends(rows, prefs, APP, NOW);
  assertEquals(send.map((s) => [s.user_id, s.msg.title]), [['imp', '⏳ You’re reserve #1']]);
  assertEquals(done, ['q3']);
});

Deno.test('several for one person about one round become one', () => {
  const rows = [row('q1', 'u1', 'callout_reserve', '⏳ You’re reserve #1', 20), row('q2', 'u1', 'callout_promoted', '🎉 A spot opened — you’re in', 2)];
  const { send } = calloutSends(rows, [], APP, NOW);
  assertEquals(send.length, 1);
  assertEquals(send[0].msg.title, '⛳ 2 updates: 🎉 A spot opened — you’re in');
  assertEquals(send[0].msg.body, '⏳ You’re reserve #1');
  assertEquals(send[0].ids, ['q1', 'q2']);
});

Deno.test('two rounds stay two buzzes; stale ones are just marked sent; other kinds are left alone', () => {
  const rows = [row('q1', 'u1', 'callout_in', 'A', 5, '#/plan/p1'), row('q2', 'u1', 'callout_in', 'B', 5, '#/plan/p2'), row('q3', 'u1', 'callout_in', 'Old', 60 * 30),
    row('q4', 'u1', 'award_proposed', 'Not mine')];
  const { send, done } = calloutSends(rows, [], APP, NOW);
  assertEquals(send.map((s) => s.msg.title).sort(), ['A', 'B']);
  assertEquals(done.sort(), ['q1', 'q2', 'q3']);
  assertEquals(CALLOUT_KINDS.includes('award_proposed'), false);
});
