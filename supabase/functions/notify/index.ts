// notify — sends phone notifications (Web Push) for the L.G.C app.
//
// The app never sends message text: it says WHAT happened (e.g. "poll_open" + the poll id)
// and this function looks it up and writes the message itself, so nobody can spam
// the group with made-up notifications. Admin-only types are checked here.
// The daily reminders are triggered by the database scheduler with a secret header.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

const APP = 'https://joshm1357.github.io/lgc-golf/';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
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

/** Send to some players (or 'all'), skipping `except`. Cleans up phones that have unsubscribed. */
async function send(to: string[] | 'all', msg: Msg, except?: string | null) {
  let q = db.from('push_subscriptions').select('*');
  if (to !== 'all') {
    const ids = [...new Set(to)].filter((x) => x && x !== except);
    if (!ids.length) return 0;
    q = q.in('player_id', ids);
  }
  const { data: subs } = await q;
  let sent = 0;
  await Promise.all((subs || []).filter((s) => !except || s.player_id !== except).map(async (s) => {
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

async function players() {
  const { data } = await db.from('players').select('id,name,nickname,approved');
  return (data || []).filter((p) => p.approved !== false);
}
async function admins() {
  const { data } = await db.from('members').select('player_id').eq('is_admin', true);
  return (data || []).map((m) => m.player_id).filter(Boolean);
}
async function plan(id: string) {
  const { data } = await db.from('plans').select('*').eq('id', id).single();
  return data;
}
async function openPollNonVoters(planId: string, pollId?: string) {
  let pq = db.from('plan_polls').select('id').eq('plan_id', planId).eq('status', 'open');
  if (pollId) pq = pq.eq('id', pollId);
  const { data: polls } = await pq;
  const pollIds = (polls || []).map((p) => p.id);
  if (!pollIds.length) return [];
  const [{ data: opts }, { data: votes }, people] = await Promise.all([
    db.from('plan_options').select('id,poll_id').in('poll_id', pollIds),
    db.from('plan_votes').select('option_id,player_id').in('poll_id', pollIds),
    players(),
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
    db.from('plan_transfers').select('*').eq('plan_id', planId),
  ]);
  const inIds = (rsvps || []).map((r) => r.player_id);
  const transfers = tr || [];
  type Cost = { per_head: boolean; amount: number; paid_by: string | null; split_between: string[] | null };
  const group = (c: Cost) => (c.split_between && c.split_between.length ? c.split_between : inIds);
  const totalOf = (c: Cost) => (c.per_head ? Number(c.amount) * group(c).length : Number(c.amount));
  const shareOf = (c: Cost, pid: string) => (!group(c).includes(pid) ? 0 : c.per_head ? Number(c.amount) : Number(c.amount) / group(c).length);
  const ids = [...new Set([...inIds, ...(costs || []).flatMap((c: Cost) => c.split_between || [])])];
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

async function daily() {
  let sent = 0;
  const today = sydneyDate(0);
  const tomorrow = sydneyDate(1);
  const week = sydneyDate(7);
  // Votes closing tomorrow → people who haven't voted.
  const { data: closing } = await db.from('plan_polls').select('id,plan_id,question').eq('status', 'open').eq('closes_on', tomorrow);
  for (const p of closing || []) {
    if (!(await once(`poll-closing:${p.id}:${today}`))) continue;
    sent += await send(await openPollNonVoters(p.plan_id, p.id), { title: '⏰ Vote closes tomorrow', body: p.question, url: planUrl(p.plan_id, 'vote'), tag: `poll-${p.id}` });
  }
  // RSVP deadline tomorrow → people who haven't replied.
  const { data: dl } = await db.from('plans').select('*').eq('rsvp_deadline', tomorrow).eq('rsvp_locked', false);
  for (const pl of dl || []) {
    if (!(await once(`rsvp-deadline:${pl.id}:${today}`))) continue;
    const { data: rs } = await db.from('plan_rsvps').select('player_id').eq('plan_id', pl.id);
    const replied = new Set((rs || []).map((r) => r.player_id));
    const missing = (await players()).filter((p) => !replied.has(p.id)).map((p) => p.id);
    sent += await send(missing, { title: `🙋 Last day: are you in for ${pl.name}?`, body: 'Tap to say In, Maybe or Out.', url: planUrl(pl.id, 'people') });
  }
  // A week out and the day before → everyone who's in.
  for (const [day, label] of [[week, 'is a week away'], [tomorrow, 'is tomorrow']] as const) {
    const { data: soon } = await db.from('plans').select('*').eq('start_date', day).neq('status', 'cancelled');
    for (const pl of soon || []) {
      if (!(await once(`countdown:${pl.id}:${day}:${label}`))) continue;
      const { data: rs } = await db.from('plan_rsvps').select('player_id').eq('plan_id', pl.id).eq('status', 'in');
      sent += await send((rs || []).map((r) => r.player_id), { title: `⛳ ${pl.name} ${label}`, body: [pl.location_name, 'Check the details and what to bring.'].filter(Boolean).join(' · '), url: planUrl(pl.id, 'details') });
    }
  }
  // Jobs due tomorrow → their owner.
  const { data: jobs } = await db.from('plan_items').select('*').eq('kind', 'job').eq('done', false).eq('due', tomorrow).not('owner_id', 'is', null);
  for (const j of jobs || []) {
    if (!(await once(`job-due:${j.id}:${today}`))) continue;
    sent += await send([j.owner_id], { title: '📋 Job due tomorrow', body: j.title, url: planUrl(j.plan_id, 'jobs') });
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
    const { data: me } = await db.from('members').select('player_id,is_admin').eq('user_id', u.user.id).maybeSingle();
    if (!me) return json({ error: 'Join the group first' }, 403);
    const adminOnly = ['plan_new', 'poll_open', 'poll_decided', 'rsvp_locked', 'nudge_votes', 'nudge_rsvp', 'nudge_kitty', 'groups_set', 'draw_open'];
    if (adminOnly.includes(body.type) && !me.is_admin) return json({ error: 'Admin only' }, 403);
    const from = me.player_id as string | null;

    let sent = 0;
    switch (body.type) {
      case 'test':
        sent = await send([from!], { title: '🔔 Notifications are on', body: 'You’ll get trip votes, reminders and jobs here.', url: `${APP}#/plan` });
        break;
      case 'plan_new': {
        const pl = await plan(body.plan_id);
        sent = await send('all', { title: `🗓️ ${pl.name}`, body: `A new ${pl.kind === 'round' ? 'round' : 'trip'} is being planned — say if you’re in and have your say.`, url: planUrl(pl.id) }, from);
        break;
      }
      case 'poll_open': {
        const { data: p } = await db.from('plan_polls').select('*, plan_options(id)').eq('id', body.poll_id).single();
        const pl = await plan(p.plan_id);
        sent = await send('all', { title: `🗳️ Vote: ${p.question}`, body: `${pl.name}${p.closes_on ? ` · closes ${fmt(p.closes_on)}` : ''}`, url: planUrl(pl.id, 'vote'), tag: `poll-${p.id}` }, from);
        break;
      }
      case 'poll_decided': {
        const { data: p } = await db.from('plan_polls').select('*').eq('id', body.poll_id).single();
        const { data: o } = p.winner_option_id ? await db.from('plan_options').select('label').eq('id', p.winner_option_id).single() : { data: null };
        const pl = await plan(p.plan_id);
        sent = await send('all', { title: `✅ ${pl.name}: ${o?.label || 'decided'}`, body: p.question, url: planUrl(pl.id), tag: `poll-${p.id}` }, from);
        break;
      }
      case 'rsvp_locked': {
        const pl = await plan(body.plan_id);
        const { data: rs } = await db.from('plan_rsvps').select('player_id').eq('plan_id', pl.id).eq('status', 'in');
        const ppl = await players();
        const names = (rs || []).map((r) => name(ppl.find((p) => p.id === r.player_id))).join(', ');
        sent = await send('all', { title: `🔒 ${pl.name}: the list is locked`, body: `${(rs || []).length} in — ${names}`, url: planUrl(pl.id, 'people') }, from);
        break;
      }
      case 'nudge_votes': {
        const pl = await plan(body.plan_id);
        sent = await send(await openPollNonVoters(pl.id), { title: '🗳️ Still need your vote', body: pl.name, url: planUrl(pl.id, 'vote') }, from);
        break;
      }
      case 'nudge_rsvp': {
        const pl = await plan(body.plan_id);
        const { data: rs } = await db.from('plan_rsvps').select('player_id').eq('plan_id', pl.id);
        const replied = new Set((rs || []).map((r) => r.player_id));
        sent = await send((await players()).filter((p) => !replied.has(p.id)).map((p) => p.id), { title: `🙋 Are you in for ${pl.name}?`, body: 'Tap to say In, Maybe or Out.', url: planUrl(pl.id, 'people') }, from);
        break;
      }
      case 'nudge_kitty': {
        const pl = await plan(body.plan_id);
        for (const o of await kittyOwing(pl.id)) {
          sent += await send([o.pid], { title: `💰 ${pl.name}: you owe $${o.owes.toFixed(2).replace(/\.00$/, '')}`, body: pl.kitty_note || 'Tap to see your share.', url: planUrl(pl.id, 'kitty') }, from);
        }
        break;
      }
      case 'groups_set': {
        const pl = await plan(body.plan_id);
        const { data: rs } = await db.from('plan_rsvps').select('player_id').eq('plan_id', pl.id).eq('status', 'in');
        const label = body.kind === 'car' ? '🚗 Cars are sorted' : '🛏️ Rooms are set';
        sent = await send((rs || []).map((r) => r.player_id), { title: `${label} — ${pl.name}`, body: 'Tap to see who you’re with.', url: planUrl(pl.id, 'groups') }, from);
        break;
      }
      case 'job_assigned': {
        const { data: j } = await db.from('plan_items').select('*').eq('id', body.item_id).single();
        if (!j?.owner_id) break;
        // Only whoever made the job (or the admin) can send this, and only once per job and owner.
        if (j.created_by !== from && !me.is_admin) return json({ error: 'Not your job' }, 403);
        if (!(await once(`job-assigned:${j.id}:${j.owner_id}`))) break;
        const pl = await plan(j.plan_id);
        const ppl = await players();
        sent = await send([j.owner_id], { title: `📋 New job: ${j.title}`, body: `${pl.name} — from ${name(ppl.find((p) => p.id === from))}`, url: planUrl(pl.id, 'jobs') }, from);
        break;
      }
      case 'plan_proposed': {
        const pl = await plan(body.plan_id);
        if (!pl?.proposed || (pl.created_by !== from && !me.is_admin)) return json({ error: 'Not your proposal' }, 403);
        if (!(await once(`plan-proposed:${pl.id}`))) break;
        const ppl = await players();
        sent = await send(await admins(), { title: `💡 ${name(ppl.find((p) => p.id === from))} proposed: ${pl.name}`, body: 'Approve it to start planning, or decline.', url: planUrl(pl.id) }, from);
        break;
      }
      case 'rule_proposed': {
        const { data: r } = await db.from('rules').select('*').eq('id', body.rule_id).single();
        if (!r || r.status !== 'proposed' || (r.proposed_by !== from && !me.is_admin)) return json({ error: 'Not your rule' }, 403);
        if (!(await once(`rule-proposed:${r.id}`))) break;
        const ppl = await players();
        // The admin putting a rule up goes to everyone; a member's proposal goes to the admin first.
        const msg = { title: `📜 Rule up for a vote: ${r.title}`, body: r.value ? `${r.value} — have your say` : 'Have your say', url: `${APP}#/rules` };
        sent = me.is_admin ? await send('all', msg, from) : await send(await admins(), { ...msg, title: `📜 ${name(ppl.find((p) => p.id === from))} proposed a rule: ${r.title}` }, from);
        break;
      }
      case 'rule_decided': {
        if (!me.is_admin) return json({ error: 'Admin only' }, 403);
        const { data: r } = await db.from('rules').select('*').eq('id', body.rule_id).single();
        if (!r || !['active', 'rejected', 'retired'].includes(r.status)) break;
        const verb = { active: '✅ New rule', rejected: '❌ Rule rejected', retired: '🗄️ Rule retired' }[r.status as 'active'];
        sent = await send('all', { title: `${verb}: ${r.title}`, body: r.decision_note || r.value || '', url: `${APP}#/rules` }, from);
        break;
      }
      case 'payment_recorded': {
        const { data: t } = await db.from('plan_transfers').select('*').eq('id', body.transfer_id).single();
        if (!t || t.created_by !== from || !t.to_id || t.to_id === from) break;
        if (!(await once(`payment:${t.id}`))) break;
        const pl = await plan(t.plan_id);
        const ppl = await players();
        sent = await send([t.to_id], { title: `💸 ${name(ppl.find((p) => p.id === t.from_id))} says they paid you $${Number(t.amount).toFixed(2).replace(/\.00$/, '')}`, body: `${pl.name} — tap to confirm you got it.`, url: planUrl(pl.id, 'kitty') }, from);
        break;
      }
      case 'draw_open':
        sent = await send('all', { title: '🎲 The draw room is open', body: 'Open the app to watch it live.', url: APP }, from);
        break;
      default:
        return json({ error: 'Unknown notification' }, 400);
    }
    return json({ sent });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
