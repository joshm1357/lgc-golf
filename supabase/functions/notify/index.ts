// notify — sends phone notifications (Web Push) for The Golf Trip.
//
// The app never sends message text: it says WHAT happened (e.g. "poll_open" + the poll id)
// and this function looks it up and writes the message itself, so nobody can spam
// the group with made-up notifications. Organiser-only types are checked here.
// Groups: every request works inside ONE group — the group the app names (if the person is in it)
// or else their first group. Every id in the request must belong to that group, and messages only
// go to phones of people in that group. The daily reminders run group by group.
// The daily reminders are triggered by the database scheduler with a secret header.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

const APP = 'https://joshm1357.github.io/lgc-golf/';
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

/** Send to some players of group `g` (or 'all' of them), skipping player `except`.
 *  Phones are found through who is in the group, so nothing ever reaches another group.
 *  Cleans up phones that have unsubscribed. */
async function send(g: string, to: string[] | 'all', msg: Msg, except?: string | null) {
  let mq = db.from('group_members').select('user_id,player_id').eq('group_id', g);
  if (to !== 'all') {
    const ids = [...new Set(to)].filter((x) => x && x !== except);
    if (!ids.length) return 0;
    mq = mq.in('player_id', ids);
  }
  const { data: people } = await mq;
  const users = [...new Set((people || []).filter((m) => !except || m.player_id !== except).map((m) => m.user_id))];
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
  let pq = db.from('plan_polls').select('id').eq('plan_id', planId).eq('status', 'open');
  if (pollId) pq = pq.eq('id', pollId);
  const { data: polls } = await pq;
  const pollIds = (polls || []).map((p) => p.id);
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
  const today = sydneyDate(0);
  const tomorrow = sydneyDate(1);
  const week = sydneyDate(7);
  // Votes closing tomorrow → people who haven't voted.
  const { data: closing } = await db.from('plan_polls').select('id,plan_id,question').eq('group_id', g).eq('status', 'open').eq('closes_on', tomorrow);
  for (const p of closing || []) {
    if (!(await once(`poll-closing:${p.id}:${today}`))) continue;
    sent += await send(g, await openPollNonVoters(g, p.plan_id, p.id), { title: '⏰ Vote closes tomorrow', body: p.question, url: planUrl(p.plan_id, 'vote'), tag: `poll-${p.id}` });
  }
  // RSVP deadline tomorrow → people who haven't replied.
  const { data: dl } = await db.from('plans').select('*').eq('group_id', g).eq('rsvp_deadline', tomorrow).eq('rsvp_locked', false).eq('proposed', false).neq('status', 'cancelled');
  for (const pl of dl || []) {
    if (!(await once(`rsvp-deadline:${pl.id}:${today}`))) continue;
    const { data: rs } = await db.from('plan_rsvps').select('player_id').eq('plan_id', pl.id);
    const replied = new Set((rs || []).map((r) => r.player_id));
    const missing = (await players(g)).filter((p) => !replied.has(p.id)).map((p) => p.id);
    sent += await send(g, missing, { title: `🙋 Last day: are you in for ${pl.name}?`, body: 'Tap to say In, Maybe or Out.', url: planUrl(pl.id, 'people') });
  }
  // A week out and the day before → everyone who's in.
  for (const [day, label] of [[week, 'is a week away'], [tomorrow, 'is tomorrow']] as const) {
    const { data: soon } = await db.from('plans').select('*').eq('group_id', g).eq('start_date', day).neq('status', 'cancelled').eq('proposed', false);
    for (const pl of soon || []) {
      if (!(await once(`countdown:${pl.id}:${day}:${label}`))) continue;
      const { data: rs } = await db.from('plan_rsvps').select('player_id').eq('plan_id', pl.id).eq('status', 'in');
      sent += await send(g, (rs || []).map((r) => r.player_id), { title: `⛳ ${pl.name} ${label}`, body: [pl.location_name, 'Check the details and what to bring.'].filter(Boolean).join(' · '), url: planUrl(pl.id, 'details') });
    }
  }
  // Jobs due tomorrow → their owner.
  const { data: jobs } = await db.from('plan_items').select('*').eq('group_id', g).eq('kind', 'job').eq('done', false).eq('due', tomorrow).not('owner_id', 'is', null);
  for (const j of jobs || []) {
    if (!(await once(`job-due:${j.id}:${today}`))) continue;
    sent += await send(g, [j.owner_id], { title: '📋 Job due tomorrow', body: j.title, url: planUrl(j.plan_id, 'jobs') });
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    await loadKeys();
    const body = await req.json().catch(() => ({}));

    if (body.type === 'daily') {
      if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) return json({ error: 'Not allowed' }, 401);
      return json({ sent: await daily() });
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
    const adminOnly = ['plan_new', 'poll_open', 'poll_decided', 'rsvp_locked', 'nudge_votes', 'nudge_rsvp', 'nudge_kitty', 'groups_set', 'draw_open'];
    if (adminOnly.includes(body.type) && !me.is_admin) return json({ error: 'Admin only' }, 403);
    const from = me.player_id as string | null;

    let sent = 0;
    switch (body.type) {
      case 'test':
        sent = await send(g, [from!], { title: '🔔 Notifications are on', body: 'You’ll get trip votes, reminders and jobs here.', url: `${APP}#/plan` });
        break;
      case 'plan_new': {
        const pl = await plan(g, body.plan_id);
        sent = await send(g, 'all', { title: `🗓️ ${pl.name}`, body: `A new ${pl.kind === 'round' ? 'round' : 'trip'} is being planned — say if you’re in and have your say.`, url: planUrl(pl.id) }, from);
        break;
      }
      case 'poll_open': {
        const p = await mine(g, 'plan_polls', body.poll_id);
        const pl = await plan(g, p.plan_id);
        sent = await send(g, 'all', { title: `🗳️ Vote: ${p.question}`, body: `${pl.name}${p.closes_on ? ` · closes ${fmt(p.closes_on)}` : ''}`, url: planUrl(pl.id, 'vote'), tag: `poll-${p.id}` }, from);
        break;
      }
      case 'poll_decided': {
        const p = await mine(g, 'plan_polls', body.poll_id);
        const { data: o } = p.winner_option_id ? await db.from('plan_options').select('label').eq('id', p.winner_option_id).single() : { data: null };
        const pl = await plan(g, p.plan_id);
        sent = await send(g, 'all', { title: `✅ ${pl.name}: ${o?.label || 'decided'}`, body: p.question, url: planUrl(pl.id), tag: `poll-${p.id}` }, from);
        break;
      }
      case 'rsvp_locked': {
        const pl = await plan(g, body.plan_id);
        const { data: rs } = await db.from('plan_rsvps').select('player_id').eq('plan_id', pl.id).eq('status', 'in');
        const ppl = await players(g);
        const names = (rs || []).map((r) => name(ppl.find((p) => p.id === r.player_id))).join(', ');
        sent = await send(g, 'all', { title: `🔒 ${pl.name}: the list is locked`, body: `${(rs || []).length} in — ${names}`, url: planUrl(pl.id, 'people') }, from);
        break;
      }
      case 'nudge_votes': {
        const pl = await plan(g, body.plan_id);
        sent = await send(g, await openPollNonVoters(g, pl.id), { title: '🗳️ Still need your vote', body: pl.name, url: planUrl(pl.id, 'vote') }, from);
        break;
      }
      case 'nudge_rsvp': {
        const pl = await plan(g, body.plan_id);
        const { data: rs } = await db.from('plan_rsvps').select('player_id').eq('plan_id', pl.id);
        const replied = new Set((rs || []).map((r) => r.player_id));
        sent = await send(g, (await players(g)).filter((p) => !replied.has(p.id)).map((p) => p.id), { title: `🙋 Are you in for ${pl.name}?`, body: 'Tap to say In, Maybe or Out.', url: planUrl(pl.id, 'people') }, from);
        break;
      }
      case 'nudge_kitty': {
        const pl = await plan(g, body.plan_id);
        for (const o of await kittyOwing(pl.id)) {
          sent += await send(g, [o.pid], { title: `💰 ${pl.name}: you owe $${o.owes.toFixed(2).replace(/\.00$/, '')}`, body: pl.kitty_note || 'Tap to see your share.', url: planUrl(pl.id, 'kitty') }, from);
        }
        break;
      }
      case 'groups_set': {
        const pl = await plan(g, body.plan_id);
        const { data: rs } = await db.from('plan_rsvps').select('player_id').eq('plan_id', pl.id).eq('status', 'in');
        const label = body.kind === 'car' ? '🚗 Cars are sorted' : '🛏️ Rooms are set';
        sent = await send(g, (rs || []).map((r) => r.player_id), { title: `${label} — ${pl.name}`, body: 'Tap to see who you’re with.', url: planUrl(pl.id, 'groups') }, from);
        break;
      }
      case 'job_assigned': {
        const j = await mine(g, 'plan_items', body.item_id);
        if (!j?.owner_id) break;
        // Only whoever made the job (or the admin) can send this, and only once per job and owner.
        if (j.created_by !== from && !me.is_admin) return json({ error: 'Not your job' }, 403);
        if (!(await once(`job-assigned:${j.id}:${j.owner_id}`))) break;
        const pl = await plan(g, j.plan_id);
        const ppl = await players(g);
        sent = await send(g, [j.owner_id], { title: `📋 New job: ${j.title}`, body: `${pl.name} — from ${name(ppl.find((p) => p.id === from))}`, url: planUrl(pl.id, 'jobs') }, from);
        break;
      }
      case 'plan_proposed': {
        const pl = await plan(g, body.plan_id);
        if (!pl?.proposed || (pl.created_by !== from && !me.is_admin)) return json({ error: 'Not your proposal' }, 403);
        if (!(await once(`plan-proposed:${pl.id}`))) break;
        const ppl = await players(g);
        sent = await send(g, await admins(g), { title: `💡 ${name(ppl.find((p) => p.id === from))} proposed: ${pl.name}`, body: 'Approve it to start planning, or decline.', url: planUrl(pl.id) }, from);
        break;
      }
      case 'rule_proposed': {
        const r = await mine(g, 'rules', body.rule_id);
        if (!r || r.status !== 'proposed' || (r.proposed_by !== from && !me.is_admin)) return json({ error: 'Not your rule' }, 403);
        if (!(await once(`rule-proposed:${r.id}`))) break;
        const ppl = await players(g);
        // The admin putting a rule up goes to everyone; a member's proposal goes to the admin first.
        const msg = { title: `📜 Rule up for a vote: ${r.title}`, body: r.value ? `${r.value} — have your say` : 'Have your say', url: `${APP}#/rules` };
        sent = me.is_admin ? await send(g, 'all', msg, from) : await send(g, await admins(g), { ...msg, title: `📜 ${name(ppl.find((p) => p.id === from))} proposed a rule: ${r.title}` }, from);
        break;
      }
      case 'rule_decided': {
        if (!me.is_admin) return json({ error: 'Admin only' }, 403);
        const r = await mine(g, 'rules', body.rule_id);
        if (!r || !['active', 'rejected', 'retired'].includes(r.status)) break;
        const verb = { active: '✅ New rule', rejected: '❌ Rule rejected', retired: '🗄️ Rule retired' }[r.status as 'active'];
        sent = await send(g, 'all', { title: `${verb}: ${r.title}`, body: r.decision_note || r.value || '', url: `${APP}#/rules` }, from);
        break;
      }
      case 'payment_recorded': {
        const t = await mine(g, 'plan_transfers', body.transfer_id);
        if (!t || t.created_by !== from || !t.to_id || t.to_id === from) break;
        if (!(await once(`payment:${t.id}`))) break;
        const pl = await plan(g, t.plan_id);
        const ppl = await players(g);
        sent = await send(g, [t.to_id], { title: `💸 ${name(ppl.find((p) => p.id === t.from_id))} says they paid you $${Number(t.amount).toFixed(2).replace(/\.00$/, '')}`, body: `${pl.name} — tap to confirm you got it.`, url: planUrl(pl.id, 'kitty') }, from);
        break;
      }
      case 'draw_open':
        sent = await send(g, 'all', { title: '🎲 The draw room is open', body: 'Open the app to watch it live.', url: APP }, from);
        break;
      default:
        return json({ error: 'Unknown notification' }, 400);
    }
    return json({ sent });
  } catch (e) {
    if (e instanceof NotYours) return json({ error: 'Not in your group' }, 403);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
