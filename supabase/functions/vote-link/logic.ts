// vote-link — what a one-tap answer link does (079). No sign-in: the link's own token says who is answering, and it
// only works for that one person, on the polls of that one email, until the vote closes.
//
// The email's buttons open the app's /v/<token> page (Supabase won't serve web pages from a function on its own
// address), which calls this with { t } to show the vote, then { t, o, r } / { t, rsvp } to record an answer, or
// { t, stop: true } to stop vote emails. Every reply is JSON; the page writes the words.
import { splitToken, sha256Hex, safeEqual } from '../_shared/tokens.ts';
import { ANSWERS, RSVP_ANSWERS, firstName } from '../_shared/emailvotes.js';

export type TokenRow = { id: string; group_id: string; plan_id: string; player_id: string; poll_ids: string[]; secret_hash: string; expires_at: string };
export type Poll = { id: string; plan_id: string; group_id: string; question: string; kind: string; status: string; closes_on?: string | null; choice?: string | null; purpose?: string | null };
export type Option = { id: string; poll_id: string; label: string };
export type Vote = { option_id: string; poll_id: string; response: string };
export type Deps = {
  token(id: string): Promise<TokenRow | null>;
  polls(ids: string[]): Promise<Poll[]>;
  options(pollIds: string[]): Promise<Option[]>;
  votes(pollIds: string[], playerId: string): Promise<Vote[]>;
  player(id: string): Promise<{ name?: string; nickname?: string } | null>;
  plan(id: string): Promise<{ id: string; name: string; group_id: string; rsvp_locked?: boolean; status?: string } | null>;
  rsvp(planId: string, playerId: string): Promise<string | null>;
  featureOn(groupId: string, key: string): Promise<boolean>;
  saveVote(v: { group_id: string; poll_id: string; option_id: string; player_id: string; response: string }): Promise<void>;
  clearOtherVotes(pollId: string, playerId: string, keepOptionId: string): Promise<void>;
  saveRsvp(r: { group_id: string; plan_id: string; player_id: string; status: string }): Promise<void>;
  stopEmails(t: TokenRow): Promise<void>;
  now(): number;
};
export type Reply = { status: number; body: Record<string, unknown> };

const ok = (body: Record<string, unknown>): Reply => ({ status: 200, body: { ok: true, ...body } });
const no = (status: number, error: string, extra: Record<string, unknown> = {}): Reply => ({ status, body: { ok: false, error, ...extra } });

export async function handle(input: unknown, d: Deps): Promise<Reply> {
  const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const parts = splitToken(body.t);
  if (!parts) return no(400, 'That link isn’t right — open the vote in the app instead.');
  const row = await d.token(parts.id);
  // Always hash and compare, even for an unknown id, so a wrong link takes the same time either way.
  const hash = await sha256Hex(parts.secret);
  if (!safeEqual(hash, row?.secret_hash || '0'.repeat(64)) || !row) return no(404, 'That link isn’t right — open the vote in the app instead.');

  if (body.stop === true) {
    await d.stopEmails(row);
    return ok({ stopped: true });
  }
  const [plan, person] = await Promise.all([d.plan(row.plan_id), d.player(row.player_id)]);
  const planOn = (await d.featureOn(row.group_id, 'planner')) && (await d.featureOn(row.group_id, 'planner_tasks'));
  const base = { name: firstName(person || {}), plan: plan && plan.group_id === row.group_id ? { id: plan.id, name: plan.name } : null };
  if (!plan || plan.group_id !== row.group_id || !planOn) return no(410, 'This vote isn’t running any more.', { closed: true, ...base });
  if (d.now() > Date.parse(row.expires_at)) return no(410, 'This vote has closed.', { closed: true, ...base });

  // Only this email's polls, of this trip, in this group.
  const polls = (await d.polls(row.poll_ids || [])).filter((p) => row.poll_ids.includes(p.id) && p.plan_id === row.plan_id && p.group_id === row.group_id);
  const options = polls.length ? await d.options(polls.map((p) => p.id)) : [];
  const openPolls = polls.filter((p) => p.status === 'open');
  const rsvpAsk = !plan.rsvp_locked && plan.status !== 'cancelled' && plan.status !== 'done';
  let recorded: Record<string, unknown> | null = null;

  if (typeof body.o === 'string') {
    const o = options.find((x) => x.id === body.o);
    const poll = o && polls.find((p) => p.id === o.poll_id);
    if (!o || !poll) return no(403, 'That answer isn’t part of your vote.', base);
    if (poll.status !== 'open') return no(410, 'This vote has closed.', { closed: true, ...base });
    const r = poll.choice === 'single' ? 'yes' : String(body.r || '');
    if (!(r in ANSWERS)) return no(400, 'Pick one of the three answers.', base);
    await d.saveVote({ group_id: row.group_id, poll_id: poll.id, option_id: o.id, player_id: row.player_id, response: r });
    if (poll.choice === 'single') await d.clearOtherVotes(poll.id, row.player_id, o.id);
    recorded = { kind: 'vote', poll: poll.id, option: o.id, label: o.label, response: r };
  } else if (typeof body.rsvp === 'string') {
    if (!(body.rsvp in RSVP_ANSWERS)) return no(400, 'Pick keen, maybe or out.', base);
    if (!rsvpAsk || !openPolls.length) return no(410, 'The list for this trip is locked — ask the organiser.', { closed: !openPolls.length, ...base });
    await d.saveRsvp({ group_id: row.group_id, plan_id: plan.id, player_id: row.player_id, status: body.rsvp });
    recorded = { kind: 'rsvp', response: body.rsvp };
  }

  const [mine, rsvp] = await Promise.all([polls.length ? d.votes(polls.map((p) => p.id), row.player_id) : [], d.rsvp(plan.id, row.player_id)]);
  return ok({
    ...base,
    closed: openPolls.length === 0,
    recorded,
    polls: polls.map((p) => ({
      id: p.id, question: p.question, kind: p.kind, purpose: p.purpose || null, choice: p.choice || null, open: p.status === 'open',
      options: options.filter((o) => o.poll_id === p.id).map((o) => ({ id: o.id, label: o.label })),
      mine: Object.fromEntries(mine.filter((v) => v.poll_id === p.id).map((v) => [v.option_id, v.response])),
    })),
    rsvp: { asked: rsvpAsk && openPolls.length > 0, mine: rsvp },
  });
}
