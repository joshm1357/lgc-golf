// Scenario D — "Weekend falls through": the vote picks South Coast and a primary weekend, but the courses have no
// tee times that weekend. The organiser uses "It's not working? Open it up" to add another backup weekend, then
// re-opens the area choice. Capture only.
// Usage: node tests/walkthrough/scenario-d.mjs
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { makeServer } from './fake.mjs';
import { makeWorld, addPeople, LIBRARY, holes, L } from './fixtures.mjs';
import { recorder, wait } from './shoot.mjs';
import { person, go, settle, DESK, PHONE, step, state, openBuilder, addArea, openArea, tickCourses, tickStays, pickWeekends, votePolls, optionOf, castVote, rsvp } from './common.mjs';
import { laterStages } from './later-stages.mjs';

const R = recorder('D-weekend-falls-through', 'Weekend falls through');
const db = makeWorld();
const S = makeServer(db, { groupName: 'L.G.C', library: LIBRARY, holes });
const P = addPeople(S, { organiser: 0, keen: 1, quiet: 8, guest: 40, late: 9, others: [2, 3, 4, 5, 6, 7] });
const browser = await chromium.launch();
const open = (acct, label, width = PHONE, fresh = false) => person(browser, S, R, acct, label, { width, fresh });
const NAME = 'Autumn away 2027';

const org = await open(P.organiser, 'organiser', DESK);
const op = org.page;
await go(op, '/plan', 'trips-section-idea');
await op.getByRole('button', { name: '💡 Suggest a trip or round' }).click();
await op.getByLabel('Name').fill(NAME);
await op.getByRole('button', { name: /Call the vote|Put it to the group/ }).click();
await op.waitForURL(/#\/plan\/[0-9a-f-]+/, { timeout: 15000 });
const PLAN = op.url().match(/plan\/([0-9a-f-]+)/)[1];
await settle(op);

// Areas and weekends, the vote (areas only), answered.
await openBuilder(op, PLAN);
await addArea(op, 'South', 'South Coast NSW', true);
await openArea(op, 'South Coast NSW');
await tickCourses(op, ['Shoalhaven Heads GC', 'Nowra GC']);
await tickStays(op, ['Nowra']);
await addArea(op, 'Hunter', 'Hunter Valley', false);
await openArea(op, 'Hunter Valley');
await tickCourses(op, ['Cypress Lakes', 'The Vintage']);
await tickStays(op, ['Pokolbin']);
await pickWeekends(op, [10, 11, 13]);
await R.shot(op, 'areas-weekends', 'organiser', 'Organiser, laptop: set up two areas and ticked three weekends for a new trip');
await op.getByTestId('tb-call-vote1').click();
await op.getByTestId('vote-depth').getByRole('button', { name: 'Areas only' }).click({ timeout: 8000 }).catch(() => {});
await op.getByTestId('call-the-vote').click();
await op.getByTestId('how-it-goes-out').waitFor({ timeout: 10000 }).catch(() => {});
await op.getByRole('button', { name: 'Done' }).click().catch(() => {});
await settle(op);
const { polls } = votePolls(db, PLAN);
const q = (re) => polls.find((p) => !p.optional && re.test(p.question));
for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 9]) {
  const area = q(/area/i); const wk = q(/weekend/i);
  if (area) castVote(db, i, area, optionOf(db, area, i % 3 === 2 ? 'Hunter Valley' : 'South Coast NSW'), 'yes');
  if (wk) db.plan_options.filter((o) => o.poll_id === wk.id).forEach((o, k) => castVote(db, i, wk, o, k === 2 && i % 2 ? 'no' : 'yes'));
  rsvp(db, PLAN, i, 'in');
}
await openBuilder(op, PLAN);
await op.getByTestId('vote-results').waitFor({ timeout: 8000 }).catch(() => {});
await R.shot(op, 'voting', 'organiser', 'Organiser, laptop: opened the builder when the vote closed');

let primary = null;
await laterStages({ R, S, db, P, browser, org, open, PLAN, NAME, UNTIL: 4.9, area: 'South Coast NSW', calls: { onePerson: P.keen }, courses: [L(1), L(2)], players: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  onAfterCalls: async () => { primary = state(db, PLAN).weekends?.[0] || null; },
  teeNo: (date) => !!primary && date >= primary.start && date <= primary.end,
  afterTeeTimes: async () => {
    // The organiser sees the gaps and opens it up.
    await openBuilder(op, PLAN);
    await step(op, 'calls').getByRole('button').first().click(); await wait(op, 900);
    await R.shot(op, 'falls-through', 'organiser', 'Organiser, laptop: opened Call the courses after the caller found nothing free on the primary weekend');
    const opened = await R.try('find “It’s not working? Open it up”', async () => {
      await op.getByTestId('open-it-up').scrollIntoViewIfNeeded(); await wait(op, 300);
      await R.shot(op, 'falls-through', 'organiser', 'Organiser, laptop: scrolled to “It’s not working? Open it up”', { full: false });
      return true;
    });
    if (opened) {
      await R.try('add another weekend', async () => {
        await op.getByTestId('open-up-weekend').click(); await wait(op, 900); await settle(op);
        await R.shot(op, 'falls-through', 'organiser', 'Organiser, laptop: clicked to put the next weekend from the vote on as another backup');
      });
    }
    {
      const k = await open(P.keen, 'keen');
      await go(k.page, `/plan/${PLAN}`, null, 1600);
      await R.shot(k.page, 'falls-through', 'keen', 'Keen player, phone (the caller): opened the trip after the organiser added another backup weekend');
      await openBuilder(k.page, PLAN);
      await step(k.page, 'calls').getByRole('button').first().click().catch(() => {}); await wait(k.page, 900);
      await R.shot(k.page, 'falls-through', 'keen', 'Keen player, phone (the caller): opened Call the courses again');
      await k.close();
      const m = await open(P.quiet, 'quiet');
      await go(m.page, `/plan/${PLAN}`, null, 1600);
      await R.shot(m.page, 'falls-through', 'quiet', 'Quiet player, phone: opened the trip after the primary weekend fell through');
      await m.close();
    }
    if (opened) {
      await openBuilder(op, PLAN);
      await step(op, 'calls').getByRole('button').first().click(); await wait(op, 900);
      await R.try('re-open the area choice', async () => {
        await op.getByTestId('open-up-area').click(); await wait(op, 1200); await settle(op);
        await R.shot(op, 'falls-through', 'organiser', 'Organiser, laptop: clicked to re-open the choice of area');
      });
    }
    {
      const g = await open(P.guest, 'guest');
      await go(g.page, `/plan/${PLAN}`, null, 1600);
      await R.shot(g.page, 'falls-through', 'guest', 'Guest, phone: opened the trip after the area choice was re-opened');
      await g.close();
      const lou = await open(null, 'late');
      await go(lou.page, `/join/${S.invite}?to=${encodeURIComponent(`/plan/${PLAN}`)}`, null, 2000);
      await R.try('late joiner signs in', async () => {
        await lou.page.getByLabel('Your email').fill('lou.d@example.com');
        await lou.page.getByLabel('Password', { exact: true }).fill('fairway123');
        await lou.page.getByRole('button', { name: 'Continue with email' }).click();
        await lou.page.getByRole('button', { name: 'Create my account' }).click({ timeout: 8000 });
        await lou.page.getByLabel('6-digit code from the email').fill('123456');
        await lou.page.getByRole('button', { name: 'Confirm' }).click();
        await lou.page.getByText('Who are you?').waitFor({ timeout: 10000 });
        await lou.page.getByRole('button', { name: /Lou/ }).first().click();
        await lou.page.getByRole('button', { name: /Yes, I'm Lou|Yes, I’m Lou/ }).click(); await wait(lou.page, 1500);
        const notif = lou.page.getByRole('dialog', { name: /Turn on notifications/ });
        if (await notif.isVisible().catch(() => false)) { await notif.getByRole('button', { name: 'Not now' }).click(); await wait(lou.page, 1500); } else R.note(`${R.scenario}: no notifications box appeared for the late joiner after picking his name.`);
        await settle(lou.page, 1000);
        await R.shot(lou.page, 'falls-through', 'late', 'Late joiner, phone: opened the trip link from the group chat, made an account, picked his name');
      });
      await lou.close();
    }
    await openBuilder(op, PLAN);
    await R.shot(op, 'falls-through', 'organiser', 'Organiser, laptop: opened the builder again after re-opening the area choice');
    return 'stop';
  } });

await org.close();
await browser.close();
R.save();
console.log(`D: ${R.shots.length} shots, ${R.notes.length} notes, ${R.errors.length} errors`);
