// Vote emails from the notify function (079). The rules are in ../_shared/emailvotes.js; this file reads the group's
// people and settings, makes each person's one-tap link and sends the email.
//   * when a vote (or a combined vote batch) opens: one email per batch per person on email;
//   * a reminder: only people on email who haven't answered, at most one per batch before it closes.
// An older database without 079 (no vote_emails / vote_channel): nothing is emailed and app notifications carry on.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import { planVoteSends, reminderTargets, batchKeyOf, tokenExpiry, buildVoteEmail } from '../_shared/emailvotes.js';
import { sendEmail } from '../_shared/email.ts';
import { newSecret } from '../_shared/tokens.ts';

type Db = SupabaseClient;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

/** Everything needed to decide who gets votes how in group g. */
export async function routing(db: Db, g: string) {
  const [pl, mem, prefs, grp, emails] = await Promise.all([
    db.from('players').select('id,name,nickname,approved').eq('group_id', g),
    db.from('group_members').select('user_id,player_id').eq('group_id', g),
    db.from('notify_prefs').select('user_id,vote_channel').eq('group_id', g),
    db.from('groups').select('vote_channel').eq('id', g).maybeSingle(),
    db.from('vote_emails').select('player_id,user_id,email,source').eq('group_id', g).not('email', 'is', null),
  ]);
  const ready = !prefs.error && !grp.error && !emails.error; // 079 is in
  return {
    ready,
    players: pl.data || [],
    members: mem.data || [],
    prefs: ready ? prefs.data || [] : [],
    groupDefault: ready ? (grp.data?.vote_channel || 'app') : 'app',
    emails: ready ? emails.data || [] : [],
  };
}

/** Users who chose email only (with an address): they don't get the app notification for votes. */
export async function emailOnlyUsers(db: Db, g: string) {
  // Email isn't set up (no Resend key / sender): everyone keeps the app notification (release review).
  if (!Deno.env.get('RESEND_API_KEY') || !Deno.env.get('EMAIL_FROM')) return new Set<string>();
  const r = await routing(db, g);
  if (!r.ready) return new Set<string>();
  return new Set(planVoteSends(r).emailOnlyUsers as string[]);
}

const fmtDay = (d?: string | null) => {
  if (!d) return '';
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(y, m - 1, dd).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
};

/** The open polls of this poll's batch (just the poll itself when it isn't in one). */
async function batchPolls(db: Db, poll: Row) {
  if (!poll.vote_batch) return poll.status === 'open' ? [poll] : [];
  const { data } = await db.from('plan_polls').select('*').eq('plan_id', poll.plan_id).eq('vote_batch', poll.vote_batch).eq('status', 'open').order('created_at');
  return data || [];
}

async function sendOne(db: Db, opts: { app: string; g: string; plan: Row; polls: Row[]; options: Row[]; person: Row; kind: 'open' | 'reminder'; batch: string; rsvp: boolean }) {
  const { secret, hash } = await newSecret();
  const { data: tok, error } = await db.from('vote_email_tokens').insert({
    group_id: opts.g, plan_id: opts.plan.id, player_id: opts.person.player_id, batch_key: opts.batch, kind: opts.kind,
    poll_ids: opts.polls.map((p) => p.id), secret_hash: hash, expires_at: tokenExpiry(opts.polls),
  }).select('id').single();
  if (error || !tok) return 'already'; // one per person per batch (unique), or 079 isn't in
  const closes = opts.polls.map((p) => p.closes_on).filter(Boolean).sort()[0];
  const msg = buildVoteEmail({
    app: opts.app, token: `${tok.id}.${secret}`, first: opts.person.first, planName: opts.plan.name, planId: opts.plan.id,
    polls: opts.polls.map((p) => ({ id: p.id, question: p.question, choice: p.choice || null, options: opts.options.filter((o) => o.poll_id === p.id).map((o) => ({ id: o.id, label: o.label })) })),
    rsvp: opts.rsvp, reminder: opts.kind === 'reminder', closes: fmtDay(closes),
  });
  const res = await sendEmail({ to: opts.person.email, ...msg });
  const status = res.ok ? 'sent' : 'skipped' in res ? res.skipped : `failed: ${res.error}`;
  await db.from('vote_email_tokens').update({ status }).eq('id', tok.id);
  return res.ok ? 'sent' : status;
}

/** A vote (batch) has opened: email everyone on email, once per batch. Returns how many emails went. */
export async function emailVoteOpen(db: Db, app: string, g: string, poll: Row, except: string | null) {
  const r = await routing(db, g);
  if (!r.ready) return { emailed: 0, note: '' };
  const polls = await batchPolls(db, poll);
  if (!polls.length) return { emailed: 0, note: '' };
  const { data: plan } = await db.from('plans').select('id,name,rsvp_locked,status').eq('id', poll.plan_id).eq('group_id', g).maybeSingle();
  if (!plan) return { emailed: 0, note: '' };
  const [{ data: options }, { data: rsvps }] = await Promise.all([
    db.from('plan_options').select('id,poll_id,label,start_date').in('poll_id', polls.map((p) => p.id)).order('start_date', { nullsFirst: false }).order('created_at'),
    db.from('plan_rsvps').select('player_id').eq('plan_id', plan.id),
  ]);
  const replied = new Set((rsvps || []).map((x) => x.player_id));
  const people = planVoteSends({ ...r, except }).email as Row[];
  let emailed = 0;
  let note = '';
  for (const person of people) {
    const s = await sendOne(db, { app, g, plan, polls, options: options || [], person, kind: 'open', batch: batchKeyOf(poll), rsvp: !plan.rsvp_locked && !replied.has(person.player_id) });
    if (s === 'sent') emailed++;
    else if (s !== 'already') note = s;
  }
  return { emailed, note };
}

/** Reminders for the open votes of a plan (or one poll): people on email who haven't answered, once per batch. */
export async function emailVoteReminders(db: Db, app: string, g: string, planId: string, pollId?: string) {
  const r = await routing(db, g);
  if (!r.ready) return 0;
  let q = db.from('plan_polls').select('*').eq('plan_id', planId).eq('group_id', g).eq('status', 'open');
  if (pollId) q = q.eq('id', pollId);
  const { data: open } = await q;
  if (!open?.length) return 0;
  const { data: plan } = await db.from('plans').select('id,name,rsvp_locked').eq('id', planId).maybeSingle();
  if (!plan) return 0;
  // Group by batch.
  const batches = new Map<string, Row[]>();
  for (const p of open) batches.set(batchKeyOf(p), [...(batches.get(batchKeyOf(p)) || []), p]);
  let emailed = 0;
  const people = planVoteSends(r).email as Row[];
  for (const [batch, seed] of batches) {
    const polls = seed[0].vote_batch ? await batchPolls(db, seed[0]) : seed;
    const ids = polls.map((p) => p.id);
    const [{ data: options }, { data: votes }, { data: sent }] = await Promise.all([
      db.from('plan_options').select('id,poll_id,label,start_date').in('poll_id', ids).order('start_date', { nullsFirst: false }).order('created_at'),
      db.from('plan_votes').select('option_id,poll_id,player_id').in('poll_id', ids),
      db.from('vote_email_tokens').select('player_id').eq('batch_key', batch).eq('kind', 'reminder'),
    ]);
    const targets = reminderTargets({ emailPeople: people, polls, options: options || [], votes: votes || [], reminded: (sent || []).map((x) => x.player_id) }) as Row[];
    for (const person of targets) {
      if ((await sendOne(db, { app, g, plan, polls, options: options || [], person, kind: 'reminder', batch, rsvp: false })) === 'sent') emailed++;
    }
  }
  return emailed;
}
