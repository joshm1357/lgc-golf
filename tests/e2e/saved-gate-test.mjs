// v10.2 (Josh, 23 Oct 2026, option B): phone-only accounts look and play; saving (Google or email) unlocks organising,
// money and proposing. Phone-width browser checks against a fake database — nothing real is touched.
//
//   A. Al joined "Just this phone: scoring and voting only" (a phone-only account). He votes on the trip and enters a
//      score — both go straight through. He taps "Suggest a trip or round": the "Save your spot to do this" sheet
//      opens instead (the button is still there). He saves with his email + the 6-digit code — added to the SAME
//      account — and the suggestion carries on: the form opens, he fills it in and the trip goes up.
//   B. The database's own refusal ("Save your spot first …") opens the same sheet (a button the app doesn't mark).
//   C. No phone-only way to start anything: signed out, "Start a group", "Play a round" (find a course), a course's
//      "Start a round" and the club page all ask for Google or email, and no anonymous account is ever made.
//
// Usage: node tests/e2e/saved-gate-test.mjs <codeBuild> [shotDir]
//   codeBuild: VITE_SIGN_IN=google,email, staging database, VITE_BASE=/, VITE_NEW_GROUPS=on,
//              VITE_GOOGLE_CLIENT_ID=test-123.apps.googleusercontent.com, VITE_GOOGLE_HOSTS=localhost, on 127.0.0.1.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { makeDb, fakeSupabase, PB, AL, GROUP } from './organise-fixtures.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4174/';
const SHOTS = process.argv[3] || './shots-saved-gate';
fs.mkdirSync(SHOTS, { recursive: true });
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const now = new Date().toISOString();
const SAVE_MESSAGE = 'Save your spot first (Google or email) to do this';
const UID = '99999999-9999-4999-8999-999999999999';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

// ---------------------------------------------------------------- The fake database: the organise fixtures + a live round
const db = makeDb();
const TRIP = crypto.randomUUID(); const COURSE = crypto.randomUUID(); const ROUND = crypto.randomUUID();
const today = (() => { const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' })); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
db.trips.push({ id: TRIP, group_id: GROUP, name: 'Weekend away', start_date: today, end_date: today, status: 'active', created_at: now });
db.courses.push({ id: COURSE, group_id: GROUP, name: 'Test Course', holes: Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 })), created_at: now });
db.rounds.push({ id: ROUND, group_id: GROUP, trip_id: TRIP, course_id: COURSE, name: 'Day 1', format: 'stableford', status: 'live', play_date: today, created_at: now });
db.round_players.push({ round_id: ROUND, player_id: AL, playing_handicap: 11, group_id: GROUP });
db.plan_votes = db.plan_votes.filter((v) => v.player_id !== AL); // Al hasn't voted yet

// Al's account: phone-only until he saves.
const S = { anon: true, email: '', newEmail: '', calls: [] };
const jwt = () => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, exp: Math.floor(Date.now() / 1000) + 86400, role: 'authenticated', is_anonymous: S.anon })}.x`;
const userObj = () => ({ id: UID, aud: 'authenticated', role: 'authenticated', is_anonymous: S.anon, email: S.email, new_email: S.newEmail || undefined, app_metadata: {}, user_metadata: {}, identities: [] });
const session = () => ({ access_token: jwt(), refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: userObj() });

const fake = fakeSupabase(db, () => ({ id: AL, admin: false }));
const route = async (r) => {
  const req = r.request();
  const url = new URL(req.url());
  const p = url.pathname;
  const method = req.method();
  const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
  if (method === 'OPTIONS') return json({});
  const body = req.postData() ? (() => { try { return JSON.parse(req.postData()); } catch { return null; } })() : null;
  S.calls.push({ p, method, body });
  // ---- auth
  if (p === '/auth/v1/signup') return json(session()); // never expected: no phone-only account is made anywhere here
  if (p === '/auth/v1/user' && method === 'PUT') {
    if (body?.email) S.newEmail = body.email; // the project confirms emails: a code is sent
    return json(userObj());
  }
  if (p === '/auth/v1/user') return json(userObj());
  if (p === '/auth/v1/verify') {
    if (body?.token !== '123456') return json({ code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' }, 403);
    if (body.type === 'email_change') { S.email = S.newEmail; S.newEmail = ''; S.anon = false; }
    return json(session());
  }
  if (p === '/auth/v1/token') return json(session()); // refreshSession: a new token (now is_anonymous: false)
  if (p.startsWith('/auth/v1/')) return json({});
  // ---- the database
  if (p === '/rest/v1/rpc/my_status') {
    return json({ is_member: true, is_admin: false, player_id: AL, group_name: 'Test Golfers', group_id: GROUP, role: 'player', legacy: false,
      signed_in: !S.anon || !!S.appThinksSaved, groups: [{ id: GROUP, name: 'Test Golfers', slug: 'test', role: 'player' }] });
  }
  // Migration 102: a phone-only account is refused these, with the save message.
  const refused = (method === 'POST' && (p === '/rest/v1/plans' || p === '/rest/v1/plan_costs')) || p === '/rest/v1/rpc/raise_dispute';
  if (refused && S.anon) return json({ code: '42501', message: SAVE_MESSAGE, hint: 'save_spot', details: null }, 403);
  return fake.handler(r);
};

const browser = await chromium.launch();
async function phone({ signedIn = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.route('https://*.supabase.co/**', route);
  await ctx.route('https://accounts.google.com/**', (x) => x.fulfill({ status: 204, body: '' }));
  await ctx.route('https://server.arcgisonline.com/**', (x) => x.fulfill({ status: 204, body: '' }));
  await ctx.route('https://api.open-meteo.com/**', (x) => x.fulfill({ status: 204, body: '' }));
  await ctx.addInitScript(([sess]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    if (sess) localStorage.setItem('lgc-auth', sess);
    localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-caddie-hello', '1');
    localStorage.setItem('tgt-notify-prompt', String(Date.now()));
    localStorage.setItem('tgt-save-spot', JSON.stringify({ asked: Date.now() })); // the one-time pop-up has had its turn
  }, [signedIn ? JSON.stringify(session()) : null]);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  return { ctx, page };
}
const gateSheet = (page) => page.getByTestId('saved-gate');

// ================================================================ A. look and play, then save to propose
{
  const { ctx, page } = await phone();
  // Vote on the trip's open vote.
  await page.goto(`${BASE}#/plan/${PB}?tab=vote`);
  const batch = page.getByTestId('vote-batch');
  const batchOk = await batch.waitFor({ timeout: 15000 }).then(() => true, () => false);
  check(batchOk, 'A: the trip’s vote shows for a phone-only player');
  const before = db.plan_votes.filter((v) => v.player_id === AL).length;
  if (batchOk) {
    const sections = batch.getByTestId('vote-batch-section');
    for (let i = 0; i < await sections.count(); i++) {
      const b = sections.nth(i).locator('[data-answer]').first();
      if (await b.isVisible().catch(() => false)) { await b.click(); await page.waitForTimeout(350); }
    }
  }
  await page.waitForTimeout(600);
  check(db.plan_votes.filter((v) => v.player_id === AL).length > before, 'A: phone-only votes go straight through (no save sheet)');
  check(!(await gateSheet(page).isVisible().catch(() => false)), 'A: …and no Save your spot sheet');
  await page.screenshot({ path: `${SHOTS}/a1-voted.png` });

  // Enter a score.
  await page.goto(`${BASE}#/score/${ROUND}`);
  const plus = page.getByRole('button', { name: 'One more' });
  const plusOk = await plus.first().waitFor({ timeout: 15000 }).then(() => true, () => false);
  check(plusOk, 'A: score entry opens');
  if (plusOk) {
    await plus.first().click();
    await page.getByRole('button', { name: /Save & next hole/ }).click();
    await page.waitForTimeout(1500);
  }
  check(db.scores.some((s) => s.round_id === ROUND && s.subject_id === AL), 'A: phone-only scores save (scores row written)');
  check(!(await gateSheet(page).isVisible().catch(() => false)), 'A: …and no Save your spot sheet');
  await page.screenshot({ path: `${SHOTS}/a2-scored.png` });

  // Propose a trip: the button's there; tapping it asks to save first.
  await page.goto(`${BASE}#/plan`);
  const suggest = page.getByRole('button', { name: /Suggest a trip or round/ }).first();
  check(await suggest.waitFor({ timeout: 15000 }).then(() => true, () => false), 'A: "Suggest a trip or round" is still there (not hidden)');
  await suggest.click();
  check(await gateSheet(page).waitFor({ timeout: 5000 }).then(() => true, () => false), 'A: tapping it opens "Save your spot to do this"');
  const words = await gateSheet(page).innerText().catch(() => '');
  check(/Suggesting a trip or starting the planning needs a saved account/.test(words), 'A: the sheet says what needs saving');
  check(/Just this phone: scoring and voting only/.test(words), 'A: …and names the phone-only option the same way as the join screen');
  check(!(await page.getByRole('dialog', { name: 'Suggest a trip or round' }).isVisible().catch(() => false)), 'A: the suggestion form waits');
  check(!S.calls.some((c) => c.p === '/rest/v1/plans' && c.method === 'POST'), 'A: nothing sent to the database yet');
  await page.screenshot({ path: `${SHOTS}/a3-save-sheet.png` });
  await noSideScroll(page, 'A: the save sheet');

  // Save with email + code: the SAME account.
  await gateSheet(page).getByRole('button', { name: /Use my email/ }).click();
  await page.getByLabel('Your email').fill('al@example.com');
  await page.getByRole('button', { name: 'Save my spot' }).click();
  await page.getByLabel('6-digit code from the email').fill('123456');
  await page.getByRole('button', { name: 'Finish' }).click();
  const formOpen = await page.getByRole('dialog', { name: 'Suggest a trip or round' }).waitFor({ timeout: 8000 }).then(() => true, () => false);
  check(!S.anon && S.email === 'al@example.com', 'A: saved — the email is on the same account (no new account)');
  check(!S.calls.some((c) => c.p === '/auth/v1/signup'), 'A: no account made (signup never called)');
  check(formOpen, 'A: then it carries on — the suggestion form opens by itself');
  await page.screenshot({ path: `${SHOTS}/a4-carries-on.png` });
  if (formOpen) {
    await page.getByRole('dialog', { name: 'Suggest a trip or round' }).getByLabel('Name').fill('Byron Bay 2027');
    await page.getByRole('button', { name: /Call the vote|Put it to the group/ }).click();
    await page.waitForTimeout(1500);
  }
  check(db.plans.some((p) => p.name === 'Byron Bay 2027'), 'A: the proposal goes through once saved');
  check(page.errors.length === 0, `A: no page errors (${page.errors.join(' | ')})`);
  await ctx.close();
}

// ================================================================ B. the database's refusal opens the same sheet
// (An older app, or a button the app doesn't mark: here the app thinks Al is saved, the database knows he isn't.)
{
  S.anon = true; S.email = ''; S.appThinksSaved = true;
  const { ctx, page } = await phone();
  await page.goto(`${BASE}#/plan`);
  await page.getByRole('button', { name: /Suggest a trip or round/ }).first().click({ timeout: 15000 });
  const form = page.getByRole('dialog', { name: 'Suggest a trip or round' });
  await form.waitFor({ timeout: 8000 });
  await form.getByLabel('Name').fill('Refused trip');
  await page.getByRole('button', { name: /Call the vote|Put it to the group/ }).click();
  check(await gateSheet(page).waitFor({ timeout: 6000 }).then(() => true, () => false), 'B: the database’s "Save your spot first" refusal opens the same sheet');
  check(!db.plans.some((p) => p.name === 'Refused trip'), 'B: …and nothing was saved');
  await page.screenshot({ path: `${SHOTS}/b1-refused.png` });
  S.appThinksSaved = false;
  await ctx.close();
}

// ================================================================ C. no phone-only way to start anything
{
  const { ctx, page } = await phone({ signedIn: false });
  S.calls.length = 0;
  await page.goto(`${BASE}#/start/new`);
  const card = page.getByTestId('sign-in-to-continue');
  check(await card.waitFor({ timeout: 15000 }).then(() => true, () => false), 'C: Start a group → sign in with Google or email first');
  check(await card.getByRole('button', { name: /Google/ }).first().isVisible().catch(() => false), 'C: …Google is offered');
  check(!(await page.getByRole('button', { name: /Carry on without signing in/ }).isVisible().catch(() => false)), 'C: …and no "Carry on without signing in"');
  check(!(await page.getByRole('button', { name: /Just this phone/ }).isVisible().catch(() => false)), 'C: …and no phone-only option');
  await page.screenshot({ path: `${SHOTS}/c1-start.png` });
  await page.goto(`${BASE}#/c`);
  check(await page.getByTestId('sign-in-to-continue').waitFor({ timeout: 15000 }).then(() => true, () => false), 'C: Play a round (find a course) → sign in first');
  await page.screenshot({ path: `${SHOTS}/c2-find-course.png` });
  await page.goto(`${BASE}#/club`);
  check(await page.getByTestId('sign-in-to-continue').waitFor({ timeout: 15000 }).then(() => true, () => false), 'C: a club claiming its course page → sign in first');
  await page.screenshot({ path: `${SHOTS}/c3-club.png` });
  await page.waitForTimeout(800);
  check(!S.calls.some((c) => c.p === '/auth/v1/signup'), 'C: no anonymous (phone-only) account is made on any of them');
  check(page.errors.length === 0, `C: no page errors (${page.errors.join(' | ')})`);
  await ctx.close();
}

async function noSideScroll(page, label) {
  const w = await page.evaluate(() => document.scrollingElement.scrollWidth);
  check(w <= 375, `${label}: no sideways scroll (${w}px)`);
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
