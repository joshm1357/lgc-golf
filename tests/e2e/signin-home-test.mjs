// Phone-width browser check of the sign-in-first front door (20 Oct 2026), against a fake database.
// No real database or Google account is touched: every request to Supabase is answered here.
// Usage: node signin-home-test.mjs <signInBuildUrl> <liveStyleBuildUrl> <shotDir>
//   signInBuildUrl:  a build with VITE_SIGN_IN=google,email on the staging database (VITE_BASE=/), with
//                    VITE_GOOGLE_CLIENT_ID=test-123.apps.googleusercontent.com and VITE_GOOGLE_HOSTS=localhost, served
//                    on 127.0.0.1 (so most checks use the redirect) and reached as localhost for Google's own button.
//   liveStyleBuildUrl: a build with no VITE_SIGN_IN (like the live L.G.C app), base /lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const SIGNIN = process.argv[2] || 'http://127.0.0.1:4174/';
const GIS = SIGNIN.replace('127.0.0.1', 'localhost'); // the same build, at an address listed for Google's own button
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
  players: [{ id: P1, name: 'Josh M', nickname: 'Josh', handicap: 14, approved: true, created_at: now },
    { id: '22222222-2222-4222-8222-222222222222', name: 'Mike Morris', nickname: 'Mike', handicap: 18, approved: true, created_at: now }],
  trips: [], trophies: [], courses: [], rounds: [], teams: [], team_players: [], round_players: [], quick_results: [], honour_board: [],
  group_features: [], posts: [], plans: [],
};

const STATUS = { v: null };
const LINK = { info: null, after: null };
const P2 = '22222222-2222-4222-8222-222222222222';
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
  if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'id_token') return json({ access_token: jwtFor(false), refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: userObj(false) });
  if (url.pathname.startsWith('/auth/v1/')) return json({});
  if (url.pathname === '/rest/v1/rpc/my_status') {
    const v = STATUS.v;
    const asked = req.headers()['x-group-id'];
    const g = v?.groups?.find((x) => x.id === asked);
    return json(g && v.is_member ? member(g, v.groups) : v);
  }
  if (url.pathname === '/rest/v1/rpc/invite_info') return json({ group_id: G2, group_name: 'Test Group B', role: 'guest', already_in: false });
  if (url.pathname === '/rest/v1/rpc/player_link_info') return json(LINK.info);
  if (url.pathname === '/rest/v1/rpc/claim_player_link') { if (LINK.after) STATUS.v = LINK.after; return json(G1); }
  if (url.pathname === '/rest/v1/rpc/player_sign_ins') return json([{ player_id: P1, signed_in: true, email: 'j…@thegolftrip.club', phones: 0, link_waiting: false }, { player_id: P2, signed_in: false, phones: 1, link_waiting: false }]);
  if (url.pathname === '/rest/v1/rpc/create_player_link') return json('MYKEMYKE2345');
  if (url.pathname === '/rest/v1/rpc/group_invite') return json('ABCDEFGH2345');
  if (url.pathname === '/rest/v1/rpc/join_by_invite') { if (STATUS.afterJoin) STATUS.v = STATUS.afterJoin; return json(G2); }
  if (url.pathname.startsWith('/rest/v1/rpc/')) return json(null);
  if (url.pathname.startsWith('/rest/v1/')) return json(method === 'GET' ? (db[url.pathname.split('/')[3]] || []) : []);
  return json({});
}

const fails = [];
// "Inside a group" checked positively: the tab bar is there (not just "the list isn't").
const insideNow = async (page) => page.getByRole('link', { name: 'This trip' }).first().isVisible().catch(() => false);
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();

async function phone({ session } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  // The beta's one-time What's new note (beta-test.mjs checks it) would cover these screens: mark it seen.
  await ctx.addInitScript(() => { try { localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-notify-prompt', String(Date.now())); } catch { /* fine */ } });
  await ctx.route(STAGING, fake);
  await ctx.route(LIVEDB, fake);
  // A stand-in for Google's sign-in page, so tapping "Sign in with Google" never leaves this test.
  await ctx.route('https://accounts.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>google</p>' }));
  await ctx.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: `
    window.google = { accounts: { id: {
      initialize(o) { window.__gis = o; },
      renderButton(el) { const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Google button (stand-in)';
        b.onclick = () => window.__gis.callback({ credential: 'fake.id.token' }); el.appendChild(b); },
    } } };` }));
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

// 1. A stranger opens the app: sign in first, or open your group's link (no PIN anywhere, 083).
{
  STATUS.v = null;
  const { ctx, page } = await phone();
  await page.goto(SIGNIN);
  await page.getByRole('button', { name: /Sign in with Google/ }).waitFor({ timeout: 15000 });
  check(await page.getByText('The Golf Trip', { exact: true }).isVisible(), 'home: The Golf Trip name');
  check(await page.getByRole('button', { name: 'Email me a code' }).isVisible(), 'home: Email me a code');
  check(await page.getByLabel('Your link').isVisible(), 'home: the link box is there too');
  check(!(await page.getByText(/PIN/).count()), 'home: no PIN anywhere');
  check(await page.getByText('Start a new group').isVisible(), 'home: Start a new group');
  check(await page.locator('#test-marker').isVisible(), 'home: red TEST tag on a staging build');
  await tapSize(page, page.getByRole('button', { name: /Sign in with Google/ }), 'Google button');
  await page.screenshot({ path: `${SHOTS}/s1-home.png`, fullPage: true });
  await noSideScroll(page, 'Home');
  check(!calls.some((c) => c.path === '/auth/v1/signup'), 'home: no phone-only account made just by opening it');

  // 1b. A link still works without an account.
  check(await page.getByText('Open the link from your group chat').isVisible(), 'home: link first, no PIN');
  await page.screenshot({ path: `${SHOTS}/s2-home-link.png`, fullPage: true });

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
  check(await page.getByLabel('Your link').isVisible(), 'none yet: the link box straight away (ov13), never a blank app');
  check(/signed in as josh@thegolftrip\.club but not in a group yet\. Open your group’s link \(paste it here\) and you’ll join as this account\./.test(await page.getByTestId('no-group').innerText()), 'none yet: says who is signed in and what to do');
  check(await page.getByText(/Ask your organiser for your personal link/).isVisible(), 'none yet: points people who played before to their personal link');
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

// 5. A guest opens an invite link: sign in first, as part of joining (ov13); "Just this phone for now" underneath.
{
  STATUS.v = null;
  const { ctx, page } = await phone();
  await page.goto(`${SIGNIN}#/join/ABCDEFGH2345`);
  await page.getByText('Join Test Group B').waitFor({ timeout: 15000 });
  check(await page.getByText('Sign in so it’s you on any phone or laptop.').isVisible(), 'invite: sign in first, and why');
  check(await page.getByRole('button', { name: /Continue with Google/ }).isVisible(), 'invite: Continue with Google');
  check(await page.getByRole('button', { name: 'Email me a code' }).isVisible(), 'invite (email-code build): Email me a code');
  check(await page.getByTestId('just-this-phone').isVisible(), 'invite: "Just this phone for now"');
  await page.screenshot({ path: `${SHOTS}/s7-invite.png`, fullPage: true });
  await noSideScroll(page, 'Invite');
  const [auth] = await Promise.all([
    page.waitForRequest((r) => r.url().includes('/auth/v1/authorize'), { timeout: 10000 }).catch(() => null),
    page.getByRole('button', { name: /Continue with Google/ }).click(),
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

// 5c. Personal link, not signed in yet: "G'day Mike", sign in; then signed in: "Yes, I'm Mike" connects and goes in.
{
  STATUS.v = null;
  LINK.info = { group_id: G1, group_name: 'L.G.C', player_name: 'Mike', state: 'ok', mine: false, signed_in: false, look: { crest_url: 'builtin:lgc' } };
  const { ctx, page } = await phone();
  await page.goto(`${SIGNIN}#/me/MYKEMYKE2345`);
  await page.getByText('G’day Mike 👋').waitFor({ timeout: 15000 });
  check(await page.getByText(/This link is just for you, from L\.G\.C/).isVisible(), 'personal link: says who it is for and which group');
  check(await page.getByRole('button', { name: /Sign in with Google/ }).isVisible(), 'personal link: sign in first');
  check(await page.getByText(/Not Mike\? Don’t use this link/).isVisible(), 'personal link: warns anyone who isn’t Mike');
  await page.screenshot({ path: `${SHOTS}/s9-personal-link.png`, fullPage: true });
  await noSideScroll(page, 'Personal link');
  // Signs in with an email code, then connects.
  LINK.info = { ...LINK.info, signed_in: true };
  STATUS.v = { is_member: false, signed_in: true, groups: [] };
  LINK.after = member(GROUPS[0], [GROUPS[0]]);
  await page.getByLabel('Your email').fill('mike@example.com');
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await page.getByLabel('6-digit code from the email').fill('654321');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, I’m Mike' }).waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${SHOTS}/s10-personal-confirm.png`, fullPage: true });
  calls.length = 0;
  await page.getByRole('button', { name: 'Yes, I’m Mike' }).click();
  await page.getByRole('link', { name: 'Leaderboard' }).first().waitFor({ timeout: 10000 }).catch(() => null);
  check(calls.some((c) => c.path === '/rest/v1/rpc/claim_player_link' && c.body.p_token === 'MYKEMYKE2345'), 'personal link: connects with the code from the link');
  check(await insideNow(page), 'personal link: goes into the group as Mike');
  check(await page.evaluate(() => localStorage.getItem('lgc-group')) === G1, 'personal link: the phone remembers the group');
  LINK.after = null;
  await ctx.close();
}

// 5c2. Mike opens his link on his OLD phone (already Mike, phone-only): he still has to sign in, not "all set".
{
  STATUS.v = null;
  LINK.info = { group_id: G1, group_name: 'L.G.C', player_name: 'Mike', state: 'ok', mine: true, signed_in: false, role: 'player', look: null };
  const { ctx, page } = await phone({ session: 'anon' });
  await page.goto(`${SIGNIN}#/me/MYKEMYKE2345`);
  await page.getByText('G’day Mike 👋').waitFor({ timeout: 15000 });
  check(!(await page.getByText(/You’re all set/).isVisible().catch(() => false)), 'old phone: not told it’s all set');
  check(await page.getByRole('button', { name: /Sign in with Google/ }).isVisible(), 'old phone: asked to sign in properly');
  await ctx.close();
}

// 5d. A used personal link someone else opens.
{
  STATUS.v = null;
  LINK.info = { group_id: G1, group_name: 'L.G.C', player_name: 'Mike', state: 'used', mine: false, signed_in: false, look: null };
  const { ctx, page } = await phone();
  await page.goto(`${SIGNIN}#/me/MYKEMYKE2345`);
  await page.getByText('This link’s already been used').waitFor({ timeout: 15000 });
  check(await page.getByText(/If that was you, sign in below/).isVisible(), 'used personal link (not signed in): "If that was you, sign in below"');
  check(await page.getByRole('button', { name: /Sign in with Google/ }).isVisible(), 'used personal link: sign-in offered below (ov13)');
  check(!(await page.getByRole('button', { name: /Yes, I’m Mike/ }).isVisible().catch(() => false)), 'used personal link: no way to use it');
  await ctx.close();
}

// 5e. Google's own button (an address Google knows): no trip away from the app; the nonce matches.
{
  STATUS.v = null;
  calls.length = 0;
  const { ctx, page } = await phone();
  await page.goto(GIS);
  await page.getByRole('button', { name: 'Google button (stand-in)' }).waitFor({ timeout: 15000 });
  check(true, 'Google’s own button shows on an address Google knows');
  const hashed = await page.evaluate(() => window.__gis?.nonce);
  check(await page.evaluate(() => window.__gis?.client_id) === 'test-123.apps.googleusercontent.com', 'Google’s button: uses the app’s client ID');
  STATUS.v = member(GROUPS[0]);
  await page.getByRole('button', { name: 'Google button (stand-in)' }).click();
  await page.getByText('Your groups', { exact: true }).waitFor({ timeout: 10000 }).catch(() => null);
  const tok = calls.find((c) => c.path === '/auth/v1/token' && c.search.includes('id_token'));
  const { createHash } = await import('node:crypto');
  check(!!tok && tok.body.provider === 'google' && tok.body.id_token === 'fake.id.token', 'Google’s button: Supabase checks Google’s token');
  check(!!tok && createHash('sha256').update(tok.body.nonce).digest('hex') === hashed, 'Google’s button: Google got the hash of the one-time value Supabase got');
  check(!calls.some((c) => c.path === '/auth/v1/authorize'), 'Google’s button: never goes via the Supabase address');
  check(await page.getByText('Your groups', { exact: true }).isVisible(), 'Google’s button: then Your groups (two groups)');
  await page.screenshot({ path: `${SHOTS}/s11-google-button-done.png`, fullPage: true });
  await ctx.close();
}

// 5f. Organiser: Personal links card — who's signed in, and "Send link".
{
  STATUS.v = { ...member(GROUPS[0], [GROUPS[0]]), is_admin: true };
  const { ctx, page } = await phone({ session: 'signed' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(SIGNIN).origin });
  await page.addInitScript(() => { try { delete navigator.share; } catch { /* fine */ } navigator.share = undefined; });
  await page.goto(`${SIGNIN}#/group`);
  await page.getByText('🔗 Personal links').waitFor({ timeout: 15000 });
  check(await page.getByText('1 of 2 signed in').waitFor({ timeout: 10000 }).then(() => true, () => false), 'personal links: count signed in');
  check(await page.getByText('✓ Signed in', { exact: true }).first().isVisible() && !(await page.locator('.page').innerText()).includes('@thegolftrip.club'), 'personal links: shows who has signed in (no email address, ov15)');
  check(await page.getByText('Not signed in yet (phone only)').isVisible(), 'personal links: shows who hasn’t');
  calls.length = 0;
  await page.getByRole('button', { name: 'Send a link to Mike' }).click();
  await page.waitForTimeout(800);
  check(calls.some((c) => c.path === '/rest/v1/rpc/create_player_link' && c.body.p_player === P2), 'personal links: makes Mike’s link');
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  check(clip.includes('#/me/MYKEMYKE2345') && clip.includes("G'day Mike"), 'personal links: the message with Mike’s link is ready to paste');
  await page.getByText('🔗 Personal links').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/s12-personal-links-card.png`, fullPage: false });
  await noSideScroll(page, 'Players & group');
  await ctx.close();
}

// 6. The live-style build (no VITE_SIGN_IN): link first, no PIN box (083).
{
  STATUS.v = null;
  const { ctx, page } = await phone();
  await page.goto(LIVE);
  await page.getByLabel('Your link').waitFor({ timeout: 15000 });
  check(await page.getByText('Open the link from your group chat').isVisible(), 'live build: link first');
  check(!(await page.getByText(/PIN/).count()), 'live build: no PIN anywhere');
  check(!(await page.getByRole('button', { name: /Sign in with Google/ }).isVisible().catch(() => false)), 'live build: no sign-in buttons');
  // Changed on 20 Oct (Stage 1 beta): new groups are off on live until Stage 2, so the start link is hidden.
  check(!(await page.getByText('Running a golf group? Start your own →').isVisible()), 'live build: no "Start your own" link while new groups are off');
  check(!(await page.locator('#test-marker').isVisible().catch(() => false)), 'live build: no TEST tag');
  await page.screenshot({ path: `${SHOTS}/s8-live-unchanged.png`, fullPage: true });
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nAll passed');
process.exit(fails.length ? 1 : 0);
