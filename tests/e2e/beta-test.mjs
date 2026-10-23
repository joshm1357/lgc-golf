// Stage 1 (beta) browser check: light desktop, Tell Josh, What's new, new groups off. Fake database only.
// Usage: node beta-test.mjs <liveStyleBase> <signInBase> <productBase> <shotDir>
//   liveStyleBase: this branch built like live (no sign-in, new groups off), e.g. http://localhost:4301/lgc-golf/
//   signInBase:    this branch built like staging (VITE_SIGN_IN=google,email, VITE_NEW_GROUPS=on), e.g. http://localhost:4302/
//   productBase:   the product branch before this change, built like live, e.g. http://localhost:4303/lgc-golf/
//                  (once Stage 1 is in the product branch, the same branch's live-style build: other features change these screens)
// #/rules opens Governance → Rulebook, so its header (and the sidebar link) say Governance.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const [LIVE, SIGNIN, PRODUCT, SHOTS = './shots-beta'] = process.argv.slice(2);
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000a';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const TRIP = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURSE = 'cccccccc-0000-4000-8000-000000000001';
const ROUND = 'dddddddd-0000-4000-8000-000000000001';
const PLAN = 'eeeeeeee-0000-4000-8000-000000000001';
const now = '2026-10-20T08:00:00.000Z';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date()); // the app's 'today' is Sydney time (a live round from an earlier day isn't 'on now')
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const db = {
  players: [
    { id: P1, name: 'Josh M', nickname: 'Josh', handicap: 14, approved: true, created_at: now },
    { id: P2, name: 'Mike Morris', nickname: 'Mike', handicap: 18, approved: true, created_at: now },
  ],
  trips: [{ id: TRIP, name: 'Test Trip', start_date: today, end_date: today, status: 'active', created_at: now }],
  trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [], round_pins: [],
  courses: [{ id: COURSE, name: 'Test Links', holes, created_at: now }],
  rounds: [{ id: ROUND, trip_id: TRIP, course_id: COURSE, name: 'Saturday', play_date: today, format: 'stableford', status: 'live', ld_holes: [], ctp_holes: [], comp_bonus: 0, created_at: now }],
  round_players: [P1, P2].map((p) => ({ round_id: ROUND, player_id: p, playing_handicap: 14 })),
  scores: [{ round_id: ROUND, subject_id: P1, subject_type: 'player', hole: 1, strokes: 4, picked_up: false, updated_at: now }],
  plans: [{ id: PLAN, kind: 'trip', name: 'Spring Trip', status: 'planning', start_date: '2026-11-20', end_date: '2026-11-22', location_name: 'Bowral', proposed: false, rsvp_locked: false, created_by: P1, created_at: now }],
  plan_rsvps: [], plan_groups: [], plan_group_members: [], tribunal_cases: [], tribunal_votes: [], posts: [], rules: [],
  group_features: ['feed', 'side_comps', 'comp_bonus', 'trophies', 'tribunal', 'draw', 'gps', 'location', 'planner', 'planner_tasks',
    'planner_costs', 'planner_rooms', 'rule_voting', 'notifications', 'connector'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })),
};
const rpcs = [];
let member = true;
let noPlayer = false;
function filterRows(rows, params) {
  return rows.filter((r) => {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
      if (k === 'group_id' && r.group_id === undefined) continue;
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
  if (url.pathname.startsWith('/rest/v1/rpc/my_status')) {
    return json(member
      ? { is_member: true, is_admin: !noPlayer, player_id: noPlayer ? null : P1, group_name: 'L.G.C', group_id: GROUP, role: 'organiser', legacy: true, signed_in: true, groups: [{ id: GROUP, name: 'L.G.C', slug: 'lgc', role: 'organiser' }] }
      : { is_member: false, signed_in: false, groups: [] });
  }
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    const name = url.pathname.split('/').pop();
    rpcs.push({ name, body: req.postData() ? JSON.parse(req.postData()) : null });
    return json(null);
  }
  if (url.pathname.startsWith('/rest/v1/')) {
    const table = url.pathname.split('/')[3];
    const rows = filterRows(db[table] || [], url.searchParams);
    const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    if (method === 'GET') return json(single ? rows[0] || null : rows);
    return json(single ? null : [], 201);
  }
  if (url.pathname.startsWith('/auth/v1/user')) return json({ id: '99999999-9999-4999-8999-999999999999', aud: 'authenticated', role: 'authenticated', is_anonymous: false, email: 'josh@example.com' });
  return json({});
}

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();

async function newPage(width, height = 900, { phone = false, seenNote = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone, reducedMotion: 'reduce' });
  await ctx.route('https://*.supabase.co/**', fakeSupabase);
  await ctx.addInitScript(([uid, seen]) => {
    const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
    const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
    const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.x`;
    if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated', is_anonymous: false, email: 'josh@example.com' } }));
    if (seen && !sessionStorage.getItem('keep-note')) localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-caddie-hello', '1'); /* ov22: the hello is checked in hello-maps-test */ localStorage.setItem('tgt-notify-prompt', String(Date.now()));
  }, ['99999999-9999-4999-8999-999999999999', seenNote]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push(`page error: ${e}`));
  return { ctx, page };
}
// Compare two screenshots in a blank page: how many pixels differ, and by how much at most (0–255).
async function pixelDiff(a, b) {
  const page = await browser.newPage();
  const r = await page.evaluate(async ([x, y]) => {
    const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
    const [ia, ib] = await Promise.all([load(x), load(y)]);
    const px = (im) => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); return g.getImageData(0, 0, im.width, im.height).data; };
    if (ia.width !== ib.width || ia.height !== ib.height) return { count: Infinity, max: 255 };
    const da = px(ia), db = px(ib); let count = 0, max = 0;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
      if (d > 0) { count += 1; if (d > max) max = d; }
    }
    return { count, max };
  }, [`data:image/png;base64,${a.toString('base64')}`, `data:image/png;base64,${b.toString('base64')}`]);
  await page.close();
  return r;
}
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const visible = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; const r = el.getBoundingClientRect(); return getComputedStyle(el).display !== 'none' && r.width > 0 && r.height > 0; }, sel);

// 1. Phone screens unchanged: pixel-compare this branch with the product branch at 375 px (live-style builds).
const title = (page, text) => page.locator('.page .hdr-title', { hasText: text }).first().waitFor({ timeout: 15000 });
for (const [hash, text, name] of [['#/', 'Saturday', 'leaderboard'], ['#/feed', 'Feed', 'feed'], ['#/plan', 'Spring Trip', 'trips'], ['#/rules', 'Group rules', 'rulebook']]) {
  const shots = [];
  for (const base of [PRODUCT, LIVE]) {
    const { ctx, page } = await newPage(375, 812, { phone: true });
    await page.goto(base + hash);
    if (name === 'feed' || name === 'rulebook') await title(page, text); else await page.locator('.page').getByText(text).first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(700);
    shots.push(await page.screenshot());
    await ctx.close();
  }
  fs.writeFileSync(`${SHOTS}/375-${name}-before.png`, shots[0]);
  fs.writeFileSync(`${SHOTS}/375-${name}-after.png`, shots[1]);
  const diff = Buffer.compare(shots[0], shots[1]) === 0 ? { count: 0, max: 0 } : await pixelDiff(shots[0], shots[1]);
  // Allow edge smoothing (a handful of pixels, small colour change); any real layout change moves thousands.
  check(diff.count <= 40 && diff.max <= 60, `375 px ${name}: same as the product branch (${diff.count} pixels differ, biggest change ${diff.max})`);
}

// 2. Phone: no sidebar, bottom bar there; More has the beta card; no sideways scroll.
{
  const { ctx, page } = await newPage(375, 812, { phone: true });
  await page.goto(LIVE + '#/more');
  await page.locator('.page').getByText('Send feedback').first().waitFor({ timeout: 15000 });
  check(!(await visible(page, '.side')), '375 px: no sidebar');
  check(await visible(page, '.tabs'), '375 px: bottom bar shows');
  check(await noSideScroll(page), '375 px: no sideways scroll on More');
  await page.screenshot({ path: `${SHOTS}/375-more.png`, fullPage: true });
  await ctx.close();
}

// 3. Tablet (768) and desktop (1280, 1920).
for (const w of [768, 1280, 1920]) {
  const { ctx, page } = await newPage(w, 900);
  await page.goto(LIVE + '#/');
  await page.getByText('Saturday').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  const desk = w >= 1024;
  check((await visible(page, '.side')) === desk, `${w} px: sidebar ${desk ? 'shows' : 'hidden'}`);
  check((await visible(page, '.tabs')) === !desk, `${w} px: bottom bar ${desk ? 'hidden' : 'shows'}`);
  check(await noSideScroll(page), `${w} px: no sideways scroll`);
  const width = await page.evaluate(() => document.querySelector('.page').getBoundingClientRect().width);
  check(desk ? width > 800 && width <= 900 : width > 700 && width <= 760, `${w} px: page is ${Math.round(width)} px wide`);
  await page.screenshot({ path: `${SHOTS}/${w}-leaderboard.png` });
  if (desk) {
    await page.locator('.side').getByText('Trips', { exact: true }).click();
    await page.getByText('Spring Trip').first().waitFor({ timeout: 8000 });
    check(true, `${w} px: sidebar Trips opens the Trips tab`);
    await page.screenshot({ path: `${SHOTS}/${w}-trips.png` });
    check(await page.locator('.side .side-link.active').innerText() === 'Trips', `${w} px: Trips is marked as the current page`);
    for (const [label, text] of [['Trophy Room', 'Trophy'], ['Group rules', 'Group rules'], ['Feed', 'Feed']]) {
      await page.locator('.side').getByText(label, { exact: true }).click();
      let ok = false; try { await page.locator('.page .hdr-title', { hasText: text }).first().waitFor({ timeout: 6000 }); ok = true; } catch { /* below */ }
      check(ok && await noSideScroll(page), `${w} px: ${label} opens, no sideways scroll`);
    }
    await page.screenshot({ path: `${SHOTS}/${w}-feed.png` });
  }
  await ctx.close();
}

// 3b. Score entry has its own .app inside the shell: on a laptop it must sit in the page column, not shift right again.
{
  const { ctx, page } = await newPage(1280, 900);
  await page.goto(LIVE + `#/score/${ROUND}`);
  await page.waitForTimeout(2500);
  const box = await page.evaluate(() => { const els = [...document.querySelectorAll('.app .app')]; const r = els[0]?.getBoundingClientRect(); return r ? { left: r.left, width: r.width } : null; });
  check(box && box.left >= 248 && box.left < 420 && box.width <= 900, `1280 px: score entry sits in the page column (left ${box && Math.round(box.left)}, width ${box && Math.round(box.width)})`);
  check(await noSideScroll(page), '1280 px: score entry has no sideways scroll');
  await page.screenshot({ path: `${SHOTS}/1280-score.png` });
  await ctx.close();
}

// 4. Keyboard: Tab reaches the sidebar with a visible focus outline; Enter follows the link.
{
  const { ctx, page } = await newPage(1280, 900);
  await page.goto(LIVE + '#/');
  await page.getByText('Saturday').first().waitFor({ timeout: 15000 });
  let found = false;
  for (let i = 0; i < 8 && !found; i++) {
    await page.keyboard.press('Tab');
    found = await page.evaluate(() => document.activeElement?.classList.contains('side-link') && document.activeElement.textContent.includes('Feed'));
  }
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle + ' ' + getComputedStyle(document.activeElement).outlineWidth);
  check(found && outline.startsWith('solid 3px'), `keyboard: Tab reaches Feed in the sidebar with a visible outline (${outline})`);
  await page.keyboard.press('Enter');
  check(await page.evaluate(() => window.location.hash === '#/feed'), 'keyboard: Enter opens Feed');
  await ctx.close();
}

// 5. Tell Josh from the sidebar: checks, then sends kind, words, screen and version.
{
  const { ctx, page } = await newPage(1280, 900);
  await page.goto(LIVE + '#/plan');
  await page.getByText('Spring Trip').first().waitFor({ timeout: 15000 });
  await page.locator('.side').getByText('Send feedback').click();
  await page.getByRole('dialog', { name: 'Send feedback' }).waitFor();
  await page.getByRole('button', { name: 'Something’s wrong' }).click();
  await page.locator('textarea').fill('ok');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  check(await page.getByText('Type a few words first').isVisible(), 'feedback: too short is caught before sending');
  check(!rpcs.some((r) => r.name === 'send_feedback'), 'feedback: nothing sent yet');
  await page.locator('textarea').fill('The trip page jumped when I tapped In');
  await page.screenshot({ path: `${SHOTS}/1280-tell-josh.png` });
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText('Sent. Thanks!').waitFor({ timeout: 5000 });
  const sent = rpcs.find((r) => r.name === 'send_feedback')?.body || {};
  check(sent.p_kind === 'problem' && sent.p_message === 'The trip page jumped when I tapped In' && sent.p_path === '#/plan' && !!sent.p_version,
    `feedback: sent problem / words / #/plan / version ${sent.p_version}`);
  check(!(await page.getByRole('dialog', { name: 'Send feedback' }).isVisible()), 'feedback: the sheet closes after sending');
  await ctx.close();
}

// 6. What's new: shows once on the new app (sign-in build), never on the live-style build.
{
  const { ctx, page } = await newPage(375, 812, { phone: true, seenNote: false });
  await page.goto(SIGNIN + '#/');
  let shown = false; try { await page.getByRole('dialog', { name: 'What’s new' }).waitFor({ timeout: 15000 }); shown = true; } catch { /* below */ }
  check(shown, 'what’s new: shows on the new app');
  await page.screenshot({ path: `${SHOTS}/375-whats-new.png` });
  if (shown) await page.getByRole('button', { name: 'Got it' }).click();
  await page.reload();
  await page.getByText('Saturday').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  check(!(await page.getByRole('dialog', { name: 'What’s new' }).isVisible()), 'what’s new: not shown again after Got it');
  await ctx.close();
  const b = await newPage(375, 812, { phone: true, seenNote: false });
  await b.page.goto(LIVE + '#/');
  await b.page.getByText('Saturday').first().waitFor({ timeout: 15000 });
  await b.page.waitForTimeout(800);
  check(!(await b.page.getByRole('dialog', { name: 'What’s new' }).isVisible()), 'what’s new: never on the live-style build');
  await b.ctx.close();
}

// 7. New groups off (live-style): no start links, and #/start says invite-only. On (staging-style): the wizard opens.
{
  member = false;
  const { ctx, page } = await newPage(375, 812, { phone: true });
  await page.goto(LIVE + '#/');
  await page.getByText('Join').first().waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
  check(!(await page.getByText(/Start your own|Start a new group/).first().isVisible().catch(() => false)), 'new groups off: the front door has no start link');
  await page.goto(LIVE + '#/start');
  let closed = false; try { await page.getByText('The Golf Trip is invite-only for now').waitFor({ timeout: 8000 }); closed = true; } catch { /* below */ }
  check(closed, 'new groups off: #/start says invite-only');
  await page.screenshot({ path: `${SHOTS}/375-start-closed.png` });
  await page.goto(SIGNIN + '#/');
  await page.waitForTimeout(1500);
  check(await page.getByText('Start a new group').first().isVisible().catch(() => false), 'new groups on (staging): the front door offers Start a new group');
  await page.goto(SIGNIN + '#/start');
  await page.waitForTimeout(2000);
  check(!(await page.getByText('invite-only').first().isVisible().catch(() => false)), 'new groups on (staging): #/start opens the wizard');
  await page.screenshot({ path: `${SHOTS}/375-start-open.png` });
  member = true;
  await ctx.close();
}

// 8. "Who are you?" (in the group, no player yet): one line points to the personal link (Josh 22 Oct: the paste box was redundant).
{
  noPlayer = true;
  const { ctx, page } = await newPage(375, 812, { phone: true });
  await page.goto(SIGNIN + '#/');
  await page.getByText('Who are you?').waitFor({ timeout: 15000 });
  check(await page.getByText(/Got a personal link from your organiser\? Tap it/).isVisible(), 'who are you: a one-line pointer to the personal link (no paste box)');
  check(!(await page.getByLabel('Your personal link').count()), 'who are you: no personal-link paste box');
  await page.screenshot({ path: `${SHOTS}/375-who-are-you.png` });
  noPlayer = false;
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
