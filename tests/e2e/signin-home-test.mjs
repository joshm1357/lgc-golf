// Phone-width browser check of the sign-in-first front door (20 Oct 2026), against a fake database.
// No real database or Google account is touched: every request to Supabase is answered here.
// Usage: node signin-home-test.mjs <signInBuildUrl> <liveStyleBuildUrl> <shotDir>
//   signInBuildUrl:  a build with VITE_SIGN_IN=google,email on the staging database (VITE_BASE=/)
//   liveStyleBuildUrl: a build with no VITE_SIGN_IN (like the live L.G.C app), base /lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const SIGNIN = process.argv[2] || 'http://localhost:4174/';
const LIVE = process.argv[3] || 'http://localhost:4175/lgc-golf/';
const SHOTS = process.argv[4] || './shots';
fs.mkdirSync(SHOTS, { recursive: true });

const STAGING = 'https://ttkaojaqhckiwpgrpxkh.supabase.co/**';
const LIVEDB = 'https://luogyzvrbedmicjejilr.supabase.co/**';
const UID = '99999999-9999-4999-8999-999999999999';
const P1 = '11111111-1111-4111-8111-111111111111';
const G1 = 'a0a0a0a0-0000-4000-8000-00000000000a';
const G2 = 'b0b0b0b0-0000-4000-8000-00000000000b';
const now = new Date().toISOString();
const GROUPS = [
  { id: G1, name: 'L.G.C', slug: 'lgc', role: 'organiser', legacy: true, crest_url: 'builtin:lgc', quick: false },
  { id: G2, name: 'Test Group B', slug: 'test-b', role: 'player', legacy: false, crest_url: null, quick: false },
];
const member = (g, groups = GROUPS) => ({ is_member: true, is_admin: g.role === 'organiser', player_id: P1, group_name: g.name, group_id: g.id,
  legacy: g.legacy, quick: false, role: g.role, signed_in: true, look: null, groups });
const db = {
  players: [{ id: P1, name: 'Josh M', nickname: 'Josh', handicap: 14, approved: true, created_at: now }],
  trips: [], trophies: [], courses: [], rounds: [], teams: [], team_players: [], round_players: [], quick_results: [], honour_board: [],
  group_features: [], posts: [], plans: [],
};

const STATUS = { v: null };
const calls = [];
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwtFor = (anon) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, exp: Math.floor(Date.now() / 1000) + 86400, role: 'authenticated', is_anonymous: anon })}.x`;
const userObj = (anon) => ({ id: UID, aud: 'authenticated', role: 'authenticated', is_anonymous: anon, email: anon ? '' : 'josh@thegolftrip.club', app_metadata: {}, user_metadata: {} });

async function fake(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return json({});
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  calls.push({ path: url.pathname, method, body, search: url.search });
  if (url.pathname === '/auth/v1/otp') return json({});
  if (url.pathname === '/auth/v1/verify') return json({ access_token: jwtFor(false), refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: userObj(false) });
  if (url.pathname === '/auth/v1/signup') return json({ access_token: jwtFor(true), refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: userObj(true) });
  if (url.pathname === '/auth/v1/user') return json(userObj(false));
  if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' });
  if (url.pathname.startsWith('/auth/v1/')) return json({});
  if (url.pathname === '/rest/v1/rpc/my_status') {
    const v = STATUS.v;
    const asked = req.headers()['x-group-id'];
    const g = v?.groups?.find((x) => x.id === asked);
    return json(g && v.is_member ? member(g, v.groups) : v);
  }
  if (url.pathname === '/rest/v1/rpc/invite_info') return json({ group_id: G2, group_name: 'Test Group B', role: 'guest', already_in: false });
  if (url.pathname === '/rest/v1/rpc/join_by_invite') { if (STATUS.afterJoin) STATUS.v = STATUS.afterJoin; return json(G2); }
  if (url.pathname.startsWith('/rest/v1/rpc/')) return json(null);
  if (url.pathname.startsWith('/rest/v1/')) return json(method === 'GET' ? (db[url.pathname.split('/')[3]] || []) : []);
  return json({});
}

const fails = [];
// "Inside a group" checked positively: the tab bar is there (not just "the list isn't").
const insideNow = async (page) => page.getByRole('link', { name: 'Leaderboard' }).first().isVisible().catch(() => false);
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();

async function phone({ session } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.route(STAGING, fake);
  await ctx.route(LIVEDB, fake);
  // A stand-in for Google's sign-in page, so tapping "Sign in with Google" never leaves this test.
  await ctx.route('https://accounts.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>google</p>' }));
  if (session) {
    await ctx.addInitScript(([s]) => { if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', s); },
      [JSON.stringify({ access_token: jwtFor(session === 'anon'), refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: userObj(session === 'anon') })]);
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.errors = errors;
  return { ctx, page };
}
const noSideScroll = async (page, label) => {
  const w = await page.evaluate(() => document.scrollingElement.scrollWidth);
  check(w <= 375, `${label}: no sideways scroll (${w}px)`);
};
const tapSize = async (page, locator, label) => {
  const b = await locator.boundingBox();
  check(b && b.height >= 44, `${label}: big enough to tap (${b ? Math.round(b.height) : 0}px)`);
};

// 1. A stranger opens the app: sign in first, PIN folded away underneath.
{
  STATUS.v = null;
  const { ctx, page } = await phone();
  await page.goto(SIGNIN);
  await page.getByRole('button', { name: /Sign in with Google/ }).waitFor({ timeout: 15000 });
  check(await page.getByText('The Golf Trip', { exact: true }).isVisible(), 'home: The Golf Trip name');
  check(await page.getByRole('button', { name: 'Email me a code' }).isVisible(), 'home: Email me a code');
  check(!(await page.getByLabel('Group PIN or invite link').isVisible().catch(() => false)), 'home: PIN box folded away');
  check(await page.getByText('Start a new group').isVisible(), 'home: Start a new group');
  check(await page.locator('#test-marker').isVisible(), 'home: red TEST tag on a staging build');
  await tapSize(page, page.getByRole('button', { name: /Sign in with Google/ }), 'Google button');
  await page.screenshot({ path: `${SHOTS}/s1-home.png`, fullPage: true });
  await noSideScroll(page, 'Home');
  check(!calls.some((c) => c.path === '/auth/v1/signup'), 'home: no phone-only account made just by opening it');

  // 1b. The PIN still works without an account.
  await page.getByRole('button', { name: 'Got a PIN or invite link?' }).click();
  check(await page.getByLabel('Group PIN or invite link').isVisible(), 'home: PIN box opens');
  await page.screenshot({ path: `${SHOTS}/s2-home-pin.png`, fullPage: true });

  // 1c. Google: remembers "just signed in" and goes to Google via Supabase, coming back to this app.
  const [auth] = await Promise.all([
    page.waitForRequest((r) => r.url().includes('/auth/v1/authorize'), { timeout: 10000 }).catch(() => null),
    page.getByRole('button', { name: /Sign in with Google/ }).click(),
  ]);
  check(!!auth && new URL(auth.url()).searchParams.get('provider') === 'google', 'Google: goes to Supabase’s Google sign-in');
  check(!!auth && (new URL(auth.url()).searchParams.get('redirect_to') || '').startsWith(new URL(SIGNIN).origin), 'Google: comes back to this app');
  await ctx.close();
}

// 2. Email code: a brand-new address gets an account; then Your groups.
{
  STATUS.v = null;
  calls.length = 0;
  const { ctx, page } = await phone();
  await page.goto(SIGNIN);
  await page.getByLabel('Your email').fill('josh@thegolftrip.club');
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await page.getByLabel('6-digit code from the email').waitFor({ timeout: 10000 });
  const otp = calls.find((c) => c.path === '/auth/v1/otp');
  check(!!otp && otp.body.create_user === true, 'email: makes an account if there isn’t one (new organisers can sign up)');
  check(await page.getByText('josh@thegolftrip.club').isVisible(), 'email: says where the code went');
  await page.screenshot({ path: `${SHOTS}/s3-email-code.png`, fullPage: true });
  check(await page.getByRole('button', { name: 'Sign in', exact: true }).isDisabled(), 'email: Sign in waits for 6 digits');
  STATUS.v = member(GROUPS[0]);
  await page.getByLabel('6-digit code from the email').fill('123 456');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByText('Your groups', { exact: true }).waitFor({ timeout: 10000 });
  const verify = calls.find((c) => c.path === '/auth/v1/verify');
  check(!!verify && verify.body.token === '123456' && verify.body.type === 'email', 'email: checks the code (spaces removed)');
  check(await page.getByRole('button', { name: /L\.G\.C/ }).isVisible() && await page.getByRole('button', { name: /Test Group B/ }).isVisible(), 'Your groups: both groups listed');
  check(await page.getByRole('img', { name: /L.G.C Big Dick Energy crest/ }).isVisible(), 'Your groups: L.G.C shows its own crest');
  check(await page.getByText('Signed in as josh@thegolftrip.club').isVisible(), 'Your groups: says who’s signed in');
  await tapSize(page, page.getByRole('button', { name: /Test Group B/ }), 'Group row');
  await page.screenshot({ path: `${SHOTS}/s4-your-groups.png`, fullPage: true });
  await noSideScroll(page, 'Your groups');

  // 2b. Tap one → into that group.
  await page.getByRole('button', { name: /Test Group B/ }).click();
  await page.waitForLoadState('load');
  await page.waitForTimeout(1500);
  check(await page.evaluate(() => localStorage.getItem('lgc-group')) === G2, 'pick a group: the phone remembers it');
  check(await page.evaluate(() => localStorage.getItem('tgt-fresh-sign-in')) === null, 'pick a group: "just signed in" cleared');
  await page.getByRole('link', { name: 'Leaderboard' }).first().waitFor({ timeout: 10000 }).catch(() => null);
  check(await insideNow(page), 'pick a group: goes in (tab bar showing)');

  // 2c. The way back from inside: More → Your groups, and the crest at the top.
  await page.goto(`${SIGNIN}#/more`);
  await page.getByText('Your groups', { exact: true }).first().waitFor({ timeout: 10000 });
  check(await page.getByRole('link', { name: /Your groups/ }).first().isVisible(), 'inside: a way back to Your groups');
  await page.getByRole('link', { name: 'Your groups', exact: true }).first().click(); // the crest in the header
  await page.getByText('Tap one to switch').waitFor({ timeout: 10000 });
  check(await page.getByText('Start a new group').isVisible(), 'inside Your groups: Start a new group');
  await page.screenshot({ path: `${SHOTS}/s5-your-groups-inside.png`, fullPage: true });
  await noSideScroll(page, 'Your groups (inside)');
  check(page.errors.length === 0, `no page errors (${page.errors.join(' | ')})`);
  await ctx.close();
}

// 3. Signed in, in no group yet.
{
  STATUS.v = { is_member: false, signed_in: true, groups: [] };
  const { ctx, page } = await phone({ session: 'signed' });
  await page.goto(SIGNIN);
  await page.getByText('You’re not in a group yet').waitFor({ timeout: 15000 });
  check(await page.getByRole('link', { name: 'Start a new group' }).isVisible(), 'none yet: Start a new group');
  check(await page.getByRole('button', { name: 'Join with a PIN or invite link' }).isVisible(), 'none yet: Join with a PIN or invite link');
  check(!(await page.getByText(/No account found/).isVisible().catch(() => false)), 'none yet: the old "No account found" warning is gone');
  await page.screenshot({ path: `${SHOTS}/s6-no-group.png`, fullPage: true });
  await noSideScroll(page, 'Not in a group yet');
  await ctx.close();
}

// 4. Just signed in with one group: straight in, no extra tap.
{
  STATUS.v = member(GROUPS[0], [GROUPS[0]]);
  const { ctx, page } = await phone({ session: 'signed' });
  await ctx.addInitScript(() => localStorage.setItem('tgt-fresh-sign-in', String(Date.now())));
  await page.goto(SIGNIN);
  await page.getByRole('link', { name: 'Leaderboard' }).first().waitFor({ timeout: 10000 }).catch(() => null);
  check(await insideNow(page), 'one group: straight in (tab bar showing)');
  check(await page.evaluate(() => localStorage.getItem('tgt-fresh-sign-in')) === null, 'one group: "just signed in" cleared once inside');
  await ctx.close();
}

// 5. A guest opens an invite link: joins without an account; signing in is offered underneath.
{
  STATUS.v = null;
  const { ctx, page } = await phone();
  await page.goto(`${SIGNIN}#/join/ABCDEFGH2345`);
  await page.getByText('You’re invited to').waitFor({ timeout: 15000 });
  check(await page.getByRole('button', { name: 'Join', exact: true }).isVisible(), 'invite: Join without an account');
  check(await page.getByRole('button', { name: /Sign in with Google/ }).isVisible(), 'invite: sign-in offered underneath');
  await page.screenshot({ path: `${SHOTS}/s7-invite.png`, fullPage: true });
  await noSideScroll(page, 'Invite');
  const [auth] = await Promise.all([
    page.waitForRequest((r) => r.url().includes('/auth/v1/authorize'), { timeout: 10000 }).catch(() => null),
    page.getByRole('button', { name: /Sign in with Google/ }).click(),
  ]);
  const rt = auth ? new URL(auth.url()).searchParams.get('redirect_to') || '' : '';
  check(!!auth && !rt.includes('#'), 'invite: the address sent to Google has no # (Supabase puts the sign-in there)');
  // The page has gone to Supabase by now, so read the app's own storage from the browser context.
  const appStore = (await ctx.storageState()).origins.find((o) => o.origin === new URL(SIGNIN).origin)?.localStorage || [];
  check((appStore.find((x) => x.name === 'tgt-return-to')?.value || '').includes('#/join/ABCDEFGH2345'), 'invite: the invite is kept on the phone for the way back');
  await ctx.close();
}

// 5b. Back from Google after starting on an invite: the invite comes back; signed in, so no sign-in buttons.
//     Then joining while "just signed in" with two groups goes into the new group, not back to the list.
{
  STATUS.v = { is_member: false, signed_in: true, groups: [] };
  STATUS.afterJoin = member(GROUPS[1]);
  const { ctx, page } = await phone({ session: 'signed' });
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('tgt-fresh-sign-in', String(Date.now()));
    localStorage.setItem('tgt-return-to', JSON.stringify({ hash: '#/join/ABCDEFGH2345', at: Date.now() }));
  });
  await page.goto(SIGNIN);
  await page.getByText('You’re invited to').waitFor({ timeout: 15000 });
  check(true, 'back from Google: the invite they started from comes back');
  check(!(await page.getByRole('button', { name: /Sign in with Google/ }).isVisible().catch(() => false)), 'invite, already signed in: no sign-in buttons');
  check(await page.evaluate(() => localStorage.getItem('tgt-return-to')) === null, 'back from Google: the kept address is used once');
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await page.getByRole('link', { name: 'Leaderboard' }).first().waitFor({ timeout: 10000 }).catch(() => null);
  check(await insideNow(page), 'joined by invite while "just signed in": goes into the group, not back to Your groups');
  STATUS.afterJoin = null;
  await ctx.close();
}

// 6. The live-style build (no VITE_SIGN_IN): the home screen is exactly as before.
{
  STATUS.v = null;
  const { ctx, page } = await phone();
  await page.goto(LIVE);
  await page.getByLabel('Group PIN or invite link').waitFor({ timeout: 15000 });
  check(await page.getByRole('button', { name: "Let's go" }).isVisible(), 'live build: PIN box first, as today');
  check(!(await page.getByRole('button', { name: /Sign in with Google/ }).isVisible().catch(() => false)), 'live build: no sign-in buttons');
  check(await page.getByText('Running a golf group? Start your own →').isVisible(), 'live build: same "Start your own" link');
  check(!(await page.locator('#test-marker').isVisible().catch(() => false)), 'live build: no TEST tag');
  await page.screenshot({ path: `${SHOTS}/s8-live-unchanged.png`, fullPage: true });
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nAll passed');
process.exit(fails.length ? 1 : 0);
