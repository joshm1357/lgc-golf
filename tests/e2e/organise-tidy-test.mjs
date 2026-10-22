// The Organise tidy-up (ov14, 22 Oct — Josh: "The organiser screen is a bit messy … not clear where to start"):
// one trip walked from brand new → planned → vote → booked → locked in, checking the six steps advance and there's
// only ever ONE big button. Also: the Overview has the open votes front and centre and nothing organiser-only.
// Fake database only (organise-fixtures.mjs). Usage: node tests/e2e/organise-tidy-test.mjs <base> <shotDir>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import { makeDb, fakeSupabase, fakeContext, PA, PB, PC, K, AL, plusDays } from './organise-fixtures.mjs';

const BASE = process.argv[2] || 'http://localhost:4402/lgc-golf/';
const SHOTS = process.argv[3] || './shots-organise-tidy';
fs.mkdirSync(SHOTS, { recursive: true });

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const db = makeDb();
let me = { id: K, admin: true };
const fake = fakeSupabase(db, () => me);
const browser = await chromium.launch();
const ctx = await fakeContext(browser, fake);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());
const wait = (ms = 500) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
const plan = () => db.plans.find((p) => p.id === PA);
const CALL = 'aaaaaaaa-0000-4000-8000-0000000000c1';
const callJob = () => db.plan_items.find((j) => j.id === CALL);
const mineOnA = () => db.plan_votes.filter((v) => v.player_id === AL && db.plan_polls.some((p) => p.id === v.poll_id && p.plan_id === PA));
const open = async (q = 'view=organise') => {
  await page.goto(`${BASE}#/plan/${PA}?${q}`);
  await page.reload();
  await page.getByTestId(q.includes('overview') ? 'overview-glance' : 'organise-steps').waitFor({ timeout: 15000 });
  await wait(700);
};
const states = async () => Object.fromEntries(await Promise.all(['plan', 'vote', 'book', 'lockin', 'money', 'day']
  .map(async (k) => [k, await page.getByTestId(`step-${k}`).getAttribute('data-state')])));
const primary = () => page.getByTestId('primary');
const golds = () => page.locator('.btn.gold:visible').count();
const noSideScroll = async (label) => {
  const w = await page.evaluate(() => document.scrollingElement.scrollWidth);
  check(w <= 376, `${label}: no sideways scroll (${w}px)`);
};

// 1. Brand new ("March", a place only): Plan is current, with one big button.
await open();
let s = await states();
check(s.plan === 'current' && ['vote', 'book', 'lockin', 'money', 'day'].every((k) => s[k] === 'later'), `new trip: Plan is current, the rest greyed (${JSON.stringify(s)})`);
check((await primary().innerText()) === 'Start: plan where and when', 'new trip: the big button is "Start: plan where and when"');
check(await golds() === 1, `new trip: one big button on the page (${await golds()})`);
check((await page.getByTestId('step-plan').innerText()).includes('Hunter Valley'), 'new trip: the Plan step says the place so far');
check(await page.getByTestId('organise-more').getByRole('tab', { name: '💬 Chat' }).isVisible(), 'chat is under More');
await shot('01-new');
await noSideScroll('new trip');
// A later step is greyed but still opens.
await page.getByTestId('step-money').getByRole('button').first().click();
await page.getByRole('tab', { name: '📋 Jobs' }).waitFor({ timeout: 5000 });
check(await page.getByTestId('step-money').getAttribute('data-state') === 'later', 'a greyed step still opens (Jobs & money)');
check(await page.getByTestId('next-step').isVisible() && await golds() === 1, 'looking at another step: the Next step still shows, still one big button');
// The Overview: nothing organiser-only.
await open('view=overview');
check(await page.getByTestId('next-step').count() === 0 && await page.getByTestId('tb-link').count() === 0 && await page.getByTestId('primary').count() === 0, 'Overview: no organiser Next step or Build the trip');
check((await page.getByTestId('overview-stage').innerText()).includes('Still being decided'), 'Overview: a trip being decided doesn’t say "Locked in"');

// 2. Planned → put to a vote ("Call a vote yourself" on the Plan step).
await open();
await page.getByRole('button', { name: '🗳️ Call a vote yourself' }).click();
const dates = page.locator('.sheet input[type=date]');
await dates.nth(1).fill(plusDays(40)); await dates.nth(2).fill(plusDays(42));
await dates.nth(3).fill(plusDays(47)); await dates.nth(4).fill(plusDays(49));
await page.locator('.sheet').getByRole('button', { name: '🗳️ Call the vote' }).click();
await page.getByRole('button', { name: 'Done' }).click();
await wait(800);
check(db.plan_polls.some((p) => p.plan_id === PA && p.kind === 'dates' && p.status === 'open'), 'a dates vote is open');
// A call to a course for tee times (the trip builder makes these).
db.plan_items.push({ id: CALL, plan_id: PA, kind: 'job', title: '📞 Call Cypress Lakes for tee times', owner_id: null, stage: 'todo', done: false, created_by: K, created_at: new Date().toISOString() });
await open();
s = await states();
check(s.plan === 'done' && s.vote === 'current', `vote open: Plan ✓, Vote is current (${JSON.stringify(s)})`);
check((await primary().innerText()) === 'Pick the winner', 'vote open: the big button is "Pick the winner"');
check(await golds() === 1, 'vote open: still one big button');
await shot('02-vote');

// 3. A player votes on the Overview (votes front and centre).
me = { id: AL, admin: false };
await page.goto(`${BASE}#/plan/${PA}`);
await page.reload();
await page.getByTestId('vote-now').waitFor({ timeout: 15000 });
check(new URL(page.url()).hash.includes('view') === false || page.url().includes('overview'), 'a player opens on the Overview');
check(await page.getByTestId('organise-steps').count() === 0, 'a player lands on the Overview, not Organise');
await page.getByTestId('vote-now').locator('[data-answer="yes"]').first().click(); await wait(400);
await page.getByTestId('vote-now').locator('[data-answer="no"]').last().click(); await wait(600);
check(mineOnA().length === 2 && mineOnA().every((v) => ['yes', 'no'].includes(v.response)), 'the player’s answers are saved');
await shot('03-player-overview');
await page.goto(`${BASE}#/plan/${PA}?view=overview`);
await page.reload();
await page.getByTestId('voted').waitFor({ timeout: 15000 });
check((await page.getByTestId('voted').innerText()).includes('You’ve voted ✓'), 'after voting: "You’ve voted ✓ — see results"');
me = { id: K, admin: true };

// 4. Pick the winner → Book (the calls).
await open();
await primary().click();
await page.getByRole('button', { name: 'Pick this winner' }).click();
await wait(900);
check(!!plan().start_date, 'the winning weekend is the trip’s dates');
await open();
s = await states();
check(s.vote === 'done' && s.book === 'current', `vote decided: Vote ✓, Book is current (${JSON.stringify(s)})`);
check((await page.getByTestId('step-vote').innerText()).includes('Hunter Valley'), 'Vote folds to a one-line summary (place · dates)');
check((await primary().innerText()) === 'Allocate the calls', 'Book: "Allocate the calls"');
await primary().click();
await page.locator('.sheet').getByRole('button', { name: /Al/ }).first().click();
await wait(800);
check(callJob().owner_id === AL, 'the call is allocated to Al');
await shot('04-book');
callJob().stage = 'done';
callJob().done = true;

// 5. Calls done → Lock in.
await open();
s = await states();
check(s.lockin === 'current', `calls done: Lock in is current (${JSON.stringify(s)})`);
check((await primary().innerText()) === 'Lock it in', 'Lock in: "Lock it in"');
await primary().click();
await wait(1200);
check(plan().status === 'confirmed', 'locked in');
check(db.plan_items.some((j) => j.plan_id === PA && j.formula_key === 'shortlist_stay'), 'locking in made the to-do list');
await open();
check((await page.getByTestId('step-lockin').innerText()).includes('Locked in'), 'Lock in says "Locked in"');
check(await page.getByTestId('step-book').getAttribute('data-state') === 'current', 'after locking in: the accommodation (Book) is next');
await shot('05-locked');

// 6. Accommodation booked → the deposit (Lock in).
db.plan_stays.push({ id: 'aaaaaaaa-0000-4000-8000-0000000000d1', plan_id: PA, group_id: db.plans[0].group_id, name: 'Vineyard house', chosen: true, total_cost: 2400, created_at: new Date().toISOString() });
for (const j of db.plan_items.filter((x) => x.plan_id === PA && ['shortlist_stay', 'reserve_stay'].includes(x.formula_key))) { j.stage = 'done'; j.done = true; j.amount = 2400; }
await open();
s = await states();
check(s.plan === 'done' && s.vote === 'done' && s.book === 'done' && s.lockin === 'current' && s.money === 'later', `booked: steps 1–3 ✓, Lock in current (${JSON.stringify(s)})`);
check((await page.getByTestId('step-book').innerText()).includes('Vineyard house'), 'Book folds to "🏠 Vineyard house"');
check((await primary().innerText()) === 'Open the trip plan', 'Lock in: set the deposit (Open the trip plan)');
await shot('06-deposit');
await noSideScroll('deposit step');

// 7. Old links still land in the right place.
await open('tab=jobs');
check(await page.getByRole('tab', { name: '📋 Jobs' }).getAttribute('aria-selected') === 'true', '?tab=jobs opens Jobs & money on Jobs');
await open('tab=people');
check(await page.getByTestId('step-lockin').locator('.org-step-body').isVisible(), '?tab=people opens Lock in');
await open('tab=chat');
check(await page.getByTestId('organise-more').getByRole('tab', { name: '💬 Chat' }).getAttribute('aria-selected') === 'true', '?tab=chat opens More → Chat');

// 8. On a laptop: the strip across the top, a slim status column, one big button; the costs once.
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${BASE}#/plan/${PC}?view=organise`);
await page.reload();
await page.getByTestId('organise-panels').waitFor({ timeout: 15000 });
await wait(800);
check(await page.getByRole('list', { name: 'Organising steps' }).isVisible(), 'laptop: the steps across the top');
check(await page.locator('.org-strip [aria-current="step"]').innerText().then((t) => t.includes('Lock in')), 'laptop: the strip marks the current step (Lock in, deposits)');
check(await golds() === 1, `laptop: one big button (${await golds()})`);
await page.goto(`${BASE}#/plan/${PC}?view=organise&tab=kitty`);
await page.getByTestId('costs-table').waitFor({ timeout: 10000 });
await wait(500);
check(await page.getByTestId('step-money').getByText('Paid by Josh · split').count() === 0, 'laptop: the costs show once (the table), not a second list');
await shot('07-laptop-kitty');
// The demo trip's Overview, as the organiser: the vote is a ballot, the organiser results are on Organise.
await page.goto(`${BASE}#/plan/${PB}?view=overview`);
await page.reload();
await page.getByTestId('overview-votes').waitFor({ timeout: 15000 });
check(await page.locator('[data-testid="overview-votes"] [data-view="organiser"]').count() === 0, 'Overview: the organiser sees the ballot, not the results dashboard');
await shot('08-laptop-overview');

check(!errors.length, `no page errors (${errors.join(' | ')})`);
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
