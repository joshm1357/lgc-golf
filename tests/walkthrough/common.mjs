// Shared steps for the walkthrough scenarios: open the app as a person, go to a screen, and the planning moves the
// organiser makes in the trip builder (the same clicks as tests/e2e/weekends-comps-test.mjs and trip-builder-test.mjs).
import crypto from 'node:crypto';
import { personBrowser, GROUP } from './fake.mjs';
import { BASE, wait, plusDays } from './shoot.mjs';
import { pid, holes, groupCourse, scoresFor } from './fixtures.mjs';

export const DESK = 1440;
export const PHONE = 375;
const nowIso = () => new Date().toISOString();

/** A person's browser at a width; R watches it for errors. Returns { ctx, page, close }. */
export async function person(browser, S, R, acct, label, { width = PHONE, fresh = false } = {}) {
  const { ctx, page } = await personBrowser(browser, S, acct, { width, fresh });
  R.watch(page, label);
  return { ctx, page, close: () => ctx.close() };
}

/** Go to a screen (#hash) and wait for a test id (or just settle). */
export async function go(page, hash, testId = null, ms = 900) {
  await page.goto(`${BASE}#${hash}`);
  await page.reload(); // a hash change alone keeps the old screen's data; a reload is what opening the app does
  if (testId) await page.getByTestId(testId).first().waitFor({ timeout: 20000 });
  else await page.locator('.page, .app, main').first().waitFor({ timeout: 20000 }).catch(() => {});
  await wait(page, ms);
}

/** Wait for any toasts to fade so they're not across the picture. */
export async function settle(page, ms = 600) {
  await page.waitForTimeout(400);
  await page.locator('.toast').first().waitFor({ state: 'hidden', timeout: 9000 }).catch(() => {});
  await wait(page, ms);
}

// ------------------------------------------------------------------------------------------- the trip builder
export const step = (page, k) => page.locator(`[data-testid="tb-step-${k}"]`);
export const state = (db, planId) => db.trip_builds.find((b) => b.plan_id === planId)?.state || {};

export async function openBuilder(page, planId) {
  await go(page, `/plan/${planId}/build`, 'tb-step-area', 1200);
}

/** Add an area by searching for it (first area) or "+ Add another area". */
export async function addArea(page, query, label, first) {
  if (!first) { await page.getByTestId('add-area').click(); await wait(page, 300); }
  await page.getByLabel('Area').fill(query);
  await page.locator('[data-testid="tb-region-hits"]').getByRole('button', { name: `+ ${label}` }).click();
  await wait(page, 700);
}
export async function openArea(page, label) {
  await page.locator(`[data-testid="area-chip"][data-area="${label}"]`).getByRole('button').first().click();
  await wait(page, 700);
}
export async function tickCourses(page, names) {
  for (const n of names) { await page.locator('[data-testid="area-courses"]').getByLabel(n).check().catch(() => {}); await wait(page, 300); }
}
export async function tickStays(page, names) {
  for (const n of names) { await page.locator('[data-testid="area-stays"]').getByLabel(n).check().catch(() => {}); await wait(page, 300); }
}
/** Tick weekend chips by index (0 = the first weekend in the window). */
export async function pickWeekends(page, idxs) {
  for (const i of idxs) { await page.getByTestId('weekend-chip').nth(i).click(); await wait(page, 300); }
}

// ------------------------------------------------------------------------------------------- votes from others
/** The vote card's polls (main questions first). */
export function votePolls(db, planId) {
  const batch = [...db.vote_batches].reverse().find((b) => b.plan_id === planId);
  return { batch, polls: db.plan_polls.filter((p) => p.vote_batch === batch?.id) };
}
export const optionOf = (db, poll, label) => db.plan_options.find((o) => o.poll_id === poll.id && (o.label === label || o.label.startsWith(label)));
/** Someone else's answer to one option (yes = ⭐ Prefer / ✓ Can, maybe = 👍 / ?, no = 👎 / ✗). */
export function castVote(db, playerIdx, poll, option, response = 'yes') {
  if (!option) return;
  db.plan_votes = db.plan_votes.filter((v) => !(v.option_id === option.id && v.player_id === pid(playerIdx)));
  db.plan_votes.push({ id: crypto.randomUUID(), group_id: GROUP, poll_id: poll.id, option_id: option.id, player_id: pid(playerIdx), response, created_at: nowIso(), updated_at: nowIso() });
}
export function rsvp(db, planId, playerIdx, status = 'in') {
  db.plan_rsvps = db.plan_rsvps.filter((r) => !(r.plan_id === planId && r.player_id === pid(playerIdx)));
  db.plan_rsvps.push({ plan_id: planId, player_id: pid(playerIdx), status, updated_at: nowIso() });
}

// ------------------------------------------------------------------------------------------- moving the calendar
/**
 * Move a locked-in trip so it starts `startIn` days from today (the run-up, the day, just after). Keeps its length;
 * moves its rounds, tee options and the build's weekends with it.
 */
export function moveTrip(db, planId, startIn) {
  const plan = db.plans.find((p) => p.id === planId);
  const trip = db.trips.find((t) => t.id === plan.trip_id);
  const len = plan.start_date && plan.end_date ? Math.round((Date.parse(plan.end_date) - Date.parse(plan.start_date)) / 864e5) : 2;
  const start = plusDays(startIn);
  const shift = plan.start_date ? Math.round((Date.parse(start) - Date.parse(plan.start_date)) / 864e5) : 0;
  const mv = (d) => (d ? plusDays(shift, d) : d);
  Object.assign(plan, { start_date: start, end_date: plusDays(len, start) });
  if (trip) Object.assign(trip, { start_date: plan.start_date, end_date: plan.end_date });
  for (const r of db.rounds.filter((x) => x.trip_id === plan.trip_id)) r.play_date = mv(r.play_date);
  for (const t of db.trip_tee_options.filter((x) => x.plan_id === planId)) t.play_date = mv(t.play_date);
  const b = db.trip_builds.find((x) => x.plan_id === planId);
  if (b?.state?.weekends) b.state.weekends = b.state.weekends.map((w) => ({ ...w, start: mv(w.start), end: mv(w.end) }));
  return { start: plan.start_date, end: plan.end_date };
}

/** Make sure a locked trip has a trip row and rounds (if "Set it up in the app" couldn't be reached). */
export function ensureTripAndRounds(db, planId, { name, courses, formats = ['stableford', 'stableford', 'ambrose'] }) {
  const plan = db.plans.find((p) => p.id === planId);
  if (!plan.trip_id) {
    const T = crypto.randomUUID();
    db.trips.push({ id: T, group_id: GROUP, name: name || plan.name, start_date: plan.start_date, end_date: plan.end_date, status: 'locked', created_at: nowIso() });
    plan.trip_id = T;
  }
  if (!db.rounds.some((r) => r.trip_id === plan.trip_id)) {
    courses.forEach((libId, i) => {
      const c = groupCourse(db, libId);
      db.rounds.push({ id: crypto.randomUUID(), group_id: GROUP, trip_id: plan.trip_id, course_id: c.id, name: ['Friday', 'Saturday', 'Sunday'][i] || `Round ${i + 1}`, play_date: plusDays(i, plan.start_date), format: formats[i] || 'stableford', status: 'setup', ld_holes: [], ctp_holes: [], comp_bonus: 0, created_at: nowIso() });
    });
  }
  return plan.trip_id;
}

/** Day one under way: round 1 live, everyone in it, scores through `thru` holes (some players further than others). */
export function roundUnderWay(db, tripId, playerIdxs, thru = 9) {
  const rounds = db.rounds.filter((r) => r.trip_id === tripId).sort((a, b) => String(a.play_date).localeCompare(String(b.play_date)));
  const r1 = rounds[0];
  r1.status = 'live';
  r1.ctp_holes = [3, 6]; r1.ld_holes = [2];
  db.round_players = db.round_players.filter((x) => x.round_id !== r1.id);
  db.scores = db.scores.filter((x) => x.round_id !== r1.id);
  playerIdxs.forEach((i, k) => {
    const p = db.players.find((x) => x.id === pid(i));
    db.round_players.push({ round_id: r1.id, player_id: p.id, playing_handicap: Math.round(p.handicap), group_id: GROUP });
    db.scores.push(...scoresFor(r1.id, p.id, Math.max(0, thru - (k % 4) * 2), k % 3 === 0));
  });
  return r1;
}

export { holes, plusDays };
