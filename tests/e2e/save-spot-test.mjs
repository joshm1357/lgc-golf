// "Save your spot" (22 Oct 2026), phone-width browser check against a fake database. No real database, Google
// account or email is touched: every request to Supabase (and Google) is answered here.
//
// Usage: node save-spot-test.mjs <passwordBuild> <emailCodeBuild> <liveStyleBuild> <shotDir>
//   passwordBuild:  VITE_SIGN_IN=google,password, staging database, VITE_BASE=/, VITE_NEW_GROUPS=on,
//                   VITE_GOOGLE_CLIENT_ID=test-123.apps.googleusercontent.com, VITE_GOOGLE_HOSTS=localhost,
//                   served on 127.0.0.1 (Google redirect) and reached as localhost for Google's own button.
//   emailCodeBuild: the same with VITE_SIGN_IN=google,email (staging before 22 Oct: a code every time).
//   liveStyleBuild: no VITE_SIGN_IN, base /lgc-golf/ (like the live app today).
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const PW = process.argv[2] || 'http://127.0.0.1:4176/';
const PW_GIS = PW.replace('127.0.0.1', 'localhost');
const CODE = process.argv[3] || 'http://127.0.0.1:4174/';
const LIVE = process.argv[4] || 'http://localhost:4175/lgc-golf/';
const SHOTS = process.argv[5] || './shots-save-spot';
fs.mkdirSync(SHOTS, { recursive: true });

const UID = '99999999-9999-4999-8999-999999999999';
const OTHER = '88888888-8888-4888-8888-888888888888';
const G = 'b0b0b0b0-0000-4000-8000-00000000000b';
const K = '11111111-1111-4111-8111-111111111111';
const M = '22222222-2222-4222-8222-222222222222';
const INVITE = 'ABCDEFGH2345';
const now = new Date().toISOString();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** The fake server: one group, one phone-only user (UID) who joins and becomes Kurt. Shared by every "phone". */
function server({ confirm = true } = {}) {
  return {
    confirm,
    user: { id: UID, is_anonymous: true, email: '', new_email: '', password: null },
    joined: false,
    player: null,
    taken: new Set(['taken@example.com']), // an email someone else already uses
    calls: [],
    notify: [],
    notifyReply: { sent: 1 },
    admin: false,
    signIns: null,
  };
}
const jwtFor = (S, id = UID) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: id, exp: Math.floor(Date.now() / 1000) + 86400, role: 'authenticated', is_anonymous: id === UID ? S.user.is_anonymous : false })}.x`;
const userObj = (S) => ({ id: UID, aud: 'authenticated', role: 'authenticated', is_anonymous: S.user.is_anonymous, email: S.user.email, new_email: S.user.new_email || undefined, app_metadata: {}, user_metadata: {}, identities: [] });
const session = (S) => ({ access_token: jwtFor(S), refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: userObj(S) });
const subOf = (req) => { try { return JSON.parse(Buffer.from((req.headers().authorization || '').split('.')[1] || '', 'base64url').toString()).sub; } catch { return null; } };

function route(S) {
  return async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const method = req.method();
    const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
    if (method === 'OPTIONS') return json({});
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    const p = url.pathname;
    S.calls.push({ p, method, body, search: url.search, sub: subOf(req) });
    const err = (status, code, msg) => json({ code: status, error_code: code, msg, message: msg }, status);
    // ---- auth
    if (p === '/auth/v1/signup') {
      if (body?.email) return json({ id: OTHER, email: body.email, identities: [{ id: 'x' }] }); // a new account, confirm by code
      return json(session(S)); // anonymous: this phone becomes UID
    }
    if (p === '/auth/v1/user' && method === 'PUT') {
      if (body?.email) {
        if (S.taken.has(body.email)) return err(422, 'email_exists', 'A user with this email address has already been registered');
        if (S.confirm) S.user.new_email = body.email; else { S.user.email = body.email; S.user.is_anonymous = false; }
      }
      if (body?.password) {
        if (!S.user.email) return err(422, 'validation_failed', 'Updating password of an anonymous user without an email or phone is not allowed');
        if (body.password.length < 8) return err(422, 'weak_password', 'Password should be at least 8 characters.');
        S.user.password = body.password;
      }
      return json(userObj(S));
    }
    if (p === '/auth/v1/user') return json(userObj(S));
    if (p === '/auth/v1/verify') {
      if (body.token !== '123456') return err(403, 'otp_expired', 'Token has expired or is invalid');
      if (body.type === 'email_change') { S.user.email = S.user.new_email; S.user.new_email = ''; S.user.is_anonymous = false; }
      return json(session(S));
    }
    if (p === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      if (body.email === S.user.email && body.password === S.user.password) return json(session(S));
      return err(400, 'invalid_credentials', 'Invalid login credentials');
    }
    if (p === '/auth/v1/token' && url.searchParams.get('grant_type') === 'id_token') {
      if (body.link_identity) { S.user.is_anonymous = false; S.user.email = 'kurt@gmail.com'; }
      return json(session(S));
    }
    if (p === '/auth/v1/user/identities/authorize') return json({ url: 'https://accounts.google.com/o/oauth2/fake' });
    if (p === '/auth/v1/recover') return json({});
    if (p === '/auth/v1/logout') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' });
    if (p.startsWith('/auth/v1/')) return json({});
    // ---- functions
    if (p === '/functions/v1/notify') { S.notify.push(body); return json(S.notifyReply); }
    // ---- database
    if (p === '/rest/v1/rpc/my_status') {
      // Only the same user (UID) is in the group: a new phone gets its group back only by being UID.
      if (subOf(req) !== UID || !S.joined) return json({ is_member: false, signed_in: !S.user.is_anonymous, groups: [] });
      return json({ is_member: true, is_admin: S.admin, player_id: S.player, group_name: 'Test Group B', group_id: G, role: S.admin ? 'organiser' : 'player', legacy: false,
        signed_in: !S.user.is_anonymous, look: null, groups: [{ id: G, name: 'Test Group B', slug: 'test-b', role: 'player', legacy: false }] });
    }
    if (p === '/rest/v1/rpc/invite_info') return json({ group_id: G, group_name: 'Test Group B', role: 'player', already_in: S.joined });
    if (p === '/rest/v1/rpc/join_by_invite') { S.joined = true; return json(G); }
    if (p === '/rest/v1/rpc/claim_player') { S.player = body.p_player_id; return json(null); }
    if (p === '/rest/v1/rpc/player_sign_ins') return json(S.signIns || []);
    if (p.startsWith('/rest/v1/rpc/')) return json(null);
    if (p.startsWith('/rest/v1/players')) return json(method === 'GET' ? [{ id: K, name: 'Kurt Dahl', nickname: 'Kurt', handicap: 12, approved: true, created_at: now }, { id: M, name: 'Mike Morris', nickname: 'Mike', handicap: 18, approved: true, created_at: now }] : []);
    if (p.startsWith('/rest/v1/group_features')) return json([{ group_id: G, feature_key: 'notifications', enabled: true }]);
    if (p.startsWith('/rest/v1/')) return json(method === 'GET' ? [] : []);
    return json({});
  };
}

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();

/** A phone. `notifyAsked` skips the notifications pop-up (it's been asked); otherwise it shows first. */
async function phone(S, { session: sess = null, notifyAsked = false, save = null } = {}) {
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
    localStorage.setItem('tgt-whats-new', 'beta-1');
    if (cfg.notifyAsked) localStorage.setItem('tgt-notify-prompt', String(Date.now()));
    if (cfg.sess) localStorage.setItem('lgc-auth', cfg.sess);
    if (cfg.save) localStorage.setItem('tgt-save-spot', JSON.stringify(cfg.save));
  }, [{ notifyAsked, sess: sess ? JSON.stringify(sess) : null, save }]);
  // A phone whose notifications are off (so the notifications pop-up has something to ask).
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
const saveSheet = (page) => page.getByRole('dialog', { name: /Save your spot|Your spot is saved/ });
const noSideScroll = async (page, label) => {
  const w = await page.evaluate(() => document.scrollingElement.scrollWidth);
  check(w <= 375, `${label}: no sideways scroll (${w}px)`);
};
const tapSize = async (locator, label) => {
  const b = await locator.boundingBox().catch(() => null);
  check(b && b.height >= 44, `${label}: big enough to tap (${b ? Math.round(b.height) : 0}px)`);
};
const state = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('tgt-save-spot') || '{}'));

/** Join from the link (landing on #/courses) the phone-only way ("Just this phone for now", ov13), pick Kurt. */
async function joinAsKurt(page, base) {
  await page.goto(`${base}#/join/${INVITE}?to=%2Fcourses`);
  await page.getByTestId('just-this-phone').click({ timeout: 15000 });
  await page.getByRole('button', { name: 'Join', exact: true }).click({ timeout: 15000 });
  await page.getByText('Who are you?').waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /Kurt/ }).first().click();
  await page.getByRole('button', { name: /Yes, I'm Kurt/ }).click();
  await page.getByText('Courses', { exact: true }).first().waitFor({ timeout: 10000 });
}

// 1. Join from the link → name → notifications pop-up → Save your spot → email + password → code → same user, same page.
{
  const S = server({ confirm: true });
  const { ctx, page } = await phone(S);
  await joinAsKurt(page, PW);
  check(page.url().endsWith('#/courses'), 'join: lands on the shared page (?to=/courses)');
  const notif = page.getByRole('dialog', { name: /Turn on notifications/ });
  check(await notif.waitFor({ timeout: 8000 }).then(() => true, () => false), 'the notifications pop-up comes first');
  check(!(await saveSheet(page).isVisible().catch(() => false)), 'Save your spot waits while the notifications one is open');
  await page.waitForTimeout(4000);
  check(!(await saveSheet(page).isVisible().catch(() => false)), '…and keeps waiting');
  await notif.getByRole('button', { name: 'Not now' }).click();
  check(await saveSheet(page).waitFor({ timeout: 8000 }).then(() => true, () => false), 'then Save your spot, once');
  const txt = await saveSheet(page).innerText();
  check(/Connect Google or email so you can sign in on your laptop/.test(txt), 'it says why, in plain words (ov13 wording)');
  check(await saveSheet(page).getByRole('button', { name: /Continue with Google/ }).isVisible(), 'Continue with Google');
  check(await saveSheet(page).getByRole('button', { name: /Use my email/ }).isVisible(), 'Use my email');
  check(await saveSheet(page).getByRole('button', { name: 'Not now' }).isVisible(), 'Not now');
  await tapSize(saveSheet(page).getByRole('button', { name: /Continue with Google/ }), 'Continue with Google');
  await page.screenshot({ path: `${SHOTS}/1-save-your-spot.png` });
  await noSideScroll(page, 'Save your spot');
  check((await state(page)).asked > 0, 'asked once: remembered on the phone');

  await saveSheet(page).getByRole('button', { name: /Use my email/ }).click();
  await page.getByLabel('Your email').fill('kurt@example.com');
  await page.getByLabel('Choose a password').fill('abc');
  check(/5 more characters/.test(await page.getByTestId('password-rule').innerText()), 'password rule shows as they type (min 8)');
  check(await page.getByRole('button', { name: 'Save my spot' }).isDisabled(), 'Save waits for a long enough password');
  check(await page.getByLabel('Choose a password').getAttribute('type') === 'password', 'password hidden by default');
  await page.getByRole('button', { name: 'Show password' }).click();
  check(await page.getByLabel('Choose a password').getAttribute('type') === 'text', 'Show shows it');
  await page.getByLabel('Choose a password').fill('fairway123');
  check(/good/.test(await page.getByTestId('password-rule').innerText()), 'rule ticks when it’s long enough');
  await page.screenshot({ path: `${SHOTS}/2-email-password.png` });
  S.calls.length = 0;
  await page.getByRole('button', { name: 'Save my spot' }).click();
  await page.getByLabel('6-digit code from the email').waitFor({ timeout: 8000 });
  const put = S.calls.find((c) => c.p === '/auth/v1/user' && c.method === 'PUT');
  check(!!put && put.body.email === 'kurt@example.com' && !put.body.password, 'adds the email to the SAME user first (updateUser, not a new account)');
  check(put?.sub === UID, '…as this phone’s user');
  check(!S.calls.some((c) => c.p === '/auth/v1/signup'), 'no new account made');
  await page.screenshot({ path: `${SHOTS}/3-email-code.png` });
  await page.getByLabel('6-digit code from the email').fill('123 456');
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.getByText('Done ✓').waitFor({ timeout: 8000 });
  const verify = S.calls.find((c) => c.p === '/auth/v1/verify');
  check(verify?.body.type === 'email_change' && verify.body.token === '123456', 'the code confirms the email change (spaces removed)');
  check(S.user.password === 'fairway123', 'then the password is set on that same user');
  check(/Next time just tap/.test(await saveSheet(page).innerText()), '“Done — next time just tap Sign in.”');
  check(page.url().endsWith('#/courses'), 'still on the page they were going to');
  check(S.joined && S.player === K && !S.user.is_anonymous, 'same user: still in the group as Kurt, now signed in');
  await page.screenshot({ path: `${SHOTS}/4-done.png` });
  await saveSheet(page).getByRole('button', { name: 'Great' }).click();
  await page.goto(`${PW}#/`);
  await page.waitForTimeout(1500);
  check(!(await page.getByTestId('save-spot-banner').isVisible().catch(() => false)), 'no banner once saved');
  check(page.errors.length === 0, `no page errors (${page.errors.join(' | ')})`);
  await ctx.close();
}

// 2. A project that doesn't confirm emails: saved straight away, no code.
{
  const S = server({ confirm: false });
  S.joined = true; S.player = K;
  const { ctx, page } = await phone(S, { session: session(S), notifyAsked: true });
  await page.goto(`${PW}#/courses`);
  await saveSheet(page).waitFor({ timeout: 10000 });
  await saveSheet(page).getByRole('button', { name: /Use my email/ }).click();
  await page.getByLabel('Your email').fill('kurt@example.com');
  await page.getByLabel('Choose a password').fill('fairway123');
  await page.getByRole('button', { name: 'Save my spot' }).click();
  check(await page.getByText('Done ✓').waitFor({ timeout: 8000 }).then(() => true, () => false), 'no confirm step: saved straight away');
  check(S.user.password === 'fairway123' && S.user.email === 'kurt@example.com', 'email then password, same user');
  await ctx.close();
}

// 3. Email already used by someone else → "Sign in instead".
{
  const S = server();
  S.joined = true; S.player = K;
  const { ctx, page } = await phone(S, { session: session(S), notifyAsked: true });
  await page.goto(`${PW}#/courses`);
  await saveSheet(page).waitFor({ timeout: 10000 });
  await saveSheet(page).getByRole('button', { name: /Use my email/ }).click();
  await page.getByLabel('Your email').fill('taken@example.com');
  await page.getByLabel('Choose a password').fill('fairway123');
  await page.getByRole('button', { name: 'Save my spot' }).click();
  await page.getByText('That email already has an account. Sign in with it instead.').waitFor({ timeout: 8000 });
  check(true, 'email already used: says so in plain words');
  await page.getByRole('button', { name: 'Sign in with that email instead' }).click();
  check(await page.getByTestId('password-sign-in').isVisible(), '…and offers Sign in instead');
  check(await page.getByLabel('Your email').inputValue() === 'taken@example.com', '…with the email filled in');
  await page.screenshot({ path: `${SHOTS}/5-email-taken.png` });
  await ctx.close();
}

// 4. Not now → the banner on Home and More; closed twice → gone.
{
  const S = server();
  S.joined = true; S.player = K;
  const { ctx, page } = await phone(S, { session: session(S), notifyAsked: true });
  await page.goto(`${PW}#/courses`);
  await saveSheet(page).waitFor({ timeout: 10000 });
  await saveSheet(page).getByRole('button', { name: 'Not now' }).click();
  await page.goto(`${PW}#/`);
  const banner = page.getByTestId('save-spot-banner');
  check(await banner.waitFor({ timeout: 8000 }).then(() => true, () => false), 'Not now → a small banner on Home');
  await tapSize(banner.getByRole('button', { name: 'Save', exact: true }), 'banner Save');
  await page.screenshot({ path: `${SHOTS}/6-banner-home.png` });
  await noSideScroll(page, 'Home with banner');
  await page.reload();
  await page.waitForTimeout(4500);
  check(!(await saveSheet(page).isVisible().catch(() => false)), 'the pop-up isn’t asked a second time');
  await page.goto(`${PW}#/more`);
  check(await banner.waitFor({ timeout: 8000 }).then(() => true, () => false), 'the banner on More too');
  await page.screenshot({ path: `${SHOTS}/7-banner-more.png` });
  await banner.getByRole('button', { name: 'Save', exact: true }).click();
  check(await saveSheet(page).waitFor({ timeout: 5000 }).then(() => true, () => false), 'banner Save opens Save your spot');
  await saveSheet(page).getByRole('button', { name: 'Not now' }).click();
  await banner.getByRole('button', { name: /Close the Save your spot reminder/ }).click();
  check(!(await banner.isVisible().catch(() => false)), 'closed once: hidden');
  check((await state(page)).closed === 1, 'closed once: counted');
  // Three days later it comes back once; closed again, it's gone for good.
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tgt-save-spot')); s.closedAt = Date.now() - 4 * 86400000; localStorage.setItem('tgt-save-spot', JSON.stringify(s)); });
  await page.reload();
  check(await banner.waitFor({ timeout: 8000 }).then(() => true, () => false), 'three days later: back once');
  await banner.getByRole('button', { name: /Close the Save your spot reminder/ }).click();
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tgt-save-spot')); s.closedAt = Date.now() - 40 * 86400000; localStorage.setItem('tgt-save-spot', JSON.stringify(s)); });
  await page.reload();
  await page.waitForTimeout(2500);
  check(!(await banner.isVisible().catch(() => false)), 'closed twice: gone for good');
  await page.goto(`${PW}#/player/${K}`); // ov15: your own settings are on your profile now
  check(await page.getByTestId('sign-in-card').waitFor({ timeout: 8000 }).then(() => true, () => false), 'still on your profile, any time');
  await page.screenshot({ path: `${SHOTS}/8-group-card.png` });
  await ctx.close();
}

// 5. A new phone: Sign in first (email + password) → back in the group as Kurt, same user.
{
  const S = server();
  S.joined = true; S.player = K; S.user = { id: UID, is_anonymous: false, email: 'kurt@example.com', password: 'fairway123', new_email: '' };
  const { ctx, page } = await phone(S, { notifyAsked: true });
  await page.goto(PW);
  await page.getByTestId('password-sign-in').waitFor({ timeout: 15000 });
  const order = await page.evaluate(() => {
    const a = document.querySelector('[data-testid="password-sign-in"]'); const b = document.querySelector('[data-testid="link-first"]');
    return a && b ? !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) : false;
  });
  check(order, 'front door: Sign in first, then the link');
  check(await page.getByText('New here? Open the link from your group chat').isVisible(), 'front door: “New here? Open the link from your group chat”');
  check(!(await page.getByRole('button', { name: 'Email me a code' }).isVisible().catch(() => false)), 'password build: no email-code button on the front door');
  await page.screenshot({ path: `${SHOTS}/9-front-door.png`, fullPage: true });
  await noSideScroll(page, 'Front door');
  await page.getByLabel('Your email').fill('kurt@example.com');
  await page.getByLabel('Password', { exact: true }).fill('wrongpass1');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByText(/That email and password don’t match/).waitFor({ timeout: 8000 });
  check(true, 'wrong password: says so');
  check(await page.getByRole('button', { name: 'Reset it' }).isVisible(), 'wrong password: offers to reset it');
  await page.screenshot({ path: `${SHOTS}/10-wrong-password.png`, fullPage: true });
  await page.getByLabel('Password', { exact: true }).fill('fairway123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Leaderboard' }).first().waitFor({ timeout: 10000 }).catch(() => null);
  check(await page.getByRole('link', { name: 'This trip' }).first().isVisible().catch(() => false), 'signed in: straight back into the group');
  const st = S.calls.filter((c) => c.p === '/rest/v1/rpc/my_status').pop();
  check(st?.sub === UID, 'same user id on the new phone, so the same group and player');
  await page.goto(`${PW}#/more`);
  check(await page.getByText('Signed in as Kurt').waitFor({ timeout: 8000 }).then(() => true, () => false), 'and it’s Kurt (the same player)');
  await page.waitForTimeout(4000);
  check(!(await saveSheet(page).isVisible().catch(() => false)), 'signed in: never asked to save a spot');
  check(page.errors.length === 0, `no page errors (${page.errors.join(' | ')})`);
  await ctx.close();
}

// 6. Forgot password → code → new password → in.
{
  const S = server();
  S.joined = true; S.player = K; S.user = { id: UID, is_anonymous: false, email: 'kurt@example.com', password: 'oldpass99', new_email: '' };
  const { ctx, page } = await phone(S, { notifyAsked: true });
  await page.goto(PW);
  await page.getByRole('button', { name: 'Forgot password?' }).click({ timeout: 15000 });
  await page.getByLabel('Your email').fill('kurt@example.com');
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await page.getByLabel('6-digit code from the email').waitFor({ timeout: 8000 });
  check(S.calls.some((c) => c.p === '/auth/v1/recover' && c.body.email === 'kurt@example.com'), 'forgot: emails a reset code');
  await page.getByLabel('6-digit code from the email').fill('123456');
  await page.getByLabel('New password').fill('newpass123');
  await page.screenshot({ path: `${SHOTS}/11-reset.png`, fullPage: true });
  await page.getByRole('button', { name: 'Save new password and sign in' }).click();
  await page.getByRole('link', { name: 'Leaderboard' }).first().waitFor({ timeout: 10000 }).catch(() => null);
  const v = S.calls.find((c) => c.p === '/auth/v1/verify');
  check(v?.body.type === 'recovery', 'the code is checked as a password reset');
  check(S.user.password === 'newpass123', 'the new password is saved');
  check(await page.getByRole('link', { name: 'This trip' }).first().isVisible().catch(() => false), 'and they’re in');
  await ctx.close();
}

// 6b. Create an account (a new organiser).
{
  const S = server();
  const { ctx, page } = await phone(S, { notifyAsked: true });
  await page.goto(PW);
  await page.getByRole('button', { name: 'Create an account' }).click({ timeout: 15000 });
  await page.getByLabel('Your email').fill('new@example.com');
  await page.getByLabel('Choose a password').fill('fairway123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('6-digit code from the email').waitFor({ timeout: 8000 });
  const su = S.calls.find((c) => c.p === '/auth/v1/signup' && c.body?.email);
  check(su?.body.password === 'fairway123', 'create account: signs up with email + password');
  await page.getByLabel('6-digit code from the email').fill('123456');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await page.waitForTimeout(1500);
  check(S.calls.some((c) => c.p === '/auth/v1/verify' && c.body.type === 'signup'), 'then confirms the email with the code');
  await ctx.close();
}

// 7. Google, via the redirect: remembers where it was; back from Google it says Done and lands there.
{
  const S = server();
  S.joined = true; S.player = K;
  const { ctx, page } = await phone(S, { session: session(S), notifyAsked: true });
  await page.goto(`${PW}#/courses`);
  await saveSheet(page).waitFor({ timeout: 10000 });
  await saveSheet(page).getByRole('button', { name: /Continue with Google/ }).click();
  await page.waitForURL(/accounts\.google\.com/, { timeout: 10000 }).catch(() => null);
  const auth = S.calls.find((c) => c.p === '/auth/v1/user/identities/authorize');
  check(!!auth && new URLSearchParams(auth.search).get('provider') === 'google', 'Google: links to this same user (identities/authorize)');
  check(auth?.sub === UID, '…as this phone’s user');
  const rt = new URLSearchParams(auth?.search || '').get('redirect_to') || '';
  check(rt.startsWith(new URL(PW).origin) && !rt.includes('#'), 'Google: comes back to this app (no # in the address)');
  const store = (await ctx.storageState()).origins.find((o) => o.origin === new URL(PW).origin)?.localStorage || [];
  check((store.find((x) => x.name === 'tgt-return-to')?.value || '').includes('#/courses'), 'Google: the page they were on is kept for the way back');
  check(!!JSON.parse(store.find((x) => x.name === 'tgt-save-spot')?.value || '{}').pending, 'Google: the trip is remembered');
  // Back from Google, now signed in (Supabase has taken the sign-in out of the address).
  S.user.is_anonymous = false; S.user.email = 'kurt@gmail.com';
  await page.goto(PW);
  check(await page.getByText('Done ✓').waitFor({ timeout: 10000 }).then(() => true, () => false), 'back from Google: “Done — next time just tap Sign in.”');
  check(page.url().endsWith('#/courses'), 'back from Google: lands on the page they were going to');
  await page.screenshot({ path: `${SHOTS}/12-back-from-google.png` });
  await ctx.close();
}

// 7b. Google account already used by someone else (Supabase says so in the address).
{
  const S = server();
  S.joined = true; S.player = K;
  const { ctx, page } = await phone(S, { session: session(S), notifyAsked: true, save: { asked: Date.now(), pending: { provider: 'google', to: '#/', at: Date.now() } } });
  await page.goto(`${PW}?error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked#/`);
  check(await page.getByText('That Google account is already signed in as someone else — use Sign in instead.').waitFor({ timeout: 10000 }).then(() => true, () => false), 'Google already used: friendly message');
  await page.screenshot({ path: `${SHOTS}/13-google-taken.png` });
  check(!(await page.getByText('Done ✓').isVisible().catch(() => false)), 'Google already used: not told it’s done');
  await ctx.close();
}

// 7c. Google's own button (an address Google knows): links without leaving the app — suits the iPhone Home Screen app.
{
  const S = server();
  S.joined = true; S.player = K;
  const { ctx, page } = await phone(S, { session: session(S), notifyAsked: true });
  await page.goto(`${PW_GIS}#/courses`);
  await saveSheet(page).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Google button (stand-in)' }).waitFor({ timeout: 8000 });
  check(await page.evaluate(() => window.__gisOpts?.text) === 'continue_with', 'Google’s button says “Continue with Google”');
  await page.getByRole('button', { name: 'Google button (stand-in)' }).click();
  await page.getByText('Done ✓').waitFor({ timeout: 8000 }).catch(() => null);
  const tok = S.calls.find((c) => c.p === '/auth/v1/token' && c.search.includes('id_token'));
  check(tok?.body.link_identity === true && tok.body.id_token === 'fake.id.token', 'Google’s button: links Google’s token to this user');
  check(tok?.sub === UID, '…the same user');
  check(!S.calls.some((c) => c.p === '/auth/v1/user/identities/authorize'), 'Google’s button: never leaves the app');
  check(await page.getByText('Done ✓').isVisible(), 'Google’s button: Done');
  check(page.url().endsWith('#/courses'), 'Google’s button: stays on the page');
  await ctx.close();
}

// 8. Organiser: who's saved their spot, and Remind.
{
  const S = server();
  S.joined = true; S.player = K; S.admin = true; S.user.is_anonymous = false; S.user.email = 'kurt@example.com';
  S.signIns = [{ player_id: K, signed_in: true, email: 'k…@example.com', phones: 0 }, { player_id: M, signed_in: false, phones: 1 }];
  const { ctx, page } = await phone(S, { session: session(S), notifyAsked: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(PW).origin });
  await page.addInitScript(() => { navigator.share = undefined; });
  await page.goto(`${PW}#/group`);
  await page.getByText('🔗 Personal links').waitFor({ timeout: 15000 });
  check(await page.getByText(/1 of 2 signed in/).waitFor({ timeout: 8000 }).then(() => true, () => false), 'organiser: how many have saved their spot');
  check(await page.getByText('✓ Signed in', { exact: true }).isVisible(), 'organiser: ✓ signed in (no email address shown, ov15)');
  const remind = page.getByRole('button', { name: 'Remind Mike to save their spot' });
  check(await remind.isVisible(), 'organiser: Remind for Mike (on the app, not signed in)');
  check(!(await page.getByRole('button', { name: 'Remind Kurt to save their spot' }).isVisible().catch(() => false)), 'no Remind for someone signed in');
  await tapSize(remind, 'Remind');
  await page.getByText('🔗 Personal links').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/14-organiser.png` });
  await noSideScroll(page, 'Players & group');
  await remind.click();
  await page.getByText('Reminder sent to Mike’s phone').waitFor({ timeout: 8000 }).catch(() => null);
  check(S.notify.some((n) => n.type === 'nudge_signin' && n.player_id === M), 'Remind sends the notification nudge to Mike');
  check(await page.getByText('Reminder sent to Mike’s phone').isVisible().catch(() => false), 'Remind: says it went');
  // The server hasn't got this kind yet (or Mike has notifications off): a message to paste instead.
  S.notifyReply = { error: 'Unknown notification' };
  await remind.click();
  await page.waitForTimeout(1000);
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  check(/G'day Mike/.test(clip) && /Save your spot/.test(clip), 'no notification possible: a chat message is copied instead');
  await ctx.close();
}

// 9. The email-code build (staging before 22 Oct): Save your spot with just an email and a code.
{
  const S = server();
  S.joined = true; S.player = K;
  const { ctx, page } = await phone(S, { session: session(S), notifyAsked: true });
  await page.goto(`${CODE}#/courses`);
  await saveSheet(page).waitFor({ timeout: 10000 });
  await saveSheet(page).getByRole('button', { name: /Use my email/ }).click();
  check(!(await page.getByLabel('Choose a password').isVisible().catch(() => false)), 'email-code build: no password box');
  await page.getByLabel('Your email').fill('kurt@example.com');
  await page.getByRole('button', { name: 'Save my spot' }).click();
  await page.getByLabel('6-digit code from the email').fill('123456');
  await page.getByRole('button', { name: 'Finish' }).click();
  check(await page.getByText('Done ✓').waitFor({ timeout: 8000 }).then(() => true, () => false), 'email-code build: saved with the code');
  check(!S.calls.some((c) => c.p === '/auth/v1/user' && c.body?.password), 'email-code build: no password set');
  await ctx.close();
}

// 10. The live-style build (no sign-in set up): nothing shows.
{
  const S = server();
  S.joined = true; S.player = K;
  const { ctx, page } = await phone(S, { session: session(S), notifyAsked: true });
  await page.goto(`${LIVE}#/`);
  await page.getByRole('link', { name: 'Leaderboard' }).first().waitFor({ timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(5000);
  check(!(await saveSheet(page).isVisible().catch(() => false)), 'live build: no Save your spot pop-up');
  check(!(await page.getByTestId('save-spot-banner').isVisible().catch(() => false)), 'live build: no banner');
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nAll passed');
process.exit(fails.length ? 1 : 0);
