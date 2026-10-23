// Run: deno test --no-check supabase/functions/notify/autoawards.test.ts
// ov31: who gets an automatic award buzz straight away.
import nodeAssert from 'node:assert/strict';
import { autoAwardSends, AUTO_AWARD_KINDS } from './autoawards.ts';
const assertEquals = (a: unknown, b: unknown) => nodeAssert.deepStrictEqual(a, b);

const NOW = Date.parse('2026-11-07T20:05:00Z');
const at = (minsAgo: number) => new Date(NOW - minsAgo * 60000).toISOString();
const row = (id: string, user_id: string, kind: string, title: string, minsAgo = 5, group_id = 'g1') => ({ id, group_id, user_id, kind, title, body: null, created_at: at(minsAgo) });

Deno.test('the morning proposal goes straight away to people on "straight away" (the default)', () => {
  const { send, done } = autoAwardSends([row('q1', 'u1', 'award_proposed', '🌙 Proposed — Latest out, last night: Hamish 2:47am 📷')], [], NOW);
  assertEquals(send.length, 1);
  assertEquals(send[0].user_id, 'u1');
  assertEquals(send[0].msg.title, '🌙 Proposed — Latest out, last night: Hamish 2:47am 📷');
  assertEquals(send[0].msg.body, 'Open the Feed to confirm or dispute.');
  assertEquals(done, ['q1']);
});

Deno.test('digest people wait for their hour; "only important" people get only the winner / organiser ones', () => {
  const rows = [
    row('q1', 'dig', 'award_proposed', 'P'),
    row('q2', 'imp', 'award_proposed', 'P'),
    row('q3', 'imp', 'award_confirmed', '✅ Confirmed — Latest out: Hamish'),
    row('q4', 'org', 'award_overturned', '⚖️ Dispute upheld'),
  ];
  const prefs = [{ group_id: 'g1', user_id: 'dig', mode: 'digest' }, { group_id: 'g1', user_id: 'imp', mode: 'important' }, { group_id: 'g1', user_id: 'org', mode: 'important' }];
  const { send, done } = autoAwardSends(rows, prefs, NOW);
  assertEquals(send.map((s) => [s.user_id, s.msg.title]), [['imp', '✅ Confirmed — Latest out: Hamish'], ['org', '⚖️ Dispute upheld']]);
  assertEquals(done.sort(), ['q3', 'q4']);
});

Deno.test('several at once: one buzz each, per group', () => {
  const rows = [row('q1', 'u1', 'award_proposed', 'A', 6), row('q2', 'u1', 'award_proposed', 'B', 5), row('q3', 'u1', 'award_proposed', 'C', 5, 'g2')];
  const { send } = autoAwardSends(rows, [], NOW);
  assertEquals(send.map((s) => [s.group_id, s.msg.title, s.msg.body]), [['g1', '🏅 2 award updates', 'A · B'], ['g2', 'C', 'Open the Feed to confirm or dispute.']]);
});

Deno.test('stale ones (over 12 hours) are marked sent, not buzzed; other kinds are left alone', () => {
  const { send, done } = autoAwardSends([row('q1', 'u1', 'award_proposed', 'Old', 13 * 60), row('q2', 'u1', 'commentary', 'Not mine')], [], NOW);
  assertEquals(send, []);
  assertEquals(done, ['q1']);
  assertEquals(AUTO_AWARD_KINDS.includes('commentary'), false);
});
