// Automatic awards (ov31, migration 100): photos posted last night → "Claim Latest out?" in one tap (for the poster,
// or for someone else) → the morning proposal (the 5-minute job, done here by the test) → the proposal card in the
// Feed (ranked claims, points per hour after midnight) → a dispute on one person's points line → the organiser
// confirms → −1 on the winner's next round on the leaderboard → a second award ("Earliest up") is disputed and waits
// for the Tribunal → the awards screen shows the nights and the results lines. Also the propose sheet's "Each night"
// and "1 pt an hour after 12am, to 5am" settings.
// Fake database only (organise-fixtures.mjs + the 100 server bits below, using the same sums as lib/autoawards.js).
// Usage: node tests/e2e/auto-awards-test.mjs <base> <shotDir>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { makeDb, fakeSupabase, fakeContext, K, AL, pid, GROUP } from './organise-fixtures.mjs';
import { rewardWords } from '../../src/lib/awardsfines.js';
import { atSydney, sydneyDate, addDays, autoTerms, windowDateFor, claimWindow, proposeTimes, rankRun, proposalText, pointsWords, clockAt } from '../../src/lib/autoawards.js';

const BASE = process.argv[2] || 'http://localhost:4356/lgc-golf/';
const SHOTS = process.argv[3] || './shots-auto-awards';
fs.mkdirSync(SHOTS, { recursive: true });
const BO = pid(2);
const T = 'aaaaaaaa-0000-4000-8000-0000000003f1';
const COURSE = 'cccccccc-0000-4000-8000-0000000003f1';
const R = 'dddddddd-0000-4000-8000-0000000003f1';
const LATE = 'bbbbbbbb-0000-4000-8000-0000000003f1';
const EARLY = 'bbbbbbbb-0000-4000-8000-0000000003f2';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const PHOTO = 'https://example.supabase.co/storage/v1/object/public/photos/feed/x.png';
const today = sydneyDate(new Date());
const last = addDays(today, -1); // last night's date
const now = () => new Date().toISOString();

// ------------------------------------------------------------------ the database
const db = makeDb();
db.trips = [{ id: T, group_id: GROUP, name: 'Hunter Trip', start_date: addDays(today, -1), end_date: addDays(today, 1), status: 'active', created_at: now() }];
db.group_features.push(...['dinner_awards', 'rule_voting', 'tribunal', 'rule_challenges', 'feed'].map((k) => ({ group_id: GROUP, feature_key: k, enabled: true })));
const latePoints = { mode: 'per_unit', per: 1, size: 1, from: '00:00', to: '05:00', round: 'whole' };
db.rules = [{ id: LATE, group_id: GROUP, title: 'Latest out', category: 'fines', applies_to: ['trip'], status: 'active', award_kind: 'award', reward_type: 'strokes', reward_amount: -1,
  proof: 'photo_time', best: 'latest', points: latePoints, value: `−1 stroke · ${pointsWords(latePoints, 'award', 'latest')}`, sort: 10, created_at: now() }];
db.dinner_awards = [{ id: EARLY, group_id: GROUP, trip_id: T, title: 'Earliest up', kind: 'award', reward_type: 'title', reward_note: 'Wears the hat', proof: 'time', best: 'earliest', status: 'nominating', sort: 0, created_by: K, created_at: now() }];
const post = (who, body, hhmm, day = addDays(last, 1)) => ({ id: crypto.randomUUID(), group_id: GROUP, kind: 'user', player_id: who, trip_id: T, body, photo_url: PHOTO, server_at: atSydney(day, hhmm).toISOString(), created_at: atSydney(day, hhmm).toISOString() });
const boPost = post(BO, 'Still out 🍺', '02:47');
const alPost = post(AL, 'Last bus home', '01:15');
const alEarly = { ...post(AL, 'Sunrise on the 1st', '05:20'), photo_url: null };
db.posts = [boPost, alPost, alEarly, post(AL, 'Lunch at the club', '13:00', last)].sort((a, b) => b.created_at.localeCompare(a.created_at));
db.comments = []; db.reactions = [];
db.dinner_award_nominations = []; db.dinner_award_votes = []; db.rule_opinions = []; db.award_strokes = []; db.score_adjustments = [];
db.award_runs = []; db.cup_points = []; db.cases = []; db.notify_queue = [];
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
db.courses.push({ id: COURSE, group_id: GROUP, name: 'Cypress Lakes', holes, created_at: now() });
db.rounds.push({ id: R, group_id: GROUP, trip_id: T, course_id: COURSE, name: 'Saturday Stableford', play_date: today, format: 'stableford', status: 'live', ld_holes: [], ctp_holes: [], own_comps: [], comp_bonus: 0, created_at: now() });
db.round_players.push(...[AL, BO, K].map((p) => ({ id: crypto.randomUUID(), group_id: GROUP, round_id: R, player_id: p, playing_handicap: 10 })));
db.tee_groups = [{ id: crypto.randomUUID(), group_id: GROUP, round_id: R, group_no: 1, tee_time: '08:00', player_ids: [AL, BO, K] }];

// ------------------------------------------------------------------ what the server does (100), for the fake
const nick = (id) => db.players.find((p) => p.id === id)?.nickname || 'Someone';
const sourceOf = (b) => (b.p_award ? db.dinner_awards.find((a) => a.id === b.p_award) : db.dinner_awards.find((a) => a.trip_id === T && a.rule_id === b.p_rule) || awardForTrip(b.p_rule));
function awardForTrip(ruleId) {
  const r = db.rules.find((x) => x.id === ruleId);
  const a = { id: crypto.randomUUID(), group_id: GROUP, trip_id: T, rule_id: r.id, title: r.title, kind: r.award_kind, status: 'nominating', sort: 0, created_by: K, created_at: now() };
  db.dinner_awards.push(a);
  return a;
}
const termsOf = (a) => autoTerms(a, a.rule_id ? db.rules.find((r) => r.id === a.rule_id) : null);
function runFor(a, ymd) {
  const t = termsOf(a);
  let run = db.award_runs.find((r) => r.source_id === a.id && r.window_date === ymd);
  if (run) return run;
  const w = claimWindow(t.window_from, t.window_to, ymd);
  const tm = proposeTimes({ windowDate: ymd, proposeTime: t.propose_time, firstTee: '08:00', closes: w.closes });
  const copy = { id: crypto.randomUUID(), group_id: GROUP, trip_id: T, title: `${t.title} · night`, kind: t.kind, parent_id: a.id, status: 'nominating', sort: 500, created_at: now() };
  db.dinner_awards.push(copy);
  run = { id: crypto.randomUUID(), group_id: GROUP, trip_id: T, source_id: a.id, award_id: copy.id, rule_id: t.rule_id, kind: t.runs, window_date: ymd, opens_at: w.opens.toISOString(), closes_at: w.closes.toISOString(),
    propose_at: tm.propose_at.toISOString(), confirm_by: tm.confirm_by.toISOString(), status: 'open', results: [], reward_type: t.reward_type, reward_amount: t.reward_amount,
    worth: rewardWords(t.reward_type, t.reward_amount, t.reward_note), adjust_state: 'none', created_at: now() };
  db.award_runs.push(run);
  return run;
}
function rank(run) {
  const a = db.dinner_awards.find((x) => x.id === run.source_id);
  run.results = rankRun(db.dinner_award_nominations.filter((n) => n.award_id === run.award_id), termsOf(a), run);
  return run.results;
}
function writePoints(run) {
  const t = termsOf(db.dinner_awards.find((x) => x.id === run.source_id));
  db.cup_points = db.cup_points.filter((c) => !(c.source_id === run.id && !c.confirmed_at && !c.waived_at && !c.case_id));
  for (const l of run.results) {
    if (!l.points || db.cup_points.some((c) => c.source_id === run.id && c.player_id === l.player_id)) continue;
    db.cup_points.push({ id: crypto.randomUUID(), group_id: GROUP, trip_id: T, comp_id: null, player_id: l.player_id, points: l.points, source_type: t.kind, source_id: run.id, rule_id: run.rule_id, nomination_id: l.nomination_id, label: `${t.title} · ${l.display}`, case_id: null, confirmed_at: null, waived_at: null, created_at: now() });
  }
}
/** The 5-minute job at a given moment: propose what's due (once). */
function tick(at) {
  for (const run of db.award_runs.filter((r) => r.status === 'open' && Date.parse(r.propose_at) <= at.getTime())) {
    const a = db.dinner_awards.find((x) => x.id === run.source_id);
    const t = termsOf(a);
    const res = rank(run);
    if (!res.length) { run.status = 'empty'; continue; }
    Object.assign(run, { status: 'proposed', player_id: res[0].player_id, nomination_id: res[0].nomination_id, claim_at: res[0].at, proposed_at: now() });
    writePoints(run);
    run.proposal = proposalText({ terms: t, run, lines: res, nameOf: nick, worth: run.worth, byTee: true, confirmBy: new Date(run.confirm_by) });
    const p = { id: crypto.randomUUID(), group_id: GROUP, trip_id: T, kind: 'auto', body: run.proposal, player_id: res[0].player_id, link: `/award-run/${run.id}`, photo_url: db.dinner_award_nominations.find((n) => n.id === res[0].nomination_id)?.photo_url || null, created_at: now() };
    db.posts.unshift(p);
    run.post_id = p.id;
    db.notify_queue.push({ id: crypto.randomUUID(), group_id: GROUP, kind: 'award_proposed', title: run.proposal.slice(0, 160) });
  }
}
let me = { id: AL, admin: false };
const fake = fakeSupabase(db, () => me);
function rpc(name, b) {
  if (name === 'award_claim_post') {
    const p = db.posts.find((x) => x.id === b.p_post);
    const a = sourceOf(b);
    const t = termsOf(a);
    const ymd = windowDateFor(t.window_from, t.window_to, p.server_at);
    if (!ymd) return { __error: `Claims for ${t.title} are 9pm to 6am on the trip` };
    const run = runFor(a, ymd);
    if (run.status !== 'open') return { __error: `Too late — ${t.title} has been proposed` };
    const who = b.p_player || p.player_id || me.id;
    const n = db.dinner_award_nominations.find((x) => x.award_id === run.award_id && x.player_id === who);
    if (!n) {
      db.dinner_award_nominations.push({ id: crypto.randomUUID(), group_id: GROUP, award_id: run.award_id, player_id: who, post_id: p.id, photo_url: p.photo_url, claim_at: p.server_at, nominated_by: me.id, reason: p.body, created_at: now() });
      return { status: 'claimed', run: run.id, award: run.award_id, player: who, at: p.server_at };
    }
    const better = t.best === 'earliest' ? p.server_at < n.claim_at : p.server_at > n.claim_at;
    if (!better) return { status: 'kept', run: run.id, award: run.award_id, player: who, at: n.claim_at };
    Object.assign(n, { post_id: p.id, claim_at: p.server_at });
    return { status: 'improved', run: run.id, award: run.award_id, player: who, at: p.server_at };
  }
  if (name === 'award_run_confirm') {
    const run = db.award_runs.find((r) => r.id === b.p_run);
    if (!me.admin) return { __error: 'Only an organiser can do that' };
    if (run.status === 'disputed') return { __error: 'It’s disputed — the Tribunal decides' };
    const a = db.dinner_awards.find((x) => x.id === run.source_id);
    if (b.p_nomination) { const n = db.dinner_award_nominations.find((x) => x.id === b.p_nomination); Object.assign(run, { player_id: n.player_id, nomination_id: n.id }); rank(run); writePoints(run); }
    Object.assign(run, { status: 'confirmed', decided_how: 'organiser', decided_at: now() });
    for (const c of db.cup_points.filter((x) => x.source_id === run.id && !x.confirmed_at && !x.waived_at && !x.case_id)) c.confirmed_at = now();
    Object.assign(db.dinner_awards.find((x) => x.id === run.award_id), { winner_id: run.player_id, status: 'closed' });
    if (run.reward_type === 'strokes') {
      const adj = { id: crypto.randomUUID(), group_id: GROUP, round_id: R, player_id: run.player_id, strokes: run.reward_amount, kind: 'award', rule_id: run.rule_id, label: `${a.title} (${run.reward_amount < 0 ? '−' : '+'}${Math.abs(run.reward_amount)})`, created_at: now() };
      db.score_adjustments.push(adj);
      Object.assign(run, { adjustment_id: adj.id, adjust_round_id: R, adjust_state: 'applied' });
    }
    db.posts.unshift({ id: crypto.randomUUID(), group_id: GROUP, trip_id: T, kind: 'auto', body: `✅ Confirmed — ${a.title}: ${nick(run.player_id)} · ${run.worth} next round`, player_id: run.player_id, link: `/award-run/${run.id}`, created_at: now() });
    return { status: 'confirmed', player: run.player_id, strokes_placed: run.reward_type === 'strokes' };
  }
  if (name === 'award_run_dispute' || name === 'cup_points_dispute') {
    const c = { id: crypto.randomUUID(), group_id: GROUP, kind: 'ruling', status: 'open', title: 'Dispute', body: b.p_reason || null, raised_by: me.id, created_at: now() };
    db.cases.push(c);
    if (name === 'award_run_dispute') Object.assign(db.award_runs.find((r) => r.id === b.p_run), { status: 'disputed', case_id: c.id });
    else Object.assign(db.cup_points.find((x) => x.id === b.p_line), { case_id: c.id });
    return c.id;
  }
  if (name === 'award_for_trip') return awardForTrip(b.p_rule).id;
  return undefined;
}
const handler = async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith('/storage/v1/object/public/')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    const out = rpc(url.pathname.split('/').pop(), JSON.parse(route.request().postData() || '{}'));
    if (out && out.__error) return route.fulfill({ status: 400, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: 'P0001', message: out.__error }) });
    if (out !== undefined) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(out) });
  }
  await fake.handler(route);
};

// ------------------------------------------------------------------ the browser
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();
const ctx = await fakeContext(browser, { handler });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
let promptAnswer = '';
page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept(promptAnswer) : d.accept()));
const wait = (ms = 600) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
const go = async (hash, testId) => { await page.goto(`${BASE}#${hash}`); await page.reload(); if (testId) await page.getByTestId(testId).first().waitFor({ timeout: 15000 }); await wait(); };
const as = (who) => { me = who; };
const AL_ = { id: AL, admin: false };
const JOSH = { id: K, admin: true };
const article = (text) => page.locator('article', { hasText: text });

// 1. Al opens the Feed in the morning: last night's photos have "Claim Latest out?"; the lunch photo doesn't.
as(AL_);
await go('/feed', 'claim-award');
const boClaim = article('Still out').getByTestId('claim-award').filter({ hasText: 'Latest out' });
check((await boClaim.innerText()).includes('Claim Latest out for Bo?'), `Bo's 2:47am photo: "${(await boClaim.innerText()).trim()}"`);
check(await article('Lunch at the club').getByTestId('claim-award').count() === 0, 'the 1pm lunch photo: nothing to claim');
check(await article('Sunrise on the 1st').getByTestId('claim-award').filter({ hasText: 'Latest out' }).count() === 0
  && await article('Sunrise on the 1st').getByTestId('claim-award').filter({ hasText: 'Earliest up' }).count() === 1, 'a photo-less 5:20am post: Earliest up only (Latest out needs a photo)');
await shot('1-feed-claims-375');

// 2. One tap claims it for Bo (Al's claiming for a mate); Al claims his own 1:15am.
await boClaim.click();
await wait(900);
const runL = db.award_runs.find((r) => r.rule_id === LATE);
const boNom = db.dinner_award_nominations.find((n) => n.player_id === BO);
check(runL && runL.window_date === last && runL.kind === 'night', `a night run for last night (${runL?.window_date})`);
check(boNom && boNom.claim_at === boPost.server_at && boNom.nominated_by === AL && boNom.post_id === boPost.id, 'Bo’s claim: the post’s server time, claimed by Al');
await article('Last bus home').getByTestId('claim-award').filter({ hasText: 'Latest out' }).click();
await wait(900);
check(db.dinner_award_nominations.some((n) => n.player_id === AL && n.award_id === runL.award_id), 'Al claimed his own');
// …and "Someone else": Al claims Earliest up for Bo from his sunrise post.
await article('Sunrise on the 1st').getByTestId('claim-other').filter({ hasText: '' }).first().click();
await page.getByTestId('claim-sheet').waitFor();
await page.getByTestId('claim-for').filter({ hasText: 'Bo' }).click();
await wait(900);
const runE = db.award_runs.find((r) => r.source_id === EARLY);
check(db.dinner_award_nominations.some((n) => n.award_id === runE?.award_id && n.player_id === BO), 'Earliest up claimed for Bo (someone else)');
await article('Last bus home').getByTestId('claim-award').filter({ hasText: 'Earliest up' }).click(); // Al: 1:15am "earliest"
await wait(900);

// 3. 6:30am: nothing yet. 7am: proposed — once.
tick(atSydney(today, '06:30'));
check(runL.status === 'open', 'not proposed before 7am');
tick(atSydney(today, '07:00'));
tick(atSydney(today, '07:05'));
check(db.posts.filter((p) => p.link === `/award-run/${runL.id}`).length === 1, 'one proposal post however often the job runs');
check(runL.proposal === `🌙 Proposed — Latest out, last night: Bo 2:47am 📷 (+2), Al 1:15am 📷 (+1) · −1 stroke. Confirm or dispute by the first tee (8am).`, `proposal: ${runL.proposal}`);
check(db.notify_queue.filter((q) => q.kind === 'award_proposed').length === 2, 'two buzzes queued (one per award)');

// 4. The Feed shows the proposal card with the ranked claims and points.
await go('/feed', 'award-run');
const card = page.locator('[data-testid="award-run"]').filter({ hasText: 'Latest out' }).first();
const cardTxt = await card.innerText();
check(cardTxt.includes('#1 Bo') && cardTxt.includes('2:47am') && cardTxt.includes('#2 Al') && cardTxt.includes('+2') && cardTxt.includes('+1'), `card: ranked claims with points (${cardTxt.replace(/\n/g, ' ').slice(0, 160)})`);
check(await card.getByTestId('run-confirm').count() === 0 && await card.getByTestId('run-dispute').count() === 1, 'a player sees Dispute, not Confirm');
// Al disputes Bo's points line ("he was home by 2").
promptAnswer = 'He was home by 2';
await card.getByTestId('dispute-line').first().click();
await wait(900);
const boLine = db.cup_points.find((c) => c.player_id === BO && c.source_id === runL.id);
check(boLine?.case_id && db.cases.some((c) => c.id === boLine.case_id && c.body === 'He was home by 2'), 'Bo’s points line disputed (a Tribunal case)');
await shot('2-proposal-card-375');

// 5. The organiser confirms → the −1 lands on Bo's round; Al's point counts, Bo's waits for the verdict.
as(JOSH);
await go('/feed', 'run-confirm');
await page.locator('[data-testid="award-run"]').filter({ hasText: 'Latest out' }).first().getByTestId('run-confirm').click();
await wait(1000);
check(runL.status === 'confirmed' && runL.player_id === BO, 'Latest out confirmed: Bo');
const adj = db.score_adjustments.find((s) => s.player_id === BO);
check(adj && adj.kind === 'award' && adj.strokes === -1 && adj.label === 'Latest out (−1)' && adj.rule_id === LATE && adj.round_id === R, `score_adjustment: ${adj?.kind} ${adj?.label} ${adj?.strokes}`);
check(db.cup_points.find((c) => c.player_id === AL && c.source_id === runL.id)?.confirmed_at && !boLine.confirmed_at, 'Al’s point counts; Bo’s disputed line waits');
await page.locator('[data-testid="award-run"][data-status="confirmed"]').first().waitFor({ timeout: 8000 });
await shot('3-confirmed-375');

// 6. The leaderboard: −1 on Bo.
await go('/leaderboard', null);
await page.getByTestId('lb-penalty').first().waitFor({ timeout: 15000 });
check((await page.getByTestId('lb-penalty').first().innerText()).includes('−1'), `leaderboard: ${(await page.getByTestId('lb-penalty').first().innerText()).trim()} on Bo`);
await shot('4-leaderboard-375');

// 7. Bo disputes "Earliest up" (Al proposed at 1:15am — "that's not early, that's late").
as({ id: BO, admin: false });
await go('/feed', 'award-run');
const eCard = page.locator('[data-testid="award-run"]').filter({ hasText: 'Earliest up' }).first();
check((await eCard.innerText()).includes('#1 Al'), 'Earliest up proposed: Al (1:15am)');
promptAnswer = 'That’s not early, that’s late';
await eCard.getByTestId('run-dispute').click();
await wait(1000);
check(runE.status === 'disputed' && runE.case_id, 'Earliest up disputed — waits for the Tribunal');
await go('/feed', 'award-run');
check((await page.locator('[data-testid="award-run"][data-status="disputed"]').first().innerText()).includes('Disputed — the Tribunal decides'), 'card: Disputed — the Tribunal decides');
as(JOSH);
await go('/feed', 'award-run');
check(await page.locator('[data-testid="award-run"][data-status="disputed"]').first().getByTestId('run-confirm').count() === 0, 'the organiser can’t confirm while it’s disputed');
await shot('5-disputed-375');

// 8. The awards screen: the nightly awards and their nights; the propose sheet's automatic settings.
await go(`/dinner/${T}`, 'auto-award-runs');
const runsTxt = await page.getByTestId('auto-award-runs').innerText();
check(runsTxt.includes('Each night, 9pm–6am · proposed 7am') && runsTxt.includes('1 pt an hour after 12am, to 5am') && runsTxt.includes('Earliest up'), 'awards screen: how they run and the points');
await shot('6-dinner-375');
await page.getByTestId('dinner-propose').click();
await page.getByTestId('propose-sheet').waitFor();
await page.getByRole('button', { name: 'Latest out' }).click();
check(await page.getByTestId('runs-night').getAttribute('aria-pressed') === 'true', 'propose sheet: a latest-wins time award defaults to Each night');
await page.getByTestId('points-mode').selectOption('per_unit');
await page.getByTestId('points-to').fill('05:00');
check((await page.getByTestId('points-words').innerText()).includes('1 pt an hour after 12am, to 5am'), 'propose sheet: points in words');
await page.getByTestId('award-title').fill('Latest out (night 2)');
await page.getByTestId('propose-save').click();
await wait(1000);
const proposed = db.rules.find((r) => r.title === 'Latest out (night 2)');
check(proposed && proposed.points?.mode === 'per_unit' && proposed.points.from === '00:00' && proposed.points.to === '05:00' && proposed.status === 'proposed', `saved with points ${JSON.stringify(proposed?.points)}`);
await shot('7-propose-375');

// 9. The results lines (what TripResults shows) and the award-run page.
await go(`/award-run/${runL.id}`, 'award-run');
check((await page.getByTestId('award-run').innerText()).includes('Confirmed by the organiser'), '/award-run/:id shows the decided run');

// 10. Laptop width.
await page.setViewportSize({ width: 1440, height: 900 });
await go('/feed', 'award-run'); await shot('8-feed-1440');
await go(`/dinner/${T}`, 'auto-award-runs'); await shot('9-dinner-1440');

check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
