// Scenario A — "L.G.C long weekend": one area (South Coast NSW), 10 players, a simple vote on weekends and trip
// length, locked in, the run-up, the day, and just after. Capture only: fake database, nothing real touched.
// Usage: node tests/walkthrough/scenario-a.mjs   (the app served at WT_BASE, default http://localhost:4330/lgc-golf/)
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { makeServer } from './fake.mjs';
import { makeWorld, addPeople, LIBRARY, holes, pid, L } from './fixtures.mjs';
import { recorder, wait, plusDays } from './shoot.mjs';
import { person, go, settle, DESK, PHONE, step, state, openBuilder, addArea, openArea, tickCourses, tickStays, pickWeekends, votePolls, optionOf, castVote, rsvp } from './common.mjs';
import { laterStages } from './later-stages.mjs';

const UNTIL = Number(process.env.WT_UNTIL || 99);
const R = recorder('A-lgc-long-weekend', 'L.G.C long weekend');
const db = makeWorld();
const S = makeServer(db, { groupName: 'L.G.C', library: LIBRARY, holes });
const P = addPeople(S, { organiser: 0, keen: 1, quiet: 8, guest: 40, late: 9, others: [2, 3, 4, 5, 6, 7] });
const browser = await chromium.launch();
const open = (acct, label, width = PHONE, fresh = false) => person(browser, S, R, acct, label, { width, fresh });
const NAME = 'L.G.C long weekend';
let PLAN = null;

// ================================================================================================ 1. The idea
{
  // Al (keen) suggests it from the Trips tab on his phone.
  const al = await open(P.keen, 'keen');
  await go(al.page, '/plan', 'trips-section-idea');
  await R.shot(al.page, 'idea', 'keen', 'Keen player, phone: opened Trips before anyone has suggested this year’s trip');
  await al.page.getByRole('button', { name: '💡 Suggest a trip or round' }).click();
  await al.page.getByLabel('Name').fill(NAME);
  await al.page.getByLabel('Pitch it (optional)').fill('Same crew as last year. Three days down the coast, two or three rounds. Who’s in?');
  await R.shot(al.page, 'idea', 'keen', 'Keen player, phone: filled in “Suggest a trip or round” with a name and a pitch');
  await al.page.getByRole('button', { name: /Call the vote|Put it to the group/ }).click();
  await al.page.waitForURL(/#\/plan\/[0-9a-f-]+/, { timeout: 15000 });
  PLAN = al.page.url().match(/plan\/([0-9a-f-]+)/)[1];
  await settle(al.page, 1200);
  await R.shot(al.page, 'idea', 'keen', 'Keen player, phone: sent the suggestion and landed on the idea’s page');
  await al.close();
  for (const i of [2, 3, 5]) rsvp(db, PLAN, i, 'in');
}
{
  const org = await open(P.organiser, 'organiser', DESK);
  await go(org.page, '/plan', 'trips-section-idea');
  await R.shot(org.page, 'idea', 'organiser', 'Organiser, laptop: opened Trips the next evening and saw the suggestion under Proposed');
  await go(org.page, `/plan/${PLAN}`);
  await R.shot(org.page, 'idea', 'organiser', 'Organiser, laptop: opened the suggested trip');
  const approve = org.page.getByRole('button', { name: /Approve — start planning/ });
  if (await approve.isVisible().catch(() => false)) {
    await approve.click(); await settle(org.page, 1200);
    await R.shot(org.page, 'idea', 'organiser', 'Organiser, laptop: tapped “Approve — start planning”');
  } else {
    R.note('A: the organiser found no Approve button on the suggested trip; the walkthrough approved it in the fake database.');
    db.plans.find((p) => p.id === PLAN).proposed = false;
  }
  await org.close();
}
for (const [acct, label, line] of [[P.quiet, 'quiet', 'Quiet player, phone: opened Trips from the Feed post about the new idea'], [P.guest, 'guest', 'Guest, phone: opened Trips']]) {
  const x = await open(acct, label);
  await go(x.page, '/plan', 'trips-being-planned');
  await R.shot(x.page, 'idea', label, line);
  await x.close();
}

// ================================================================================================ 2. Areas & weekends
const org = await open(P.organiser, 'organiser', DESK);
const op = org.page;
{
  await openBuilder(op, PLAN);
  await R.shot(op, 'areas-weekends', 'organiser', 'Organiser, laptop: opened “Build the trip” for the first time');
  await addArea(op, 'South', 'South Coast NSW', true);
  await R.try('open the South Coast page', () => openArea(op, 'South Coast NSW'));
  await tickCourses(op, ['Shoalhaven Heads GC', 'Nowra GC', 'Kiama GC']);
  await tickStays(op, ['Kiama', 'Nowra']);
  await R.shot(op, 'areas-weekends', 'organiser', 'Organiser, laptop: added South Coast NSW and ticked three courses and two places to stay');
  await pickWeekends(op, [9, 10, 12]);
  await R.try('turn on the length vote', async () => { await op.getByTestId('length-vote').check(); await wait(op, 400); });
  await R.try('set the head count', async () => { await op.getByLabel('How many coming').fill('10'); await wait(op, 400); });
  await R.shot(op, 'areas-weekends', 'organiser', 'Organiser, laptop: ticked three weekends, turned on “let the group vote on how long”, set 10 coming');
  await op.getByTestId('tb-call-vote1').click();
  await op.getByTestId('vote-depth').waitFor({ timeout: 8000 }).catch(() => {});
  await wait(op, 800);
  await R.shot(op, 'areas-weekends', 'organiser', 'Organiser, laptop: pressed “Call the vote” on the builder', { full: false });
  // A simple vote: just the weekends and how long (untick the towns and courses).
  for (const l of ['Which town to stay in?: Kiama', 'Which town to stay in?: Nowra', 'Which courses?: Shoalhaven Heads GC', 'Which courses?: Nowra GC', 'Which courses?: Kiama GC']) {
    await op.getByLabel(l).uncheck({ timeout: 3000 }).catch(() => R.note(`A: couldn’t untick “${l}” on Call the vote.`));
  }
  await wait(op, 500);
  await R.shot(op, 'areas-weekends', 'organiser', 'Organiser, laptop: unticked the towns and courses so the vote is just weekends and how long', { full: false });
  await op.getByTestId('call-the-vote').click();
  await op.getByTestId('how-it-goes-out').waitFor({ timeout: 10000 }).catch(() => {});
  await wait(op, 600);
  await R.shot(op, 'areas-weekends', 'organiser', 'Organiser, laptop: pressed “Call the vote” at the bottom of the box', { full: false });
  await op.getByRole('button', { name: 'Done' }).click().catch(() => {});
  await settle(op);
  await R.shot(op, 'areas-weekends', 'organiser', 'Organiser, laptop: closed the sharing box and is back on the builder');
}

// ================================================================================================ 3. Voting
const { polls } = votePolls(db, PLAN);
const q = (re) => polls.find((p) => re.test(p.question));
if (!polls.length) R.note('A: no vote was made by “Call the vote” — later voting shots will be empty.');
{
  const al = await open(P.keen, 'keen');
  await go(al.page, `/plan/${PLAN}?tab=vote`, 'overview-votes', 1200);
  await R.shot(al.page, 'voting', 'keen', 'Keen player, phone: opened the vote from the notification a few minutes after it went out');
  const card = al.page.locator('[data-testid="vote-batch"]').first();
  await R.try('answer the vote', async () => {
    const secs = card.getByTestId('vote-batch-section');
    const n = await secs.count();
    for (let i = 0; i < n; i++) {
      const s = secs.nth(i);
      const can = s.getByRole('button', { name: '✓ Can' });
      if (await can.count()) { for (let k = 0; k < await can.count(); k++) { await can.nth(k).click(); await wait(al.page, 250); } continue; }
      const pref = s.getByRole('button', { name: '⭐ Prefer' });
      if (await pref.count()) { await pref.nth(Math.min(1, (await pref.count()) - 1)).click(); await wait(al.page, 300); }
    }
    await card.getByTestId('vote-batch-keen').getByRole('button', { name: '✓ In' }).click().catch(() => {});
    await wait(al.page, 800);
  });
  await settle(al.page);
  await R.shot(al.page, 'voting', 'keen', 'Keen player, phone: answered every question and said he’s in');
  await al.close();
}
// Six others vote over the next two days (written straight into the fake database).
{
  const wk = q(/weekend/i); const len = q(/long/i);
  if (wk) {
    const opts = db.plan_options.filter((o) => o.poll_id === wk.id);
    for (const i of [0, 2, 3, 4, 5, 6]) opts.forEach((o, k) => castVote(db, i, wk, o, (i + k) % 3 === 0 ? 'no' : 'yes'));
  }
  if (len) {
    const opts = db.plan_options.filter((o) => o.poll_id === len.id);
    for (const i of [0, 2, 3, 4, 5, 6]) castVote(db, i, len, opts[Math.min(opts.length - 1, i % 2 ? 1 : 2)] || opts[0], 'yes');
  }
  for (const i of [0, 2, 3, 4, 5, 6]) rsvp(db, PLAN, i, i === 4 ? 'maybe' : 'in');
}
{
  const mo = await open(P.quiet, 'quiet');
  await go(mo.page, `/plan/${PLAN}`, null, 1500);
  await R.shot(mo.page, 'voting', 'quiet', 'Quiet player, phone: opened the trip two days after the vote opened and hasn’t answered anything');
  await mo.close();
  const g = await open(P.guest, 'guest');
  await go(g.page, `/plan/${PLAN}`, null, 1500);
  await R.shot(g.page, 'voting', 'guest', 'Guest, phone: opened the trip while the vote is open');
  await g.close();
}
// The late joiner: never opened the app; taps the vote link someone pasted in the group chat.
{
  const lou = await open(null, 'late');
  const link = `/join/${S.invite}?to=${encodeURIComponent(`/plan/${PLAN}?tab=vote`)}`;
  await go(lou.page, link, null, 2000);
  await R.shot(lou.page, 'voting', 'late', 'Late joiner, phone: tapped the vote link in the group chat on a phone that has never opened the app');
  await R.try('sign in as the late joiner', async () => {
    await lou.page.getByLabel('Your email').fill('lou@example.com');
    await lou.page.getByLabel('Password', { exact: true }).fill('fairway123');
    await lou.page.getByRole('button', { name: 'Continue with email' }).click();
    await lou.page.getByRole('button', { name: 'Create my account' }).waitFor({ timeout: 8000 });
    await R.shot(lou.page, 'voting', 'late', 'Late joiner, phone: typed an email and password and pressed “Continue with email”');
    await lou.page.getByRole('button', { name: 'Create my account' }).click();
    await lou.page.getByLabel('6-digit code from the email').waitFor({ timeout: 8000 });
    await R.shot(lou.page, 'voting', 'late', 'Late joiner, phone: pressed “Create my account”');
    await lou.page.getByLabel('6-digit code from the email').fill('123456');
    await lou.page.getByRole('button', { name: 'Confirm' }).click();
    await lou.page.getByText('Who are you?').waitFor({ timeout: 10000 });
    await wait(lou.page, 800);
    await R.shot(lou.page, 'voting', 'late', 'Late joiner, phone: entered the code from the email');
    await lou.page.getByRole('button', { name: /Lou/ }).first().click();
    await wait(lou.page, 500);
    await R.shot(lou.page, 'voting', 'late', 'Late joiner, phone: tapped his name in the list');
    await lou.page.getByRole('button', { name: /Yes, I'm Lou|Yes, I’m Lou/ }).click();
    await wait(lou.page, 1500);
    await R.shot(lou.page, 'voting', 'late', 'Late joiner, phone: confirmed “Yes, I’m Lou”');
    const notif = lou.page.getByRole('dialog', { name: /Turn on notifications/ });
    if (await notif.isVisible().catch(() => false)) {
      await notif.getByRole('button', { name: 'Not now' }).click(); await wait(lou.page, 1500);
      await settle(lou.page, 1200);
      await R.shot(lou.page, 'voting', 'late', 'Late joiner, phone: pressed “Not now” on the notifications box');
    } else R.note('A: the late joiner was not shown the notifications box after picking his name (he went straight to the vote).');
  });
  await lou.close();
}
{
  // The organiser checks the results two days in.
  await go(op, `/plan/${PLAN}?view=organise&tab=vote`, null, 1500);
  await R.shot(op, 'voting', 'organiser', 'Organiser, laptop: opened Organise → Vote two days after calling the vote');
  await openBuilder(op, PLAN);
  await op.getByTestId('vote-results').waitFor({ timeout: 8000 }).catch(() => {});
  await R.shot(op, 'voting', 'organiser', 'Organiser, laptop: opened the builder to see the results');
}

await laterStages({ R, S, db, P, browser, org, open, PLAN, NAME, UNTIL, area: 'South Coast NSW',
  calls: { onePerson: P.keen, courses: ['Shoalhaven Heads GC', 'Nowra GC', 'Kiama GC'] }, courses: [L(1), L(2), L(5)], players: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] });

await org.close();
await browser.close();
R.save();
console.log(`A: ${R.shots.length} shots, ${R.notes.length} notes, ${R.errors.length} errors`);
