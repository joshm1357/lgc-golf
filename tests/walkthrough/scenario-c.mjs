// Scenario C — "Kurt's Ryder Cup": a group with the Cup switched on (only this group). The trip is locked in; in
// the run-up the organiser sets up Team Blue and Team Red and the matches, checks comps, rules and handicaps; then
// the day (matches scored hole by hole) and just after. Capture only.
// Usage: node tests/walkthrough/scenario-c.mjs
import crypto from 'node:crypto';
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { makeServer, GROUP } from './fake.mjs';
import { makeWorld, addPeople, LIBRARY, holes, pid, L, groupCourse, scoresFor } from './fixtures.mjs';
import { recorder, wait, plusDays } from './shoot.mjs';
import { person, go, settle, DESK, PHONE, moveTrip, rsvp } from './common.mjs';

const R = recorder('C-kurts-ryder-cup', 'Kurt’s Ryder Cup');
const NAMES = [['Kurt', 12], ['Mike', 18], ['Al', 9], ['Bo', 8], ['Cy', 16], ['Di', 20], ['Ed', 14], ['Fin', 7], ['Gus', 22], ['Hal', 11], ['Mo', 26], ['Lou', 24]];
const db = makeWorld({ names: NAMES, extraFeatures: ['cup', 'tee_groups'] });
const S = makeServer(db, { groupName: 'Kurt’s Ryder Cup', library: LIBRARY, holes });
const P = addPeople(S, { organiser: 0, keen: 1, quiet: 10, guest: 40, late: 11, others: [2, 3, 4, 5, 6, 7, 8, 9] });
const browser = await chromium.launch();
const open = (acct, label, width = PHONE, fresh = false) => person(browser, S, R, acct, label, { width, fresh });
const nowIso = () => new Date().toISOString();

// The locked-in trip: two nights in the Hunter, two rounds, the BD Trophy and the Cup up for grabs.
const PLAN = 'eeeeeeee-0000-4000-8000-0000000c0001';
const TRIP = 'aaaaaaaa-0000-4000-8000-0000000c0001';
const c1 = groupCourse(db, L(7)); const c2 = groupCourse(db, L(8));
db.plans.push({ id: PLAN, kind: 'trip', name: '7th Ryder Cup', status: 'confirmed', start_date: plusDays(12), end_date: plusDays(14), location_name: 'Pokolbin', trip_id: TRIP, proposed: false, rsvp_locked: false,
  created_by: pid(0), organiser_id: pid(0), group_id: GROUP, deposit_pp: 250, deposit_asked_at: nowIso(), kitty_note: 'PayID 0411 111 111 — Kurt', created_at: nowIso() });
db.trips.push({ id: TRIP, group_id: GROUP, name: '7th Ryder Cup', start_date: plusDays(12), end_date: plusDays(14), status: 'locked', created_at: nowIso() });
const R1 = 'dddddddd-0000-4000-8000-0000000c0001'; const R2 = 'dddddddd-0000-4000-8000-0000000c0002';
db.rounds.push(
  { id: R1, group_id: GROUP, trip_id: TRIP, course_id: c1.id, name: 'Saturday — Cypress Lakes', play_date: plusDays(13), format: 'stableford', status: 'setup', ld_holes: [], ctp_holes: [], comp_bonus: 0, created_at: nowIso() },
  { id: R2, group_id: GROUP, trip_id: TRIP, course_id: c2.id, name: 'Sunday — The Vintage', play_date: plusDays(14), format: 'stableford', status: 'setup', ld_holes: [], ctp_holes: [], comp_bonus: 0, created_at: nowIso() },
);
db.trophies.push({ id: crypto.randomUUID(), group_id: GROUP, trip_id: TRIP, name: 'BD Trophy', type: 'stableford_total', created_at: nowIso() });
db.comps.push(
  { id: crypto.randomUUID(), group_id: GROUP, trip_id: TRIP, name: 'BD Trophy', kind: 'individual_points', round_ids: [], settings: {}, sort: 0, retired: false, created_at: nowIso() },
  { id: crypto.randomUUID(), group_id: GROUP, trip_id: TRIP, name: 'The Ryder Cup', kind: 'cup', round_ids: [], settings: {}, sort: 1, retired: false, created_at: nowIso() },
);
db.handicap_history.push({ id: crypto.randomUUID(), player_id: pid(3), old_handicap: 10, new_handicap: 8, reason: 'Tribunal', created_at: plusDays(-30) + 'T01:00:00Z' });
db.cases.push({ id: crypto.randomUUID(), group_id: GROUP, status: 'open', title: 'Gus’s handicap', subject_kind: 'players.handicap', subject_ref: { table: 'players', id: pid(8), field: 'handicap' }, created_at: nowIso() });
for (let i = 0; i < 12; i++) rsvp(db, PLAN, i, i === 10 ? 'maybe' : 'in');
for (const i of [2, 3, 4, 5, 6]) db.plan_transfers.push({ id: crypto.randomUUID(), plan_id: PLAN, group_id: GROUP, from_id: pid(i), to_id: pid(0), amount: 250, confirmed: true, note: 'Deposit', created_at: nowIso() });

// ================================================================================================ Locked in (12 days out)
const org = await open(P.organiser, 'organiser', DESK);
const op = org.page;
await go(op, '/plan', null, 1600);
await R.shot(op, 'pick-lock', 'organiser', 'Organiser, laptop: opened Trips twelve days before the trip');
await go(op, `/plan/${PLAN}?view=organise&step=day`, null, 1800);
await R.shot(op, 'run-up', 'organiser', 'Organiser, laptop: opened Organise → Comps & on the day twelve days out');
await go(op, '/cup', null, 1600);
await R.shot(op, 'run-up', 'organiser', 'Organiser, laptop: opened The Cup twelve days out, before the trip is under way in the app');
await R.try('look at the round list for a match twelve days out', async () => {
  await op.getByRole('button', { name: /Set up the cup/ }).click({ timeout: 4000 }); await wait(op, 800);
  await R.shot(op, 'run-up', 'organiser', 'Organiser, laptop: clicked “Set up the cup (organiser)” twelve days out');
  await op.getByRole('button', { name: /Set up the cup|Hide set-up/ }).first().click().catch(() => {});
});

// ================================================================================================ The run-up (5 days out)
moveTrip(db, PLAN, 5);
db.trips.find((t) => t.id === TRIP).status = 'active'; // what "Set it up" does when the trip is a week or less away
await go(op, '/cup', null, 1600);
await op.getByRole('button', { name: /Set up the cup/ }).click();
await wait(op, 600);
await R.shot(op, 'run-up', 'organiser', 'Organiser, laptop: five days out, opened The Cup and clicked “Set up the cup”');
await R.try('make the teams', async () => {
  await op.getByRole('button', { name: 'Make Team Blue and Team Red' }).click();
  await op.getByText('Team Blue link').waitFor({ timeout: 10000 }); await wait(op, 600);
  await op.getByPlaceholder('e.g. 28').fill('12');
  await op.locator('.card', { hasText: 'Points in the whole cup' }).getByRole('button', { name: 'Save' }).click(); await wait(op, 600);
  await settle(op);
  await R.shot(op, 'run-up', 'organiser', 'Organiser, laptop: clicked “Make Team Blue and Team Red” and set 12 points in the cup');
});
await R.try('put players on teams', async () => {
  const toggle = op.getByRole('button', { name: /Who’s on which team/ });
  for (let i = 0; i < 12; i++) {
    const p = db.players[i];
    const row = op.locator('div.row').filter({ hasText: new RegExp(`${p.nickname} \\(\\d`) }).first();
    if (!(await row.isVisible().catch(() => false))) { await toggle.click(); await wait(op, 400); }
    await row.getByRole('button', { name: i % 2 ? 'Team Red' : 'Team Blue' }).click(); await wait(op, 700);
  }
  if (!(await op.locator('div.row').filter({ hasText: /Kurt \(\d/ }).first().isVisible().catch(() => false))) { await toggle.click(); await wait(op, 400); }
  await wait(op, 600); await settle(op);
  await R.shot(op, 'run-up', 'organiser', 'Organiser, laptop: put six players on each team');
});
await R.try('add matches', async () => {
  const add = op.locator('.card', { hasText: 'Add a match' });
  for (const [a1, a2, b1, b2] of [['Kurt', 'Al', 'Mike', 'Bo'], ['Cy', 'Ed', 'Di', 'Fin'], ['Gus', 'Mo', 'Hal', 'Lou']]) {
    for (const n of [a1, a2, b1, b2]) { await add.getByRole('button', { name: n, exact: true }).click(); await wait(op, 150); }
    await add.getByRole('button', { name: 'Add match' }).click(); await wait(op, 800);
  }
  await settle(op);
  await R.shot(op, 'run-up', 'organiser', 'Organiser, laptop: added three Ambrose pairs matches for the first round');
});
if (!db.cup_matches.length) R.note('C: no Cup matches could be added through the screen; the day uses matches written into the fake database.');
await go(op, `/plan/${PLAN}?view=organise&step=day`, null, 1800);
await R.try('review handicaps', async () => {
  await op.getByRole('button', { name: '✓ Done — they’re right' }).click({ timeout: 4000 }); await wait(op, 700); await settle(op);
});
await R.shot(op, 'run-up', 'organiser', 'Organiser, laptop: opened Comps & on the day five days out and pressed “Done — they’re right” on handicaps');
{
  const k = await open(P.keen, 'keen');
  await go(k.page, `/plan/${PLAN}`, null, 1800);
  await R.shot(k.page, 'run-up', 'keen', 'Keen player, phone: opened the trip five days out');
  await go(k.page, '/cup', null, 1600);
  await R.shot(k.page, 'run-up', 'keen', 'Keen player, phone: opened The Cup from the trip');
  await k.close();
  const q = await open(P.quiet, 'quiet');
  await go(q.page, `/plan/${PLAN}`, null, 1800);
  await R.shot(q.page, 'run-up', 'quiet', 'Quiet player, phone: opened the trip five days out, still a maybe and no deposit paid');
  await q.close();
  const g = await open(P.guest, 'guest');
  await go(g.page, '/cup', null, 1600);
  await R.shot(g.page, 'run-up', 'guest', 'Guest, phone: opened The Cup');
  await g.close();
  const lou = await open(null, 'late');
  await go(lou.page, `/join/REDTEAM23456?to=${encodeURIComponent('/cup')}`, null, 2000);
  await R.shot(lou.page, 'run-up', 'late', 'Late joiner, phone: tapped the Team Red link the organiser sent him, on a phone that has never opened the app');
  await R.try('sign in and pick a name', async () => {
    await lou.page.getByLabel('Your email').fill('lou.c@example.com');
    await lou.page.getByLabel('Password', { exact: true }).fill('fairway123');
    await lou.page.getByRole('button', { name: 'Continue with email' }).click();
    await lou.page.getByRole('button', { name: 'Create my account' }).click({ timeout: 8000 });
    await lou.page.getByLabel('6-digit code from the email').fill('123456');
    await lou.page.getByRole('button', { name: 'Confirm' }).click();
    await lou.page.getByText('Who are you?').waitFor({ timeout: 10000 }); await wait(lou.page, 600);
    await R.shot(lou.page, 'run-up', 'late', 'Late joiner, phone: made an account and entered the emailed code');
    await lou.page.getByRole('button', { name: /Lou/ }).first().click();
    await lou.page.getByRole('button', { name: /Yes, I'm Lou|Yes, I’m Lou/ }).click(); await wait(lou.page, 1500);
    const notif = lou.page.getByRole('dialog', { name: /Turn on notifications/ });
    if (await notif.isVisible().catch(() => false)) { await R.shot(lou.page, 'run-up', 'late', 'Late joiner, phone: picked “Lou” and confirmed', { full: false }); await notif.getByRole('button', { name: 'Not now' }).click(); await wait(lou.page, 1500); }
    else R.note('C: no notifications box appeared for the late joiner after picking his name.');
    await settle(lou.page, 1000);
    await R.shot(lou.page, 'run-up', 'late', 'Late joiner, phone: landed on the page the link was for, after picking his name');
  });
  await lou.close();
}

// ================================================================================================ The day
moveTrip(db, PLAN, -1); // day 2 of 3: round one is today
const r1 = db.rounds.find((r) => r.id === R1); r1.status = 'live';
for (let i = 0; i < 12; i++) db.round_players.push({ round_id: R1, player_id: pid(i), playing_handicap: NAMES[i][1], group_id: GROUP });
if (!db.cup_matches.length && db.cup_sides.length) {
  const [blue, red] = db.cup_sides;
  [[0, 2, 1, 3], [4, 6, 5, 7], [8, 10, 9, 11]].forEach(([a, b, c, d], k) => db.cup_matches.push({ id: crypto.randomUUID(), group_id: GROUP, round_id: R1, sort: k + 1, format: 'ambrose', a_players: [pid(a), pid(b)], b_players: [pid(c), pid(d)], a_hcp: 5, b_hcp: 6, points: 2, holes: {}, created_at: nowIso() }));
  void blue; void red;
}
const res = [['a', 'h', 'b', 'a', 'a', 'h', 'b', 'a', 'h', 'a'], ['b', 'b', 'h', 'a', 'b', 'h', 'b'], ['h', 'a', 'a', 'b', 'h']];
db.cup_matches.forEach((m, k) => { m.round_id = R1; m.holes = Object.fromEntries((res[k] || []).map((x, i) => [String(i + 1), x])); });
db.posts.unshift({ id: crypto.randomUUID(), group_id: GROUP, kind: 'auto', trip_id: TRIP, round_id: R1, body: '🔵 Team Blue go 1 up in the top match', created_at: nowIso() });
await go(op, '/', null, 2000);
await R.shot(op, 'the-day', 'organiser', 'Organiser, laptop: opened the app on the morning of the first Cup round, matches under way');
await go(op, '/cup', null, 1800);
await R.shot(op, 'the-day', 'organiser', 'Organiser, laptop: opened The Cup board');
{
  const k = await open(P.keen, 'keen');
  await go(k.page, '/', null, 2000);
  await R.shot(k.page, 'the-day', 'keen', 'Keen player, phone: opened the app on the 8th tee');
  await go(k.page, '/cup', null, 1600);
  await R.shot(k.page, 'the-day', 'keen', 'Keen player, phone: opened The Cup');
  const mine = db.cup_matches[0];
  if (mine) {
    await go(k.page, `/cup/${mine.id}`, null, 1600);
    await R.shot(k.page, 'the-day', 'keen', 'Keen player, phone: opened his match to put in the 11th hole');
    await R.try('score a hole', async () => {
      await k.page.getByRole('button', { name: /^Team Red — / }).click({ timeout: 4000 }); await wait(k.page, 900);
      await R.shot(k.page, 'the-day', 'keen', 'Keen player, phone: tapped “Team Red” to say his team won the hole');
    });
  }
  await k.close();
  const q = await open(P.quiet, 'quiet');
  await go(q.page, '/', null, 2000);
  await R.shot(q.page, 'the-day', 'quiet', 'Quiet player, phone: opened the app on the course');
  await q.close();
  const g = await open(P.guest, 'guest');
  await go(g.page, '/cup', null, 1600);
  await R.shot(g.page, 'the-day', 'guest', 'Guest, phone: opened The Cup board');
  await g.close();
}

// ================================================================================================ Just after
moveTrip(db, PLAN, -3);
r1.status = 'locked'; db.rounds.find((r) => r.id === R2).status = 'locked';
const fin = [{ ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [String(i + 1), i % 3 ? 'a' : 'h'])) }, Object.fromEntries(Array.from({ length: 18 }, (_, i) => [String(i + 1), i % 4 === 0 ? 'a' : i % 2 ? 'b' : 'h'])), Object.fromEntries(Array.from({ length: 18 }, (_, i) => [String(i + 1), 'h']))];
db.cup_matches.forEach((m, k) => { m.holes = fin[k] || {}; });
for (const r of [R1, R2]) for (let i = 0; i < 12; i++) db.scores.push(...scoresFor(r, pid(i), 18, i % 4 === 0));
db.honour_board.push({ id: crypto.randomUUID(), group_id: GROUP, trip_id: TRIP, trophy_name: 'The Ryder Cup', label: plusDays(-3).slice(0, 4), winner_names: 'Team Blue', player_ids: [0, 2, 4, 6, 8, 10].map(pid), sort_key: 1, created_at: nowIso() });
db.posts.unshift({ id: crypto.randomUUID(), group_id: GROUP, kind: 'auto', trip_id: TRIP, body: '🏆 Team Blue win the 7th Ryder Cup', created_at: nowIso() });
{
  const k = await open(P.keen, 'keen');
  await go(k.page, '/', null, 2000);
  await R.shot(k.page, 'just-after', 'keen', 'Keen player, phone: opened the app the day after the trip');
  await go(k.page, '/cup', null, 1600);
  await R.shot(k.page, 'just-after', 'keen', 'Keen player, phone: opened The Cup');
  await go(k.page, '/trophies', null, 1600);
  await R.shot(k.page, 'just-after', 'keen', 'Keen player, phone: opened the Trophy Room');
  await k.close();
}
await go(op, `/plan/${PLAN}`, null, 1800);
await R.shot(op, 'just-after', 'organiser', 'Organiser, laptop: opened the trip the day after');

await org.close();
await browser.close();
R.save();
console.log(`C: ${R.shots.length} shots, ${R.notes.length} notes, ${R.errors.length} errors`);
