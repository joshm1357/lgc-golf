// Links, not PINs (083), 22 Oct 2026. Fake database and a fake phone — nothing real is touched.
//   A. A fresh browser opens the plain app: the link-first screen, no PIN box anywhere.
//   B. A fresh browser opens a shared recap link (#/join/CODE?to=/?r=<round>) with NO notifications set up yet:
//      Join → pick your name → the notifications prompt → the recap.
//   C. A fresh browser opens an OLD recap link with no join code (#/?r=<round>): link-first screen; pastes the
//      group's invite link → joins → lands on the recap it first opened.
//   D. A member's own "Share the recap" carries the join code.
//   E. A member opens a vote link: straight to the vote, no join screen.
//   F. A personal link on a fresh phone: "Yes, I'm Mike" → in as Mike, no name to pick.
//   G. Copy my link (own profile).
// Usage: node links-test.mjs <base> <shotDir>   e.g. http://localhost:4393/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4393/lgc-golf/';
const SHOTS = process.argv[3] || './shots-links';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-0000000000aa';
const UID = '99999999-9999-4999-8999-999999999999';
const CODE = 'ABCDEFGH2345';
const MYCODE = 'MYKEMYKE2345';
const TRIP = 'cccccccc-0000-4000-8000-000000000001';
const COURSE = 'bbbbbbbb-0000-4000-8000-000000000001';
const R1 = 'dddddddd-0000-4000-8000-000000000001';
const PLAN = 'eeeeeeee-0000-4000-8000-000000000001';
const A = '11111111-1111-4111-8111-111111111111';
const MIKE = '22222222-2222-4222-8222-222222222222';
const now = '2026-10-21T08:00:00.000Z';
const PARS = [[5, 17], [4, 9], [3, 8], [4, 3], [3, 11], [5, 16], [4, 18], [4, 15], [4, 1], [4, 6], [3, 14], [4, 5], [4, 10], [5, 7], [3, 12], [5, 2], [4, 13], [4, 4]];
const holes = PARS.map(([par, si], i) => ({ n: i + 1, par, si }));
let sid = 0;
const card = (subject, d) => PARS.map(([par], i) => ({ id: `s${++sid}`, round_id: R1, subject_id: subject, subject_type: 'player', hole: i + 1, strokes: par + (i === 0 ? d : 0), picked_up: false, updated_at: now }));
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const recapTo = encodeURIComponent(`/?r=${R1}`);
const voteTo = encodeURIComponent(`/plan/${PLAN}?tab=vote`);

function freshDb() {
  return {
    players: [
      { id: A, name: 'Al Blue', nickname: 'Al', handicap: 0, approved: true, created_at: now },
      { id: MIKE, name: 'Mike Morris', nickname: 'Mike', handicap: 0, approved: true, created_at: now },
    ],
    trips: [{ id: TRIP, name: 'Hunter Weekend', start_date: '2026-10-20', end_date: '2026-10-22', status: 'active', created_at: now }],
    trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [], round_pins: [], side_entries: [], posts: [],
    round_players: [A, MIKE].map((p) => ({ round_id: R1, player_id: p, playing_handicap: 0 })),
    scores: [...card(A, -1), ...card(MIKE, 1)],
    courses: [{ id: COURSE, name: 'Cypress Lakes', holes, created_at: now }],
    rounds: [{ id: R1, trip_id: TRIP, course_id: COURSE, name: 'Saturday Stableford', play_date: '2026-10-21', format: 'stableford', status: 'locked', ld_holes: [], ctp_holes: [], comp_bonus: 0, created_at: now }],
    plans: [{ id: PLAN, kind: 'trip', name: 'Spring away', status: 'planning', start_date: null, end_date: null, proposed: false, rsvp_locked: false, created_by: A, organiser_id: A, group_id: GROUP, created_at: now }],
    plan_polls: [], plan_options: [], plan_votes: [], plan_comments: [], plan_costs: [], plan_payments: [], plan_transfers: [], plan_items: [], plan_rsvps: [],
    plan_groups: [], plan_group_members: [], tribunal_cases: [], tribunal_votes: [], rules: [], notify_prefs: [], push_subscriptions: [], group_members: [],
    groups: [{ id: GROUP, vote_decider: 'admin', vote_channel: 'app' }],
    group_features: ['notifications', 'planner', 'feed'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
  };
}

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = () => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, exp: Math.floor(Date.now() / 1000) + 86400, role: 'authenticated', is_anonymous: true })}.x`;
const userObj = { id: UID, aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {} };

/** A phone: its own browser, fake database and fake push. signedIn: a saved phone-only session; member: in the group. */
async function phone({ signedIn = false, member = false, player = null, notifyAsked = true } = {}) {
  const st = { member, player, rpcs: [], db: freshDb() };
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  await ctx.route('https://server.arcgisonline.com/**', (r) => r.fulfill({ status: 204, body: '' }));
  await ctx.route('https://*.supabase.co/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
    if (method === 'OPTIONS') return json({});
    const p = url.pathname;
    if (p === '/auth/v1/signup') return json({ access_token: jwt(), refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: userObj });
    if (p === '/auth/v1/user') return json(userObj);
    if (p.startsWith('/auth/v1/')) return json({});
    if (p.startsWith('/functions/v1/')) return json({ sent: 0 });
    if (p.startsWith('/rest/v1/rpc/')) {
      const name = p.split('/').pop();
      const body = JSON.parse(req.postData() || '{}');
      st.rpcs.push({ name, body });
      if (name === 'my_status') {
        if (!st.member) return json({ is_member: false, is_admin: false, player_id: null, group_id: null, groups: [] });
        return json({ is_member: true, is_admin: false, player_id: st.player, group_name: 'Test Golfers', group_id: GROUP, role: 'player', legacy: false, groups: [{ id: GROUP, name: 'Test Golfers', slug: 'test', role: 'player' }] });
      }
      if (name === 'invite_info') return json(String(body.p_token).toUpperCase() === CODE ? { group_id: GROUP, group_name: 'Test Golfers', role: 'player', already_in: st.member } : null);
      if (name === 'join_by_invite') { st.member = true; return json(GROUP); }
      if (name === 'claim_player') { st.player = body.p_player_id; return json(null); }
      if (name === 'share_join_code') return json(st.member ? CODE : null);
      if (name === 'player_link_info') return json(String(body.p_token).toUpperCase() === MYCODE ? { group_id: GROUP, group_name: 'Test Golfers', player_name: 'Mike', state: 'ok', role: 'player', mine: false, signed_in: false, look: null } : null);
      if (name === 'use_player_link') { st.member = true; st.player = MIKE; return json(GROUP); }
      if (name === 'create_my_player_link') return json(MYCODE);
      return json(null);
    }
    if (p.startsWith('/rest/v1/')) {
      const table = p.split('/')[3];
      const rows = st.db[table] || [];
      if (method === 'GET') {
        const out = rows.filter((r) => [...url.searchParams].every(([k, v]) => !v.startsWith('eq.') || k === 'group_id' || r[k] === undefined || String(r[k]) === v.slice(3)));
        if (/vnd\.pgrst\.object/.test(req.headers().accept || '')) return out[0] ? json(out[0]) : json({ code: 'PGRST116', message: 'none' }, 406);
        return json(out);
      }
      if (method === 'POST') {
        const b = JSON.parse(req.postData() || '{}');
        for (const x of Array.isArray(b) ? b : [b]) rows.push({ id: crypto.randomUUID(), ...x });
        st.db[table] = rows;
        return json([], 201);
      }
      return json([], 200);
    }
    return json({});
  });
  await ctx.addInitScript(([uid, cfg]) => {
    if (cfg.signedIn && !localStorage.getItem('lgc-auth')) {
      const exp = Math.floor(Date.now() / 1000) + 86400;
      const b = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
      const t = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ sub: uid, exp, role: 'authenticated' })}.x`;
      localStorage.setItem('lgc-auth', JSON.stringify({ access_token: t, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated' } }));
    }
    localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-caddie-hello', '1'); /* ov22: the hello is checked in hello-maps-test */
    if (cfg.notifyAsked) localStorage.setItem('tgt-notify-prompt', String(Date.now()));
    // A fake phone that hasn't turned notifications on yet.
    const ps = JSON.parse(sessionStorage.getItem('fake-push') || 'null') || { permission: 'default', sub: null };
    class FakeNotification { static get permission() { return ps.permission; } static async requestPermission() { return ps.permission; } }
    Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true, writable: true });
    if (!('PushManager' in window)) window.PushManager = function PushManager() {};
    const pushManager = { getSubscription: async () => null, subscribe: async () => null };
    const reg = { pushManager, scope: '/' };
    const sw = { register: async () => reg, getRegistration: async () => reg, ready: Promise.resolve(reg), controller: null, addEventListener() {}, removeEventListener() {} };
    Object.defineProperty(Navigator.prototype, 'serviceWorker', { get: () => sw, configurable: true });
  }, [UID, { signedIn, notifyAsked }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push(`page error: ${e}`));
  page.on('dialog', (d) => d.accept());
  return { ctx, page, st };
}
const noSideScroll = async (page, label) => {
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  check(w <= 376, `${label}: no sideways scroll at 375px (${w})`);
};
const notifySheet = (page) => page.getByRole('dialog', { name: /Turn on notifications/ });

// ---------------------------------------------------------------- A. The plain app on a fresh phone
{
  const { ctx, page, st } = await phone();
  await page.goto(BASE);
  await page.getByText('Open the link from your group chat').waitFor({ timeout: 15000 });
  check(await page.getByLabel('Your link').isVisible(), 'fresh phone: the link box');
  check(!(await page.getByText(/PIN/).count()), 'fresh phone: no PIN anywhere');
  check(!(await page.getByRole('button', { name: "Let's go" }).count()), 'fresh phone: no "Let\'s go" PIN button');
  check(await page.getByText('Lost your link? Ask your organiser to send your personal link.').isVisible(), 'fresh phone: lost-your-link note');
  check(!st.rpcs.some((r) => /join_group/.test(r.name)), 'no PIN function is ever called');
  await noSideScroll(page, 'Link-first screen');
  await page.screenshot({ path: `${SHOTS}/01-link-first.png`, fullPage: true });
  // Rubbish (an old PIN) in the box: a plain explanation, no PIN check.
  await page.getByLabel('Your link').fill('7851');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  check(await page.getByText('That doesn’t look like a link from the app.').isVisible(), 'an old PIN typed in: told to copy the link');
  check(!st.rpcs.some((r) => /join_group/.test(r.name)), 'the old PIN is not tried');
  await ctx.close();
}

// ---------------------------------------------------------------- B. A shared recap link, fresh phone, notifications not set up
{
  const { ctx, page, st } = await phone({ notifyAsked: false });
  await page.goto(`${BASE}#/join/${CODE}?to=${recapTo}`);
  await page.getByText('You’re invited to').waitFor({ timeout: 15000 });
  check(await page.getByText('Join, pick your name, and you’ll go straight to what was shared.').isVisible(), 'the invite says it goes straight to what was shared');
  await page.screenshot({ path: `${SHOTS}/02-recap-link-join.png`, fullPage: true });
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await page.getByText('Who are you?').waitFor({ timeout: 15000 });
  check(st.rpcs.some((r) => r.name === 'join_by_invite' && r.body.p_token === CODE), 'joins with the code in the link');
  check(page.url().includes(`#/?r=${R1}`), `the address is already the recap (${page.url().split('#')[1]})`);
  await page.screenshot({ path: `${SHOTS}/03-pick-name.png`, fullPage: true });
  await page.getByText('Mike Morris').click();
  await page.getByRole('button', { name: /Yes, I'm Mike/ }).click();
  const prompted = await notifySheet(page).waitFor({ timeout: 10000 }).then(() => true, () => false);
  check(prompted, 'after picking a name: the notifications prompt');
  await page.screenshot({ path: `${SHOTS}/04-notify-prompt.png`, fullPage: false });
  if (prompted) await notifySheet(page).getByRole('button', { name: 'Not now' }).click();
  await page.getByTestId('round-recap').waitFor({ timeout: 10000 }).catch(() => {});
  check(page.url().includes(`#/?r=${R1}`) && await page.getByTestId('round-recap').isVisible(), 'then the recap of that round');
  await page.getByTestId('round-recap').scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: `${SHOTS}/05-landed-on-recap.png`, fullPage: false });
  await ctx.close();
}

// ---------------------------------------------------------------- C. An OLD recap link with no join code
{
  const { ctx, page } = await phone();
  await page.goto(`${BASE}#/?r=${R1}`);
  await page.getByText('Open the link from your group chat').waitFor({ timeout: 15000 });
  check(await page.getByText('Open your group’s link and you’ll land on the page you opened.').isVisible(), 'old link: says you land on the page after');
  await page.screenshot({ path: `${SHOTS}/06-old-link.png`, fullPage: true });
  await page.getByLabel('Your link').fill(`https://joshm1357.github.io/lgc-golf/#/join/${CODE}`);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await page.getByText('Who are you?').waitFor({ timeout: 15000 });
  await page.getByText('Mike Morris').click();
  await page.getByRole('button', { name: /Yes, I'm Mike/ }).click();
  await page.getByTestId('round-recap').waitFor({ timeout: 10000 }).catch(() => {});
  check(page.url().includes(`#/?r=${R1}`), `old link: after joining, back on the recap it opened (${page.url().split('#')[1]})`);
  await ctx.close();
}

// ---------------------------------------------------------------- D + G. A member shares the recap; Copy my link
{
  const { ctx, page } = await phone({ signedIn: true, member: true, player: A });
  await page.goto(`${BASE}#/?r=${R1}`);
  await page.getByTestId('round-recap').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: '📤 Share the recap' }).click();
  await page.waitForTimeout(800);
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  check(clip.includes(`#/join/${CODE}?to=${recapTo}`), `a member's recap share carries the join code (${(clip.match(/#\/join\/\S+/) || [''])[0]})`);
  await page.goto(`${BASE}#/player/${A}`);
  await page.getByTestId('my-link').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: '🔗 Copy my link' }).click();
  await page.waitForTimeout(800);
  const mine = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  check(mine.includes(`#/me/${MYCODE}`), 'Copy my link: my personal link is ready to paste');
  await page.getByTestId('my-link').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/07-copy-my-link.png`, fullPage: false });
  await ctx.close();
}

// ---------------------------------------------------------------- E. A member opens a vote link
{
  const { ctx, page, st } = await phone({ signedIn: true, member: true, player: A });
  await page.goto(`${BASE}#/join/${CODE}?to=${voteTo}`);
  await page.waitForURL(new RegExp(`#/plan/${PLAN}\\?tab=vote`), { timeout: 15000 }).catch(() => {});
  check(page.url().includes(`#/plan/${PLAN}?tab=vote`), `member: straight to the vote (${page.url().split('#')[1]})`);
  check(!st.rpcs.some((r) => r.name === 'join_by_invite'), 'member: no join needed');
  await page.waitForTimeout(800);
  check(!(await page.getByText('You’re invited to').isVisible().catch(() => false)), 'member: no invite screen left on show');
  await page.screenshot({ path: `${SHOTS}/08-member-vote.png`, fullPage: false });
  await ctx.close();
}

// ---------------------------------------------------------------- F. A personal link on a fresh phone
{
  const { ctx, page, st } = await phone();
  await page.goto(`${BASE}#/me/${MYCODE}`);
  await page.getByText('G’day Mike 👋').waitFor({ timeout: 15000 });
  check(!(await page.getByText(/Signing in isn’t switched on/).count()), 'personal link works with sign-in off');
  await page.screenshot({ path: `${SHOTS}/09-personal-link.png`, fullPage: true });
  await page.getByTestId('use-my-link').click();
  await page.waitForTimeout(2500);
  check(st.rpcs.some((r) => r.name === 'use_player_link' && r.body.p_token === MYCODE), 'personal link: used on this phone');
  check(!(await page.getByText('Who are you?').isVisible().catch(() => false)), 'personal link: no name to pick');
  check(await page.evaluate(() => localStorage.getItem('lgc-group')) === GROUP, 'personal link: this phone is in the group');
  await page.screenshot({ path: `${SHOTS}/10-in-as-mike.png`, fullPage: false });
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nAll passed');
process.exit(fails.length ? 1 : 0);
