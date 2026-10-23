// ov26 (Josh's walkthrough, 23 Oct 2026): votes and the organiser's planning flow. Fake database only.
//   V1  Locking in closes the open votes on where and when (one box); they show as one "Decided: …" line; a vote on
//       anything else stays open; a quiet player no longer gets "Vote now: Where and when?".
//   O5  A weekend falls through: one banner ("… is out. … works at both courses → Go with …"), "Open it up" hidden
//       while a weekend works; going with the backup posts ONE Feed message and sends a one-tap "Still good for …?"
//       (I6) that players see; when nothing works, "+ Backup" puts the new weekend in the caller's job (back to To do,
//       they're told) with one Feed post — and the dead weekend is never offered again.
//   I3  The last day of a vote: "Waiting on …" with a "Nudge them in the group chat" button.
//   I5  When the last call's done, the caller's moment goes in the Feed ("Al rang 2 courses …").
// Usage: node tests/e2e/ov26-votes-test.mjs <base> <shotDir>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { makeDb, fakeSupabase, fakeContext, PB, K, AL, plusDays, GROUP } from './organise-fixtures.mjs';

const BASE = process.argv[2] || 'http://localhost:4351/lgc-golf/';
const SHOTS = process.argv[3] || './shots-ov26';
fs.mkdirSync(SHOTS, { recursive: true });
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const now = new Date().toISOString();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const add = (s, n) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return iso(d); };

const db = makeDb();
let me = { id: K, admin: true };
const fake = fakeSupabase(db, () => me);
const browser = await chromium.launch();
const ctx = await fakeContext(browser, fake);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const wait = (ms = 500) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
const planB = () => db.plans.find((p) => p.id === PB);

// ================================================================ V1: lock-in closes the planning votes
// "Spring away" has its "Where and when?" card open; give it dates and a place, and a vote on something else.
Object.assign(planB(), { start_date: plusDays(40), end_date: plusDays(42), location_name: 'Pokolbin' });
const SHIRT = crypto.randomUUID();
db.plan_polls.push({ id: SHIRT, plan_id: PB, group_id: GROUP, kind: 'other', question: 'Shirt colour?', status: 'open', closes_on: plusDays(5), created_by: K, created_at: now });
db.plan_options.push({ id: crypto.randomUUID(), poll_id: SHIRT, group_id: GROUP, label: 'Pink', created_by: K, created_at: now }, { id: crypto.randomUUID(), poll_id: SHIRT, group_id: GROUP, label: 'Navy', created_by: K, created_at: now });

// ================================================================ I3: the last day of a vote
const sydToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
db.vote_batches.find((b) => b.plan_id === PB).closes_on = sydToday;
await page.goto(`${BASE}#/plan/${PB}?view=organise&step=area`);
await page.getByTestId('last-day-nudge').first().waitFor({ timeout: 15000 });
const nudgeText = await page.getByTestId('last-day-nudge').first().innerText();
check(/Last day · Waiting on \w+/.test(nudgeText) && /Nudge them in the group chat/.test(nudgeText), `I3: "Waiting on …" and a nudge for the group chat (${nudgeText.replace(/\n/g, ' / ')})`);
await shot('i3-01-last-day');

await page.goto(`${BASE}#/plan/${PB}?view=organise&step=lockin`);
await page.getByTestId('lock-in-card').waitFor({ timeout: 15000 });
await page.getByTestId('lock-in-card').click();
await page.getByTestId('confirm-sheet').waitFor({ timeout: 5000 });
const box = await page.getByTestId('confirm-sheet').innerText();
check(/The 2 open votes on where and when close and show as decided/.test(box), `one box that says the votes close (${box.split('\n')[0]})`);
await shot('v1-01-lock-box');
await page.getByTestId('confirm-yes').click(); await wait(1500);
check(planB().status === 'confirmed', 'locked in');
const pb = db.plan_polls.filter((p) => p.plan_id === PB);
check(pb.filter((p) => p.vote_batch).every((p) => p.status === 'closed'), 'the where-and-when votes closed');
check(pb.find((p) => p.id === SHIRT).status === 'open', 'the vote on something else stays open');
check(db.plan_items.some((j) => j.plan_id === PB && j.formula_key), 'the to-do list is made');
check(db.posts?.some((p) => /Spring away is locked in/.test(p.body)), 'one Feed post: locked in');

await page.goto(`${BASE}#/plan/${PB}?view=organise&step=area`);
await page.reload();
await page.getByTestId('decided-line').first().waitFor({ timeout: 15000 });
const decided = await page.getByTestId('decided-line').first().innerText();
check(/^✅\s*Decided: \w{3} \d+ – \w{3} \d+ \w{3}, Pokolbin/.test(decided.trim()), `the closed vote is one line (${decided.replace(/\n/g, ' / ')})`);
check(!/Up to step 1/.test(await page.getByTestId('up-to-line').innerText()), `O1: a locked-in trip isn't "up to step 1" (${await page.getByTestId('up-to-line').innerText()})`);
await shot('v1-02-decided');

// A quiet player: no "Vote now: Where and when?" any more — only the shirt vote.
me = { id: AL, admin: false };
await page.goto(`${BASE}#/plan/${PB}?view=overview`);
await page.reload();
await page.getByTestId('runup').waitFor({ timeout: 15000 }); await wait(1200); // ov25: a locked-in trip's page is the run-up
const body = await page.locator('body').innerText();
check(!/Where and when\?/.test(body) || !(await page.getByTestId('vote-now').filter({ hasText: 'Where and when' }).count()), 'a quiet player isn’t asked to vote on where and when after lock-in');
check(!(await page.getByTestId('vote-batch').count()), 'no open vote card for where and when');
await shot('v1-03-player-overview');

// ================================================================ O5: a weekend falls through
// A fresh trip: Hunter Valley, primary and backup weekends, golf on the Saturday at two courses; Al rang both.
const PD = 'eeeeeeee-0000-4000-8000-0000000000d1';
const fri = (() => { const d = new Date(); d.setDate(d.getDate() + 35); while (d.getDay() !== 5) d.setDate(d.getDate() + 1); return iso(d); })();
const W1 = { start: fri, end: add(fri, 2) }; const W2 = { start: add(fri, 7), end: add(fri, 9) }; const W3 = { start: add(fri, 14), end: add(fri, 16) };
const L = (n) => `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`;
const courses = {
  [L(1)]: { id: L(1), name: 'Stonebridge Golf Club', lat: -32.824, lng: 151.339 },
  [L(2)]: { id: L(2), name: 'Cypress Lakes Golf & Country Club', lat: -32.783, lng: 151.291 },
};
const J1 = crypto.randomUUID(); const J2 = crypto.randomUUID();
const state = {
  v: 1, region: 'Hunter Valley', regionOptions: ['Hunter Valley'], areaPool: ['Hunter Valley', 'South Coast NSW'], origin: null, nights: 2,
  weekends: [W1, W2], weekendPool: [W1, W2, W3], weekendsSettled: true, stays: [{ key: 'Pokolbin', name: 'Pokolbin', lat: -32.78, lng: 151.29 }], pins: [],
  stayMax: 40, detourMax: 25, days: [{ index: 0, leg: 'way', options: [] }, { index: 1, leg: 'stay', options: [L(1), L(2)] }, { index: 2, leg: 'home', options: [] }],
  courses, headcount: 8, votes: {}, optionKeys: {}, callsMade: true, callJobs: { [L(1)]: J1, [L(2)]: J2 }, configs: [], picked: null,
  areaCourses: { 'Hunter Valley': [L(1), L(2)] }, areaStays: {},
};
db.plans.push({ id: PD, kind: 'trip', name: 'Hunter run', status: 'planning', start_date: null, end_date: null, proposed: false, rsvp_locked: false, created_by: K, organiser_id: K, group_id: GROUP, created_at: now });
db.trip_builds.push({ plan_id: PD, group_id: GROUP, state });
const job = (id, name) => ({ id, plan_id: PD, group_id: GROUP, kind: 'job', title: `📞 Call ${name} — ask for 2 tee times in a row`, owner_id: AL, stage: 'done', done: true, due: plusDays(7), created_by: K, created_at: now });
db.plan_items.push(job(J1, 'Stonebridge Golf Club'), job(J2, 'Cypress Lakes Golf & Country Club'));
const sat = (w) => add(w.start, 1);
const tee = (date, c, avail) => ({ id: crypto.randomUUID(), plan_id: PD, group_id: GROUP, play_date: date, course_id: c, available: avail, ranges: avail === 'yes' ? ['07:30-07:50'] : [], times: [], job_id: c === L(1) ? J1 : J2, created_at: now, updated_at: now });
db.trip_tee_options.push(tee(sat(W1), L(1), 'no'), tee(sat(W1), L(2), 'no'), tee(sat(W2), L(1), 'yes'), tee(sat(W2), L(2), 'yes'));
db.plan_rsvps.push(...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ plan_id: PD, player_id: db.players[i].id, status: 'in', updated_at: now })));

me = { id: K, admin: true };
const st = () => db.trip_builds.find((b) => b.plan_id === PD).state;
const openCalls = async () => {
  await page.goto(`${BASE}#/plan/${PD}/build`);
  await page.reload();
  await page.getByTestId('tb-step-calls').waitFor({ timeout: 15000 });
  await page.getByTestId('tb-step-calls').getByRole('button').first().click(); await wait(900);
};
await openCalls();
const banner = page.getByTestId('falls-through');
await banner.waitFor({ timeout: 8000 });
const bt = await banner.innerText();
check(/is out\. .* works at both courses\./.test(bt), `one banner: the primary's out, the backup works (${bt.split('\n')[0]})`);
check(!(await page.getByTestId('open-it-up').count()), '"Open it up" stays hidden while a weekend works');
check(/^Go with /.test(await page.getByTestId('go-with-backup').innerText()), 'one gold "Go with …"');
await shot('o5-01-banner');
const postsBefore = (db.posts || []).length;
await page.getByTestId('go-with-backup').click(); await wait(1800);
check(st().weekends[0].start === W2.start && st().weekends.length === 1 && (st().deadWeekends || []).includes(W1.start), 'the backup is the primary now; the dead weekend is remembered');
const newPosts = (db.posts || []).slice(postsBefore);
check(newPosts.length === 1 && /is out — no tee times\. We’re going with/.test(newPosts[0].body), `ONE Feed post (${newPosts.map((p) => p.body).join(' | ')})`);
const checkPoll = db.plan_polls.find((p) => p.plan_id === PD && /^Still good for /.test(p.question));
check(!!checkPoll && checkPoll.status === 'open' && db.plan_options.filter((o) => o.poll_id === checkPoll.id).length === 1, 'I6: a one-tap "Still good for …?" goes out');
check(fake.notifyCalls.some((n) => n.type === 'poll_open' && n.poll_id === checkPoll?.id), 'and everyone’s told');

// I6: a player sees it on the trip and answers in one tap.
me = { id: AL, admin: false };
await page.goto(`${BASE}#/plan/${PD}?view=overview`);
await page.reload();
await page.getByTestId('overview-votes').waitFor({ timeout: 15000 });
const vn = page.getByTestId('vote-now').filter({ hasText: 'Still good for' });
check(await vn.count() === 1, 'the player sees "Still good for …?"');
await vn.getByRole('button', { name: '✓ Yes' }).first().click(); await wait(800);
check(db.plan_votes.some((v) => v.poll_id === checkPoll?.id && v.player_id === AL && v.response === 'yes'), 'one tap: yes');
await shot('o5-02-still-good');

// Then the new primary falls through too (no weekend works): "Open it up" shows; + Backup asks about the next
// weekend (never the dead one), Al's calls go back to To do with the new dates, he's told, one Feed post.
me = { id: K, admin: true };
for (const t of db.trip_tee_options.filter((x) => x.plan_id === PD && x.play_date === sat(W2))) { t.available = 'no'; t.ranges = []; }
await openCalls();
await page.getByTestId('open-it-up').waitFor({ timeout: 8000 });
check(!(await page.getByTestId('falls-through').count()), 'no "go with" banner when nothing works');
const addBtn = await page.getByTestId('open-up-weekend').innerText();
check(addBtn.includes(`${new Date(`${W3.start}T00:00:00`).getDate()}`), `+ Backup offers the next live weekend, not the dead one (${addBtn})`);
const before2 = (db.posts || []).length;
fake.notifyCalls.length = 0;
await page.getByTestId('open-up-weekend').click(); await wait(1800);
check(st().weekends.map((w) => w.start).join(',') === `${W2.start},${W3.start}`, 'the new weekend is on as a backup');
const j1 = db.plan_items.find((j) => j.id === J1);
check(j1.stage === 'todo' && /Backup:/.test(j1.body || ''), `Al’s call is back to To do and asks about the new weekend (${(j1.body || '').split('\n')[0]})`);
check(fake.notifyCalls.filter((n) => n.type === 'job_assigned').length === 2, 'Al is told about the new calls');
const p2 = (db.posts || []).slice(before2);
check(p2.length === 1 && /asking the courses about/.test(p2[0].body) && /Al has the new calls/.test(p2[0].body), `ONE Feed post (${p2.map((p) => p.body).join(' | ')})`);
await shot('o5-03-open-it-up');

// I5: Al rings both courses about the new weekend (they have times on its Saturday) and finishes the calls: the
// second "That's the call done" puts his moment in the Feed, once. And the banner now says to go with the new one.
db.trip_tee_options.push(tee(sat(W3), L(1), 'yes'), tee(sat(W3), L(2), 'yes'));
me = { id: AL, admin: false };
await openCalls();
const before3 = (db.posts || []).length;
for (let i = 0; i < 2; i++) {
  await page.getByTestId('call-done').first().waitFor({ timeout: 8000 });
  await page.getByTestId('call-done').first().click(); await wait(1500);
}
const p3 = (db.posts || []).slice(before3);
check(p3.length === 1 && /Al rang 2 courses — tee times on 1 of 2 days\. Thanks Al!/.test(p3[0].body), `I5: ONE Feed post for the caller (${p3.map((p) => p.body).join(' | ')})`);
check(/works at both courses/.test(await page.getByTestId('falls-through').innerText()), 'and the banner says the new weekend works');
await shot('i5-01-calls-done');

check(!errors.length, `no page errors (${errors.slice(0, 2).join(' | ')})`);
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
