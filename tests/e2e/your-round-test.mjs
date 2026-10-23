// ov28 (walkthrough C1/C2): "Your round" — team, partner, opponents, playing group, tee time — for a Cup match, an
// Ambrose team, a plain playing group, and nothing at all. Fake database only.
// Usage: node your-round-test.mjs <base> <shotDir>
import { start, baseDb, P, GROUP, COURSE, sydney, now } from './ov28-fixtures.mjs';

const BASE = process.argv[2] || 'http://localhost:4363/lgc-golf/';
const TRIP = 'aaaaaaaa-0000-4000-8000-000000000281';
const R1 = 'dddddddd-0000-4000-8000-000000000281';
const PLAN = 'eeeeeeee-0000-4000-8000-000000000281';

const db = baseDb(['feed', 'cup', 'planner', 'tee_groups', 'planner_costs']);
db.trips.push({ id: TRIP, name: 'Kurt’s Ryder Cup', start_date: sydney(0), end_date: sydney(1), status: 'active', created_at: now });
db.rounds.push({ id: R1, trip_id: TRIP, course_id: COURSE, name: 'Saturday — Cypress Lakes', play_date: sydney(0), format: 'stableford', status: 'live', ld_holes: [], ctp_holes: [], comp_bonus: 0, created_at: now });
db.cup_sides.push({ id: 'side-blue', group_id: GROUP, name: 'Team Blue', colour: '#1F4B9E', sort: 1 }, { id: 'side-red', group_id: GROUP, name: 'Team Red', colour: '#B3261E', sort: 2 });
db.cup_matches.push(
  { id: 'm-other', group_id: GROUP, round_id: R1, sort: 1, format: 'ambrose', a_players: [P.cy, P.di], b_players: [P.lou, P.mo], a_hcp: 5, b_hcp: 5, points: 2, holes: {}, tee_time: '06:52', created_at: now, updated_at: now },
  { id: 'm-mine', group_id: GROUP, round_id: R1, sort: 2, format: 'ambrose', a_players: [P.kurt, P.al], b_players: [P.mike, P.bo], a_hcp: 6, b_hcp: 6, points: 2, holes: {}, tee_time: '07:00', created_at: now, updated_at: now },
);
for (const [pid, side] of [[P.kurt, 'side-blue'], [P.al, 'side-blue'], [P.cy, 'side-blue'], [P.di, 'side-blue'], [P.mike, 'side-red'], [P.bo, 'side-red'], [P.lou, 'side-red'], [P.mo, 'side-red']]) db.players.find((p) => p.id === pid).cup_side = side;
db.comps.push({ id: 'comp-cup', group_id: GROUP, trip_id: TRIP, name: 'The Ryder Cup', kind: 'cup', round_ids: [], settings: { points: 4 }, trophy_id: null, sort: 1, retired: false, created_at: now });
// Mike's a maybe on the trip, and Kurt's the organiser.
db.plans.push({ id: PLAN, group_id: GROUP, trip_id: TRIP, kind: 'trip', name: 'Kurt’s Ryder Cup', status: 'confirmed', organiser_id: P.kurt, deposit_pp: 250, start_date: sydney(0), end_date: sydney(1), created_at: now });
db.plan_rsvps.push({ plan_id: PLAN, player_id: P.mike, status: 'maybe' }, { plan_id: PLAN, player_id: P.bo, status: 'in' });

const t = await start('your-round', { db });
const { page, check, shot, noSideScroll } = t;

// 1. The day screen: your round, a Cup match.
await page.goto(`${BASE}#/`);
const card = page.getByTestId('your-round').first();
await card.waitFor({ timeout: 15000 });
const txt = await card.innerText();
check(/Team Red/.test(txt), `your team: Team Red (${txt.replace(/\n/g, ' / ')})`);
check(/with Bo/.test(txt), 'your partner: Bo');
check(/Against\s+Kurt & Al/.test(txt), 'your opponents: Kurt & Al');
check(/You’re off 7:00, hole 1, with Bo, Kurt and Al/.test(txt), 'your tee time and group: 7:00, hole 1, with Bo, Kurt and Al');
const nudge = await card.getByTestId('your-nudge').innerText({ timeout: 10000 }).catch(() => '');
check(/You’re in Kurt’s draw for Team Red\. Are you coming\?/.test(nudge), `a maybe in the draw gets the nudge (${nudge})`);
check(await card.getByTestId('score-my-match').isVisible(), 'Score my match (the round is live)');
await shot('1-day-your-round');
await noSideScroll('day screen');

// 2. The Cup board: your round at the top, your match first and marked, with its tee time.
await page.goto(`${BASE}#/cup`);
await page.getByTestId('cup-my-match').waitFor({ timeout: 15000 });
check(await page.getByTestId('your-round').count() === 1, 'the Cup board shows your round');
const firstMatch = await page.locator('[data-testid="cup-my-match"], [data-testid="cup-match"]').first().getAttribute('data-testid');
check(firstMatch === 'cup-my-match', 'your match is first on the board');
check(/Your match · 7:00/i.test(await page.getByTestId('cup-my-match').innerText()), 'your match is marked with its tee time');
check(/6:52/.test(await page.getByTestId('cup-match').first().innerText()), 'other matches show their tee time');
await shot('2-cup-board');

// 3. The comps board shows it too.
await page.goto(`${BASE}#/comps-board?trip=${TRIP}`);
await page.getByTestId('your-round').first().waitFor({ timeout: 15000 });
check(true, 'the comps board shows your round');

// 4. Paid and in: no nudge.
db.plan_rsvps[0].status = 'in';
db.plan_transfers.push({ plan_id: PLAN, from_id: P.mike, to_id: null, amount: 250 });
await page.goto(`${BASE}#/`);
await page.getByTestId('your-round').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(800);
check(await page.getByTestId('your-nudge').count() === 0, 'in and paid: no nudge');

// 5. No Cup: an Ambrose team in a playing group (works for groups without the Cup).
db.group_features = db.group_features.filter((f) => f.feature_key !== 'cup');
db.comps = [];
db.cup_matches = [];
db.rounds[0].format = 'ambrose';
db.teams.push({ id: 'team-1', round_id: R1, name: 'Team 1', handicap: 4, created_at: now }, { id: 'team-2', round_id: R1, name: 'Team 2', handicap: 4, created_at: now }, { id: 'team-3', round_id: R1, name: 'Team 3', handicap: 4, created_at: now });
db.team_players.push({ team_id: 'team-1', player_id: P.mike }, { team_id: 'team-1', player_id: P.bo }, { team_id: 'team-2', player_id: P.cy }, { team_id: 'team-2', player_id: P.di }, { team_id: 'team-3', player_id: P.lou }, { team_id: 'team-3', player_id: P.mo });
db.tee_groups.push({ id: 'tg1', group_id: GROUP, round_id: R1, group_no: 1, tee_time: '08:16', start_hole: null, player_ids: [P.mike, P.bo, P.cy, P.di] });
await page.goto(`${BASE}#/`);
await page.reload();
const card2 = page.getByTestId('your-round').first();
await card2.waitFor({ timeout: 15000 });
await page.waitForTimeout(800);
const t2 = await card2.innerText();
check(/Team 1/.test(t2) && /with Bo/.test(t2), `Ambrose: your team and teammate (${t2.replace(/\n/g, ' / ')})`);
check(/Up against\s+Team 2/.test(t2) && !/Team 3/.test(t2), 'Ambrose: up against the team in your group');
check(/You’re off 8:16, hole 1, with Bo, Cy and Di/.test(t2), 'Ambrose: tee time and playing group');
check(await page.getByTestId('cup-day').count() === 0, 'no Cup card for a group without the Cup');
await shot('3-ambrose');

// 6. Nothing set (no teams, no groups): no card at all.
db.teams = []; db.team_players = []; db.tee_groups = [];
db.rounds[0].format = 'stableford';
db.round_players.push({ round_id: R1, player_id: P.mike, playing_handicap: 12 });
await page.reload();
await page.getByTestId('trip-status').waitFor({ timeout: 15000 });
await page.waitForTimeout(1200);
check(await page.getByTestId('your-round').count() === 0, 'nothing assigned: no "Your round" card');

await t.done();
