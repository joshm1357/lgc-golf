// ov33: the click-through presentation (#/present/awards/<trip>). A trip with a round podium (joint 2nd), the main
// trophy with its hand-over, an award with nominations, a fine and a longest drive. Running order first, then step
// through on a 375-wide phone (taps, with the build-up beat) and a 1440-wide laptop (keyboard, reduced motion).
// Share one item to the Feed twice: one post. Fake database only.
// Usage: node presentation-test.mjs <base> <shotDir>
import { start, baseDb, P, GROUP, COURSE, sydney, now, scoreRows } from './ov28-fixtures.mjs';

const BASE = process.argv[2] || 'http://localhost:4358/lgc-golf/';
const TRIP = 'aaaaaaaa-0000-4000-8000-000000000330';
const OLD = 'aaaaaaaa-0000-4000-8000-000000000331';
const R1 = 'dddddddd-0000-4000-8000-000000000330';

const db = baseDb(['feed', 'dinner_awards', 'trophies']);
db.trips.push(
  { id: TRIP, name: 'Hunter 2026', start_date: sydney(-3), end_date: sydney(-2), status: 'active', created_at: now },
  { id: OLD, name: 'Coast 2025', start_date: '2025-03-01', end_date: '2025-03-02', status: 'active', created_at: now },
);
db.rounds.push({ id: R1, trip_id: TRIP, course_id: COURSE, name: 'The big day', play_date: sydney(-2), format: 'stableford', status: 'locked', ld_holes: [7], ctp_holes: [], comp_bonus: 0, created_at: now });
for (const pid of [P.mo, P.lou, P.bo, P.mike, P.al]) db.round_players.push({ round_id: R1, player_id: pid, playing_handicap: 0 });
const par = [5, 4, 3, 4, 3, 5, 4, 4, 4, 4, 3, 4, 4, 5, 3, 5, 4, 4];
db.scores = scoreRows(R1, {
  [P.mo]: par.map((p, i) => (i < 4 ? p - 1 : p)), // 40
  [P.lou]: par.map((p, i) => (i < 1 ? p - 1 : p)), // 38
  [P.bo]: par.map((p, i) => (i < 1 ? p - 1 : p)), // 38 — joint 2nd, hole for hole
  [P.mike]: par, // 36
  [P.al]: par.map((p, i) => (i < 3 ? p + 1 : p)), // 33
});
db.trophies.push({ id: 'tr-bd', trip_id: TRIP, name: 'BD Trophy', type: 'stableford_total', created_at: now });
db.comps.push({ id: 'comp-bd', group_id: GROUP, trip_id: TRIP, name: 'BD Trophy', kind: 'individual_points', round_ids: [], settings: {}, trophy_id: 'tr-bd', sort: 0, retired: false, created_at: now });
db.honour_board.push({ id: 'hb-old', group_id: GROUP, trophy_name: 'BD Trophy', label: '2025', winner_names: 'Bo', player_ids: [P.bo], sort_key: 10, trip_id: OLD, created_at: now });
db.side_entries.push(
  { id: 'se1', group_id: GROUP, round_id: R1, kind: 'ld', hole: 7, player_id: P.al, distance_m: 271, confirmed: true, created_at: now },
  { id: 'se2', group_id: GROUP, round_id: R1, kind: 'ld', hole: 7, player_id: P.mo, distance_m: 255, created_at: now },
);
db.dinner_awards.push(
  { id: 'aw-shot', group_id: GROUP, trip_id: TRIP, title: 'Shot of the trip', kind: 'award', status: 'closed', created_at: now },
  { id: 'fine-wb', group_id: GROUP, trip_id: TRIP, title: 'Wrong ball', kind: 'fine', status: 'closed', reward_type: 'money', reward_amount: 5, winner_id: P.mike, created_at: now },
);
db.dinner_award_nominations.push(
  { id: 'n1', group_id: GROUP, award_id: 'aw-shot', player_id: P.lou, reason: 'Holed out from the bunker on 9', created_at: '2026-01-01T00:00:01Z' },
  { id: 'n2', group_id: GROUP, award_id: 'aw-shot', player_id: P.bo, reason: 'Chip-in on 18', created_at: '2026-01-01T00:00:02Z' },
  { id: 'n3', group_id: GROUP, award_id: 'aw-shot', player_id: P.al, photo_url: 'https://example.com/al.jpg', created_at: '2026-01-01T00:00:03Z' },
  { id: 'n4', group_id: GROUP, award_id: 'fine-wb', player_id: P.mike, reason: 'Played Bo’s Pro V1', created_at: now },
);
db.dinner_award_votes.push(
  { award_id: 'aw-shot', group_id: GROUP, nomination_id: 'n1', voter_id: P.bo, created_at: now },
  { award_id: 'aw-shot', group_id: GROUP, nomination_id: 'n1', voter_id: P.mo, created_at: now },
  { award_id: 'aw-shot', group_id: GROUP, nomination_id: 'n2', voter_id: P.al, created_at: now },
);

const t = await start('presentation', { db, organiser: true, me: P.kurt });
const { page, check, shot, noSideScroll } = t;
await page.route('https://example.com/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#4a7"/></svg>' }));

const stage = page.getByTestId('pz-stage');
const where = async () => ({ key: await stage.getAttribute('data-key'), step: await stage.getAttribute('data-step'), revealed: await stage.getAttribute('data-revealed') });

// ---------------------------------------------------------------- 1. Phone: the running order
await page.goto(`${BASE}#/present/awards/${TRIP}`);
await page.getByTestId('pz-setup').waitFor({ timeout: 15000 });
await page.waitForTimeout(1500);
const keys = await page.getByTestId('pz-item').evaluateAll((els) => els.map((e) => e.dataset.key));
check(keys.length >= 6, `running order lists the items (${keys.join(', ')})`);
check(keys[0].startsWith('s-'), 'running order: the side comp first');
check(keys.indexOf('a-fine-wb') < keys.indexOf('a-aw-shot'), 'running order: fines before awards');
check(keys[keys.length - 1] === 't-comp-bd', 'running order: the main trophy last');
check(!(await page.locator('.pz').innerText()).toLowerCase().includes('dinner'), 'running order: never "dinner"');
await shot('phone-0-running-order');
await noSideScroll('running order');
// Move the round podium up one, then back; untick the fines tally.
const roundKey = `r-${R1}`;
const ri = keys.indexOf(roundKey);
await page.getByLabel('Move The big day up').click();
let k2 = await page.getByTestId('pz-item').evaluateAll((els) => els.map((e) => e.dataset.key));
check(k2.indexOf(roundKey) === ri - 1, 'running order: ↑ moves an item up');
await page.getByTestId('pz-reset').click();
k2 = await page.getByTestId('pz-item').evaluateAll((els) => els.map((e) => e.dataset.key));
check(k2.join() === keys.join(), 'running order: back to the usual order');
const tallyRow = page.locator('[data-testid="pz-item"][data-key="fines-tally"] input');
if (await tallyRow.count()) await tallyRow.uncheck();

// ---------------------------------------------------------------- 2. Phone: step through by tapping
await page.getByTestId('present-start').click();
await stage.waitFor();
const seen = [];
let sawBeat = false;
let mentionsText = '';
let handover = '';
let nextLabel = '';
for (let i = 0; i < 60; i++) {
  const w = await where();
  if (w.key === 'end') break;
  if ((w.step.startsWith('place') || w.step === 'winner') && w.revealed === '0') {
    sawBeat = sawBeat || /…/.test(await page.getByTestId('pz-beat').innerText());
    await page.waitForTimeout(1300);
  }
  const w2 = await where();
  seen.push(`${w2.key}:${w2.step}`);
  if (w2.key === 't-comp-bd' && w2.step === 'mentions') mentionsText = await page.getByTestId('pz-mentions').innerText();
  if (w2.key === 't-comp-bd' && w2.step === 'place1') { handover = await page.getByTestId('pz-handover').innerText(); await shot('phone-3-winner'); }
  if (w2.key === 't-comp-bd' && w2.step === 'place2') await shot('phone-2-joint-second');
  if (w2.key === 'a-aw-shot' && w2.step === 'mentions') await shot('phone-1-nominations');
  if (w2.key === keys[0] && w2.step === 'title') nextLabel = await page.getByTestId('pz-next').innerText();
  // Tap the right side of the stage (forward zone).
  const box = await stage.boundingBox();
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.5);
  await page.waitForTimeout(120);
}
const bd = seen.filter((s) => s.startsWith('t-comp-bd:')).map((s) => s.split(':')[1]);
check(bd.join() === 'title,mentions,place2,place1', `main trophy: title → mentions → joint 2nd → 1st (${bd.join()})`);
check(/Mike/.test(mentionsText) && /4th/.test(mentionsText) && /Al/.test(mentionsText), `honourable mentions: 4th and 5th with their scores (${mentionsText.replace(/\n/g, ' ')})`);
check(/Mo wins the BD Trophy \d{4}, takes it from Bo/.test(handover), `1st: the hand-over line (${handover})`);
const aw = seen.filter((s) => s.startsWith('a-aw-shot:')).map((s) => s.split(':')[1]);
check(aw.join() === 'title,mentions,winner', `award: title → nominations → winner (${aw.join()})`);
const fine = seen.filter((s) => s.startsWith('a-fine-wb:')).map((s) => s.split(':')[1]);
check(fine.join() === 'title,winner', `fine with one person: title → winner (${fine.join()})`);
check(!seen.some((s) => s.startsWith('fines-tally:')), 'an unticked item is skipped');
check(seen[seen.length - 1].startsWith('t-comp-bd:'), 'the main trophy is last');
check(sawBeat, 'a build-up beat before each reveal');
check(/^Next: /.test(nextLabel), `"Next: …" shows what's coming (${nextLabel})`);
check(/That’s a wrap/.test(await page.getByTestId('pz-title').innerText()), 'ends on "That’s a wrap"');
await noSideScroll('presentation');

// Back zone: tap the left third goes back.
const box = await stage.boundingBox();
await page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.5);
await page.waitForTimeout(200);
check((await where()).key === 't-comp-bd', 'tapping the left third goes back');

// ---------------------------------------------------------------- 3. Share to the Feed: one post per item
await page.goto(`${BASE}#/present/awards/${TRIP}?only=a-aw-shot`);
await stage.waitFor({ timeout: 15000 });
await page.waitForTimeout(800);
check((await where()).step === 'title', '?only= presents one item, straight in');
await page.getByTestId('pz-skip').click();
await page.waitForTimeout(200);
const ws = await where();
check(ws.step === 'winner' && ws.revealed === '1', `"Skip to winner" jumps to the winner, revealed (${ws.step})`);
check(/Lou/.test(await page.getByTestId('pz-name').innerText()), 'the award winner: Lou');
const before = db.posts.length;
await page.getByTestId('pz-share').click();
await page.waitForTimeout(800);
check(db.posts.length === before + 1 && /Shot of the trip — Lou/.test(db.posts[db.posts.length - 1].body || ''), `share: one post on the Feed (${db.posts[db.posts.length - 1]?.body})`);
check(await page.getByTestId('pz-share').isDisabled(), 'share: the button says it’s done');
const postId = db.posts[db.posts.length - 1].id;
await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('tgt-present-shared')).forEach((k) => localStorage.removeItem(k)));
await page.reload();
await stage.waitFor({ timeout: 15000 });
await page.waitForTimeout(800);
await page.getByTestId('pz-skip').click();
await page.waitForTimeout(600);
check(/On the Feed/.test(await page.getByTestId('pz-share').innerText()), 'share: another phone sees it’s already on the Feed');
check(db.posts.filter((p) => p.id === postId).length === 1 && db.posts.length === before + 1, 'share: still only one post');

// ---------------------------------------------------------------- 4. Laptop on the TV: 1440 wide, keyboard, reduced motion
await page.emulateMedia({ reducedMotion: 'reduce' });
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${BASE}#/present/awards/${TRIP}`);
await page.getByTestId('pz-setup').waitFor({ timeout: 15000 });
await page.waitForTimeout(1200);
await shot('desk-0-running-order');
await page.getByTestId('present-start').click();
await stage.waitFor();
await page.locator('body').focus().catch(() => {});
check(await page.getByTestId('pz-full').isVisible(), 'laptop: a full screen button');
const deskSeen = [];
for (let i = 0; i < 60; i++) {
  const w = await where();
  if (w.key === 'end') break;
  deskSeen.push(`${w.key}:${w.step}:${w.revealed}`);
  if (w.key === `r-${R1}` && w.step === 'title') await shot('desk-1-title');
  if (w.key === `r-${R1}` && w.step === 'place2') await shot('desk-2-joint-second');
  if (w.key === 'a-aw-shot' && w.step === 'mentions') await shot('desk-3-nominations');
  if (w.key === 't-comp-bd' && w.step === 'place1') await shot('desk-4-winner');
  await page.keyboard.press(i % 2 ? 'Space' : 'ArrowRight');
  await page.waitForTimeout(80);
}
check(deskSeen.filter((s) => /:(place|winner)/.test(s)).every((s) => s.endsWith(':1')), 'reduced motion: every reveal shows at once');
const rnd = deskSeen.filter((s) => s.startsWith(`r-${R1}:`)).map((s) => s.split(':')[1]);
check(rnd.join() === 'title,mentions,place2,place1', `round podium by keyboard: joint 2nd then 1st (${rnd.join()})`);
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(100);
check((await where()).key === 't-comp-bd', 'keyboard: ← goes back');
const fits = await page.evaluate(() => {
  const n = document.querySelector('[data-testid="pz-name"]');
  return n ? parseFloat(getComputedStyle(n).fontSize) : 0;
});
check(fits >= 64, `laptop: the winner's name is big enough to read across the room (${fits}px)`);
check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'laptop: no sideways scroll');

// ---------------------------------------------------------------- 5. The live "Present" screen still works, and links here
await page.goto(`${BASE}#/round/${R1}/present`);
await page.getByTestId('present-board').waitFor({ timeout: 15000 });
check(await page.getByTestId('present-show').count() === 1, 'the live leaderboard "Present" still works and links to the presentation');

await t.done();
