// "Call it off" instead of delete (ov21, 23 Oct 2026). A live trip ("March") was hard-deleted last night with one tap
// on a browser "OK" box. Checks: Edit → ✋ Call it off (in-app sheet, no browser box) keeps everything and shows
// "Called off by Josh · Bring it back"; Bring it back undoes it; members see it in a folded "Called off" section on
// Trips; a plan with replies/votes is never offered Delete; an EMPTY plan can be deleted only after typing its name.
// Fake database only (organise-fixtures.mjs). Usage: node tests/e2e/calloff-test.mjs <base> <shotDir>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import { makeDb, fakeSupabase, fakeContext, PA, PB, K, AL } from './organise-fixtures.mjs';

const BASE = process.argv[2] || 'http://localhost:4402/lgc-golf/';
const SHOTS = process.argv[3] || './shots-calloff';
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
const dialogs = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
const plan = (id) => db.plans.find((p) => p.id === id);
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
const openPlan = async (id) => {
  await page.goto(`${BASE}#/plan/${id}?view=organise`);
  await page.getByRole('button', { name: 'Edit' }).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
};

// 1. A trip with votes, replies and chat (PB): Call it off, never Delete.
await openPlan(PB);
await page.getByRole('button', { name: 'Edit' }).first().click();
await page.getByTestId('call-it-off').waitFor({ timeout: 5000 });
check(await page.getByTestId('delete-plan').count() === 0, 'a plan with votes and replies: no Delete offered');
check(await page.getByTestId('no-delete-note').isVisible(), 'it says why: call it off instead (keeps everything)');
await page.getByTestId('call-it-off').scrollIntoViewIfNeeded();
await shot('1-edit-call-it-off');
await page.getByTestId('call-it-off').click();
await page.getByTestId('confirm-sheet').waitFor({ timeout: 5000 });
check((await page.getByTestId('confirm-sheet').innerText()).includes('Everything’s kept'), 'in-app sheet: “Everything’s kept …”');
await shot('2-call-off-sheet');
await page.getByTestId('confirm-yes').click();
await page.getByTestId('called-off-banner').waitFor({ timeout: 8000 });
check(plan(PB).status === 'cancelled' && plan(PB).cancelled_by === K, 'called off: status cancelled, who recorded (call_off_plan)');
check(fake.rpcCalls.some((c) => c.name === 'call_off_plan' && c.body.p_off === true), 'call_off_plan(p_off: true) used');
check(db.plan_votes.length === 7 && db.plan_comments.length === 1, 'votes and chat all kept');
const banner = await page.getByTestId('called-off-banner').innerText();
check(/Called off by Josh/.test(banner), `banner: “${banner.split('\n')[0]}”`);
await shot('3-called-off-banner');

// 2. Members: a folded "Called off" section on Trips.
me = { id: AL, admin: false };
await page.goto(`${BASE}#/plan`); await page.reload();
await page.getByTestId('called-off').waitFor({ timeout: 15000 });
check(!(await page.getByTestId('called-off').evaluate((e) => e.open)), 'Trips: “Called off” is folded away');
await page.getByTestId('called-off').locator('summary').click();
const co = await page.getByTestId('called-off').innerText();
check(co.includes('Spring away') && /Called off by Josh/.test(co), 'opened: Spring away · Called off by Josh');
await shot('4-trips-called-off-section');
// A member can't bring it back.
await page.goto(`${BASE}#/plan/${PB}`);
await page.getByTestId('called-off-banner').waitFor({ timeout: 15000 });
check(await page.getByTestId('bring-it-back').count() === 0, 'a player sees the banner but no Bring it back');

// 3. The organiser brings it back.
me = { id: K, admin: true };
await page.reload();
await page.getByTestId('bring-it-back').waitFor({ timeout: 15000 });
await page.getByTestId('bring-it-back').click();
await page.waitForFunction(() => !document.querySelector('[data-testid="called-off-banner"]'), null, { timeout: 8000 }).catch(() => {});
check(plan(PB).status === 'planning' && !plan(PB).cancelled_by, 'Bring it back: planning again');
await shot('5-brought-back');

// 4. An empty plan (March: no replies, votes or jobs): Delete only after typing its name.
await openPlan(PA);
await page.getByRole('button', { name: 'Edit' }).first().click();
await page.getByTestId('delete-plan').waitFor({ timeout: 5000 });
await page.getByTestId('delete-plan').click();
await page.getByTestId('confirm-type').waitFor({ timeout: 5000 });
check(await page.getByTestId('confirm-yes').isDisabled(), 'Delete for good is greyed out until the name is typed');
await page.getByTestId('confirm-type').fill('Marc');
check(await page.getByTestId('confirm-yes').isDisabled(), 'a wrong name keeps it greyed out');
await shot('6-delete-type-name');
await page.getByTestId('confirm-type').fill('march');
check(await page.getByTestId('confirm-yes').isEnabled(), 'typing “march” (any case) unlocks it');
await page.getByTestId('confirm-yes').click();
await page.waitForFunction(() => location.hash === '#/plan', null, { timeout: 8000 }).catch(() => {});
check(!plan(PA) && fake.rpcCalls.some((c) => c.name === 'delete_empty_plan' && c.body.p_plan === PA), 'empty plan deleted with delete_empty_plan, back to Trips');

check(dialogs.length === 0, `no browser “OK” boxes at all (${dialogs.join(' | ')})`);
check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n${fails.join('\n')}` : '\nAll passed.');
process.exit(fails.length ? 1 : 0);
