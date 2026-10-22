// Scenario B — "Multi-area": three areas (Hunter Valley, South Coast, Port Stephens); the organiser calls the deeper
// vote (areas + their courses and places to stay), primary and backup weekends, and how many nights is voted on.
// Then the winner is chosen and the trip goes through calls, lock-in, and jobs & money. Capture only.
// Usage: node tests/walkthrough/scenario-b.mjs
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { makeServer } from './fake.mjs';
import { makeWorld, addPeople, LIBRARY, holes, L } from './fixtures.mjs';
import { recorder, wait } from './shoot.mjs';
import { person, go, settle, DESK, PHONE, step, openBuilder, addArea, openArea, tickCourses, tickStays, pickWeekends, votePolls, optionOf, castVote, rsvp } from './common.mjs';
import { laterStages } from './later-stages.mjs';

const UNTIL = Number(process.env.WT_UNTIL || 6.9);
const R = recorder('B-multi-area', 'Multi-area');
const db = makeWorld();
const S = makeServer(db, { groupName: 'L.G.C', library: LIBRARY, holes });
const P = addPeople(S, { organiser: 0, keen: 1, quiet: 8, guest: 40, late: 9, others: [2, 3, 4, 5, 6, 7] });
const browser = await chromium.launch();
const open = (acct, label, width = PHONE, fresh = false) => person(browser, S, R, acct, label, { width, fresh });
const NAME = 'Spring away 2027';

// ================================================================================================ 1. Start it
const org = await open(P.organiser, 'organiser', DESK);
const op = org.page;
await go(op, '/plan', 'trips-section-idea');
await op.getByRole('button', { name: '💡 Suggest a trip or round' }).click();
await op.getByLabel('Name').fill(NAME);
await op.getByLabel('Pitch it (optional)').fill('Three nights somewhere new. Hunter, the South Coast or Port Stephens — have your say.');
await R.shot(op, 'idea', 'organiser', 'Organiser, laptop: opened “Suggest a trip or round” from Trips and typed a name and a pitch', { full: false });
await op.getByRole('button', { name: /Call the vote|Put it to the group/ }).click();
await op.waitForURL(/#\/plan\/[0-9a-f-]+/, { timeout: 15000 });
const PLAN = op.url().match(/plan\/([0-9a-f-]+)/)[1];
await settle(op, 1200);
await R.shot(op, 'idea', 'organiser', 'Organiser, laptop: saved it and landed on the new trip');
{
  const k = await open(P.keen, 'keen');
  await go(k.page, '/plan', 'trips-being-planned');
  await R.shot(k.page, 'idea', 'keen', 'Keen player, phone: opened Trips after the “new trip” notification');
  await k.close();
}

// ================================================================================================ 2. Areas & weekends
await openBuilder(op, PLAN);
await addArea(op, 'Hunter', 'Hunter Valley', true);
await openArea(op, 'Hunter Valley');
await tickCourses(op, ['Cypress Lakes', 'The Vintage', 'Cessnock GC']);
await tickStays(op, ['Pokolbin', 'Cessnock']);
await R.shot(op, 'areas-weekends', 'organiser', 'Organiser, laptop: added Hunter Valley and ticked three courses and two places to stay');
await addArea(op, 'South', 'South Coast NSW', false);
await openArea(op, 'South Coast NSW');
await tickCourses(op, ['Shoalhaven Heads GC', 'Nowra GC', 'Kiama GC']);
await tickStays(op, ['Kiama', 'Nowra']);
await addArea(op, 'Port', 'Port Stephens', false);
await openArea(op, 'Port Stephens');
await tickCourses(op, ['Horizons Golf Resort', 'Nelson Bay GC', 'Pacific Dunes']);
await tickStays(op, ['Nelson Bay']);
await R.shot(op, 'areas-weekends', 'organiser', 'Organiser, laptop: pressed “+ Add another area” twice, added South Coast NSW and Port Stephens and ticked their courses and places');
await R.try('open Compare', async () => {
  await op.getByTestId('area-compare-tab').click(); await wait(op, 900);
  await R.shot(op, 'areas-weekends', 'organiser', 'Organiser, laptop: clicked “Compare” to see the three areas side by side');
  await openArea(op, 'Hunter Valley');
});
await pickWeekends(op, [12, 13, 15, 16]);
await R.try('turn on the length vote', async () => { await op.getByTestId('length-vote').check(); await wait(op, 400); });
await R.try('set the head count', async () => { await op.getByLabel('How many coming').fill('10'); await wait(op, 400); });
await R.shot(op, 'areas-weekends', 'organiser', 'Organiser, laptop: ticked four weekends, turned on “let the group vote on how long” and set 10 coming');
await op.getByTestId('tb-call-vote1').click();
await op.getByTestId('vote-depth').waitFor({ timeout: 8000 });
await op.getByTestId('vote-depth').getByRole('button', { name: 'Areas only' }).click(); await wait(op, 500);
await R.shot(op, 'areas-weekends', 'organiser', 'Organiser, laptop: pressed “Call the vote” and looked at “Areas only”', { full: false });
await op.getByTestId('vote-depth').getByRole('button', { name: 'Areas + what’s in them' }).click(); await wait(op, 500);
await R.shot(op, 'areas-weekends', 'organiser', 'Organiser, laptop: switched to “Areas + what’s in them”', { full: false });
await op.getByTestId('call-the-vote').click();
await op.getByTestId('how-it-goes-out').waitFor({ timeout: 10000 }).catch(() => {});
await wait(op, 600);
await R.shot(op, 'areas-weekends', 'organiser', 'Organiser, laptop: pressed “Call the vote” at the bottom', { full: false });
await op.getByRole('button', { name: 'Done' }).click().catch(() => {});
await settle(op);

// ================================================================================================ 3. Voting
const { polls } = votePolls(db, PLAN);
const q = (re) => polls.find((p) => !p.optional && re.test(p.question));
{
  const k = await open(P.keen, 'keen');
  await go(k.page, `/plan/${PLAN}?tab=vote`, 'overview-votes', 1200);
  await R.shot(k.page, 'voting', 'keen', 'Keen player, phone: opened the vote from the notification');
  const card = k.page.locator('[data-testid="vote-batch"]').first();
  await R.try('open a details sheet', async () => {
    await card.getByTestId('option-details').first().click(); await wait(k.page, 900);
    await R.shot(k.page, 'voting', 'keen', 'Keen player, phone: tapped ⓘ Details on Hunter Valley', { full: false });
    await k.page.keyboard.press('Escape'); await wait(k.page, 400);
    await k.page.getByRole('button', { name: /^Close$|^✕$/ }).first().click({ timeout: 1500 }).catch(() => {});
  });
  await R.try('answer the main questions', async () => {
    const secs = card.getByTestId('vote-batch-section');
    await secs.nth(0).getByRole('button', { name: '⭐ Prefer' }).first().click(); await wait(k.page, 300);
    await secs.nth(0).getByRole('button', { name: '👎 Don’t like' }).last().click().catch(() => {}); await wait(k.page, 300);
    const can = secs.nth(1).getByRole('button', { name: '✓ Can' });
    for (let i = 0; i < await can.count(); i++) { if (i !== 1) { await can.nth(i).click(); await wait(k.page, 250); } }
    await secs.nth(1).getByRole('button', { name: '✗ Can’t' }).nth(1).click().catch(() => {});
    await secs.nth(2).getByRole('button', { name: '⭐ Prefer' }).last().click(); await wait(k.page, 300);
    await card.getByTestId('vote-batch-keen').getByRole('button', { name: '✓ In' }).click(); await wait(k.page, 800);
  });
  await settle(k.page);
  await R.shot(k.page, 'voting', 'keen', 'Keen player, phone: answered which area, which weekends, how long, and said he’s in');
  await R.try('go into the detail', async () => {
    await card.getByTestId('vote-detail-area').first().getByRole('button').first().click(); await wait(k.page, 500);
    await card.getByTestId('vote-detail-section').first().getByRole('button', { name: '⭐ Prefer' }).first().click(); await wait(k.page, 600);
    await settle(k.page);
    await R.shot(k.page, 'voting', 'keen', 'Keen player, phone: tapped “Go into the detail” under Hunter Valley and starred a course');
  });
  await k.close();
}
// The others vote: Hunter Valley wins, 3 nights wins, two weekends clear.
{
  const area = q(/area/i); const wk = q(/weekend/i); const len = q(/long/i);
  const voters = [0, 2, 3, 4, 5, 6, 7];
  for (const i of voters) {
    if (area) { castVote(db, i, area, optionOf(db, area, i % 3 === 0 ? 'South Coast NSW' : 'Hunter Valley'), 'yes'); castVote(db, i, area, optionOf(db, area, 'Port Stephens'), i % 2 ? 'maybe' : 'no'); }
    if (wk) db.plan_options.filter((o) => o.poll_id === wk.id).forEach((o, k) => castVote(db, i, wk, o, (k === 1 || (k === 3 && i % 2)) ? 'no' : 'yes'));
    if (len) castVote(db, i, len, optionOf(db, len, i % 3 === 1 ? '2 nights' : '3 nights'), 'yes');
    rsvp(db, PLAN, i, i === 4 ? 'maybe' : 'in');
  }
}
{
  const m = await open(P.quiet, 'quiet');
  await go(m.page, `/plan/${PLAN}`, null, 1600);
  await R.shot(m.page, 'voting', 'quiet', 'Quiet player, phone: opened the trip three days into the vote without having answered');
  await m.close();
  const g = await open(P.guest, 'guest');
  await go(g.page, `/plan/${PLAN}`, null, 1600);
  await R.shot(g.page, 'voting', 'guest', 'Guest, phone: opened the trip while the vote is open');
  await g.close();
  const lou = await open(null, 'late');
  await go(lou.page, `/join/${S.invite}?to=${encodeURIComponent(`/plan/${PLAN}?tab=vote`)}`, null, 2000);
  await R.shot(lou.page, 'voting', 'late', 'Late joiner, phone: tapped the vote link in the group chat on a phone that has never opened the app');
  await R.try('sign in and pick a name', async () => {
    await lou.page.getByLabel('Your email').fill('lou.b@example.com');
    await lou.page.getByLabel('Password', { exact: true }).fill('fairway123');
    await lou.page.getByRole('button', { name: 'Continue with email' }).click();
    await lou.page.getByRole('button', { name: 'Create my account' }).click({ timeout: 8000 });
    await lou.page.getByLabel('6-digit code from the email').fill('123456');
    await lou.page.getByRole('button', { name: 'Confirm' }).click();
    await lou.page.getByText('Who are you?').waitFor({ timeout: 10000 });
    await lou.page.getByRole('button', { name: /Lou/ }).first().click();
    await lou.page.getByRole('button', { name: /Yes, I'm Lou|Yes, I’m Lou/ }).click();
    await wait(lou.page, 1500);
    const notif = lou.page.getByRole('dialog', { name: /Turn on notifications/ });
    if (await notif.isVisible().catch(() => false)) { await notif.getByRole('button', { name: 'Not now' }).click(); await wait(lou.page, 1500); } else R.note(`${R.scenario}: no notifications box appeared for the late joiner after picking his name.`);
    await settle(lou.page, 1200);
    await R.shot(lou.page, 'voting', 'late', 'Late joiner, phone: made an account, entered the emailed code, picked his name');
  });
  await lou.close();
}
await go(op, `/plan/${PLAN}?view=organise&tab=vote`, null, 1600);
await R.shot(op, 'voting', 'organiser', 'Organiser, laptop: opened Organise → Vote four days into the vote');
await openBuilder(op, PLAN);
await op.getByTestId('vote-results').waitFor({ timeout: 8000 }).catch(() => {});
await R.shot(op, 'voting', 'organiser', 'Organiser, laptop: opened the builder to see the results');

await laterStages({ R, S, db, P, browser, org, open, PLAN, NAME, UNTIL, area: 'Hunter Valley', place: 'Pokolbin',
  calls: { onePerson: P.keen }, courses: [L(7), L(8), L(9)], players: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], quietIdx: 8,
  onAfterCalls: async () => {
    await R.try('show primary and backup weekends', async () => {
      await step(op, 'area').getByRole('button').first().click(); await wait(op, 700);
      await R.shot(op, 'courses-stays', 'organiser', 'Organiser, laptop: went back to step 1 to check the weekends after choosing the winner');
      await step(op, 'calls').getByRole('button').first().click(); await wait(op, 700);
    });
  } });

await org.close();
await browser.close();
R.save();
console.log(`B: ${R.shots.length} shots, ${R.notes.length} notes, ${R.errors.length} errors`);
