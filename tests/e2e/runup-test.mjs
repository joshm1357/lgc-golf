// The run-up (ov25, 23 Oct 2026): the Trips list's stage looks, and an Upcoming trip's page — to-dos, cars (need a
// lift / offer seats / hop in), side activity → I'm in → kitty, what to bring → Ask the group → I'll bring it from the
// Feed, tipping and its lock, and the day-before reminder line. No real database: organise-fixtures' fake Supabase,
// plus the run-up's database functions acted out here.
// Usage: node runup-test.mjs <baseUrl> <shotDir>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { makeDb, fakeSupabase, fakeContext, PA, PB, PC, K, AL, pid, GROUP, plusDays } from './organise-fixtures.mjs';

const BASE = process.argv[2] || 'http://localhost:4173/lgc-golf/';
const SHOTS = process.argv[3] || './shots';
fs.mkdirSync(SHOTS, { recursive: true });
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const BO = pid(2);
const now = new Date().toISOString();

// ---------------------------------------------------------------- the database
const db = makeDb();
const TRIP = 'aaaaaaaa-2500-4000-8000-000000000001';
const ROUND = 'dddddddd-2500-4000-8000-000000000001';
const COURSE = 'cccccccc-2500-4000-8000-000000000001';
const pc = db.plans.find((p) => p.id === PC);
pc.trip_id = TRIP;
pc.location_name = 'Hunter Valley';
db.trips = [{ id: TRIP, name: 'Autumn Trip', start_date: pc.start_date, end_date: pc.end_date, status: 'upcoming', created_at: now }];
db.courses = [{ id: COURSE, name: 'Cypress Lakes', holes: Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 })), created_at: now }];
db.rounds = [{ id: ROUND, trip_id: TRIP, course_id: COURSE, name: 'Friday', play_date: pc.start_date, format: 'stableford', status: 'setup', ld_holes: [], ctp_holes: [], comp_bonus: 0, created_at: now }];
db.tee_groups = [{ id: crypto.randomUUID(), round_id: ROUND, group_no: 1, tee_time: '09:12', start_hole: null, player_ids: [AL, BO] }];
const ROOM = 'ffffffff-2500-4000-8000-000000000001';
db.plan_groups.push({ id: ROOM, plan_id: PC, group_id: GROUP, kind: 'room', name: 'Room 3', capacity: 2, sort: 0, created_at: now });
db.plan_group_members.push({ group_id: ROOM, player_id: AL }, { group_id: ROOM, player_id: BO });
db.group_features.push({ group_id: GROUP, feature_key: 'stats', enabled: true });
// More stages for the Trips list: an idea, a previous trip with a winner, one called off.
const IDEA = 'eeeeeeee-2500-4000-8000-0000000000d1';
const OLD = 'eeeeeeee-2500-4000-8000-0000000000d2';
const OFF = 'eeeeeeee-2500-4000-8000-0000000000d3';
const OLD_TRIP = 'aaaaaaaa-2500-4000-8000-000000000002';
db.plans.push(
  { id: IDEA, kind: 'trip', name: 'Mudgee in spring', status: 'planning', proposed: true, created_by: AL, organiser_id: AL, group_id: GROUP, rsvp_locked: false, created_at: now },
  { id: OLD, kind: 'trip', name: 'South Coast', status: 'done', start_date: '2025-10-16', end_date: '2025-10-18', location_name: 'Mollymook', trip_id: OLD_TRIP, group_id: GROUP, created_at: now },
  { id: OFF, kind: 'trip', name: 'Xmas Ambrose', status: 'cancelled', cancelled_by: K, group_id: GROUP, created_at: now },
);
db.trips.push({ id: OLD_TRIP, name: 'South Coast', start_date: '2025-10-16', end_date: '2025-10-18', status: 'done', created_at: now });
db.honour_board.push({ id: crypto.randomUUID(), trip_id: OLD_TRIP, trophy_name: 'BD Trophy', winner_names: 'Bo', player_ids: [BO], group_id: GROUP, created_at: now });
db.plan_rsvps.push({ plan_id: IDEA, player_id: AL, status: 'in', updated_at: now }, { plan_id: IDEA, player_id: BO, status: 'in', updated_at: now }, { plan_id: IDEA, player_id: K, status: 'in', updated_at: now });

const me = { id: AL, admin: false };
const fake = fakeSupabase(db, () => me);
const nick = (id) => db.players.find((p) => p.id === id)?.nickname;

// The run-up's database functions (094), acted out on the fake rows.
function rpc094(name, b) {
  if (name === 'runup_offer_car') {
    let car = db.plan_groups.find((g) => g.plan_id === b.p_plan && g.kind === 'car' && g.driver_id === me.id);
    if (!car) {
      car = { id: crypto.randomUUID(), plan_id: b.p_plan, group_id: GROUP, kind: 'car', name: `${nick(me.id)}’s car`, sort: 100, driver_id: me.id, created_at: now };
      db.plan_groups.push(car);
      db.plan_group_members.push({ group_id: car.id, player_id: me.id });
    }
    Object.assign(car, { capacity: Number(b.p_seats) + 1, pickup_place: b.p_place, pickup_time: b.p_time });
    return car.id;
  }
  if (name === 'runup_join_car') {
    const who = b.p_player || me.id;
    db.plan_group_members = db.plan_group_members.filter((m) => !(m.player_id === who && db.plan_groups.some((g) => g.id === m.group_id && g.kind === 'car')));
    db.plan_group_members.push({ group_id: b.p_car, player_id: who });
    const row = (db.trip_runup_people || []).find((r) => r.player_id === who);
    if (row) row.needs_lift = false;
    return null;
  }
  if (name === 'runup_leave_car') { db.plan_group_members = db.plan_group_members.filter((m) => !(m.group_id === b.p_car && m.player_id === (b.p_player || me.id))); return null; }
  if (name === 'runup_claim_bring') { const it = db.plan_items.find((i) => i.id === b.p_item); if (it) it.owner_id = b.p_on ? me.id : null; return null; }
  return undefined;
}
// 094's trigger: an activity's cost each into the kitty, split between those in.
function syncActivityCosts() {
  db.plan_costs = db.plan_costs.filter((c) => !c.activity_id);
  for (const a of db.trip_activities || []) {
    const ids = (db.trip_activity_people || []).filter((x) => x.activity_id === a.id).map((x) => x.player_id);
    if (Number(a.cost_pp) > 0 && ids.length) db.plan_costs.push({ id: crypto.randomUUID(), plan_id: a.plan_id, group_id: GROUP, title: `🎯 ${a.title}`, amount: Number(a.cost_pp), per_head: true, split_between: ids, paid_by: a.created_by, created_by: a.created_by, note: 'Side activity', activity_id: a.id, created_at: now });
  }
}
const rpcLog = [];
async function handler(route) {
  const url = new URL(route.request().url());
  const name = url.pathname.startsWith('/rest/v1/rpc/') ? url.pathname.split('/').pop() : null;
  if (name && name.startsWith('runup_')) {
    const body = JSON.parse(route.request().postData() || '{}');
    rpcLog.push({ name, body });
    const out = rpc094(name, body);
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(out ?? null) });
  }
  await fake.handler(route);
  if (/trip_activit/.test(url.pathname) && route.request().method() !== 'GET') syncActivityCosts();
}

const browser = await chromium.launch();
const errors = [];
async function open(width = 375) {
  const ctx = await fakeContext(browser, { handler }, width > 500 ? { width, height: 900, mobile: false } : {});
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  return { ctx, page };
}
const as = (who) => Object.assign(me, who === K ? { id: K, admin: true } : { id: who, admin: false });
// ov27 (R1): everything after Your weekend and Your to-dos is folded under "More about this trip".
const openMore = async (page) => {
  const more = page.getByTestId('runup-more');
  if (!(await more.evaluate((d) => d.open))) await more.locator('summary').click();
  await page.waitForTimeout(400);
};
const noSideScroll = async (page, label) => {
  const w = await page.evaluate(() => document.scrollingElement.scrollWidth);
  check(w <= 375, `${label}: no sideways scroll (${w}px)`);
};

// ---------------------------------------------------------------- 1. The Trips list: each stage looks different
{
  as(K);
  const { ctx, page } = await open(375);
  await page.goto(`${BASE}#/plan`);
  await page.getByTestId('trips-next').waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
  const looks = await page.locator('.trip-card').evaluateAll((els) => els.map((e) => ({ stage: e.dataset.stage, pill: e.querySelector('[data-testid="stage-pill"]')?.textContent, tag: e.querySelector('[data-testid="stage-tag"]')?.textContent, bg: getComputedStyle(e.querySelector('.trip-card-top')).backgroundColor, border: getComputedStyle(e).borderTopStyle })));
  const of = (st) => looks.find((l) => l.stage === st) || {};
  // "Navy" is the group's main colour (--navy; a group's own colours replace it).
  const navy = await page.evaluate(() => { const d = document.createElement('div'); d.style.background = 'var(--navy)'; document.body.append(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; });
  check(/🔒 Upcoming/.test(of('locked').pill) && /^\d+ (days|weeks)$/.test(of('locked').tag) && of('locked').bg === navy, `Upcoming: navy with a countdown (${of('locked').tag}, ${of('locked').bg})`);
  check(/🧭 Being organised/.test(of('deciding').pill) && of('deciding').border === 'solid', `Being organised: outline (${of('deciding').tag})`);
  check(/💡 Proposed/.test(of('idea').pill) && of('idea').tag === '3 keen' && of('idea').border === 'dashed', `Proposed: dashed, "3 keen" (${of('idea').tag})`);
  check(/🏁 Previous/.test(of('done').pill) && of('done').tag === 'Oct 2025', `Previous: muted, "Oct 2025" (${of('done').tag})`);
  check(/🏆 BD Trophy: Bo/.test(await page.getByTestId('trips-last').innerText()), 'Previous: the winner line');
  check(await page.getByTestId('called-off').isVisible() && !(await page.locator('[data-stage="cancelled"]').first().isVisible()), 'Called off: folded away');
  await page.screenshot({ path: `${SHOTS}/trips-stages-375.png`, fullPage: true });
  await noSideScroll(page, 'Trips list');
  await ctx.close();
  const wide = await open(1440);
  await wide.page.goto(`${BASE}#/plan`);
  await wide.page.getByTestId('trips-next').waitFor({ timeout: 20000 });
  await wide.page.getByTestId('side-upcoming').waitFor({ timeout: 10000 });
  const side = await wide.page.locator('nav.side .side-group .side-link').allInnerTexts();
  check(/^🔒 Upcoming: Autumn Trip · \d+ (days|weeks)$/.test(side[1]) && /^🧭 Being organised: /.test(side[2]) && side[3] === '🏁 Previous: South Coast' && side[4] === 'All trips →',
    `sidebar: Upcoming, Being organised, Previous, All trips (${side.join(' | ')})`);
  await wide.page.screenshot({ path: `${SHOTS}/trips-stages-1440.png`, fullPage: true });
  await wide.ctx.close();
}

// ---------------------------------------------------------------- 2. The run-up, as Al (a player)
{
  as(AL);
  const { ctx, page } = await open(375);
  await page.goto(`${BASE}#/plan/${PC}`);
  await page.getByTestId('runup').waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  // ov27 (R1): Your weekend first — dates + countdown, where we're staying, each day's course with my tee time and group.
  const head = await page.getByTestId('runup-countdown').innerText();
  check(/\d+ days to go/.test(head) && /📅/.test(head), `Your weekend: dates and countdown (${head.replace(/\n/g, ' ')})`);
  check(/Hunter Valley/.test(await page.getByTestId('yw-address').innerText()), 'Your weekend: where we’re staying (tap for maps)');
  check(/Cypress Lakes/.test(await page.getByTestId('yw-day').first().innerText()) && /9:12am with Bo/.test(await page.getByTestId('yw-tee').first().innerText()), 'Your weekend: the course, my tee time and my group');
  const todos = await page.getByTestId('runup-todos').innerText();
  check(/Pay Josh your \$300 deposit/.test(todos) && /Check your handicap \(11\)/.test(todos) && /Pick your winner/.test(todos), `your to-dos: deposit (pay Josh), handicap, tip (${todos.replace(/\n/g, ' / ')})`);
  check(/Call Nowra Golf Club/.test(todos), 'your to-dos: your job');
  check(!(await page.getByTestId('runup-cars').isVisible().catch(() => false)), 'the rest is folded under More about this trip');
  await openMore(page);
  for (const id of ['runup-cars', 'runup-votes', 'runup-grabs', 'runup-rules', 'runup-activities', 'runup-bring', 'runup-form', 'runup-tipping', 'runup-chat']) {
    check(await page.getByTestId(id).count() === 1 && await page.getByTestId(id).isVisible(), `More about this trip: ${id.replace('runup-', '')} (once)`);
  }
  // Handicap: looks right.
  await page.getByTestId('handicap-ok').click();
  await page.waitForTimeout(600);
  check((db.trip_runup_people || []).some((r) => r.player_id === AL && r.handicap_checked_at), 'Looks right saves the handicap check');
  // I need a lift.
  await page.getByTestId('need-lift').click();
  await page.waitForTimeout(800);
  check((db.trip_runup_people || []).some((r) => r.player_id === AL && r.needs_lift), 'I need a lift is saved');
  check(/Need a lift: Al/.test(await page.getByTestId('need-lift-list').innerText()), 'Al shows under Need a lift');
  // A side activity: Al puts up go-karts at $40 each.
  await page.getByTestId('add-activity').click();
  await page.getByTestId('activity-title').fill('Go-karts');
  await page.getByTestId('activity-cost').fill('40');
  await page.getByTestId('activity-save').click();
  await page.getByTestId('runup-activity').waitFor({ timeout: 5000 });
  await page.waitForTimeout(600);
  check(/\$40 each · 1 in · \$40 into the kitty/.test(await page.getByTestId('activity-money').innerText()), 'activity: $40 each, Al in');
  // What to bring: an idea, nobody yet.
  await page.getByTestId('bring-new').fill('Speaker');
  await page.getByTestId('bring-add').click();
  await page.waitForTimeout(800);
  const sp = page.getByTestId('bring-item').filter({ hasText: 'Speaker' });
  check(!/Nobody yet/.test(await sp.innerText()) && await sp.getByTestId('bring-claim').isVisible(), 'what to bring: Speaker — just "I’ll bring it" (no "Nobody yet" beside it)');
  check(db.plan_items.some((i) => i.title === 'Speaker' && i.bring_shared) && !db.posts.some((p) => /Speaker/.test(p.body || '')), 'adding an idea posts nothing by itself');
  // Tipping: Al tips Josh.
  await page.getByTestId('tip-grid').getByRole('button', { name: /Josh/ }).click();
  await page.waitForTimeout(600);
  check((db.trip_tips || []).some((t) => t.player_id === AL && t.pick_id === K), 'tipping: Al’s pick saved');
  await page.screenshot({ path: `${SHOTS}/runup-375-al.png`, fullPage: true });
  await noSideScroll(page, 'the run-up');
  await ctx.close();
}

// ---------------------------------------------------------------- 3. Josh offers seats, puts Al in, joins go-karts, asks the group
{
  as(K);
  const { ctx, page } = await open(375);
  await page.goto(`${BASE}#/plan/${PC}?view=overview`);
  await page.getByTestId('runup').waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  await openMore(page);
  await page.getByTestId('offer-seats').click();
  await page.getByTestId('offer-seat-count').fill('2');
  await page.getByLabel('Pick-up point').fill('Leichhardt');
  await page.getByLabel('Pick-up time').fill('6:30am Fri');
  await page.getByTestId('offer-save').click();
  await page.getByTestId('runup-car').waitFor({ timeout: 5000 });
  await page.waitForTimeout(800);
  check(rpcLog.some((r) => r.name === 'runup_offer_car' && r.body.p_seats === 2 && r.body.p_place === 'Leichhardt'), 'I’ve got seats: offers 2 seats from Leichhardt');
  check(/2 seats free/.test(await page.getByTestId('car-seats').innerText()), 'the car shows 2 seats free');
  await page.getByTestId('runup-car').getByRole('button', { name: '+ Al' }).click();
  await page.waitForTimeout(800);
  check(/1 seat free/.test(await page.getByTestId('car-seats').innerText()) && /Al/.test(await page.getByTestId('runup-car').innerText()), 'the driver puts Al in: 1 seat free');
  check(await page.getByTestId('activity-in').getAttribute('aria-pressed') === 'false', 'not in yet: "I’m in"');
  await page.getByTestId('activity-in').click();
  await page.waitForTimeout(900);
  check(/\$40 each · 2 in · \$80 into the kitty/.test(await page.getByTestId('activity-money').innerText()), 'I’m in: $40 each · 2 in · $80 into the kitty');
  check(await page.getByTestId('activity-in').getAttribute('aria-pressed') === 'true' && /You’re in/.test(await page.getByTestId('activity-in').innerText()), 'in: the button looks different ("✓ You’re in")');
  const line = db.plan_costs.find((c) => c.title === '🎯 Go-karts');
  check(!!line && line.per_head && line.amount === 40 && line.split_between.length === 2 && line.paid_by === AL, 'the kitty has a Go-karts line, $40 each between the two, fronted by Al');
  await page.getByTestId('bring-ask').click();
  await page.waitForTimeout(800);
  const ask = db.posts.find((p) => /Can anyone help with these\?/.test(p.body || ''));
  check(!!ask && /🔊 Speaker/.test(ask.body) && /bring=ask/.test(ask.link), `📣 Ask the group posts ONE line listing what's unclaimed (${ask?.body})`);
  await page.screenshot({ path: `${SHOTS}/runup-375-josh.png`, fullPage: true });
  await ctx.close();
}

// ---------------------------------------------------------------- 4. Al claims the speaker from the Feed; the day-before line
{
  as(AL);
  const { ctx, page } = await open(375);
  await page.goto(`${BASE}#/feed`);
  await page.getByTestId('bring-ask-claim').waitFor({ timeout: 20000 });
  await page.getByTestId('bring-ask-claim').click();
  await page.waitForTimeout(800);
  check(db.plan_items.find((i) => i.title === 'Speaker')?.owner_id === AL, 'I’ll bring it — right on the Feed post');
  check(/You’re bringing it/.test(await page.getByTestId('bring-ask').innerText()), 'the post now says who’s bringing it');
  await page.screenshot({ path: `${SHOTS}/feed-bring-ask-375.png`, fullPage: true });
  await page.goto(`${BASE}#/plan/${PC}?view=overview`);
  await page.getByTestId('runup').waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  const car = await page.getByTestId('yw-car').innerText();
  check(/Josh’s car · pick-up Leichhardt 6:30am Fri/.test(car), `Your weekend: your car (${car})`);
  check(/You’re bringing: Speaker/.test(await page.getByTestId('runup-todos').innerText()), 'your to-dos: what you’re bringing');
  await openMore(page);
  check(/Your tip: Josh/.test(await page.getByTestId('runup-tipping').innerText()), 'tipping: your tip shows, changeable until the first tee');
  // The first round gets under way → tipping locks.
  db.rounds[0].status = 'live';
  await page.reload();
  await page.getByTestId('runup-more').waitFor({ timeout: 20000 }).then(() => openMore(page)).catch(() => {});
  await page.getByTestId('runup-tipping').waitFor({ timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
  const stillRunUp = await page.getByTestId('runup-tipping').isVisible().catch(() => false);
  if (stillRunUp) {
    check(await page.getByTestId('tip-locked').isVisible() && !(await page.getByTestId('tip-grid').isVisible().catch(() => false)), 'tipping locks at the first tee: no more picking');
    check(/Josh 🔒/.test(await page.getByTestId('tip-locked').innerText()), 'locked: your tip shows with a lock');
  } else {
    // Once a round is live the trip is On now and the run-up gives way to the trip's status.
    check(!(await page.getByTestId('runup').isVisible().catch(() => false)), 'a round under way: the run-up is over (On now)');
  }
  db.rounds[0].status = 'setup';
  await ctx.close();
}

// ---------------------------------------------------------------- 5. Desktop
{
  as(K);
  const { ctx, page } = await open(1440);
  await page.goto(`${BASE}#/plan/${PC}?view=overview`);
  await page.getByTestId('runup').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SHOTS}/runup-1440.png`, fullPage: true });
  check(true, 'desktop screenshot');
  await ctx.close();
}

check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n${fails.join('\n')}` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
