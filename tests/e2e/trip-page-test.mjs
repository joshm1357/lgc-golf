// ov27 (23 Oct 2026, Josh's walkthrough review): the trip page, money, guests and first open.
//   R1 — "Your weekend" at the top of a locked-in trip on a phone, then Your to-dos, the rest folded (each part once)
//   M1 — one money line per person ("pay Josh"), "I've paid" → waiting with no Pay button, the organiser's short list
//        with one Remind, the full table behind Details, "You owe" (never "YOU owes")
//   R2 — the guest view: "You're Josh's guest…", no votes / Organise / group rules, never a to-do without a button
//   F1 — first open: the organiser's three-step start (invite with who's joined), the new player's welcome, the
//        notifications card gone after "Not now"
// No real database: organise-fixtures' fake Supabase. Usage: node trip-page-test.mjs <baseUrl> <shotDir>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { makeDb, fakeSupabase, fakeContext, PC, K, AL, pid, GROUP } from './organise-fixtures.mjs';

const BASE = process.argv[2] || 'http://localhost:4173/lgc-golf/';
const SHOTS = process.argv[3] || './shots';
fs.mkdirSync(SHOTS, { recursive: true });
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const now = new Date().toISOString();
const UID = '99999999-9999-4999-8999-999999999999'; // the fake session's user (fakeContext)

// ---------------------------------------------------------------- the database
const db = makeDb();
const TRIP = 'aaaaaaaa-2700-4000-8000-000000000001';
const R1 = 'dddddddd-2700-4000-8000-000000000001';
const R2 = 'dddddddd-2700-4000-8000-000000000002';
const C1 = 'cccccccc-2700-4000-8000-000000000001';
const pc = db.plans.find((p) => p.id === PC);
Object.assign(pc, { trip_id: TRIP, address: '12 Beach Rd, Shoalhaven Heads NSW' });
db.trips = [{ id: TRIP, name: 'Autumn Trip', start_date: pc.start_date, end_date: pc.end_date, status: 'upcoming', created_at: now }];
db.courses = [{ id: C1, name: 'Shoalhaven Heads GC', holes: Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 })), created_at: now }];
db.rounds = [
  { id: R1, trip_id: TRIP, course_id: C1, name: 'Day 1', play_date: pc.start_date, format: 'stableford', status: 'setup', ld_holes: [], ctp_holes: [], comp_bonus: 0, created_at: now },
  { id: R2, trip_id: TRIP, course_id: C1, name: 'Day 2', play_date: pc.end_date, format: 'ambrose', status: 'setup', ld_holes: [], ctp_holes: [], comp_bonus: 0, created_at: now },
];
db.tee_groups = [{ id: crypto.randomUUID(), round_id: R1, group_no: 1, tee_time: '07:52', start_hole: null, player_ids: [pid(4), pid(2), pid(3)] }];
const CAR = 'ffffffff-2700-4000-8000-000000000001';
db.plan_groups.push({ id: CAR, plan_id: PC, group_id: GROUP, kind: 'car', name: 'Josh’s car', capacity: 4, driver_id: K, pickup_place: 'Leichhardt', pickup_time: '6:30am', sort: 0, created_at: now });
db.plan_group_members.push({ group_id: CAR, player_id: K }, { group_id: CAR, player_id: pid(4) });
// Di (pid 4) is in and has paid nothing; Cy (pid 3) sent his deposit (not ticked off yet); Bo (pid 2) paid his.
const DI = pid(4);
const CY = pid(3);
db.group_members = [];

let me = { id: K, admin: true, role: 'organiser' };
const fake = fakeSupabase(db, () => me);
const handler = async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname.endsWith('/rpc/my_status') && me.role === 'guest') {
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ is_member: true, is_admin: false, player_id: me.id, group_name: 'Test Golfers', group_id: GROUP, role: 'guest', legacy: false, groups: [{ id: GROUP, name: 'Test Golfers', slug: 'test', role: 'guest' }] }) });
  }
  return fake.handler(route);
};
const as = (who, role = 'player') => { me = who === K ? { id: K, admin: true, role: 'organiser' } : { id: who, admin: false, role }; };

const browser = await chromium.launch();
const errors = [];
async function open(width = 375, { seed = null } = {}) {
  const ctx = await fakeContext(browser, { handler }, width > 500 ? { width, height: 900, mobile: false } : {});
  if (seed) await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  return { ctx, page };
}
const noSideScroll = async (page, label) => {
  const w = await page.evaluate(() => document.scrollingElement.scrollWidth);
  check(w <= 375, `${label}: no sideways scroll (${w}px)`);
};
const openMore = async (page) => {
  const more = page.getByTestId('runup-more');
  if (!(await more.evaluate((d) => d.open))) await more.locator('summary').click();
  await page.waitForTimeout(500);
};

// ---------------------------------------------------------------- R1: Your weekend at the top, on a phone
{
  as(DI);
  const { ctx, page } = await open(375);
  await page.goto(`${BASE}#/plan/${PC}`);
  await page.getByTestId('your-weekend').waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  const yw = await page.getByTestId('your-weekend').boundingBox();
  check(yw && yw.y < 260, `Your weekend is at the top of the page (${Math.round(yw?.y)}px down)`);
  check(!(await page.getByTestId('next-step').count()), 'no separate Next step card above it (the to-dos carry it)');
  const text = await page.getByTestId('your-weekend').innerText();
  check(/days to go/.test(text) && /12 Beach Rd, Shoalhaven Heads NSW/.test(text), 'dates, countdown and the house address');
  check(/maps/.test(await page.getByTestId('yw-address').getAttribute('href')), 'the address opens in Maps');
  check(/Shoalhaven Heads GC/.test(text) && /7:52am with Bo and Cy/.test(text), 'each day: the course, my tee time and my group');
  check(/Josh’s car · pick-up Leichhardt 6:30am/.test(await page.getByTestId('yw-car').innerText()), 'my car');
  check(/still to pay \$\d[\d,.]* to Josh/.test(await page.getByTestId('money-line').innerText()), 'paid and owed: one money line, "to Josh"');
  check(/Seats confirmed: 1 of 5 \(paid\)/.test(await page.getByTestId('yw-seats').innerText()), `I7: seats confirmed (${await page.getByTestId('yw-seats').innerText()})`);
  const order = await page.evaluate(() => {
    const ids = ['your-weekend', 'runup-todos', 'runup-more'];
    return ids.map((id) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().top ?? -1);
  });
  check(order[0] < order[1] && order[1] < order[2], 'order: Your weekend → Your to-dos → More about this trip');
  check(!(await page.getByTestId('runup-grabs').isVisible().catch(() => false)), 'everything else is folded away');
  await page.screenshot({ path: `${SHOTS}/r1-your-weekend-375.png`, fullPage: false });
  const tall = await page.evaluate(() => document.scrollingElement.scrollHeight);
  check(tall < 2600, `the page is one short scroll before More (${tall}px)`);
  await openMore(page);
  for (const id of ['runup-cars', 'runup-votes', 'runup-grabs', 'runup-rules', 'runup-bring', 'runup-chat', 'overview-days']) {
    check(await page.getByTestId(id).count() === 1, `More about this trip: ${id.replace(/^(runup|overview)-/, '')} shows once`);
  }
  check(await page.getByText('What’s up for grabs', { exact: false }).count() <= 1 || await page.getByTestId('runup-grabs').count() === 1, '"What’s up for grabs" once');
  await page.screenshot({ path: `${SHOTS}/r1-more-375.png`, fullPage: true });
  await noSideScroll(page, 'trip page');
  // The deposit to-do's Pay goes to the money line.
  await page.getByTestId('runup-more').locator('summary').click();
  await page.getByTestId('todo-pay').click();
  await page.waitForTimeout(700);
  const ml = await page.getByTestId('money-line').boundingBox();
  check(ml && ml.y >= 0 && ml.y < 812, 'the to-do’s Pay button brings the money line into view');
  await ctx.close();
}

// ---------------------------------------------------------------- M1: the money line, "I've paid", the organiser's list
{
  as(DI);
  const { ctx, page } = await open(375);
  await page.goto(`${BASE}#/plan/${PC}`);
  await page.getByTestId('money-line').waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
  const before = await page.getByTestId('money-words').innerText();
  check(/^Your share \$[\d,.]+ · still to pay \$[\d,.]+ to Josh$/.test(before), `Di: "${before}"`);
  check(await page.getByTestId('money-line').getByText('PayID 0400 000 000 — Josh').isVisible(), 'the PayID is right there (tap to copy)');
  await page.getByTestId('ive-paid').click();
  await page.waitForTimeout(900);
  check(db.plan_transfers.some((t) => t.from_id === DI && !t.to_id && !t.confirmed), '"I’ve paid" records it as paid to Josh, for him to tick off');
  const after = await page.getByTestId('money-words').innerText();
  check(/waiting for Josh to confirm/.test(after) && !(await page.getByTestId('ive-paid').count()), `after "I’ve paid": waiting for Josh to confirm, no Pay button ("${after}")`);
  check(!(await page.getByTestId('todo-deposit').count()), 'and no deposit to-do with a Pay button beside "waiting"');
  await page.screenshot({ path: `${SHOTS}/m1-waiting-375.png` });
  await ctx.close();

  // Cy sent his deposit, not ticked off yet: "waiting for a tick" and the rest still to pay.
  as(CY);
  const c = await open(375);
  await c.page.goto(`${BASE}#/plan/${PC}`);
  await c.page.getByTestId('money-line').waitFor({ timeout: 20000 });
  const cy = await c.page.getByTestId('money-words').innerText();
  check(/\$300 waiting for a tick/.test(cy) && /still to pay \$[\d,.]+ to Josh/.test(cy), `Cy: the deposit he sent counts as waiting ("${cy}")`);
  await c.ctx.close();

  // Josh (organiser): Kitty — his own line, the payments to tick, who still has to pay with ONE Remind, Details folded.
  as(K);
  const j = await open(375);
  await j.page.goto(`${BASE}#/plan/${PC}?view=organise&tab=kitty`);
  await j.page.getByTestId('still-to-pay').waitFor({ timeout: 20000 });
  await j.page.waitForTimeout(600);
  check(/You’re owed \$/.test(await j.page.getByTestId('money-words').innerText()), 'Josh fronted the house: "You’re owed …"');
  const list = await j.page.getByTestId('still-to-pay').innerText();
  check(/Still to pay you/.test(list) && /Di/.test(list) && /Al/.test(list), `the short list of who still has to pay (${list.replace(/\n/g, ' ')})`);
  check(await j.page.getByTestId('remind').count() === 1, 'one Remind button');
  check(await j.page.getByTestId('confirm-payment').count() >= 2, 'payments waiting for his tick (Cy and Di)');
  check(!(await j.page.getByText('Who pays who', { exact: true }).isVisible().catch(() => false)), 'the full table is behind Details');
  await j.page.getByTestId('kitty-details').locator('summary').click();
  await j.page.getByText('Who pays who', { exact: true }).waitFor({ timeout: 5000 });
  const body = await j.page.locator('.page').innerText();
  check(!/YOU owes|the kitty →|→ the kitty/i.test(body), 'no "YOU owes" and no "pay the kitty" anywhere');
  check(/You’re owed \$/.test(await j.page.getByTestId('you-label').innerText()), 'Details: "You’re owed", in plain grammar');
  await j.page.screenshot({ path: `${SHOTS}/m1-organiser-375.png`, fullPage: true });
  const n0 = fake.notifyCalls.length;
  await j.page.getByTestId('remind').click();
  await j.page.waitForTimeout(800);
  check(fake.notifyCalls.slice(n0).some((n) => n.type === 'nudge_kitty'), 'Remind sends the reminder');
  await j.page.getByTestId('confirm-payment').filter({ hasText: 'Cy' }).getByRole('button', { name: '✓ Got it' }).click();
  await j.page.waitForTimeout(800);
  check(db.plan_transfers.some((t) => t.from_id === CY && t.confirmed), 'Got it ticks Cy’s deposit off');
  await noSideScroll(j.page, 'kitty');
  await j.ctx.close();
}

// ---------------------------------------------------------------- R2: the guest view
{
  const GUEST = pid(7); // Gus
  db.plan_rsvps.push({ plan_id: PC, player_id: GUEST, status: 'in', updated_at: now });
  db.plan_group_members.push({ group_id: CAR, player_id: GUEST });
  as(GUEST, 'guest');
  const { ctx, page } = await open(375);
  await page.goto(`${BASE}#/plan/${PC}?view=organise`);
  await page.getByTestId('your-weekend').waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  check(/You’re Josh’s guest for the Autumn Trip/.test(await page.getByTestId('guest-heading').innerText()), 'the guest heading');
  check(!(await page.getByRole('tab', { name: /Organise/ }).count()), 'no Organise (even from an Organise link)');
  const yw = await page.getByTestId('your-weekend').innerText();
  check(/Josh’s car/.test(yw) && /Shoalhaven Heads GC/.test(yw) && /still to pay/.test(yw), 'when, where, the course, their car and their share');
  const rows = await page.locator('.ru-todo').evaluateAll((els) => els.map((e) => !!e.querySelector('button, a')));
  check(rows.every(Boolean), `never a to-do without a button (${rows.length} to-do${rows.length === 1 ? '' : 's'})`);
  check(!(await page.getByTestId('todo-reply').count()) && !(await page.getByTestId('todo-handicap').count()), 'no "say if you’re in" or handicap to-dos');
  await openMore(page);
  check(!(await page.getByTestId('runup-votes').count()) && !(await page.getByTestId('runup-rules').count()) && !(await page.getByTestId('runup-tipping').count()), 'no votes, no group rules, no tipping');
  check(await page.getByTestId('runup-cars').isVisible() && /Gus/.test(await page.getByTestId('runup-cars').innerText()), 'guests are in the cars');
  await page.screenshot({ path: `${SHOTS}/r2-guest-375.png`, fullPage: true });
  await noSideScroll(page, 'guest view');
  await ctx.close();
}

// ---------------------------------------------------------------- F1: first open
{
  // The organiser of a brand-new group: no trips yet, two mates have joined.
  const saved = { plans: db.plans, rsvps: db.plan_rsvps, trips: db.trips };
  db.plans = [];
  db.plan_rsvps = [];
  db.trips = [];
  db.group_members = [
    { group_id: GROUP, user_id: UID, player_id: K, role: 'organiser', created_at: now },
    { group_id: GROUP, user_id: crypto.randomUUID(), player_id: pid(2), role: 'player', created_at: now },
  ];
  as(K);
  const { ctx, page } = await open(375);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`${BASE}#/plan`);
  await page.getByTestId('organiser-start').waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
  check(await page.locator('[data-testid^="fo-step-"]').count() === 3, 'the organiser gets a three-step start');
  check(/Bo has joined/.test(await page.getByTestId('starter-joined').innerText()), 'I1: who has joined, live');
  check(!(await page.getByTestId('trips-plan-it').count()) && !(await page.getByTestId('plan-with-ai').count()), 'one way to start a trip (step 2), not five');
  check(!(await page.getByRole('button', { name: 'Turn on notifications' }).count()) || await page.getByTestId('starter-notify').count() === 1, 'notifications are step 3 (no second card)');
  await page.getByTestId('starter-invite').click();
  await page.waitForTimeout(700);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  check(/Test Golfers/.test(clip) && /#\/join\/ABCDEFGH2345/.test(clip) && /pick your name/.test(clip), 'a ready-made group-chat message with the invite link');
  // Another mate joins → the list updates (it checks every 20 seconds).
  db.group_members.push({ group_id: GROUP, user_id: crypto.randomUUID(), player_id: pid(3), role: 'player', created_at: now });
  await page.getByText('Bo and Cy have joined').waitFor({ timeout: 25000 }).then(() => check(true, 'I1: Cy turns up in the list'), () => check(false, 'I1: Cy turns up in the list'));
  check(await page.getByTestId('fo-step-invite').getAttribute('data-done') === '1', 'step 1 ticks itself off once the invite’s out and mates have joined');
  await page.screenshot({ path: `${SHOTS}/f1-organiser-start-375.png`, fullPage: true });
  await page.getByTestId('starter-hide').click();
  await page.waitForTimeout(400);
  check(!(await page.getByTestId('organiser-start').count()), '"Hide this" puts it away');
  await ctx.close();

  // A new player: one welcome card — the group, the faces already in, nothing planned yet.
  db.group_members = [
    { group_id: GROUP, user_id: crypto.randomUUID(), player_id: K, role: 'organiser', created_at: '2026-01-01T00:00:00Z' },
    { group_id: GROUP, user_id: UID, player_id: AL, role: 'player', created_at: now },
  ];
  as(AL);
  const p2 = await open(375);
  await p2.page.goto(`${BASE}#/plan`);
  await p2.page.getByTestId('welcome-card').waitFor({ timeout: 20000 });
  const w = await p2.page.getByTestId('welcome-card').innerText();
  check(/Welcome to Test Golfers/.test(w) && /2 people in so far/.test(w) && /Nothing planned yet/.test(w), `new player: the welcome card (${w.replace(/\n/g, ' / ')})`);
  check(!(await p2.page.getByTestId('organiser-start').count()), 'players don’t get the organiser’s start');
  await p2.page.screenshot({ path: `${SHOTS}/f1-welcome-375.png`, fullPage: true });
  await p2.page.getByTestId('welcome-close').click();
  await p2.page.reload();
  await p2.page.waitForTimeout(2500);
  check(!(await p2.page.getByTestId('welcome-card').count()), 'put away for good');
  await p2.ctx.close();
  db.plans = saved.plans;
  db.plan_rsvps = saved.rsvps;
  db.trips = saved.trips;
  db.group_members = [];
}

check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n${fails.join('\n')}` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
