// Votes by email (079) — phone-width browser check of the built app against a fake database.
// No real database or email: every request to Supabase (tables, RPCs, the notify and vote-link functions) is answered
// here. The fake notify function decides who gets an email vs an app notification with the same shared rules the
// real one uses (supabase/functions/_shared/emailvotes.js), one email per batch.
// Usage: node tests/e2e/email-votes-test.mjs <baseUrl> <shotDir>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import { planVoteSends, batchKeyOf } from '../../supabase/functions/_shared/emailvotes.js';

const BASE = process.argv[2] || 'http://localhost:4391/lgc-golf/';
const SHOTS = process.argv[3] || './shots';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000a';
const P1 = '11111111-1111-4111-8111-111111111111'; // Josh — organiser, this phone
const P2 = '22222222-2222-4222-8222-222222222222'; // Mike — on the app, switches to email only
const P3 = '33333333-3333-4333-8333-333333333333'; // Adam — on the app, no email
const P4 = '44444444-4444-4444-8444-444444444444'; // Hamish — not on the app yet
const U1 = '99999999-9999-4999-8999-999999999999';
const U2 = '88888888-8888-4888-8888-888888888888';
const U3 = '77777777-7777-4777-8777-777777777777';
const PLAN = 'eeeeeeee-0000-4000-8000-000000000001';
const POLL1 = 'abababab-0000-4000-8000-000000000001';
const O1 = 'a1000000-0000-4000-8000-000000000001';
const O2 = 'a1000000-0000-4000-8000-000000000002';
const TOKEN = 'cccccccc-0000-4000-8000-000000000001.Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDEFG';
const CLOSED_TOKEN = 'cccccccc-0000-4000-8000-000000000002.Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDEFG';
const now = new Date().toISOString();

const db = {
  players: [
    { id: P1, name: 'Josh M', nickname: 'Josh', handicap: 14, approved: true, created_at: now },
    { id: P2, name: 'Mike Morris', nickname: 'Mike', handicap: 18, approved: true, created_at: now },
    { id: P3, name: 'Adam H', nickname: 'Adam', handicap: 22, approved: true, created_at: now },
    { id: P4, name: 'Hamish C', nickname: 'Hamish', handicap: 20, approved: true, created_at: now },
  ],
  group_members: [
    { user_id: U1, player_id: P1, role: 'organiser', created_at: now },
    { user_id: U2, player_id: P2, role: 'player', created_at: now },
    { user_id: U3, player_id: P3, role: 'player', created_at: now },
  ],
  groups: [{ id: GROUP, vote_decider: 'admin', vote_channel: 'app' }],
  notify_prefs: [],
  vote_emails: [],
  trips: [], trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [], courses: [], rounds: [], round_players: [], scores: [],
  plans: [{ id: PLAN, kind: 'trip', name: 'Hunter 2027', status: 'planning', proposed: false, rsvp_locked: false, created_by: P1, organiser_id: P1, created_at: now }],
  plan_polls: [{ id: POLL1, plan_id: PLAN, kind: 'other', question: 'Shirt colour?', status: 'open', created_by: P1, created_at: now }],
  plan_options: [
    { id: O1, poll_id: POLL1, label: 'Pink', created_by: P1, created_at: now },
    { id: O2, poll_id: POLL1, label: 'Navy', created_by: P1, created_at: now },
  ],
  // Adam answered in the app; Hamish (not on the app) answered by email.
  plan_votes: [
    { option_id: O1, poll_id: POLL1, player_id: P3, response: 'yes', via: 'app', updated_at: now },
    { option_id: O1, poll_id: POLL1, player_id: P4, response: 'no', via: 'email', updated_at: now },
    { option_id: O2, poll_id: POLL1, player_id: P4, response: 'yes', via: 'email', updated_at: now },
  ],
  plan_rsvps: [], plan_items: [], plan_costs: [], plan_payments: [], plan_transfers: [], plan_comments: [], plan_groups: [], plan_group_members: [],
  posts: [], rules: [], tribunal_cases: [], tribunal_votes: [], group_features: [],
};

let me = { user: U1, player: P1, admin: true };
const writes = [];
const notifyCalls = [];
const emailsSent = new Set(); // "<batch>|<player>" — one email per batch per person
const queued = [];

const prefOf = (u) => db.notify_prefs.find((p) => p.user_id === u);
function channels() {
  const def = db.groups[0].vote_channel;
  return db.players.map((p) => {
    const m = db.group_members.find((x) => x.player_id === p.id);
    const e = db.vote_emails.find((x) => x.player_id === p.id && x.email);
    return { player_id: p.id, on_app: !!m, choice: m ? prefOf(m.user_id)?.vote_channel || def : null, has_email: !!e, source: e?.source || null, email_hint: e?.source === 'invited' ? `${e.email[0]}…${e.email.slice(e.email.indexOf('@'))}` : null };
  });
}

function filterRows(rows, params) {
  return rows.filter((r) => {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
      if (k === 'group_id' && r.group_id === undefined) continue;
      if (k === 'id' && r.id === undefined) continue;
      if (v.startsWith('eq.')) { if (String(r[k]) !== v.slice(3)) return false; }
      else if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')); if (!set.includes(String(r[k]))) return false; }
    }
    return true;
  });
}

async function fakeSupabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return json({});
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const path = url.pathname;
  if (path.startsWith('/rest/v1/rpc/my_status')) return json({ is_member: true, is_admin: me.admin, player_id: me.player, group_name: 'L.G.C', group_id: GROUP, role: me.admin ? 'organiser' : 'player', groups: [{ id: GROUP, name: 'L.G.C', slug: 'lgc', role: me.admin ? 'organiser' : 'player' }] });
  if (path.startsWith('/rest/v1/rpc/')) {
    const fn = path.split('/').pop();
    writes.push({ method: 'RPC', table: fn, body });
    if (fn === 'vote_channels') return me.admin ? json(channels()) : json({ message: 'Only an organiser can see that' }, 400);
    if (fn === 'set_vote_channel') { db.groups[0].vote_channel = body.p_value; return json(null); }
    if (fn === 'set_invited_vote_email') {
      db.vote_emails = db.vote_emails.filter((e) => e.player_id !== body.p_player);
      if (body.p_email) db.vote_emails.push({ player_id: body.p_player, user_id: null, email: body.p_email, source: 'invited' });
      return json(null);
    }
    if (fn === 'set_my_vote_email') {
      db.vote_emails = db.vote_emails.filter((e) => e.player_id !== me.player);
      if (body.p_email) db.vote_emails.push({ player_id: me.player, user_id: me.user, email: body.p_email, source: 'own' });
      return json(null);
    }
    if (fn === 'my_vote_email') {
      const e = db.vote_emails.find((x) => x.player_id === me.player && x.email);
      return json([{ email: e?.email || null, source: e?.source || null, signin_email: null, vote_channel: prefOf(me.user)?.vote_channel || null, group_default: db.groups[0].vote_channel }]);
    }
    return json(null);
  }
  if (path.startsWith('/functions/v1/notify')) {
    notifyCalls.push(body);
    if (body.type === 'poll_open') {
      const poll = db.plan_polls.find((p) => p.id === body.poll_id);
      const r = planVoteSends({ players: db.players, members: db.group_members, prefs: db.notify_prefs, groupDefault: db.groups[0].vote_channel, emails: db.vote_emails, except: me.player });
      let emailed = 0;
      for (const e of r.email) {
        const k = `${batchKeyOf(poll)}|${e.player_id}`;
        if (emailsSent.has(k)) continue;
        emailsSent.add(k); queued.push({ to: e.email, poll: poll.id }); emailed++;
      }
      return json({ sent: r.push.length, emailed, push: r.push });
    }
    return json({ sent: 0 });
  }
  if (path.startsWith('/functions/v1/vote-link')) {
    const view = (closed, recorded) => ({
      ok: !closed, closed, recorded, name: 'Mike', plan: { id: PLAN, name: 'Hunter 2027' },
      polls: [{ id: POLL1, question: 'Shirt colour?', kind: 'other', open: !closed, options: [{ id: O1, label: 'Pink' }, { id: O2, label: 'Navy' }],
        mine: Object.fromEntries(db.plan_votes.filter((v) => v.player_id === P2).map((v) => [v.option_id, v.response])) }],
      rsvp: { asked: false, mine: null },
    });
    if (String(body.t).startsWith('cccccccc-0000-4000-8000-000000000002')) return json({ ...view(true, null), error: 'This vote has closed.' }, 410);
    if (body.o) {
      db.plan_votes = db.plan_votes.filter((v) => !(v.option_id === body.o && v.player_id === P2));
      db.plan_votes.push({ option_id: body.o, poll_id: POLL1, player_id: P2, response: body.r, via: 'email', updated_at: now });
      const label = body.o === O1 ? 'Pink' : 'Navy';
      return json(view(false, { kind: 'vote', poll: POLL1, option: body.o, label, response: body.r }));
    }
    return json(view(false, null));
  }
  if (path.startsWith('/rest/v1/')) {
    const table = path.split('/')[3];
    const rows = filterRows(db[table] || [], url.searchParams);
    const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    if (method === 'GET') return json(single ? rows[0] || null : rows);
    writes.push({ method, table, query: url.search, body });
    if (method === 'POST') {
      const list = (Array.isArray(body) ? body : [body]).map((b) => ({ id: b.id || `new-${writes.length}`, created_at: now, ...b }));
      if (table === 'notify_prefs') {
        for (const b of list) { db.notify_prefs = db.notify_prefs.filter((p) => p.user_id !== me.user); db.notify_prefs.push({ ...b, user_id: me.user }); }
      } else if (db[table]) db[table].push(...list);
      return json(single ? list[0] : list, 201);
    }
    return json(single ? rows[0] || null : rows);
  }
  return json({});
}

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route('https://luogyzvrbedmicjejilr.supabase.co/**', fakeSupabase);
await ctx.addInitScript(([uid]) => {
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.x`;
  if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated', is_anonymous: true } }));
  try { localStorage.setItem('tgt-notify-prompt', String(Date.now())); localStorage.setItem('tgt-whats-new', 'beta-1'); } catch {}
}, [U1]);
const page = await ctx.newPage();
page.on('dialog', (d) => d.accept());
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const noSideScroll = async (label) => {
  const w = await page.evaluate(() => document.scrollingElement.scrollWidth);
  check(w <= 375, `${label}: no sideways scroll (${w}px)`);
};
const rpc = (name) => writes.filter((w) => w.method === 'RPC' && w.table === name);

// 1. Organiser: group default → Both, and an email for Hamish (not on the app yet).
await page.goto(`${BASE}#/group`);
const card = page.getByTestId('group-vote-email');
await card.waitFor({ timeout: 15000 });
await card.scrollIntoViewIfNeeded();
await card.locator('[data-channel="both"]').click();
await page.waitForTimeout(400);
check(rpc('set_vote_channel').some((w) => w.body.p_value === 'both' && w.body.p_group === GROUP), 'organiser sets the group default to Both');
check(await card.locator('[data-channel="both"]').getAttribute('aria-pressed') === 'true', 'Both shows as the group default');
// ov15: an email for someone not on the app is added from their card in the players list (no addresses on show).
await page.getByTestId('players-list').getByRole('button', { name: /Hamish/ }).first().click();
const pcard = page.getByTestId('player-card');
await pcard.getByRole('button', { name: 'Add an email' }).click();
await pcard.getByLabel("Hamish's email").fill('hamish@example.com');
await pcard.getByRole('button', { name: 'Save' }).click();
await page.waitForTimeout(600);
check(rpc('set_invited_vote_email').some((w) => w.body.p_player === P4 && w.body.p_email === 'hamish@example.com'), 'organiser adds an email for a player not on the app');
check(!(await page.locator('.page').innerText()).includes('@example.com'), 'no email address shown anywhere on Players & group');
check(/\d+ on email/.test(await page.getByTestId('channel-summary').innerText()) && !(await page.getByTestId('channel-summary').innerText()).includes('Hamish'), 'summary gives counts, not names');
await card.screenshot({ path: `${SHOTS}/ev1-group-default.png` });
await noSideScroll('Players & group');

// 2. Mike (a player) adds his email and switches to email only.
me = { user: U2, player: P2, admin: false };
await page.goto(`${BASE}#/notifications`);
await page.reload();
const mine = page.getByTestId('vote-channel-card');
await mine.waitFor({ timeout: 15000 });
await mine.scrollIntoViewIfNeeded();
check((await mine.innerText()).includes('your group’s choice'), 'player sees which option is the group’s choice');
await mine.getByLabel('Your email for trip votes').fill('Mike@Example.com');
await mine.getByRole('button', { name: 'Save' }).click();
await page.waitForTimeout(400);
check(rpc('set_my_vote_email').some((w) => w.body.p_email === 'mike@example.com'), 'player saves their own email (tidied)');
await mine.locator('[data-channel="email"]').click();
await page.waitForTimeout(400);
check(writes.some((w) => w.table === 'notify_prefs' && w.method === 'POST' && w.body.vote_channel === 'email'), 'player switches to email only (their own choice)');
check(await mine.locator('[data-channel="email"]').getAttribute('aria-pressed') === 'true', 'By email shows as picked');
check((await mine.innerText()).includes('Votes go to mike@example.com'), 'player sees where votes go');
await mine.screenshot({ path: `${SHOTS}/ev2-my-choice.png` });
await noSideScroll('Notifications');

// 3. Organiser opens a vote: email people get one email for the batch, the rest an app notification.
me = { user: U1, player: P1, admin: true };
await page.goto(`${BASE}#/plan/${PLAN}?tab=vote`);
await page.reload();
await page.getByText('Shirt colour?').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(500);
const line = page.getByTestId('email-vote-line').first();
check((await line.innerText()).includes('📧 1 person answered by email'), 'vote card: "1 person answered by email" (Hamish)');
await page.getByText('Getting this by email').first().waitFor({ timeout: 5000 }).catch(() => {});
{ const t = await line.innerText(); check(/Getting this by email: .*Mike/.test(t) && /Getting this by email: .*Hamish/.test(t), `organiser sees who gets votes by email (${t.replace(/\n/g, ' / ')})`); }
await page.locator('.card').filter({ hasText: 'Shirt colour?' }).first().screenshot({ path: `${SHOTS}/ev3-vote-card.png` });
await page.getByRole('button', { name: '🗳️ Call a vote' }).click();
await page.getByRole('button', { name: 'Anything else' }).click();
await page.getByLabel('Question').fill('Friday dinner?');
await page.getByLabel('Option', { exact: true }).first().fill('Pub');
await page.getByLabel('Option', { exact: true }).nth(1).fill('Steakhouse');
await page.getByRole('button', { name: '🗳️ Call the vote' }).click();
await page.getByTestId('how-it-goes-out').waitFor({ timeout: 5000 });
check(true, 'after Call the vote: How it goes out');
await page.waitForTimeout(800);
const opened = notifyCalls.filter((c) => c.type === 'poll_open');
check(opened.length === 1, 'opening the vote calls notify once');
check(queued.length === 2 && queued.some((q) => q.to === 'mike@example.com') && queued.some((q) => q.to === 'hamish@example.com'), `one email each for Mike and Hamish (${queued.map((q) => q.to).join(', ')})`);
// Same batch again (e.g. a combined vote card's second poll): no second email.
const again = await page.evaluate(async ([url, pid]) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'poll_open', poll_id: pid }) });
  return r.json();
}, ['https://luogyzvrbedmicjejilr.supabase.co/functions/v1/notify', opened[0].poll_id]);
check(again.emailed === 0 && queued.length === 2, 'the same batch never emails anyone twice');
check(JSON.stringify(again.push) === JSON.stringify([U3]), 'app notification only for Adam (Mike is email only; Josh opened it; Hamish isn’t on the app)');

// 4. Mike taps "⭐ Prefer" for Navy (not a date: Prefer / Option / Don't like, 080) in his email → the answer page → Save → recorded as him, by email.
await page.goto(`${BASE}#/v/${TOKEN}?o=${O2}&r=yes`);
await page.getByTestId('vote-confirm').waitFor({ timeout: 15000 });
check((await page.getByTestId('vote-confirm').innerText()).includes('⭐ Prefer for Navy'), 'answer page asks to save "⭐ Prefer for Navy"');
check(!db.plan_votes.some((v) => v.player_id === P2), 'nothing is recorded just by opening the link');
await page.screenshot({ path: `${SHOTS}/ev4-confirm.png`, fullPage: true });
await page.getByRole('button', { name: /Save: ⭐ Prefer for Navy/ }).click();
await page.getByTestId('vote-thanks').waitFor({ timeout: 5000 });
check((await page.getByTestId('vote-thanks').innerText()).includes('Thanks Mike — ⭐ Prefer for Navy.'), 'thanks page: "Thanks Mike — ⭐ Prefer for Navy."');
check(db.plan_votes.some((v) => v.player_id === P2 && v.option_id === O2 && v.response === 'yes' && v.via === 'email'), 'vote recorded as Mike, by email');
// Change it: tap 👎 Don't like on Pink.
await page.locator('.card').filter({ hasText: 'Pink' }).last().getByRole('button', { name: '👎 Don’t like' }).first().click();
await page.waitForTimeout(400);
check(db.plan_votes.some((v) => v.player_id === P2 && v.option_id === O1 && v.response === 'no'), 'another tap changes / adds an answer');
await page.screenshot({ path: `${SHOTS}/ev5-thanks.png`, fullPage: true });
await noSideScroll('Answer page');

// 5. After the vote closes, the link says so.
await page.goto(`${BASE}#/v/${CLOSED_TOKEN}?o=${O1}&r=yes`);
await page.getByTestId('vote-closed').waitFor({ timeout: 15000 });
check(await page.getByTestId('vote-closed').isVisible(), 'a closed vote shows "This vote has closed"');
check(!(await page.getByTestId('vote-confirm').count()), 'no Save button on a closed vote');

check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
