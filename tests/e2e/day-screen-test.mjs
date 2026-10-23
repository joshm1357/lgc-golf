// ov28 (walkthrough D1, D2, C2, I12): the day screen leads with what the round is. A Cup day: the Cup first, your
// match first, no empty Stableford board. A Stableford day: headings, points order (with "On pace"), "joint lead",
// your row highlighted and pinned; fines so far; the full leaderboard the same. Organiser: set the groups nudge.
// Fake database only. Usage: node day-screen-test.mjs <base> <shotDir>
import { start, baseDb, P, GROUP, COURSE, sydney, now, scoreRows } from './ov28-fixtures.mjs';

const BASE = process.argv[2] || 'http://localhost:4363/lgc-golf/';
const TRIP = 'aaaaaaaa-0000-4000-8000-000000000282';
const R1 = 'dddddddd-0000-4000-8000-000000000282';
const R2 = 'dddddddd-0000-4000-8000-000000000283';

const db = baseDb(['feed', 'cup', 'tee_groups', 'dinner_awards']);
db.trips.push({ id: TRIP, name: 'Hunter 2026', start_date: sydney(0), end_date: sydney(1), status: 'active', created_at: now });
db.rounds.push(
  { id: R1, trip_id: TRIP, course_id: COURSE, name: 'Day one', play_date: sydney(0), format: 'stableford', status: 'live', ld_holes: [], ctp_holes: [], comp_bonus: 0, created_at: now },
  { id: R2, trip_id: TRIP, course_id: COURSE, name: 'Day two', play_date: sydney(1), format: 'stableford', status: 'setup', ld_holes: [], ctp_holes: [], comp_bonus: 0, created_at: now },
);
db.cup_sides.push({ id: 'side-blue', group_id: GROUP, name: 'Team Blue', colour: '#1F4B9E', sort: 1 }, { id: 'side-red', group_id: GROUP, name: 'Team Red', colour: '#B3261E', sort: 2 });
db.cup_matches.push(
  { id: 'm1', group_id: GROUP, round_id: R1, sort: 1, format: 'singles', a_players: [P.cy], b_players: [P.lou], a_hcp: 0, b_hcp: 0, points: 1, holes: { 1: 'a', 2: 'a', 3: 'a' }, created_at: now, updated_at: now },
  { id: 'm2', group_id: GROUP, round_id: R1, sort: 2, format: 'singles', a_players: [P.kurt], b_players: [P.mike], a_hcp: 0, b_hcp: 0, points: 1, holes: { 1: 'b' }, created_at: now, updated_at: now },
);
for (const pid of Object.values(P)) db.round_players.push({ round_id: R1, player_id: pid, playing_handicap: 0 });

const t = await start('day-screen', { db });
const { page, check, shot, noSideScroll, calls } = t;

// 1. A Cup day, nobody entering Stableford: the Cup first, your match first, no empty board.
await page.goto(`${BASE}#/`);
await page.getByTestId('cup-day').waitFor({ timeout: 15000 });
const order = await page.locator('[data-testid="cup-day"], [data-testid="your-round"], [data-testid="trip-comps"]').evaluateAll((els) => els.map((e) => e.dataset.testid));
check(order[0] === 'cup-day', `the Cup leads the day screen (${order.join(', ')})`);
check(/Team Blue 0 – 0 Team Red/.test(await page.getByTestId('cup-day-score').innerText()), 'Cup score so far');
check(/If it finished now: 1–1/.test(await page.getByTestId('cup-day-projected').innerText()), '"If it finished now" from the live matches');
const rows = await page.locator('[data-testid="cup-day-mine"], [data-testid="cup-day-match"]').evaluateAll((els) => els.map((e) => e.dataset.testid));
check(rows[0] === 'cup-day-mine', 'your match first');
await page.waitForTimeout(1000);
check(await page.getByTestId('trip-round-board').count() === 0, 'no empty Stableford board on a Cup day');
await shot('1-cup-day');
await noSideScroll('Cup day');

// 2. Matches scored as holes → swing alert asked of the server after a hole is saved.
await page.goto(`${BASE}#/cup/m2`);
await page.getByText('Who won the hole').waitFor({ timeout: 15000 }).catch(async () => console.log('MATCH PAGE:', (await page.locator('body').innerText()).slice(0, 600)));
await page.getByRole('button', { name: /Team Red — Mike/ }).click({ timeout: 15000 });
await page.waitForTimeout(800);
check(calls.some((c) => c.type === 'swing' && c.match_id === 'm2'), 'saving a hole asks the server about a swing (it decides and rate-limits)');

// 3. A plain Stableford day: headings, points order, joint lead, me pinned.
db.cup_matches = [];
db.group_features = db.group_features.filter((f) => f.feature_key !== 'cup');
db.scores = scoreRows(R1, {
  [P.lou]: [4, 4, 3, 4, 3, 5, 4], // played 7, one birdie: 15 pts, +1 on pace
  [P.mo]: [5, 4, 3, 4, 3, 5, 4, 4, 4], // 9 holes, level
  [P.bo]: [5, 4, 3, 4, 3, 5, 4, 4, 4],
  [P.cy]: [6, 5, 4], [P.di]: [6, 5, 4], [P.ed]: [6, 5, 4], [P.fin]: [6, 5, 4], [P.al]: [6, 5, 4], [P.kurt]: [6, 5, 4],
  [P.mike]: [9, 9, 9],
});
db.dinner_awards.push({ id: 'fine-1', group_id: GROUP, trip_id: TRIP, title: 'Wrong ball', kind: 'fine', status: 'nominating', created_at: now });
db.dinner_award_nominations.push({ id: 'n1', group_id: GROUP, award_id: 'fine-1', player_id: P.mo, created_at: now });
await page.goto(`${BASE}#/`);
await page.reload();
const board = page.getByTestId('trip-round-board');
await board.waitFor({ timeout: 15000 });
check(await board.getByTestId('mini-head').isVisible(), 'the mini board has headings');
check(/pts/i.test(await board.getByTestId('mini-head').innerText()), 'headings include Pts');
const names = await board.getByTestId('mini-row').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
check(/Mo|Bo/.test(names[0]) && /Mo|Bo/.test(names[1]) && /T1/.test(names[0]), `most points first, joint first shown as T1 (${names.slice(0, 3).join(' | ')})`);
check(/Bo and Mo joint lead/.test(await board.getByTestId('mini-lead').innerText()), '"Bo and Mo joint lead"');
check(await board.getByTestId('mini-pinned').count() === 1, 'my row is pinned (I’m below the top 8)');
check(await board.locator('.lb-row.me').count() >= 1, 'my row is highlighted');
await board.getByTestId('order-pace').click();
await page.waitForTimeout(300);
const pace = await board.getByTestId('mini-row').first().innerText();
check(/Lou/.test(pace), `On pace puts Lou (7 holes, ahead of 2 a hole) first (${pace.replace(/\s+/g, ' ')})`);
check(/Mo 1/.test(await page.getByTestId('fines-ticker').innerText()), 'fines so far: Mo 1');
check(await page.getByTestId('fine-someone').isVisible(), 'one tap: Fine someone');
await shot('2-stableford-day');
await noSideScroll('Stableford day');

// 4. The full leaderboard: Points / On pace / Projected, me highlighted and pinned, room under the last row.
await page.goto(`${BASE}#/?r=${R1}`);
await page.getByRole('button', { name: 'On pace' }).waitFor({ timeout: 15000 });
check(await page.getByTestId('lb-pinned').count() === 1, 'leaderboard: my row pinned at the top');
check(await page.getByTestId('lb-me').count() === 1, 'leaderboard: my row highlighted in place');
check(/Bo|Mo/.test(await page.locator('.lb-row').nth(1).innerText()), 'leaderboard: points order by default');
check(await page.locator('.fab-space').count() === 1, 'leaderboard: room under the rows for Enter score');
await shot('3-leaderboard');

// 5. Hole screen: Fine someone.
await page.goto(`${BASE}#/score/${R1}`);
await page.getByTestId('fine-someone').waitFor({ timeout: 15000 });
await page.getByTestId('fine-someone').click();
check(await page.getByTestId('fine-sheet').waitFor({ timeout: 8000 }).then(() => true, () => false), 'hole screen: Fine someone opens the fines sheet');

// 6. Organiser: rounds coming up with no playing groups get a nudge.
t.state.organiser = true;
await page.goto(`${BASE}#/`);
await page.reload();
await page.getByTestId('tee-nudge').waitFor({ timeout: 15000 }).catch(() => {});
check(await page.getByTestId('tee-nudge').count() === 1, 'organiser: "Set the playing groups" for the next few days');
await shot('4-organiser-nudge');

await t.done();
