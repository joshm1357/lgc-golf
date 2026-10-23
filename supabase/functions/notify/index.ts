// notify — sends phone notifications (Web Push) for The Golf Trip.
//
// The app never sends message text: it says WHAT happened (e.g. "poll_open" + the poll id)
// and this function looks it up and writes the message itself, so nobody can spam
// the group with made-up notifications. Organiser-only types are checked here.
// Groups: every request works inside ONE group — the group the app names (if the person is in it)
// or else their first group. Every id in the request must belong to that group, and messages only
// go to phones of people in that group. The daily reminders run group by group.
// The daily reminders and the hourly digest are triggered by the database scheduler with a secret header.
// Each person picks, per group (notify_prefs): straight away (default), a daily digest at an hour they choose, or
// only important things. Digest messages wait in notify_queue. "The draw room is open" always goes straight away.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';
// 079: votes by email (each person: in the app, by email or both).
import { emailOnlyUsers, emailVoteOpen, emailVoteReminders } from './votemail.ts';
import { VOTE_KINDS } from '../_shared/emailvotes.js';
import { batchNonVoters, reminderGroups, batchMessage } from './batch.ts';
// ov25: the run-up's personal reminders (a week out: "3 things waiting for you"; the day before: your car, room, tee
// time and what you're bringing). The words are shared with the app's tests.
import { weekOutMessage, dayBeforeMessage } from '../_shared/runup.js';
// ov28: "your round" — the draw is out (I8), your tee time tomorrow (I11), swing alerts (I13).
import { roundBits, drawOutFor, teeTomorrowFor, swingGap, matchSwing, pointsSwing } from './yourround.ts';
// ov31: automatic awards — the proposed winner in the morning, confirmed, a dispute upheld.
import { AUTO_AWARD_KINDS, AUTO_AWARD_IMPORTANT, autoAwardSends } from './autoawards.ts';

// The app's web address for links in notifications. Set APP_URL in the function's secrets when the app moves
// (e.g. https://app.thegolftrip.club/); until then it's the GitHub Pages address.
const APP = Deno.env.get('APP_URL') || 'https://joshm1357.github.io/lgc-golf/';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret, x-group-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

let cronSecret = '';
let ready = false;
async function loadKeys() {
  if (ready) return;
  const { data, error } = await db.from('server_secrets').select('name,value');
  if (error) throw error;
  const s = Object.fromEntries((data || []).map((r) => [r.name, r.value]));
  webpush.setVapidDetails(s.vapid_subject, s.vapid_public, s.vapid_private);
  cronSecret = s.cron_secret || '';
  ready = true;
}

type Msg = { title: string; body: string; url: string; tag?: string };

/** Always straight away, whatever someone picked. */
const ALWAYS_NOW = new Set(['draw_open', 'test']);
/** What "only important" people still get: the draw room, a job given to them or due, money, their trip tomorrow. */
// 'award': a round, trophy or Cup match decided (054/054b queue these; they go out with the hourly send).
// 'award_minor': closest to the pin / longest drive — not "important".
// Tribunal (061, queued from the database): a case about you, your committee's case, a case over to the organisers or
// needing a casting vote, a report, a term ending, and "voting closes tomorrow".
const IMPORTANT = new Set(['draw_open', 'test', 'job_assigned', 'job_due', 'payment_recorded', 'nudge_kitty', 'deposit_ask', 'nudge_deposit', 'trip_tomorrow', 'award',
  'case_about_you', 'case_committee', 'case_fallback', 'case_casting', 'case_report', 'case_closing', 'term_ending',
  // ov28: who you're playing with and when you're off.
  'draw_out', 'tee_tomorrow']);
/** ov28: only worth it in the moment — "straight away" people get them; never saved up for a digest. */
const NOT_IN_DIGEST = new Set(['swing']);

/** Which feature each kind of message belongs to (Stage 3): nothing goes out for a switched-off feature. */
const KIND_FEATURE: Record<string, string> = {
  poll_open: 'planner_tasks', poll_decided: 'planner_tasks', poll_closing: 'planner_tasks', nudge_votes: 'planner_tasks',
  job_assigned: 'planner_tasks', job_due: 'planner_tasks',
  plan_new: 'planner', plan_proposed: 'planner', trip_locked: 'planner', rsvp_locked: 'planner', rsvp_deadline: 'planner',
  nudge_rsvp: 'planner', trip_week: 'planner', trip_tomorrow: 'planner', comment: 'planner',
  nudge_kitty: 'planner_costs', payment_recorded: 'planner_costs', groups_set: 'planner_rooms',
  deposit_ask: 'planner_costs', nudge_deposit: 'planner_costs',
  rule_proposed: 'rule_voting', draw_open: 'draw', award: 'awards', award_minor: 'awards', commentary: 'commentary',
  case_new: 'tribunal', case_about_you: 'tribunal', case_committee: 'tribunal', case_fallback: 'tribunal', case_casting: 'tribunal',
  case_report: 'tribunal', case_closing: 'tribunal', case_verdict: 'tribunal', term_ending: 'committees',
  // ov28: swing alerts ride on live commentary's switch (and its buzz level); the draw-out and tee-time buzzes are
  // core (teams, tee groups and Cup matches can each be set without any other feature).
  swing: 'commentary',
  // rule_decided: not tied to voting — organisers deciding rules is part of the Rulebook itself.
};
/** Is a feature on for group g? (An older database without switches: everything on.) */
async function featureOn(g: string, key: string) {
  const { data, error } = await db.rpc('feature_on', { p_group: g, p_key: key });
  return error ? true : data !== false;
}

/** Push to these people's phones now. Cleans up phones that have unsubscribed. */
async function pushTo(users: string[], msg: Msg) {
  if (!users.length) return 0;
  const { data: subs } = await db.from('push_subscriptions').select('*').in('user_id', users);
  let sent = 0;
  await Promise.all((subs || []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg), { TTL: 60 * 60 * 24 });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
    }
  }));
  return sent;
}

/** Send to some players of group `g` (or 'all' of them), skipping player `except`, as each person chose:
 *  straight away, into their daily digest, or (for "only important") not at all unless it matters.
 *  Phones are found through who is in the group, so nothing ever reaches another group.
 *  Returns how many phones got it now. */
async function send(g: string, to: string[] | 'all', msg: Msg, except: string | null | undefined, kind: string) {
  if (kind !== 'test' && !(await featureOn(g, 'notifications'))) return 0;
  if (KIND_FEATURE[kind] && !(await featureOn(g, KIND_FEATURE[kind]))) return 0;
  let mq = db.from('group_members').select('user_id,player_id').eq('group_id', g);
  if (to !== 'all') {
    const ids = [...new Set(to)].filter((x) => x && x !== except);
    if (!ids.length) return 0;
    mq = mq.in('player_id', ids);
  }
  const { data: people } = await mq;
  let users = [...new Set((people || []).filter((m) => !except || m.player_id !== except).map((m) => m.user_id))];
  // 079: people who chose "By email" (and have an address) get votes by email instead of a notification.
  if (VOTE_KINDS.has(kind)) {
    const skip = await emailOnlyUsers(db, g);
    users = users.filter((u) => !skip.has(u));
  }
  if (!users.length) return 0;
  const { data: prefs } = await db.from('notify_prefs').select('user_id,mode').eq('group_id', g).in('user_id', users);
  const mode = new Map((prefs || []).map((p) => [p.user_id, p.mode as string]));
  const now: string[] = [];
  const later: string[] = [];
  for (const u of users) {
    const m = mode.get(u) || 'instant';
    if (ALWAYS_NOW.has(kind) || m === 'instant' || (m === 'important' && IMPORTANT.has(kind))) now.push(u);
    else if (m === 'digest' && !NOT_IN_DIGEST.has(kind)) later.push(u);
  }
  if (later.length) {
    await db.from('notify_queue').insert(later.map((u) => ({ group_id: g, user_id: u, kind, title: msg.title, body: msg.body, url: msg.url })));
  }
  return pushTo(now, msg);
}

/** The local hour and date for someone's chosen time zone (Sydney if it's not one we know). */
function localNow(tz: string) {
  const at = (zone: string) => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const v = (t: string) => parts.find((p) => p.type === t)?.value || '';
    return { hour: Number(v('hour')), date: `${v('year')}-${v('month')}-${v('day')}` };
  };
  try { return at(tz || 'Australia/Sydney'); } catch { return at('Australia/Sydney'); }
}

/** Hourly: anyone whose digest hour it is gets one message with what's waiting. Someone who has switched back to
 *  "straight away" gets whatever was still waiting, at once. */
async function digest() {
  let sent = 0;
  const { data: waiting } = await db.from('notify_queue').select('id,group_id,user_id,kind,title,url,created_at').is('sent_at', null).order('created_at').limit(5000);
  if (!waiting?.length) return 0;
  const byPerson = new Map<string, typeof waiting>();
  for (const w of waiting) {
    const k = `${w.group_id}|${w.user_id}`;
    byPerson.set(k, [...(byPerson.get(k) || []), w]);
  }
  const groupIds = [...new Set(waiting.map((w) => w.group_id))];
  const [{ data: prefs }, { data: groups }] = await Promise.all([
    db.from('notify_prefs').select('group_id,user_id,mode,digest_hour,tz').in('group_id', groupIds),
    db.from('groups').select('id,name').in('id', groupIds),
  ]);
  for (const [k, all] of byPerson) {
    const [g, user] = k.split('|');
    const p = (prefs || []).find((x) => x.group_id === g && x.user_id === user);
    const local = localNow(p?.tz || 'Australia/Sydney');
    // Switched to "only important": the important ones still go; the rest are dropped. So are items for a feature
    // (or notifications) switched off since they were queued.
    const notifOn = await featureOn(g, 'notifications');
    const kept = [];
    for (const i of all) if (notifOn && (!KIND_FEATURE[i.kind] || await featureOn(g, KIND_FEATURE[i.kind]))) kept.push(i);
    // 071: a live commentary line is stale after 30 minutes — it's in the Feed; don't put it in an update.
    for (let k = kept.length - 1; k >= 0; k--) if (kept[k].kind === 'commentary' && Date.now() - new Date(kept[k].created_at).getTime() > 30 * 60000) kept.splice(k, 1);
    const items = p?.mode === 'important' ? kept.filter((i) => IMPORTANT.has(i.kind)) : kept;
    if (p?.mode === 'digest' && local.hour !== p.digest_hour) continue;
    if (p?.mode === 'digest' && !(await once(`digest:${g}:${user}:${local.date}:${local.hour}`))) continue;
    const gname = (groups || []).find((x) => x.id === g)?.name || 'Your golf group';
    const shown = items.slice(0, 3).map((i) => i.title).join(' · ');
    const more = items.length > 3 ? ` · +${items.length - 3} more` : '';
    const msg = items.length === 1
      ? { title: items[0].title, body: gname, url: items[0].url || APP }
      // Only winners in it (054 awards): open the leaderboard, not the planner.
      : { title: `📬 ${gname}: ${items.length} things since your last update`, body: shown + more, url: items.every((i) => i.kind === 'award' || i.kind === 'award_minor' || i.kind === 'commentary') ? `${APP}#/` : `${APP}#/plan`, tag: `digest-${g}` };
    if (items.length) sent += await pushTo([user], msg);
    await db.from('notify_queue').update({ sent_at: new Date().toISOString() }).in('id', all.map((i) => i.id));
  }
  // Keep the queue small: forget what went out more than a month ago.
  await db.from('notify_queue').delete().lt('sent_at', new Date(Date.now() - 30 * 86400000).toISOString());
  return sent;
}

/** 071: live commentary buzzes, sent as soon as the line is written (the ai-helper and the every-minute job call
 *  this with the cron secret). The database only queued them for people on "straight away", already rate-limited.
 *  Older than 30 minutes: dropped (the line is in the Feed). Each person gets their newest line for each group. */
async function commentaryNow() {
  const { data: waiting } = await db.from('notify_queue').select('id,group_id,user_id,title,body,created_at')
    .eq('kind', 'commentary').is('sent_at', null).order('created_at').limit(2000);
  if (!waiting?.length) return 0;
  let sent = 0;
  const fresh = waiting.filter((w) => Date.now() - new Date(w.created_at).getTime() <= 30 * 60000);
  const on = new Map<string, boolean>();
  for (const g of new Set(fresh.map((w) => w.group_id))) on.set(g, (await featureOn(g, 'notifications')) && (await featureOn(g, 'commentary')));
  const newest = new Map<string, (typeof waiting)[number]>();
  for (const w of fresh) if (on.get(w.group_id)) newest.set(`${w.group_id}|${w.user_id}`, w);
  for (const w of newest.values()) sent += await pushTo([w.user_id], { title: w.title, body: w.body || '', url: `${APP}#/feed`, tag: `commentary-${w.group_id}` });
  await db.from('notify_queue').update({ sent_at: new Date().toISOString() }).in('id', waiting.map((w) => w.id));
  return sent;
}

// ------------------------------------------------------------------ ov31: automatic awards (migration 100)
// The database's 5-minute job queues "🌙 Proposed — Latest out, last night: …", "✅ Confirmed — …" (to the winner) and
// "⚖️ Dispute upheld — pick another claim" (to organisers) and calls this with the cron secret ({"type":"auto_awards"}).
// "Straight away" people get them now; digest people at their hour (the hourly send); "only important" people get the
// winner / organiser ones. They belong to Awards and fines (dinner_awards).
for (const k of AUTO_AWARD_KINDS) KIND_FEATURE[k] = 'dinner_awards';
for (const k of AUTO_AWARD_IMPORTANT) IMPORTANT.add(k);
async function autoAwardsNow() {
  const { data: waiting } = await db.from('notify_queue').select('id,group_id,user_id,kind,title,body,created_at')
    .in('kind', AUTO_AWARD_KINDS).is('sent_at', null).order('created_at').limit(2000);
  if (!waiting?.length) return 0;
  const groups = [...new Set(waiting.map((w) => w.group_id))];
  const { data: prefs } = await db.from('notify_prefs').select('group_id,user_id,mode').in('group_id', groups);
  const on = new Map<string, boolean>();
  for (const g of groups) on.set(g, (await featureOn(g, 'notifications')) && (await featureOn(g, 'dinner_awards')));
  const { send, done } = autoAwardSends(waiting.filter((w) => on.get(w.group_id)), prefs || []);
  let sent = 0;
  for (const s of send) sent += await pushTo([s.user_id], { ...s.msg, url: `${APP}#/feed` });
  const off = waiting.filter((w) => !on.get(w.group_id)).map((w) => w.id);
  if (done.length || off.length) await db.from('notify_queue').update({ sent_at: new Date().toISOString() }).in('id', [...done, ...off]);
  return sent;
}

const planUrl = (id: string, tab?: string) => `${APP}#/plan/${id}${tab ? `?tab=${tab}` : ''}`;
const name = (p?: { name?: string; nickname?: string }) => (p?.nickname || p?.name || 'Someone').split(' ')[0];
const sydneyDate = (offsetDays = 0) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date(Date.now() + offsetDays * 86400000));
const fmt = (d?: string | null) => {
  if (!d) return '';
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(y, m - 1, dd).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
};

async function players(g: string) {
  const { data } = await db.from('players').select('id,name,nickname,approved').eq('group_id', g);
  return (data || []).filter((p) => p.approved !== false);
}
async function admins(g: string) {
  const { data } = await db.from('group_members').select('player_id').eq('group_id', g).eq('role', 'organiser');
  return (data || []).map((m) => m.player_id).filter(Boolean);
}
class NotYours extends Error {}
/** A row of this group, or stop: ids from another group are refused. */
async function mine(g: string, table: string, id: string, select = '*') {
  if (!id) throw new NotYours();
  const { data } = await db.from(table).select(select).eq('id', id).eq('group_id', g).maybeSingle();
  if (!data) throw new NotYours();
  return data as Record<string, any>;
}
async function plan(g: string, id: string) {
  return mine(g, 'plans', id);
}
async function openPollNonVoters(g: string, planId: string, pollId?: string) {
  let pq = db.from('plan_polls').select('*').eq('plan_id', planId).eq('status', 'open');
  if (pollId) pq = pq.eq('id', pollId);
  const { data: polls } = await pq;
  // ov23 (092): nobody is nudged for skipping the optional detail (an area's courses / places to stay).
  const pollIds = (polls || []).filter((p) => p.optional !== true).map((p) => p.id);
  if (!pollIds.length) return [];
  const [{ data: opts }, { data: votes }, people] = await Promise.all([
    db.from('plan_options').select('id,poll_id').in('poll_id', pollIds),
    db.from('plan_votes').select('option_id,player_id').in('poll_id', pollIds),
    players(g),
  ]);
  const need = (opts || []).length;
  return people.filter((p) => (votes || []).filter((v) => v.player_id === p.id).length < need).map((p) => p.id);
}
// Same maths as src/lib/plan.js kitty(): balance = share − fronted − paid − sent + received.
async function kittyOwing(planId: string) {
  const [{ data: costs }, { data: pays }, { data: rsvps }, { data: tr }] = await Promise.all([
    db.from('plan_costs').select('*').eq('plan_id', planId),
    db.from('plan_payments').select('*').eq('plan_id', planId),
    db.from('plan_rsvps').select('*').eq('plan_id', planId).eq('status', 'in'),
    db.from('plan_transfers').select('*').eq('plan_id', planId).eq('confirmed', true),
  ]);
  const inIds = (rsvps || []).map((r) => r.player_id);
  const transfers = tr || [];
  type Cost = { per_head: boolean; amount: number; paid_by: string | null; split_between: string[] | null };
  const group = (c: Cost) => {
    const g = [...new Set(c.split_between && c.split_between.length ? c.split_between : inIds)];
    return g.length ? g : c.paid_by ? [c.paid_by] : [];
  };
  const totalOf = (c: Cost) => (c.per_head ? Number(c.amount) * group(c).length : Number(c.amount));
  const shareOf = (c: Cost, pid: string) => (!group(c).includes(pid) ? 0 : c.per_head ? Number(c.amount) : Number(c.amount) / group(c).length);
  const ids = [...new Set([...inIds, ...(costs || []).flatMap((c: Cost) => c.split_between || []), ...transfers.flatMap((t) => [t.from_id, t.to_id]).filter(Boolean)])];
  return ids.map((pid) => {
    const share = (costs || []).reduce((s: number, c: Cost) => s + shareOf(c, pid), 0);
    const fronted = (costs || []).filter((c: Cost) => c.paid_by === pid).reduce((s: number, c: Cost) => s + totalOf(c), 0);
    const paid = (pays || []).filter((p) => p.player_id === pid).reduce((s, p) => s + Number(p.paid || 0), 0)
      + transfers.filter((t) => t.from_id === pid && !t.to_id).reduce((s, t) => s + Number(t.amount), 0);
    const sent = transfers.filter((t) => t.from_id === pid && t.to_id).reduce((s, t) => s + Number(t.amount), 0);
    const received = transfers.filter((t) => t.to_id === pid).reduce((s, t) => s + Number(t.amount), 0);
    return { pid, owes: Math.round((share - fronted - paid - sent + received) * 100) / 100 };
  }).filter((x) => x.owes > 0.5);
}

/** ov25: what each person has waiting for a trip, and their day-before bits (car, room, tee time, what to bring).
 *  Throws on a database without 094 (the caller falls back to the old message). */
// deno-lint-ignore no-explicit-any
async function runUpFor(g: string, pl: Record<string, any>, _ins: string[], dayBefore: boolean) {
  const [{ data: items, error: e1 }, { data: people, error: e2 }, { data: groups }, { data: tr }, { data: rsvpsAll }, { data: tips }, pls] = await Promise.all([
    db.from('plan_items').select('id,kind,title,owner_id,done,stage,bring_shared').eq('plan_id', pl.id),
    db.from('trip_runup_people').select('player_id,handicap_checked_at').eq('plan_id', pl.id),
    db.from('plan_groups').select('id,kind,name,driver_id,pickup_place,pickup_time').eq('plan_id', pl.id),
    db.from('plan_transfers').select('from_id,to_id,amount,confirmed').eq('plan_id', pl.id),
    db.from('plan_rsvps').select('player_id,status').eq('plan_id', pl.id),
    db.from('trip_tips').select('player_id').eq('plan_id', pl.id),
    players(g),
  ]);
  if (e1 || e2) throw new Error('before 094');
  const byId = new Map(pls.map((p) => [p.id, p]));
  const groupIds = (groups || []).map((x) => x.id);
  const { data: members } = groupIds.length ? await db.from('plan_group_members').select('group_id,player_id').in('group_id', groupIds) : { data: [] as { group_id: string; player_id: string }[] };
  let tees: { player_ids: string[]; tee_time: string }[] = [];
  if (dayBefore && pl.trip_id) {
    const { data: rounds } = await db.from('rounds').select('id,play_date').eq('trip_id', pl.trip_id).not('play_date', 'is', null).order('play_date').limit(1);
    if (rounds?.[0]) tees = ((await db.from('tee_groups').select('player_ids,tee_time').eq('round_id', rounds[0].id)).data || []) as typeof tees;
  }
  const deposit = Number(pl.deposit_pp) || 0;
  const paid = (pid: string) => (tr || []).filter((t) => t.from_id === pid && !t.to_id).reduce((s, t) => s + Number(t.amount || 0), 0);
  return {
    waiting(pid: string) {
      const mine = (items || []).filter((i) => i.owner_id === pid);
      const r = (rsvpsAll || []).find((x) => x.player_id === pid);
      return {
        reply: !r || r.status === 'maybe',
        deposit: deposit > 0 && paid(pid) < deposit - 0.5 ? `$${deposit}` : null,
        jobs: mine.filter((i) => i.kind === 'job' && !(i.done || i.stage === 'done')).map((i) => i.title),
        handicap: !(people || []).some((p) => p.player_id === pid && p.handicap_checked_at),
        tip: !pl.tipping_off && !(tips || []).some((t) => t.player_id === pid),
      };
    },
    dayBefore(pid: string) {
      const inGroup = (kind: string) => (groups || []).find((x) => x.kind === kind && (members || []).some((m) => m.group_id === x.id && m.player_id === pid));
      const car = inGroup('car');
      const room = inGroup('room');
      const tee = tees.filter((t) => (t.player_ids || []).includes(pid)).map((t) => t.tee_time).sort()[0] || null;
      return {
        car: car ? { name: car.name, driver: byId.get(car.driver_id) || null, driving: car.driver_id === pid, pickup_place: car.pickup_place, pickup_time: car.pickup_time } : null,
        room: room ? { name: room.name, with: (members || []).filter((m) => m.group_id === room.id && m.player_id !== pid).map((m) => byId.get(m.player_id)).filter(Boolean) } : null,
        tee,
        bring: (items || []).filter((i) => i.kind === 'bring' && i.bring_shared && i.owner_id === pid).map((i) => i.title),
      };
    },
  };
}

/** Only send each daily reminder once. */
async function once(key: string) {
  const { error } = await db.from('notify_log').insert({ key });
  return !error;
}

/** The daily reminders, one group at a time: each group's reminders only go to that group. */
async function daily() {
  let sent = 0;
  const { data: groups } = await db.from('groups').select('id');
  for (const gr of groups || []) sent += await dailyFor(gr.id);
  return sent;
}
async function dailyFor(g: string) {
  let sent = 0;
  // Checked before anything is marked as sent, so switching a feature back on the same day still gets its reminders.
  if (!(await featureOn(g, 'notifications'))) return 0;
  const tasksOn = await featureOn(g, 'planner_tasks');
  const plannerOn = await featureOn(g, 'planner');
  const today = sydneyDate(0);
  const tomorrow = sydneyDate(1);
  const week = sydneyDate(7);
  // Votes closing tomorrow → people who haven't voted.
  // A combined vote card (077) is reminded once, to people who haven't answered every section.
  let { data: closing, error: closingErr }: { data: any[] | null; error: unknown } = await db.from('plan_polls').select('id,plan_id,question,vote_batch').eq('group_id', g).eq('status', 'open').eq('closes_on', tomorrow);
  if (closingErr) ({ data: closing } = await db.from('plan_polls').select('id,plan_id,question').eq('group_id', g).eq('status', 'open').eq('closes_on', tomorrow)); // before 077
  for (const grp of tasksOn ? reminderGroups((closing || []) as { id: string; plan_id: string; question: string; vote_batch?: string | null }[]) : []) {
    if (!grp.batch) {
      const p = grp.polls[0];
      if (!(await once(`poll-closing:${p.id}:${today}`))) continue;
      sent += await send(g, await openPollNonVoters(g, p.plan_id, p.id), { title: '⏰ Vote closes tomorrow', body: p.question, url: planUrl(p.plan_id, 'vote'), tag: `poll-${p.id}` }, null, 'poll_closing');
      // 079: one reminder email (at most) to people on email who haven't answered.
      await emailVoteReminders(db, APP, g, p.plan_id, p.id).catch(() => 0);
      continue;
    }
    if (!(await once(`batch-closing:${grp.batch}:${today}`))) continue;
    const { data: b } = await db.from('vote_batches').select('id,plan_id,title,keen').eq('id', grp.batch).eq('group_id', g).maybeSingle();
    if (!b) continue;
    // ov23 (092): the optional detail under an area doesn't count — select('*') so a database before 092 still works.
    const { data: all } = await db.from('plan_polls').select('*').eq('vote_batch', b.id).eq('status', 'open');
    const pollIds = (all || []).filter((x) => x.optional !== true).map((x) => x.id);
    const [{ data: votes }, { data: rs }, people] = await Promise.all([
      db.from('plan_votes').select('poll_id,player_id').in('poll_id', pollIds),
      db.from('plan_rsvps').select('player_id').eq('plan_id', b.plan_id),
      players(g),
    ]);
    const missing = batchNonVoters({ pollIds, votes: votes || [], rsvps: rs || [], keen: !!b.keen, playerIds: people.map((p) => p.id) });
    sent += await send(g, missing, { title: '⏰ Vote closes tomorrow', body: b.title, url: planUrl(b.plan_id, 'vote'), tag: `batch-${b.id}` }, null, 'poll_closing');
    // 079: the card's one reminder email (its polls ride along in the batch email).
    if (pollIds[0]) await emailVoteReminders(db, APP, g, b.plan_id, pollIds[0]).catch(() => 0);
  }
  // RSVP deadline tomorrow → people who haven't replied.
  const { data: dl } = await db.from('plans').select('*').eq('group_id', g).eq('rsvp_deadline', tomorrow).eq('rsvp_locked', false).eq('proposed', false).neq('status', 'cancelled');
  for (const pl of plannerOn ? dl || [] : []) {
    if (!(await once(`rsvp-deadline:${pl.id}:${today}`))) continue;
    const { data: rs } = await db.from('plan_rsvps').select('player_id').eq('plan_id', pl.id);
    const replied = new Set((rs || []).map((r) => r.player_id));
    const missing = (await players(g)).filter((p) => !replied.has(p.id)).map((p) => p.id);
    sent += await send(g, missing, { title: `🙋 Last day: are you in for ${pl.name}?`, body: 'Tap to say In, Maybe or Out.', url: planUrl(pl.id, 'people') }, null, 'rsvp_deadline');
  }
  // A week out and the day before → everyone who's in, each with their own message (ov25, the run-up):
  //   a week out — "3 things waiting for you", only to people with something waiting;
  //   the day before — "Your car: Josh's, pick-up Leichhardt 6:30am Fri · Room 3 with Hamish · tee time 9:12".
  for (const [day, label] of [[week, 'is a week away'], [tomorrow, 'is tomorrow']] as const) {
    const { data: soon } = await db.from('plans').select('*').eq('group_id', g).eq('start_date', day).neq('status', 'cancelled').eq('proposed', false);
    for (const pl of plannerOn ? soon || [] : []) {
      if (!(await once(`countdown:${pl.id}:${day}:${label}`))) continue;
      const { data: rs } = await db.from('plan_rsvps').select('player_id').eq('plan_id', pl.id).eq('status', 'in');
      const ins = (rs || []).map((r) => r.player_id);
      const kind = day === tomorrow ? 'trip_tomorrow' : 'trip_week';
      const each = await runUpFor(g, pl, ins, day === tomorrow).catch(() => null);
      if (!each) {
        // Before 094 (or anything missing): the old message to everyone.
        sent += await send(g, ins, { title: `⛳ ${pl.name} ${label}`, body: [pl.location_name, 'Check the details and what to bring.'].filter(Boolean).join(' · '), url: planUrl(pl.id, 'details') }, null, kind);
        continue;
      }
      for (const pid of ins) {
        const msg = day === tomorrow ? dayBeforeMessage(pl.name, pl.location_name, each.dayBefore(pid)) : weekOutMessage(pl.name, each.waiting(pid));
        if (!msg) continue; // a week out with nothing waiting: no message
        sent += await send(g, [pid], { title: msg.title, body: msg.body, url: `${APP}#/plan/${pl.id}?view=overview`, tag: `runup-${pl.id}-${pid}` }, null, kind);
      }
    }
  }
  // Jobs due tomorrow → their owner.
  const { data: jobs } = await db.from('plan_items').select('*').eq('group_id', g).eq('kind', 'job').eq('done', false).eq('due', tomorrow).not('owner_id', 'is', null);
  for (const j of tasksOn ? jobs || [] : []) {
    if (!(await once(`job-due:${j.id}:${today}`))) continue;
    sent += await send(g, [j.owner_id], { title: '📋 Job due tomorrow', body: j.title, url: planUrl(j.plan_id, 'jobs') }, null, 'job_due');
  }
  return sent;
}

/** ov28 (I11): the evening call (7pm Sydney in summer, 6pm in winter) — "Your tee time tomorrow: 7:52" to everyone
 *  with a tee time or playing group in a round tomorrow, with their lift if the trip's cars are sorted. Only when a
 *  time or group is set ("If selected"); once per person per round. */
async function evening() {
  let sent = 0;
  const tomorrow = sydneyDate(1);
  const { data: rounds } = await db.from('rounds').select('id,group_id,trip_id').eq('play_date', tomorrow).neq('status', 'locked');
  for (const r of rounds || []) {
    const g = r.group_id as string;
    if (!(await featureOn(g, 'notifications'))) continue;
    const bits = await roundBits(db, g, r.id).catch(() => null);
    if (!bits) continue;
    // The trip's cars (run-up, 094), when there's a plan for it.
    let car: (pid: string) => any = () => null;
    if (r.trip_id && (await featureOn(g, 'planner'))) {
      const { data: pl } = await db.from('plans').select('*').eq('group_id', g).eq('trip_id', r.trip_id).neq('status', 'cancelled').limit(1).maybeSingle();
      const each = pl ? await runUpFor(g, pl, [], false).catch(() => null) : null;
      if (each) car = (pid: string) => each.dayBefore(pid).car;
    }
    for (const { pid, msg } of teeTomorrowFor(bits, car)) {
      if (!(await once(`tee-tomorrow:${r.id}:${pid}`))) continue;
      sent += await send(g, [pid], { title: msg.title, body: msg.body, url: `${APP}#/trip-now/${r.trip_id}`, tag: `tee-${r.id}` }, null, 'tee_tomorrow');
    }
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    await loadKeys();
    const body = await req.json().catch(() => ({}));

    if (body.type === 'daily' || body.type === 'digest' || body.type === 'commentary' || body.type === 'evening' || body.type === 'auto_awards') {
      if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) return json({ error: 'Not allowed' }, 401);
      return json({ sent: body.type === 'daily' ? await daily() : body.type === 'commentary' ? await commentaryNow() : body.type === 'evening' ? await evening() : body.type === 'auto_awards' ? await autoAwardsNow() : await digest() });
    }

    // Everyone else must be a signed-in member of the group.
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u } = token ? await db.auth.getUser(token) : { data: null };
    if (!u?.user) return json({ error: 'Sign in first' }, 401);
    // Which group: the one the app names, if this person is in it; else their first group (old app).
    const { data: memberships } = await db.from('group_members').select('group_id,player_id,role,created_at').eq('user_id', u.user.id).order('created_at');
    const asked = typeof body.group_id === 'string' ? body.group_id : (req.headers.get('x-group-id') || '');
    const m = (memberships || []).find((x) => x.group_id === asked) || (memberships || [])[0];
    if (!m) return json({ error: 'Join the group first' }, 403);
    const g = m.group_id as string;
    const me = { player_id: m.player_id as string | null, is_admin: m.role === 'organiser' };
    const adminOnly = ['plan_new', 'trip_locked', 'rsvp_locked', 'nudge_votes', 'nudge_rsvp', 'nudge_kitty', 'groups_set', 'draw_open', 'deposit_ask', 'nudge_deposit', 'nudge_signin', 'draw_out'];
    if (adminOnly.includes(body.type) && !me.is_admin) return json({ error: 'Admin only' }, 403);
    const from = me.player_id as string | null;
    // Someone who hasn't picked their name yet can't send anything to others (only the test buzz to themselves).
    if (!from && !me.is_admin && body.type !== 'test') return json({ error: 'Pick your name first' }, 403);

    let sent = 0;
    let emailed = 0;
    let emailNote = '';
    /** 079: vote emails go with the same switches as vote notifications. */
    const votesOn = async () => (await featureOn(g, 'notifications')) && (await featureOn(g, 'planner_tasks'));
    switch (body.type) {
      case 'test':
        sent = await send(g, [from!], { title: '🔔 Notifications are on', body: 'You’ll get trip votes, reminders and jobs here.', url: `${APP}#/plan` }, null, 'test');
        break;
      case 'plan_new': {
        const pl = await plan(g, body.plan_id);
        sent = await send(g, 'all', { title: `🗓️ ${pl.name}`, body: `A new ${pl.kind === 'round' ? 'round' : 'trip'} is being planned — say if you’re in and have your say.`, url: planUrl(pl.id) }, from, 'plan_new');
        break;
      }
      case 'poll_open': {
        const p = await mine(g, 'plan_polls', body.poll_id);
        // The admin, or whoever opened this vote (a suggestion opens its own dates and place votes). Once per vote.
        if (!me.is_admin && p.created_by !== from) return json({ error: 'Not your vote' }, 403);
        if (p.vote_batch) {
          // A combined vote card (077): one notification for the whole card, however many sections it has.
          if (!(await once(`batch-open:${p.vote_batch}`))) break;
          const { data: b } = await db.from('vote_batches').select('id,plan_id,title,keen,closes_on').eq('id', p.vote_batch).eq('group_id', g).maybeSingle();
          if (!b) break;
          const { count } = await db.from('plan_polls').select('id', { count: 'exact', head: true }).eq('vote_batch', b.id);
          const pl = await plan(g, b.plan_id);
          const m = batchMessage({ title: b.title, planName: pl.name, sections: count || 1, keen: !!b.keen, closes: b.closes_on ? fmt(b.closes_on) : null });
          sent = await send(g, 'all', { ...m, url: planUrl(pl.id, 'vote'), tag: `batch-${b.id}` }, from, 'poll_open');
          // 079: one email for the whole card for people on email.
          if (await votesOn()) ({ emailed, note: emailNote } = await emailVoteOpen(db, APP, g, p, from));
          break;
        }
        if (!(await once(`poll-open:${p.id}`))) break;
        const pl = await plan(g, p.plan_id);
        sent = await send(g, 'all', { title: `🗳️ Vote: ${p.question}`, body: `${pl.name}${p.closes_on ? ` · closes ${fmt(p.closes_on)}` : ''}`, url: planUrl(pl.id, 'vote'), tag: `poll-${p.id}` }, from, 'poll_open');
        // 079: one email per batch for people on email (a combined vote card's other polls ride along).
        if (await votesOn()) ({ emailed, note: emailNote } = await emailVoteOpen(db, APP, g, p, from));
        break;
      }
      case 'poll_decided': {
        const p = await mine(g, 'plan_polls', body.poll_id);
        if (p.status !== 'closed') break;
        if (!me.is_admin) {
          // The trip's organiser may pick winners when the group allows it.
          const [{ data: gr }, pl0] = await Promise.all([db.from('groups').select('vote_decider').eq('id', g).single(), plan(g, p.plan_id)]);
          if (gr?.vote_decider !== 'admin_or_organiser' || !from || pl0.organiser_id !== from) return json({ error: 'Admin only' }, 403);
        }
        if (!(await once(`poll-decided:${p.id}`))) break;
        const { data: o } = p.winner_option_id ? await db.from('plan_options').select('label').eq('id', p.winner_option_id).eq('group_id', g).maybeSingle() : { data: null };
        const pl = await plan(g, p.plan_id);
        sent = await send(g, 'all', { title: `✅ ${pl.name}: ${o?.label || 'decided'}`, body: p.question, url: planUrl(pl.id), tag: `poll-${p.id}` }, from, 'poll_decided');
        break;
      }
      case 'trip_locked': {
        const pl = await plan(g, body.plan_id);
        if (pl.status !== 'confirmed' || !(await once(`trip-locked:${pl.id}`))) break;
        const when = pl.start_date ? `${fmt(pl.start_date)}${pl.end_date && pl.end_date !== pl.start_date ? ` – ${fmt(pl.end_date)}` : ''}` : '';
        sent = await send(g, 'all', { title: `🔒 ${pl.name} is locked in`, body: [when, pl.location_name, 'say if you’re in'].filter(Boolean).join(' · '), url: planUrl(pl.id, 'people') }, from, 'trip_locked');
        break;
      }
      case 'rsvp_locked': {
        const pl = await plan(g, body.plan_id);
        const { data: rs } = await db.from('plan_rsvps').select('player_id').eq('plan_id', pl.id).eq('status', 'in');
        const ppl = await players(g);
        const names = (rs || []).map((r) => name(ppl.find((p) => p.id === r.player_id))).join(', ');
        sent = await send(g, 'all', { title: `🔒 ${pl.name}: the list is locked`, body: `${(rs || []).length} in — ${names}`, url: planUrl(pl.id, 'people') }, from, 'rsvp_locked');
        break;
      }
      case 'nudge_votes': {
        const pl = await plan(g, body.plan_id);
        sent = await send(g, await openPollNonVoters(g, pl.id), { title: '🗳️ Still need your vote', body: pl.name, url: planUrl(pl.id, 'vote') }, from, 'nudge_votes');
        if (await votesOn()) emailed = await emailVoteReminders(db, APP, g, pl.id);
        break;
      }
      case 'nudge_rsvp': {
        const pl = await plan(g, body.plan_id);
        const { data: rs } = await db.from('plan_rsvps').select('player_id').eq('plan_id', pl.id);
        const replied = new Set((rs || []).map((r) => r.player_id));
        sent = await send(g, (await players(g)).filter((p) => !replied.has(p.id)).map((p) => p.id), { title: `🙋 Are you in for ${pl.name}?`, body: 'Tap to say In, Maybe or Out.', url: planUrl(pl.id, 'people') }, from, 'nudge_rsvp');
        break;
      }
      case 'nudge_signin': {
        // 22 Oct: an organiser's "Remind" — one player, to save their spot (sign in once). send() only reaches people
        // in this group, so a player id from another group sends nothing.
        if (typeof body.player_id !== 'string') return json({ error: 'Which player?' }, 400);
        sent = await send(g, [body.player_id], { title: '🔐 Save your spot', body: 'Sign in once so the app knows it’s you on any phone or laptop.', url: `${APP}#/group` }, from, 'nudge_signin');
        break;
      }
      case 'nudge_kitty': {
        const pl = await plan(g, body.plan_id);
        for (const o of await kittyOwing(pl.id)) {
          sent += await send(g, [o.pid], { title: `💰 ${pl.name}: you owe $${o.owes.toFixed(2).replace(/\.00$/, '')}`, body: pl.kitty_note || 'Tap to see your share.', url: planUrl(pl.id, 'kitty') }, from, 'nudge_kitty');
        }
        break;
      }
      case 'groups_set': {
        const pl = await plan(g, body.plan_id);
        const { data: rs } = await db.from('plan_rsvps').select('player_id').eq('plan_id', pl.id).eq('status', 'in');
        const label = body.kind === 'car' ? '🚗 Cars are sorted' : '🛏️ Rooms are set';
        sent = await send(g, (rs || []).map((r) => r.player_id), { title: `${label} — ${pl.name}`, body: 'Tap to see who you’re with.', url: planUrl(pl.id, 'groups') }, from, 'groups_set');
        break;
      }
      case 'job_assigned': {
        const j = await mine(g, 'plan_items', body.item_id);
        if (!j?.owner_id) break;
        // Only whoever made the job, whoever just handed it on (078: handed_by), or the admin can send this, once per job and owner.
        if (j.created_by !== from && j.handed_by !== from && !me.is_admin) return json({ error: 'Not your job' }, 403);
        if (!(await once(`job-assigned:${j.id}:${j.owner_id}`))) break;
        const pl = await plan(g, j.plan_id);
        const ppl = await players(g);
        sent = await send(g, [j.owner_id], { title: `📋 New job: ${j.title}`, body: `${pl.name} — from ${name(ppl.find((p) => p.id === from))}`, url: planUrl(pl.id, 'jobs') }, from, 'job_assigned');
        break;
      }
      // 078: the organiser asks everyone keen to confirm and pay the deposit (once per trip), and nudges who hasn't.
      case 'deposit_ask':
      case 'nudge_deposit': {
        const pl = await plan(g, body.plan_id);
        const dep = Number(pl.deposit_pp || 0);
        if (!dep || !pl.deposit_asked_at) break;
        if (body.type === 'deposit_ask' && !(await once(`deposit-ask:${pl.id}`))) break;
        if (body.type === 'nudge_deposit' && !(await once(`deposit-nudge:${pl.id}:${sydneyDate(0)}`))) break;
        const [{ data: rs }, { data: ts }] = await Promise.all([
          db.from('plan_rsvps').select('player_id,status').eq('plan_id', pl.id).in('status', ['in', 'maybe']),
          db.from('plan_transfers').select('from_id,amount').eq('plan_id', pl.id).is('to_id', null),
        ]);
        const paid = (pid: string) => (ts || []).filter((t) => t.from_id === pid).reduce((s, t) => s + Number(t.amount), 0);
        const owe = (rs || []).filter((r) => paid(r.player_id) < dep - 0.5).map((r) => r.player_id);
        const amt = `$${dep.toFixed(2).replace(/\.00$/, '')}`;
        sent = await send(g, owe, { title: body.type === 'deposit_ask' ? `🏠 ${pl.name}: accommodation’s booked` : `💳 ${pl.name}: deposit reminder`, body: `Confirm you’re in and pay your ${amt} deposit.`, url: planUrl(pl.id) }, from, body.type);
        break;
      }
      case 'plan_proposed': {
        const pl = await plan(g, body.plan_id);
        if (!pl?.proposed || (pl.created_by !== from && !me.is_admin)) return json({ error: 'Not your proposal' }, 403);
        if (!(await once(`plan-proposed:${pl.id}`))) break;
        // Everyone gets these, so at most 3 a day from one person.
        let room = false;
        for (let i = 1; i <= 3 && !room; i++) room = await once(`proposed-by:${g}:${from}:${sydneyDate(0)}:${i}`);
        if (!room) break;
        const ppl = await players(g);
        // Everyone can have their say on an idea straight away (dates and place votes open with it).
        const who = name(ppl.find((p) => p.id === from));
        const { count } = await db.from('plan_polls').select('id', { count: 'exact', head: true }).eq('plan_id', pl.id).eq('status', 'open');
        sent = await send(g, 'all', { title: `💡 ${who} has an idea: ${pl.name}`, body: count ? 'Vote on when and where, and say if you’d be in.' : 'Say if you’d be in.', url: planUrl(pl.id, count ? 'vote' : 'people') }, from, 'plan_proposed');
        break;
      }
      case 'rule_proposed': {
        const r = await mine(g, 'rules', body.rule_id);
        if (!r || r.status !== 'proposed' || (r.proposed_by !== from && !me.is_admin)) return json({ error: 'Not your rule' }, 403);
        if (!(await once(`rule-proposed:${r.id}`))) break;
        const ppl = await players(g);
        // The admin putting a rule up goes to everyone; a member's proposal goes to the admin first.
        const msg = { title: `📜 Rule up for a vote: ${r.title}`, body: r.value ? `${r.value} — have your say` : 'Have your say', url: `${APP}#/rules` };
        sent = me.is_admin ? await send(g, 'all', msg, from, 'rule_proposed') : await send(g, await admins(g), { ...msg, title: `📜 ${name(ppl.find((p) => p.id === from))} proposed a rule: ${r.title}` }, from, 'rule_proposed');
        break;
      }
      case 'rule_decided': {
        if (!me.is_admin) return json({ error: 'Admin only' }, 403);
        const r = await mine(g, 'rules', body.rule_id);
        if (!r || !['active', 'rejected', 'retired'].includes(r.status)) break;
        const verb = { active: '✅ New rule', rejected: '❌ Rule rejected', retired: '🗄️ Rule retired' }[r.status as 'active'];
        sent = await send(g, 'all', { title: `${verb}: ${r.title}`, body: r.decision_note || r.value || '', url: `${APP}#/rules` }, from, 'rule_decided');
        break;
      }
      case 'payment_recorded': {
        const t = await mine(g, 'plan_transfers', body.transfer_id);
        if (!t || t.created_by !== from || !t.to_id || t.to_id === from) break;
        if (!(await once(`payment:${t.id}`))) break;
        const pl = await plan(g, t.plan_id);
        const ppl = await players(g);
        sent = await send(g, [t.to_id], { title: `💸 ${name(ppl.find((p) => p.id === t.from_id))} says they paid you $${Number(t.amount).toFixed(2).replace(/\.00$/, '')}`, body: `${pl.name} — tap to confirm you got it.`, url: planUrl(pl.id, 'kitty') }, from, 'payment_recorded');
        break;
      }
      case 'comment_added': {
        const c = await mine(g, 'plan_comments', body.comment_id);
        if (c.player_id !== from) return json({ error: 'Not your comment' }, 403);
        if (!(await once(`comment:${c.id}`))) break;
        // One chat buzz per trip every 10 minutes; the rest are on the Chat tab.
        if (!(await once(`chat-buzz:${c.plan_id}:${Math.floor(Date.now() / 600000)}`))) break;
        const pl = await plan(g, c.plan_id);
        // Whoever's in or maybe, the organiser, and anyone already in the conversation.
        const [{ data: rs }, { data: earlier }, ppl] = await Promise.all([
          db.from('plan_rsvps').select('player_id').eq('plan_id', pl.id).in('status', ['in', 'maybe']),
          db.from('plan_comments').select('player_id').eq('plan_id', pl.id),
          players(g),
        ]);
        const to = [...(rs || []).map((r) => r.player_id), ...(earlier || []).map((r) => r.player_id), pl.organiser_id, pl.created_by].filter(Boolean);
        const text = String(c.body || '');
        sent = await send(g, to, { title: `💬 ${name(ppl.find((p) => p.id === from))} on ${pl.name}`, body: text.length > 120 ? `${text.slice(0, 117)}…` : text, url: planUrl(pl.id, 'chat'), tag: `chat-${pl.id}` }, from, 'comment');
        break;
      }
      case 'draw_out': {
        // ov28 (I8): "The draw is out" for any teams / pairs / Cup matches / playing groups: each player gets their own
        // line ("You & Bo v Kurt & Al, Thu 7:00am"). Once an hour per round at most (an organiser fiddling with groups
        // doesn't buzz everyone ten times).
        const bits = await roundBits(db, g, body.round_id);
        if (!bits) throw new NotYours();
        if (!(await once(`draw-out:${bits.round.id}:${Math.floor(Date.now() / 3600000)}`))) break;
        for (const { pid, msg } of drawOutFor(bits)) {
          sent += await send(g, [pid], { title: msg.title, body: msg.body, url: `${APP}#/trip-now/${bits.round.trip_id}`, tag: `draw-${bits.round.id}` }, null, 'draw_out');
        }
        break;
      }
      case 'swing': {
        // ov28 (I13): swing alerts. The app says WHAT was just scored (a Cup match's hole, or a player's hole); this
        // works out whether it's a swing and writes the words. Limits: the group's commentary buzz level (feed only =
        // none), once per match state / per mover per hole, and one swing buzz a person per 10 or 30 minutes.
        const gap = await swingGap(db, g);
        if (gap == null) break;
        const hole = Number(body.hole) || 0;
        const bucket = Math.floor(Date.now() / (gap * 60000));
        const room = async (pids: string[]) => {
          const ok: string[] = [];
          for (const pid of pids) if (await once(`swing-p:${pid}:${gap}:${bucket}`)) ok.push(pid);
          return ok;
        };
        if (body.match_id) {
          const s = await matchSwing(db, g, body.match_id, hole);
          if (!s || !(await once(`swing-m:${s.key}`))) break;
          sent = await send(g, await room(s.to.filter((p: string) => p !== from)), { title: '⚔️ The Cup', body: s.text, url: `${APP}#/cup/${body.match_id}`, tag: `swing-${body.match_id}` }, from, 'swing');
        } else if (body.round_id) {
          const mover = typeof body.player_id === 'string' ? body.player_id : from;
          const s = mover ? await pointsSwing(db, g, body.round_id, mover, hole) : null;
          if (!s || !(await once(`swing-pass:${body.round_id}:${mover}:${hole}`))) break;
          sent = await send(g, await room([mover!]), { title: '⛳ On the move', body: s.text, url: `${APP}#/?r=${body.round_id}`, tag: `swing-${body.round_id}` }, null, 'swing');
        }
        break;
      }
      case 'draw_open':
        sent = await send(g, 'all', { title: '🎲 The draw room is open', body: 'Open the app to watch it live.', url: APP }, from, 'draw_open');
        break;
      default:
        return json({ error: 'Unknown notification' }, 400);
    }
    return json(emailed || emailNote ? { sent, emailed, ...(emailNote ? { email_note: emailNote } : {}) } : { sent });
  } catch (e) {
    if (e instanceof NotYours) return json({ error: 'Not in your group' }, 403);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
