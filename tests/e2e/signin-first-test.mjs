// Sign in first, as part of joining (ov13, 22 Oct 2026). Phone-width browser checks against a fake database: no real
// database, Google account or email is touched — every request to Supabase (and Google) is answered here.
//
//   A. Join link → email + password (a new account, confirmed with the 6-digit code) → pick name → notifications →
//      lands on the shared page. The link is used by the SIGNED-IN account, never a phone-only one. No Save your spot.
//   B. Josh's case: joined on his phone, now on his laptop. Opens the link, signs in with his email + password →
//      already in the group with a name → straight to the page, "Welcome back, Kurt". No Join, no name pick.
//   B2. Already signed in and already in the group: opening the link goes straight to the page.
//   C. Google via the redirect keeps the link's code and page; back from Google it joins as that account and lands there.
//   C2. Google's own button (an address Google knows): no trip away; joins as the Google account.
//   D. "Just this phone for now" → the old join (a phone-only user) → Save your spot later.
//   E. Signed in, in no group → "You're signed in as … but not in a group yet" with the link box; paste → joins as
//      this account.
//   F. A used organiser link: "This link's already been used. If that was you, sign in below."
//   G. A name someone else has: "That's you on another phone? Sign in there and connect Google or email, then sign in
//      here."
//   H. The email form works out which: wrong password for an existing account → no account made, says so.
//
//   I. F2 (ov27, walkthrough review option B) on a "google,password,email" build: joining is ONE step — Google, or an
//      emailed code (no password field) → pick name → the page (no notifications pop-up on a first visit, F1).
//
// Usage: node signin-first-test.mjs <passwordBuild> <shotDir> [codeBuild]
//   codeBuild (optional, runs I): the same as passwordBuild but VITE_SIGN_IN=google,password,email.
//   passwordBuild: VITE_SIGN_IN=google,password, staging database, VITE_BASE=/, VITE_NEW_GROUPS=on,
//                  VITE_GOOGLE_CLIENT_ID=test-123.apps.googleusercontent.com, VITE_GOOGLE_HOSTS=localhost, served on
//                  127.0.0.1 (Google redirect) and reached as localhost for Google's own button.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const PW = process.argv[2] || 'http://127.0.0.1:4176/';
const PW_GIS = PW.replace('127.0.0.1', 'localhost');
const SHOTS = process.argv[3] || './shots-signin-first';
const CODE = process.argv[4] || null;
fs.mkdirSync(SHOTS, { recursive: true });

const G = 'b0b0b0b0-0000-4000-8000-00000000000b';
const K = '11111111-1111-4111-8111-111111111111';
const M = '22222222-2222-4222-8222-222222222222';
const KURT = '99999999-9999-4999-8999-999999999999'; // Kurt's account (email + password), joined on his phone
const GOOGLE = '77777777-7777-4777-8777-777777777777'; // a Google account
const INVITE = 'ABCDEFGH2345';
const now = new Date().toISOString();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
let anonN = 0;

/** The fake server: one group (Test Group B), players Kurt and Mike. Accounts by id; members by account id. */
function server() {
  return {
    confirm: true,
    users: new Map(), // id → { id, email, password, anon, confirmed }
    members: new Map(), // account id → { player }
    inviteDead: null, // 'used' → invite_info says nothing, used_link_info says used
    mikeTaken: false,
    role: 'player',
    calls: [],
  };
}
const addUser = (S, u) => { S.users.set(u.id, { confirmed: true, anon: false, ...u }); return S.users.get(u.id); };
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, exp: Math.floor(Date.now() / 1000) + 86400, role: 'authenticated', is_anonymous: !!u.anon })}.x`;
const userObj = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', is_anonymous: !!u.anon, email: u.email || '', app_metadata: {}, user_metadata: {}, identities: u.anon ? [] : [{ id: 'i' }] });
const session = (u) => ({ access_token: jwtFor(u), refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: userObj(u) });
const subOf = (req) => { try { return JSON.parse(Buffer.from((req.headers().authorization || '').split('.')[1] || '', 'base64url').toString()).sub; } catch { return null; } };

function route(S) {
  return async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const method = req.method();
    const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
    if (method === 'OPTIONS') return json({});
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = null; }
    const p = url.pathname;
    const sub = subOf(req);
    S.calls.push({ p, method, body, search: url.search, sub });
    const err = (status, code, msg) => json({ code: status, error_code: code, msg, message: msg }, status);
    const byEmail = (e) => [...S.users.values()].find((u) => u.email && u.email === String(e || '').toLowerCase());
    // ---- auth
    if (p === '/auth/v1/signup') {
      if (!body?.email) { const u = addUser(S, { id: `00000000-0000-4000-8000-${String(++anonN).padStart(12, '0')}`, anon: true }); return json(session(u)); }
      const had = byEmail(body.email);
      if (had) return json({ ...userObj(had), identities: [] }); // Supabase hides who's registered
      const u = addUser(S, { id: '66666666-6666-4666-8666-666666666666', email: body.email.toLowerCase(), password: body.password, confirmed: !S.confirm });
      return json(S.confirm ? userObj(u) : session(u));
    }
    if (p === '/auth/v1/verify') {
      if (body.token !== '123456') return err(403, 'otp_expired', 'Token has expired or is invalid');
      const u = byEmail(body.email);
      if (!u) return err(403, 'otp_expired', 'Token has expired or is invalid');
      u.confirmed = true;
      return json(session(u));
    }
    if (p === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const u = byEmail(body.email);
      if (u && u.password === body.password && !u.confirmed) return err(400, 'email_not_confirmed', 'Email not confirmed');
      if (u && u.password === body.password) return json(session(u));
      return err(400, 'invalid_credentials', 'Invalid login credentials');
    }
    if (p === '/auth/v1/token' && url.searchParams.get('grant_type') === 'id_token') {
      const u = S.users.get(GOOGLE) || addUser(S, { id: GOOGLE, email: 'josh@gmail.com' });
      return json(session(u));
    }
    if (p === '/auth/v1/user') { const u = S.users.get(sub); return u ? json(userObj(u)) : err(401, 'bad_jwt', 'no user'); }
    if (p === '/auth/v1/authorize') return r.fulfill({ status: 302, headers: { location: 'https://accounts.google.com/o/oauth2/fake' }, body: '' });
    if (p === '/auth/v1/otp') { // an emailed code; makes the account if there isn't one (shouldCreateUser)
      if (!byEmail(body.email)) addUser(S, { id: '55555555-5555-4555-8555-555555555555', email: String(body.email).toLowerCase() });
      return json({});
    }
    if (p === '/auth/v1/resend' || p === '/auth/v1/recover') return json({});
    if (p === '/auth/v1/logout') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' });
    if (p.startsWith('/auth/v1/')) return json({});
    // ---- functions
    if (p.startsWith('/functions/v1/')) return json({ sent: 0 });
    // ---- database
    const me = S.users.get(sub);
    const mine = S.members.get(sub);
    if (p === '/rest/v1/rpc/my_status') {
      if (!mine) return json({ is_member: false, signed_in: !!me && !me.anon, groups: [] });
      return json({ is_member: true, is_admin: false, player_id: mine.player, group_name: 'Test Group B', group_id: G, role: S.role, legacy: false,
        signed_in: !!me && !me.anon, look: null, groups: [{ id: G, name: 'Test Group B', slug: 'test-b', role: S.role, legacy: false }] });
    }
    if (p === '/rest/v1/rpc/invite_info') {
      if (S.inviteDead && !mine) return json(null);
      return json({ group_id: G, group_name: 'Test Group B', role: S.role, already_in: !!mine });
    }
    if (p === '/rest/v1/rpc/used_link_info') return json(S.inviteDead ? { state: S.inviteDead } : null);
    if (p === '/rest/v1/rpc/join_by_invite') { if (!mine) S.members.set(sub, { player: null }); return json(G); }
    if (p === '/rest/v1/rpc/claim_player') {
      if (S.mikeTaken && body.p_player_id === M) return json({ code: 'P0001', message: 'Someone has already picked that name — ask an organiser to give it to you' }, 400);
      if (mine) mine.player = body.p_player_id;
      return json(null);
    }
    if (p.startsWith('/rest/v1/rpc/')) return json(null);
    if (p.startsWith('/rest/v1/group_members')) return json(S.mikeTaken ? [{ player_id: M }] : []);
    if (p.startsWith('/rest/v1/players')) return json(method === 'GET' ? [{ id: K, name: 'Kurt Dahl', nickname: 'Kurt', handicap: 12, approved: true, created_at: now }, { id: M, name: 'Mike Morris', nickname: 'Mike', handicap: 18, approved: true, created_at: now }] : []);
    if (p.startsWith('/rest/v1/group_features')) return json([{ group_id: G, feature_key: 'notifications', enabled: true }]);
    if (p.startsWith('/rest/v1/')) return json([]);
    return json({});
  };
}

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();

/** A phone (or laptop at phone width). `notifyAsked` skips the notifications pop-up. */
async function phone(S, { sess = null, notifyAsked = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' });
  await ctx.route('https://*.supabase.co/**', route(S));
  await ctx.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: `
    window.google = { accounts: { id: {
      initialize(o) { window.__gis = o; },
      renderButton(el, opts) { window.__gisOpts = opts; const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Google button (stand-in)';
        b.onclick = () => window.__gis.callback({ credential: 'fake.id.token' }); el.appendChild(b); },
    } } };` }));
  await ctx.route('https://accounts.google.com/o/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>google</p>' }));
  await ctx.addInitScript(([cfg]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-caddie-hello', '1'); /* ov22: the hello is checked in hello-maps-test */
    if (cfg.notifyAsked) localStorage.setItem('tgt-notify-prompt', String(Date.now()));
    if (cfg.sess) localStorage.setItem('lgc-auth', cfg.sess);
  }, [{ notifyAsked, sess: sess ? JSON.stringify(sess) : null }]);
  await ctx.addInitScript(() => {
    class FakeNotification { static get permission() { return 'default'; } static async requestPermission() { return 'default'; } }
    Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true, writable: true });
    if (!('PushManager' in window)) window.PushManager = function PushManager() {};
    const reg = { pushManager: { getSubscription: async () => null, subscribe: async () => null }, scope: '/' };
    const sw = { register: async () => reg, getRegistration: async () => reg, ready: Promise.resolve(reg), controller: null, addEventListener() {}, removeEventListener() {} };
    Object.defineProperty(Navigator.prototype, 'serviceWorker', { get: () => sw, configurable: true });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.errors = errors;
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
const noSideScroll = async (page, label) => {
  const w = await page.evaluate(() => document.scrollingElement.scrollWidth);
  check(w <= 375, `${label}: no sideways scroll (${w}px)`);
};
const tapSize = async (locator, label) => {
  const b = await locator.boundingBox().catch(() => null);
  check(b && b.height >= 44, `${label}: big enough to tap (${b ? Math.round(b.height) : 0}px)`);
};
const saveSheet = (page) => page.getByRole('dialog', { name: /Save your spot/ });
const insideNow = (page) => page.getByRole('link', { name: 'Leaderboard' }).first().isVisible().catch(() => false);
const joins = (S) => S.calls.filter((c) => c.p === '/rest/v1/rpc/join_by_invite');
const LINK = `#/join/${INVITE}?to=%2Fcourses`;

// A. New account by email + password from the join link → name → notifications → the page.
{
  const S = server();
  const { ctx, page } = await phone(S);
  await page.goto(`${PW}${LINK}`);
  await page.getByText('Join Test Group B').waitFor({ timeout: 15000 });
  check(await page.getByText('Sign in so it’s you on any phone or laptop.').isVisible(), 'A: one screen first — "Join Test Group B — sign in so it’s you on any phone or laptop"');
  check(await page.getByRole('button', { name: /Continue with Google/ }).isVisible(), 'A: Continue with Google');
  check(await page.getByTestId('email-continue').isVisible(), 'A: email + password, one form');
  check(await page.getByTestId('just-this-phone').isVisible(), 'A: "Just this phone for now"');
  check(await page.getByTestId('just-this-phone').evaluate((b) => b.classList.contains('btn')), 'A: "Just this phone for now" is a proper button (F2)');
  check(/only on this phone/.test(await page.getByTestId('just-this-phone-help').innerText().catch(() => '')), 'A: with one line on what it means (F2)');
  check(await page.getByText(/go straight to what was shared/).isVisible(), 'A: says they’ll land on the shared page');
  check(!(await page.getByRole('button', { name: 'Join', exact: true }).isVisible().catch(() => false)), 'A: no Join button before signing in');
  await tapSize(page.getByRole('button', { name: /Continue with Google/ }), 'Continue with Google');
  await tapSize(page.getByTestId('just-this-phone'), 'Just this phone for now');
  await shot(page, '01-join-sign-in-first');
  await noSideScroll(page, 'Join sign-in screen');
  await page.getByLabel('Your email').fill('new@example.com');
  await page.getByLabel('Password', { exact: true }).fill('fairway123');
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await page.getByTestId('no-match').waitFor({ timeout: 8000 });
  check(await page.getByText(/No account with that email and password/).isVisible(), 'A: no account yet → offers to make one');
  await shot(page, '02-no-account-create');
  await page.getByRole('button', { name: 'Create my account' }).click();
  await page.getByLabel('6-digit code from the email').waitFor({ timeout: 8000 });
  check(S.calls.some((c) => c.p === '/auth/v1/signup' && c.body?.email === 'new@example.com' && c.body.password === 'fairway123'), 'A: makes the account with that email + password');
  await shot(page, '03-confirm-code');
  await page.getByLabel('6-digit code from the email').fill('123 456');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await page.getByText('Who are you?').waitFor({ timeout: 10000 });
  const j = joins(S);
  check(j.length === 1 && j[0].sub === '66666666-6666-4666-8666-666666666666', 'A: the link is used by the NEW SIGNED-IN account (not a phone-only one), straight after signing in');
  check(j[0]?.body?.p_token === INVITE, 'A: with the code from the link');
  await shot(page, '04-pick-name');
  await page.getByRole('button', { name: /Kurt/ }).first().click();
  await page.getByRole('button', { name: /Yes, I'm Kurt/ }).click();
  // ov27 (F1): one pop-up at a time — the notifications ask waits for the second visit.
  const notif = page.getByRole('dialog', { name: /Turn on notifications/ });
  check(!(await notif.waitFor({ timeout: 4000 }).then(() => true, () => false)), 'A: no notifications pop-up on the first visit (F1)');
  check(page.url().endsWith('#/courses'), 'A: on the shared page (?to=/courses)');
  await page.waitForTimeout(4500);
  check(!(await saveSheet(page).isVisible().catch(() => false)), 'A: signed in → no Save your spot');
  check(page.url().endsWith('#/courses'), 'A: still on the page');
  await shot(page, '05-landed-on-page');
  check(page.errors.length === 0, `A: no page errors (${page.errors.join(' | ')})`);
  await ctx.close();
}

// B. Josh's case: on the laptop, opens the link, signs in → already in with a name → straight to the page.
{
  const S = server();
  addUser(S, { id: KURT, email: 'kurt@example.com', password: 'fairway123' });
  S.members.set(KURT, { player: K });
  const { ctx, page } = await phone(S, { notifyAsked: true });
  await page.goto(`${PW}${LINK}`);
  await page.getByText('Join Test Group B').waitFor({ timeout: 15000 });
  await page.getByLabel('Your email').fill('kurt@example.com');
  await page.getByLabel('Password', { exact: true }).fill('fairway123');
  await page.getByRole('button', { name: 'Continue with email' }).click();
  const welcome = page.getByText('Welcome back, Kurt');
  check(await welcome.waitFor({ timeout: 12000 }).then(() => true, () => false), 'B: "Welcome back, Kurt"');
  check(page.url().endsWith('#/courses'), 'B: straight to the shared page');
  check(joins(S).length === 0, 'B: no join (already in)');
  check(!(await page.getByText('Who are you?').isVisible().catch(() => false)), 'B: no name to pick');
  check(S.calls.filter((c) => c.p === '/rest/v1/rpc/my_status').pop()?.sub === KURT, 'B: it’s Kurt’s own account (same group, same player)');
  await shot(page, '06-welcome-back');
  check(page.errors.length === 0, `B: no page errors (${page.errors.join(' | ')})`);
  await ctx.close();
}

// B2. Already signed in and already in the group: the link goes straight to the page.
{
  const S = server();
  const u = addUser(S, { id: KURT, email: 'kurt@example.com', password: 'fairway123' });
  S.members.set(KURT, { player: K });
  const { ctx, page } = await phone(S, { sess: session(u), notifyAsked: true });
  await page.goto(`${PW}${LINK}`);
  await page.getByRole('link', { name: 'Leaderboard' }).first().waitFor({ timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(1500);
  check(page.url().endsWith('#/courses'), 'B2: signed in and in the group → straight to the page');
  check(!(await page.getByTestId('join-sign-in').isVisible().catch(() => false)), 'B2: no sign-in screen');
  check(joins(S).length === 0, 'B2: no join');
  await ctx.close();
}

// C. Google via the redirect keeps the code and the page; back from Google it joins as that account and lands there.
{
  const S = server();
  const { ctx, page } = await phone(S, { notifyAsked: true });
  await page.goto(`${PW}${LINK}`);
  await page.getByText('Join Test Group B').waitFor({ timeout: 15000 });
  const [auth] = await Promise.all([
    page.waitForRequest((r) => r.url().includes('/auth/v1/authorize'), { timeout: 10000 }).catch(() => null),
    page.getByRole('button', { name: /Continue with Google/ }).click(),
  ]);
  const rt = auth ? new URL(auth.url()).searchParams.get('redirect_to') || '' : '';
  check(!!auth && new URL(auth.url()).searchParams.get('provider') === 'google', 'C: Continue with Google → Google sign-in (not linking a phone-only user)');
  check(rt.startsWith(new URL(PW).origin) && !rt.includes('#'), 'C: comes back to this app (no # in the address)');
  await page.waitForURL(/accounts\.google\.com/, { timeout: 10000 }).catch(() => null);
  const store = (await ctx.storageState()).origins.find((o) => o.origin === new URL(PW).origin)?.localStorage || [];
  const kept = JSON.parse(store.find((x) => x.name === 'tgt-return-to')?.value || '{}').hash || '';
  check(kept === `#/join/${INVITE}?to=%2Fcourses`, `C: the code AND the page are kept for the way back (${kept})`);
  // Back from Google, signed in as the Google account (Supabase has taken the sign-in out of the address).
  const gUser = addUser(S, { id: GOOGLE, email: 'josh@gmail.com' });
  await ctx.addInitScript(([s]) => { if (location.hostname === '127.0.0.1' && !localStorage.getItem('google-back')) { localStorage.setItem('google-back', '1'); localStorage.setItem('lgc-auth', s); } }, [JSON.stringify(session(gUser))]);
  await page.goto(PW);
  check(await page.getByText('Who are you?').waitFor({ timeout: 12000 }).then(() => true, () => false), 'C: back from Google → joined → pick your name (no second Join tap)');
  check(joins(S).length === 1 && joins(S)[0].sub === GOOGLE && joins(S)[0].body.p_token === INVITE, 'C: the link used by the Google account');
  await page.getByRole('button', { name: /Kurt/ }).first().click();
  await page.getByRole('button', { name: /Yes, I'm Kurt/ }).click();
  await page.waitForTimeout(1200);
  check(page.url().endsWith('#/courses'), 'C: lands on the shared page');
  await shot(page, '07-back-from-google-landed');
  await ctx.close();
}

// C2. Google's own button (an address Google knows): no trip away; joins as the Google account.
{
  const S = server();
  const { ctx, page } = await phone(S, { notifyAsked: true });
  await page.goto(`${PW_GIS}${LINK}`);
  await page.getByRole('button', { name: 'Google button (stand-in)' }).waitFor({ timeout: 15000 });
  check(await page.evaluate(() => window.__gisOpts?.text) === 'continue_with', 'C2: Google’s own button says “Continue with Google”');
  await shot(page, '08-google-own-button');
  await page.getByRole('button', { name: 'Google button (stand-in)' }).click();
  await page.getByText('Who are you?').waitFor({ timeout: 12000 }).catch(() => null);
  const tok = S.calls.find((c) => c.p === '/auth/v1/token' && c.search.includes('id_token'));
  check(!!tok && !tok.body.link_identity, 'C2: signs in with Google’s token (not linking a phone-only user)');
  check(!S.calls.some((c) => c.p === '/auth/v1/authorize'), 'C2: never leaves the app');
  check(joins(S).length === 1 && joins(S)[0].sub === GOOGLE, 'C2: the link used by the Google account');
  check(await page.getByText('Who are you?').isVisible(), 'C2: then pick your name');
  await ctx.close();
}

// D. "Just this phone for now": the old phone-only join, then Save your spot later.
{
  const S = server();
  const { ctx, page } = await phone(S, { notifyAsked: true });
  await page.goto(`${PW}${LINK}`);
  await page.getByTestId('just-this-phone').click({ timeout: 15000 });
  await page.getByRole('button', { name: 'Join', exact: true }).click({ timeout: 10000 });
  await page.getByText('Who are you?').waitFor({ timeout: 10000 });
  const j = joins(S)[0];
  check(!!j && S.users.get(j.sub)?.anon === true, 'D: Just this phone → joins as a phone-only user (as before)');
  await page.getByRole('button', { name: /Kurt/ }).first().click();
  await page.getByRole('button', { name: /Yes, I'm Kurt/ }).click();
  check(await saveSheet(page).waitFor({ timeout: 10000 }).then(() => true, () => false), 'D: Save your spot is kept for these people');
  check(/Connect Google or email so you can sign in on your laptop/.test(await saveSheet(page).innerText().catch(() => '')), 'D: Save your spot: "Connect Google or email so you can sign in on your laptop"');
  await shot(page, '09-just-this-phone-save-spot');
  await ctx.close();
}

// E. Signed in, in no group: the paste-your-link screen; paste → joins as this account.
{
  const S = server();
  const u = addUser(S, { id: GOOGLE, email: 'josh@gmail.com' });
  const { ctx, page } = await phone(S, { sess: session(u), notifyAsked: true });
  await page.goto(PW);
  await page.getByTestId('no-group').waitFor({ timeout: 15000 });
  check(/You’re signed in as josh@gmail\.com but not in a group yet\. Open your group’s link \(paste it here\) and you’ll join as this account\./.test(await page.getByTestId('no-group').innerText()), 'E: says who’s signed in and what to do');
  check(await page.getByLabel('Your link').isVisible(), 'E: the link box straight away (never a blank app)');
  await shot(page, '10-signed-in-no-group');
  await noSideScroll(page, 'Signed in, no group');
  await page.getByLabel('Your link').fill(`https://app.thegolftrip.club/#/join/${INVITE}?to=%2Fcourses`);
  await page.getByRole('button', { name: 'Open' }).click();
  await page.getByText('Who are you?').waitFor({ timeout: 12000 }).catch(() => null);
  check(joins(S).length === 1 && joins(S)[0].sub === GOOGLE, 'E: pasted link → joined as this account, no extra tap');
  check(await page.getByText('Who are you?').isVisible(), 'E: then pick your name');
  await ctx.close();
}

// F. A used organiser link on the sign-in screen.
{
  const S = server();
  S.inviteDead = 'used';
  const { ctx, page } = await phone(S, { notifyAsked: true });
  await page.goto(`${PW}#/join/${INVITE}`);
  await page.getByTestId('dead-link').waitFor({ timeout: 15000 });
  check(await page.getByText('This link’s already been used').isVisible(), 'F: "This link’s already been used"');
  check(await page.getByText('If that was you, sign in below.').isVisible(), 'F: "If that was you, sign in below."');
  check(!(await page.getByText(/ask for a new one/i).isVisible().catch(() => false)), 'F: not "ask for a new one"');
  check(await page.getByRole('button', { name: /Continue with Google/ }).isVisible() && await page.getByTestId('email-continue').isVisible(), 'F: sign-in below');
  check(!(await page.getByTestId('just-this-phone').isVisible().catch(() => false)), 'F: no "Just this phone" for a dead link');
  await shot(page, '11-used-link');
  await noSideScroll(page, 'Used link');
  await ctx.close();
}

// G. A name someone else has.
{
  const S = server();
  S.mikeTaken = true;
  const u = addUser(S, { id: GOOGLE, email: 'josh@gmail.com' });
  S.members.set(GOOGLE, { player: null });
  const { ctx, page } = await phone(S, { sess: session(u), notifyAsked: true });
  await page.goto(PW);
  await page.getByText('Who are you?').waitFor({ timeout: 15000 });
  check(await page.getByText('taken', { exact: true }).waitFor({ timeout: 8000 }).then(() => true, () => false), 'G: Mike shows as taken (as before)');
  await page.getByRole('button', { name: /Mike/ }).first().click();
  check(await page.getByTestId('taken-help').isVisible(), 'G: the taken help shows');
  check((await page.getByTestId('taken-help').innerText()) === 'That’s you on another phone? Sign in there and connect Google or email, then sign in here.', 'G: "That’s you on another phone? Sign in there and connect Google or email, then sign in here."');
  await page.getByRole('button', { name: /Yes, I'm Mike/ }).click();
  check(await page.getByText(/Someone has already picked that name/).waitFor({ timeout: 8000 }).then(() => true, () => false), 'G: picking it still says it’s taken (existing behaviour)');
  await shot(page, '12-taken-name');
  await ctx.close();
}

// H. The email form, wrong password for an existing account: no account made, says so.
{
  const S = server();
  addUser(S, { id: KURT, email: 'kurt@example.com', password: 'fairway123' });
  const { ctx, page } = await phone(S, { notifyAsked: true });
  await page.goto(`${PW}${LINK}`);
  await page.getByText('Join Test Group B').waitFor({ timeout: 15000 });
  await page.getByLabel('Your email').fill('kurt@example.com');
  await page.getByLabel('Password', { exact: true }).fill('wrongpass1');
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await page.getByTestId('no-match').waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: 'Create my account' }).click();
  check(await page.getByText(/That email already has an account, so the password didn’t match/).waitFor({ timeout: 8000 }).then(() => true, () => false), 'H: existing email → “already has an account”, not a second account');
  check(await page.getByRole('button', { name: /Forgot password/ }).isVisible(), 'H: offers Forgot password');
  check(S.users.size === 2 /* Kurt + the phone-only one used to read the link */ && joins(S).length === 0, 'H: no account made, nothing joined');
  await shot(page, '13-wrong-password');
  await ctx.close();
}

// I. F2: one-step join on a "google,password,email" build — Google, or an emailed code (no password).
if (CODE) {
  const S = server();
  const { ctx, page } = await phone(S);
  await page.goto(`${CODE}${LINK}`);
  await page.getByText('Join Test Group B').waitFor({ timeout: 15000 });
  check(await page.getByRole('button', { name: /Continue with Google/ }).isVisible(), 'I: Continue with Google');
  check(await page.getByLabel('Your email').isVisible(), 'I: an email box');
  check(!(await page.getByLabel('Password', { exact: true }).isVisible().catch(() => false)), 'I: no password on the join screen');
  check(!(await page.getByTestId('email-continue').isVisible().catch(() => false)), 'I: not the email + password form');
  check(await page.getByTestId('just-this-phone').isVisible(), 'I: "Just this phone for now" button');
  await shot(page, '14-join-code-only');
  await noSideScroll(page, 'Join, code only');
  await page.getByLabel('Your email').fill('new@example.com');
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await page.getByLabel('6-digit code from the email').waitFor({ timeout: 8000 });
  check(S.calls.some((c) => c.p === '/auth/v1/otp' && c.body?.email === 'new@example.com'), 'I: emails a code (no password asked)');
  await page.getByLabel('6-digit code from the email').fill('123 456');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText('Who are you?').waitFor({ timeout: 10000 });
  const j = joins(S);
  check(j.length === 1 && j[0].sub === '55555555-5555-4555-8555-555555555555', 'I: the link is used by the signed-in account');
  await page.getByRole('button', { name: /Kurt/ }).first().click();
  await page.getByRole('button', { name: /Yes, I'm Kurt/ }).click();
  await page.waitForTimeout(4000);
  check(!(await page.getByRole('dialog', { name: /Turn on notifications/ }).isVisible().catch(() => false)), 'I: no notifications pop-up on the first visit');
  check(page.url().endsWith('#/courses'), 'I: straight to the shared page');
  await shot(page, '15-join-code-landed');
  check(page.errors.length === 0, `I: no page errors (${page.errors.join(' | ')})`);
  await ctx.close();
} else console.log('(I skipped: no code build given)');

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nAll passed');
process.exit(fails.length ? 1 : 0);
