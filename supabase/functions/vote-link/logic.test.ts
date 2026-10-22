// Deno tests for vote-link (079): a one-tap answer link records the vote as that person, and nothing else.
// Run: deno test supabase/functions/vote-link/logic.test.ts supabase/functions/_shared/email.test.ts
import nodeAssert from 'node:assert/strict';
import { handle, type Deps, type TokenRow, type Poll, type Option } from './logic.ts';
import { sha256Hex, safeEqual, splitToken, newSecret } from '../_shared/tokens.ts';
import { buildVoteEmail } from '../_shared/emailvotes.js';

const G = 'f9e18914-24a2-43ad-8989-ca91e3d1af19';
const PLAN = 'eeeeeeee-0000-4000-8000-000000000001';
const POLL = 'abababab-0000-4000-8000-000000000001';
const POLL_OTHER = 'abababab-0000-4000-8000-000000000009'; // same trip, not in this email
const O1 = 'a1000000-0000-4000-8000-000000000001';
const O2 = 'a1000000-0000-4000-8000-000000000002';
const O_OTHER = 'a1000000-0000-4000-8000-000000000009';
const JOSH = '20000000-0000-4000-8000-000000000001';
const TOK = 'cccccccc-0000-4000-8000-000000000001';

async function world(opts: { closed?: boolean; expired?: boolean; featureOff?: boolean; choice?: string; locked?: boolean } = {}) {
  const { secret, hash } = await newSecret();
  const row: TokenRow = { id: TOK, group_id: G, plan_id: PLAN, player_id: JOSH, poll_ids: [POLL], secret_hash: hash, expires_at: new Date(Date.now() + (opts.expired ? -1 : 1) * 864e5).toISOString() };
  const polls: Poll[] = [
    { id: POLL, plan_id: PLAN, group_id: G, question: 'Which weekend?', kind: 'dates', status: opts.closed ? 'closed' : 'open', choice: opts.choice || null },
    { id: POLL_OTHER, plan_id: PLAN, group_id: G, question: 'Shirt colour?', kind: 'other', status: 'open' },
  ];
  const options: Option[] = [
    { id: O1, poll_id: POLL, label: '13–15 Mar' }, { id: O2, poll_id: POLL, label: '20–22 Mar' }, { id: O_OTHER, poll_id: POLL_OTHER, label: 'Pink' },
  ];
  const votes: { option_id: string; poll_id: string; player_id: string; response: string; via: string }[] = [];
  const rsvps: Record<string, string> = {};
  const log: string[] = [];
  const d: Deps = {
    token: async (id) => (id === TOK ? row : null),
    polls: async (ids) => polls.filter((p) => ids.includes(p.id)),
    options: async (ids) => options.filter((o) => ids.includes(o.poll_id)),
    votes: async (ids, pid) => votes.filter((v) => ids.includes(v.poll_id) && v.player_id === pid),
    player: async () => ({ name: 'Josh Moran', nickname: '' }),
    plan: async () => ({ id: PLAN, name: 'Hunter <2027>', group_id: G, rsvp_locked: !!opts.locked, status: 'planning' }),
    rsvp: async (_p, pid) => rsvps[pid] || null,
    featureOn: async () => !opts.featureOff,
    saveVote: async (v) => {
      const i = votes.findIndex((x) => x.option_id === v.option_id && x.player_id === v.player_id);
      const nv = { ...v, via: 'email' };
      if (i >= 0) votes[i] = nv; else votes.push(nv);
      log.push(`vote ${v.player_id} ${v.option_id} ${v.response}`);
    },
    clearOtherVotes: async (poll, pid, keep) => {
      for (let i = votes.length - 1; i >= 0; i--) if (votes[i].poll_id === poll && votes[i].player_id === pid && votes[i].option_id !== keep) votes.splice(i, 1);
    },
    saveRsvp: async (r) => { rsvps[r.player_id] = r.status; log.push(`rsvp ${r.status}`); },
    stopEmails: async () => { log.push('stop'); },
    now: () => Date.now(),
  };
  return { t: `${TOK}.${secret}`, secret, d, votes, rsvps, log, row };
}

Deno.test('a valid link records the vote as that person, and a second tap changes it', async () => {
  const w = await world();
  const r1 = await handle({ t: w.t, o: O1, r: 'yes' }, w.d);
  nodeAssert.equal(r1.status, 200);
  nodeAssert.equal(r1.body.name, 'Josh');
  nodeAssert.deepEqual(r1.body.recorded, { kind: 'vote', poll: POLL, option: O1, label: '13–15 Mar', response: 'yes' });
  nodeAssert.deepEqual(w.votes.map((v) => [v.player_id, v.option_id, v.response, v.via]), [[JOSH, O1, 'yes', 'email']]);
  const r2 = await handle({ t: w.t, o: O1, r: 'no' }, w.d);
  nodeAssert.equal(r2.status, 200);
  nodeAssert.equal(w.votes.length, 1);
  nodeAssert.equal(w.votes[0].response, 'no');
  // The view shows only this email's poll, with my answer.
  const polls = r2.body.polls as { id: string; mine: Record<string, string> }[];
  nodeAssert.deepEqual(polls.map((p) => p.id), [POLL]);
  nodeAssert.deepEqual(polls[0].mine, { [O1]: 'no' });
});

Deno.test('just opening the link (no answer) records nothing', async () => {
  const w = await world();
  const r = await handle({ t: w.t }, w.d);
  nodeAssert.equal(r.status, 200);
  nodeAssert.equal(r.body.recorded, null);
  nodeAssert.equal(w.votes.length, 0);
});

Deno.test('refused: unknown token, wrong secret, bad shape, another vote’s option, closed, expired, switched off', async () => {
  const w = await world();
  nodeAssert.equal((await handle({ t: `${'dddddddd-0000-4000-8000-000000000001'}.${w.secret}`, o: O1, r: 'yes' }, w.d)).status, 404);
  const wrong = (await newSecret()).secret;
  nodeAssert.equal((await handle({ t: `${TOK}.${wrong}`, o: O1, r: 'yes' }, w.d)).status, 404);
  nodeAssert.equal((await handle({ t: 'nonsense', o: O1, r: 'yes' }, w.d)).status, 400);
  nodeAssert.equal((await handle({}, w.d)).status, 400);
  nodeAssert.equal((await handle({ t: w.t, o: O_OTHER, r: 'yes' }, w.d)).status, 403);
  nodeAssert.equal((await handle({ t: w.t, o: O1, r: 'sure' }, w.d)).status, 400);
  nodeAssert.equal(w.votes.length, 0);
  const c = await world({ closed: true });
  const rc = await handle({ t: c.t, o: O1, r: 'yes' }, c.d);
  nodeAssert.equal(rc.status, 410);
  nodeAssert.equal(rc.body.closed, true);
  const e = await world({ expired: true });
  nodeAssert.equal((await handle({ t: e.t, o: O1, r: 'yes' }, e.d)).status, 410);
  const f = await world({ featureOff: true });
  nodeAssert.equal((await handle({ t: f.t, o: O1, r: 'yes' }, f.d)).status, 410);
  for (const x of [c, e, f]) nodeAssert.equal(x.votes.length, 0);
});

Deno.test('a token never answers as anyone else, whatever the request says', async () => {
  const w = await world();
  await handle({ t: w.t, o: O2, r: 'maybe', player_id: '20000000-0000-4000-8000-000000000002' }, w.d);
  nodeAssert.deepEqual(w.votes.map((v) => v.player_id), [JOSH]);
});

Deno.test('single choice: one pick, the other picks cleared', async () => {
  const w = await world({ choice: 'single' });
  await handle({ t: w.t, o: O1 }, w.d);
  await handle({ t: w.t, o: O2 }, w.d);
  nodeAssert.deepEqual(w.votes.map((v) => [v.option_id, v.response]), [[O2, 'yes']]);
});

Deno.test('keen / maybe / out, and not once the list is locked', async () => {
  const w = await world();
  const r = await handle({ t: w.t, rsvp: 'in' }, w.d);
  nodeAssert.equal(r.status, 200);
  nodeAssert.equal(w.rsvps[JOSH], 'in');
  const l = await world({ locked: true });
  nodeAssert.equal((await handle({ t: l.t, rsvp: 'in' }, l.d)).status, 410);
  nodeAssert.equal(l.rsvps[JOSH], undefined);
});

Deno.test('stop link switches emails off for that person (even after the vote closes)', async () => {
  const w = await world({ closed: true });
  const r = await handle({ t: w.t, stop: true }, w.d);
  nodeAssert.equal(r.status, 200);
  nodeAssert.deepEqual(w.log, ['stop']);
});

Deno.test('tokens: constant-time compare, shape check, stored hash', async () => {
  nodeAssert.ok(safeEqual('abc', 'abc'));
  nodeAssert.ok(!safeEqual('abc', 'abd'));
  nodeAssert.ok(!safeEqual('abc', 'abcd'));
  nodeAssert.ok(!safeEqual('', 'a'));
  const { secret, hash } = await newSecret();
  nodeAssert.equal(hash, await sha256Hex(secret));
  nodeAssert.ok(!hash.includes(secret));
  nodeAssert.deepEqual(splitToken(`${TOK}.${secret}`), { id: TOK, secret });
  nodeAssert.equal(splitToken(`${TOK}.short`), null);
  nodeAssert.equal(splitToken(`not-a-uuid.${secret}`), null);
  nodeAssert.equal(splitToken(42), null);
});

Deno.test('email HTML escapes names, questions and options', () => {
  const m = buildVoteEmail({ app: 'https://app.thegolftrip.club/', token: 't.x', first: '<b>Jo</b>', planName: 'Hunter <script>', planId: PLAN,
    polls: [{ id: POLL, question: 'Where "now"?', options: [{ id: O1, label: '<img src=x onerror=alert(1)>' }] }] });
  nodeAssert.ok(!m.html.includes('<script>'));
  nodeAssert.ok(!m.html.includes('<img'));
  nodeAssert.ok(m.html.includes('&lt;b&gt;Jo&lt;/b&gt;'));
  nodeAssert.ok(m.html.includes('Where &quot;now&quot;?'));
});
