// The group's cups (ov32, migration 101): in the run-up the organiser makes a weekend cup ("+ New cup", "Not yet" →
// the reminder and "Get one: coming soon" → I'm interested), ticks a library cup on, sets the specifics (cap tips:
// 3 each); a player sees the same list read-only with how to win; an award proposed "Counts towards" the cup; a cap
// tip from a Feed post ("3 left to give", undo); the standings with the breakdown (award, cap tip, vibe); the day
// screen's cups card; Organise step 6 shows the same list; once the trip's over the results page hands it over.
// Fake database only (organise-fixtures.mjs + 101's cap tip rules acted out below). Usage:
//   node tests/e2e/cups-test.mjs <base> <shotDir>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { makeDb, fakeSupabase, fakeContext, PC, K, AL, pid, plusDays, GROUP } from './organise-fixtures.mjs';
import { capTipState, sourceOn } from '../../src/lib/cups.js';

const BASE = process.argv[2] || 'http://localhost:4357/lgc-golf/';
const SHOTS = process.argv[3] || './shots-cups';
fs.mkdirSync(SHOTS, { recursive: true });
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const BO = pid(2);
const now = new Date().toISOString();
const T = 'aaaaaaaa-3200-4000-8000-000000000001';
const R1 = 'dddddddd-3200-4000-8000-000000000001';
const COURSE = 'cccccccc-3200-4000-8000-000000000001';
const LIB_PUTT = 'c0c0c0c0-3200-4000-8000-000000000001';
const at = (day, hh = '12') => new Date(`${day}T${hh}:00:00+11:00`).toISOString();

// ------------------------------------------------------------------ the database
const db = makeDb();
const plan = db.plans.find((p) => p.id === PC);
Object.assign(plan, { trip_id: T, start_date: plusDays(6), end_date: plusDays(7) });
db.trips = [{ id: T, group_id: GROUP, name: 'Autumn Trip', start_date: plusDays(6), end_date: plusDays(7), status: 'upcoming', created_at: now }];
db.courses = [{ id: COURSE, name: 'Cypress Lakes', holes: Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 })), created_at: now }];
db.rounds = [{ id: R1, trip_id: T, course_id: COURSE, name: 'Friday', play_date: plusDays(6), format: 'ambrose', status: 'setup', ld_holes: [], ctp_holes: [], comp_bonus: 0, created_at: now }];
db.group_features.push(...['dinner_awards', 'rule_voting', 'trophies', 'tribunal', 'rule_challenges'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })));
db.groups = [{ id: GROUP, cap_tip_name: 'cap' }];
db.cups = [{ id: LIB_PUTT, group_id: GROUP, name: 'Putt Buddies', purpose: 'golf', format: 'ambrose', counts: {}, has_trophy: true, held_by: BO, retired: false, created_at: '2026-01-01T00:00:00Z' }];
db.comps = []; db.cup_points = []; db.cap_tips = []; db.rules = db.rules || []; db.dinner_awards = []; db.dinner_award_nominations = [];
db.posts = [
  { id: crypto.randomUUID(), group_id: GROUP, kind: 'user', player_id: BO, trip_id: T, body: 'Ready for the weekend ⛳', created_at: now },
  { id: crypto.randomUUID(), group_id: GROUP, kind: 'user', player_id: BO, trip_id: T, body: 'First tee', photo_url: 'https://example.com/tee.jpg', created_at: at(plusDays(6)) },
];
db.comments = []; db.reactions = [];

const me = { id: K, admin: true };
const fake = fakeSupabase(db, () => me);
const feedback = [];
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(body) });

// 101's cap tip rules, acted out: the allowance, the most to one person, a cup_points row per tip; undo removes it.
async function handler(route) {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname;
  if (p.endsWith('/rpc/send_feedback')) { feedback.push(JSON.parse(req.postData() || '{}')); return json(route, null); }
  if (p.endsWith('/rpc/set_cap_tip_name')) { db.groups[0].cap_tip_name = JSON.parse(req.postData() || '{}').p_value; return json(route, null); }
  if (p.endsWith('/rest/v1/cap_tips') && req.method() === 'POST') {
    const b = JSON.parse(req.postData() || '{}');
    const comp = db.comps.find((c) => c.id === b.comp_id);
    const st = capTipState({ tips: db.cap_tips.filter((t) => t.comp_id === b.comp_id), me: b.giver_id, settings: sourceOn(comp, 'kudos') });
    const why = st.canGiveTo(b.receiver_id);
    if (why) return json(route, { message: why }, 400);
    const row = { id: crypto.randomUUID(), group_id: GROUP, created_at: new Date().toISOString(), ...b };
    db.cap_tips.push(row);
    const from = db.players.find((x) => x.id === b.giver_id)?.nickname;
    db.cup_points.push({ id: crypto.randomUUID(), group_id: GROUP, trip_id: T, comp_id: b.comp_id, player_id: b.receiver_id, points: st.per, source_type: 'kudos', source_id: row.id, label: `Cap tip from ${from}${b.reason ? `: ${b.reason}` : ''}`, confirmed_at: row.created_at, created_at: row.created_at });
    return json(route, [], 201);
  }
  if (p.endsWith('/rest/v1/cap_tips') && req.method() === 'DELETE') {
    const id = (url.searchParams.get('id') || '').replace(/^eq\./, '');
    db.cap_tips = db.cap_tips.filter((t) => t.id !== id);
    db.cup_points = db.cup_points.filter((c) => !(c.source_type === 'kudos' && c.source_id === id));
    return json(route, [], 200);
  }
  return fake.handler(route);
}

const browser = await chromium.launch();
const errors = [];
async function open() {
  const ctx = await fakeContext(browser, { handler });
  await ctx.route('https://example.com/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  return { ctx, page };
}
const as = (who) => Object.assign(me, who === K ? { id: K, admin: true } : { id: who, admin: false });
const shot = (page, n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true }).catch(() => {});
const noSideScroll = async (page, label) => {
  const w = await page.evaluate(() => document.scrollingElement.scrollWidth);
  check(w <= 375, `${label}: no sideways scroll (${w}px)`);
};
const weekend = () => db.comps.find((c) => c.name === 'Weekend Cup' && c.trip_id === T);

// ------------------------------------------------------------------ 1–2. The organiser: a new cup, and ticks one on
{
  as(K);
  const { ctx, page } = await open();
  await page.goto(`${BASE}#/plan/${PC}`);
  await page.getByTestId('runup').waitFor({ timeout: 20000 });
  const grabs = page.getByTestId('runup-grabs');
  await grabs.getByTestId('cups-grabs').waitFor({ timeout: 10000 });
  await page.waitForTimeout(600);
  check(!(await grabs.getByTestId('cups-tick').first().isChecked()), 'no cup is on by default (Putt Buddies unticked)');
  await grabs.getByTestId('cups-new').click();
  await page.getByTestId('cups-new-sheet').waitFor();
  await page.getByTestId('cups-new-name').fill('Weekend Cup');
  await page.getByTestId('cups-purpose-social').click();
  await page.getByTestId('cups-new-trophy-notyet').click();
  await shot(page, '1-new-cup');
  await page.getByTestId('cups-new-save').click();
  await page.waitForTimeout(1200);
  const lib = db.cups.find((c) => c.name === 'Weekend Cup');
  check(lib && lib.purpose === 'social' && lib.has_trophy === false && lib.counts?.vibe?.on === true && lib.counts?.kudos?.on === true, 'saved to the library: a weekend cup, vibe and cap tips on, "Not yet"');
  const wc = weekend();
  check(wc && wc.cup_id === lib?.id && wc.kind === 'manual' && wc.settings?.cup === 'social' && !wc.retired, 'and put up for grabs on this trip');
  check(wc && db.trophies.some((t) => t.id === wc.trophy_id && t.name === 'Weekend Cup'), 'with a trophy for the hand-over');
  const reminder = await grabs.getByTestId('cups-reminder').innerText().catch(() => '');
  check(/No cup for the Weekend Cup yet: sort one before the presentation/.test(reminder) && /Get one: coming soon/.test(reminder), `the run-up reminder (${reminder.replace(/\n/g, ' / ')})`);
  await grabs.getByTestId('coming-soon-interested').click();
  await page.waitForTimeout(600);
  check(feedback.some((f) => f.p_kind === 'idea' && f.p_message === 'Interested: trophy_shop (Weekend Cup)'), 'I\'m interested → one idea through the feedback path');
  check(await grabs.getByTestId('coming-soon-noted').isVisible(), '"✓ Noted, thanks"');
  // Tick a library cup on.
  const putt = grabs.getByTestId('cups-row').filter({ hasText: 'Putt Buddies' });
  await putt.getByTestId('cups-tick').click();
  await page.waitForTimeout(1000);
  const pc = db.comps.find((c) => c.cup_id === LIB_PUTT);
  check(pc && pc.kind === 'ambrose_teams' && !pc.retired, 'ticked on: Putt Buddies plays as Ambrose teams this trip');
  check(/Best net Ambrose score wins/.test(await putt.innerText()), 'how to win, in one line');
  // The specifics: 3 cap tips each.
  await grabs.getByTestId('cups-row').filter({ hasText: 'Weekend Cup' }).getByTestId('cups-specifics').click();
  await page.getByTestId('cups-specifics-sheet').waitFor();
  await page.getByTestId('cups-kudos-allowance').fill('3');
  await shot(page, '2-specifics');
  await page.getByTestId('cups-specifics-save').click();
  await page.waitForTimeout(800);
  check(weekend()?.settings?.counts?.kudos?.allowance === 3, 'specifics saved: 3 cap tips each');
  await shot(page, '2-runup-organiser');
  await noSideScroll(page, 'run-up (organiser)');

  // 3. An award counts towards it.
  await page.getByTestId('propose-award').first().click();
  await page.getByTestId('propose-sheet').waitFor();
  await page.getByTestId('award-title').fill('Latest out');
  await page.getByTestId('counts-towards').selectOption(weekend().id);
  await page.getByTestId('counts-towards-points').fill('2');
  await page.getByTestId('propose-save').click();
  await page.waitForTimeout(1000);
  const rule = db.rules.find((r) => r.title === 'Latest out');
  check(rule && rule.comp_id === weekend().id && rule.points?.points === 2, `the award counts towards the Weekend Cup (comp_id, 2 points) (${JSON.stringify(rule?.points)})`);
  // What 100's server does once it's won and confirmed: a confirmed cup_points row.
  db.cup_points.push({ id: crypto.randomUUID(), group_id: GROUP, trip_id: T, comp_id: weekend().id, player_id: BO, points: 2, source_type: 'award', label: 'Latest out', rule_id: rule?.id, confirmed_at: now, created_at: now });

  // Organise step 6 shows the same list.
  await page.goto(`${BASE}#/plan/${PC}?view=organise&step=day`);
  await page.getByTestId('comps-day').waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
  check(await page.getByTestId('comps-day').getByTestId('cups-row').count() === 2, 'Organise step 6: the same cups list');
  await ctx.close();
}

// ------------------------------------------------------------------ a player: read-only, then a cap tip from the Feed
{
  as(AL);
  const { ctx, page } = await open();
  await page.goto(`${BASE}#/plan/${PC}`);
  await page.getByTestId('runup').waitFor({ timeout: 20000 });
  const grabs = page.getByTestId('runup-grabs');
  await grabs.getByTestId('cups-row').first().waitFor({ timeout: 10000 });
  check(await grabs.getByTestId('cups-tick').count() === 0 && await grabs.getByTestId('cups-new').count() === 0, 'player: read-only (no ticks, no + New cup)');
  const how = await grabs.getByTestId('cups-how').allInnerTexts();
  check(how.some((h) => /^Most points wins: /.test(h)), `player: one plain line on how to win (${how.join(' | ')})`);
  await shot(page, '3-runup-player');

  // 4. A cap tip from a Feed post.
  await page.goto(`${BASE}#/feed`);
  const chip = page.getByTestId('captip-post').first();
  await chip.waitFor({ timeout: 15000 });
  await chip.click();
  await page.getByTestId('captip-sheet').waitFor();
  check(/^3 left to give/.test(await page.getByTestId('captip-left').innerText()), '"3 left to give"');
  await page.getByTestId('captip-reason').fill('Carried the esky');
  await page.getByTestId('captip-give').click();
  await page.waitForTimeout(900);
  check(db.cap_tips.length === 1 && db.cap_tips[0].receiver_id === BO && db.cap_tips[0].giver_id === AL && db.cap_tips[0].post_id, 'a cap tip given to Bo, from the post');
  check(db.cup_points.some((c) => c.source_type === 'kudos' && c.player_id === BO), '… as a cup_points row (kudos)');
  check(/^2 left to give/.test(await page.getByTestId('captip-left').innerText()), 'then "2 left to give"');
  await shot(page, '4-captip');
  await page.getByTestId('captip-undo').first().click();
  await page.waitForTimeout(800);
  check(db.cap_tips.length === 0 && !db.cup_points.some((c) => c.source_type === 'kudos'), 'undo within 10 minutes takes it back');
  await page.getByTestId('captip-give').click();
  await page.waitForTimeout(800);
  check(db.cap_tips.length === 1, 'given again');
  await ctx.close();
}

// ------------------------------------------------------------------ 5. The standings, the day screen
{
  as(AL);
  const { ctx, page } = await open();
  await page.goto(`${BASE}#/comps-board?trip=${T}&c=${weekend().id}`);
  await page.getByTestId('cup-standings').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
  const rows = await page.getByTestId('cup-row').allInnerTexts();
  const bo = rows.find((r) => /Bo/.test(r)) || '';
  check(/Latest out \+2/.test(bo) && /🧢 Cap tips ×1 \+1/.test(bo) && /Vibe \+2 \(1 photo\)/.test(bo) && /5 pts/.test(bo), `Bo's breakdown: award, cap tip, vibe (${bo.replace(/\n/g, ' ')})`);
  await shot(page, '5-standings');
  await noSideScroll(page, 'standings');
  // The day screen (the trip's round): the cups card.
  db.rounds[0].status = 'live';
  await page.goto(`${BASE}#/?r=${R1}`);
  await page.getByTestId('cups-today').waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  const today = await page.getByTestId('cups-today').innerText();
  check(/Weekend Cup/.test(today) && /Bo leads · 5 pts/.test(today) && /2 left to give/.test(today), `day screen: the cups card (${today.replace(/\n/g, ' / ')})`);
  await shot(page, '5-day-screen');
  await ctx.close();
}

// ------------------------------------------------------------------ 6. The results page hands it over
{
  const past = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }); };
  Object.assign(db.trips[0], { start_date: past(3), end_date: past(2), status: 'active' });
  Object.assign(plan, { start_date: past(3), end_date: past(2) });
  Object.assign(db.rounds[0], { play_date: past(2), status: 'locked' });
  db.posts[1].created_at = at(past(2));
  as(K);
  const { ctx, page } = await open();
  await page.goto(`${BASE}#/trip-now/${T}`);
  await page.getByTestId('trip-results').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  const trophies = await page.getByTestId('results-trophy').allInnerTexts();
  check(trophies.some((t) => /Bo wins the Weekend Cup/.test(t)), `results: "Bo wins the Weekend Cup" (${trophies.join(' | ')})`);
  check(/Latest out \+2/.test(await page.getByTestId('results-cup-standings').first().innerText()), 'results: the cup standings with the breakdown');
  await page.getByTestId('hand-over').click();
  await page.waitForTimeout(1000);
  check(db.honour_board.some((h) => h.trophy_name === 'Weekend Cup' && h.trip_id === T && h.winner_names === 'Bo'), 'hand over: the Weekend Cup is engraved for Bo');
  await shot(page, '6-results');
  await noSideScroll(page, 'results');
  await ctx.close();
}

check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
