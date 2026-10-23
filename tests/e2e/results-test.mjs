// ov28 (walkthrough W1, I9, I14, I16 and the small fixes): a finished trip opens on its results — winner and
// trophy handed over, the Cup verdict from the real matches, a podium per round, fines tally, who tipped right, best
// photos, and only then "Plan the next trip". The Trophy Room says who holds it now; the awards presentation steps
// through the winners. Fake database only. Usage: node results-test.mjs <base> <shotDir>
import { start, baseDb, P, GROUP, COURSE, sydney, now, scoreRows } from './ov28-fixtures.mjs';

const BASE = process.argv[2] || 'http://localhost:4363/lgc-golf/';
const TRIP = 'aaaaaaaa-0000-4000-8000-000000000284';
const OLD = 'aaaaaaaa-0000-4000-8000-000000000285';
const R1 = 'dddddddd-0000-4000-8000-000000000284';
const PLAN = 'eeeeeeee-0000-4000-8000-000000000284';
const year = sydney(-2).slice(0, 4);

const db = baseDb(['feed', 'cup', 'planner', 'dinner_awards', 'trophies', 'tipping']);
db.trips.push(
  { id: TRIP, name: 'Hunter 2026', start_date: sydney(-3), end_date: sydney(-2), status: 'active', created_at: now },
  { id: OLD, name: 'Coast 2025', start_date: '2025-03-01', end_date: '2025-03-02', status: 'active', created_at: now },
);
db.rounds.push({ id: R1, trip_id: TRIP, course_id: COURSE, name: 'The big day', play_date: sydney(-2), format: 'stableford', status: 'locked', ld_holes: [], ctp_holes: [], comp_bonus: 0, created_at: now });
for (const pid of [P.mo, P.lou, P.bo, P.mike]) db.round_players.push({ round_id: R1, player_id: pid, playing_handicap: 0 });
const par = [5, 4, 3, 4, 3, 5, 4, 4, 4, 4, 3, 4, 4, 5, 3, 5, 4, 4];
db.scores = scoreRows(R1, {
  [P.mo]: par.map((p, i) => (i < 4 ? p - 1 : p)), // 40
  [P.lou]: par.map((p, i) => (i < 2 ? p - 1 : p)), // 38
  [P.bo]: par, // 36
  [P.mike]: par.map((p) => p + 1), // 18
});
db.trophies.push({ id: 'tr-bd', trip_id: TRIP, name: 'BD Trophy', type: 'stableford_total', created_at: now });
db.comps.push(
  { id: 'comp-bd', group_id: GROUP, trip_id: TRIP, name: 'BD Trophy', kind: 'individual_points', round_ids: [], settings: {}, trophy_id: 'tr-bd', sort: 0, retired: false, created_at: now },
  { id: 'comp-cup', group_id: GROUP, trip_id: TRIP, name: 'The Ryder Cup', kind: 'cup', round_ids: [], settings: { points: 4 }, trophy_id: null, sort: 1, retired: false, created_at: now },
);
// The old BD Trophy row for this trip (the "listed twice" bug): one line only.
db.trophies.push({ id: 'tr-bd-old', trip_id: TRIP, name: 'BD Trophy', type: 'stableford_total', created_at: now });
db.honour_board.push({ id: 'hb-old', group_id: GROUP, trophy_name: 'BD Trophy', label: '2025', winner_names: 'Bo', player_ids: [P.bo], sort_key: 10, trip_id: OLD, created_at: now });
db.cup_sides.push({ id: 'side-blue', group_id: GROUP, name: 'Team Blue', colour: '#1F4B9E', sort: 1 }, { id: 'side-red', group_id: GROUP, name: 'Team Red', colour: '#B3261E', sort: 2 });
const won = (side) => Object.fromEntries(Array.from({ length: 16 }, (_, i) => [String(i + 1), side])); // typed in past the end
db.cup_matches.push(
  { id: 'm1', group_id: GROUP, round_id: R1, sort: 1, format: 'singles', a_players: [P.kurt], b_players: [P.mike], a_hcp: 0, b_hcp: 0, points: 2, holes: won('a'), created_at: now, updated_at: now },
  { id: 'm2', group_id: GROUP, round_id: R1, sort: 2, format: 'singles', a_players: [P.al], b_players: [P.bo], a_hcp: 0, b_hcp: 0, points: 1, holes: won('a'), created_at: now, updated_at: now },
);
db.plans.push({ id: PLAN, group_id: GROUP, trip_id: TRIP, kind: 'trip', name: 'Hunter 2026', status: 'confirmed', organiser_id: P.kurt, start_date: sydney(-3), end_date: sydney(-2), created_at: now });
db.trip_tips.push({ plan_id: PLAN, player_id: P.lou, pick_id: P.mo }, { plan_id: PLAN, player_id: P.bo, pick_id: P.bo });
db.tips.push({ id: 'tip1', group_id: GROUP, trip_id: TRIP, player_id: P.mike, target: 'cup', target_id: TRIP, pick: 'side-blue' });
db.dinner_awards.push({ id: 'fine-1', group_id: GROUP, trip_id: TRIP, title: 'Wrong ball', kind: 'fine', status: 'closed', created_at: now },
  { id: 'aw-1', group_id: GROUP, trip_id: TRIP, title: 'Shot of the trip', kind: 'award', status: 'closed', created_at: now });
db.dinner_award_nominations.push({ id: 'n1', group_id: GROUP, award_id: 'fine-1', player_id: P.mo, created_at: now }, { id: 'n2', group_id: GROUP, award_id: 'aw-1', player_id: P.lou, created_at: now });
db.dinner_award_votes.push({ award_id: 'aw-1', group_id: GROUP, nomination_id: 'n2', voter_id: P.bo, created_at: now });
db.posts.push({ id: 'post-1', group_id: GROUP, trip_id: TRIP, player_id: P.lou, body: 'What a shot', photo_url: 'https://example.com/p1.jpg', created_at: now });

const t = await start('results', { db, organiser: true, me: P.kurt });
const { page, check, shot, noSideScroll } = t;
await page.route('https://example.com/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }));

// 1. The finished trip opens on its results.
await page.goto(`${BASE}#/trip-now/${TRIP}`);
const res = page.getByTestId('trip-results');
await res.waitFor({ timeout: 15000 });
await page.waitForTimeout(1200);
check(/Mo/.test(await page.getByTestId('results-winner').innerText()), 'the winner: Mo');
const trophies = await page.getByTestId('results-trophy').allInnerTexts();
check(trophies.some((x) => x.includes(`Mo wins the BD Trophy ${year}, takes it from Bo`)), `the hand-over line (${trophies.join(' | ')})`);
check(trophies.filter((x) => /BD Trophy/.test(x)).length === 1, 'the BD Trophy listed once');
const cup = await page.getByTestId('results-cup').innerText();
check(/Team Blue win 3–0/.test(cup), `the Cup verdict from the real matches (${cup.replace(/\n/g, ' ')})`);
check(/🥇[\s\S]*Mo[\s\S]*40 pts/.test(await page.getByTestId('results-podiums').innerText()), 'a podium per round');
check(/Mo/.test(await page.getByTestId('results-fines').innerText()), 'the fines tally');
const tips = await page.getByTestId('results-tips').innerText();
check(/BD Trophy: Lou/.test(tips) && /The Cup: Mike/.test(tips), `who tipped right (${tips.replace(/\n/g, ' ')})`);
check(await page.getByTestId('results-photos').count() === 1, 'best photos');
const order = await page.locator('[data-testid="results-hero"], [data-testid="plan-next"]').evaluateAll((els) => els.map((e) => e.dataset.testid));
check(order[0] === 'results-hero' && order[order.length - 1] === 'plan-next', '"Plan the next trip" comes after the results');
check(await page.getByTestId('trip-comps').count() === 0, 'no "leads" list on a finished trip');
await shot('1-results');
await noSideScroll('results');

// 2. The Trophy Room says who holds it now, before it's engraved.
await page.goto(`${BASE}#/trophies`);
await page.getByTestId('trophy-case').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(1000);
const holders = await page.getByTestId('trophy-holder').allInnerTexts();
check(holders.some((h) => /HELD BY MO/.test(h)), `Trophy Room: held by Mo (${holders.join(' | ')})`);
const leads = await page.getByTestId('trophy-lead').allInnerTexts();
check(leads.some((l) => /takes it from Bo · to be engraved/.test(l)) && !leads.some((l) => /leads/.test(l)), `Trophy Room: handed over, not "leads" (${leads.join(' | ')})`);

// 3. Organiser hands the trophies over: the honour board row is written.
await page.goto(`${BASE}#/trip-now/${TRIP}`);
await page.getByTestId('hand-over').click({ timeout: 15000 });
await page.waitForTimeout(1000);
check(db.honour_board.some((h) => h.trophy_name === 'BD Trophy' && h.trip_id === TRIP && h.winner_names === 'Mo'), 'hand over: the BD Trophy is engraved for Mo');
check(db.posts.some((p) => /takes it from Bo/.test(p.body || '')), 'hand over: the Feed hears about it');

// 4. The Cup board on a finished trip: the verdict, never "to win" or "10&2".
await page.goto(`${BASE}#/cup`);
await page.getByTestId('cup-verdict').waitFor({ timeout: 15000 });
check(/Team Blue win 3–0/.test(await page.getByTestId('cup-verdict').innerText()), 'Cup board: the verdict');
const board = await page.locator('.page').first().innerText();
check(!/to win/.test(board), 'Cup board: no "to win" once it\'s over');
check(!/10&2|won \d+&2/.test(board) && /won 10&8/.test(board), 'Cup board: "won 10&8", never "10&2"');

// 5. The awards presentation: winners one by one.
await page.goto(`${BASE}#/present/awards/${TRIP}`);
await page.getByTestId('awards-slide').waitFor({ timeout: 15000 });
await page.waitForTimeout(800);
const titles = [];
for (let i = 0; i < 12; i++) {
  titles.push(await page.getByTestId('awards-slide-title').innerText());
  if (await page.getByTestId('awards-next').isDisabled()) break;
  await page.getByTestId('awards-next').click();
}
check(titles.includes('BD Trophy'), `presentation: the BD Trophy (${titles.join(' | ')})`);
check(titles.some((x) => /Award: Shot of the trip/.test(x)), 'presentation: the group\'s awards');
check(titles.some((x) => /fines tally/.test(x)), 'presentation: the fines tally');
check(titles[titles.length - 1] === 'That’s a wrap', 'presentation: ends with "That\'s a wrap"');
check(!titles.join(' ').toLowerCase().includes('dinner'), 'presentation: never "dinner"');
await shot('2-presentation');

// 6. The awards page says "Awards and fines" and has Present.
await page.goto(`${BASE}#/dinner/${TRIP}`);
await page.getByTestId('present-awards').waitFor({ timeout: 15000 });
check(/Awards and fines/.test(await page.locator('.hdr').first().innerText()), 'awards page: "Awards and fines", not "dinner"');

await t.done();
