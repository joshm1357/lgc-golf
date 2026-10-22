// The first-ever open: the front door on a fresh phone, the join link (sign in, pick your name, notifications), the
// home screen of a group with no trip yet, the Caddie's hello, and the organiser's first open on a laptop.
// Capture only. Usage: node tests/walkthrough/first-open.mjs
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { makeServer } from './fake.mjs';
import { makeWorld, addPeople, LIBRARY, holes } from './fixtures.mjs';
import { recorder, wait } from './shoot.mjs';
import { person, go, settle, DESK, PHONE } from './common.mjs';

const R = recorder('0-first-open', 'First-ever open');
const db = makeWorld({ pastTrip: false });
const S = makeServer(db, { groupName: 'L.G.C', library: LIBRARY, holes });
const P = addPeople(S, { organiser: 0, keen: 1, quiet: 8, guest: 40, late: 9 });
const browser = await chromium.launch();
const open = (acct, label, width = PHONE, fresh = true) => person(browser, S, R, acct, label, { width, fresh });

// The organiser, the very first time on a laptop after starting the group.
{
  const o = await open(P.organiser, 'organiser', DESK);
  await go(o.page, '/', null, 2500);
  await R.shot(o.page, 'first-open', 'organiser', 'Organiser, laptop: opened the app for the first time after starting the group (no trips yet)');
  const notif = o.page.getByRole('dialog', { name: /Turn on notifications/ });
  if (await notif.isVisible().catch(() => false)) {
    await notif.getByRole('button', { name: 'Not now' }).click(); await wait(o.page, 1500);
    await R.shot(o.page, 'first-open', 'organiser', 'Organiser, laptop: pressed “Not now” on the notifications box');
  }
  const ask = o.page.getByRole('button', { name: /Ask me something/ });
  if (await ask.isVisible().catch(() => false)) {
    await ask.click(); await wait(o.page, 1200);
    await R.shot(o.page, 'first-open', 'organiser', 'Organiser, laptop: clicked “Ask me something” on the Caddie’s hello');
  } else R.note('First open: the organiser saw no Caddie hello bubble on the laptop.');
  await o.close();
}

// A player with a fresh phone: the plain address first, then the invite link from the group chat.
{
  const x = await open(null, 'late');
  await go(x.page, '/', null, 2000);
  await R.shot(x.page, 'first-open', 'late', 'New player, phone: typed the app’s address into the browser on a phone that has never opened it');
  await go(x.page, `/join/${S.invite}`, null, 2000);
  await R.shot(x.page, 'first-open', 'late', 'New player, phone: tapped the group’s invite link in the group chat');
  await R.try('sign in with email', async () => {
    await x.page.getByLabel('Your email').fill('lou.first@example.com');
    await x.page.getByLabel('Password', { exact: true }).fill('fairway123');
    await x.page.getByRole('button', { name: 'Continue with email' }).click();
    await x.page.getByRole('button', { name: 'Create my account' }).waitFor({ timeout: 8000 });
    await R.shot(x.page, 'first-open', 'late', 'New player, phone: typed an email and a password and pressed “Continue with email”');
    await x.page.getByRole('button', { name: 'Create my account' }).click();
    await x.page.getByLabel('6-digit code from the email').fill('123456');
    await x.page.getByRole('button', { name: 'Confirm' }).click();
    await x.page.getByText('Who are you?').waitFor({ timeout: 10000 }); await wait(x.page, 600);
    await R.shot(x.page, 'first-open', 'late', 'New player, phone: pressed “Create my account” and entered the code from the email');
    await x.page.getByRole('button', { name: /Lou/ }).first().click();
    await x.page.getByRole('button', { name: /Yes, I'm Lou|Yes, I’m Lou/ }).click(); await wait(x.page, 1800);
    await R.shot(x.page, 'first-open', 'late', 'New player, phone: tapped his name and “Yes, I’m Lou”');
    const notif = x.page.getByRole('dialog', { name: /Turn on notifications/ });
    if (await notif.isVisible().catch(() => false)) {
      await R.shot(x.page, 'first-open', 'late', 'New player, phone: the notifications box came up after he picked his name', { full: false });
      await notif.getByRole('button', { name: 'Not now' }).click(); await wait(x.page, 2500);
      await R.shot(x.page, 'first-open', 'late', 'New player, phone: pressed “Not now” on notifications');
    } else { R.note('First open: no notifications box after the new player picked his name.'); await R.shot(x.page, 'first-open', 'late', 'New player, phone: waited a moment on the screen he landed on'); }
    const ask = x.page.getByRole('button', { name: /Ask me something/ });
    if (await ask.isVisible().catch(() => false)) {
      await ask.click(); await wait(x.page, 1200);
      await R.shot(x.page, 'first-open', 'late', 'New player, phone: tapped “Ask me something” on the Caddie’s hello');
    }
  });
  await x.close();
}

// A guest's first open (already given a guest place by the organiser).
{
  const g = await open(P.guest, 'guest');
  await go(g.page, '/', null, 2500);
  await R.shot(g.page, 'first-open', 'guest', 'Guest, phone: opened the app for the first time');
  const notif = g.page.getByRole('dialog', { name: /Turn on notifications/ });
  if (await notif.isVisible().catch(() => false)) { await notif.getByRole('button', { name: 'Not now' }).click(); await wait(g.page, 2000); await R.shot(g.page, 'first-open', 'guest', 'Guest, phone: pressed “Not now” on notifications'); }
  await g.close();
}
// The keen player opens the More tab's Notifications screen to see what he'd get.
{
  const k = await open(P.keen, 'keen', PHONE, false);
  await go(k.page, '/notifications', null, 1800);
  await R.shot(k.page, 'first-open', 'keen', 'Keen player, phone: opened More → Notifications');
  await k.close();
}

await browser.close();
R.save();
console.log(`first-open: ${R.shots.length} shots, ${R.notes.length} notes, ${R.errors.length} errors`);
